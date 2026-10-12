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

    /**
     * Asks for a replacement device credential (about monthly, V22). Returns the new credential, or null when
     * none is due. The old one keeps working until the new one is first used, so a failure here is harmless.
     */
    fun rotateCredential(credential: String): String? {
        val connection = connection("/api/device/credential/rotate", "POST")
        connection.setRequestProperty("Authorization", "Bearer $credential")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        val body = responseBody(connection)
        return when (connection.responseCode) {
            HttpURLConnection.HTTP_CREATED -> JSONObject(body).getString("credential")
            HttpURLConnection.HTTP_NO_CONTENT -> null
            HttpURLConnection.HTTP_UNAUTHORIZED -> throw AuthorizationLostException()
            else -> throw IllegalStateException("Credential rotation is unavailable.")
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
     * report, or null when this report didn't trigger one (recording-on-motion is
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
     * matching the device-initiated recording path. Mirrors the web viewer's own
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
