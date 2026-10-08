package com.beaconsecureview.camera

import android.app.PictureInPictureParams
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.PackageManager
import android.os.Build
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.core.app.PictureInPictureModeChangedInfo
import androidx.core.util.Consumer

/*
 * Picture-in-picture for the live view (ADR 0088): the camera keeps playing
 * in a small floating window while you use other apps. It lives entirely in
 * the live view, using the activity's listener APIs, so no other screen
 * changes and nothing floats unless a camera is actually playing.
 */

internal fun Context.findComponentActivity(): ComponentActivity? {
    var current: Context? = this
    while (current is ContextWrapper) {
        if (current is ComponentActivity) return current
        current = current.baseContext
    }
    return null
}

internal fun pictureInPictureSupported(context: Context): Boolean =
    context.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

/** Live cameras are 16:9; `autoEnter` floats the video when you leave the app
 * (Android 12+; older versions use [LivePictureInPictureEffect]'s leave hint). */
internal fun livePictureInPictureParams(autoEnter: Boolean): PictureInPictureParams =
    PictureInPictureParams.Builder()
        .setAspectRatio(Rational(16, 9))
        .apply {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setAutoEnterEnabled(autoEnter)
                setSeamlessResizeEnabled(false)
            }
        }.build()

/** Floats the live video now. False when the person turned PiP off for
 * Beacon in system settings, or the device can't. */
internal fun enterLivePictureInPicture(activity: ComponentActivity): Boolean =
    runCatching { activity.enterPictureInPictureMode(livePictureInPictureParams(autoEnter = true)) }
        .getOrDefault(false)

/** Whether the activity is showing in a floating window right now. */
@Composable
internal fun rememberInPictureInPicture(activity: ComponentActivity?): Boolean {
    var inPictureInPicture by remember(activity) {
        mutableStateOf(activity?.isInPictureInPictureMode == true)
    }
    DisposableEffect(activity) {
        val listener =
            Consumer<PictureInPictureModeChangedInfo> { info ->
                inPictureInPicture = info.isInPictureInPictureMode
            }
        activity?.addOnPictureInPictureModeChangedListener(listener)
        onDispose { activity?.removeOnPictureInPictureModeChangedListener(listener) }
    }
    return inPictureInPicture
}

/** While a camera plays, leaving the app floats it instead of stopping it.
 * Leaving the live view turns that off again. */
@Composable
internal fun LivePictureInPictureEffect(activity: ComponentActivity?, playing: Boolean) {
    DisposableEffect(activity, playing) {
        if (activity == null || !pictureInPictureSupported(activity)) {
            return@DisposableEffect onDispose {}
        }
        runCatching { activity.setPictureInPictureParams(livePictureInPictureParams(autoEnter = playing)) }
        // Android 8-11 have no auto-enter: float on the "user is leaving" hint.
        val leaving =
            Runnable {
                if (playing && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
                    enterLivePictureInPicture(activity)
                }
            }
        activity.addOnUserLeaveHintListener(leaving)
        onDispose {
            activity.removeOnUserLeaveHintListener(leaving)
            runCatching { activity.setPictureInPictureParams(livePictureInPictureParams(autoEnter = false)) }
        }
    }
}
