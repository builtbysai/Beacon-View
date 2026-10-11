package com.beaconsecureview.camera

import java.nio.ByteBuffer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class MotionDetectorTest {
    @Test
    fun detectsMeaningfulChangeAndAppliesCooldown() {
        val detector = MotionDetector(sampleIntervalNanos = 0, cooldownNanos = 30)
        val dark = ByteBuffer.wrap(ByteArray(16 * 12) { 10 })
        val changed = ByteBuffer.wrap(ByteArray(16 * 12) { if (it < 48) 100 else 10 })

        assertNull(detector.analyze(dark, 16, 1, 16, 12, 1))
        assertNotNull(detector.analyze(changed, 16, 1, 16, 12, 2))
        assertNull(detector.analyze(dark, 16, 1, 16, 12, 3))
        assertNotNull(detector.analyze(changed, 16, 1, 16, 12, 33))
    }

    @Test
    fun ignoresSmallLightingNoise() {
        val detector = MotionDetector(sampleIntervalNanos = 0, cooldownNanos = 0)
        val first = ByteBuffer.wrap(ByteArray(16 * 12) { 100.toByte() })
        val second = ByteBuffer.wrap(ByteArray(16 * 12) { 110.toByte() })
        assertNull(detector.analyze(first, 16, 1, 16, 12, 1))
        assertNull(detector.analyze(second, 16, 1, 16, 12, 2))
        assertEquals(0, first.position())
    }

    @Test
    fun ignoresAWholePictureBrightnessJump() {
        val detector = MotionDetector(sampleIntervalNanos = 0, cooldownNanos = 0)
        val before = ByteBuffer.wrap(ByteArray(16 * 12) { 60 })
        // Auto-exposure or an IR-cut switch: every sample jumps by far more than the threshold.
        val after = ByteBuffer.wrap(ByteArray(16 * 12) { 140.toByte() })
        assertNull(detector.analyze(before, 16, 1, 16, 12, 1))
        assertNull(detector.analyze(after, 16, 1, 16, 12, 2))
    }

    @Test
    fun stillSeesMovementDuringABrightnessShift() {
        val detector = MotionDetector(sampleIntervalNanos = 0, cooldownNanos = 0)
        val before = ByteBuffer.wrap(ByteArray(16 * 12) { 60 })
        // The whole picture brightens by 40 and a person also darkens a quarter of it.
        val after = ByteBuffer.wrap(ByteArray(16 * 12) { if (it < 48) 10 else 100 })
        assertNull(detector.analyze(before, 16, 1, 16, 12, 1))
        assertNotNull(detector.analyze(after, 16, 1, 16, 12, 2))
    }

    @Test
    fun turningThePhoneStartsAFreshBaselineInsteadOfAlerting() {
        val detector = MotionDetector(sampleIntervalNanos = 0, cooldownNanos = 0)
        val upright = ByteBuffer.wrap(ByteArray(16 * 12) { if (it % 16 < 8) 20 else 200.toByte() })
        val turned = ByteBuffer.wrap(ByteArray(16 * 12) { if (it % 16 < 8) 200.toByte() else 20 })
        assertNull(detector.analyze(upright, 16, 1, 16, 12, 1, rotationDegrees = 0))
        assertNull(detector.analyze(turned, 16, 1, 16, 12, 2, rotationDegrees = 90))
        // Steady after the turn: still nothing, and a real change afterwards is seen again.
        assertNull(detector.analyze(turned, 16, 1, 16, 12, 3, rotationDegrees = 90))
        val moved = ByteBuffer.wrap(ByteArray(16 * 12) { if (it < 80) 20 else 200.toByte() })
        assertNotNull(detector.analyze(moved, 16, 1, 16, 12, 4, rotationDegrees = 90))
    }
}
