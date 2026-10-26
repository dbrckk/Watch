const MAX_ROWS = 250000;

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateMs(raw) {
  const n = number(raw);
  if (n !== null) {
    const ms = n < 1e11 && n > 0 ? n * 1000 : n;
    return Math.abs(ms) <= 8640000000000000 ? ms : null;
  }
  const rawText = String(raw ?? '').trim();
  // Fieldwatch's GeoExport.wigleCsv writes FirstSeen in UTC without an
  // explicit zone: "yyyy-MM-dd HH:mm:ss". Date.parse treats that syntax as
  // local time on many browsers, shifting the timeline on Android/desktop.
  const wigleUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(rawText);
  const parsed = Date.parse(wigleUtc ? rawText.replace(' ', 'T') + 'Z' : rawText);
  return Number.isFinite(parsed) && Math.abs(parsed) <= 8640000000000000 ? parsed : null;
}

function clean(v, max = 250) {
  return String(v ?? '').slice(0, max).trim();
}

export function parseCsv(input) {
  const text = input.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (!quoted && cell === '') quoted = true;
      else if (quoted) quoted = false;
      else cell += c;
    } else if (c === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 2) throw new Error('Fichier trop volumineux (250 000 lignes maximum).');
    } else {
      cell += c;
    }
  }
  if (quoted) throw new Error('CSV invalide : guillemet non fermé.');
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  if (rows[0][0]?.startsWith('WigleWifi-')) rows.shift();
  const headers = (rows.shift() || []).map(s => s.trim().toLowerCase().replace(/^\uFEFF/, ''));
  if (!headers.some(h => ['kind', 'type', 'mac', 'timestamp'].includes(h))) {
    throw new Error('Colonnes Fieldwatch manquantes (kind/mac/timestamp).');
  }
  return rows.map(cols => Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? ''])));
}

export function normalize(row) {
  if (!row || typeof row !== 'object') return null;
  const rawKind = clean(row.kind ?? row.type ?? row.radio ?? '', 60).toUpperCase();
  const kind = rawKind.includes('WIFI') || rawKind.includes('WI-FI') ? 'WIFI' :
    rawKind.includes('BLE') || rawKind.includes('BLUETOOTH') ? 'BLE' : null;
  const mac = clean(row.mac ?? row.bssid ?? row.address ?? '', 100).toUpperCase();
  if (!kind || !mac) return null;
  // JSON exports retain coordinates under position; CSV exports have lat/lon.
  const lat = number(row.lat ?? row.latitude ?? row.currentlatitude ?? row.position?.lat);
  const lon = number(row.lon ?? row.longitude ?? row.currentlongitude ?? row.position?.lon);
  const position = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ?
    {lat, lon} : null;
  // CSV headers are lowercased by parseCsv (firstSeen -> firstseen).
  // Preserve timestamp values from both original Fieldwatch and Watch exports.
  const first = dateMs(row.first_seen ?? row.firstSeen ?? row.firstseen);
  // WiGLE CSV has FirstSeen but no timestamp/lastSeen column. Each row is
  // one historical radio observation; use that time for both endpoints.
  const ts = dateMs(row.ts ?? row.timestamp ?? row.last_seen ?? row.lastSeen ?? row.lastseen ?? row.iso) ?? first;
  const started = first ?? ts;
  const rssi = number(row.rssi);
  const rawHits = number(row.hits ?? row.hitCount);
  const hits = rawHits !== null && Number.isSafeInteger(rawHits) && rawHits >= 1 ? rawHits : 1;
  // Android LogStore CSV encodes both radio privacy flags in its `flags` column
  // (e.g. "RAND HIDDEN"); JSONL and Watch CSV use explicit booleans instead.
  const flags = clean(row.flags ?? '');
  const tokens = new Set(flags.toUpperCase().split(/[\s,;|]+/).filter(Boolean));
  return {
    kind, mac, name: clean(row.name ?? row.ssid ?? ''), vendor: clean(row.vendor ?? ''),
    rssi: rssi === null ? null : Math.round(rssi),
    firstSeen: started, lastSeen: ts, hits: Math.max(1, Math.floor(hits)),
    channel: number(row.channel), freq: number(row.freq ?? row.frequency_mhz),
    flags, fleets: clean(row.fleets ?? row.signatures ?? ''),
    position,
    hidden: row.hidden === true || String(row.hidden).toLowerCase() === 'true' || tokens.has('HIDDEN'),
    randomized: row.rand === true || row.randomized === true ||
      String(row.rand ?? row.randomized).toLowerCase() === 'true' || tokens.has('RAND'),
  };
}

