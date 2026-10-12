package com.beaconsecureview.camera

import android.webkit.PermissionRequest
import java.net.URI

/**
 * What the web shell (ADR 0121) is allowed to load and to grant. Kept free of Android views so the rules are tested.
 *
 * The WebView hosts exactly one origin, Beacon's own web app. Anything else (a link out, a Google consent screen, a
 * help page) is opened outside it, so a page we do not control never runs inside the view that holds the session.
 */
internal object WebShellPolicy {
    /** scheme://host[:port] of [url], lowercased, or null when it is not a plain web URL. */
    fun originOf(url: String?): String? {
        val uri = runCatching { URI(url ?: return null) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "https" && scheme != "http") return null
        val host = uri.host?.lowercase() ?: return null
        if (uri.userInfo != null) return null
        val defaultPort = if (scheme == "https") 443 else 80
        val port = if (uri.port == -1 || uri.port == defaultPort) "" else ":${uri.port}"
        return "$scheme://$host$port"
    }

    /** Is [url] a page of the web app at [appOrigin]? A look-alike host or a different scheme or port is not. */
    fun isAppUrl(url: String?, appOrigin: String): Boolean {
        val origin = originOf(url) ?: return false
        return origin == originOf(appOrigin)
    }

    /**
     * The resources to give a web page that asked for [requested]: only camera or microphone, only for the app
     * origin, and only when Android itself already allows the app that resource. Never "everything the page asked
     * for", because a future WebView may add resources nobody reviewed.
     */
    fun resourcesToGrant(
        requested: Array<String>,
        requestOrigin: String?,
        appOrigin: String,
        cameraAllowed: Boolean,
        microphoneAllowed: Boolean,
    ): List<String> {
        if (originOf(requestOrigin) != originOf(appOrigin)) return emptyList()
        return requested.filter {
            (it == PermissionRequest.RESOURCE_VIDEO_CAPTURE && cameraAllowed) ||
                (it == PermissionRequest.RESOURCE_AUDIO_CAPTURE && microphoneAllowed)
        }
    }

    /** The Android runtime permissions a web page's request would need, so the shell can ask for them. */
    fun androidPermissionsFor(requested: Array<String>): List<String> =
        requested.mapNotNull {
            when (it) {
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> android.Manifest.permission.CAMERA
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> android.Manifest.permission.RECORD_AUDIO
                else -> null
            }
        }.distinct()
}
