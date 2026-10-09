package com.beaconsecureview.camera

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.view.ViewGroup
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import java.io.File
import java.io.FileOutputStream
import java.time.LocalDateTime
import org.webrtc.SurfaceViewRenderer

/**
 * The live picture with pinch-to-zoom, drag-to-pan, and double-tap to reset (ADR 0090, Android in
 * ADR 0095). The renderer is transformed in place, so no frames are re-encoded. TalkBack gets the
 * same actions as custom actions.
 */
@Composable
internal fun ZoomableVideo(
    renderer: SurfaceViewRenderer,
    generation: Int,
    cameraKey: String,
    zoom: ZoomState,
    onZoom: (ZoomState) -> Unit,
    description: String,
    modifier: Modifier = Modifier,
) {
    var width by remember { mutableStateOf(1f) }
    var height by remember { mutableStateOf(1f) }
    val latest by rememberUpdatedZoom(zoom)
    Box(
        modifier =
            modifier
                .clipToBounds()
                .onSizeChanged {
                    width = it.width.toFloat().coerceAtLeast(1f)
                    height = it.height.toFloat().coerceAtLeast(1f)
                }
                .pointerInput(width, height) {
                    detectTransformGestures { centroid, pan, gestureZoom, _ ->
                        var next = latest
                        if (gestureZoom != 1f) next = zoomAt(next, gestureZoom, centroid.x, centroid.y, width, height)
                        if (pan != Offset.Zero) next = panBy(next, pan.x, pan.y, width, height)
                        if (next != latest) onZoom(next)
                    }
                }
                .pointerInput(Unit) {
                    detectTapGestures(onDoubleTap = { if (latest.zoomed) onZoom(ZoomState.Identity) })
                }
                .semantics {
                    contentDescription = description
                    customActions =
                        listOf(
                            CustomAccessibilityAction("Zoom in") {
                                onZoom(zoomAt(latest, 1.5f, width / 2, height / 2, width, height))
                                true
                            },
                            CustomAccessibilityAction("Zoom out") {
                                onZoom(zoomAt(latest, 1f / 1.5f, width / 2, height / 2, width, height))
                                true
                            },
                            CustomAccessibilityAction("Reset zoom") {
                                onZoom(ZoomState.Identity)
                                true
                            },
                        )
                },
    ) {
        key(cameraKey, generation) {
            AndroidView(
                factory = {
                    (renderer.parent as? ViewGroup)?.removeView(renderer)
                    renderer
                },
                update = {
                    it.pivotX = 0f
                    it.pivotY = 0f
                    it.scaleX = zoom.scale
                    it.scaleY = zoom.scale
                    it.translationX = zoom.x
                    it.translationY = zoom.y
                },
                modifier = Modifier.matchParentSize(),
            )
        }
    }
}

/** Gesture callbacks outlive recompositions; read the current zoom through a stable holder. */
@Composable
private fun rememberUpdatedZoom(zoom: ZoomState): androidx.compose.runtime.State<ZoomState> {
    val holder = remember { mutableStateOf(zoom) }
    holder.value = zoom
    return holder
}

/**
 * The talk control: tap to start and stop, or hold to talk only while pressed (ADR 0090). A touch
 * that is cancelled (a permission sheet appearing) counts as a release.
 */
@Composable
internal fun TalkTouchTarget(
    push: PushToTalk,
    enabled: Boolean,
    description: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(
        modifier =
            modifier
                .clip(RoundedCornerShape(999.dp))
                .pointerInput(enabled) {
                    if (!enabled) return@pointerInput
                    awaitEachGesture {
                        awaitFirstDown()
                        push.press()
                        waitForUpOrCancellation()
                        push.release()
                    }
                }
                .semantics {
                    role = Role.Button
                    contentDescription = description
                    onClick(label = description) {
                        if (enabled) push.tap()
                        enabled
                    }
                },
        contentAlignment = Alignment.Center,
    ) {
        content()
    }
}

/** Saves a snapshot of the picture on this device only. */
internal object SnapshotSaver {
    /** Asks the renderer for its next frame, at full size. The bitmap arrives on the render thread. */
    fun capture(renderer: SurfaceViewRenderer, onFrame: (Bitmap) -> Unit) {
        renderer.addFrameListener({ bitmap -> onFrame(bitmap) }, 1f)
    }

    fun save(context: Context, bitmap: Bitmap, cameraName: String, at: LocalDateTime = LocalDateTime.now()): Boolean =
        runCatching {
            val fileName = snapshotFileName(cameraName, at)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = context.contentResolver
                val values =
                    ContentValues().apply {
                        put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
                        put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                        put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Beacon")
                        put(MediaStore.Images.Media.IS_PENDING, 1)
                    }
                val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
                val written =
                    resolver.openOutputStream(uri)?.use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } ?: false
                if (!written) {
                    resolver.delete(uri, null, null)
                    return false
                }
                values.clear()
                values.put(MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                true
            } else {
                // Before Android 10 a gallery write needs a broad storage permission; keep the file in
                // Beacon's own folder instead, which needs none.
                val directory =
                    File(context.getExternalFilesDir(Environment.DIRECTORY_PICTURES), "Beacon").apply { mkdirs() }
                FileOutputStream(File(directory, fileName)).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
        }.getOrDefault(false)
}
