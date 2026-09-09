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
}
