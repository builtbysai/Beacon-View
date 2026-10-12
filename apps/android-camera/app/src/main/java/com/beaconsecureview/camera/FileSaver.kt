package com.beaconsecureview.camera

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import java.io.File
import java.io.OutputStream
import java.util.UUID

/** Names and limits for files the web app asks the app to save (ADR 0121). Kept apart from Android so it is tested. */
internal object SaveRules {
    const val MAX_OPEN = 4
    const val MAX_BYTES = 1L shl 30
    const val MAX_CHUNK_BASE64 = 262_144

    private val mimePattern = Regex("^[a-z0-9][a-z0-9.+-]{0,60}/[a-z0-9][a-z0-9.+-]{0,60}$")

    /** A file name with no path, no control or reserved characters, and a length a file system accepts. */
    fun safeName(name: String): String {
        val cleaned =
            name.substringAfterLast('/').substringAfterLast('\\')
                .replace(Regex("[\\u0000-\\u001f\\u007f<>:\"|?*]"), "")
                .trim()
                .trim('.')
                .take(120)
        return cleaned.ifEmpty { "Beacon download" }
    }

    fun safeMime(mime: String): String = mime.lowercase().takeIf { mimePattern.matches(it) } ?: "application/octet-stream"
}

/**
 * Saves files the web app hands over in pieces, because a blob made in the page (a decrypted clip, a snapshot) cannot go
 * through the WebView's own download. Nothing leaves the phone: it lands in the Downloads folder the person already has.
 */
internal class FileSaver(private val context: Context) {
    private class Session(
        val name: String,
        val output: OutputStream,
        val finish: () -> Unit,
        val abort: () -> Unit,
        var bytes: Long = 0,
    )

    private val sessions = HashMap<String, Session>()

    /** Opens a file and returns the token the pieces go to, or null when too many are open or it cannot be created. */
    @Synchronized
    fun start(name: String, mime: String): String? {
        if (sessions.size >= SaveRules.MAX_OPEN) return null
        val safeName = SaveRules.safeName(name)
        val session = open(safeName, SaveRules.safeMime(mime)) ?: return null
        val token = UUID.randomUUID().toString()
        sessions[token] = session
        return token
    }

    @Synchronized
    fun chunk(token: String, base64: String): Boolean {
        val session = sessions[token] ?: return false
        if (base64.length > SaveRules.MAX_CHUNK_BASE64) return abort(token)
        return runCatching {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            if (session.bytes + bytes.size > SaveRules.MAX_BYTES) return abort(token)
            session.output.write(bytes)
            session.bytes += bytes.size
            true
        }.getOrElse { abort(token) }
    }

    /** Finishes the file; returns the name it was saved under, or null if it was not open. */
    @Synchronized
    fun end(token: String): String? {
        val session = sessions.remove(token) ?: return null
        return runCatching {
            session.output.close()
            session.finish()
            session.name
        }.getOrElse {
            session.abort()
            null
        }
    }

    @Synchronized
    fun abortAll() {
        sessions.keys.toList().forEach { abort(it) }
    }

    private fun abort(token: String): Boolean {
        val session = sessions.remove(token) ?: return false
        runCatching { session.output.close() }
        session.abort()
        return false
    }

    private fun open(name: String, mime: String): Session? =
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = context.contentResolver
                val values =
                    ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, name)
                        put(MediaStore.Downloads.MIME_TYPE, mime)
                        put(MediaStore.Downloads.IS_PENDING, 1)
                    }
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
                val output = resolver.openOutputStream(uri) ?: return null
                Session(
                    name = name,
                    output = output,
                    finish = {
                        resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
                    },
                    abort = { runCatching { resolver.delete(uri, null, null) } },
                )
            } else {
                val directory = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return null
                val file = File(directory, name)
                Session(name = name, output = file.outputStream(), finish = {}, abort = { runCatching { file.delete() } })
            }
        }.getOrNull()
}
