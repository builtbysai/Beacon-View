package com.beaconsecureview.camera

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * After the phone restarts (or the app is updated) a camera that was running is not running any more, and
 * Android 14 does not let an app start a camera foreground service in the background, so the camera cannot
 * quietly come back. Capture must always be visible to the person with the phone (AGENTS.md), so instead of
 * starting by itself the app says the camera is off and lets them turn it on with a tap (V50).
 */
internal object BootResume {
    private const val PREFERENCES = "beacon_camera_runtime"
    private const val SHOULD_RUN = "camera_should_run"
    private const val CHANNEL_ID = "beacon_camera_resume"
    private const val NOTIFICATION_ID = 1002

    /** The person turned the camera on (true) or off (false). A system kill or restart leaves it as it was. */
    fun remember(context: Context, running: Boolean) {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putBoolean(SHOULD_RUN, running).apply()
        if (running) {
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIFICATION_ID)
        }
    }

    fun shouldRemind(cameraWasOn: Boolean, paired: Boolean): Boolean = cameraWasOn && paired

    fun remindIfNeeded(context: Context) {
        val wasOn = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getBoolean(SHOULD_RUN, false)
        if (!shouldRemind(wasOn, paired = CredentialStore(context).read() != null)) return
        if (
            Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Camera is off", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Tells you when this phone's camera stopped after a restart"
                },
            )
        }
        val open =
            PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        manager.notify(
            NOTIFICATION_ID,
            NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.presence_video_away)
                .setContentTitle("Beacon camera is off")
                .setContentText("This phone restarted, so the camera stopped. Tap to turn it back on.")
                .setContentIntent(open)
                .setAutoCancel(true)
                .build(),
        )
    }
}

/** Receives the restart and app-update broadcasts and does nothing but remind (see [BootResume]). */
class BootResumeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            BootResume.remindIfNeeded(context)
        }
    }
}
