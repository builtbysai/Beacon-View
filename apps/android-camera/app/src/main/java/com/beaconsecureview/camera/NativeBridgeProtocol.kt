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

    /** Turn Firebase on and hand back the token, so the web app can register this phone for alerts. */
    data object EnablePush : BridgeRequest

    /** The web app registered the token with the account; remember that alerts are on. */
    data class PushEnabled(val subscriptionId: String) : BridgeRequest

    /** Turn alerts off on this phone; the answer carries the subscription id for the web app to remove. */
    data object DisablePush : BridgeRequest

    /** Start saving a file the page made (a decrypted clip, a snapshot) to the Downloads folder; the answer is a token. */
    data class SaveFileStart(val name: String, val mime: String) : BridgeRequest

    /** One piece of that file, base64. */
    data class SaveFileChunk(val token: String, val data: String) : BridgeRequest

    /** The file is complete. */
    data class SaveFileEnd(val token: String) : BridgeRequest
}

internal data class BridgeMessage(val id: String, val request: BridgeRequest)

internal object NativeBridgeProtocol {
    private val idPattern = Regex("^[A-Za-z0-9_.:-]{1,64}$")
    private val subscriptionIdPattern = Regex("^[A-Za-z0-9_-]{8,64}$")
    private val tokenPattern = Regex("^[0-9a-f-]{36}$")
    private const val MAX_MESSAGE = 2_048
    private const val MAX_CHUNK_MESSAGE = SaveRules.MAX_CHUNK_BASE64 + 1_024

    /** A validated message, or null when it is not one of ours. Never throws. */
    fun parse(raw: String?): BridgeMessage? {
        // Every message is tiny except a piece of a saved file, so only that type may be large.
        if (raw == null || raw.length > MAX_CHUNK_MESSAGE) return null
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        val id = json.optString("id").takeIf { idPattern.matches(it) } ?: return null
        val type = json.optString("type")
        if (type != "saveFileChunk" && raw.length > MAX_MESSAGE) return null
        val request =
            when (type) {
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
                "enablePush" -> BridgeRequest.EnablePush
                "pushEnabled" ->
                    json.optString("subscriptionId")
                        .takeIf { subscriptionIdPattern.matches(it) }
                        ?.let(BridgeRequest::PushEnabled)
                "disablePush" -> BridgeRequest.DisablePush
                "saveFileStart" ->
                    json.optString("name").takeIf { it.isNotBlank() && it.length <= 255 }?.let {
                        BridgeRequest.SaveFileStart(it, json.optString("mime"))
                    }
                "saveFileChunk" ->
                    json.optString("token").takeIf { tokenPattern.matches(it) }?.let { token ->
                        json.optString("data").takeIf { it.isNotEmpty() && it.length <= SaveRules.MAX_CHUNK_BASE64 }
                            ?.let { BridgeRequest.SaveFileChunk(token, it) }
                    }
                "saveFileEnd" ->
                    json.optString("token").takeIf { tokenPattern.matches(it) }?.let(BridgeRequest::SaveFileEnd)
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
