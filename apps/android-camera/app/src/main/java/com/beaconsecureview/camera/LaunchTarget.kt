package com.beaconsecureview.camera

import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Where an entry point sends the person (ADR 0095, ADR 0121): an alert opens the camera or the activity it was about,
 * a launcher shortcut opens Cameras or Activity. The app is the web app, so a target is just a page of it. Ids are checked here (a UUID
 * and nothing else) before they are put into a URL; nothing else in an intent is trusted.
 */
internal object LaunchLinks {
    private val ID =
        Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)

    /** The page a launcher shortcut names (`cameras` or `activity`), or null for anything else. */
    fun pageUrl(webBase: String, page: String?): String? =
        when (page) {
            "cameras" -> "/cameras"
            "activity" -> "/activity"
            else -> null
        }?.let { webBase.trimEnd('/') + it }

    /** The web app resolves an alert (as the signed-in person) to the camera or page it was about (ADR 0090). */
    fun alertUrl(webBase: String, eventId: String): String? =
        eventId.takeIf { ID.matches(it) }?.let { "${webBase.trimEnd('/')}/activity?alert=$it" }

    fun alertIntent(context: Context, eventId: String): Intent? =
        alertUrl(BuildConfig.BEACON_WEB_URL, eventId)?.let { open(context, it) }

    private fun open(context: Context, url: String): Intent =
        Intent(context, WebShellActivity::class.java)
            .setData(Uri.parse(url))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
}
