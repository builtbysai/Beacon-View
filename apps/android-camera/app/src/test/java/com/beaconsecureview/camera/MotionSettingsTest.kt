package com.beaconsecureview.camera

import java.nio.ByteBuffer
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MotionSettingsTest {
    @Test
    fun quietHoursUseTheConfiguredIanaZoneAndCrossMidnight() {
        val quiet = QuietHours("22:00", "07:00", "America/New_York")
        assertTrue(quiet.isActive(java.time.Instant.parse("2026-09-06T04:30:00Z")))
        assertFalse(quiet.isActive(java.time.Instant.parse("2026-09-06T16:30:00Z")))
        assertFailsWith<IllegalArgumentException> { QuietHours("22:00", "22:00", "America/New_York") }
    }

    @Test
    fun quietHoursResetTheLocalDetectorAndSuppressEvents() {
        val detector = ConfiguredMotionDetector()
        val settings = MotionSettings(quietHours = QuietHours("22:00", "07:00", "America/New_York"))
        val image = ByteBuffer.wrap(ByteArray(16 * 12) { 100 })
        assertNull(detector.analyze(settings, image, 16, 1, 16, 12, 0, java.time.Instant.parse("2026-09-06T04:30:00Z")))
        assertNull(detector.analyze(settings, image, 16, 1, 16, 12, 1_000_000_000L, java.time.Instant.parse("2026-09-06T16:30:00Z")))
    }
    private val dark = ByteBuffer.wrap(ByteArray(16 * 12) { 10 })
    private val subtle = ByteBuffer.wrap(ByteArray(16 * 12) { if (it < 24) 35 else 10 })
    private val large = ByteBuffer.wrap(ByteArray(16 * 12) { if (it < 96) 100 else 10 })
    private fun analyze(detector: ConfiguredMotionDetector, settings: MotionSettings, plane: ByteBuffer, second: Long) =
        detector.analyze(settings, plane, 16, 1, 16, 12, second * 1_000_000_000L)

    @Test
    fun sensitivityChangesResetBaselineAndDetectSmallerChangesOnlyOnHigh() {
        val detector = ConfiguredMotionDetector()
        val medium = MotionSettings()
        assertNull(analyze(detector, medium, dark, 0))
        assertNull(analyze(detector, medium, subtle, 1))
        val high = medium.copy(sensitivity = MotionSensitivity.High)
        assertNull(analyze(detector, high, dark, 2))
        assertNotNull(analyze(detector, high, subtle, 3))
        val low = medium.copy(sensitivity = MotionSensitivity.Low)
        assertNull(analyze(detector, low, dark, 4))
        assertNull(analyze(detector, low, subtle, 5))
        assertNotNull(analyze(detector, low, large, 6))
    }

    @Test
    fun disablingSkipsReadingPixelsAndReenablingStartsWithANewBaseline() {
        val detector = ConfiguredMotionDetector()
        val settings = MotionSettings()
        assertNull(analyze(detector, settings, dark, 0))
        assertNotNull(analyze(detector, settings, large, 1))
        assertNull(analyze(detector, settings.copy(enabled = false), ByteBuffer.allocate(0), 2))
        assertNull(analyze(detector, settings, dark, 3))
        assertNotNull(analyze(detector, settings, large, 4))
    }

    @Test
    fun selectedCooldownControlsTheNextEventBoundary() {
        val detector = ConfiguredMotionDetector()
        val settings = MotionSettings(cooldownSeconds = 120)
        assertNull(analyze(detector, settings, dark, 0))
        assertNotNull(analyze(detector, settings, large, 1))
        assertNull(analyze(detector, settings, dark, 120))
        assertNotNull(analyze(detector, settings, large, 121))
        assertFailsWith<IllegalArgumentException> { MotionSettings(cooldownSeconds = 0) }
    }
}
