package com.beaconsecureview.camera

import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.MediaConstraints
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpSender
import org.webrtc.RtpTransceiver

internal enum class TalkState { Idle, Permission, Connecting, Speaking, Busy, Unavailable, Recovering }

/** Mirrors the PWA's `talkStatusText` (live-video-presentation.ts) verbatim. */
internal fun talkStatusText(state: TalkState): String =
    when (state) {
        TalkState.Idle -> ""
        TalkState.Permission -> "Allow microphone access to talk."
        TalkState.Connecting -> "Connecting talk…"
        TalkState.Speaking -> "Speaking · microphone on"
        TalkState.Busy -> "Another viewer is talking."
        TalkState.Recovering -> "Microphone off · reconnecting"
        TalkState.Unavailable -> "Talk unavailable."
    }

/** Kotlin port of the PWA's `TalkSession` (talk.ts). One explicit microphone
 * consent belongs to one live connection only. Assumes RECORD_AUDIO has
 * already been granted by the time [start] is called -- requesting the
 * runtime permission is a UI-layer concern (see `NativeLiveView.kt`), since a
 * plain class like this one can't launch an Android permission request. */
internal class TalkSession(
    private val connectionId: String,
    private val peer: PeerConnection,
    private val factory: PeerConnectionFactory,
    private val send: (JSONObject) -> Unit,
    private val onState: (TalkState) -> Unit,
) {
    private val handler = Handler(Looper.getMainLooper())
    private var generation = 0
    private var audioSource: AudioSource? = null
    private var localTrack: AudioTrack? = null
    private var sender: RtpSender? = null
    private var timeoutRunnable: Runnable? = null
    private var requested = false
    @Volatile private var disposed = false
    private var state = TalkState.Idle

    private fun update(next: TalkState) {
        state = next
        onState(next)
    }

    fun start() {
        if (disposed || state == TalkState.Permission || state == TalkState.Connecting || state == TalkState.Speaking) return
        val transceiver =
            peer.transceivers.firstOrNull { candidate ->
                candidate.receiver.track()?.kind() == MediaStreamTrack.AUDIO_TRACK_KIND &&
                    (candidate.currentDirection == RtpTransceiver.RtpTransceiverDirection.SEND_ONLY ||
                        candidate.currentDirection == RtpTransceiver.RtpTransceiverDirection.SEND_RECV)
            }
        if (transceiver == null || peer.connectionState() != PeerConnection.PeerConnectionState.CONNECTED) {
            update(TalkState.Unavailable)
            return
        }
        val current = ++generation
        update(TalkState.Permission)
        try {
            val source = factory.createAudioSource(MediaConstraints())
            val track = factory.createAudioTrack("beacon-talk-mic-$current", source)
            if (disposed || current != generation) {
                track.dispose()
                source.dispose()
                return
            }
            // No microphone audio leaves the viewer until the server grants ownership.
            track.setEnabled(false)
            audioSource = source
            localTrack = track
            sender = transceiver.sender
            sender?.setTrack(track, false)
            if (disposed || current != generation) return
            requested = true
            update(TalkState.Connecting)
            timeoutRunnable =
                Runnable { stop(TalkState.Unavailable) }.also { handler.postDelayed(it, 10_000) }
            send(JSONObject().put("connectionId", connectionId).put("type", "talk-request"))
        } catch (_: Throwable) {
            if (current == generation && !disposed) stop(TalkState.Unavailable)
        }
    }

    fun receive(active: Boolean, reason: String?) {
        if (disposed) return
        if (active && requested && localTrack != null) {
            timeoutRunnable?.let(handler::removeCallbacks)
            timeoutRunnable = null
            localTrack?.setEnabled(true)
            update(TalkState.Speaking)
        } else if (!active && requested) {
            stop(
                when (reason) {
                    "busy" -> TalkState.Busy
                    "not_allowed" -> TalkState.Unavailable
                    else -> TalkState.Idle
                },
            )
        } else if (active) {
            // A grant can race with Stop or a dismissed permission request.
            runCatching { send(JSONObject().put("connectionId", connectionId).put("type", "talk-release")) }
        }
    }

    fun stop(next: TalkState = TalkState.Idle) {
        generation += 1
        timeoutRunnable?.let(handler::removeCallbacks)
        timeoutRunnable = null
        localTrack?.setEnabled(false)
        runCatching { localTrack?.dispose() }
        localTrack = null
        runCatching { audioSource?.dispose() }
        audioSource = null
        runCatching { sender?.setTrack(null, false) }
        sender = null
        val wasRequested = requested
        requested = false
        update(next)
        if (wasRequested) {
            runCatching { send(JSONObject().put("connectionId", connectionId).put("type", "talk-release")) }
        }
    }

    fun dispose() {
        disposed = true
        stop(
            if (state == TalkState.Permission || state == TalkState.Connecting || state == TalkState.Speaking) {
                TalkState.Recovering
            } else {
                state
            },
        )
    }
}
