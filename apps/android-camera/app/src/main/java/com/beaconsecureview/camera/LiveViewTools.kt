package com.beaconsecureview.camera

import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import kotlin.math.max
import kotlin.math.min

/**
 * Zoom and pan for the live view (ADR 0090, Android in ADR 0095). Mirrors the web viewer's
 * `video-zoom.ts`: the picture is scaled about the frame's top-left corner, so a zoom state is just
 * a scale and an offset, and the math stays small and testable.
 */
internal data class ZoomState(val scale: Float = 1f, val x: Float = 0f, val y: Float = 0f) {
    val zoomed: Boolean get() = scale > MIN_SCALE

    companion object {
        const val MIN_SCALE = 1f
        const val MAX_SCALE = 6f
        val Identity = ZoomState()
    }
}

/** Keeps the zoomed picture covering the whole frame: no empty margins. */
internal fun clampZoom(state: ZoomState, width: Float, height: Float): ZoomState {
    val scale = min(ZoomState.MAX_SCALE, max(ZoomState.MIN_SCALE, state.scale))
    if (scale == ZoomState.MIN_SCALE) return ZoomState.Identity
    return ZoomState(
        scale = scale,
        x = min(0f, max(width - scale * width, state.x)),
        y = min(0f, max(height - scale * height, state.y)),
    )
}

/** Zooms by [factor] keeping the picture under ([px], [py]) where it is. */
internal fun zoomAt(
    state: ZoomState,
    factor: Float,
    px: Float,
    py: Float,
    width: Float,
    height: Float,
): ZoomState {
    val scale = min(ZoomState.MAX_SCALE, max(ZoomState.MIN_SCALE, state.scale * factor))
    val ratio = scale / state.scale
    return clampZoom(
        ZoomState(scale, px - (px - state.x) * ratio, py - (py - state.y) * ratio),
        width,
        height,
    )
}

internal fun panBy(state: ZoomState, dx: Float, dy: Float, width: Float, height: Float): ZoomState =
    if (!state.zoomed) state else clampZoom(state.copy(x = state.x + dx, y = state.y + dy), width, height)

/**
 * Hold-to-talk (ADR 0090). One control does both jobs people expect:
 * - tap: talking turns on and stays on until tapped again
 * - hold: talking lasts only while the button is held
 *
 * A press that lasts at least [HOLD_MILLIS] is a hold; release then ends the talk. A shorter press
 * leaves it on. Mirrors the web viewer's `push-to-talk.ts`.
 */
internal class PushToTalk(
    private val talking: () -> Boolean,
    private val start: () -> Unit,
    private val stop: () -> Unit,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private var pressedAt: Long? = null
    private var startedByPress = false

    /** The button went down. */
    fun press() {
        if (pressedAt != null) return
        pressedAt = now()
        if (talking()) {
            // Pressing while talking ends it (tap to stop).
            startedByPress = false
            stop()
            return
        }
        startedByPress = true
        start()
    }

    /** The button came up, or the touch was cancelled. */
    fun release() {
        val down = pressedAt
        pressedAt = null
        if (down == null || !startedByPress) return
        startedByPress = false
        if (now() - down >= HOLD_MILLIS) stop()
    }

    /** A tap without a pointer, such as TalkBack's double tap. */
    fun tap() {
        press()
        release()
    }

    companion object {
        const val HOLD_MILLIS = 400L
    }
}

/**
 * Snapshots are saved on this device only (ADR 0090): never uploaded, never sent to Beacon. The
 * file name carries the camera and the time, with anything a file system dislikes removed.
 */
internal fun snapshotFileName(cameraName: String, at: LocalDateTime): String {
    val name =
        cameraName.replace(Regex("[^\\p{L}\\p{N} _-]"), "").trim().replace(Regex("\\s+"), " ").take(40)
            .ifEmpty { "Camera" }
    return "Beacon $name ${at.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH-mm-ss"))}.png"
}
