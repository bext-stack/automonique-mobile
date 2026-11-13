// SPDX-License-Identifier: Elastic-2.0
import AVFoundation
import CallKit

/// Presents one call to the system, so it is shown like a phone call: the
/// agent's name, the duration and an end button on the lock screen and while
/// other apps are in front.
///
/// The system is told who is called and for how long, never what is said.
/// Calls are kept out of the Phone app's recents.
final class CallKitBridge: NSObject, CXProviderDelegate, @unchecked Sendable {
  private let provider: CXProvider
  private let controller = CXCallController()
  private var call: UUID?
  /// Set when the app itself ends the call, so `onEnded` is not echoed back.
  private var endingLocally = false

  /// The system activated the call's audio session; audio may start.
  var onAudioActive: (() -> Void)?
  /// The call was ended from the system's call screen, or the system reset.
  var onEnded: (() -> Void)?

  override init() {
    let configuration = CXProviderConfiguration()
    configuration.supportsVideo = false
    configuration.maximumCallGroups = 1
    configuration.maximumCallsPerCallGroup = 1
    configuration.supportedHandleTypes = [.generic]
    configuration.includesCallsInRecents = false
    provider = CXProvider(configuration: configuration)
    super.init()
    provider.setDelegate(self, queue: nil)
  }

  /// Ask the system to start a call. `failed` runs when it refuses, so the
  /// caller can carry on without the system call screen.
  func start(name: String, failed: @escaping @Sendable () -> Void) {
    let id = UUID()
    call = id
    endingLocally = false
    let action = CXStartCallAction(call: id, handle: CXHandle(type: .generic, value: name))
    action.isVideo = false
    action.contactIdentifier = name
    controller.request(CXTransaction(action: action)) { [weak self] error in
      guard error != nil else { return }
      DispatchQueue.main.async {
        self?.call = nil
        failed()
      }
    }
  }

  /// End the call the app started, if the system still shows one.
  func end() {
    guard let id = call else { return }
    call = nil
    endingLocally = true
    controller.request(CXTransaction(action: CXEndCallAction(call: id))) { _ in }
  }

  func providerDidReset(_ provider: CXProvider) {
    let wasActive = call != nil
    call = nil
    if wasActive { onEnded?() }
  }

  func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
    let update = CXCallUpdate()
    update.remoteHandle = action.handle
    update.localizedCallerName = action.handle.value
    update.hasVideo = false
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false
    provider.reportCall(with: action.callUUID, updated: update)
    provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())
    provider.reportOutgoingCall(with: action.callUUID, connectedAt: Date())
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    let local = endingLocally
    endingLocally = false
    if call == action.callUUID { call = nil }
    action.fulfill()
    if !local { onEnded?() }
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    // Muting is done in the app, where the server is told about it.
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    onAudioActive?()
  }
}
