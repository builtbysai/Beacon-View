package com.beaconsecureview.camera

import java.io.File

/**
 * Removes cache files that start with [prefix] and were last written more than
 * [olderThanMs] ago. Decrypted clips and thumbnails are plaintext, so a crash or
 * kill must not leave them behind for long (V44, V78); the age limit keeps this
 * from touching a file another coroutine is still using.
 */
internal fun deleteStaleCacheFiles(
    directory: File,
    prefix: String,
    olderThanMs: Long,
    now: Long = System.currentTimeMillis(),
): Int =
    directory.listFiles { file -> file.isFile && file.name.startsWith(prefix) && now - file.lastModified() > olderThanMs }
        ?.count { it.delete() } ?: 0
