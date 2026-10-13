package app.fieldwatch.data

import java.io.File

/**
 * Limits temporary copies of shared radio logs. Only our own export prefix is
 * eligible: this directory also contains independent GPX, KML and other files.
 *
 * Fresh files are temporarily retained so a recipient opened from Android's
 * share sheet can still read the granted FileProvider URI. Old files and
 * surplus older exports are deleted on the next export or app startup.
 */
object ExportCacheRetention {
    private const val PREFIX = "fieldwatch-export-"
    private const val MAX_FILES = 6
    private const val DAY_MS = 24L * 60L * 60L * 1000L
    private const val GRACE_MS = 15L * 60L * 1000L

    fun prune(
        folder: File,
        now: Long = System.currentTimeMillis(),
    ): Int {
        val exports = folder.listFiles()
            ?.filter { it.isFile && it.name.startsWith(PREFIX) }
            ?.sortedWith(compareByDescending<File> { it.lastModified() }.thenByDescending { it.name })
            ?: return 0

        var removed = 0
        exports.forEachIndexed { index, file ->
            val timestamp = file.lastModified()
            // Clock skew or a failed timestamp read must not silently force
            // deletion of a newly created share.
            val age = if (timestamp in 1L..now) now - timestamp else 0L
            val stale = age > DAY_MS
            val surplus = index >= MAX_FILES && age > GRACE_MS
            if ((stale || surplus) && file.delete()) removed++
        }
        return removed
    }

    fun clear(folder: File): Int {
        var removed = 0
        folder.listFiles()
            ?.filter { it.isFile && it.name.startsWith(PREFIX) }
            ?.forEach { if (it.delete()) removed++ }
        return removed
    }
}
