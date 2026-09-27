package com.beaconsecureview.camera

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

internal fun friendlyAccessTime(
    value: String,
    zoneId: ZoneId = ZoneId.systemDefault(),
): String =
    runCatching {
        DateTimeFormatter.ofPattern("MMM d, yyyy · h:mm a", Locale.getDefault())
            .withZone(zoneId)
            .format(Instant.parse(value))
    }.getOrElse { value.replace('T', ' ').substringBefore('.').removeSuffix("Z") }

internal fun accessEventTarget(cameraName: String?, deviceName: String?): String =
    listOfNotNull(nullableApiText(cameraName), nullableApiText(deviceName))
        .joinToString(" · ")
        .ifBlank { "Camera device" }

internal fun accessEventActor(
    eventType: String,
    actorEmail: String?,
    currentEmail: String?,
): String? {
    val actor = nullableApiText(actorEmail) ?: return if (eventType.startsWith("live_view_")) null else "On camera device"
    return if (actor.equals(currentEmail, ignoreCase = true)) "By you" else "By $actor"
}

internal fun accessEventLabel(eventType: String): String =
    when (eventType) {
        "live_view_started" -> "Live view started"
        "live_view_rejected" -> "Access rejected"
        "privacy_enabled" -> "Privacy mode enabled"
        "privacy_disabled" -> "Privacy mode disabled"
        "device_credential_revoked" -> "Camera access revoked"
        "camera_source_deleted" -> "Camera deleted"
        "device_deleted", "device_self_removed" -> "Camera device deleted"
        else -> "Camera activity"
    }

internal fun accessEventStatus(eventType: String): String =
    when (eventType) {
        "live_view_started" -> "VIEWED"
        "privacy_enabled" -> "PAUSED"
        "privacy_disabled" -> "RESUMED"
        "live_view_rejected" -> "REVIEW"
        "device_credential_revoked" -> "REVOKED"
        "camera_source_deleted", "device_deleted", "device_self_removed" -> "REMOVED"
        else -> "UPDATED"
    }

internal fun accessEventDetail(eventType: String, reason: String?): String? =
    when (eventType) {
        "live_view_rejected" -> if (reason == "camera_offline") "Camera offline" else "Connection could not be established"
        "privacy_enabled" -> "Capture stopped"
        "privacy_disabled" -> "Camera available again"
        "device_credential_revoked" -> "Pairing required to reconnect"
        "camera_source_deleted" -> "Camera source removed"
        "device_deleted", "device_self_removed" -> "Device and camera sources removed"
        else -> null
    }

internal fun monitorColumnCount(widthDp: Float): Int =
    when {
        widthDp >= 840 -> 3
        widthDp >= 600 -> 2
        else -> 1
    }

internal fun otherViewerCount(viewerCount: Int, connected: Boolean): Int =
    (viewerCount - if (connected) 1 else 0).coerceAtLeast(0)

internal data class MonitorHealth(
    val cameras: Int,
    val online: Int,
    val offline: Int,
    val live: Int,
    val viewers: Int,
)

internal fun monitorHealth(cameras: List<BeaconApi.MonitorCamera>): MonitorHealth =
    MonitorHealth(
        cameras = cameras.size,
        online = cameras.count { it.online },
        offline = cameras.count { !it.online },
        live = cameras.count { it.viewerCount > 0 },
        viewers = cameras.sumOf { it.viewerCount },
    )

internal fun monitorHostCameras(cameras: List<BeaconApi.MonitorCamera>): List<BeaconApi.MonitorCamera> =
    cameras.groupBy { it.deviceId }.values.map { sources ->
        sources.firstOrNull { it.available } ?: sources.first()
    }

internal fun nextCameraSource(
    cameras: List<BeaconApi.MonitorCamera>,
    active: BeaconApi.MonitorCamera,
): BeaconApi.MonitorCamera? {
    val sources = cameras.filter { it.deviceId == active.deviceId }
    if (sources.size < 2) return null
    val activeIndex = sources.indexOfFirst { it.id == active.id }
    val nextIndex = if (activeIndex in sources.indices) (activeIndex + 1) % sources.size else 0
    return sources[nextIndex]
}

