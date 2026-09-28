package com.beaconsecureview.camera

import android.content.Context
import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack
import org.webrtc.AudioTrack
import kotlin.concurrent.thread

internal class AndroidViewerSession(
    context: Context,
    baseUrl: String,
    cameraId: String,
    sessionToken: String,
    private val renderer: SurfaceViewRenderer,
    private val onState: (StreamingState) -> Unit,
    private val onCanListen: (Boolean) -> Unit,
    private val onCanTalk: (Boolean) -> Unit = {},
    private val onTalkState: (TalkState) -> Unit = {},
    private val onQuality: (StreamQuality?) -> Unit = {},
    private val onAuthorizationLost: () -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val client = OkHttpClient()
    private val egl = EglBase.create()
    private val factory: PeerConnectionFactory
    private var socket: WebSocket? = null
    private var peer: PeerConnection? = null
    private var connectionId: String? = null
    private var remoteTrack: VideoTrack? = null
    @Volatile private var remoteAudioTrack: AudioTrack? = null
    @Volatile private var canListen = false
    @Volatile private var listening = false
    private var talkSession: TalkSession? = null
    private var qualityPoll: Runnable? = null
    private var previousInboundBytes: PreviousInboundBytes? = null
    private val pendingIce = mutableListOf<IceCandidate>()
    @Volatile
    private var closed = false

    init {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions(),
        )
        factory =
            PeerConnectionFactory.builder()
                .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
                .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
                .createPeerConnectionFactory()
        renderer.init(egl.eglBaseContext, null)
        renderer.setEnableHardwareScaler(true)
        renderer.setMirror(false)
        val signalingUrl =
            baseUrl.trimEnd('/').replaceFirst("http://", "ws://").replaceFirst("https://", "wss://") +
                "/api/signaling?role=viewer&cameraId=$cameraId"
        val request = Request.Builder().url(signalingUrl).header("Authorization", "Bearer $sessionToken").build()
        emit(StreamingState.Connecting)
        socket = client.newWebSocket(request, Listener())
    }

    @Synchronized
    fun setListening(enabled: Boolean): Boolean {
        listening = enabled && canListen
        remoteAudioTrack?.setEnabled(listening)
        return listening
    }

    fun startTalk() {
        talkSession?.start()
    }

    fun stopTalk() {
        talkSession?.stop()
    }

    private fun stopQualityPolling() {
        qualityPoll?.let(main::removeCallbacks)
        qualityPoll = null
    }

    private fun startQualityPolling() {
        stopQualityPolling()
        val poll =
            object : Runnable {
                override fun run() {
                    val activePeer = peer
                    if (activePeer == null || closed) return
                    activePeer.getStats { report ->
                        val sample = readStreamQuality(report, previousInboundBytes)
                        if (sample != null) previousInboundBytes = sample.first
                        main.post { if (!closed) onQuality(sample?.second) }
                    }
                    if (!closed) main.postDelayed(this, 2_000)
                }
            }
        qualityPoll = poll
        main.post(poll)
    }

    fun close() {
        synchronized(this) {
            if (closed) return
            closed = true
        }
        stopQualityPolling()
        talkSession?.dispose()
        talkSession = null
        thread(name = "BeaconViewerCleanup") {
            synchronized(this) {
                val id = connectionId
                if (id != null) {
                    socket?.send(
                        JSONObject()
                            .put("connectionId", id)
                            .put("type", "disconnect")
                            .toString(),
                    )
                }
                remoteTrack?.removeSink(renderer)
                remoteTrack = null
                remoteAudioTrack?.setEnabled(false)
                remoteAudioTrack = null
                peer?.close()
                peer?.dispose()
                peer = null
                socket?.close(1000, "Viewer closed")
                socket = null
                client.dispatcher.executorService.shutdown()
                factory.dispose()
                renderer.release()
                egl.release()
            }
        }
    }

    private fun createPeer(message: JSONObject) {
        val servers = message.getJSONArray("iceServers").let { array ->
            (0 until array.length()).map { index ->
                val item = array.getJSONObject(index)
                val urls = item.getJSONArray("urls").let { values ->
                    (0 until values.length()).map(values::getString)
                }
                PeerConnection.IceServer.builder(urls)
                    .setUsername(item.optString("username"))
                    .setPassword(item.optString("credential"))
                    .createIceServer()
            }
        }
        peer =
            factory.createPeerConnection(
                PeerConnection.RTCConfiguration(servers).apply {
                    iceTransportsType =
                        if (message.optString("iceTransportPolicy") == "relay") {
                            PeerConnection.IceTransportsType.RELAY
                        } else {
                            PeerConnection.IceTransportsType.ALL
                        }
                    sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
                },
                Observer(),
            )
    }

    private fun applyOffer(message: JSONObject) {
        val activePeer = peer ?: return
        activePeer.setRemoteDescription(
            object : SimpleSdpObserver() {
                override fun onSetSuccess() {
                    pendingIce.toList().also { pendingIce.clear() }.forEach(activePeer::addIceCandidate)
                    // Negotiate the offered return-audio channel without opening a
                    // microphone yet. The device's offer direction for each audio
                    // m-line (sendonly for its own mic, recvonly for talk-back) still
                    // constrains the final negotiated direction either way -- this
                    // only unlocks the talk-back line to become sendonly instead of
                    // inactive, matching the PWA's identical pre-answer step.
                    for (transceiver in activePeer.transceivers) {
                        if (transceiver.receiver.track()?.kind() == MediaStreamTrack.AUDIO_TRACK_KIND) {
                            transceiver.direction = RtpTransceiver.RtpTransceiverDirection.SEND_RECV
                        }
                    }
                    activePeer.createAnswer(
                        object : SimpleSdpObserver() {
                            override fun onCreateSuccess(description: SessionDescription) {
                                activePeer.setLocalDescription(
                                    object : SimpleSdpObserver() {
                                        override fun onSetSuccess() {
                                            send("answer") { put("sdp", description.description) }
                                        }
                                    },
                                    description,
                                )
                            }
                        },
                        MediaConstraints(),
                    )
                }
            },
            SessionDescription(SessionDescription.Type.OFFER, message.getString("sdp")),
        )
    }

    private fun send(type: String, content: JSONObject.() -> Unit = {}) {
        val id = connectionId ?: return
        socket?.send(JSONObject().put("connectionId", id).put("type", type).apply(content).toString())
    }

    private fun emit(state: StreamingState) = main.post { if (!closed) onState(state) }

    private inner class Listener : WebSocketListener() {
        override fun onMessage(webSocket: WebSocket, text: String) {
            if (closed) return
            runCatching {
                val message = JSONObject(text)
                when (message.getString("type")) {
                    "ready" -> {
                        val id = message.getString("connectionId")
                        connectionId = id
                        val allowed = message.optBoolean("canListen", false)
                        synchronized(this@AndroidViewerSession) {
                            canListen = allowed
                            if (!allowed) {
                                listening = false
                                remoteAudioTrack?.setEnabled(false)
                            }
                        }
                        main.post { if (!closed) onCanListen(allowed) }
                        main.post { if (!closed) onCanTalk(message.optBoolean("canTalk", false)) }
                        createPeer(message)
                        peer?.let { activePeer ->
                            talkSession =
                                TalkSession(
                                    connectionId = id,
                                    peer = activePeer,
                                    factory = factory,
                                    send = { payload -> socket?.send(payload.toString()) },
                                    onState = { talkState -> main.post { if (!closed) onTalkState(talkState) } },
                                )
                        }
                    }
                    "offer" -> applyOffer(message)
                    "talk-state" ->
                        talkSession?.receive(
                            message.getBoolean("active"),
                            message.optString("reason").ifEmpty { null },
                        )
                    "ice" -> {
                        val value = message.getJSONObject("candidate")
                        val candidate = IceCandidate(
                            value.optString("sdpMid").ifEmpty { null },
                            value.getInt("sdpMLineIndex"),
                            value.getString("candidate"),
                        )
                        if (peer?.remoteDescription != null) peer?.addIceCandidate(candidate) else pendingIce += candidate
                    }
                    "error", "peer-left" -> emit(StreamingState.Offline)
                }
            }.onFailure { emit(StreamingState.Failed) }
        }

        override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
            if (!closed) emit(StreamingState.Failed)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (closed) return
            if (code == 4003) main.post(onAuthorizationLost) else emit(StreamingState.Offline)
        }
    }

    private inner class Observer : PeerConnection.Observer {
        override fun onIceCandidate(candidate: IceCandidate) {
            send("ice") {
                put(
                    "candidate",
                    JSONObject()
                        .put("candidate", candidate.sdp)
                        .put("sdpMLineIndex", candidate.sdpMLineIndex)
                        .put("sdpMid", candidate.sdpMid),
                )
            }
        }

        override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
            when (state) {
                PeerConnection.PeerConnectionState.CONNECTED -> {
                    send("connected")
                    emit(StreamingState.Connected)
                    startQualityPolling()
                }
                PeerConnection.PeerConnectionState.DISCONNECTED -> emit(StreamingState.Reconnecting)
                PeerConnection.PeerConnectionState.FAILED,
                PeerConnection.PeerConnectionState.CLOSED,
                -> emit(StreamingState.Failed)
                else -> Unit
            }
        }

        override fun onAddTrack(receiver: RtpReceiver, mediaStreams: Array<out MediaStream>) {
            when (val track = receiver.track()) {
                is VideoTrack -> {
                    remoteTrack?.removeSink(renderer)
                    remoteTrack = track
                    track.addSink(renderer)
                }
                is AudioTrack -> {
                    remoteAudioTrack = track
                    track.setEnabled(listening && canListen)
                }
            }
        }

        override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) = Unit
        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
        override fun onAddStream(stream: MediaStream) = Unit
        override fun onRemoveStream(stream: MediaStream) = Unit
        override fun onDataChannel(channel: DataChannel) = Unit
        override fun onRenegotiationNeeded() = Unit
    }
}
