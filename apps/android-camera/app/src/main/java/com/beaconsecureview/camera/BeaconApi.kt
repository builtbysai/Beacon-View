package com.beaconsecureview.camera

import org.json.JSONArray
import org.json.JSONObject
import android.util.Base64
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class AuthorizationLostException : IllegalStateException()

class PairingException(message: String) : IllegalStateException(message)

class BeaconApi(private val baseUrl: String) {
    fun googleSignInAvailable(): Boolean {
        val connection = connection("/api/capabilities", "GET")
        val body = responseBody(connection)
        if (connection.responseCode != HttpURLConnection.HTTP_OK) return true
        return JSONObject(body).optJSONObject("auth")?.optBoolean("google", true) ?: true
    }

    data class AccountSession(
        val token: String,
        val userId: String,
        val email: String? = null,
        val householdRole: String? = null,
    )

    data class HouseholdSummary(
        val id: String,
        val name: String,
        val role: String,
    )

    data class CameraGrant(
        val cameraId: String,
        val cameraName: String,
        val canListen: Boolean,
        val canTalk: Boolean,
        val canFlip: Boolean,
        val canPause: Boolean,
    )

    data class HouseholdMember(
        val id: String,
        val userId: String,
        val email: String,
        val role: String,
        val status: String,
        val grants: List<CameraGrant> = emptyList(),
    )

    data class HouseholdInvitation(
        val id: String,
        val invitedEmail: String,
        val role: String,
        val expiresAt: String,
    )

    data class HouseholdSharing(
        val members: List<HouseholdMember>,
        val invitations: List<HouseholdInvitation>,
    )

    data class CreatedInvitation(
        val id: String,
        val token: String,
        val expiresAt: String,
    )

    data class BrowserSessionSummary(
        val id: String,
        val userAgent: String,
        val current: Boolean,
        val lastSeenAt: String,
        val createdAt: String,
    )

    data class AccountDetails(
        val email: String,
        val emailVerified: Boolean,
        val googleLinked: Boolean,
        val hasPassword: Boolean,
    )

    data class DriveStatus(
        val connected: Boolean,
        val configured: Boolean,
        val recordingsConnected: Boolean,
        val providerEmail: String?,
        // Google stopped accepting the connection, so it must be connected again (V87).
        val expired: Boolean = false,
    )

    data class MonitorCamera(
        val id: String,
        val name: String,
        val deviceName: String,
        val online: Boolean,
        val privacyMode: Boolean,
        val viewerCount: Int,
        val deviceId: String = id,
        val facing: String = "unknown",
        val available: Boolean = online,
        val platform: String = "android",
        val credentialRevoked: Boolean = false,
        val needsPairing: Boolean = false,
    )

    data class AccessEvent(
        val actorEmail: String?,
        val cameraName: String?,
        val deviceName: String?,
        val eventType: String,
        val occurredAt: String,
        val success: Boolean,
        val reason: String?,
    )

    /** Mirrors the PWA's `Device` domain type as returned by `GET /api/devices`
     * -- distinct from `MonitorCamera` (`/api/cameras`), which is camera-
     * source-centric and doesn't carry battery/health/software/revoked
     * state at all. The Camera Device Settings screen needs both: cameras
     * for the per-source list, this for the device-level health summary,
     * attention guidance, and device information. */
    data class Device(
        val id: String,
        val name: String,
        val platform: String,
        val deviceType: String,
        val enabled: Boolean,
        val privacyMode: Boolean,
        val revoked: Boolean,
        val online: Boolean,
        val connectionState: String,
        val lastSeenAt: String?,
        val healthReportedAt: String?,
        val softwareVersion: String?,
        val batteryPercent: Int?,
        val batteryCharging: Boolean,
        val canRemove: Boolean,
        val capabilities: Map<String, Any?>,
    )

    data class MotionEvent(
        val id: String,
        val cameraId: String,
        val cameraName: String,
        val deviceName: String,
        val confidence: Double,
        val occurredAt: String,
        val recordingId: String? = null,
        val recordingStatus: String? = null,
    )

    data class MotionEventPage(
        val events: List<MotionEvent>,
        val nextCursor: String?,
    )

    /** Mirrors the PWA's `HouseholdEvent`: the household-wide audit feed
     * shown alongside motion events in the Activity feed (owner/admin only,
     * see `/api/activity`) -- distinct from `AccessEvent`/`/api/access-history`,
     * which is Settings > Security's narrower "signed-in access" log. */
    data class HouseholdActivityEvent(
        val id: String,
        val actorEmail: String?,
        val deviceName: String?,
        val cameraSourceId: String?,
        val sourceName: String?,
        val eventType: String,
        val occurredAt: String,
        val success: Boolean,
        val metadata: Map<String, String>,
    )

    data class HouseholdActivityPage(
        val events: List<HouseholdActivityEvent>,
        val total: Int,
    )

    data class CameraMotionSettings(
        val cameraId: String,
        val enabled: Boolean,
        val recordOnMotion: Boolean,
        val sensitivity: MotionSensitivity,
        val cooldownSeconds: Int,
        val quietHours: QuietHours?,
        // Edited from the live view (ADR 0092); this app only carries them, and
        // the server keeps them when a save omits them.
        val ignoredZones: Set<Int> = emptySet(),
    )

    data class RecordingSummary(
        val id: String,
        val cameraId: String,
        val cameraName: String,
        val deviceName: String,
        val status: String,
        val durationMs: Long?,
        val createdAt: String,
        val triggerMotionEventId: String?,
        val hasThumbnail: Boolean,
    )

    data class RecordingPage(
        val recordings: List<RecordingSummary>,
        val nextCursor: String?,
    )

    data class PlaybackRecording(
        val file: File,
        val mimeType: String,
    )

    /** Best-effort clip decoration, not part of the recording lifecycle --
     * see [downloadRecordingThumbnail]. Callers must delete [file] once shown. */
    data class RecordingThumbnail(
        val file: File,
        val mimeType: String,
    )

    data class RecordingShareLink(
        val token: String,
        val url: String,
        val expiresAt: String,
    )

    data class ActiveRecordingShareLink(
        val id: String,
        val expiresAt: String,
    )

    data class CameraSynchronization(
        val cameras: List<CameraSource>,
        val privacyMode: Boolean,
    )

    data class CameraSource(
        val id: String,
        val sourceKey: String,
        val name: String,
        val facing: String,
    )

    data class NotificationPreference(
        val deviceId: String,
        val deviceName: String,
        val motionEnabled: Boolean,
        val offlineEnabled: Boolean,
        val quietHours: QuietHours?,
    )
    fun register(installationId: String, name: String, pairingCode: String): String {
        val connection = connection("/api/devices/register", "POST")
        val payload =
            JSONObject()
                .put("installationId", installationId)
                .put("name", name)
                .put("pairingCode", pairingCode)
                .toString()
        connection.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        if (connection.responseCode != HttpURLConnection.HTTP_CREATED) {
            throw PairingException(
                when (connection.responseCode) {
                    HttpURLConnection.HTTP_BAD_REQUEST ->
                        "That code expired or was already used. Create a new code and try again."
                    429 -> "Too many attempts. Wait a few minutes, then create a new code."
                    else -> "Beacon could not complete pairing. Check the connection and try again."
                },
            )
        }
        return JSONObject(body).getString("credential")
    }

