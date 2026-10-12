package com.beaconsecureview.camera

import org.json.JSONObject

/**
 * The messages the web app may send the Android shell (ADR 0121). A short fixed list, each validated: there is no
 * generic "call this method", and an unknown or malformed message is dropped.
 *
 * Wire format (web to app): `{"id": "<opaque, <= 64 chars>", "type": "<one of the below>", ...fields}`.
 * Replies (app to web): `{"id": "<same>", "ok": true, "data": {...}}` or `{"id": "<same>", "ok": false, "error": "..."}`.
 * Events (app to web, no id): `{"event": "camera", "data": {...}}`.
 */
internal sealed interface BridgeRequest {
    /** The web app says hello and asks what this app is and how the phone's own camera is doing. */
    data object Hello : BridgeRequest

    /** "This device" in Add a device: pair this phone as a camera with a code the signed-in web app just created. */
    data class StartCamera(val code: String) : BridgeRequest

    /** Show the native camera screen for a phone that is already a camera. */
    data object OpenCameraScreen : BridgeRequest

    data class SetPrivacy(val enabled: Boolean) : BridgeRequest

    /** Stop being a camera on this phone and forget the pairing. */
    data object DisconnectCamera : BridgeRequest

    /** Open the download page for a newer build of the app. */
    data object OpenUpdate : BridgeRequest
}

internal data class BridgeMessage(val id: String, val request: BridgeRequest)

internal object NativeBridgeProtocol {
    private val idPattern = Regex("^[A-Za-z0-9_.:-]{1,64}$")

    /** A validated message, or null when it is not one of ours. Never throws. */
    fun parse(raw: String?): BridgeMessage? {
        if (raw == null || raw.length > 2_048) return null
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        val id = json.optString("id").takeIf { idPattern.matches(it) } ?: return null
        val request =
            when (json.optString("type")) {
                "hello" -> BridgeRequest.Hello
                "startCamera" ->
                    json.optString("code")
                        .let(::normalizePairingCodeInput)
                        .takeIf(::isValidPairingCode)
                        ?.let(BridgeRequest::StartCamera)
                "openCameraScreen" -> BridgeRequest.OpenCameraScreen
                "setPrivacy" ->
                    if (json.has("enabled") && json.get("enabled") is Boolean) {
                        BridgeRequest.SetPrivacy(json.getBoolean("enabled"))
                    } else {
                        null
                    }
                "disconnectCamera" -> BridgeRequest.DisconnectCamera
                "openUpdate" -> BridgeRequest.OpenUpdate
                else -> null
            } ?: return null
        return BridgeMessage(id, request)
    }

    fun reply(id: String, data: JSONObject = JSONObject()): String =
        JSONObject().put("id", id).put("ok", true).put("data", data).toString()

    fun failure(id: String, error: String): String =
        JSONObject().put("id", id).put("ok", false).put("error", error).toString()

    fun event(name: String, data: JSONObject): String = JSONObject().put("event", name).put("data", data).toString()

    /** What the web app is told about the phone's own camera. */
    fun cameraState(paired: Boolean, runtime: CameraRuntimeState, deviceName: String): JSONObject =
        JSONObject()
            .put("paired", paired)
            .put("running", paired && runtime.cameraEnabled)
            .put("privacy", runtime.privacyMode)
            .put("viewers", runtime.activeViewers)
            .put("online", runtime.device == DeviceLifecycle.Idle || runtime.device == DeviceLifecycle.Online)
            .put("deviceName", deviceName)
}
