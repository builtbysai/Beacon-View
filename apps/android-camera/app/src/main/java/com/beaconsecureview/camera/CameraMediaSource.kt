package com.beaconsecureview.camera

import android.content.Context
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.PeerConnectionFactory
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
) {
    private val eglBase = EglBase.create()
    private val source: VideoSource
    private val capturer: CameraXVideoCapturer
    private var viewerCount = 0
    val factory: PeerConnectionFactory
    val track: VideoTrack

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
        capturer = CameraXVideoCapturer(context, lifecycleOwner, previewView)
        capturer.initialize(null, context, source.capturerObserver)
    }

    @Synchronized
    fun acquire() {
        viewerCount += 1
        if (viewerCount == 1) capturer.startCapture(640, 480, 15)
    }

    @Synchronized
    fun release() {
        if (viewerCount == 0) return
        viewerCount -= 1
        if (viewerCount == 0) capturer.stopCapture()
    }

    fun close() {
        capturer.dispose()
        track.dispose()
        source.dispose()
        factory.dispose()
        eglBase.release()
    }
}
