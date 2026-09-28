package com.beaconsecureview.camera

import java.time.Instant
import java.util.Locale

/** Mirrors the PWA's `naming.ts` `deviceKindLabel`: "Android phone",
 * "Browser laptop", or just "Android" when platform and type are the same. */
internal fun deviceKindLabel(platform: String, deviceType: String): String {
    fun capitalize(value: String) = value.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.getDefault()) else it.toString() }
    return if (platform == deviceType) capitalize(platform) else "${capitalize(platform)} $deviceType"
}

/** Mirrors the PWA's `device-presentation.ts` `relativeLastSeen` exactly. */
internal fun relativeLastSeen(value: String?, now: Instant = Instant.now()): String {
    if (value == null) return "Never"
    val observedAt = runCatching { Instant.parse(value) }.getOrNull() ?: return "Never"
    val elapsedMs = now.toEpochMilli() - observedAt.toEpochMilli()
    return when {
        elapsedMs < 60_000 -> "Just now"
        elapsedMs < 3_600_000 -> "${elapsedMs / 60_000} min ago"
        elapsedMs < 86_400_000 -> "${elapsedMs / 3_600_000} hr ago"
        else ->
            java.time.format.DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.getDefault())
                .withZone(java.time.ZoneId.systemDefault())
                .format(observedAt)
    }
}

/** Mirrors the PWA's `device-presentation.ts` `capabilitySummary` exactly:
 * every capability whose value isn't literally `false` is listed, `true`
 * values show just the (underscore-replaced) key, other values show
 * `key: value`. */
internal fun capabilitySummary(capabilities: Map<String, Any?>): String {
    if (capabilities.isEmpty()) return "Standard video"
    val parts =
        capabilities.entries
            .filter { (_, value) -> value != false }
            .map { (key, value) ->
                val label = key.replace('_', ' ')
                if (value == true) label else "$label: $value"
            }
    return if (parts.isEmpty()) "Standard video" else parts.joinToString(" · ")
}

internal data class DeviceGuidance(
    val attention: Boolean,
    val title: String,
    val summary: String,
    val steps: List<String>,
)

/** Verbatim port of the PWA's `device-guidance.ts` `deviceGuidance`. */
internal fun deviceGuidance(
    cameraCount: Int,
    enabled: Boolean,
    online: Boolean,
    platform: String,
    privacyMode: Boolean,
    revoked: Boolean,
): DeviceGuidance {
    if (revoked) {
        return DeviceGuidance(
            attention = true,
            title = "Pair this device again",
            summary = "Its access was revoked, so it cannot reconnect with the old pairing.",
            steps =
                listOf(
                    "Create a fresh one-time setup link from Add camera.",
                    if (platform == "android") {
                        "Open Beacon on the camera phone and complete pairing with the new link or code."
                    } else {
                        "Return to Browser Camera Mode in the attended browser and register its sources again."
                    },
                ),
        )
    }
    if (!enabled) {
        return DeviceGuidance(
            attention = true,
            title = "Pairing is disabled",
            summary = "Beacon won't accept camera connections from this device until it's paired again.",
            steps =
                listOf(
                    "Confirm that this is the device you intend to restore.",
                    "Create a fresh one-time setup link from Add camera and pair the device again.",
                ),
        )
    }
    if (privacyMode) {
        return DeviceGuidance(
            attention = true,
            title = "Privacy mode is blocking live view",
            summary =
                "Live viewing is blocked. A remote privacy change stops capture when the device receives it; the camera device is the source of truth for immediate local shutdown.",
            steps =
                if (platform == "android") {
                    listOf(
                        "Use the privacy control on the camera phone for an immediate local change.",
                        if (online) {
                            "When you are ready, turn privacy off here or on the camera phone and confirm the visible Camera Mode indicator returns."
                        } else {
                            "Bring the phone online before relying on a remote change; queued state cannot prove that offline hardware has applied it."
                        },
                    )
                } else {
                    listOf(
                        "Return to the attended Browser Camera Mode tab.",
                        "Start Camera Mode again only when visible capture is intended.",
                    )
                },
        )
    }
    if (!online) {
        if (platform == "browser") {
            return DeviceGuidance(
                attention = true,
                title = "Browser camera is paused",
                summary = "A browser camera is available only while Camera mode is open in that browser.",
                steps =
                    listOf(
                        "Open Add camera on that computer and choose Use this browser.",
                        "Allow camera access and leave Camera mode open while you want to share.",
                    ),
            )
        }
        return DeviceGuidance(
            attention = true,
            title = "Bring this device back online",
            summary = "Beacon has no current connection to this device and cannot inspect its local power, network, or permission state.",
            steps =
                listOf(
                    "Connect the phone to power and a working Wi-Fi or cellular network.",
                    "Open Beacon and confirm Camera Mode is running with its persistent notification.",
                    "If it stays offline, check Android camera and notification permissions.",
                ),
        )
    }
    if (cameraCount == 0) {
        return DeviceGuidance(
            attention = true,
            title = "Finish camera setup",
            summary = "The device is connected, but it has not reported a camera that can be viewed.",
            steps =
                listOf(
                    if (platform == "android") {
                        "Open Camera Mode on the device and allow camera permission when Android asks."
                    } else {
                        "Open Browser Camera Mode, allow camera access, and choose a camera."
                    },
                    "Keep the setup screen visible until the camera appears here.",
                ),
        )
    }
    return DeviceGuidance(
        attention = false,
        title = "Keep this camera ready",
        summary = "The device is connected and has a working camera. Beacon still depends on its local permissions, power, and network.",
        steps =
            if (platform == "android") {
                listOf(
                    "Keep Camera Mode running with its persistent notification visible.",
                    "Use continuous power for longer sessions and check the phone if this status becomes stale.",
                )
            } else {
                listOf(
                    "Keep the attended Camera Mode tab visible while capture is intended.",
                    "Browsers may pause capture or networking when the tab or device sleeps.",
                )
            },
    )
}

