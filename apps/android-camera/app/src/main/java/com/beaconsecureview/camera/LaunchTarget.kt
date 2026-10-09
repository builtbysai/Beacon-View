package com.beaconsecureview.camera

import android.content.Context
import android.content.Intent

/**
 * Where an entry point sends the person (ADR 0095): an alert opens the camera it was about
 * (ADR 0090), a launcher shortcut opens a camera or a page directly. The target is parsed from a
 * handful of known intent extras and checked again here; nothing else in an intent is trusted.
 */
internal sealed interface LaunchTarget {
    val receivedAtMillis: Long

    data class OpenCamera(val cameraId: String, override val receivedAtMillis: Long) : LaunchTarget

    /** Resolved through the server, as the signed-in user, to the camera the alert was about. */
    data class OpenAlert(val eventId: String, override val receivedAtMillis: Long) : LaunchTarget

    data class OpenPage(val page: MonitorPage, override val receivedAtMillis: Long) : LaunchTarget
}

internal object LaunchIntents {
    const val ACTION_OPEN_CAMERA = "com.beaconsecureview.camera.action.OPEN_CAMERA"
    const val ACTION_OPEN_PAGE = "com.beaconsecureview.camera.action.OPEN_PAGE"
    const val ACTION_OPEN_ALERT = "com.beaconsecureview.camera.action.OPEN_ALERT"
    const val EXTRA_CAMERA_ID = "beacon_camera_id"
    const val EXTRA_EVENT_ID = "beacon_event_id"
    const val EXTRA_PAGE = "beacon_page"

    /** A target nobody got to (still signed out, still loading) stops applying after this. */
    const val FRESH_MILLIS = 2 * 60 * 1_000L

    private val ID =
        Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)

    private val PAGES =
        mapOf(
            "home" to MonitorPage.Home,
            "cameras" to MonitorPage.Cameras,
            "activity" to MonitorPage.Events,
            "settings" to MonitorPage.Settings,
        )

    fun parse(action: String?, extra: (String) -> String?, nowMillis: Long): LaunchTarget? =
        when (action) {
            ACTION_OPEN_CAMERA ->
                extra(EXTRA_CAMERA_ID)?.takeIf { ID.matches(it) }
                    ?.let { LaunchTarget.OpenCamera(it, nowMillis) }
            ACTION_OPEN_ALERT ->
                extra(EXTRA_EVENT_ID)?.takeIf { ID.matches(it) }
                    ?.let { LaunchTarget.OpenAlert(it, nowMillis) }
            ACTION_OPEN_PAGE ->
                extra(EXTRA_PAGE)?.let { PAGES[it] }?.let { LaunchTarget.OpenPage(it, nowMillis) }
            else -> null
        }

    fun parse(intent: Intent?, nowMillis: Long = System.currentTimeMillis()): LaunchTarget? =
        intent?.let { parse(it.action, { key -> it.getStringExtra(key) }, nowMillis) }

    fun isFresh(target: LaunchTarget, nowMillis: Long): Boolean =
        nowMillis - target.receivedAtMillis in 0..FRESH_MILLIS

    fun cameraIntent(context: Context, cameraId: String): Intent =
        Intent(context, MainActivity::class.java)
            .setAction(ACTION_OPEN_CAMERA)
            .putExtra(EXTRA_CAMERA_ID, cameraId)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)

    fun alertIntent(context: Context, eventId: String): Intent =
        Intent(context, MainActivity::class.java)
            .setAction(ACTION_OPEN_ALERT)
            .putExtra(EXTRA_EVENT_ID, eventId)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
}

/** What to do with a target once the cameras are known. */
internal sealed interface LaunchResolution {
    data class Watch(val cameraId: String) : LaunchResolution

    data class Show(val page: MonitorPage) : LaunchResolution
}

/** A camera opens live when the person can see it; otherwise the Cameras page (or Activity for an alert). */
internal fun resolveLaunch(
    target: LaunchTarget,
    cameraIds: Collection<String>,
    alertCameraId: String?,
): LaunchResolution =
    when (target) {
        is LaunchTarget.OpenPage -> LaunchResolution.Show(target.page)
        is LaunchTarget.OpenCamera ->
            if (target.cameraId in cameraIds) {
                LaunchResolution.Watch(target.cameraId)
            } else {
                LaunchResolution.Show(MonitorPage.Cameras)
            }
        is LaunchTarget.OpenAlert ->
            if (alertCameraId != null && alertCameraId in cameraIds) {
                LaunchResolution.Watch(alertCameraId)
            } else {
                LaunchResolution.Show(MonitorPage.Events)
            }
    }
