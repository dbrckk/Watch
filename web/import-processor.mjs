import {aggregate, parseInput} from './core.mjs';

export const FILE_LIMIT = 20;
export const FILE_BYTES_LIMIT = 40 * 1024 * 1024;
export const TOTAL_BYTES_LIMIT = 80 * 1024 * 1024;
export const OBSERVATION_LIMIT = 250000;

/**
 * Complete an import as one transaction. The caller swaps the session state
 * only after every selected file has been parsed and validated.
 * Return aggregated radios and daily counts, not the raw 250k-item log.
 */
export async function processFiles(files) {
  const selected = Array.from(files ?? []).filter(f => f && typeof f.name === 'string' && f.name);
  if (!selected.length) return {devices: [], observations: 0, ignored: 0, files: [], dailyCounts: []};
  if (selected.length > FILE_LIMIT) throw new Error('20 fichiers maximum par import.');
  if (selected.some(f => !Number.isFinite(f.size) || f.size < 0 || f.size > FILE_BYTES_LIMIT)) {
    throw new Error('Un fichier dépasse la limite de 40 Mo ou sa taille est invalide.');
  }
  if (selected.reduce((sum, f) => sum + f.size, 0) > TOTAL_BYTES_LIMIT) {
    throw new Error("L'import total est limité à 80 Mo.");
  }

  const records = [], daily = new Map(), names = [];
  let ignored = 0;
  for (const file of selected) {
    const {records: parsed, ignored: skipped} = parseInput(file.name, await file.text());
    if (records.length + parsed.length > OBSERVATION_LIMIT) {
      throw new Error('250 000 observations maximum par session.');
    }
    ignored += skipped;
    names.push(file.name);
    for (const record of parsed) {
      records.push(record);
      const at = record.lastSeen;
      if (at && Number.isFinite(at) && Math.abs(at) <= 8640000000000000) {
        const day = new Date(at).toISOString().slice(0, 10);
        daily.set(day, (daily.get(day) || 0) + 1);
      }
    }
  }
  return {
    devices: aggregate(records),
    observations: records.length,
    ignored,
    files: names,
    dailyCounts: [...daily].sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({date, count})),
  };
}
