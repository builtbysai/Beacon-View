package com.beaconsecureview.camera

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CacheHygieneTest {
    private fun directory(): File = kotlin.io.path.createTempDirectory("beacon-cache-test").toFile()

    @Test
    fun removesOnlyOldFilesWithThePrefix() {
        val dir = directory()
        val old = File(dir, "beacon-rec-old.mp4").apply { writeText("x"); setLastModified(1_000) }
        val fresh = File(dir, "beacon-rec-fresh.mp4").apply { writeText("x"); setLastModified(9_500) }
        val other = File(dir, "something-else.bin").apply { writeText("x"); setLastModified(1_000) }

        val removed = deleteStaleCacheFiles(dir, "beacon-rec-", olderThanMs = 5_000, now = 10_000)

        assertEquals(1, removed)
        assertFalse(old.exists())
        assertTrue(fresh.exists())
        assertTrue(other.exists())
        dir.deleteRecursively()
    }

    @Test
    fun aMissingDirectoryRemovesNothing() {
        assertEquals(0, deleteStaleCacheFiles(File("does-not-exist-beacon"), "beacon-rec-", 1_000))
    }
}
