package com.beaconsecureview.camera

import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.CipherOutputStream
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject

internal data class EncryptedClip(
    val file: File,
    val dataKey: String,
    val iv: String,
)

/** Encrypts a clip with a fresh AES-256-GCM key while streaming between files.
 * The plaintext clip never needs to fit in memory. The returned key and IV are
 * sent through Beacon's authenticated upload-session contract; Drive receives
 * only the ciphertext and authentication tag. */
internal fun encryptClip(source: File, destination: File): EncryptedClip {
    require(source.isFile) { "Recording source is unavailable" }
    val key = ByteArray(32)
    val iv = ByteArray(12)
    SecureRandom().apply {
        nextBytes(key)
        nextBytes(iv)
    }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
    try {
        source.inputStream().buffered().use { input ->
            CipherOutputStream(destination.outputStream().buffered(), cipher).use { output ->
                input.copyTo(output, 64 * 1024)
            }
        }
        return EncryptedClip(
            file = destination,
            dataKey = Base64.getUrlEncoder().withoutPadding().encodeToString(key),
            iv = Base64.getUrlEncoder().withoutPadding().encodeToString(iv),
        )
    } catch (error: Throwable) {
        destination.delete()
        throw error
    } finally {
        key.fill(0)
    }
}

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

/** PUTs the encrypted clip in one request to the resumable session Beacon opened
 * with Drive, mirroring the web viewer's own uploadClipToDrive -- the media
 * itself never passes through Beacon's own server, only this device's own
 * upload straight to the user's Drive. Returns the id Drive assigned the
 * file, which Beacon needs to verify and mark the recording available. */
internal fun uploadClipToDrive(uploadUrl: String, file: File): String {
    val connection =
        (URL(uploadUrl).openConnection() as HttpURLConnection).apply {
            requestMethod = "PUT"
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 60_000
            setRequestProperty("Content-Type", "application/octet-stream")
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
