package com.beaconsecureview.camera

import java.io.EOFException
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The chunked clip format (ADR 0115, "BCLIP1"), byte for byte the same as the web viewer's clip-crypto.ts.
 *
 *   file   = header (16 bytes) || chunk 0 || ... || last chunk
 *   header = "BCLIP1" || 0x00 0x00 || chunk size (uint32, big endian) || 4 zero bytes
 *   chunk  = AES-256-GCM(plaintext piece) || 16-byte tag
 *   nonce  = first 7 bytes of the clip IV || chunk index (uint32, big endian) || last-chunk flag (0 or 1)
 *   AAD    = the 16 header bytes
 *
 * One chunk is held in memory at a time, so a long clip no longer needs memory or disk for a second
 * whole copy (V30, V60). A clip recorded before this format is a single AES-GCM message with no header.
 */
internal object ClipFormat {
    const val HEADER_BYTES = 16
    const val CHUNK_BYTES = 1024 * 1024
    const val TAG_BYTES = 16
    private const val MIN_CHUNK_BYTES = 4096
    private const val MAX_CHUNK_BYTES = 16 * 1024 * 1024
    private val MAGIC = byteArrayOf(0x42, 0x43, 0x4c, 0x49, 0x50, 0x31)

    fun header(chunkBytes: Int): ByteArray =
        ByteArray(HEADER_BYTES).also {
            MAGIC.copyInto(it)
            ByteBuffer.wrap(it).putInt(8, chunkBytes)
        }

    fun isChunked(leading: ByteArray, length: Int = leading.size): Boolean =
        length >= MAGIC.size && MAGIC.indices.all { leading[it] == MAGIC[it] }

    fun nonce(iv: ByteArray, index: Int, last: Boolean): ByteArray =
        ByteArray(12).also {
            iv.copyInto(it, 0, 0, 7)
            ByteBuffer.wrap(it).putInt(7, index)
            it[11] = if (last) 1 else 0
        }

    fun cipher(mode: Int, key: ByteArray, iv: ByteArray, index: Int, last: Boolean, header: ByteArray): Cipher =
        Cipher.getInstance("AES/GCM/NoPadding").also {
            it.init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce(iv, index, last)))
            it.updateAAD(header)
        }

    /** Validates the header and returns the chunk size. */
    fun chunkBytesOf(header: ByteArray): Int {
        if (!isChunked(header, HEADER_BYTES)) throw GeneralSecurityException("Clip format is unknown")
        val chunkBytes = ByteBuffer.wrap(header).getInt(8)
        val zeroBytes = (6..7).all { header[it].toInt() == 0 } && (12..15).all { header[it].toInt() == 0 }
        if (chunkBytes !in MIN_CHUNK_BYTES..MAX_CHUNK_BYTES || chunkBytes and (chunkBytes - 1) != 0 || !zeroBytes) {
            throw GeneralSecurityException("Clip format is not supported")
        }
        return chunkBytes
    }
}

/** Reads until [buffer] is full or the stream ends; returns how many bytes it got. */
private fun InputStream.readUpTo(buffer: ByteArray): Int {
    var filled = 0
    while (filled < buffer.size) {
        val read = read(buffer, filled, buffer.size - filled)
        if (read < 0) break
        filled += read
    }
    return filled
}

/**
 * Encrypts [source] into [destination] in the chunked format with a fresh key and IV (or the fixed ones a test
 * supplies). Only two chunks are ever in memory. Drive receives only the result; the key and IV go through
 * Beacon's authenticated upload-session contract.
 */
internal fun encryptClipChunked(
    source: File,
    destination: File,
    chunkBytes: Int = ClipFormat.CHUNK_BYTES,
    fixedKey: ByteArray? = null,
    fixedIv: ByteArray? = null,
): EncryptedClip {
    require(source.isFile) { "Recording source is unavailable" }
    val key = fixedKey?.copyOf() ?: ByteArray(32).also { SecureRandom().nextBytes(it) }
    val iv = fixedIv?.copyOf() ?: ByteArray(12).also { SecureRandom().nextBytes(it) }
    val header = ClipFormat.header(chunkBytes)
    try {
        source.inputStream().use { input ->
            destination.outputStream().buffered().use { output ->
                output.write(header)
                var current = ByteArray(chunkBytes)
                var currentLength = input.readUpTo(current)
                var next = ByteArray(chunkBytes)
                var index = 0
                while (true) {
                    val nextLength = if (currentLength == chunkBytes) input.readUpTo(next) else 0
                    val last = nextLength == 0
                    output.write(
                        ClipFormat.cipher(Cipher.ENCRYPT_MODE, key, iv, index, last, header)
                            .doFinal(current, 0, currentLength),
                    )
                    if (last) break
                    val swap = current
                    current = next
                    next = swap
                    currentLength = nextLength
                    index++
                }
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

/**
 * Decrypts a chunked clip from [input] (whose first [leading] bytes were already read) into [output],
 * feeding every ciphertext byte to [digest]. Plaintext is written only for chunks that authenticated; the
 * caller must still compare the digest and discard the output if it differs. Throws on any tampering,
 * truncation, reordering or extra bytes.
 */
internal fun decryptClipChunked(
    leading: ByteArray,
    input: InputStream,
    output: OutputStream,
    key: ByteArray,
    iv: ByteArray,
    totalBytes: Long,
    digest: MessageDigest,
) {
    require(leading.size == ClipFormat.HEADER_BYTES)
    val chunkBytes = ClipFormat.chunkBytesOf(leading)
    val fullCipher = chunkBytes.toLong() + ClipFormat.TAG_BYTES
    val body = totalBytes - ClipFormat.HEADER_BYTES
    if (body < ClipFormat.TAG_BYTES) throw GeneralSecurityException("Clip is damaged")
    val chunkCount = maxOf(1L, (body + fullCipher - 1) / fullCipher)
    val finalCipher = body - (chunkCount - 1) * fullCipher
    if (finalCipher < ClipFormat.TAG_BYTES) throw GeneralSecurityException("Clip is damaged")
    if (chunkCount > Int.MAX_VALUE) throw GeneralSecurityException("Clip is too large")
    digest.update(leading)
    val sealed = ByteArray(chunkBytes + ClipFormat.TAG_BYTES)
    for (index in 0 until chunkCount.toInt()) {
        val last = index.toLong() == chunkCount - 1
        val length = (if (last) finalCipher else fullCipher).toInt()
        var filled = 0
        while (filled < length) {
            val read = input.read(sealed, filled, length - filled)
            if (read < 0) throw EOFException("Clip download was incomplete")
            filled += read
        }
        digest.update(sealed, 0, length)
        val plain =
            try {
                ClipFormat.cipher(Cipher.DECRYPT_MODE, key, iv, index, last, leading).doFinal(sealed, 0, length)
            } catch (error: GeneralSecurityException) {
                throw GeneralSecurityException("Clip failed its integrity check", error)
            }
        output.write(plain)
    }
    if (input.read() >= 0) throw GeneralSecurityException("Clip download was larger than expected")
}
