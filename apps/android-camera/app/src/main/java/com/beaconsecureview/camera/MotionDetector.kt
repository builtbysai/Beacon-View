package com.beaconsecureview.camera

import java.nio.ByteBuffer
import java.time.Instant

/** Applies immutable settings on the analysis thread without rebuilding the camera. */
internal class ConfiguredMotionDetector {
    private var settings: MotionSettings? = null
    private var detector: MotionDetector? = null
    private var quiet = false

    fun analyze(
        configuration: MotionSettings,
        plane: ByteBuffer,
        rowStride: Int,
        pixelStride: Int,
        width: Int,
        height: Int,
        timestampNanos: Long,
        now: Instant = Instant.now(),
        rotationDegrees: Int = 0,
    ): Float? {
        val quietNow = configuration.quietHours?.isActive(now) == true
        if (quietNow) {
            quiet = true
            detector = null
            return null
        }
        if (quiet) {
            quiet = false
            settings = null
        }
        if (configuration != settings) {
            settings = configuration
            detector =
                if (configuration.enabled) {
                    MotionDetector(
                        threshold = configuration.sensitivity.threshold,
                        changedFractionThreshold = configuration.sensitivity.changedFraction,
                        cooldownNanos = configuration.cooldownSeconds * 1_000_000_000L,
                        ignoredZones = configuration.ignoredZones,
                    )
                } else null
        }
        return detector?.analyze(plane, rowStride, pixelStride, width, height, timestampNanos, rotationDegrees)
    }
}

/**
 * Lightweight luma-only frame differencing. It never retains or uploads image data.
 *
 * Motion zones (ADR 0092): [ignoredZones] are cells of a 16 x 16 grid over the
 * upright picture (what viewers see). Samples that fall in an ignored cell are
 * skipped, so a busy street or a ceiling fan doesn't count. The camera frame is
 * not necessarily upright, so each sample is mapped through the frame's
 * rotation first.
 */
internal class MotionDetector(
    private val threshold: Int = 28,
    private val changedFractionThreshold: Float = 0.16f,
    private val sampleIntervalNanos: Long = 500_000_000L,
    private val cooldownNanos: Long = 30_000_000_000L,
    private val ignoredZones: Set<Int> = emptySet(),
) {
    private var previous: IntArray? = null
    private var lastSampleAt = Long.MIN_VALUE
    private var lastEventAt = Long.MIN_VALUE
    private var counted: BooleanArray? = null
    private var countedFor: Triple<Int, Int, Int>? = null
    private var lastRotation = 0

    fun analyze(
        plane: ByteBuffer,
        rowStride: Int,
        pixelStride: Int,
        width: Int,
        height: Int,
        timestampNanos: Long,
        rotationDegrees: Int = 0,
    ): Float? {
        if (lastSampleAt != Long.MIN_VALUE && timestampNanos - lastSampleAt < sampleIntervalNanos) {
            return null
        }
        lastSampleAt = timestampNanos
        // Turning the phone changes every sample at once; start a fresh baseline instead of reporting it (V61).
        if (rotationDegrees != lastRotation) {
            lastRotation = rotationDegrees
            previous = null
        }
        val columns = SAMPLE_COLUMNS.coerceAtMost(width.coerceAtLeast(1))
        val rows = SAMPLE_ROWS.coerceAtMost(height.coerceAtLeast(1))
        val current = sample(plane, rowStride, pixelStride, width, height, columns, rows)
        val prior = previous
        previous = current
        if (prior == null || prior.size != current.size) return null
        val counts = countedSamples(columns, rows, rotationDegrees)
        val all = IntArray(current.size) { current[it] - prior[it] }
        // Auto-exposure, IR-cut switching and a passing light brighten or darken the whole picture at once. The
        // typical change across the whole picture, ignored areas included, is that shift; only what differs from it
        // counts as movement (V61). Taken over everything so that a change filling the watched area still counts.
        val shift = all.sorted()[(all.size - 1) / 2]
        var changed = 0
        var considered = 0
        all.indices.forEach { index ->
            if (!counts[index]) return@forEach
            considered += 1
            if (kotlin.math.abs(all[index] - shift) >= threshold) changed += 1
        }
        if (considered == 0) return null
        val confidence = changed.toFloat() / considered
        if (confidence < changedFractionThreshold) return null
        if (lastEventAt != Long.MIN_VALUE && timestampNanos - lastEventAt < cooldownNanos) return null
        lastEventAt = timestampNanos
        return confidence.coerceIn(0f, 1f)
    }

    /** Which samples count, for this grid and rotation. Cached until either changes. */
    private fun countedSamples(columns: Int, rows: Int, rotationDegrees: Int): BooleanArray {
        val key = Triple(columns, rows, rotationDegrees)
        val cached = counted
        if (cached != null && countedFor == key) return cached
        val mask =
            BooleanArray(columns * rows) { index ->
                if (ignoredZones.isEmpty()) {
                    true
                } else {
                    val sx = (index % columns + 0.5f) / columns
                    val sy = (index / columns + 0.5f) / rows
                    val (u, v) = ZoneGrid.uprightPoint(sx, sy, rotationDegrees)
                    ZoneGrid.cellAt(u, v) !in ignoredZones
                }
            }
        counted = mask
        countedFor = key
        return mask
    }

    private fun sample(
        plane: ByteBuffer,
        rowStride: Int,
        pixelStride: Int,
        width: Int,
        height: Int,
        columns: Int,
        rows: Int,
    ): IntArray {
        val offset = plane.position()
        return IntArray(columns * rows) { index ->
            val x = (index % columns) * width / columns
            val y = (index / columns) * height / rows
            plane.get(offset + y * rowStride + x * pixelStride).toInt() and 0xff
        }
    }

    private companion object {
        const val SAMPLE_COLUMNS = 16
        const val SAMPLE_ROWS = 12
    }
}

/** The motion-zone grid: 16 x 16 cells over the upright picture, numbered row by row. */
internal object ZoneGrid {
    const val SIZE = 16
    const val COUNT = SIZE * SIZE

    /** The cell holding a point given as fractions (0..1) of the upright picture. */
    fun cellAt(u: Float, v: Float): Int {
        val column = (u * SIZE).toInt().coerceIn(0, SIZE - 1)
        val row = (v * SIZE).toInt().coerceIn(0, SIZE - 1)
        return row * SIZE + column
    }

    /**
     * Maps a point of the raw camera frame (fractions of it) to the same point of the
     * upright picture. [rotationDegrees] is how far the frame must turn clockwise to
     * stand upright (CameraX's `rotationDegrees`).
     */
    fun uprightPoint(sx: Float, sy: Float, rotationDegrees: Int): Pair<Float, Float> =
        when (((rotationDegrees % 360) + 360) % 360) {
            90 -> (1f - sy) to sx
            180 -> (1f - sx) to (1f - sy)
            270 -> sy to (1f - sx)
            else -> sx to sy
        }
}
