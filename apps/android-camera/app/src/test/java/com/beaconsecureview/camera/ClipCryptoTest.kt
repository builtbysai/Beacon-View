package com.beaconsecureview.camera

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class ClipCryptoTest {
    private val key = ByteArray(32) { it.toByte() }
    private val iv = ByteArray(12) { (0x10 + it).toByte() }
    private val chunk = 4096

    private fun pattern(length: Int) = ByteArray(length) { (it % 251).toByte() }

    private fun seal(plain: ByteArray): ByteArray {
        val directory = Files.createTempDirectory("beacon-clip-crypto").toFile()
        val source = File(directory, "clip.mp4").also { it.writeBytes(plain) }
        val destination = File(directory, "clip.encrypted")
        encryptClipChunked(source, destination, chunk, key, iv)
        return destination.readBytes().also { directory.deleteRecursively() }
    }

    private fun open(sealed: ByteArray): ByteArray {
        val leading = sealed.copyOfRange(0, ClipFormat.HEADER_BYTES)
        val output = ByteArrayOutputStream()
        decryptClipChunked(
            leading,
            ByteArrayInputStream(sealed, ClipFormat.HEADER_BYTES, sealed.size - ClipFormat.HEADER_BYTES),
            output,
            key,
            iv,
            sealed.size.toLong(),
            MessageDigest.getInstance("SHA-256"),
        )
        return output.toByteArray()
    }

    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    @Test
    fun matchesTheKnownAnswerSharedWithTheWebViewer() {
        val sealed = seal(pattern(5000))
        // The web viewer's clip-crypto.test.ts asserts the same digest for the same inputs.
        assertEquals(
            "c962c4581ddd4a3fb9a5944752c20f98cafc0a25bd9ae82728eed410c0a3c5ce",
            hex(MessageDigest.getInstance("SHA-256").digest(sealed)),
        )
        assertEquals(16 + 5000 + 2 * 16, sealed.size)
    }

    @Test
    fun roundTripsEveryBoundarySize() {
        for (length in listOf(0, 1, chunk - 1, chunk, chunk + 1, 3 * chunk, 3 * chunk + 7)) {
            val sealed = seal(pattern(length))
            assertTrue(ClipFormat.isChunked(sealed))
            assertContentEquals(pattern(length), open(sealed), "length $length")
        }
    }

    @Test
    fun rejectsAFlippedByteATruncatedFileAndSwappedChunks() {
        val sealed = seal(pattern(3 * chunk + 5))
        val flipped = sealed.copyOf().also { it[it.size - 20] = (it[it.size - 20].toInt() xor 1).toByte() }
        assertFailsWith<GeneralSecurityException> { open(flipped) }

        // Dropping the last chunk leaves a file that ends on a chunk boundary.
        assertFailsWith<GeneralSecurityException> { open(sealed.copyOf(16 + 3 * (chunk + 16))) }

        val swapped = sealed.copyOf()
        sealed.copyInto(swapped, 16, 16 + chunk + 16, 16 + 2 * (chunk + 16))
        sealed.copyInto(swapped, 16 + chunk + 16, 16, 16 + chunk + 16)
        assertFailsWith<GeneralSecurityException> { open(swapped) }
    }

    @Test
    fun rejectsExtraBytesAfterTheLastChunk() {
        val sealed = seal(pattern(chunk))
        val longer = sealed + byteArrayOf(0)
        val leading = longer.copyOfRange(0, ClipFormat.HEADER_BYTES)
        assertFailsWith<GeneralSecurityException> {
            decryptClipChunked(
                leading,
                ByteArrayInputStream(longer, ClipFormat.HEADER_BYTES, longer.size - ClipFormat.HEADER_BYTES),
                ByteArrayOutputStream(),
                key,
                iv,
                sealed.size.toLong(),
                MessageDigest.getInstance("SHA-256"),
            )
        }
    }

    @Test
    fun theUploadEncryptionUsesTheChunkedFormatWithAFreshKey() {
        val directory = Files.createTempDirectory("beacon-clip-upload").toFile()
        val source = File(directory, "clip.mp4").also { it.writeBytes(pattern(2_500_000)) }
        val destination = File(directory, "clip.encrypted")
        val encrypted = encryptClip(source, destination)
        val sealed = destination.readBytes()
        assertTrue(ClipFormat.isChunked(sealed))
        assertEquals(32, Base64.getUrlDecoder().decode(encrypted.dataKey).size)
        assertEquals(12, Base64.getUrlDecoder().decode(encrypted.iv).size)
        assertEquals(16 + 2_500_000 + 3 * 16, sealed.size)
        directory.deleteRecursively()
    }
}