    fun createPairingCode(sessionToken: String): String {
        val connection = connection("/api/pairing-codes", "POST")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_CREATED) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(
                serverMessage?.takeIf(String::isNotBlank)
                    ?: "Beacon could not prepare camera setup",
            )
        }
        return JSONObject(body).getString("code")
    }

    /** Mirrors the PWA's device-specific reconnect flow (`reconnectDevice` in
     * App.tsx): a fresh code targeted at an *existing* device record, so the
     * camera keeps its history and settings instead of becoming a brand new
     * device the way the generic [createPairingCode] flow would. */
    fun reconnectDevicePairingCode(sessionToken: String, deviceId: String): String {
        val connection = connection("/api/devices/${urlPathSegment(deviceId)}/pairing-code", "POST")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_CREATED) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(serverMessage?.takeIf(String::isNotBlank) ?: "A new pairing code could not be created")
        }
        return JSONObject(body).getString("code")
    }

    fun login(email: String, password: String): AccountSession {
        val connection = connection("/api/mobile/auth/login", "POST")
        connection.outputStream.use {
            it.write(
                JSONObject().put("email", email).put("password", password).toString()
                    .toByteArray(Charsets.UTF_8),
            )
        }
        val body = responseBody(connection)
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException(
                if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
                    "Email or password is incorrect"
                } else {
                    "Beacon could not sign in. Check the connection and try again."
                },
            )
        }
        val response = JSONObject(body)
        val user = response.getJSONObject("user")
        return AccountSession(
            token = response.getString("sessionToken"),
            userId = user.getString("id"),
            email = user.optString("email").takeIf(String::isNotBlank),
        )
    }

    fun createAccount(email: String, password: String): AccountSession {
        val connection = connection("/api/mobile/auth/register", "POST")
        connection.outputStream.use {
            it.write(
                JSONObject().put("email", email).put("password", password).toString()
                    .toByteArray(Charsets.UTF_8),
            )
        }
        val body = responseBody(connection)
        if (connection.responseCode != HttpURLConnection.HTTP_CREATED) {
            val error = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(
                when {
                    connection.responseCode == HttpURLConnection.HTTP_BAD_REQUEST ->
                        "Use a valid email and a password of at least 12 characters"
                    connection.responseCode == HttpURLConnection.HTTP_CONFLICT && error == "googleAccountExists" ->
                        "This email already uses Google. Continue with Google instead."
                    connection.responseCode == HttpURLConnection.HTTP_CONFLICT ->
                        "An account with this email already exists"
                    connection.responseCode == 429 ->
                        "Too many account attempts. Wait before trying again."
                    else -> "Beacon could not create your account. Check the connection and try again."
                },
            )
        }
        val response = JSONObject(body)
        val user = response.getJSONObject("user")
        return AccountSession(
            token = response.getString("sessionToken"),
            userId = user.getString("id"),
            email = user.optString("email").takeIf(String::isNotBlank),
        )
    }

    fun requestPasswordReset(email: String) {
        val connection = connection("/api/auth/password-reset/request", "POST")
        connection.outputStream.use {
            it.write(JSONObject().put("email", email).toString().toByteArray(Charsets.UTF_8))
        }
        responseBody(connection)
        // Enumeration resistance: the UI intentionally presents the same result
        // for existing, Google-only, and unknown accounts. Only a service outage
        // needs a retry message; throttling is also expressed generically.
        if (connection.responseCode !in listOf(HttpURLConnection.HTTP_ACCEPTED, HttpURLConnection.HTTP_NO_CONTENT)) {
            throw IllegalStateException("Password reset is temporarily unavailable")
        }
    }

    fun exchangeGoogleSignIn(code: String, verifier: String): AccountSession {
        val connection = connection("/api/mobile/auth/google", "POST")
        connection.outputStream.use {
            it.write(
                JSONObject().put("code", code).put("verifier", verifier).toString().toByteArray(Charsets.UTF_8),
            )
        }
        val body = responseBody(connection)
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Google sign-in expired. Try again.")
        }
        val response = JSONObject(body)
        val user = response.getJSONObject("user")
        return AccountSession(
            token = response.getString("sessionToken"),
            userId = user.getString("id"),
            email = user.optString("email").takeIf(String::isNotBlank),
        )
    }

    fun currentAccount(sessionToken: String): AccountSession {
        val connection = connection("/api/auth/me", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Account details are temporarily unavailable")
        }
        val user = JSONObject(body).getJSONObject("user")
        val household = JSONObject(body).optJSONObject("household")
        return AccountSession(
            token = sessionToken,
            userId = user.getString("id"),
            email = user.optString("email").takeIf(String::isNotBlank),
            householdRole = household?.optString("role")?.takeIf(String::isNotBlank),
        )
    }

    /** The camera an alert was about, or null when it has none or is not visible to this user. */
    fun notificationEventCamera(sessionToken: String, eventId: String): String? {
        val connection = connection("/api/notification-events/${java.net.URLEncoder.encode(eventId, "UTF-8")}", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) return null
        return JSONObject(body).optString("cameraId").takeIf { it.isNotEmpty() && it != "null" }
    }

    fun listMonitorCameras(sessionToken: String): List<MonitorCamera> {
        val connection = connection("/api/cameras", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Cameras are temporarily unavailable")
        }
        val cameras = JSONObject(body).getJSONArray("cameras")
        return (0 until cameras.length()).map { index ->
            cameras.getJSONObject(index).let {
                MonitorCamera(
                    id = it.getString("id"),
                    name = it.getString("name"),
                    deviceName = it.getString("deviceName"),
                    online = it.getBoolean("online"),
                    privacyMode = it.optBoolean("privacyMode", false),
                    viewerCount = it.optInt("viewerCount", 0),
                    deviceId = it.getString("deviceId"),
                    facing = it.optString("facing", "unknown"),
                    available = it.optString("availability") == "available",
                    platform = it.optString("platform", "android"),
                    credentialRevoked = it.optBoolean("credentialRevoked", false),
                )
            }
        }
    }

    fun activateCamera(sessionToken: String, cameraId: String) {
        val connection = connection("/api/cameras/$cameraId/activate", "POST")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_ACCEPTED) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(serverMessage?.takeIf(String::isNotBlank) ?: "Could not switch camera")
        }
    }

    fun setDevicePrivacy(sessionToken: String, deviceId: String, enabled: Boolean) {
        val connection = connection("/api/devices/$deviceId/privacy", "PUT")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use {
            it.write(JSONObject().put("enabled", enabled).toString().toByteArray(Charsets.UTF_8))
        }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(serverMessage?.takeIf(String::isNotBlank) ?: "Could not change privacy mode")
        }
    }

    fun devices(sessionToken: String): List<Device> {
        val connection = connection("/api/devices", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Devices are temporarily unavailable")
        }
        val devices = JSONObject(body).getJSONArray("devices")
        return (0 until devices.length()).map { index -> parseDevice(devices.getJSONObject(index)) }
    }

    fun renameDevice(sessionToken: String, deviceId: String, name: String) {
        val connection = connection("/api/devices/${urlPathSegment(deviceId)}", "PATCH")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write(JSONObject().put("name", name).toString().toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(serverMessage?.takeIf(String::isNotBlank) ?: "This device could not be renamed")
        }
    }

    fun removeDevice(sessionToken: String, deviceId: String) {
        val connection = connection("/api/devices/${urlPathSegment(deviceId)}", "DELETE")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(serverMessage?.takeIf(String::isNotBlank) ?: "This camera could not be removed")
        }
    }

    fun renameCameraSource(sessionToken: String, cameraId: String, name: String) {
        val connection = connection("/api/cameras/${urlPathSegment(cameraId)}", "PATCH")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write(JSONObject().put("name", name).toString().toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(serverMessage?.takeIf(String::isNotBlank) ?: "This camera could not be renamed")
        }
    }

    fun removeCameraSource(sessionToken: String, cameraId: String) {
        val connection = connection("/api/cameras/${urlPathSegment(cameraId)}", "DELETE")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(serverMessage?.takeIf(String::isNotBlank) ?: "This camera source could not be removed")
        }
    }

    private fun parseDevice(it: JSONObject): Device {
        val capabilitiesJson = it.optJSONObject("capabilities")
        val capabilities: Map<String, Any?> =
            capabilitiesJson?.keys()?.asSequence()?.associateWith { key -> capabilitiesJson.get(key) } ?: emptyMap()
        return Device(
            id = it.getString("id"),
            name = it.getString("name"),
            platform = it.getString("platform"),
            deviceType = it.getString("deviceType"),
            enabled = it.getBoolean("enabled"),
            privacyMode = it.getBoolean("privacyMode"),
            revoked = it.getBoolean("revoked"),
            online = it.getBoolean("online"),
            connectionState = it.getString("connectionState"),
            lastSeenAt = nullableApiText(it.optString("lastSeenAt")),
            healthReportedAt = nullableApiText(it.optString("healthReportedAt")),
            softwareVersion = nullableApiText(it.optString("softwareVersion")),
            batteryPercent = if (it.isNull("batteryPercent") || !it.has("batteryPercent")) null else it.optInt("batteryPercent"),
            batteryCharging = it.optBoolean("batteryCharging"),
            canRemove = it.getBoolean("canRemove"),
            capabilities = capabilities,
        )
    }

    fun accessHistory(sessionToken: String): List<AccessEvent> {
        val connection = connection("/api/access-history", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Access history is temporarily unavailable")
        }
        val events = JSONObject(body).getJSONArray("events")
        return (0 until events.length()).map { index ->
            events.getJSONObject(index).let {
                AccessEvent(
                    actorEmail = nullableApiText(it.optString("actorEmail")),
                    cameraName = nullableApiText(it.optString("cameraName")),
                    deviceName = nullableApiText(it.optString("deviceName")),
                    eventType = it.getString("eventType"),
                    occurredAt = it.getString("occurredAt"),
                    success = it.getBoolean("success"),
                    reason = nullableApiText(it.optString("reason")),
                )
            }
        }
    }

    fun motionEvents(
        sessionToken: String,
        cameraId: String? = null,
        since: String? = null,
        cursor: String? = null,
        limit: Int = 50,
    ): MotionEventPage {
        val query =
            buildList {
                add("limit=$limit")
                cameraId?.let { add("cameraId=${urlPathSegment(it)}") }
                since?.let { add("since=${urlPathSegment(it)}") }
                cursor?.let { add("cursor=${urlPathSegment(it)}") }
            }.joinToString("&")
        val connection = connection("/api/motion-events?$query", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Activity is temporarily unavailable")
        }
        val root = JSONObject(body)
        val events = root.getJSONArray("events")
        return MotionEventPage(
            events =
                (0 until events.length()).map { index ->
                    events.getJSONObject(index).let {
                        MotionEvent(
                            id = it.getString("id"),
                            cameraId = it.getString("cameraId"),
                            cameraName = it.getString("cameraName"),
                            deviceName = it.getString("deviceName"),
                            confidence = it.getDouble("confidence"),
                            occurredAt = it.getString("occurredAt"),
                            recordingId = nullableApiText(it.optString("recordingId")),
                            recordingStatus = nullableApiText(it.optString("recordingStatus")),
                        )
                    }
                },
            nextCursor = nullableApiText(root.optString("nextCursor")),
        )
    }

    fun motionEventById(sessionToken: String, motionEventId: String): MotionEvent {
        val connection = connection("/api/motion-events/${urlPathSegment(motionEventId)}", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("That event could not be found. It may have expired.")
        }
        val it = JSONObject(body)
        return MotionEvent(
            id = it.getString("id"),
            cameraId = it.getString("cameraId"),
            cameraName = it.getString("cameraName"),
            deviceName = it.getString("deviceName"),
            confidence = it.getDouble("confidence"),
            occurredAt = it.getString("occurredAt"),
            recordingId = nullableApiText(it.optString("recordingId")),
            recordingStatus = nullableApiText(it.optString("recordingStatus")),
        )
    }

    fun clearMotionEvents(sessionToken: String) {
        val connection = connection("/api/motion-events", "DELETE")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            throw IllegalStateException("Motion history could not be cleared. Try clearing it again.")
        }
    }

    /** Household-wide audit feed for the Activity page's "Household" kind
     * filter -- owner/admin only, matching the backend's own role gate. */
    fun householdActivity(
        sessionToken: String,
        limit: Int = 50,
        offset: Int = 0,
        cameraId: String? = null,
        since: String? = null,
    ): HouseholdActivityPage {
        val query =
            buildList {
                add("limit=$limit")
                add("offset=$offset")
                cameraId?.let { add("cameraId=${urlPathSegment(it)}") }
                since?.let { add("since=${urlPathSegment(it)}") }
            }.joinToString("&")
        val connection = connection("/api/activity?$query", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Activity is temporarily unavailable")
        }
        val root = JSONObject(body)
        val events = root.getJSONArray("events")
        return HouseholdActivityPage(
            events =
                (0 until events.length()).map { index ->
                    events.getJSONObject(index).let {
                        val metadata = it.optJSONObject("metadata")
                        HouseholdActivityEvent(
                            id = it.getString("id"),
                            actorEmail = nullableApiText(it.optString("actorEmail")),
                            deviceName = nullableApiText(it.optString("deviceName")),
                            cameraSourceId = nullableApiText(it.optString("cameraSourceId")),
                            sourceName = nullableApiText(it.optString("sourceName")),
                            eventType = it.getString("eventType"),
                            occurredAt = it.getString("occurredAt"),
                            success = it.getBoolean("success"),
                            metadata =
                                metadata?.keys()?.asSequence()?.associateWith { key -> metadata.optString(key) }
                                    ?: emptyMap(),
                        )
                    }
                },
            total = root.getInt("total"),
        )
    }

    fun monitorMotionSettings(sessionToken: String, deviceId: String): List<CameraMotionSettings> {
        val connection = connection("/api/devices/${urlPathSegment(deviceId)}/motion-settings", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Motion settings are temporarily unavailable")
        }
        val cameras = JSONObject(body).getJSONArray("cameras")
        return buildList {
            repeat(cameras.length()) { index -> add(parseCameraMotionSettings(cameras.getJSONObject(index))) }
        }
    }

    fun updateMonitorMotionSettings(
        sessionToken: String,
        settings: CameraMotionSettings,
    ): CameraMotionSettings {
        val connection = connection("/api/cameras/${urlPathSegment(settings.cameraId)}/motion-settings", "PUT")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val quietHours = settings.quietHours?.let {
            JSONObject().put("start", it.start).put("end", it.end).put("timeZone", it.timeZone)
        }
        val payload =
            JSONObject()
                .put("enabled", settings.enabled)
                .put("recordOnMotion", settings.recordOnMotion)
                .put("sensitivity", settings.sensitivity.wireValue)
                .put("cooldownSeconds", settings.cooldownSeconds)
                .put("quietHours", quietHours ?: JSONObject.NULL)
        connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Motion settings could not be saved")
        }
        return parseCameraMotionSettings(JSONObject(body).getJSONObject("settings"))
    }

    fun recordings(sessionToken: String, cursor: String? = null): RecordingPage {
        val suffix = cursor?.let { "?cursor=${java.net.URLEncoder.encode(it, Charsets.UTF_8.name())}" }.orEmpty()
        val connection = connection("/api/recordings$suffix", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Clips are temporarily unavailable")
        }
        return parseRecordingsResponse(body)
    }

    fun requestManualRecording(
        sessionToken: String,
        cameraId: String,
    ): RecordingSummary {
        val connection = connection("/api/recordings", "POST")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use {
            it.write(
                JSONObject()
                    .put("cameraId", cameraId)
                    .put("captureMode", "camera")
                    .toString()
                    .toByteArray(Charsets.UTF_8),
            )
        }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_ACCEPTED) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            // The machine-readable code is what the server promises to keep; the wording below is a fallback (V33).
            val serverCode = runCatching { JSONObject(body).optString("code") }.getOrNull()
            throw IllegalStateException(
                when {
                    serverCode == "drive_reconnect_required" ->
                        "Google Drive needs to be reconnected from Beacon Settings before recording."
                    serverCode == "drive_not_connected" ->
                        "Connect Google Drive for recordings from Beacon Settings first."
                    else -> when (serverMessage) {
                        "Connect Google Drive for recordings first" ->
                            "Connect Google Drive for recordings from Beacon Settings first."
                        "Camera is offline", "Camera is unavailable" ->
                            "The camera must be online before recording."
                        "Household owner access required" ->
                            "Only the household owner can record clips."
                        else -> "Recording could not be started. Try again."
                    }
                },
            )
        }
        return parseRecordingSummary(JSONObject(body).getJSONObject("recording"))
    }

    fun deleteRecording(sessionToken: String, recordingId: String) {
        val connection = connection("/api/recordings/${urlPathSegment(recordingId)}", "DELETE")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(serverMessage?.takeIf(String::isNotBlank) ?: "Clip could not be deleted")
        }
    }

    /** Downloads authorized ciphertext, verifies its declared size and SHA-256,
     * then decrypts it into app-private cache for the active playback session.
     * Callers must delete [PlaybackRecording.file] as soon as playback closes. */
    fun downloadRecordingForPlayback(
        sessionToken: String,
        recordingId: String,
        cacheDirectory: File,
    ): PlaybackRecording {
        val connection = connection("/api/recordings/${urlPathSegment(recordingId)}/playback", "GET").apply {
            setRequestProperty("Authorization", "Bearer $sessionToken")
            readTimeout = 60_000
            useCaches = false
        }
        val status = connection.responseCode
        if (status == HttpURLConnection.HTTP_UNAUTHORIZED) {
            connection.errorStream?.close()
            connection.disconnect()
            throw AuthorizationLostException()
        }
        if (status != HttpURLConnection.HTTP_OK) {
            val body = connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            connection.disconnect()
            throw IllegalStateException(serverMessage?.takeIf(String::isNotBlank) ?: "Clip could not be loaded")
        }

        val expectedBytes = connection.getHeaderField("X-Beacon-Recording-Bytes")?.toLongOrNull()
        val expectedChecksum = connection.getHeaderField("X-Beacon-Recording-Checksum")
        val mimeType = connection.getHeaderField("X-Beacon-Recording-Mime")
        val encodedKey = connection.getHeaderField("X-Beacon-Recording-Key")
        val encodedIv = connection.getHeaderField("X-Beacon-Recording-IV")
        requirePlaybackMetadata(expectedBytes, expectedChecksum, mimeType, encodedKey, encodedIv)

        cacheDirectory.mkdirs()
        cacheDirectory.listFiles { file -> file.name.startsWith("beacon-clip-") }
            ?.forEach { it.delete() }
        val encryptedFile = File.createTempFile("beacon-clip-", ".encrypted", cacheDirectory)
        val extension = if (mimeType == "video/mp4") ".mp4" else ".webm"
        val playbackFile = File.createTempFile("beacon-clip-", extension, cacheDirectory)
        try {
            val digest = MessageDigest.getInstance("SHA-256")
            var bytes = 0L
            connection.inputStream.use { input ->
                encryptedFile.outputStream().use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        bytes += read
                        if (bytes > expectedBytes!!) throw IllegalStateException("Clip exceeded its expected size")
                        digest.update(buffer, 0, read)
                        output.write(buffer, 0, read)
                    }
                }
            }
            if (bytes != expectedBytes) throw IllegalStateException("Clip download was incomplete")
            val actualChecksum = digest.digest().joinToString("") { "%02x".format(it) }
            if (actualChecksum != expectedChecksum) throw IllegalStateException("Clip failed its integrity check")

            val key = decodeBase64Url(encodedKey!!, 32)
            val iv = decodeBase64Url(encodedIv!!, 12)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
            encryptedFile.inputStream().use { input ->
                javax.crypto.CipherInputStream(input, cipher).use { decrypted ->
                    playbackFile.outputStream().use { output -> decrypted.copyTo(output) }
                }
            }
            return PlaybackRecording(playbackFile, mimeType!!)
        } catch (error: Exception) {
            playbackFile.delete()
            throw error
        } finally {
            encryptedFile.delete()
            connection.disconnect()
        }
    }

    /** Mirrors [downloadRecordingForPlayback]'s verify-then-decrypt contract for the
     * much smaller, optional thumbnail asset (ADR 0078). Thumbnails are decoration,
     * not part of the recording lifecycle, so any failure -- network, integrity,
     * or simply no thumbnail existing yet -- returns null instead of throwing;
     * a missing thumbnail must never block viewing or deleting the clip itself.
     * Session expiry is the one exception: callers still need to know about that. */
    fun downloadRecordingThumbnail(
        sessionToken: String,
        recordingId: String,
        cacheDirectory: File,
    ): RecordingThumbnail? {
        val connection = connection("/api/recordings/${urlPathSegment(recordingId)}/thumbnail", "GET").apply {
            setRequestProperty("Authorization", "Bearer $sessionToken")
            readTimeout = 30_000
            useCaches = false
        }
        try {
            val status = connection.responseCode
            if (status == HttpURLConnection.HTTP_UNAUTHORIZED) {
                connection.errorStream?.close()
                throw AuthorizationLostException()
            }
            if (status != HttpURLConnection.HTTP_OK) {
                connection.errorStream?.close()
                return null
            }

            val expectedBytes = connection.getHeaderField("X-Beacon-Recording-Bytes")?.toLongOrNull()
            val expectedChecksum = connection.getHeaderField("X-Beacon-Recording-Checksum")
            val mimeType = connection.getHeaderField("X-Beacon-Recording-Mime")
            val encodedKey = connection.getHeaderField("X-Beacon-Recording-Key")
            val encodedIv = connection.getHeaderField("X-Beacon-Recording-IV")
            if (
                expectedBytes == null || expectedBytes !in 1..MAX_THUMBNAIL_BYTES ||
                expectedChecksum == null || !expectedChecksum.matches(Regex("^[a-f0-9]{64}$")) ||
                mimeType !in setOf("image/jpeg", "image/webp") || encodedKey == null || encodedIv == null
            ) {
                return null
            }

            cacheDirectory.mkdirs()
            // Only this clip's earlier thumbnail is replaced, so rows loading in parallel do not delete
            // each other's pictures (V78); anything older than an hour is swept.
            val thumbnailPrefix = "beacon-thumb-${recordingId.filter { it.isLetterOrDigit() || it == '-' }}-"
            cacheDirectory.listFiles { file -> file.name.startsWith(thumbnailPrefix) }
                ?.forEach { it.delete() }
            deleteStaleCacheFiles(cacheDirectory, "beacon-thumb-", olderThanMs = 60 * 60_000L)
            val encryptedFile = File.createTempFile(thumbnailPrefix, ".encrypted", cacheDirectory)
            val extension = if (mimeType == "image/webp") ".webp" else ".jpg"
            val imageFile = File.createTempFile(thumbnailPrefix, extension, cacheDirectory)
            return try {
                val digest = MessageDigest.getInstance("SHA-256")
                var bytes = 0L
                connection.inputStream.use { input ->
                    encryptedFile.outputStream().use { output ->
                        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            bytes += read
                            if (bytes > expectedBytes) throw IllegalStateException("Thumbnail exceeded its expected size")
                            digest.update(buffer, 0, read)
                            output.write(buffer, 0, read)
                        }
                    }
                }
                if (bytes != expectedBytes) throw IllegalStateException("Thumbnail download was incomplete")
                val actualChecksum = digest.digest().joinToString("") { "%02x".format(it) }
                if (actualChecksum != expectedChecksum) throw IllegalStateException("Thumbnail failed its integrity check")

                val key = decodeBase64Url(encodedKey, 32)
                val iv = decodeBase64Url(encodedIv, 12)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
                encryptedFile.inputStream().use { input ->
                    javax.crypto.CipherInputStream(input, cipher).use { decrypted ->
                        imageFile.outputStream().use { output -> decrypted.copyTo(output) }
                    }
                }
                RecordingThumbnail(imageFile, mimeType)
            } catch (error: Exception) {
                imageFile.delete()
                null
            } finally {
                encryptedFile.delete()
            }
        } catch (error: AuthorizationLostException) {
            throw error
        } catch (error: Exception) {
            return null
        } finally {
            connection.disconnect()
        }
    }

    fun createRecordingShareLink(
        sessionToken: String,
        recordingId: String,
        expiresInHours: Int,
    ): RecordingShareLink {
        val connection = connection("/api/recordings/${urlPathSegment(recordingId)}/share-links", "POST")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use {
            it.write(JSONObject().put("expiresInHours", expiresInHours).toString().toByteArray(Charsets.UTF_8))
        }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_CREATED) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(
                when (serverMessage) {
                    "Household owner access required" -> "Only the household owner can share clips."
                    "Only an available clip can be shared" -> "This clip cannot be shared yet."
                    else -> "This clip could not be shared. Try again."
                },
            )
        }
        val json = JSONObject(body)
        return RecordingShareLink(
            token = json.getString("token"),
            url = json.getString("url"),
            expiresAt = json.getString("expiresAt"),
        )
    }

    fun activeRecordingShareLink(sessionToken: String, recordingId: String): ActiveRecordingShareLink? {
        val connection = connection("/api/recordings/${urlPathSegment(recordingId)}/share-links", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_OK) return null
        val active = JSONObject(body).optJSONObject("active") ?: return null
        return ActiveRecordingShareLink(id = active.getString("id"), expiresAt = active.getString("expiresAt"))
    }

    fun revokeRecordingShareLink(sessionToken: String, linkId: String) {
        val connection = connection("/api/recordings/share-links/${urlPathSegment(linkId)}", "DELETE")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(serverMessage?.takeIf(String::isNotBlank) ?: "Share link could not be removed")
        }
    }

    fun accountDetails(sessionToken: String): AccountDetails {
        val connection = connection("/api/auth/me", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Account details are temporarily unavailable")
        }
        val user = JSONObject(body).getJSONObject("user")
        return AccountDetails(
            email = user.getString("email"),
            emailVerified = user.getBoolean("emailVerified"),
            googleLinked = user.getBoolean("googleLinked"),
            hasPassword = user.getBoolean("hasPassword"),
        )
    }

    fun requestEmailVerification(sessionToken: String) {
        val connection = connection("/api/account/email/verify/request", "POST")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(
                when (serverMessage) {
                    "Email verification is unavailable" -> "Email verification is not available on this server."
                    "Too many requests" -> "Too many attempts. Wait before trying again."
                    else -> "The verification email could not be sent."
                },
            )
        }
    }

    fun driveStatus(sessionToken: String): DriveStatus {
        val connection = connection("/api/drive/status", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Google Drive status is temporarily unavailable")
        }
        val json = JSONObject(body)
        return DriveStatus(
            connected = json.getBoolean("connected"),
            configured = json.getBoolean("configured"),
            recordingsConnected = json.getBoolean("recordingsConnected"),
            providerEmail = nullableApiText(json.optString("providerEmail")),
            expired = json.optBoolean("expired", false),
        )
    }

    fun disconnectDrive(sessionToken: String) {
        val connection = connection("/api/drive/connection", "DELETE")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            throw IllegalStateException("Google Drive could not be disconnected.")
        }
    }

    fun verifyDrive(sessionToken: String) {
        val connection = connection("/api/drive/verify", "POST")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(
                when (serverMessage) {
                    "Google Drive is not connected" -> "Google Drive is not connected."
                    else -> "Google Drive verification failed."
                },
            )
        }
    }

    fun currentHousehold(sessionToken: String): HouseholdSummary? {
        val connection = connection("/api/account/households", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_OK) return null
        val json = JSONObject(body)
        val currentId = json.optString("currentHouseholdId")
        val households = json.getJSONArray("households")
        for (index in 0 until households.length()) {
            val household = households.getJSONObject(index)
            if (household.getString("id") == currentId) {
                return HouseholdSummary(
                    id = household.getString("id"),
                    name = household.getString("name"),
                    role = household.getString("role"),
                )
            }
        }
        return null
    }

    /** Owner/admin only -- mirrors the PWA's People & access section. A
     * viewer or guest calling this gets a 403, handled by the caller as
     * "nothing to manage" rather than an error. */
    fun householdSharing(sessionToken: String): HouseholdSharing {
        val connection = connection("/api/household/sharing", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Household members are temporarily unavailable")
        }
        val json = JSONObject(body)
        val members = json.getJSONArray("members")
        val invitations = json.getJSONArray("invitations")
        return HouseholdSharing(
            members =
                (0 until members.length()).map { index ->
                    val member = members.getJSONObject(index)
                    val grants = member.optJSONArray("grants")
                    HouseholdMember(
                        id = member.getString("id"),
                        userId = member.getString("userId"),
                        email = member.getString("email"),
                        role = member.getString("role"),
                        status = member.getString("status"),
                        grants =
                            grants?.let { array ->
                                (0 until array.length()).map { grantIndex ->
                                    val grant = array.getJSONObject(grantIndex)
                                    CameraGrant(
                                        cameraId = grant.getString("cameraId"),
                                        cameraName = grant.getString("cameraName"),
                                        canListen = grant.getBoolean("canListen"),
                                        canTalk = grant.getBoolean("canTalk"),
                                        canFlip = grant.getBoolean("canFlip"),
                                        canPause = grant.getBoolean("canPause"),
                                    )
                                }
                            } ?: emptyList(),
                    )
                },
            invitations =
                (0 until invitations.length()).map { index ->
                    val invitation = invitations.getJSONObject(index)
                    HouseholdInvitation(
                        id = invitation.getString("id"),
                        invitedEmail = invitation.getString("invitedEmail"),
                        role = invitation.getString("role"),
                        expiresAt = invitation.getString("expiresAt"),
                    )
                },
        )
    }

    fun createHouseholdInvitation(
        sessionToken: String,
        email: String,
        role: String,
        // For a viewer the owner must choose (V32): null means every camera, otherwise only these ids.
        cameraIds: List<String>? = null,
    ): CreatedInvitation {
        val connection = connection("/api/household/invitations", "POST")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val payload = JSONObject().put("email", email).put("role", role)
        if (role == "viewer") {
            payload.put(
                "cameraAccess",
                if (cameraIds == null) "all" else JSONObject().put("cameraIds", org.json.JSONArray(cameraIds)),
            )
        }
        connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_CREATED) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(
                when (serverMessage) {
                    "You cannot invite that household role" -> "You can't invite that role."
                    "Verify your email address before inviting people" ->
                        "Verify your email address in Beacon Settings, then send the invitation."
                    "Choose which cameras a viewer can see" -> "Choose which cameras this person can see."
                    "Too many invitation changes" -> "Too many invitations. Wait before trying again."
                    else -> "The invitation could not be created. Try again."
                },
            )
        }
        val json = JSONObject(body)
        return CreatedInvitation(
            id = json.getString("id"),
            token = json.getString("token"),
            expiresAt = json.getString("expiresAt"),
        )
    }

    fun acceptHouseholdInvitation(sessionToken: String, token: String) {
        val connection = connection("/api/household/invitations/accept", "POST")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use {
            it.write(JSONObject().put("token", token).toString().toByteArray(Charsets.UTF_8))
        }
        responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("That invitation code is invalid or has expired.")
        }
    }

    fun revokeHouseholdInvitation(sessionToken: String, invitationId: String) {
        val connection = connection("/api/household/invitations/${urlPathSegment(invitationId)}", "DELETE")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            throw IllegalStateException("This invitation could not be revoked.")
        }
    }

    /** Soft-revokes a member: they immediately lose access to every camera,
     * but their record (and history) stays until [permanentlyRemoveHouseholdMember]
     * is called separately, matching the PWA's two-stage revoke-then-delete flow. */
    fun removeHouseholdMember(sessionToken: String, memberId: String) {
        val connection = connection("/api/household/members/${urlPathSegment(memberId)}", "DELETE")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            throw IllegalStateException("This member could not be removed.")
        }
    }

    /** Deletes an already-revoked member's record entirely. The backend
     * requires the member to be revoked first (409 otherwise). */
    fun permanentlyRemoveHouseholdMember(sessionToken: String, memberId: String) {
        val connection = connection("/api/household/members/${urlPathSegment(memberId)}/permanently", "DELETE")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(serverMessage?.takeIf(String::isNotBlank) ?: "This member could not be deleted.")
        }
    }

    /** Replaces a member's full camera-grant set in one call, matching the
     * backend's own replace-not-patch contract (`PUT
     * /api/household/members/:memberId/grants`) -- send every camera this
     * member should still have access to, omitted ones lose it. */
    fun updateHouseholdMemberGrants(sessionToken: String, memberId: String, grants: List<CameraGrant>) {
        val connection = connection("/api/household/members/${urlPathSegment(memberId)}/grants", "PUT")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val grantsJson =
            JSONArray().apply {
                grants.forEach { grant ->
                    put(
                        JSONObject()
                            .put("cameraId", grant.cameraId)
                            .put("canListen", grant.canListen)
                            .put("canTalk", grant.canTalk)
                            .put("canFlip", grant.canFlip)
                            .put("canPause", grant.canPause),
                    )
                }
            }
        connection.outputStream.use {
            it.write(JSONObject().put("grants", grantsJson).toString().toByteArray(Charsets.UTF_8))
        }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(serverMessage?.takeIf(String::isNotBlank) ?: "Unable to save camera access")
        }
    }

    fun browserSessions(sessionToken: String): List<BrowserSessionSummary> {
        val connection = connection("/api/account/sessions", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Signed-in devices are temporarily unavailable")
        }
        val sessions = JSONObject(body).getJSONArray("sessions")
        return (0 until sessions.length()).map { index ->
            val entry = sessions.getJSONObject(index)
            BrowserSessionSummary(
                id = entry.getString("id"),
                userAgent = entry.optString("userAgent").takeIf(String::isNotBlank) ?: "Unknown device",
                current = entry.getBoolean("current"),
                lastSeenAt = entry.getString("lastSeenAt"),
                createdAt = entry.getString("createdAt"),
            )
        }
    }

    fun revokeBrowserSession(sessionToken: String, targetSessionId: String) {
        val connection = connection("/api/account/sessions/${urlPathSegment(targetSessionId)}", "DELETE")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            throw IllegalStateException("This session could not be revoked.")
        }
    }

    fun motionRetention(sessionToken: String): Int {
        val connection = connection("/api/motion-retention", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Motion history settings are temporarily unavailable")
        }
        return JSONObject(body).getInt("days")
    }

    fun setMotionRetention(sessionToken: String, days: Int): Int {
        val connection = connection("/api/motion-retention", "PUT")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use {
            it.write(JSONObject().put("days", days).toString().toByteArray(Charsets.UTF_8))
        }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Motion history setting could not be saved")
        }
        return JSONObject(body).getInt("days")
    }

    fun logout(sessionToken: String) {
        val connection = connection("/api/auth/logout", "POST")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        responseBody(connection)
        if (connection.responseCode !in listOf(HttpURLConnection.HTTP_NO_CONTENT, HttpURLConnection.HTTP_UNAUTHORIZED)) {
            throw IllegalStateException("Unable to sign out")
        }
    }

    fun deleteAccount(sessionToken: String) {
        val connection = connection("/api/account", "DELETE")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use {
            it.write(JSONObject().put("confirmation", "DELETE").toString().toByteArray(Charsets.UTF_8))
        }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(serverMessage?.takeIf(String::isNotBlank) ?: "Your account could not be deleted")
        }
    }

    fun registerFcmSubscription(
        sessionToken: String,
        installationId: String,
        firebaseMessagingToken: String,
    ): String {
        val connection = connection("/api/notification-subscriptions", "POST")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use {
            it.write(
                JSONObject()
                    .put("channel", "fcm")
                    .put("installationId", installationId)
                    .put("deviceLabel", "Beacon Android monitor")
                    .put("token", firebaseMessagingToken)
                    .toString().toByteArray(Charsets.UTF_8),
            )
        }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_CREATED) throw IllegalStateException("Notifications are temporarily unavailable")
        return JSONObject(body).getString("id")
    }

    fun revokeNotificationSubscription(sessionToken: String, subscriptionId: String) {
        val connection = connection("/api/notification-subscriptions/$subscriptionId", "DELETE")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        responseBody(connection)
        if (connection.responseCode !in listOf(HttpURLConnection.HTTP_NO_CONTENT, HttpURLConnection.HTTP_NOT_FOUND)) {
            if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
            throw IllegalStateException("Notification removal is temporarily unavailable")
        }
    }

    fun notificationPreferences(sessionToken: String): List<NotificationPreference> {
        val connection = connection("/api/notification-preferences", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_OK) throw IllegalStateException("Notification preferences are temporarily unavailable")
        val preferences = JSONObject(body).getJSONArray("preferences")
        return (0 until preferences.length()).map { index ->
            val item = preferences.getJSONObject(index)
            NotificationPreference(
                deviceId = item.getString("deviceId"),
                deviceName = item.getString("deviceName"),
                motionEnabled = item.getBoolean("motionEnabled"),
                offlineEnabled = item.getBoolean("offlineEnabled"),
                quietHours = item.optJSONObject("quietHours")?.let {
                    QuietHours(it.getString("start"), it.getString("end"), it.getString("timeZone"))
                },
            )
        }
    }

    fun updateNotificationPreference(sessionToken: String, preference: NotificationPreference): NotificationPreference {
        val connection = connection("/api/notification-preferences/${preference.deviceId}", "PUT")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val quiet = preference.quietHours?.let {
            JSONObject().put("start", it.start).put("end", it.end).put("timeZone", it.timeZone)
        }
        connection.outputStream.use {
            it.write(
                JSONObject().put("motionEnabled", preference.motionEnabled)
                    .put("offlineEnabled", preference.offlineEnabled).put("quietHours", quiet ?: JSONObject.NULL)
                    .toString().toByteArray(Charsets.UTF_8),
            )
        }
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_OK) throw IllegalStateException("Notification preferences could not be saved")
        val item = JSONObject(body).getJSONObject("preference")
        return preference.copy(
            motionEnabled = item.getBoolean("motionEnabled"),
            offlineEnabled = item.getBoolean("offlineEnabled"),
        )
    }

    fun heartbeat(
        credential: String,
        batteryPercent: Int?,
        batteryCharging: Boolean?,
        thermalStatus: String? = null,
    ): Boolean {
        val connection = connection("/api/device/heartbeat", "POST")
        connection.setRequestProperty("Authorization", "Bearer $credential")
        val payload =
            JSONObject().apply {
                if (batteryPercent != null && batteryCharging != null) {
                    put("batteryPercent", batteryPercent)
                    put("batteryCharging", batteryCharging)
                }
                if (thermalStatus != null) put("thermalStatus", thermalStatus)
            }
        connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
        responseBody(connection)
        return when (connection.responseCode) {
            HttpURLConnection.HTTP_NO_CONTENT -> true
            // Only Beacon's own "unknown credential" answer counts as a rejection. A 403 comes from a proxy
            // or network in between, never from Beacon, so it is treated as temporarily unavailable.
            HttpURLConnection.HTTP_UNAUTHORIZED -> false
            else -> throw IllegalStateException("Heartbeat temporarily unavailable")
        }
    }

    fun removeRegistration(credential: String) {
        val connection = connection("/api/device/disconnect", "POST")
        connection.setRequestProperty("Authorization", "Bearer $credential")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        responseBody(connection)
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            throw IllegalStateException("Unable to remove device")
        }
    }

    fun syncCameras(
        credential: String,
        sources: List<CameraSource>,
        // Reported once capture has started, so the owner can be told when this phone cannot record clips (V72).
        clipRecording: Boolean? = null,
    ): CameraSynchronization {
        val connection = connection("/api/device/cameras", "PUT")
        connection.setRequestProperty("Authorization", "Bearer $credential")
        val payload =
            JSONObject()
                .put(
                    "sources",
                    org.json.JSONArray().apply {
                        sources.forEach { source ->
                            put(
                                JSONObject()
                                    .put("sourceKey", source.sourceKey)
                                    .put("name", source.name)
                                    .put("facing", source.facing)
                                    .apply {
                                        if (clipRecording != null) {
                                            put("capabilities", JSONObject().put("clipRecording", clipRecording))
                                        }
                                    },
                            )
                        }
                    },
                ).toString()
        connection.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        if (
            connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED ||
                connection.responseCode == HttpURLConnection.HTTP_FORBIDDEN
        ) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Unable to synchronize camera sources")
        }
        val cameras = JSONObject(body).getJSONArray("cameras")
        return CameraSynchronization(
            cameras =
                (0 until cameras.length()).map { index ->
                    cameras.getJSONObject(index).let {
                        CameraSource(
                            id = it.getString("id"),
                            sourceKey = it.getString("sourceKey"),
                            name = it.getString("name"),
                            facing = it.getString("facing"),
                        )
                    }
                },
            privacyMode = JSONObject(body).optBoolean("privacyMode", false),
        )
    }

    fun setPrivacyMode(credential: String, enabled: Boolean): Boolean {
        val connection = connection("/api/device/privacy", "PUT")
        connection.setRequestProperty("Authorization", "Bearer $credential")
        connection.outputStream.use {
            it.write(JSONObject().put("enabled", enabled).toString().toByteArray(Charsets.UTF_8))
        }
        val body = responseBody(connection)
        if (
            connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED ||
                connection.responseCode == HttpURLConnection.HTTP_FORBIDDEN
        ) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Unable to change privacy mode")
        }
        return JSONObject(body).getBoolean("privacyMode")
    }

    // The last answer and its ETag, so an unchanged answer costs a 304 instead of a full body (V49).
    private var cachedMotionSettings: Triple<String, String, Map<String, MotionSettings>>? = null

    fun motionSettings(credential: String): Map<String, MotionSettings> {
        val connection = connection("/api/device/motion-settings", "GET")
        connection.setRequestProperty("Authorization", "Bearer $credential")
        val cached = cachedMotionSettings?.takeIf { it.first == credential }
        if (cached != null) connection.setRequestProperty("If-None-Match", cached.second)
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_NOT_MODIFIED && cached != null) return cached.third
        if (connection.responseCode in listOf(HttpURLConnection.HTTP_UNAUTHORIZED, HttpURLConnection.HTTP_FORBIDDEN)) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) throw IllegalStateException("Motion settings unavailable")
        val parsed = parseMotionSettingsResponse(body)
        connection.getHeaderField("ETag")?.let { cachedMotionSettings = Triple(credential, it, parsed) }
        return parsed
    }

    /** Returns the id of a recording the backend started for this motion
     * report -- see core-feature-completion-plan.md's recording foundation
     * -- or null when this report didn't trigger one (recording-on-motion is
     * off, Drive isn't connected, or one is already in flight). Never an
     * error: the motion event itself is already committed either way. */
    fun reportMotion(credential: String, cameraId: String, confidence: Float): String? {
        val connection = connection("/api/device/cameras/$cameraId/motion-events", "POST")
        connection.setRequestProperty("Authorization", "Bearer $credential")
        connection.outputStream.use {
            it.write(
                JSONObject().put("confidence", confidence.toDouble()).toString()
                    .toByteArray(Charsets.UTF_8),
            )
        }
        val body = responseBody(connection)
        checkMotionReportResponse(connection.responseCode)
        if (connection.responseCode != HttpURLConnection.HTTP_CREATED) return null
        return runCatching { JSONObject(body).optString("recordingId") }
            .getOrNull()
            ?.takeIf { it.isNotEmpty() }
    }

    /** Opens the Drive upload session for a motion-triggered recording using
     * this camera's own device credential -- no browser session involved,
     * matching the device-initiated path core-feature-completion-plan.md's
     * recording foundation was built for. Mirrors the web viewer's own
     * upload-session call against /api/recordings/:id/upload-session. */
    fun beginRecordingUpload(
        credential: String,
        recordingId: String,
        byteSize: Long,
        checksumSha256: String,
        durationMs: Long,
        mimeType: String,
        dataKey: String,
        encryptionIv: String,
    ): String {
        val connection = connection("/api/device/recordings/$recordingId/upload-session", "POST")
        connection.setRequestProperty("Authorization", "Bearer $credential")
        connection.outputStream.use {
            it.write(
                JSONObject()
                    .put("byteSize", byteSize)
                    .put("checksumSha256", checksumSha256)
                    .put("durationMs", durationMs)
                    .put("mimeType", mimeType)
                    .put(
                        "encryption",
                        JSONObject()
                            .put("dataKey", dataKey)
                            .put("iv", encryptionIv)
                            .put("version", 1),
                    )
                    .toString()
                    .toByteArray(Charsets.UTF_8),
            )
        }
        val body = responseBody(connection)
        if (connection.responseCode in listOf(HttpURLConnection.HTTP_UNAUTHORIZED, HttpURLConnection.HTTP_FORBIDDEN)) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_CREATED) {
            throw IllegalStateException("Recording upload session unavailable")
        }
        return JSONObject(body).getString("uploadUrl")
    }

    /** Tells Beacon the clip finished uploading directly to Drive, so it can
     * verify the file and mark the recording available. */
    fun completeRecording(credential: String, recordingId: String, providerFileId: String) {
        val connection = connection("/api/device/recordings/$recordingId/complete", "POST")
        connection.setRequestProperty("Authorization", "Bearer $credential")
        connection.outputStream.use {
            it.write(
                JSONObject().put("providerFileId", providerFileId).toString()
                    .toByteArray(Charsets.UTF_8),
            )
        }
        responseBody(connection)
        if (connection.responseCode in listOf(HttpURLConnection.HTTP_UNAUTHORIZED, HttpURLConnection.HTTP_FORBIDDEN)) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            throw IllegalStateException("Recording could not be completed")
        }
    }

    /** Releases a recording request that this camera cannot finish. The
     * backend scopes the transition to the device credential, so one camera
     * cannot alter another camera's recording. */
    fun failRecording(credential: String, recordingId: String, reason: String) {
        val connection = connection("/api/device/recordings/$recordingId/fail", "POST")
        connection.setRequestProperty("Authorization", "Bearer $credential")
        connection.outputStream.use {
            it.write(JSONObject().put("reason", reason).toString().toByteArray(Charsets.UTF_8))
        }
        responseBody(connection)
        if (connection.responseCode in listOf(HttpURLConnection.HTTP_UNAUTHORIZED, HttpURLConnection.HTTP_FORBIDDEN)) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            throw IllegalStateException("Recording failure could not be reported")
        }
    }

    private fun parseCameraMotionSettings(value: JSONObject): CameraMotionSettings =
        CameraMotionSettings(
            cameraId = value.getString("cameraId"),
            enabled = value.getBoolean("enabled"),
            recordOnMotion = value.getBoolean("recordOnMotion"),
            sensitivity =
                MotionSensitivity.entries.firstOrNull { it.wireValue == value.getString("sensitivity") }
                    ?: throw IllegalStateException("Unsupported motion sensitivity"),
            cooldownSeconds = value.getInt("cooldownSeconds"),
            quietHours =
                value.optJSONObject("quietHours")?.let {
                    QuietHours(
                        start = it.getString("start"),
                        end = it.getString("end"),
                        timeZone = it.getString("timeZone"),
                    )
                },
            ignoredZones = value.optJSONArray("ignoredZones")?.let(::parseZones) ?: emptySet(),
        )

    /** Motion-zone cells from the backend, ignoring anything off the grid. */
    private fun parseZones(array: org.json.JSONArray): Set<Int> = parseZoneCells(array)

    private fun connection(path: String, method: String): HttpURLConnection =
        (URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 10_000
            // DELETE also gets doOutput=true: Android's HttpURLConnection has been
            // observed sending a Content-Type the backend's Fastify instance can't
            // parse on a truly bodyless DELETE (FST_ERR_CTP_INVALID_MEDIA_TYPE).
            // Every DELETE call site below writes an explicit "{}" body to avoid it.
            doOutput = method != "GET"
            if (doOutput) setRequestProperty("Content-Type", "application/json")
        }

    private fun responseBody(connection: HttpURLConnection): String {
        val stream =
            if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        return stream?.bufferedReader()?.use { it.readText() }.orEmpty()
    }
}

