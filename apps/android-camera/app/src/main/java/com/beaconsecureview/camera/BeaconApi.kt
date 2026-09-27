package com.beaconsecureview.camera

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
    data class AccountSession(
        val token: String,
        val userId: String,
        val email: String? = null,
        val householdRole: String? = null,
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

    data class CameraMotionSettings(
        val cameraId: String,
        val enabled: Boolean,
        val recordOnMotion: Boolean,
        val sensitivity: MotionSensitivity,
        val cooldownSeconds: Int,
        val quietHours: QuietHours?,
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
        val household = JSONObject(body).optJSONObject("household")
        return AccountSession(
            token = sessionToken,
            userId = user.getString("id"),
            email = user.optString("email").takeIf(String::isNotBlank),
            householdRole = household?.optString("role")?.takeIf(String::isNotBlank),
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
            throw IllegalStateException(
                when (serverMessage) {
                    "Connect Google Drive for recordings first" ->
                        "Connect Google Drive for recordings from Beacon Settings first."
                    "Camera is offline", "Camera is unavailable" ->
                        "The camera must be online before recording."
                    "Household owner access required" ->
                        "Only the household owner can record clips."
                    else -> "Recording could not be started. Try again."
                },
            )
        }
        return parseRecordingSummary(JSONObject(body).getJSONObject("recording"))
    }

    fun deleteRecording(sessionToken: String, recordingId: String) {
        val connection = connection("/api/recordings/${urlPathSegment(recordingId)}", "DELETE")
        connection.setRequestProperty("Authorization", "Bearer $sessionToken")
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
            cacheDirectory.listFiles { file -> file.name.startsWith("beacon-thumb-") }
                ?.forEach { it.delete() }
            val encryptedFile = File.createTempFile("beacon-thumb-", ".encrypted", cacheDirectory)
            val extension = if (mimeType == "image/webp") ".webp" else ".jpg"
            val imageFile = File.createTempFile("beacon-thumb-", extension, cacheDirectory)
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
        val body = responseBody(connection)
        if (connection.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) throw AuthorizationLostException()
        if (connection.responseCode != HttpURLConnection.HTTP_NO_CONTENT) {
            val serverMessage = runCatching { JSONObject(body).optString("error") }.getOrNull()
            throw IllegalStateException(serverMessage?.takeIf(String::isNotBlank) ?: "Share link could not be removed")
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
        )

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
