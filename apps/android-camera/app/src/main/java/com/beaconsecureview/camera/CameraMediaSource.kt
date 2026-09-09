package com.beaconsecureview.camera

import android.content.Context
import androidx.camera.view.PreviewView
import androidx.camera.core.CameraSelector
import androidx.lifecycle.LifecycleOwner
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.PeerConnectionFactory
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.VideoSource
import org.webrtc.VideoTrack

/**
 * One CameraX capture pipeline fans a single WebRTC video track out to every
 * viewer peer connection. Viewer teardown decrements a reference count; the
 * camera closes only after the final viewer leaves.
 */
class CameraMediaSource(
    context: Context,
    lifecycleOwner: LifecycleOwner,
    previewView: PreviewView,
    facing: String,
    audioEnabled: Boolean,
    onCaptureStarted: (Boolean) -> Unit,
    onMotionDetected: (Float) -> Unit,
    motionSettings: () -> MotionSettings,
) {
    private val eglBase = EglBase.create()
    private val source: VideoSource
    private val audioSource: AudioSource?
    private val capturer: CameraXVideoCapturer
    private var viewerCount = 0
    private var closed = false
    val factory: PeerConnectionFactory
    val track: VideoTrack
    val audioTrack: AudioTrack?

    init {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .setEnableInternalTracer(false)
                .createInitializationOptions(),
        )
        factory =
            PeerConnectionFactory.builder()
                .setVideoEncoderFactory(
                    DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true),
                )
                .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
                .createPeerConnectionFactory()
        source = factory.createVideoSource(false)
        track = factory.createVideoTrack("beacon-video", source)
        audioSource =
            if (audioEnabled) factory.createAudioSource(org.webrtc.MediaConstraints()) else null
        audioTrack = audioSource?.let { factory.createAudioTrack("beacon-audio", it) }
        capturer =
            CameraXVideoCapturer(
                context,
                lifecycleOwner,
                previewView,
                if (facing == "front") {
                    CameraSelector.DEFAULT_FRONT_CAMERA
                } else {
                    CameraSelector.DEFAULT_BACK_CAMERA
                },
                onCaptureStarted,
                onMotionDetected,
                motionSettings,
            )
        capturer.initialize(null, context, source.capturerObserver)
        // Camera mode is intentionally capture-ready even with no remote viewer. This powers the
        // visible local preview and avoids a cold CameraX start whenever an authorized viewer joins.
        capturer.startCapture(640, 480, 24)
    }

    @Synchronized
    fun acquire() {
        check(!closed) { "Camera media source is closed" }
        viewerCount += 1
    }

    @Synchronized
    fun release() {
        if (viewerCount == 0) return
        viewerCount -= 1
    }

    @Synchronized
    fun close() {
        if (closed) return
        closed = true
        viewerCount = 0
        capturer.dispose()
        track.dispose()
        source.dispose()
        audioTrack?.dispose()
        audioSource?.dispose()
        factory.dispose()
        eglBase.release()
    }
}

internal fun shouldCaptureAudio(microphonePermissionGranted: Boolean): Boolean =
    microphonePermissionGranted
