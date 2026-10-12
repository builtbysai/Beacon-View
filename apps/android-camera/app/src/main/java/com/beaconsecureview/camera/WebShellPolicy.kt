package com.beaconsecureview.camera

import android.webkit.PermissionRequest
import java.net.URI
import org.json.JSONObject

/**
 * What the web shell (ADR 0121) is allowed to load and to grant. Kept free of Android views so the rules are tested.
 *
 * The WebView hosts exactly one origin, Beacon's own web app. Anything else (a link out, a Google consent screen, a
 * help page) is opened outside it, so a page we do not control never runs inside the view that holds the session.
 * These rules mirror the desktop app's (apps/desktop/src/navigation-policy.ts).
 */
internal object WebShellPolicy {
    /** What to do with a top-level navigation. */
    sealed interface Navigation {
        /** Stays inside the app. */
        data object Load : Navigation

        /** Google refuses OAuth inside embedded views: run it in the system browser with a PKCE hand-off. */
        data class GoogleSignIn(val addPassword: Boolean) : Navigation

        /** Linking Google or connecting Drive needs the session that lives in this view, so it finishes in the browser. */
        data class GoogleInBrowser(val settingsPath: String) : Navigation

        /** Any other web or mail link opens outside. */
        data class External(val url: String) : Navigation

        data object Blocked : Navigation
    }

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

    fun classify(url: String?, appOrigin: String): Navigation {
        if (isAppUrl(url, appOrigin)) {
            val uri = runCatching { URI(url!!) }.getOrNull() ?: return Navigation.Blocked
            return when (uri.path) {
                "/api/auth/google" ->
                    Navigation.GoogleSignIn(addPassword = queryParameter(uri, "intent") == "addPassword")
                "/api/auth/google/link" -> Navigation.GoogleInBrowser("/settings?section=account")
                "/api/drive/connect" -> Navigation.GoogleInBrowser("/settings?section=storage")
                else -> Navigation.Load
            }
        }
        val scheme = runCatching { URI(url ?: return Navigation.Blocked).scheme?.lowercase() }.getOrNull()
        return if (scheme == "https" || scheme == "http" || scheme == "mailto") Navigation.External(url!!) else Navigation.Blocked
    }

    private fun queryParameter(uri: URI, name: String): String? =
        uri.rawQuery?.split('&')?.firstNotNullOfOrNull {
            val (key, value) = (it.split('=', limit = 2) + "").let { parts -> parts[0] to parts[1] }
            if (key == name) value else null
        }

    /** The Google start URL the system browser opens; the server binds the result to [challenge]. */
    fun googleStartUrl(appOrigin: String, challenge: String, addPassword: Boolean): String =
        "$appOrigin/api/auth/google?platform=desktop&challenge=$challenge" + if (addPassword) "&intent=addPassword" else ""

    /** The one-time hand-off the browser returns through `beaconsecureview://auth/desktop`. */
    sealed interface GoogleReturn {
        data class Code(val code: String) : GoogleReturn

        data object Failed : GoogleReturn
    }

    private val handoffCode = Regex("^[A-Za-z0-9_-]{32,512}$")
    private val verifierPattern = Regex("^[A-Za-z0-9_-]{43}$")

    fun parseGoogleReturn(link: String?): GoogleReturn? {
        val uri = runCatching { URI(link ?: return null) }.getOrNull() ?: return null
        if (uri.scheme != "beaconsecureview" || uri.host != "auth" || uri.path != "/desktop") return null
        val code = queryParameter(uri, "code")
        return when {
            code != null && handoffCode.matches(code) -> GoogleReturn.Code(code)
            queryParameter(uri, "status") == "failed" -> GoogleReturn.Failed
            else -> null
        }
    }

    /**
     * The script that redeems the hand-off from inside the Beacon page, so the request is same-origin and the
     * session cookie lands in this view. Both values are validated and JSON-encoded; nothing is interpolated raw.
     */
    fun exchangeScript(code: String, verifier: String): String {
        require(handoffCode.matches(code) && verifierPattern.matches(verifier)) { "Invalid sign-in handoff" }
        val body = JSONObject.quote(JSONObject().put("code", code).put("verifier", verifier).toString())
        // evaluateJavascript does not wait for a promise (it answers "{}" at once), so the answer is parked on the page
        // and read back with EXCHANGE_RESULT_SCRIPT until it arrives.
        return """
            window.__beaconExchange = null;
            fetch('/api/desktop/auth/google', {
              body: $body,
              cache: 'no-store',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json', 'x-beacon-desktop': '1' },
              method: 'POST',
            }).then(
              async (response) => {
                window.__beaconExchange = JSON.stringify({ ok: response.ok, body: await response.json().catch(() => null) });
              },
              () => {
                window.__beaconExchange = JSON.stringify({ ok: false, body: null });
              },
            );
            true;
        """.trimIndent()
    }

    /** Reads what [exchangeScript] parked on the page: the answer, or null while the request is still running. */
    const val EXCHANGE_RESULT_SCRIPT = "window.__beaconExchange || null"

    /** The same-origin path the server chose after a successful exchange, or null (failed, or needs account linking). */
    fun exchangeDestination(result: String?): String? {
        val outer = runCatching { JSONObject(unquote(result)) }.getOrNull() ?: return null
        if (!outer.optBoolean("ok")) return null
        val body = outer.optJSONObject("body") ?: return null
        val path = body.optString("redirect")
        return path.takeIf { it.startsWith("/") && !it.startsWith("//") && !it.contains("\\") }
    }

    fun exchangeNeedsLinking(result: String?): Boolean =
        runCatching { JSONObject(unquote(result)).optJSONObject("body")?.optString("status") == "linkRequired" }.getOrDefault(false)

    // evaluateJavascript hands back a JSON string literal of the promise's string value.
    private fun unquote(result: String?): String =
        result?.let { runCatching { org.json.JSONTokener(it).nextValue() as? String }.getOrNull() } ?: "{}"

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
