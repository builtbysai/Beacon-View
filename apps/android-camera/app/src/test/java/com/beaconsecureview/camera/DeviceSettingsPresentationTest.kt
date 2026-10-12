package com.beaconsecureview.camera

import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private fun device(
    id: String = "dev-1",
    name: String = "Pixel",
    platform: String = "android",
    deviceType: String = "phone",
    enabled: Boolean = true,
    privacyMode: Boolean = false,
    revoked: Boolean = false,
    online: Boolean = true,
    connectionState: String = "connected",
    lastSeenAt: String? = "2026-09-27T12:00:00Z",
    healthReportedAt: String? = "2026-09-27T12:00:00Z",
    softwareVersion: String? = "1.0.0",
    batteryPercent: Int? = 80,
    batteryCharging: Boolean = false,
    canRemove: Boolean = true,
    capabilities: Map<String, Any?> = emptyMap(),
): BeaconApi.Device =
    BeaconApi.Device(
        id = id,
        name = name,
        platform = platform,
        deviceType = deviceType,
        enabled = enabled,
        privacyMode = privacyMode,
        revoked = revoked,
        online = online,
        connectionState = connectionState,
        lastSeenAt = lastSeenAt,
        healthReportedAt = healthReportedAt,
        softwareVersion = softwareVersion,
        batteryPercent = batteryPercent,
        batteryCharging = batteryCharging,
        canRemove = canRemove,
        capabilities = capabilities,
    )

class DeviceSettingsPresentationTest {
    @Test
    fun deviceKindLabelCombinesPlatformAndTypeUnlessIdentical() {
        assertEquals("Android phone", deviceKindLabel("android", "phone"))
        assertEquals("Browser laptop", deviceKindLabel("browser", "laptop"))
        assertEquals("Android", deviceKindLabel("android", "android"))
    }

    @Test
    fun relativeLastSeenBucketsElapsedTime() {
        val now = Instant.parse("2026-09-27T12:00:00Z")
        assertEquals("Never", relativeLastSeen(null, now))
        assertEquals("Just now", relativeLastSeen(now.minusSeconds(10).toString(), now))
        assertEquals("5 min ago", relativeLastSeen(now.minusSeconds(300).toString(), now))
        assertEquals("2 hr ago", relativeLastSeen(now.minusSeconds(7_200).toString(), now))
    }

    @Test
    fun capabilitySummaryFiltersFalseAndFormatsTrueVsOtherValues() {
        assertEquals("Standard video", capabilitySummary(emptyMap()))
        assertEquals(
            "zoom · max resolution: 4k",
            capabilitySummary(mapOf("zoom" to true, "night_vision" to false, "max_resolution" to "4k")),
        )
        assertEquals("Standard video", capabilitySummary(mapOf("zoom" to false)))
    }

    @Test
    fun deviceGuidancePrioritizesRevokedOverEverythingElse() {
        val guidance = deviceGuidance(cameraCount = 1, enabled = false, online = false, platform = "android", privacyMode = true, revoked = true)
        assertEquals("Pair this device again", guidance.title)
        assertEquals(true, guidance.attention)
    }

    @Test
    fun deviceGuidanceHealthyCaseIsNotAttention() {
        val guidance = deviceGuidance(cameraCount = 1, enabled = true, online = true, platform = "android", privacyMode = false, revoked = false)
        assertEquals("Keep this camera ready", guidance.title)
        assertEquals(false, guidance.attention)
    }

    @Test
    fun deviceGuidanceCameraCountZeroMeansFinishSetup() {
        val guidance = deviceGuidance(cameraCount = 0, enabled = true, online = true, platform = "android", privacyMode = false, revoked = false)
        assertEquals("Finish camera setup", guidance.title)
    }

    @Test
    fun deviceAttentionNoticeReturnsNullWhenHealthyWithNoWarning() {
        assertNull(deviceAttentionNotice(device(), cameraCount = 1, canReconnect = true))
    }

    @Test
    fun deviceAttentionNoticePrioritizesReconnectOverWarningAndGuidance() {
        val notice = deviceAttentionNotice(
            device(online = false, batteryPercent = 5),
            cameraCount = 1,
            canReconnect = true,
        )
        assertEquals("This camera needs to reconnect", notice?.title)
        assertEquals(true, notice?.showReconnect)
    }

    @Test
    fun deviceAttentionNoticeShowsBatteryWarningWhenOnlineButLow() {
        val notice = deviceAttentionNotice(
            device(batteryPercent = 10, batteryCharging = false),
            cameraCount = 1,
            canReconnect = true,
        )
        assertEquals("Camera needs attention", notice?.title)
        assertEquals(false, notice?.showReconnect)
    }

    @Test
    fun deviceConnectionLabelPrioritizesPrivacyThenRevokedThenDisabledThenOnlineState() {
        assertEquals("Privacy mode on", deviceConnectionLabel(device(privacyMode = true, revoked = true, enabled = false, online = false)))
        assertEquals("Access revoked", deviceConnectionLabel(device(revoked = true, enabled = false, online = false)))
        assertEquals("Pairing disabled", deviceConnectionLabel(device(enabled = false, online = false)))
        assertEquals("Online", deviceConnectionLabel(device(online = true)))
        assertEquals("Offline", deviceConnectionLabel(device(online = false)))
    }

    @Test
    fun deviceIsHealthyRequiresOnlineEnabledNotPrivacyNotRevoked() {
        assertEquals(true, deviceIsHealthy(device()))
        assertEquals(false, deviceIsHealthy(device(online = false)))
        assertEquals(false, deviceIsHealthy(device(privacyMode = true)))
        assertEquals(false, deviceIsHealthy(device(revoked = true)))
    }
}

class SessionDeviceLabelTest {
    @kotlin.test.Test
    fun namesTheAppAndBrowsersInsteadOfShowingTheRawUserAgent() {
        kotlin.test.assertEquals("Beacon for Android", sessionDeviceLabel("Dalvik/2.1.0 (Linux; U; Android 16; sdk_gphone64_x86_64 Build/BP22)"))
        kotlin.test.assertEquals(
            "Chrome on Windows",
            sessionDeviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"),
        )
        kotlin.test.assertEquals("Signed-in device", sessionDeviceLabel("Unknown device"))
    }
}
