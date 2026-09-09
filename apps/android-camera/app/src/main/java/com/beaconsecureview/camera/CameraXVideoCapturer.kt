package com.beaconsecureview.camera

import android.content.Context
import android.os.Looper
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import org.webrtc.CapturerObserver
import org.webrtc.JavaI420Buffer
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoFrame
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

    override fun initialize(
        surfaceTextureHelper: SurfaceTextureHelper?,
        applicationContext: Context,
        capturerObserver: CapturerObserver,
    ) {
        observer = capturerObserver
    }

    override fun startCapture(width: Int, height: Int, framerate: Int) {
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
                    cameraProvider.bindToLifecycle(
                        lifecycleOwner,
                        cameraSelector,
                        preview,
                        imageAnalysis,
                    )
                    observer?.onCapturerStarted(true)
                }.onFailure {
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
        val stopped = CountDownLatch(1)
        val stop = Runnable {
            analysis?.clearAnalyzer()
            analysis = null
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
            )?.let(onMotionDetected)
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
}
