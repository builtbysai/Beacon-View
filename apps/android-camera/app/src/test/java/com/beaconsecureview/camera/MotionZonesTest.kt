package com.beaconsecureview.camera

import java.nio.ByteBuffer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** Motion zones (ADR 0092). Frames are 16 x 12 so each sample is exactly one pixel. */
class MotionZonesTest {
    private fun frame(changed: (column: Int, row: Int) -> Boolean): ByteBuffer =
        ByteBuffer.wrap(ByteArray(16 * 12) { index -> if (changed(index % 16, index / 16)) 200.toByte() else 10 })

    private val still = frame { _, _ -> false }

    private fun detector(zones: Set<Int>) =
        MotionDetector(
            changedFractionThreshold = 0.1f,
            cooldownNanos = 0,
            ignoredZones = zones,
            sampleIntervalNanos = 0,
        )

    /** Every grid cell in the top half of the upright picture. */
    private val topHalf: Set<Int> = (0 until ZoneGrid.COUNT).filter { it / ZoneGrid.SIZE < ZoneGrid.SIZE / 2 }.toSet()

    @Test
    fun movementOnlyInAnIgnoredAreaIsNotReported() {
        val detector = detector(topHalf)
        assertNull(detector.analyze(still, 16, 1, 16, 12, 1))
        // Everything in the top 6 of 12 rows changes.
        val topMoves = frame { _, row -> row < 6 }
        assertNull(detector.analyze(topMoves, 16, 1, 16, 12, 2))
    }

    @Test
    fun movementOutsideIgnoredAreasStillCounts() {
        val detector = detector(topHalf)
        assertNull(detector.analyze(still, 16, 1, 16, 12, 1))
        val bottomMoves = frame { _, row -> row >= 6 }
        assertNotNull(detector.analyze(bottomMoves, 16, 1, 16, 12, 2))
    }

    @Test
    fun ignoredAreasDoNotDiluteTheChangedFraction() {
        // Only the bottom row of 12 changes: 1/12 of the whole frame is below a 10% threshold,
        // but it is 2/12 = 17% of the 6 counted rows' worth... so zones must raise sensitivity.
        val detector = MotionDetector(changedFractionThreshold = 0.15f, cooldownNanos = 0, ignoredZones = topHalf, sampleIntervalNanos = 0)
        val plain = MotionDetector(changedFractionThreshold = 0.15f, cooldownNanos = 0, sampleIntervalNanos = 0)
        val oneRow = frame { _, row -> row == 11 }
        assertNull(plain.analyze(still, 16, 1, 16, 12, 1))
        assertNull(plain.analyze(oneRow, 16, 1, 16, 12, 2))
        assertNull(detector.analyze(still, 16, 1, 16, 12, 1))
        assertNotNull(detector.analyze(oneRow, 16, 1, 16, 12, 2))
    }

    @Test
    fun ignoringTheWholePictureReportsNothing() {
        val detector = detector((0 until ZoneGrid.COUNT).toSet())
        assertNull(detector.analyze(still, 16, 1, 16, 12, 1))
        assertNull(detector.analyze(frame { _, _ -> true }, 16, 1, 16, 12, 2))
    }

    @Test
    fun zonesFollowTheFrameRotationNotTheSensor() {
        // The frame must turn 90 degrees clockwise to stand upright, so the sensor's
        // left edge is the upright picture's top. Ignore the upright top half.
        val rotated = detector(topHalf)
        assertNull(rotated.analyze(still, 16, 1, 16, 12, 1, rotationDegrees = 90))
        val sensorLeftHalfMoves = frame { column, _ -> column < 8 }
        assertNull(rotated.analyze(sensorLeftHalfMoves, 16, 1, 16, 12, 2, rotationDegrees = 90))
        // The same movement, with the frame already upright, is in the ignored top?
        // No: upright, the sensor's left half is the left half, which is not ignored.
        val upright = detector(topHalf)
        assertNull(upright.analyze(still, 16, 1, 16, 12, 1, rotationDegrees = 0))
        assertNotNull(upright.analyze(sensorLeftHalfMoves, 16, 1, 16, 12, 2, rotationDegrees = 0))
    }

    @Test
    fun mapsRawFramePointsToTheUprightPicture() {
        // Clockwise 90: the raw top-left corner ends up at the upright top-right.
        assertEquals(1f to 0f, ZoneGrid.uprightPoint(0f, 0f, 90))
        assertEquals(1f to 1f, ZoneGrid.uprightPoint(1f, 0f, 90))
        // 180: opposite corner.
        assertEquals(1f to 1f, ZoneGrid.uprightPoint(0f, 0f, 180))
        // 270: the raw top-left corner ends up at the upright bottom-left.
        assertEquals(0f to 1f, ZoneGrid.uprightPoint(0f, 0f, 270))
        // Negative and full turns normalize.
        assertEquals(ZoneGrid.uprightPoint(0.3f, 0.6f, 90), ZoneGrid.uprightPoint(0.3f, 0.6f, -270))
        assertEquals(0.3f to 0.6f, ZoneGrid.uprightPoint(0.3f, 0.6f, 360))
    }

    @Test
    fun numbersCellsRowByRowFromTheTopLeft() {
        assertEquals(0, ZoneGrid.cellAt(0f, 0f))
        assertEquals(15, ZoneGrid.cellAt(0.999f, 0f))
        assertEquals(16, ZoneGrid.cellAt(0f, 0.07f))
        assertEquals(255, ZoneGrid.cellAt(1f, 1f))
    }

    @Test
    fun settingsRefuseCellsOffTheGrid() {
        assertEquals(setOf(0, 255), MotionSettings(ignoredZones = setOf(0, 255)).ignoredZones)
        assertFailsWith<IllegalArgumentException> { MotionSettings(ignoredZones = setOf(256)) }
        assertFailsWith<IllegalArgumentException> { MotionSettings(ignoredZones = setOf(-1)) }
    }

    @Test
    fun newZonesTakeEffectWithoutRebuildingTheCamera() {
        val configured = ConfiguredMotionDetector()
        val moving = MotionSettings(sensitivity = MotionSensitivity.High, cooldownSeconds = 30)
        val bottomMoves = frame { _, row -> row >= 6 }
        assertNull(configured.analyze(moving, still, 16, 1, 16, 12, 1))
        assertNotNull(configured.analyze(moving, bottomMoves, 16, 1, 16, 12, 2_000_000_000L))
        // The bottom half becomes an ignored area: the same movement no longer reports.
        val bottomHalf = (0 until ZoneGrid.COUNT).filter { it / ZoneGrid.SIZE >= ZoneGrid.SIZE / 2 }.toSet()
        val zoned = moving.copy(ignoredZones = bottomHalf)
        assertNull(configured.analyze(zoned, still, 16, 1, 16, 12, 3_000_000_000L))
        assertNull(configured.analyze(zoned, bottomMoves, 16, 1, 16, 12, 4_000_000_000L))
    }
}