/**
 * Reads the camera's motion settings. One value this app version does not know (a newer time-zone name, a new
 * sensitivity) must not turn motion detection off, which is what a thrown error used to do (V83): the odd value
 * falls back to a safe default and the rest of the settings still apply.
 */
internal fun parseMotionSettingsResponse(body: String): Map<String, MotionSettings> {
    val cameras = JSONObject(body).getJSONArray("cameras")
    return (0 until cameras.length()).associate { index ->
        val item = cameras.getJSONObject(index)
        item.getString("cameraId") to MotionSettings(
            enabled = item.getBoolean("enabled"),
            recordOnMotion = item.optBoolean("recordOnMotion", false),
            sensitivity =
                MotionSensitivity.entries.firstOrNull { it.wireValue == item.optString("sensitivity") }
                    ?: MotionSensitivity.Medium,
            cooldownSeconds = item.optInt("cooldownSeconds", 30).takeIf { it in listOf(30, 60, 120, 300) } ?: 30,
            quietHours =
                item.optJSONObject("quietHours")?.let { quiet ->
                    runCatching {
                        QuietHours(
                            start = quiet.getString("start"),
                            end = quiet.getString("end"),
                            timeZone = quiet.getString("timeZone"),
                        )
                    }.getOrNull()
                },
            ignoredZones =
                item.optJSONArray("ignoredZones")?.let(::parseZoneCells) ?: emptySet(),
        )
    }
}

