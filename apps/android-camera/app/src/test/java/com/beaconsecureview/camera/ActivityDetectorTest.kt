package com.beaconsecureview.camera

import java.nio.ByteBuffer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class RegionActivityDetectorTest {
    @Test
    fun reportsTheQuadrantWithTheMostChangeAndIgnoresGlobalNoise() {
        val detector = RegionActivityDetector(sampleIntervalNanos = 0)
        val dark = ByteBuffer.wrap(ByteArray(16 * 12) { 10 })
        // Top-right quadrant (columns 8-15, rows 0-5) lit up; everything else unchanged.
        val topRightChanged =
            ByteBuffer.wrap(
                ByteArray(16 * 12) { index ->
                    val column = index % 16
                    val row = index / 16
                    if (row < 6 && column >= 8) 100 else 10
                },
            )
        assertNull(detector.analyze(dark, 16, 1, 16, 12, 0))
        val result = detector.analyze(topRightChanged, 16, 1, 16, 12, 1)
        assertNotNull(result)
        assertEquals(ActivityCategory.ActivityRegion, result.category)
        assertEquals(ActivityRegion.TopRight, result.region)
    }

    @Test
    fun ignoresSmallLightingNoise() {
        val detector = RegionActivityDetector(sampleIntervalNanos = 0)
        val first = ByteBuffer.wrap(ByteArray(16 * 12) { 100 })
        val second = ByteBuffer.wrap(ByteArray(16 * 12) { 110 })
        assertNull(detector.analyze(first, 16, 1, 16, 12, 0))
        assertNull(detector.analyze(second, 16, 1, 16, 12, 1))
    }
}

class SustainedSignalFilterTest {
    @Test
    fun suppressesASingleFrameFlickerButConfirmsASustainedSignal() {
        val filter = SustainedSignalFilter(requiredConsecutiveSamples = 2)
        assertNull(filter.accept(0.9f))
        assertEquals(0.9f, filter.accept(0.9f))
    }

    @Test
    fun resetsAfterAGapRatherThanAccumulatingAcrossIt() {
        val filter = SustainedSignalFilter(requiredConsecutiveSamples = 2)
        assertNull(filter.accept(0.9f))
        assertNull(filter.accept(null))
        assertNull(filter.accept(0.9f))
        assertEquals(0.9f, filter.accept(0.9f))
    }

    @Test
    fun rejectsANonPositiveWindow() {
        assertFailsWith<IllegalArgumentException> { SustainedSignalFilter(requiredConsecutiveSamples = 0) }
    }
}
