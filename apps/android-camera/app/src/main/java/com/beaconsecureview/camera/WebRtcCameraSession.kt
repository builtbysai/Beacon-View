package com.beaconsecureview.camera

import android.util.Log
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription

class WebRtcCameraSession(
    private val media: CameraMediaSource,
    servers: List<SignalingIceServer>,
    relayOnly: Boolean,
    private val connectionId: String,
    private val signaling: CameraSignalingClient,
    private val onState: (StreamingState) -> Unit,
) {
    private val peer: PeerConnection
    private var acquired = false

    init {
        val iceServers =
            servers.map {
                PeerConnection.IceServer.builder(it.urls)
                    .setUsername(it.username ?: "")
                    .setPassword(it.credential ?: "")
                    .createIceServer()
            }
        peer =
            requireNotNull(
                media.factory.createPeerConnection(
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
            media.track,
            RtpTransceiver.RtpTransceiverInit(
                RtpTransceiver.RtpTransceiverDirection.SEND_ONLY,
                listOf("beacon-stream"),
            ),
        )
    }

    fun start() {
        onState(StreamingState.Connecting)
        media.acquire()
        acquired = true
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
        peer.close()
        if (acquired) {
            acquired = false
            media.release()
        }
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
