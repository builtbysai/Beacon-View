package com.beaconsecureview.camera

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.IceCandidate

data class SignalingIceServer(
    val urls: List<String>,
    val username: String?,
    val credential: String?,
)

interface CameraSignalingListener {
    fun onViewerReady(
        connectionId: String,
        iceServers: List<SignalingIceServer>,
        relayOnly: Boolean,
        canListen: Boolean,
    )

    fun onAnswer(connectionId: String, sdp: String)

    fun onIce(connectionId: String, candidate: IceCandidate)

    fun onPeerLeft(connectionId: String)

    fun onSignalingState(state: StreamingState)

    fun onRetryAttempt(attempt: Int)

    fun onSourceSwitch(cameraId: String)

    fun onSourcesChanged()

    fun onPrivacyMode(enabled: Boolean)

    fun onTalkState(connectionId: String, active: Boolean)

    fun onRecordingRequested(recordingId: String)

    fun onAuthorizationLost()
}

class CameraSignalingClient(
    context: Context,
    baseUrl: String,
    private val cameraId: String,
    private val credential: String,
    private val listener: CameraSignalingListener,
    private val random: () -> Double = Math::random,
) {
    private val applicationContext = context.applicationContext
    private val client = OkHttpClient()
    private val connectivity =
        applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val handler = Handler(Looper.getMainLooper())
    private val generations = RetryGeneration()
    private val retryGate = RetryGate()
    private val signalingUrl =
        baseUrl
            .replaceFirst("http://", "ws://")
            .replaceFirst("https://", "wss://")
            .trimEnd('/') + "/api/signaling?role=device&cameraId=$cameraId"
    private var networkCallbackRegistered = false
    private var online = false
    private var retryAttempt = 0
    private var retryRunnable: Runnable? = null
    private var stableRunnable: Runnable? = null
    private var socket: WebSocket? = null
    private var stopped = true

    private val networkCallback =
        object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                handler.post {
                    Log.i(LOG_TAG, "event=network_restored")
                    online = true
                    if (!stopped && socket == null) {
                        cancelRetry()
                        openSocket()
                    }
                }
            }

            override fun onCapabilitiesChanged(
                network: Network,
                capabilities: NetworkCapabilities,
            ) {
                handler.post {
                    val restored =
                        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    online = hasUsableNetwork()
                    if (restored && online && !stopped && socket == null) {
                        cancelRetry()
                        openSocket()
                    }
                }
            }

            override fun onLost(network: Network) {
                handler.post {
                    Log.i(LOG_TAG, "event=network_lost")
                    online = false
                    if (!stopped) {
                        listener.onSignalingState(StreamingState.Offline)
                        generations.cancel()
                        cancelRetry()
                        socket?.cancel()
                        socket = null
                        cancelStableReset()
                    }
                }
            }
        }

    fun connect() {
        if (!stopped) return
        stopped = false
        retryAttempt = 0
        registerNetworkCallback()
        online = hasUsableNetwork()
        if (online) openSocket() else listener.onSignalingState(StreamingState.Offline)
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

    fun requestReconnect() {
        if (stopped) return
        cancelRetry()
        cancelStableReset()
        generations.cancel()
        socket?.cancel()
        socket = null
        online = hasUsableNetwork()
        if (online) scheduleReconnect() else listener.onSignalingState(StreamingState.Offline)
    }

    fun pause(connectionIds: Collection<String> = emptyList()) {
        stopped = true
        cancelRetry()
        cancelStableReset()
        generations.cancel()
        for (connectionId in connectionIds) {
            send(JSONObject().put("type", "disconnect").put("connectionId", connectionId))
        }
        socket?.close(1000, "Streaming screen stopped")
        socket = null
        unregisterNetworkCallback()
    }

    fun disconnect(connectionIds: Collection<String> = emptyList()) {
        pause(connectionIds)
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }

    private fun openSocket() {
        if (stopped || !online || socket != null) return
        val generation = generations.next()
        listener.onSignalingState(
            if (retryAttempt == 0) StreamingState.Ready else StreamingState.Reconnecting,
        )
        val request =
            Request.Builder()
                .url(signalingUrl)
                .header("Authorization", "Bearer $credential")
                .build()
        val created =
            client.newWebSocket(
                request,
                object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        if (!generations.isCurrent(generation)) {
                            webSocket.close(1000, "Stale connection")
                            return
                        }
                        handler.post {
                            Log.i(LOG_TAG, "event=signaling_authenticated")
                            listener.onSignalingState(StreamingState.Ready)
                            scheduleStableReset(generation, webSocket)
                        }
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        if (!generations.isCurrent(generation)) return
                        runCatching { handle(JSONObject(text)) }
                            .onFailure {
                                handler.post { listener.onSignalingState(StreamingState.Failed) }
                            }
                    }

                    // Answer the server's close frame so onClosed (and its close code) is delivered (V67).
                    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                        webSocket.close(code, null)
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        socketEnded(webSocket, generation, code == 4003, reason)
                    }

                    override fun onFailure(
                        webSocket: WebSocket,
                        throwable: Throwable,
                        response: Response?,
                    ) {
                        socketEnded(
                            webSocket,
                            generation,
                            response?.code == 401 || response?.code == 403,
                        )
                    }
                },
            )
        socket = created
    }

    private fun socketEnded(
        webSocket: WebSocket,
        generation: Int,
        authorizationLost: Boolean,
        closeReason: String? = null,
    ) {
        handler.post {
            if (!generations.isCurrent(generation) || socket !== webSocket) return@post
            socket = null
            cancelStableReset()
            if (authorizationLost) {
                stopped = true
                cancelRetry()
                listener.onAuthorizationLost()
            } else if (closeReason == "camera_removed") {
                stopped = true
                cancelRetry()
                listener.onSourcesChanged()
            } else {
                scheduleReconnect()
            }
        }
    }

    private fun scheduleReconnect() {
        if (stopped || !online || !retryGate.schedule()) return
        val attempt = retryAttempt++
        Log.i(LOG_TAG, "event=reconnect_scheduled attempt=${attempt + 1}")
        val generation = generations.next()
        listener.onSignalingState(StreamingState.Reconnecting)
        listener.onRetryAttempt(retryAttempt)
        val runnable =
            Runnable {
                retryGate.clear()
                retryRunnable = null
                if (!stopped && online && generations.isCurrent(generation)) openSocket()
            }
        retryRunnable = runnable
        handler.postDelayed(runnable, retryDelayMillis(attempt, random()))
    }

    private fun cancelRetry() {
        retryRunnable?.let(handler::removeCallbacks)
        retryRunnable = null
        retryGate.clear()
    }

    private fun scheduleStableReset(
        generation: Int,
        webSocket: WebSocket,
    ) {
        cancelStableReset()
        val runnable =
            Runnable {
                stableRunnable = null
                if (
                    !stopped &&
                    socket === webSocket &&
                    generations.isCurrent(generation)
                ) {
                    retryAttempt = 0
                    listener.onRetryAttempt(0)
                }
            }
        stableRunnable = runnable
        handler.postDelayed(runnable, STABLE_CONNECTION_MILLIS)
    }

    private fun cancelStableReset() {
        stableRunnable?.let(handler::removeCallbacks)
        stableRunnable = null
    }

    private fun registerNetworkCallback() {
        if (networkCallbackRegistered) return
        connectivity.registerDefaultNetworkCallback(networkCallback)
        networkCallbackRegistered = true
    }

    private fun unregisterNetworkCallback() {
        if (!networkCallbackRegistered) return
        runCatching { connectivity.unregisterNetworkCallback(networkCallback) }
        networkCallbackRegistered = false
    }

    private fun hasUsableNetwork(): Boolean {
        val network = connectivity.activeNetwork ?: return false
        return connectivity.getNetworkCapabilities(network)
            ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    }

    companion object {
        private const val LOG_TAG = "BeaconLifecycle"
    }

    private fun handle(message: JSONObject) {
        when (message.getString("type")) {
            "viewer-ready" -> {
                val servers = message.getJSONArray("iceServers").toIceServers()
                val relayOnly = message.optString("iceTransportPolicy") == "relay"
                handler.post {
                    listener.onViewerReady(
                        message.getString("connectionId"),
                        servers,
                        relayOnly,
                        message.optBoolean("canListen", true),
                    )
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
            "peer-left" ->
                handler.post {
                    listener.onPeerLeft(message.getString("connectionId"))
                }
            "switch-source" ->
                handler.post {
                    listener.onSourceSwitch(message.getString("cameraId"))
                }
            "sources-changed" -> handler.post(listener::onSourcesChanged)
            "privacy-mode" ->
                handler.post {
                    listener.onPrivacyMode(message.getBoolean("enabled"))
                }
            "talk-state" ->
                handler.post {
                    listener.onTalkState(
                        message.getString("connectionId"),
                        message.getBoolean("active"),
                    )
                }
            "recording-request" ->
                handler.post {
                    listener.onRecordingRequested(message.getString("recordingId"))
                }
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
