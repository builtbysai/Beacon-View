package com.beaconsecureview.camera

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import org.webrtc.CapturerObserver
import org.webrtc.JavaI420Buffer
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoFrame
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class CameraXVideoCapturer(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    private val previewView: PreviewView,
    private val cameraSelector: CameraSelector,
    private val onCaptureStarted: (Boolean) -> Unit,
    private val onMotionDetected: (Float) -> Unit,
    private val motionSettings: () -> MotionSettings,
) : VideoCapturer {
    private val analysisExecutor = Executors.newSingleThreadExecutor()
    private var observer: CapturerObserver? = null
    private var provider: ProcessCameraProvider? = null
    private var analysis: ImageAnalysis? = null
    private var lastFrameTimestamp = 0L
    private val disposed = AtomicBoolean(false)
    private val captureStartReported = AtomicBoolean(false)
    private val motionDetector = ConfiguredMotionDetector()
    private var smartDetector: SmartDetector? = null
    private var smartDetectorInitAttempted = false
    @Volatile
    private var recorder: Recorder? = null
    private var activeRecording: Recording? = null
    private val recordingHandler = Handler(Looper.getMainLooper())
    private var recordingTimeout: Runnable? = null

    /** False either before capture starts or on any device whose camera HAL
     * doesn't support the extra concurrent stream Recorder needs alongside
     * the live preview and analysis streams this class already binds --
     * on-device clip recording just silently stays unavailable there, the
     * same as it would if the motion-triggering setting were off. */
    val clipRecordingAvailable: Boolean
        get() = recorder != null

    override fun initialize(
        surfaceTextureHelper: SurfaceTextureHelper?,
        applicationContext: Context,
        capturerObserver: CapturerObserver,
    ) {
        observer = capturerObserver
    }

    override fun startCapture(width: Int, height: Int, framerate: Int) =
        attemptBind(width, height, framerate, attempt = 0)

    // A prior lens's Camera2 session close (from ProcessCameraProvider.unbindAll()
    // during a flip) completes asynchronously on the camera HAL -- there is no
    // callback to await, only a best-effort handoff delay upstream in
    // CameraForegroundService.selectCamera(). On some devices, especially under
    // thermal load, that window still isn't enough and bindToLifecycle throws
    // (e.g. CAMERA_IN_USE) instead of the crash this used to surface as. One
    // bounded retry after a short backoff resolves that without giving up on
    // the flip outright.
    private fun attemptBind(width: Int, height: Int, framerate: Int, attempt: Int) {
        if (disposed.get()) return
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener(
            {
                runCatching {
                    val cameraProvider = future.get()
                    provider = cameraProvider
                    val resolutionSelector =
                        ResolutionSelector.Builder()
                            .setResolutionStrategy(
                                ResolutionStrategy(
                                    Size(width, height),
                                    ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER,
                                ),
                            )
                            .build()
                    val preview =
                        Preview.Builder()
                            .setResolutionSelector(resolutionSelector)
                            .build()
                            .also { it.setSurfaceProvider(previewView.surfaceProvider) }
                    if (disposed.get()) return@runCatching
                    val imageAnalysis =
                        ImageAnalysis.Builder()
                            .setResolutionSelector(resolutionSelector)
                            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .build()
                            .also {
                                it.setAnalyzer(analysisExecutor) { image ->
                                    publish(image, framerate)
                                }
                            }
                    analysis = imageAnalysis
                    cameraProvider.unbindAll()
                    // Clip recording rides as a 3rd concurrent use case
                    // alongside the live preview/analysis streams this
                    // class already binds -- bound once, up front, staying
                    // idle (no file, no encoder work) until a motion report
                    // actually starts a recording. Not every camera HAL
                    // guarantees a 3rd concurrent stream, so a device that
                    // can't bind it here just never gets clip recording;
                    // the live preview/analysis pair it falls back to is
                    // exactly what this method always bound before.
                    val recorderCandidate =
                        Recorder.Builder()
                            .setQualitySelector(
                                QualitySelector.fromOrderedList(
                                    listOf(Quality.SD, Quality.HD),
                                    FallbackStrategy.lowerQualityOrHigherThan(Quality.SD),
                                ),
                            )
                            .build()
                    val videoCapture = VideoCapture.withOutput(recorderCandidate)
                    val boundWithRecorder =
                        runCatching {
                            cameraProvider.bindToLifecycle(
                                lifecycleOwner,
                                cameraSelector,
                                preview,
                                imageAnalysis,
                                videoCapture,
                            )
                        }
                    if (boundWithRecorder.isSuccess) {
                        recorder = recorderCandidate
                    } else {
                        recorder = null
                        cameraProvider.unbindAll()
                        cameraProvider.bindToLifecycle(
                            lifecycleOwner,
                            cameraSelector,
                            preview,
                            imageAnalysis,
                        )
                    }
                    observer?.onCapturerStarted(true)
                }.onFailure {
                    if (attempt < MAX_BIND_ATTEMPTS && !disposed.get()) {
                        Handler(Looper.getMainLooper()).postDelayed(
                            { attemptBind(width, height, framerate, attempt + 1) },
                            BIND_RETRY_DELAY_MS * (attempt + 1),
                        )
                        return@onFailure
                    }
                    observer?.onCapturerStarted(false)
                    if (captureStartReported.compareAndSet(false, true)) {
                        onCaptureStarted(false)
                    }
                }
            },
            ContextCompat.getMainExecutor(context),
        )
    }

    override fun stopCapture() {
        stopClipRecording()
        recorder = null
        val stopped = CountDownLatch(1)
        val stop = Runnable {
            analysis?.clearAnalyzer()
            analysis = null
            smartDetector?.close()
            smartDetector = null
            smartDetectorInitAttempted = false
            provider?.unbindAll()
            runCatching { analysisExecutor.submit {}.get(2, TimeUnit.SECONDS) }
            analysisExecutor.shutdown()
            observer?.onCapturerStopped()
            stopped.countDown()
        }
        if (Looper.myLooper() == Looper.getMainLooper()) stop.run()
        else {
            ContextCompat.getMainExecutor(context).execute(stop)
            stopped.await(3, TimeUnit.SECONDS)
        }
    }

    override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) = Unit

    override fun dispose() {
        if (!disposed.compareAndSet(false, true)) return
        stopCapture()
    }

    override fun isScreencast(): Boolean = false

    /** Starts recording a local clip to `outputFile`, auto-stopping after
     * `maxDurationMs` if `stopClipRecording` isn't called first. Returns
     * false immediately (without touching the file) when this device never
     * bound the extra recording stream, or a clip is already in progress --
     * either way, `onFinalized` never fires. Otherwise it fires exactly
     * once, with `success=false` on any encoder/storage failure. A failed
     * or skipped clip never affects the live capture this class also
     * drives -- that's the entire point of keeping Recorder a 3rd,
     * independent use case rather than something the live pipeline itself
     * depends on. */
    fun startClipRecording(
        outputFile: File,
        maxDurationMs: Long,
        audioEnabled: Boolean,
        onFinalized: (durationMs: Long, success: Boolean) -> Unit,
    ): Boolean {
        val activeRecorder = recorder ?: return false
        if (activeRecording != null) return false
        val pending =
            runCatching {
                activeRecorder.prepareRecording(context, FileOutputOptions.Builder(outputFile).build())
            }.getOrNull() ?: return false
        val withAudio =
            if (audioEnabled) {
                try {
                    pending.withAudioEnabled()
                } catch (denied: SecurityException) {
                    pending
                }
            } else {
                pending
            }
        val recording =
            runCatching {
                withAudio.start(ContextCompat.getMainExecutor(context)) { event ->
                    if (event is VideoRecordEvent.Finalize) {
                        recordingTimeout?.let { recordingHandler.removeCallbacks(it) }
                        recordingTimeout = null
                        activeRecording = null
                        onFinalized(
                            TimeUnit.NANOSECONDS.toMillis(event.recordingStats.recordedDurationNanos),
                            !event.hasError(),
                        )
                    }
                }
            }.getOrNull() ?: return false
        activeRecording = recording
        val timeout = Runnable { stopClipRecording() }
        recordingTimeout = timeout
        recordingHandler.postDelayed(timeout, maxDurationMs)
        return true
    }

    fun stopClipRecording() {
        recordingTimeout?.let { recordingHandler.removeCallbacks(it) }
        recordingTimeout = null
        activeRecording?.stop()
    }

    /** Lazily creates the real detector only when BuildConfig.SMART_DETECTION_ENABLED
     * is on for this build -- never attempted otherwise, so a normal build never
     * touches the (also normally absent) model asset. A load failure disables the
     * experiment for this capture session rather than crashing capture. */
    private fun smartDetectorOrNull(): SmartDetector? {
        if (!BuildConfig.SMART_DETECTION_ENABLED) return null
        if (!smartDetectorInitAttempted) {
            smartDetectorInitAttempted = true
            smartDetector =
                runCatching { SmartDetector.create(context) }
                    .onFailure { Log.w(LOG_TAG, "event=smart_detector_init_failed error=${it.message}") }
                    .getOrNull()
        }
        return smartDetector
    }

    private fun publish(image: ImageProxy, framerate: Int) {
        try {
            if (disposed.get()) return
            motionDetector.analyze(
                motionSettings(),
                image.planes[0].buffer,
                image.planes[0].rowStride,
                image.planes[0].pixelStride,
                image.width,
                image.height,
                image.imageInfo.timestamp,
                rotationDegrees = image.imageInfo.rotationDegrees,
            )?.let(onMotionDetected)
            // ADR 0074/0075: experimental, default-off, logged locally only -- never
            // sent to the backend or shown in any UI. See smartDetectorOrNull().
            smartDetectorOrNull()?.let { detector ->
                runCatching { detector.analyze(image) }
                    .onSuccess { detections ->
                        detections?.forEach {
                            Log.i(LOG_TAG, "event=smart_detection label=${it.label} confidence=${it.confidence}")
                        }
                    }
                    .onFailure { Log.w(LOG_TAG, "event=smart_detection_failed error=${it.message}") }
            }
            val minimumInterval = 1_000_000_000L / framerate.coerceAtLeast(1)
            if (image.imageInfo.timestamp - lastFrameTimestamp < minimumInterval) return
            lastFrameTimestamp = image.imageInfo.timestamp
            val buffer = JavaI420Buffer.allocate(image.width, image.height)
            copyPlane(
                image.planes[0].buffer,
                image.planes[0].rowStride,
                image.planes[0].pixelStride,
                buffer.dataY,
                buffer.strideY,
                image.width,
                image.height,
            )
            copyPlane(
                image.planes[1].buffer,
                image.planes[1].rowStride,
                image.planes[1].pixelStride,
                buffer.dataU,
                buffer.strideU,
                image.width / 2,
                image.height / 2,
            )
            copyPlane(
                image.planes[2].buffer,
                image.planes[2].rowStride,
                image.planes[2].pixelStride,
                buffer.dataV,
                buffer.strideV,
                image.width / 2,
                image.height / 2,
            )
            val frame =
                VideoFrame(
                    buffer,
                    image.imageInfo.rotationDegrees,
                    image.imageInfo.timestamp,
                )
            observer?.onFrameCaptured(frame)
            if (captureStartReported.compareAndSet(false, true)) {
                onCaptureStarted(true)
            }
            frame.release()
        } finally {
            image.close()
        }
    }

    private fun copyPlane(
        source: ByteBuffer,
        sourceStride: Int,
        pixelStride: Int,
        target: ByteBuffer,
        targetStride: Int,
        width: Int,
        height: Int,
    ) {
        val sourceOffset = source.position()
        if (pixelStride == 1) {
            for (row in 0 until height) {
                val sourceRow = source.duplicate()
                sourceRow.position(sourceOffset + row * sourceStride)
                sourceRow.limit(sourceRow.position() + width)
                val targetRow = target.duplicate()
                targetRow.position(row * targetStride)
                targetRow.put(sourceRow)
            }
            return
        }
        for (row in 0 until height) {
            for (column in 0 until width) {
                target.put(
                    row * targetStride + column,
                    source.get(sourceOffset + row * sourceStride + column * pixelStride),
                )
            }
        }
    }

    private companion object {
        const val MAX_BIND_ATTEMPTS = 2
        const val BIND_RETRY_DELAY_MS = 300L
        const val LOG_TAG = "BeaconLifecycle"
    }
}