export function parseInput(filename, text) {
  const ext = String(filename).toLowerCase();
  let rows;
  if (ext.endsWith('.csv')) rows = parseCsv(text);
  else if (ext.endsWith('.jsonl') || ext.endsWith('.ndjson')) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(x => x.trim());
    if (lines.length > MAX_ROWS) throw new Error('Fichier trop volumineux.');
    rows = lines.map((line, i) => {
      try { return JSON.parse(line); }
      catch { throw new Error('JSONL invalide à la ligne ' + (i + 1)); }
    });
  } else if (ext.endsWith('.json')) {
    const raw = JSON.parse(text.replace(/^\uFEFF/, ''));
    rows = Array.isArray(raw) ? raw :
      (raw.observations ?? raw.sightings ?? raw.devices ?? raw.records ?? null);
    if (!Array.isArray(rows)) throw new Error('JSON attendu : tableau ou objet avec observations/devices.');
    if (rows.length > MAX_ROWS) throw new Error('Fichier trop volumineux.');
  } else throw new Error('Format non pris en charge : utiliser .csv, .jsonl ou .json.');
  const records = [], rejected = [];
  for (let i = 0; i < rows.length; i++) {
    const rec = normalize(rows[i]);
    if (rec) records.push(rec);
    else rejected.push(i + 1);
  }
  if (rows.length && !records.length) throw new Error('Aucune observation Wi-Fi/BLE reconnue.');
  return {records, ignored: rejected.length};
}

export function createRadioAccumulator() {
  const byId = new Map();
  function add(r) {
    // Never allow user-controlled hit totals to become imprecise numbers.
    if (!Number.isSafeInteger(r.hits) || r.hits < 1) {
      throw new Error('Nombre d’occurrences radio invalide.');
    }
    const key = r.kind + ':' + r.mac;
    const prev = byId.get(key);
    if (!prev) { byId.set(key, {...r, key}); return; }
    if (prev.hits > Number.MAX_SAFE_INTEGER - r.hits) {
      throw new Error('Trop d’occurrences pour un compteur fiable.');
    }
    prev.hits += r.hits;
    if (r.firstSeen !== null && (prev.firstSeen === null || r.firstSeen < prev.firstSeen))
      prev.firstSeen = r.firstSeen;
    // A radio's displayed signal is the most recent valid measurement, not
    // the historical strongest signal. File order can differ from scan order.
    const isNew = r.lastSeen !== null
      ? (prev.lastSeen === null || r.lastSeen >= prev.lastSeen)
      : prev.lastSeen === null;
    if (isNew) {
      if (r.lastSeen !== null) prev.lastSeen = r.lastSeen;
      if (r.name) prev.name = r.name;
      if (r.vendor) prev.vendor = r.vendor;
      if (r.position) prev.position = r.position;
      prev.hidden = r.hidden;
      prev.randomized = r.randomized;
      if (r.channel !== null) prev.channel = r.channel;
      if (r.freq !== null) prev.freq = r.freq;
      if (r.fleets) prev.fleets = r.fleets;
      if (r.rssi !== null) prev.rssi = r.rssi;
    } else {
      // Older observations may fill missing metadata, never replace the
      // newer signal or geographical fix.
      if (!prev.name && r.name) prev.name = r.name;
      if (!prev.vendor && r.vendor) prev.vendor = r.vendor;
      if (!prev.position && r.position) prev.position = r.position;
      if (prev.channel === null && r.channel !== null) prev.channel = r.channel;
      if (prev.freq === null && r.freq !== null) prev.freq = r.freq;
      if (prev.rssi === null && r.rssi !== null) prev.rssi = r.rssi;
    }
  }
  return {add, values: () => [...byId.values()]};
}

export function aggregate(records) {
  const accumulator = createRadioAccumulator();
  for (const record of records) accumulator.add(record);
  return accumulator.values();
}

