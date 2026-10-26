/**
 * Optional local session checkpoint. This is NOT an automatic cache:
 * records can contain full radio MACs and precise phone GPS coordinates.
 * Writes only happen after an explicit user action and confirmation.
 */
export const SNAPSHOT_VERSION = 1;
const DB_NAME = 'watch-local-sessions-v1';
const STORE = 'checkpoints';
const KEY = 'last';
const MAX_OBSERVATIONS = 250000;

function validTime(n) {
  return n === null || (Number.isFinite(n) && Math.abs(n) <= 8640000000000000);
}

export function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.version !== SNAPSHOT_VERSION ||
      !Number.isSafeInteger(snapshot.savedAt) || snapshot.savedAt < 1 ||
      !Number.isSafeInteger(snapshot.observations) || snapshot.observations < 0 ||
      snapshot.observations > MAX_OBSERVATIONS ||
      !Array.isArray(snapshot.devices) || snapshot.devices.length > MAX_OBSERVATIONS ||
      snapshot.devices.length > snapshot.observations ||
      !Array.isArray(snapshot.dailyCounts) || snapshot.dailyCounts.length > MAX_OBSERVATIONS ||
      !Array.isArray(snapshot.files) || snapshot.files.length > 20 ||
      snapshot.files.some(name => typeof name !== 'string' || !name || name.length > 300)) {
    throw new Error('Sauvegarde locale invalide ou incompatible.');
  }
  for (const d of snapshot.devices) {
    if (!d || typeof d !== 'object' || !['WIFI','BLE'].includes(d.kind) ||
        typeof d.mac !== 'string' || !d.mac || d.mac.length > 100 ||
        d.key !== d.kind + ':' + d.mac ||
        !Number.isSafeInteger(d.hits) || d.hits < 1 ||
        !validTime(d.firstSeen) || !validTime(d.lastSeen) ||
        (d.position !== null && (typeof d.position !== 'object' ||
          !Number.isFinite(d.position?.lat) || !Number.isFinite(d.position?.lon) ||
          Math.abs(d.position.lat) > 90 || Math.abs(d.position.lon) > 180)) ||
        !['name','vendor','fleets','flags'].every(k => typeof d[k] === 'string') ||
        (d.rssi !== null && !Number.isFinite(d.rssi))) {
      throw new Error('Sauvegarde locale contenant une radio invalide.');
    }
  }
  let totalDaily = 0;
  for (const day of snapshot.dailyCounts) {
    if (!day || typeof day !== 'object' || typeof day.date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
        !Number.isSafeInteger(day.count) || day.count < 1 ||
        day.count > MAX_OBSERVATIONS) {
      throw new Error('Chronologie locale invalide.');
    }
    totalDaily += day.count;
    if (totalDaily > snapshot.observations) {
      throw new Error('Chronologie locale incohérente.');
    }
  }
  return snapshot;
}

function openDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Le stockage local est indisponible dans ce navigateur.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Ouverture du stockage impossible.'));
    request.onblocked = () => reject(new Error('Le stockage est bloqué par un autre onglet.'));
  });
}

async function transact(mode, action, value) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      let result;
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const request = action === 'get' ? store.get(KEY) :
        action === 'exists' ? store.getKey(KEY) :
        action === 'put' ? store.put(value, KEY) : store.delete(KEY);
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || new Error('Transaction locale annulée.'));
      tx.onerror = () => reject(tx.error || new Error('Erreur de stockage local.'));
    });
  } finally {
    db.close();
  }
}

export async function saveSnapshot(data) {
  const snapshot = validateSnapshot({
    version: SNAPSHOT_VERSION,
    savedAt: Date.now(),
    observations: data.observations,
    devices: data.devices,
    dailyCounts: data.dailyCounts,
    files: data.files,
  });
  await transact('readwrite', 'put', snapshot);
  return snapshot.savedAt;
}

export async function loadSnapshot() {
  const snapshot = await transact('readonly', 'get');
  return snapshot ? validateSnapshot(snapshot) : null;
}

export async function hasSnapshot() {
  return (await transact('readonly', 'exists')) !== undefined;
}

export async function removeSnapshot() {
  await transact('readwrite', 'delete');
}
