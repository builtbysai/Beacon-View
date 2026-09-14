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
        "live_view_started", "privacy_disabled" -> "READY"
        "live_view_rejected", "device_credential_revoked" -> "REVIEW"
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

internal fun homeHeadline(cameras: List<BeaconApi.MonitorCamera>): String =
    when {
        cameras.isEmpty() -> "Set up your first camera"
        cameras.any { !it.online || it.privacyMode } -> "A camera needs your attention"
        cameras.any { it.viewerCount > 0 } -> "Your cameras are being viewed"
        else -> "Your home is within reach"
    }

internal fun homeSupportingText(cameras: List<BeaconApi.MonitorCamera>): String =
    when {
        cameras.isEmpty() -> "Pair a spare Android phone or tablet to begin."
        cameras.any { !it.online || it.privacyMode } -> "Review what needs attention."
        else -> "Every camera is ready when you need it."
    }

internal fun monitorVisibleCameras(
    cameras: List<BeaconApi.MonitorCamera>,
    favoriteCameraIds: Set<String>,
    favoritesOnly: Boolean,
): List<BeaconApi.MonitorCamera> =
    cameras.filter { !favoritesOnly || it.id in favoriteCameraIds }

internal fun shouldRunNativeViewer(lifecycleStarted: Boolean): Boolean = lifecycleStarted
