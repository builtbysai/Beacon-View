package com.beaconsecureview.camera

import android.content.Context
import com.google.android.gms.tasks.Task
import com.google.firebase.messaging.FirebaseMessaging
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

/**
 * Phone alerts (ADR 0121). The web app owns the account side: it asks the app for a Firebase token, registers it with
 * the signed-in session, and tells the app the subscription id. The app only keeps whether alerts are on, so it never
 * shows an alert the person turned off, and whether Firebase changed the token since the web app last registered it.
 */
class NotificationConsentStore(context: Context) {
    private val preferences = context.getSharedPreferences("beacon_notification_consent", Context.MODE_PRIVATE)

    val enabled: Boolean get() = preferences.getBoolean(ENABLED, false)
    val subscriptionId: String? get() = preferences.getString(SUBSCRIPTION_ID, null)

    /** Firebase handed out a new token after the web app registered the old one; the web app registers it next time. */
    val tokenStale: Boolean get() = preferences.getBoolean(TOKEN_STALE, false)

    fun enable(subscriptionId: String) {
        preferences.edit().putBoolean(ENABLED, true).putString(SUBSCRIPTION_ID, subscriptionId).putBoolean(TOKEN_STALE, false).apply()
    }

    fun disable() {
        preferences.edit().putBoolean(ENABLED, false).remove(SUBSCRIPTION_ID).putBoolean(TOKEN_STALE, false).apply()
    }

    fun markTokenStale() {
        preferences.edit().putBoolean(TOKEN_STALE, true).apply()
    }

    private companion object {
        const val ENABLED = "enabled"
        const val SUBSCRIPTION_ID = "subscription_id"
        const val TOKEN_STALE = "token_stale"
    }
}

/** This installation's random id, made on first use: the camera screen and phone alerts both name this phone with it. */
internal fun installationId(context: Context): String {
    val preferences = context.getSharedPreferences("beacon_installation", Context.MODE_PRIVATE)
    return preferences.getString("installation_id", null)
        ?: UUID.randomUUID().toString().also { preferences.edit().putString("installation_id", it).apply() }
}

/** Turns Firebase messaging on and returns the token to register, or throws when Firebase cannot be reached. */
internal suspend fun firebaseMessagingToken(): String {
    val messaging = FirebaseMessaging.getInstance()
    messaging.isAutoInitEnabled = true
    try {
        messaging.register().await()
        return messaging.token.await()
    } catch (error: Throwable) {
        messaging.isAutoInitEnabled = false
        runCatching { messaging.unregister().await() }
        throw error
    }
}

/** Stops Firebase delivery on this phone. The web app removes the subscription from the account. */
internal suspend fun stopFirebaseMessaging(context: Context): String? {
    val consent = NotificationConsentStore(context)
    val subscriptionId = consent.subscriptionId
    consent.disable()
    val messaging = FirebaseMessaging.getInstance()
    messaging.isAutoInitEnabled = false
    runCatching { messaging.unregister().await() }
    return subscriptionId
}

private suspend fun <T> Task<T>.await(): T = suspendCoroutine { continuation ->
    addOnSuccessListener { continuation.resume(it) }
    addOnFailureListener { continuation.resumeWithException(it) }
    addOnCanceledListener { continuation.resumeWithException(IllegalStateException("Operation cancelled")) }
}
