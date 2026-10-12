package com.beaconsecureview.camera

import java.nio.file.Files
import java.util.Base64
import kotlin.io.path.writeBytes
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class MotionClipUploadTest {
    @Test
    fun encryptsClipWithAUniqueAuthenticatedEnvelope() {
        val directory = Files.createTempDirectory("beacon-recording-test")
        val source = directory.resolve("clip.mp4")
        val destination = directory.resolve("clip.encrypted")
        val plaintext = ByteArray(160_000) { index -> (index % 251).toByte() }
        source.writeBytes(plaintext)

        val encrypted = encryptClip(source.toFile(), destination.toFile())
        val key = Base64.getUrlDecoder().decode(encrypted.dataKey)
        val iv = Base64.getUrlDecoder().decode(encrypted.iv)
        val ciphertext = destination.toFile().readBytes()

        assertEquals(32, key.size)
        assertEquals(12, iv.size)
        // One chunk: header, the clip, one authentication tag.
        assertEquals(ClipFormat.HEADER_BYTES + plaintext.size + ClipFormat.TAG_BYTES, ciphertext.size)
        assertFalse(ciphertext.copyOfRange(ClipFormat.HEADER_BYTES, ciphertext.size).contentEquals(plaintext))
        assertEquals(64, sha256Hex(destination.toFile()).length)

        source.toFile().delete()
        destination.toFile().delete()
        directory.toFile().delete()
    }
}
