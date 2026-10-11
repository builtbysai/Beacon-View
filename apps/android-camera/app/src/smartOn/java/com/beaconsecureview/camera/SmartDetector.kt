package com.beaconsecureview.camera

import android.content.Context
import androidx.camera.core.ImageProxy
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.objectdetector.ObjectDetector

/**
 * Real on-device object-detection runtime (ADR 0074/0075), distinct from ADR 0073's
 * heuristic [ActivityDetector] -- this one needs full color image data, not just a
 * luma plane. Only constructed when `BuildConfig.SMART_DETECTION_ENABLED` is
 * explicitly turned on for a controlled test build; see [CameraXVideoCapturer] for
 * the call site. Never retains or uploads a frame -- only category and confidence.
 */
internal class SmartDetector private constructor(
    private val detector: ObjectDetector,
    private val sampleIntervalNanos: Long,
) {
    private var lastSampleAt = Long.MIN_VALUE

    /** Null means this frame was skipped to keep the sampling rate low, not that
     * nothing was detected. */
    fun analyze(image: ImageProxy): List<SmartDetection>? {
        val timestampNanos = image.imageInfo.timestamp
        if (lastSampleAt != Long.MIN_VALUE && timestampNanos - lastSampleAt < sampleIntervalNanos) {
            return null
        }
        lastSampleAt = timestampNanos
        val mpImage = BitmapImageBuilder(image.toBitmap()).build()
        return detector.detect(mpImage).detections().flatMap { detection ->
            detection.categories().map { category -> SmartDetection(category.categoryName(), category.score()) }
        }
    }

    fun close() = detector.close()

    companion object {
        /** Security-camera-relevant subset of EfficientDet-Lite0's COCO categories
         * (ADR 0075). Extending this list is a product decision, not a model
         * capability question -- change it here and record why. */
        val ALLOWED_LABELS = listOf("person", "car", "bicycle", "dog", "cat")

        /** Reduced sampling rate per the product brief: never run on every frame. */
        private const val DEFAULT_SAMPLE_INTERVAL_NANOS = 1_000_000_000L

        fun create(
            context: Context,
            modelAssetPath: String = "efficientdet_lite0.tflite",
            sampleIntervalNanos: Long = DEFAULT_SAMPLE_INTERVAL_NANOS,
        ): SmartDetector {
            val options =
                ObjectDetector.ObjectDetectorOptions.builder()
                    .setBaseOptions(BaseOptions.builder().setModelAssetPath(modelAssetPath).build())
                    .setRunningMode(RunningMode.IMAGE)
                    .setScoreThreshold(0.5f)
                    .setMaxResults(5)
                    .setCategoryAllowlist(ALLOWED_LABELS)
                    .build()
            return SmartDetector(ObjectDetector.createFromOptions(context, options), sampleIntervalNanos)
        }
    }
}
