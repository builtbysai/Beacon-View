package com.beaconsecureview.camera

import android.content.Context
import androidx.camera.core.ImageProxy

/**
 * Stand-in used when the smart-detection experiment is off (the default, ADR 0073/0075), so the
 * MediaPipe runtime (about 11 MB of native code per ABI) is not shipped. The real class lives in
 * src/smartOn and is compiled only with -PsmartDetectionEnabled=true (V62).
 */
internal class SmartDetector private constructor() {
    fun analyze(image: ImageProxy): List<SmartDetection>? = null

    fun close() = Unit

    companion object {
        val ALLOWED_LABELS = listOf("person", "car", "bicycle", "dog", "cat")

        @Suppress("UNUSED_PARAMETER")
        fun create(context: Context): SmartDetector =
            throw UnsupportedOperationException("Smart detection is not part of this build.")
    }
}
