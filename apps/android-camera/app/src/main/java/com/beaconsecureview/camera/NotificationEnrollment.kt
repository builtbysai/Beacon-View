package com.beaconsecureview.camera

import android.content.Context
import com.google.android.gms.tasks.Task
import com.google.firebase.messaging.FirebaseMessaging
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

class NotificationConsentStore(context: Context) {
    private val preferences = context.getSharedPreferences("beacon_notification_consent", Context.MODE_PRIVATE)

    val enabled: Boolean get() = preferences.getBoolean(ENABLED, false)
    val subscriptionId: String? get() = preferences.getString(SUBSCRIPTION_ID, null)

    fun enable(subscriptionId: String) {
        preferences.edit().putBoolean(ENABLED, true).putString(SUBSCRIPTION_ID, subscriptionId).apply()
    }

    fun disable() {
        preferences.edit().putBoolean(ENABLED, false).remove(SUBSCRIPTION_ID).apply()
    }

    fun mute() {
        preferences.edit().putBoolean(ENABLED, false).apply()
    }

    private companion object {
        const val ENABLED = "enabled"
        const val SUBSCRIPTION_ID = "subscription_id"
    }
}

internal suspend fun enableAndroidNotifications(
    context: Context,
    api: BeaconApi,
    session: BeaconApi.AccountSession,
): String {
    val messaging = FirebaseMessaging.getInstance()
    messaging.isAutoInitEnabled = true
    try {
        messaging.register().await()
        val firebaseMessagingToken = messaging.token.await()
        val installationId =
            context.getSharedPreferences("beacon_installation", Context.MODE_PRIVATE)
                .getString("installation_id", null)
                ?: throw IllegalStateException("This installation is not ready")
        val subscriptionId =
            api.registerFcmSubscription(session.token, installationId, firebaseMessagingToken)
        NotificationConsentStore(context).enable(subscriptionId)
        return subscriptionId
    } catch (error: Throwable) {
        NotificationConsentStore(context).disable()
        messaging.isAutoInitEnabled = false
        runCatching { messaging.unregister().await() }
        throw error
    }
}

internal suspend fun disableAndroidNotifications(
    context: Context,
    api: BeaconApi,
    session: BeaconApi.AccountSession?,
) {
    val consent = NotificationConsentStore(context)
    val subscriptionId = consent.subscriptionId
    consent.disable()
    val messaging = FirebaseMessaging.getInstance()
    messaging.isAutoInitEnabled = false
    runCatching { messaging.unregister().await() }
    if (session != null && subscriptionId != null) {
        runCatching { api.revokeNotificationSubscription(session.token, subscriptionId) }
    }
}

private suspend fun <T> Task<T>.await(): T = suspendCoroutine { continuation ->
    addOnSuccessListener { continuation.resume(it) }
    addOnFailureListener { continuation.resumeWithException(it) }
    addOnCanceledListener { continuation.resumeWithException(IllegalStateException("Operation cancelled")) }
}
