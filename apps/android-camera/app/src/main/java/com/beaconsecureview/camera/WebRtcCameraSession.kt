package com.beaconsecureview.camera

import android.util.Log
import android.media.AudioManager
import android.media.ToneGenerator
import org.webrtc.AudioTrack
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.RtpTransceiver
import org.webrtc.MediaStreamTrack
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription

class WebRtcCameraSession(
    private val media: CameraMediaSource,
    servers: List<SignalingIceServer>,
    private val relayOnly: Boolean,
    private val connectionId: String,
    private val signaling: CameraSignalingClient,
    private val canListen: Boolean = true,
    private val onState: (StreamingState) -> Unit,
) {
    private val peer: PeerConnection
    private var acquired = false
    private var remoteTalkTrack: AudioTrack? = null
    private var talkEnabled = false
    private var closed = false
    private val tone = ToneGenerator(AudioManager.STREAM_MUSIC, 70)

    init {
        peer =
            requireNotNull(
                media.factory.createPeerConnection(
                    configuration(servers),
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
        media.audioTrack?.takeIf { canListen }?.let { audioTrack ->
            peer.addTransceiver(
                audioTrack,
                RtpTransceiver.RtpTransceiverInit(
                    RtpTransceiver.RtpTransceiverDirection.SEND_ONLY,
                    listOf("beacon-stream"),
                ),
            )
        }
        peer.addTransceiver(
            MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO,
            RtpTransceiver.RtpTransceiverInit(
                RtpTransceiver.RtpTransceiverDirection.RECV_ONLY,
                listOf("beacon-talk"),
            ),
        )
    }

    fun start() {
        onState(StreamingState.Connecting)
        media.acquire()
        acquired = true
        offer(MediaConstraints())
    }

    /**
     * The viewer's network changed or its relay credentials ran out: take the fresh servers and offer again with
     * new ICE credentials, keeping the same media session (V21, V65).
     */
    fun restartIce(servers: List<SignalingIceServer>) {
        if (closed) return
        peer.setConfiguration(configuration(servers))
        offer(
            MediaConstraints().apply {
                mandatory.add(MediaConstraints.KeyValuePair("IceRestart", "true"))
            },
        )
    }

    private fun configuration(servers: List<SignalingIceServer>) =
        PeerConnection.RTCConfiguration(servers.toIceServers()).apply {
            iceTransportsType =
                if (relayOnly) {
                    PeerConnection.IceTransportsType.RELAY
                } else {
                    PeerConnection.IceTransportsType.ALL
                }
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }

    private fun offer(constraints: MediaConstraints) {
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
            constraints,
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

    fun setTalkEnabled(enabled: Boolean) {
        if (talkEnabled == enabled) return
        talkEnabled = enabled
        remoteTalkTrack?.setEnabled(enabled)
        tone.startTone(
            if (enabled) ToneGenerator.TONE_PROP_BEEP else ToneGenerator.TONE_PROP_BEEP2,
            140,
        )
    }

    @Synchronized
    fun close() {
        if (closed) return
        closed = true
        setTalkEnabled(false)
        remoteTalkTrack = null
        peer.close()
        peer.dispose()
        if (acquired) {
            acquired = false
            media.release()
        }
        tone.release()
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
        ) {
            (receiver.track() as? AudioTrack)?.let { track ->
                remoteTalkTrack = track
                track.setEnabled(talkEnabled)
            }
        }
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

private fun List<SignalingIceServer>.toIceServers(): List<PeerConnection.IceServer> =
    map {
        PeerConnection.IceServer.builder(it.urls)
            .setUsername(it.username ?: "")
            .setPassword(it.credential ?: "")
            .createIceServer()
    }
