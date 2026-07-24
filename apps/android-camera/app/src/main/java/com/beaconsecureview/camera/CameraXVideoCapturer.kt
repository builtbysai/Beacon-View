package com.beaconsecureview.camera

import android.content.Context
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
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
import java.util.concurrent.Executors

class CameraXVideoCapturer(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    private val previewView: PreviewView,
) : VideoCapturer {
    private val analysisExecutor = Executors.newSingleThreadExecutor()
    private var observer: CapturerObserver? = null
    private var provider: ProcessCameraProvider? = null
    private var lastFrameTimestamp = 0L

    override fun initialize(
        surfaceTextureHelper: SurfaceTextureHelper?,
        applicationContext: Context,
        capturerObserver: CapturerObserver,
    ) {
        observer = capturerObserver
    }

    override fun startCapture(width: Int, height: Int, framerate: Int) {
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener(
            {
                runCatching {
                    val cameraProvider = future.get()
                    provider = cameraProvider
                    val preview =
                        Preview.Builder()
                            .setTargetResolution(Size(width, height))
                            .build()
                            .also { it.setSurfaceProvider(previewView.surfaceProvider) }
                    val analysis =
                        ImageAnalysis.Builder()
                            .setTargetResolution(Size(width, height))
                            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .build()
                            .also {
                                it.setAnalyzer(analysisExecutor) { image ->
                                    publish(image, framerate)
                                }
                            }
                    cameraProvider.unbindAll()
                    cameraProvider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analysis,
                    )
                    observer?.onCapturerStarted(true)
                }.onFailure {
                    observer?.onCapturerStarted(false)
                }
            },
            ContextCompat.getMainExecutor(context),
        )
    }

    override fun stopCapture() {
        ContextCompat.getMainExecutor(context).execute {
            provider?.unbindAll()
            observer?.onCapturerStopped()
        }
    }

    override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) = Unit

    override fun dispose() {
        stopCapture()
        analysisExecutor.shutdown()
    }

    override fun isScreencast(): Boolean = false

    private fun publish(image: ImageProxy, framerate: Int) {
        try {
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
