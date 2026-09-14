package com.beaconsecureview.camera

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Android entry point for Firebase Cloud Messaging.
 *
 * Token registration and user-visible notifications intentionally stay disabled until the
 * authenticated subscription API, consent UI, private lock-screen copy, and revocation path are
 * implemented together. Keeping this service small proves the Firebase transport integration
 * without silently enrolling a device or changing camera behavior.
 */
class BeaconFirebaseMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        // Foreground delivery is intentionally inert until notification policy and navigation are
        // implemented. Background notification payloads remain handled by the Firebase SDK.
    }
}
