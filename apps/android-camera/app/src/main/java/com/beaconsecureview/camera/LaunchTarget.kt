package com.beaconsecureview.camera

import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Where an entry point sends the person (ADR 0095, ADR 0121): an alert opens the camera or the activity it was about,
 * a shortcut opens a camera. The app is the web app, so a target is just a page of it. Ids are checked here (a UUID
 * and nothing else) before they are put into a URL; nothing else in an intent is trusted.
 */
internal object LaunchLinks {
    private val ID =
        Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)

    /** The web app's page for a camera, or null for an id that is not a UUID. */
    fun cameraUrl(webBase: String, cameraId: String): String? =
        cameraId.takeIf { ID.matches(it) }?.let { "${webBase.trimEnd('/')}/cameras/$it" }

    /** The web app resolves an alert (as the signed-in person) to the camera or page it was about (ADR 0090). */
    fun alertUrl(webBase: String, eventId: String): String? =
        eventId.takeIf { ID.matches(it) }?.let { "${webBase.trimEnd('/')}/activity?alert=$it" }

    fun cameraIntent(context: Context, cameraId: String): Intent? =
        cameraUrl(BuildConfig.BEACON_WEB_URL, cameraId)?.let { open(context, it) }

    fun alertIntent(context: Context, eventId: String): Intent? =
        alertUrl(BuildConfig.BEACON_WEB_URL, eventId)?.let { open(context, it) }

    private fun open(context: Context, url: String): Intent =
        Intent(context, WebShellActivity::class.java)
            .setData(Uri.parse(url))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
}
