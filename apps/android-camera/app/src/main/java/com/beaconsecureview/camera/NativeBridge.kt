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

        /** Pairs this phone as a camera with a code the signed-in web app created, then shows the camera screen. */
        fun startCamera(code: String)

        fun openCameraScreen()

        fun setPrivacy(enabled: Boolean)

        fun disconnectCamera()

        fun openUpdate()
    }

    /** The reply to send back, or null when [raw] was not a message of ours (it is ignored, never answered). */
    fun handle(raw: String?): String? {
        val message = NativeBridgeProtocol.parse(raw) ?: return null
        val id = message.id
        return when (val request = message.request) {
            BridgeRequest.Hello ->
                NativeBridgeProtocol.reply(
                    id,
                    JSONObject()
                        .put("app", "android")
                        .put("version", host.appVersion)
                        .put("camera", host.cameraState()),
                )
            is BridgeRequest.StartCamera -> run { host.startCamera(request.code); NativeBridgeProtocol.reply(id) }
            BridgeRequest.OpenCameraScreen -> run { host.openCameraScreen(); NativeBridgeProtocol.reply(id) }
            is BridgeRequest.SetPrivacy -> run { host.setPrivacy(request.enabled); NativeBridgeProtocol.reply(id) }
            BridgeRequest.DisconnectCamera -> run { host.disconnectCamera(); NativeBridgeProtocol.reply(id) }
            BridgeRequest.OpenUpdate -> run { host.openUpdate(); NativeBridgeProtocol.reply(id) }
        }
    }
}
