// SPDX-License-Identifier: Elastic-2.0
package dev.bext.callaudio

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.LinkedBlockingQueue
import kotlin.concurrent.thread

/**
 * Microphone capture and speech playback for one live call, as 16 kHz 16-bit
 * mono PCM. Capture uses the voice-communication source with echo
 * cancellation, so the agent's own speech is not transcribed back to it.
 *
 * Nothing is written to storage: frames go to JavaScript and are dropped.
 */
class CallAudioModule : Module() {
  private var record: AudioRecord? = null
  private var track: AudioTrack? = null
  private var echo: AcousticEchoCanceler? = null
  private var noise: NoiseSuppressor? = null
  private var captureThread: Thread? = null
  private var playbackThread: Thread? = null
  private val playback = LinkedBlockingQueue<ByteArray>()
  @Volatile private var running = false
  private var previousMode = AudioManager.MODE_NORMAL
  private var previousSpeaker = false

  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("call_audio_unavailable")

  override fun definition() = ModuleDefinition {
    Name("CallAudio")
    Events("onFrame", "onHangUp")

    AsyncFunction("startAsync") { name: String? -> start(name) }
    Function("play") { pcmBase64: String ->
      if (running && playback.size < MAX_QUEUED_CHUNKS) {
        playback.offer(Base64.decode(pcmBase64, Base64.NO_WRAP))
      }
    }
    Function("flush") {
      playback.clear()
      track?.let {
        it.pause()
        it.flush()
        it.play()
      }
    }
    AsyncFunction("stopAsync") { stop() }
    OnDestroy { stop() }
  }

  private fun start(name: String?) {
    if (running) return
    val minimum =
      AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (minimum <= 0) throw CodedException("call_audio_unavailable")
    val recorder =
      try {
        AudioRecord(
          MediaRecorder.AudioSource.VOICE_COMMUNICATION,
          SAMPLE_RATE,
          AudioFormat.CHANNEL_IN_MONO,
          AudioFormat.ENCODING_PCM_16BIT,
          maxOf(minimum, FRAME_BYTES * 4),
        )
      } catch (error: SecurityException) {
        throw CodedException("call_audio_permission_denied")
      }
    if (recorder.state != AudioRecord.STATE_INITIALIZED) {
      recorder.release()
      throw CodedException("call_audio_unavailable")
    }
    val session = recorder.audioSessionId
    if (AcousticEchoCanceler.isAvailable()) {
      echo = AcousticEchoCanceler.create(session)?.also { it.enabled = true }
    }
    if (NoiseSuppressor.isAvailable()) {
      noise = NoiseSuppressor.create(session)?.also { it.enabled = true }
    }
    val player =
      AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build(),
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setSampleRate(SAMPLE_RATE)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .build(),
        )
        .setTransferMode(AudioTrack.MODE_STREAM)
        .setSessionId(session)
        .setBufferSizeInBytes(FRAME_BYTES * 8)
        .build()

    val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    previousMode = manager.mode
    @Suppress("DEPRECATION")
    previousSpeaker = manager.isSpeakerphoneOn
    manager.mode = AudioManager.MODE_IN_COMMUNICATION
    @Suppress("DEPRECATION")
    manager.isSpeakerphoneOn = true

    // The system notification's hang-up button ends the call from JavaScript,
    // which owns the connection.
    CallForegroundService.hangUpRequested = { sendEvent("onHangUp", emptyMap<String, Any>()) }
    val service =
      Intent(context, CallForegroundService::class.java)
        .putExtra(CallForegroundService.EXTRA_NAME, name)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(service)
    } else {
      context.startService(service)
    }

    record = recorder
    track = player
    running = true
    playback.clear()
    recorder.startRecording()
    player.play()

    captureThread =
      thread(name = "call-audio-capture") {
        val frame = ByteArray(FRAME_BYTES)
        while (running) {
          var filled = 0
          while (running && filled < FRAME_BYTES) {
            val read = recorder.read(frame, filled, FRAME_BYTES - filled)
            if (read <= 0) break
            filled += read
          }
          if (filled == FRAME_BYTES) {
            sendEvent("onFrame", mapOf("pcm" to Base64.encodeToString(frame, Base64.NO_WRAP)))
          } else if (running) {
            break
          }
        }
      }
    playbackThread =
      thread(name = "call-audio-playback") {
        while (running) {
          val chunk =
            try {
              playback.take()
            } catch (interrupted: InterruptedException) {
              break
            }
          if (running) player.write(chunk, 0, chunk.size)
        }
      }
  }

  private fun stop() {
    if (!running && record == null) return
    running = false
    CallForegroundService.hangUpRequested = null
    playbackThread?.interrupt()
    captureThread?.join(500)
    playbackThread?.join(500)
    captureThread = null
    playbackThread = null
    playback.clear()
    echo?.release()
    noise?.release()
    echo = null
    noise = null
    record?.let {
      runCatching { it.stop() }
      it.release()
    }
    track?.let {
      runCatching { it.stop() }
      it.release()
    }
    record = null
    track = null
    appContext.reactContext?.let { context ->
      val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      manager.mode = previousMode
      @Suppress("DEPRECATION")
      manager.isSpeakerphoneOn = previousSpeaker
      context.stopService(Intent(context, CallForegroundService::class.java))
    }
  }

  private companion object {
    const val SAMPLE_RATE = 16_000
    /** 100 ms of 16-bit mono audio. */
    const val FRAME_BYTES = 3_200
    /** About a minute of agent speech; more than that is dropped. */
    const val MAX_QUEUED_CHUNKS = 600
  }
}
