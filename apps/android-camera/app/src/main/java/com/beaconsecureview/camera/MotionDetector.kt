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
                    )
                } else null
        }
        return detector?.analyze(plane, rowStride, pixelStride, width, height, timestampNanos)
    }
}

/** Lightweight luma-only frame differencing. It never retains or uploads image data. */
internal class MotionDetector(
    private val threshold: Int = 28,
    private val changedFractionThreshold: Float = 0.16f,
    private val sampleIntervalNanos: Long = 500_000_000L,
    private val cooldownNanos: Long = 30_000_000_000L,
) {
    private var previous: IntArray? = null
    private var lastSampleAt = Long.MIN_VALUE
    private var lastEventAt = Long.MIN_VALUE

    fun analyze(
        plane: ByteBuffer,
        rowStride: Int,
        pixelStride: Int,
        width: Int,
        height: Int,
        timestampNanos: Long,
    ): Float? {
        if (lastSampleAt != Long.MIN_VALUE && timestampNanos - lastSampleAt < sampleIntervalNanos) {
            return null
        }
        lastSampleAt = timestampNanos
        val current = sample(plane, rowStride, pixelStride, width, height)
        val prior = previous
        previous = current
        if (prior == null || prior.size != current.size) return null
        var changed = 0
        current.indices.forEach { index ->
            if (kotlin.math.abs(current[index] - prior[index]) >= threshold) changed += 1
        }
        val confidence = changed.toFloat() / current.size.coerceAtLeast(1)
        if (confidence < changedFractionThreshold) return null
        if (lastEventAt != Long.MIN_VALUE && timestampNanos - lastEventAt < cooldownNanos) return null
        lastEventAt = timestampNanos
        return confidence.coerceIn(0f, 1f)
    }

    private fun sample(
        plane: ByteBuffer,
        rowStride: Int,
        pixelStride: Int,
        width: Int,
        height: Int,
    ): IntArray {
        val columns = 16.coerceAtMost(width.coerceAtLeast(1))
        val rows = 12.coerceAtMost(height.coerceAtLeast(1))
        val offset = plane.position()
        return IntArray(columns * rows) { index ->
            val x = (index % columns) * width / columns
            val y = (index / columns) * height / rows
            plane.get(offset + y * rowStride + x * pixelStride).toInt() and 0xff
        }
    }
}