internal data class DeviceAttentionNotice(
    val title: String,
    val summary: String,
    val steps: List<String>,
    val showReconnect: Boolean,
    val detailsLabel: String,
)

/** Mirrors CameraSettings.tsx's `(needsReconnect || warning || guidance.attention)`
 * gate and its title/summary precedence (needsReconnect > low-battery
 * warning > general guidance), while still surfacing `guidance.steps` under
 * a "Troubleshoot"/"Readiness tips" disclosure exactly as the PWA does. */
internal fun deviceAttentionNotice(
    device: BeaconApi.Device,
    cameraCount: Int,
    canReconnect: Boolean,
): DeviceAttentionNotice? {
    val needsReconnect = canReconnect && device.canRemove && device.platform == "android" && (!device.online || device.revoked)
    val warning =
        if (device.online && device.enabled && !device.revoked && !device.privacyMode &&
            device.batteryPercent != null && device.batteryPercent <= 15 && !device.batteryCharging
        ) {
            "Battery is low. Connect this camera to power to keep it available."
        } else {
            null
        }
    val guidance = deviceGuidance(cameraCount, device.enabled, device.online, device.platform, device.privacyMode, device.revoked)
    if (!needsReconnect && warning == null && !guidance.attention) return null
    return DeviceAttentionNotice(
        title = if (needsReconnect) "This camera needs to reconnect" else warning?.let { "Camera needs attention" } ?: guidance.title,
        summary =
            if (needsReconnect) {
                "Beacon cannot currently reach this phone. Reconnect it without deleting its settings."
            } else {
                warning ?: guidance.summary
            },
        steps = guidance.steps,
        showReconnect = needsReconnect,
        detailsLabel = if (guidance.attention) "Troubleshoot" else "Readiness tips",
    )
}

/** Mirrors CameraSettings.tsx's inline `connectionLabel`/`healthy`. */
internal fun deviceConnectionLabel(device: BeaconApi.Device): String =
    when {
        device.privacyMode -> "Privacy mode on"
        device.revoked -> "Access revoked"
        !device.enabled -> "Pairing disabled"
        device.online -> "Online"
        else -> "Offline"
    }

internal fun deviceIsHealthy(device: BeaconApi.Device): Boolean =
    device.online && device.enabled && !device.privacyMode && !device.revoked
