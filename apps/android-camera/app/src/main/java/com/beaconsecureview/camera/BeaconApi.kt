package com.beaconsecureview.camera

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class BeaconApi(private val baseUrl: String) {
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
        connection.outputStream.use { it.write(ByteArray(0)) }
        responseBody(connection)
        return connection.responseCode == HttpURLConnection.HTTP_NO_CONTENT
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
