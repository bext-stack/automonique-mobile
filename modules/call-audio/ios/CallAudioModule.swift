// SPDX-License-Identifier: Elastic-2.0
import AVFoundation
import ExpoModulesCore

/// Microphone capture and speech playback for one live call, as 16 kHz
/// 16-bit mono PCM. The input node runs with voice processing, so the
/// agent's own speech is cancelled from what the microphone hears.
///
/// Nothing is written to storage: frames go to JavaScript and are dropped.
public final class CallAudioModule: Module {
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private var converter: AVAudioConverter?
  private var pending = Data()
  private var running = false
  /// Whether a call was requested and not yet stopped.
  private var wanted = false
  private lazy var system: CallKitBridge = {
    let bridge = CallKitBridge()
    bridge.onAudioActive = { [weak self] in
      guard let self, self.wanted else { return }
      try? self.startEngine()
    }
    bridge.onEnded = { [weak self] in
      guard let self, self.wanted else { return }
      self.sendEvent("onHangUp", [:])
    }
    return bridge
  }()

  private static let sampleRate: Double = 16_000
  /// 100 ms of 16-bit mono audio.
  private static let frameBytes = 3_200

  private let wire = AVAudioFormat(
    commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: 1, interleaved: true)!
  private let playable = AVAudioFormat(
    commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!

  public func definition() -> ModuleDefinition {
    Name("CallAudio")
    Events("onFrame", "onHangUp")

    AsyncFunction("requestPermissionAsync") { (promise: Promise) in
      AVAudioSession.sharedInstance().requestRecordPermission { granted in
        promise.resolve(granted)
      }
    }
    // On the main queue, where the system delivers its call events too.
    AsyncFunction("startAsync") { (name: String?) in
      try self.start(name: name)
    }.runOnQueue(.main)
    Function("play") { (pcmBase64: String) in
      guard self.running, let data = Data(base64Encoded: pcmBase64) else { return }
      self.schedule(data)
    }
    Function("flush") {
      guard self.running else { return }
      self.player.stop()
      self.player.play()
    }
    AsyncFunction("stopAsync") { self.stop() }.runOnQueue(.main)
    OnDestroy { self.stop() }
  }

  /// Begin a call. The system is asked to present it; audio starts when the
  /// system activates the session, or at once when it declines to.
  private func start(name: String?) throws {
    if wanted { return }
    wanted = true
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(
        .playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
      try session.setPreferredSampleRate(Self.sampleRate)
    } catch {
      wanted = false
      throw error
    }
    let label = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    system.start(name: label.isEmpty ? "Automonique" : String(label.prefix(80))) { [weak self] in
      // No system call screen: run the call as plain background audio.
      guard let self, self.wanted else { return }
      try? AVAudioSession.sharedInstance().setActive(true)
      try? self.startEngine()
    }
  }

  private func startEngine() throws {
    if running { return }
    let input = engine.inputNode
    try input.setVoiceProcessingEnabled(true)
    let inputFormat = input.outputFormat(forBus: 0)
    guard let converter = AVAudioConverter(from: inputFormat, to: wire) else {
      throw Exception(name: "call_audio_unavailable", description: "No converter to 16 kHz PCM")
    }
    self.converter = converter
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: playable)

    input.installTap(onBus: 0, bufferSize: 4_096, format: inputFormat) { [weak self] buffer, _ in
      self?.capture(buffer)
    }
    engine.prepare()
    try engine.start()
    player.play()
    pending.removeAll(keepingCapacity: true)
    running = true
  }

  private func capture(_ buffer: AVAudioPCMBuffer) {
    guard running, let converter else { return }
    let ratio = Self.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
    guard let output = AVAudioPCMBuffer(pcmFormat: wire, frameCapacity: capacity) else { return }
    var consumed = false
    var failure: NSError?
    converter.convert(to: output, error: &failure) { _, status in
      if consumed {
        status.pointee = .noDataNow
        return nil
      }
      consumed = true
      status.pointee = .haveData
      return buffer
    }
    guard failure == nil, output.frameLength > 0, let samples = output.int16ChannelData else {
      return
    }
    pending.append(
      UnsafeBufferPointer(start: samples[0], count: Int(output.frameLength)))
    while pending.count >= Self.frameBytes {
      let frame = pending.prefix(Self.frameBytes)
      pending.removeFirst(Self.frameBytes)
      sendEvent("onFrame", ["pcm": frame.base64EncodedString()])
    }
  }

  private func schedule(_ data: Data) {
    let frames = AVAudioFrameCount(data.count / 2)
    guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: playable, frameCapacity: frames),
      let channel = buffer.floatChannelData
    else { return }
    buffer.frameLength = frames
    data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
      let samples = raw.bindMemory(to: Int16.self)
      for index in 0..<Int(frames) {
        channel[0][index] = Float(Int16(littleEndian: samples[index])) / 32_768
      }
    }
    player.scheduleBuffer(buffer, completionHandler: nil)
  }

  private func stop() {
    guard wanted || running else { return }
    wanted = false
    system.end()
    guard running else { return }
    running = false
    engine.inputNode.removeTap(onBus: 0)
    player.stop()
    engine.stop()
    engine.detach(player)
    converter = nil
    pending.removeAll()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}
