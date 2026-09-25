package com.beaconsecureview.camera

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class AuthorizationLostException : IllegalStateException()

class PairingException(message: String) : IllegalStateException(message)

class BeaconApi(private val baseUrl: String) {
    data class AccountSession(
        val token: String,
        val userId: String,
        val email: String? = null,
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

    data class MotionEvent(
        val id: String,
        val cameraId: String,
        val cameraName: String,
        val deviceName: String,
        val confidence: Double,
        val occurredAt: String,
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

    fun exchangeGoogleSignIn(code: String): AccountSession {
        val connection = connection("/api/mobile/auth/google", "POST")
        connection.outputStream.use {
            it.write(JSONObject().put("code", code).toString().toByteArray(Charsets.UTF_8))
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
        return AccountSession(
            token = sessionToken,
            userId = user.getString("id"),
            email = user.optString("email").takeIf(String::isNotBlank),
        )
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

    fun motionEvents(sessionToken: String): List<MotionEvent> {
        val connection = connection("/api/motion-events?limit=50", "GET")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IllegalStateException("Activity is temporarily unavailable")
        }
        val events = JSONObject(body).getJSONArray("events")
        return (0 until events.length()).map { index ->
            events.getJSONObject(index).let {
                MotionEvent(
                    id = it.getString("id"),
                    cameraId = it.getString("cameraId"),
                    cameraName = it.getString("cameraName"),
                    deviceName = it.getString("deviceName"),
                    confidence = it.getDouble("confidence"),
                    occurredAt = it.getString("occurredAt"),
                )
            }
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

    fun heartbeat(credential: String, batteryPercent: Int?, batteryCharging: Boolean?): Boolean {
        val connection = connection("/api/device/heartbeat", "POST")
        connection.setRequestProperty("Authorization", "Bearer $credential")
        val payload = JSONObject().apply { if (batteryPercent != null && batteryCharging != null) { put("batteryPercent", batteryPercent); put("batteryCharging", batteryCharging) } }
        connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
        responseBody(connection)
        return when (connection.responseCode) {
            HttpURLConnection.HTTP_NO_CONTENT -> true
            HttpURLConnection.HTTP_UNAUTHORIZED,
            HttpURLConnection.HTTP_FORBIDDEN,
            -> false
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
                                    .put("facing", source.facing),
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

    fun motionSettings(credential: String): Map<String, MotionSettings> {
        val connection = connection("/api/device/motion-settings", "GET")
        connection.setRequestProperty("Authorization", "Bearer $credential")
        val body = responseBody(connection)
        if (connection.responseCode in listOf(HttpURLConnection.HTTP_UNAUTHORIZED, HttpURLConnection.HTTP_FORBIDDEN)) {
            throw AuthorizationLostException()
        }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) throw IllegalStateException("Motion settings unavailable")
        val cameras = JSONObject(body).getJSONArray("cameras")
        return (0 until cameras.length()).associate { index ->
            val item = cameras.getJSONObject(index)
            val sensitivity = MotionSensitivity.entries.firstOrNull { it.wireValue == item.getString("sensitivity") }
                ?: throw IllegalStateException("Unsupported motion sensitivity")
            item.getString("cameraId") to MotionSettings(
                enabled = item.getBoolean("enabled"),
                recordOnMotion = item.optBoolean("recordOnMotion", false),
                sensitivity = sensitivity,
                cooldownSeconds = item.getInt("cooldownSeconds"),
                quietHours = item.optJSONObject("quietHours")?.let { quiet ->
                    QuietHours(
                        start = quiet.getString("start"),
                        end = quiet.getString("end"),
                        timeZone = quiet.getString("timeZone"),
                    )
                },
            )
        }
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

    private fun connection(path: String, method: String): HttpURLConnection =
        (URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 10_000
            doOutput = method != "DELETE" && method != "GET"
            if (doOutput) setRequestProperty("Content-Type", "application/json")
        }

    private fun responseBody(connection: HttpURLConnection): String {
        val stream =
            if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        return stream?.bufferedReader()?.use { it.readText() }.orEmpty()
    }
}

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
