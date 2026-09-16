package com.beaconsecureview.camera

import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import org.json.JSONObject

/** Streaming SHA-256 of a recorded clip file, matching the checksum Beacon's
 * upload-session contract requires -- never loads the whole clip into memory. */
internal fun sha256Hex(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { stream ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val read = stream.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
        }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
}

/** PUTs the whole clip in one request to the resumable session Beacon opened
 * with Drive, mirroring the web viewer's own uploadClipToDrive -- the media
 * itself never passes through Beacon's own server, only this device's own
 * upload straight to the user's Drive. Returns the id Drive assigned the
 * file, which Beacon needs to verify and mark the recording available. */
internal fun uploadClipToDrive(uploadUrl: String, file: File, mimeType: String): String {
    val connection =
        (URL(uploadUrl).openConnection() as HttpURLConnection).apply {
            requestMethod = "PUT"
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 60_000
            setRequestProperty("Content-Type", mimeType)
            setFixedLengthStreamingMode(file.length())
        }
    file.inputStream().use { input ->
        connection.outputStream.use { output -> input.copyTo(output) }
    }
    val body =
        (if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream)
            ?.bufferedReader()
            ?.use { it.readText() }
            .orEmpty()
    if (connection.responseCode !in 200..299) {
        throw IllegalStateException("Upload to Google Drive failed")
    }
    val fileId = JSONObject(body).optString("id")
    if (fileId.isEmpty()) throw IllegalStateException("Google Drive did not return a file id")
    return fileId
}
