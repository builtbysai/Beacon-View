package com.beaconsecureview.camera

import android.content.Context
import android.util.Log
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.VideoSource
import org.webrtc.VideoTrack

class WebRtcCameraSession(
    context: Context,
    lifecycleOwner: LifecycleOwner,
    previewView: PreviewView,
    servers: List<SignalingIceServer>,
    relayOnly: Boolean,
    private val connectionId: String,
    private val signaling: CameraSignalingClient,
    private val onState: (StreamingState) -> Unit,
) {
    private val eglBase = EglBase.create()
    private val factory: PeerConnectionFactory
    private val source: VideoSource
    private val track: VideoTrack
    private val capturer: CameraXVideoCapturer
    private val peer: PeerConnection

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
        val iceServers =
            servers.map {
                PeerConnection.IceServer.builder(it.urls)
                    .setUsername(it.username ?: "")
                    .setPassword(it.credential ?: "")
                    .createIceServer()
            }
        peer =
            requireNotNull(
                factory.createPeerConnection(
                    PeerConnection.RTCConfiguration(iceServers).apply {
                        iceTransportsType =
                            if (relayOnly) {
                                PeerConnection.IceTransportsType.RELAY
                            } else {
                                PeerConnection.IceTransportsType.ALL
                            }
                        sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
                        continualGatheringPolicy =
                            PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
                    },
                    Observer(),
                ),
            )
        peer.addTransceiver(
            track,
            RtpTransceiver.RtpTransceiverInit(
                RtpTransceiver.RtpTransceiverDirection.SEND_ONLY,
                listOf("beacon-stream"),
            ),
        )
    }

    fun start() {
        onState(StreamingState.Connecting)
        capturer.startCapture(640, 480, 15)
        peer.createOffer(
            object : SimpleSdpObserver() {
                override fun onCreateSuccess(description: SessionDescription) {
                    peer.setLocalDescription(
                        object : SimpleSdpObserver() {
                            override fun onSetSuccess() {
                                signaling.sendOffer(connectionId, description.description)
                            }

                            override fun onSetFailure(error: String) {
                                Log.e(TAG, "Unable to set the local video offer: $error")
                                onState(StreamingState.Failed)
                            }
                        },
                        description,
                    )
                }

                override fun onCreateFailure(error: String) {
                    Log.e(TAG, "Unable to create the local video offer: $error")
                    onState(StreamingState.Failed)
                }
            },
            MediaConstraints(),
        )
    }

    fun setAnswer(sdp: String) {
        peer.setRemoteDescription(
            object : SimpleSdpObserver() {
                override fun onSetFailure(error: String) {
                    Log.e(TAG, "Unable to apply the remote video answer: $error")
                    onState(StreamingState.Failed)
                }
            },
            SessionDescription(SessionDescription.Type.ANSWER, sdp),
        )
    }

    fun addIce(candidate: IceCandidate) {
        peer.addIceCandidate(candidate)
    }

    fun close() {
        capturer.dispose()
        peer.close()
        track.dispose()
        source.dispose()
        factory.dispose()
        eglBase.release()
    }

    private inner class Observer : PeerConnection.Observer {
        override fun onIceCandidate(candidate: IceCandidate) {
            signaling.sendIce(connectionId, candidate)
        }

        override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
            when (state) {
                PeerConnection.PeerConnectionState.CONNECTED -> {
                    signaling.sendConnected(connectionId)
                    onState(stateAfterPeerConnection(connected = true))
                }
                PeerConnection.PeerConnectionState.DISCONNECTED,
                PeerConnection.PeerConnectionState.FAILED,
                PeerConnection.PeerConnectionState.CLOSED,
                -> onState(stateAfterPeerConnection(connected = false))
                else -> Unit
            }
        }

        override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) = Unit
        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
        override fun onAddStream(stream: org.webrtc.MediaStream) = Unit
        override fun onRemoveStream(stream: org.webrtc.MediaStream) = Unit
        override fun onDataChannel(channel: org.webrtc.DataChannel) = Unit
        override fun onRenegotiationNeeded() = Unit
        override fun onAddTrack(
            receiver: org.webrtc.RtpReceiver,
            mediaStreams: Array<out org.webrtc.MediaStream>,
        ) = Unit
    }

    private companion object {
        const val TAG = "BeaconWebRtc"
    }
}

open class SimpleSdpObserver : SdpObserver {
    override fun onCreateSuccess(description: SessionDescription) = Unit
    override fun onSetSuccess() = Unit
    override fun onCreateFailure(error: String) = Unit
    override fun onSetFailure(error: String) = Unit
}