internal fun parseZoneCells(array: org.json.JSONArray): Set<Int> =
    (0 until array.length()).map { array.getInt(it) }.filter { it in 0 until ZoneGrid.COUNT }.toSet()

internal fun parseRecordingsResponse(body: String): BeaconApi.RecordingPage {
    val response = JSONObject(body)
    val recordings = response.getJSONArray("recordings")
    return BeaconApi.RecordingPage(
        recordings =
            (0 until recordings.length()).map { index ->
                parseRecordingSummary(recordings.getJSONObject(index))
            },
        nextCursor = nullableApiText(response.optString("nextCursor")),
    )
}

private fun parseRecordingSummary(value: JSONObject): BeaconApi.RecordingSummary =
    BeaconApi.RecordingSummary(
        id = value.getString("id"),
        cameraId = value.getString("cameraId"),
        cameraName = value.getString("cameraName"),
        deviceName = value.getString("deviceName"),
        status = value.getString("status"),
        durationMs = if (value.isNull("durationMs")) null else value.getLong("durationMs"),
        createdAt = value.getString("createdAt"),
        triggerMotionEventId = nullableApiText(value.optString("triggerMotionEventId")),
        hasThumbnail = value.optBoolean("hasThumbnail", false),
    )

private fun urlPathSegment(value: String): String =
    java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")

