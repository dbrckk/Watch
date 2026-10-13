package app.fieldwatch.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class ExportCacheRetentionTest {
    private fun withDir(test: (java.io.File) -> Unit) {
        val dir = Files.createTempDirectory("watch-export-cache-").toFile()
        try { test(dir) } finally { dir.deleteRecursively() }
    }

    @Test
    fun removesDayOldTemporarySharesButDoesNotTouchOtherExports() = withDir { dir ->
        val now = System.currentTimeMillis()
        val old = java.io.File(dir, "fieldwatch-export-old.jsonl").apply {
            writeText("sensitive radio log")
            assertTrue(setLastModified(now - 25L * 60L * 60L * 1000L))
        }
        val recent = java.io.File(dir, "fieldwatch-export-recent.csv").apply {
            writeText("in-flight share")
            assertTrue(setLastModified(now - 2L * 60L * 1000L))
        }
        val map = java.io.File(dir, "fieldwatch-map.gpx").apply {
            writeText("independent export")
            assertTrue(setLastModified(now - 30L * 60L * 60L * 1000L))
        }
        assertEquals(1, ExportCacheRetention.prune(dir, now))
        assertFalse(old.exists())
        assertTrue(recent.exists())
        assertTrue(map.exists())
    }

    @Test
    fun limitsOlderExportsWhileRetainingVeryRecentShareSheetFiles() = withDir { dir ->
        val now = System.currentTimeMillis()
        repeat(9) { i ->
            java.io.File(dir, "fieldwatch-export-${i}.jsonl").apply {
                writeText("radio")
                assertTrue(setLastModified(now - ((i + 1) * 20L * 60L * 1000L)))
            }
        }
        val fresh = java.io.File(dir, "fieldwatch-export-new.jsonl").apply {
            writeText("share still pending")
            assertTrue(setLastModified(now - 60_000L))
        }
        assertEquals(4, ExportCacheRetention.prune(dir, now))
        assertEquals(6, dir.listFiles()!!.size)
        assertTrue(fresh.exists())
    }

    @Test
    fun clearDeletesOnlyInternalRadioExports() = withDir { dir ->
        val log = java.io.File(dir, "fieldwatch-export-x.jsonl").apply { writeText("secret") }
        val map = java.io.File(dir, "custom-map.kml").apply { writeText("not ours") }
        assertEquals(1, ExportCacheRetention.clear(dir))
        assertFalse(log.exists())
        assertTrue(map.exists())
    }

    @Test
    fun toleratesMissingFolderAndFutureTimestamps() = withDir { dir ->
        assertEquals(0, ExportCacheRetention.prune(java.io.File(dir, "missing")))
        val future = java.io.File(dir, "fieldwatch-export-future.jsonl").apply {
            writeText("protected")
            assertTrue(setLastModified(System.currentTimeMillis() + 1000L * 60L * 60L))
        }
        assertEquals(0, ExportCacheRetention.prune(dir))
        assertTrue(future.exists())
    }
}
