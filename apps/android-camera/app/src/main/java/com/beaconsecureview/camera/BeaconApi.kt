package com.beaconsecureview.camera

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class AuthorizationLostException : IllegalStateException()

class PairingException(message: String) : IllegalStateException(message)

class BeaconApi(private val baseUrl: String) {
    data class AccountSession(val token: String, val userId: String)

    data class MonitorCamera(
        val id: String,
        val name: String,
        val deviceName: String,
        val online: Boolean,
        val privacyMode: Boolean,
        val viewerCount: Int,
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
        return AccountSession(
            token = response.getString("sessionToken"),
            userId = response.getJSONObject("user").getString("id"),
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
        return AccountSession(
            token = response.getString("sessionToken"),
            userId = response.getJSONObject("user").getString("id"),
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
                )
            }
        }
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
        val connection = connection("/api/device/registration", "DELETE")
        connection.setRequestProperty("Authorization", "Bearer $credential")
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

    fun reportMotion(credential: String, cameraId: String, confidence: Float) {
        val connection = connection("/api/device/cameras/$cameraId/motion-events", "POST")
        connection.setRequestProperty("Authorization", "Bearer $credential")
        connection.outputStream.use {
            it.write(
                JSONObject().put("confidence", confidence.toDouble()).toString()
                    .toByteArray(Charsets.UTF_8),
            )
        }
        responseBody(connection)
        checkMotionReportResponse(connection.responseCode)
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
