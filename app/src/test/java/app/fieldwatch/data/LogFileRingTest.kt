package app.fieldwatch.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class LogFileRingTest {
    private fun withDir(block: (File, Long) -> Unit) {
        val dir = Files.createTempDirectory("watch-rotating-logs-").toFile()
        try {
            block(dir, System.currentTimeMillis() - 20_000L)
        } finally {
            dir.deleteRecursively()
        }
    }

    private fun part(dir: File, number: Int, ext: String, whenModified: Long): File =
        File(dir, "fieldwatch-%03d.%s".format(number, ext)).apply {
            writeText("test")
            assertTrue(setLastModified(whenModified))
        }

    @Test
    fun restoresMostRecentlyModifiedPartAfterWrapAndRestart() = withDir { dir, t ->
        part(dir, 10, "jsonl", t)
        part(dir, 11, "jsonl", t + 1000L)
        part(dir, 0, "jsonl", t + 2000L)
        part(dir, 1, "jsonl", t + 3000L)
        assertEquals(1, LogFileRing.newestJsonlIndex(dir))
        assertEquals(listOf("fieldwatch-010.jsonl", "fieldwatch-011.jsonl",
            "fieldwatch-000.jsonl", "fieldwatch-001.jsonl"),
            LogFileRing.orderedParts(dir).map { it.name })
    }

    @Test
    fun ignoresExportsAndUnrecognizedFilesWithoutDeletingThem() = withDir { dir, t ->
        val legitimate = part(dir, 4, "jsonl", t)
        File(dir, "fieldwatch-export-secret.jsonl").writeText("must never replay")
        File(dir, "fieldwatch-012.jsonl").writeText("out of ring")
        File(dir, "fieldwatch-abc.jsonl").writeText("invalid index")
        File(dir, "fieldwatch-005.txt").writeText("wrong format")
        File(dir, "other.csv").writeText("unrelated")
        assertEquals(listOf(legitimate), LogFileRing.orderedParts(dir))
        assertEquals(4, LogFileRing.newestJsonlIndex(dir))
    }

    @Test
    fun keepsLegacyCsvForExportButResumesWritingIntoLatestJsonl() = withDir { dir, t ->
        part(dir, 2, "jsonl", t)
        part(dir, 3, "csv", t + 1000L)
        assertEquals(listOf("fieldwatch-002.jsonl", "fieldwatch-003.csv"),
            LogFileRing.orderedParts(dir).map { it.name })
        assertEquals(2, LogFileRing.newestJsonlIndex(dir))
    }

    @Test
    fun noFilesUsesFreshIndexAndAnEmptyHistory() = withDir { dir, _ ->
        assertEquals(emptyList<File>(), LogFileRing.orderedParts(dir))
        assertEquals(0, LogFileRing.newestJsonlIndex(dir))
    }
}
