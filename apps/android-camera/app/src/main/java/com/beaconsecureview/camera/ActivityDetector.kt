package com.beaconsecureview.camera

import java.nio.ByteBuffer

/**
 * Category label for an on-device smart-detection signal (ADR 0073). Never a name, face,
 * or biometric template -- ADR 0031's ban on facial recognition and biometric storage is not
 * revisable by this file.
 */
enum class ActivityCategory(val wireValue: String) {
    /** The same global scene-change signal MotionDetector already reports. */
    Motion("motion"),
    /** A coarse region of concentrated change. Not a trained object or person classifier. */
    ActivityRegion("activity_region"),
}

/** One quadrant of the sampled grid: coarser than a bounding box, cheap on older devices. */
enum class ActivityRegion { TopLeft, TopRight, BottomLeft, BottomRight }

/**
 * A confidence-scored, category-labeled signal. Implementations must report only this --
 * never a frame, thumbnail, pixel sample, or identity -- matching ADR 0014's data minimization.
 */
data class DetectionResult(
    val category: ActivityCategory,
    val confidence: Float,
    val region: ActivityRegion? = null,
)

/**
 * Pluggable on-device detector boundary for the smart-detection experiment (ADR 0073).
 * An implementation must run at a reduced sampling rate, never retain or upload a frame, and
 * report category/confidence metadata only. Nothing in this file is called from production
 * capture code yet; see ADR 0073 for what must happen before that changes.
 */
internal interface ActivityDetector {
    fun analyze(
        plane: ByteBuffer,
        rowStride: Int,
        pixelStride: Int,
        width: Int,
        height: Int,
        timestampNanos: Long,
    ): DetectionResult?
}

/**
 * Foundation-only heuristic, NOT a trained classifier. It samples the same fixed grid
 * MotionDetector already reads and reports which quadrant concentrates the most luma change,
 * so the detector/pipeline shape can be exercised before a real model is selected (ADR 0073).
 * Never claim this identifies a person or object.
 */
internal class RegionActivityDetector(
    private val threshold: Int = 28,
    private val changedFractionThreshold: Float = 0.16f,
    private val sampleIntervalNanos: Long = 500_000_000L,
) : ActivityDetector {
    private var previous: IntArray? = null
    private var lastSampleAt = Long.MIN_VALUE

    override fun analyze(
        plane: ByteBuffer,
        rowStride: Int,
        pixelStride: Int,
        width: Int,
        height: Int,
        timestampNanos: Long,
    ): DetectionResult? {
        if (lastSampleAt != Long.MIN_VALUE && timestampNanos - lastSampleAt < sampleIntervalNanos) {
            return null
        }
        lastSampleAt = timestampNanos
        val current = sample(plane, rowStride, pixelStride, width, height)
        val prior = previous
        previous = current
        if (prior == null || prior.size != current.size) return null

        val quadrantChanged = IntArray(4)
        val quadrantTotal = IntArray(4)
        current.indices.forEach { index ->
            val column = index % COLUMNS
            val row = index / COLUMNS
            val quadrant = (if (row < ROWS / 2) 0 else 2) + (if (column < COLUMNS / 2) 0 else 1)
            quadrantTotal[quadrant] += 1
            if (kotlin.math.abs(current[index] - prior[index]) >= threshold) {
                quadrantChanged[quadrant] += 1
            }
        }
        var busiest = 0
        for (quadrant in 1 until 4) {
            if (quadrantChanged[quadrant] > quadrantChanged[busiest]) busiest = quadrant
        }
        val confidence = quadrantChanged[busiest].toFloat() / quadrantTotal[busiest].coerceAtLeast(1)
        if (confidence < changedFractionThreshold) return null
        return DetectionResult(
            category = ActivityCategory.ActivityRegion,
            confidence = confidence.coerceIn(0f, 1f),
            region = REGIONS[busiest],
        )
    }

    private fun sample(
        plane: ByteBuffer,
        rowStride: Int,
        pixelStride: Int,
        width: Int,
        height: Int,
    ): IntArray {
        val columns = COLUMNS.coerceAtMost(width.coerceAtLeast(1))
        val rows = ROWS.coerceAtMost(height.coerceAtLeast(1))
        val offset = plane.position()
        return IntArray(columns * rows) { index ->
            val x = (index % columns) * width / columns
            val y = (index / columns) * height / rows
            plane.get(offset + y * rowStride + x * pixelStride).toInt() and 0xff
        }
    }

    private companion object {
        const val COLUMNS = 16
        const val ROWS = 12
        val REGIONS = listOf(
            ActivityRegion.TopLeft,
            ActivityRegion.TopRight,
            ActivityRegion.BottomLeft,
            ActivityRegion.BottomRight,
        )
    }
}

/**
 * Reusable confirmation window: only reports a signal after [requiredConsecutiveSamples]
 * qualifying samples in a row, and resets on any non-qualifying sample. This reduces
 * single-frame lighting-flicker false positives. It is not wired into the production
 * MotionDetector in this change -- adopting it there is a separate, explicitly evaluated
 * decision because it would change already physically-validated detection latency (ADR 0073).
 */
internal class SustainedSignalFilter(private val requiredConsecutiveSamples: Int = 2) {
    init {
        require(requiredConsecutiveSamples >= 1) { "requiredConsecutiveSamples must be at least 1" }
    }

    private var consecutive = 0
    private var confirmedConfidence = 0f

    /** Pass the current sample's confidence, or null when this sample did not qualify. */
    fun accept(confidence: Float?): Float? {
        if (confidence == null) {
            consecutive = 0
            return null
        }
        consecutive += 1
        confirmedConfidence = confidence
        if (consecutive < requiredConsecutiveSamples) return null
        return confirmedConfidence
    }
}