internal fun reconciledCameraId(
    previousCameras: List<BeaconApi.MonitorCamera>,
    refreshedCameras: List<BeaconApi.MonitorCamera>,
    selectedCameraId: String?,
): String? {
    val selected = selectedCameraId ?: return null
    val previous = previousCameras.find { it.id == selected }
        ?: return refreshedCameras.find { it.id == selected }?.id
    val refreshedSelection = refreshedCameras.find { it.id == selected }
    val activeSource =
        refreshedCameras
            .filter { it.deviceId == previous.deviceId }
            .firstOrNull { it.available }
    return activeSource?.id ?: refreshedSelection?.id
}

/** Mirrors the PWA's App.tsx `greeting` exactly (time-of-day, no card --
 * the web renders this as a plain h2, not a hero panel). */
internal fun homeGreeting(hour: Int = java.time.LocalTime.now().hour): String =
    when {
        hour < 5 || hour >= 18 -> "Good evening"
        hour < 12 -> "Good morning"
        else -> "Good afternoon"
    }

/** Mirrors the PWA's `subtitle` computation exactly: ready-count phrasing,
 * then an optional privacy-on mention appended only when nothing needs
 * attention (matching the web's own precedence -- attention takes priority
 * over mentioning privacy mode). */
internal fun homeSubtitle(hostCameras: List<BeaconApi.MonitorCamera>): String {
    val readyCount = hostCameras.count { it.online && !it.privacyMode }
    val total = hostCameras.size
    val cameraWord = if (total == 1) "camera" else "cameras"
    val verb = if (total == 1) "is" else "are"
    var subtitle = "$readyCount of $total $cameraWord $verb ready to view."
    val attentionCount = hostCameras.count { !it.privacyMode && !it.online }
    val privacyCount = hostCameras.count { it.privacyMode }
    if (attentionCount == 0 && privacyCount > 0) {
        val hasHave = if (privacyCount == 1) "has" else "have"
        subtitle += " $privacyCount $hasHave privacy on."
    }
    return subtitle
}

/** Cameras needing attention: offline and not deliberately in privacy mode --
 * mirrors the PWA's `attentionCameras` filter exactly. */
internal fun homeAttentionCameras(hostCameras: List<BeaconApi.MonitorCamera>): List<BeaconApi.MonitorCamera> =
    hostCameras.filter { !it.privacyMode && !it.online }

/** Mirrors the PWA's attentionTitle/attentionDesc for the 0/1/many cases.
 * The web additionally distinguishes "needs pairing" from "offline" and a
 * local-browser-camera case for 1 and lists every name for 2-4; Android has
 * no equivalent state to tell those apart yet, so this covers the single-
 * and multi-camera cases with the same general phrasing rather than
 * guessing at a distinction it can't actually verify. */
internal fun homeAttentionTitle(attentionCameras: List<BeaconApi.MonitorCamera>): String =
    if (attentionCameras.size == 1) {
        "${attentionCameras[0].deviceName} needs attention"
    } else {
        "${attentionCameras.size} cameras need attention"
    }

internal fun homeAttentionDescription(attentionCameras: List<BeaconApi.MonitorCamera>): String =
    if (attentionCameras.size == 1) {
        "Camera is offline. Reconnect it to restore live viewing."
    } else {
        "Multiple cameras are offline or need to be reconnected."
    }

/** Mirrors the PWA's favorites fallback: the first four host cameras when
 * nothing has been explicitly favorited yet. */
internal fun homeFavoriteCameras(
    hostCameras: List<BeaconApi.MonitorCamera>,
    favoriteCameraIds: Set<String>,
): List<BeaconApi.MonitorCamera> =
    if (favoriteCameraIds.isEmpty()) hostCameras.take(4) else hostCameras.filter { it.id in favoriteCameraIds }

internal fun monitorVisibleCameras(
    cameras: List<BeaconApi.MonitorCamera>,
    favoriteCameraIds: Set<String>,
    favoritesOnly: Boolean,
): List<BeaconApi.MonitorCamera> =
    cameras.filter { !favoritesOnly || it.id in favoriteCameraIds }

internal fun shouldRunNativeViewer(lifecycleStarted: Boolean): Boolean = lifecycleStarted