private fun requirePlaybackMetadata(
    expectedBytes: Long?,
    checksum: String?,
    mimeType: String?,
    key: String?,
    iv: String?,
) {
    if (
        expectedBytes == null || expectedBytes !in 17..MAX_RECORDING_BYTES ||
        checksum == null || !checksum.matches(Regex("^[a-f0-9]{64}$")) ||
        mimeType !in setOf("video/mp4", "video/webm") || key == null || iv == null
    ) {
        throw IllegalStateException("Clip metadata is incomplete")
    }
}

private fun decodeBase64Url(value: String, expectedLength: Int): ByteArray {
    if (!value.matches(Regex("^[A-Za-z0-9_-]+$"))) throw IllegalStateException("Invalid clip key")
    val decoded = runCatching { Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING) }
        .getOrElse { throw IllegalStateException("Invalid clip key") }
    if (decoded.size != expectedLength) throw IllegalStateException("Invalid clip key")
    return decoded
}

private const val MAX_RECORDING_BYTES = 250L * 1024L * 1024L
private const val MAX_THUMBNAIL_BYTES = 2L * 1024L * 1024L

internal fun nullableApiText(value: String?): String? =
    value?.trim()?.takeIf { it.isNotEmpty() && !it.equals("null", ignoreCase = true) }

internal fun checkMotionReportResponse(status: Int) {
    when (status) {
        HttpURLConnection.HTTP_CREATED,
        HttpURLConnection.HTTP_NO_CONTENT,
        HttpURLConnection.HTTP_CONFLICT,
        -> Unit
        HttpURLConnection.HTTP_UNAUTHORIZED,
        HttpURLConnection.HTTP_FORBIDDEN,
        -> throw AuthorizationLostException()
        else -> throw IllegalStateException("Unable to report motion")
    }
}
