// "Angemeldet bleiben": entsperrte Schlüssel als nicht exportierbare CryptoKeys in IndexedDB.
// Das Passwort selbst wird nie gespeichert.

function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('dienstplaner', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('keys', mode);
    const req = fn(t.objectStore('keys'));
    t.oncomplete = () => { res(req && req.result); d.close(); };
    t.onerror = () => { rej(t.error); d.close(); };
  });
}

export async function getKey(name) {
  try { return await tx('readonly', (s) => s.get(name)); } catch { return null; }
}
export async function setKey(name, value) {
  try { await tx('readwrite', (s) => s.put(value, name)); return true; } catch { return false; }
}
export async function delKey(name) {
  try { await tx('readwrite', (s) => s.delete(name)); } catch { }
}
export async function clearKeys() {
  try { await tx('readwrite', (s) => s.clear()); } catch { }
}
