package com.beaconsecureview.camera

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Android entry point for Firebase Cloud Messaging.
 *
 * Enrollment remains disabled until an authenticated user opts in. This service accepts only
 * Beacon's versioned, generic data categories and never trusts provider text for lock-screen copy.
 */
class BeaconFirebaseMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(firebaseMessagingToken: String) {
        val consent = NotificationConsentStore(this)
        val session = AccountSessionStore(this).read()
        if (!consent.enabled || session == null) return
        val beaconInstallationId =
            getSharedPreferences("beacon_installation", MODE_PRIVATE)
                .getString("installation_id", null) ?: return
        scope.launch {
            runCatching {
                val id = BeaconApi(BuildConfig.BEACON_API_URL)
                    .registerFcmSubscription(session.token, beaconInstallationId, firebaseMessagingToken)
                consent.enable(id)
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (
            !NotificationConsentStore(this).enabled ||
                AccountSessionStore(this).read() == null ||
                message.data["version"] != "1"
        ) return
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        ) return
        val body = when (message.data["category"]) {
            "motion" -> "Beacon detected activity."
            "offline" -> "A Beacon camera needs attention."
            "recovered" -> "A Beacon camera is back online."
            "health" -> "A Beacon camera has a battery or heat warning."
            "security" -> "A security event occurred on your Beacon account."
            else -> return
        }
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Camera alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Private activity and camera availability alerts"
                },
            )
        }
        // Tapping an alert opens the camera it was about (ADR 0090). The push itself stays
        // generic: only the opaque event ID travels, and the app asks the server what it means.
        val eventId = message.data["eventId"]
        val intent =
            if (eventId != null && eventId.matches(EVENT_ID)) {
                LaunchIntents.alertIntent(this, eventId)
            } else {
                Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
        // One request code per alert, so a later alert never rewrites an earlier one's target.
        val pendingIntent = PendingIntent.getActivity(
            this,
            eventId?.hashCode() ?: 0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        manager.notify(
            message.data["eventId"]?.hashCode() ?: body.hashCode(),
            NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_beacon_mark)
                .setContentTitle("Beacon")
                .setContentText(body)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .build(),
        )
    }

    private companion object {
        const val CHANNEL_ID = "beacon_camera_alerts"
        val EVENT_ID = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    }
}
