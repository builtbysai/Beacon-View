package com.beaconsecureview.camera

import org.json.JSONObject

/**
 * Turns a validated web message into a native action and a reply (ADR 0121). The activity supplies [Host]; nothing
 * here touches Android views, so the behaviour is tested without a device.
 */
internal class NativeBridge(private val host: Host) {
    interface Host {
        val appVersion: String

        fun cameraState(): JSONObject

        /** Whether phone alerts are on, and whether Firebase changed the token since the web app registered it. */
        fun pushState(): JSONObject

        /** Pairs this phone as a camera with a code the signed-in web app created, then shows the camera screen. */
        fun startCamera(code: String)

        fun openCameraScreen()

        fun setPrivacy(enabled: Boolean)

        fun disconnectCamera()

        fun openUpdate()

        /** Turns Firebase on; [done] gets the token and installation id to register, or the failure. */
        fun enablePush(done: (Result<JSONObject>) -> Unit)

        fun pushEnabled(subscriptionId: String)

        /** Turns alerts off; [done] gets the subscription id the web app should remove (or null). */
        fun disablePush(done: (Result<String?>) -> Unit)

        /** Whether this phone can float a video (Android 8 and newer). */
        val pipSupported: Boolean

        /** Floats the live video now; false when it cannot. */
        fun enterPip(): Boolean

        /** Float on its own when the person leaves the app, while [ready]. */
        fun setPipReady(ready: Boolean)

        /** Starts saving a file; returns the token for its pieces, or null when it cannot be saved. */
        fun saveFileStart(name: String, mime: String): String?

        fun saveFileChunk(token: String, base64: String): Boolean

        /** Finishes the file; returns the name it was saved under, or null on failure. */
        fun saveFileEnd(token: String): String?
    }

    /** Handles [raw]; the answer goes to [respond] (now, or later for the slow ones). False when it is not ours. */
    fun handle(raw: String?, respond: (String) -> Unit): Boolean {
        val message = NativeBridgeProtocol.parse(raw) ?: return false
        val id = message.id
        fun ok(data: JSONObject = JSONObject()) = respond(NativeBridgeProtocol.reply(id, data))
        when (val request = message.request) {
            BridgeRequest.Hello ->
                ok(
                    JSONObject()
                        .put("app", "android")
                        .put("version", host.appVersion)
                        .put("camera", host.cameraState())
                        .put("push", host.pushState())
                        .put("pip", host.pipSupported),
                )
            is BridgeRequest.StartCamera -> {
                host.startCamera(request.code)
                ok()
            }
            BridgeRequest.OpenCameraScreen -> {
                host.openCameraScreen()
                ok()
            }
            is BridgeRequest.SetPrivacy -> {
                host.setPrivacy(request.enabled)
                ok()
            }
            BridgeRequest.DisconnectCamera -> {
                host.disconnectCamera()
                ok()
            }
            BridgeRequest.OpenUpdate -> {
                host.openUpdate()
                ok()
            }
            BridgeRequest.EnablePush ->
                host.enablePush { result ->
                    result.fold(
                        onSuccess = { ok(it) },
                        onFailure = { respond(NativeBridgeProtocol.failure(id, "Alerts could not be turned on.")) },
                    )
                }
            is BridgeRequest.PushEnabled -> {
                host.pushEnabled(request.subscriptionId)
                ok()
            }
            BridgeRequest.DisablePush ->
                host.disablePush { result ->
                    result.fold(
                        onSuccess = { ok(JSONObject().put("subscriptionId", it ?: JSONObject.NULL)) },
                        onFailure = { respond(NativeBridgeProtocol.failure(id, "Alerts could not be turned off.")) },
                    )
                }
            BridgeRequest.EnterPip ->
                if (host.pipSupported && host.enterPip()) {
                    ok()
                } else {
                    respond(NativeBridgeProtocol.failure(id, "The video could not float."))
                }
            is BridgeRequest.PipReady -> {
                host.setPipReady(request.ready)
                ok()
            }
            is BridgeRequest.SaveFileStart ->
                host.saveFileStart(request.name, request.mime)
                    ?.let { ok(JSONObject().put("token", it)) }
                    ?: respond(NativeBridgeProtocol.failure(id, "The file could not be saved."))
            is BridgeRequest.SaveFileChunk ->
                if (host.saveFileChunk(request.token, request.data)) {
                    ok()
                } else {
                    respond(NativeBridgeProtocol.failure(id, "The file could not be saved."))
                }
            is BridgeRequest.SaveFileEnd ->
                host.saveFileEnd(request.token)
                    ?.let { ok(JSONObject().put("name", it)) }
                    ?: respond(NativeBridgeProtocol.failure(id, "The file could not be saved."))
        }
        return true
    }
}
