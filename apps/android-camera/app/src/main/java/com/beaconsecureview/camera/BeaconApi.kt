package com.beaconsecureview.camera

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class AuthorizationLostException : IllegalStateException()

class BeaconApi(private val baseUrl: String) {
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
            throw IllegalStateException("Unable to pair device")
        }
        return JSONObject(body).getString("credential")
    }

    fun heartbeat(credential: String): Boolean {
        val connection = connection("/api/device/heartbeat", "POST")
        connection.setRequestProperty("Authorization", "Bearer $credential")
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        responseBody(connection)
        return when (connection.responseCode) {
            HttpURLConnection.HTTP_NO_CONTENT -> true
            HttpURLConnection.HTTP_UNAUTHORIZED,
            HttpURLConnection.HTTP_FORBIDDEN,
            -> false
            else -> throw IllegalStateException("Heartbeat temporarily unavailable")
        }
    }

    fun syncCameras(
        credential: String,
        sources: List<CameraSource>,
    ): List<CameraSource> {
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
        return (0 until cameras.length()).map { index ->
            cameras.getJSONObject(index).let {
                CameraSource(
                    id = it.getString("id"),
                    sourceKey = it.getString("sourceKey"),
                    name = it.getString("name"),
                    facing = it.getString("facing"),
                )
            }
        }
    }

    private fun connection(path: String, method: String): HttpURLConnection =
        (URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 10_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
        }

    private fun responseBody(connection: HttpURLConnection): String {
        val stream =
            if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        return stream?.bufferedReader()?.use { it.readText() }.orEmpty()
    }
}
