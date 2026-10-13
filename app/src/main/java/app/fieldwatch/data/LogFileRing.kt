package app.fieldwatch.data

import java.io.File

/**
 * Recover the most recently used segment of the 12-part rotating Fieldwatch
 * log when the process restarts. Segment numbers are a ring, NOT timestamps:
 * sorting lexicographically can replay old records after fresh ones.
 */
internal object LogFileRing {
    const val CAPACITY = 12

    private fun partNumber(file: File): Int? {
        val match = Regex("^fieldwatch-([0-9]{3})\\.(jsonl|csv)$").matchEntire(file.name)
            ?: return null
        val index = match.groupValues[1].toIntOrNull() ?: return null
        return index.takeIf { it in 0 until CAPACITY }
    }

    fun orderedParts(folder: File): List<File> =
        folder.listFiles()
            ?.asSequence()
            ?.filter { it.isFile && partNumber(it) != null }
            ?.sortedWith(compareBy<File> { it.lastModified() }.thenBy { it.name })
            ?.toList()
            ?: emptyList()

    fun newestJsonlIndex(folder: File): Int =
        orderedParts(folder)
            .asReversed()
            .firstOrNull { it.name.endsWith(".jsonl") }
            ?.let(::partNumber)
            ?: 0
}
