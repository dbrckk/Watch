const MAX_ROWS = 250000;

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateMs(raw) {
  const n = number(raw);
  if (n !== null) return n < 1e11 && n > 0 ? n * 1000 : n;
  const p = Date.parse(String(raw || ''));
  return Number.isFinite(p) ? p : null;
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
  const lat = number(row.lat ?? row.latitude ?? row.currentlatitude);
  const lon = number(row.lon ?? row.longitude ?? row.currentlongitude);
  const position = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ?
    {lat, lon} : null;
  const ts = dateMs(row.ts ?? row.timestamp ?? row.last_seen ?? row.lastSeen ?? row.iso);
  const first = dateMs(row.first_seen ?? row.firstSeen) ?? ts;
  const rssi = number(row.rssi);
  const hits = number(row.hits ?? row.hitCount) ?? 1;
  return {
    kind, mac, name: clean(row.name ?? row.ssid ?? ''), vendor: clean(row.vendor ?? ''),
    rssi: rssi === null ? null : Math.round(rssi),
    firstSeen: first, lastSeen: ts, hits: Math.max(1, Math.floor(hits)),
    channel: number(row.channel), freq: number(row.freq ?? row.frequency_mhz),
    flags: clean(row.flags ?? ''), fleets: clean(row.fleets ?? row.signatures ?? ''),
    position,
    hidden: row.hidden === true || row.hidden === 'true',
    randomized: row.rand === true || row.randomized === true || row.rand === 'true',
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

export function aggregate(records) {
  const byId = new Map();
  for (const r of records) {
    const key = r.kind + ':' + r.mac;
    const prev = byId.get(key);
    if (!prev) { byId.set(key, {...r, key}); continue; }
    prev.hits += r.hits;
    if (r.firstSeen !== null && (prev.firstSeen === null || r.firstSeen < prev.firstSeen))
      prev.firstSeen = r.firstSeen;
    const isNew = r.lastSeen !== null && (prev.lastSeen === null || r.lastSeen >= prev.lastSeen);
    if (isNew) {
      prev.lastSeen = r.lastSeen;
      if (r.name) prev.name = r.name;
      if (r.vendor) prev.vendor = r.vendor;
      if (r.position) prev.position = r.position;
      prev.hidden = r.hidden;
      prev.randomized = r.randomized;
      prev.channel = r.channel;
      prev.freq = r.freq;
      if (r.fleets) prev.fleets = r.fleets;
    }
    if (r.rssi !== null && (prev.rssi === null || r.rssi > prev.rssi)) prev.rssi = r.rssi;
  }
  return [...byId.values()];
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
  const cols = ['kind','mac','name','vendor','rssi','firstSeen','lastSeen','hits','channel','freq','lat','lon','fleets'];
  const rows = [cols.join(',')];
  for (const d of devices) {
    const vals = [d.kind,d.mac,d.name,d.vendor,d.rssi,d.firstSeen ? new Date(d.firstSeen).toISOString() : '',
      d.lastSeen ? new Date(d.lastSeen).toISOString() : '',d.hits,d.channel,d.freq,
      includeCoords ? d.position?.lat : '',includeCoords ? d.position?.lon : '',d.fleets];
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
