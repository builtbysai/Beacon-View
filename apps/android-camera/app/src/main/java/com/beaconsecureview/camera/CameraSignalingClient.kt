package com.beaconsecureview.camera

import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.IceCandidate
import org.webrtc.PeerConnection

data class SignalingIceServer(
    val urls: List<String>,
    val username: String?,
    val credential: String?,
)

interface CameraSignalingListener {
    fun onViewerReady(connectionId: String, iceServers: List<SignalingIceServer>)

    fun onAnswer(connectionId: String, sdp: String)

    fun onIce(connectionId: String, candidate: IceCandidate)

    fun onPeerLeft()

    fun onSignalingState(state: StreamingState)
}

class CameraSignalingClient(
    baseUrl: String,
    private val credential: String,
    private val listener: CameraSignalingListener,
) {
    private val client = OkHttpClient()
    private val handler = Handler(Looper.getMainLooper())
    private val signalingUrl =
        baseUrl
            .replaceFirst("http://", "ws://")
            .replaceFirst("https://", "wss://")
            .trimEnd('/') + "/api/signaling?role=device"
    private var socket: WebSocket? = null
    private var stopped = false

    fun connect() {
        stopped = false
        openSocket()
    }

    fun sendOffer(connectionId: String, sdp: String) {
        send(JSONObject().put("type", "offer").put("connectionId", connectionId).put("sdp", sdp))
    }

    fun sendIce(connectionId: String, candidate: IceCandidate) {
        send(
            JSONObject()
                .put("type", "ice")
                .put("connectionId", connectionId)
                .put(
                    "candidate",
                    JSONObject()
                        .put("candidate", candidate.sdp)
                        .put("sdpMid", candidate.sdpMid)
                        .put("sdpMLineIndex", candidate.sdpMLineIndex),
                ),
        )
    }

    fun sendConnected(connectionId: String) {
        send(JSONObject().put("type", "connected").put("connectionId", connectionId))
    }

    fun disconnect(connectionId: String?) {
        stopped = true
        if (connectionId != null) {
            send(JSONObject().put("type", "disconnect").put("connectionId", connectionId))
        }
        socket?.close(1000, "Camera stopped")
        socket = null
        client.dispatcher.executorService.shutdown()
    }

    private fun openSocket() {
        val request =
            Request.Builder()
                .url(signalingUrl)
                .header("Authorization", "Bearer $credential")
                .build()
        socket =
            client.newWebSocket(
                request,
                object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        handler.post { listener.onSignalingState(StreamingState.Waiting) }
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        runCatching { handle(JSONObject(text)) }
                            .onFailure {
                                handler.post { listener.onSignalingState(StreamingState.Failed) }
                            }
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        if (code == 4003) {
                            handler.post { listener.onSignalingState(StreamingState.Failed) }
                        } else {
                            reconnect()
                        }
                    }

                    override fun onFailure(
                        webSocket: WebSocket,
                        throwable: Throwable,
                        response: Response?,
                    ) {
                        handler.post { listener.onSignalingState(StreamingState.Disconnected) }
                        reconnect()
                    }
                },
            )
    }

    private fun reconnect() {
        if (stopped) return
        handler.postDelayed(
            {
                if (!stopped) openSocket()
            },
            5_000,
        )
    }

    private fun handle(message: JSONObject) {
        when (message.getString("type")) {
            "viewer-ready" -> {
                val servers = message.getJSONArray("iceServers").toIceServers()
                handler.post {
                    listener.onViewerReady(message.getString("connectionId"), servers)
                }
            }
            "answer" ->
                handler.post {
                    listener.onAnswer(
                        message.getString("connectionId"),
                        message.getString("sdp"),
                    )
                }
            "ice" -> {
                val candidate = message.getJSONObject("candidate")
                handler.post {
                    listener.onIce(
                        message.getString("connectionId"),
                        IceCandidate(
                            candidate.optString("sdpMid").ifEmpty { null },
                            candidate.optInt("sdpMLineIndex"),
                            candidate.getString("candidate"),
                        ),
                    )
                }
            }
            "peer-left" -> handler.post { listener.onPeerLeft() }
        }
    }

    private fun send(message: JSONObject) {
        socket?.send(message.toString())
    }
}

private fun JSONArray.toIceServers(): List<SignalingIceServer> =
    (0 until length()).map { index ->
        val item = getJSONObject(index)
        val urls = item.getJSONArray("urls")
        SignalingIceServer(
            urls = (0 until urls.length()).map { urls.getString(it) },
            username = item.optString("username").ifEmpty { null },
            credential = item.optString("credential").ifEmpty { null },
        )
    }