export function selectDevices(devices, query = '', kind = 'ALL', sort = 'recent') {
  const q = query.toLocaleLowerCase();
  const selected = devices.filter(d =>
    (kind === 'ALL' || d.kind === kind) &&
    [d.mac, d.name, d.vendor, d.fleets].some(x => x.toLocaleLowerCase().includes(q))
  );
  return selected.sort((a, b) => {
    if (sort === 'signal') return (b.rssi ?? -200) - (a.rssi ?? -200);
    if (sort === 'hits') return b.hits - a.hits;
    if (sort === 'name') return (a.name || a.mac).localeCompare(b.name || b.mac);
    return (b.lastSeen ?? 0) - (a.lastSeen ?? 0);
  });
}

function csvCell(value) {
  let s = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export function toCsv(devices, includeCoords = true) {
  const cols = ['kind','mac','name','vendor','rssi','firstSeen','lastSeen','hits','channel','freq','lat','lon','fleets','hidden','randomized'];
  const rows = [cols.join(',')];
  for (const d of devices) {
    const vals = [d.kind,d.mac,d.name,d.vendor,d.rssi,d.firstSeen ? new Date(d.firstSeen).toISOString() : '',
      d.lastSeen ? new Date(d.lastSeen).toISOString() : '',d.hits,d.channel,d.freq,
      includeCoords ? d.position?.lat : '',includeCoords ? d.position?.lon : '',d.fleets,d.hidden,d.randomized];
    rows.push(vals.map(csvCell).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}

export function summary(devices, observations) {
  const wifi = devices.filter(x => x.kind === 'WIFI').length;
  const ble = devices.filter(x => x.kind === 'BLE').length;
  const geotagged = devices.filter(x => x.position).length;
  const signal = devices.filter(x => x.rssi !== null).sort((a,b) => b.rssi - a.rssi)[0] || null;
  const last = devices.reduce((m,d) => Math.max(m, d.lastSeen || 0), 0);
  return {total: devices.length, wifi, ble, geotagged, signal, last, observations};
}

/**
 * Mask literal radio IDs and common 48-bit MAC spellings embedded in names,
 * vendor data or signature metadata. Never mutate the underlying observations:
 * turning off privacy must still show the original values.
 */
export function redactRadioText(value, mac, replacement = 'Identifiant masqué') {
  if (typeof value !== 'string') return value;
  const needle = String(mac ?? '');
  const upper = value.toUpperCase();
  const search = needle.toUpperCase();
  let result = '';
  let cursor = 0;
  if (search) {
    while (true) {
      const at = upper.indexOf(search, cursor);
      if (at < 0) break;
      result += value.slice(cursor, at) + replacement;
      cursor = at + search.length;
    }
  }
  result += value.slice(cursor);
  // Covers AA:BB:CC:DD:EE:FF, AA-BB-CC-DD-EE-FF and AABBCCDDEEFF,
  // including addresses other than the primary MAC found in metadata.
  return result.replace(
    /(?:[a-f0-9]{2}[:-]){5}[a-f0-9]{2}|\b[a-f0-9]{12}\b/gi,
    replacement
  );
}

/**
 * A private export uses an opaque unique ID, not a partially masked MAC.
 * Partial masking collides when the file is reimported and can reveal OUI
 * prefixes. Pass a fresh random namespace for each downloaded export.
 */
export function exportDevices(devices, privacy = true, namespace = '') {
  const prefix = String(namespace || 'local').replace(/[^a-zA-Z0-9-]/g, '').slice(0,64);
  return devices.map(({key,mac,position,...fields}, index) => {
    if (!privacy) return {...fields, mac, position:position ?? null};
    const alias = 'WATCH-' + prefix + '-' + String(index + 1).padStart(6,'0');
    const redact = value => redactRadioText(value, mac, alias);
    const safe=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,redact(v)]));
    return {...safe,mac:alias,position:null};
  });
}

/** O(n) geographic bounds without argument-spread limits on large imports. */
export function geographicBounds(points) {
  let minLat=Infinity,maxLat=-Infinity,minLon=Infinity,maxLon=-Infinity,count=0;
  for (const p of points) {
    const loc=p?.position ?? p;
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) continue;
    minLat=Math.min(minLat,loc.lat);maxLat=Math.max(maxLat,loc.lat);
    minLon=Math.min(minLon,loc.lon);maxLon=Math.max(maxLon,loc.lon);
    count++;
  }
  return count ? {minLat,maxLat,minLon,maxLon,count} : null;
}
