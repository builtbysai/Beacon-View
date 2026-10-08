package com.beaconsecureview.camera

import org.webrtc.RTCStats
import org.webrtc.RTCStatsReport
import kotlin.math.roundToInt

/** Mirrors the PWA's `StreamQuality` (live-video-quality.ts) exactly, including
 * field names and units, so `NativeLiveView.kt`'s stats panel reads identically
 * to `LiveVideo.tsx`'s. */
internal data class StreamQuality(
    val bitrateKbps: Int,
    val fps: Int,
    val jitterMs: Int,
    val lostPackets: Int,
    val path: String,
    val rttMs: Int,
)

internal data class PreviousInboundBytes(val bytes: Long, val timestampUs: Double)

/** Verbatim port of `readStreamQuality` (live-video-quality.ts): finds the
 * inbound video RTP stats and the currently-selected candidate pair, derives
 * a bitrate from the delta against the previous sample, and classifies the
 * path as direct/relay/unknown from the selected pair's candidate types. */
internal fun readStreamQuality(
    report: RTCStatsReport,
    prior: PreviousInboundBytes?,
): Pair<PreviousInboundBytes, StreamQuality>? {
    var inbound: RTCStats? = null
    var selectedPair: RTCStats? = null
    for (stat in report.statsMap.values) {
        val kind = stat.members["kind"] as? String ?: stat.members["mediaType"] as? String
        if (stat.type == "inbound-rtp" && kind == "video") inbound = stat
        if (stat.type == "candidate-pair") {
            val state = stat.members["state"] as? String
            val nominated = stat.members["nominated"] as? Boolean ?: false
            val selected = stat.members["selected"] as? Boolean ?: false
            if (state == "succeeded" && (nominated || selected)) selectedPair = stat
        }
    }
    val inboundStat = inbound ?: return null
    val bytesReceived = (inboundStat.members["bytesReceived"] as? Number)?.toLong() ?: 0L
    val timestampUs = inboundStat.timestampUs
    val bitrateKbps =
        if (prior != null && timestampUs > prior.timestampUs) {
            val deltaBytes = bytesReceived - prior.bytes
            val deltaMs = (timestampUs - prior.timestampUs) / 1_000.0
            (((deltaBytes * 8) / deltaMs)).roundToInt().coerceAtLeast(0)
        } else {
            0
        }
    val remoteId = selectedPair?.members?.get("remoteCandidateId") as? String
    val localId = selectedPair?.members?.get("localCandidateId") as? String
    val remote = remoteId?.let { report.statsMap[it] }
    val local = localId?.let { report.statsMap[it] }
    val remoteType = remote?.members?.get("candidateType") as? String
    val localType = local?.members?.get("candidateType") as? String
    val path =
        when {
            remoteType == "relay" || localType == "relay" -> "TURN relay"
            remote != null && local != null -> "Direct"
            else -> "Checking connection"
        }
    val fps = ((inboundStat.members["framesPerSecond"] as? Number)?.toDouble() ?: 0.0).roundToInt()
    val jitterMs = (((inboundStat.members["jitter"] as? Number)?.toDouble() ?: 0.0) * 1_000).roundToInt()
    val lostPackets = (inboundStat.members["packetsLost"] as? Number)?.toInt() ?: 0
    val rttMs = (((selectedPair?.members?.get("currentRoundTripTime") as? Number)?.toDouble() ?: 0.0) * 1_000).roundToInt()
    return PreviousInboundBytes(bytesReceived, timestampUs) to
        StreamQuality(bitrateKbps = bitrateKbps, fps = fps, jitterMs = jitterMs, lostPackets = lostPackets, path = path, rttMs = rttMs)
}
