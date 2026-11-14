// Verschlüsselung der Mitarbeiterdaten (WebCrypto).
// Jede Mitarbeiterdatei hat einen eigenen Datenschlüssel (AES-GCM 256).
// Dieser Datenschlüssel wird zweimal abgelegt:
//   1. verschlüsselt mit dem Passwort des Mitarbeiters (PBKDF2 → AES-GCM)
//   2. verschlüsselt mit dem öffentlichen Planer-Schlüssel (RSA-OAEP)
// Der private Planer-Schlüssel liegt nur verschlüsselt (mit dem Planer-Passwort) im Plan.

const enc = new TextEncoder();
const dec = new TextDecoder();
const ITER = 250000;

export function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

export function randomId(len = 10) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(randomBytes(len), (b) => abc[b % abc.length]).join('');
}

async function passwordKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function aesEncrypt(key, bytes) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: b64(iv), ct: b64(ct) };
}

async function aesDecrypt(key, box) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct)));
}

async function importDataKey(raw) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// ---------- Planer-Schlüsselpaar ----------

export async function createAdminKeys(password) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['encrypt', 'decrypt']);
  const pub = b64(await crypto.subtle.exportKey('spki', pair.publicKey));
  const priv = await wrapAdminPrivate(pair.privateKey, password);
  return { publicKey: pub, privateWrapped: priv, privateKey: pair.privateKey };
}

async function wrapAdminPrivate(privateKey, password) {
  const salt = randomBytes(16);
  const k = await passwordKey(password, salt);
  const raw = await crypto.subtle.exportKey('pkcs8', privateKey);
  return { salt: b64(salt), ...(await aesEncrypt(k, new Uint8Array(raw))) };
}

export async function unlockAdmin(privateWrapped, password) {
  const k = await passwordKey(password, unb64(privateWrapped.salt));
  const raw = await aesDecrypt(k, privateWrapped); // wirft bei falschem Passwort
  return crypto.subtle.importKey('pkcs8', raw, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt']);
}

// Nicht exportierbare Kopie zum Merken auf dem Gerät
export async function nonExtractableAdmin(privateKey) {
  const raw = await crypto.subtle.exportKey('pkcs8', privateKey);
  return crypto.subtle.importKey('pkcs8', raw, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
}

export async function nonExtractableData(rawKey) {
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function vaultFromKey(file, key) {
  return { rawKey: null, key, header: headerOf(file) };
}

export async function rewrapAdmin(privateKey, newPassword) {
  return wrapAdminPrivate(privateKey, newPassword);
}

async function importAdminPublic(pubB64) {
  return crypto.subtle.importKey('spki', unb64(pubB64), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
}

// ---------- Mitarbeiter-Tresor ----------
// Datei-Format: { v, salt, empWrap:{iv,ct}, adminWrap, data:{iv,ct} }
// Ein geöffneter Tresor: { rawKey, key, header } — header = Datei ohne data

export async function createVault(password, adminPubB64) {
  const rawKey = randomBytes(32);
  const salt = randomBytes(16);
  const pk = await passwordKey(password, salt);
  const empWrap = await aesEncrypt(pk, rawKey);
  const adminPub = await importAdminPublic(adminPubB64);
  const adminWrap = b64(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, adminPub, rawKey));
  return { rawKey, key: await importDataKey(rawKey), header: { v: 1, salt: b64(salt), empWrap, adminWrap } };
}

export async function openVaultWithPassword(file, password) {
  const pk = await passwordKey(password, unb64(file.salt));
  const rawKey = await aesDecrypt(pk, file.empWrap); // wirft bei falschem Passwort
  return { rawKey, key: await importDataKey(rawKey), header: headerOf(file) };
}

export async function openVaultAsAdmin(file, adminPrivateKey) {
  const rawKey = new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, adminPrivateKey, unb64(file.adminWrap)));
  return { rawKey, key: await importDataKey(rawKey), header: headerOf(file) };
}

// Planer setzt ein neues Passwort für den Mitarbeiter (z. B. vergessen)
export async function resetVaultPassword(vault, newPassword) {
  const salt = randomBytes(16);
  const pk = await passwordKey(newPassword, salt);
  vault.header = { ...vault.header, salt: b64(salt), empWrap: await aesEncrypt(pk, vault.rawKey) };
  return vault;
}

function headerOf(file) {
  const { data, ...h } = file;
  return h;
}

export async function sealVault(vault, obj) {
  const data = await aesEncrypt(vault.key, enc.encode(JSON.stringify(obj)));
  return { ...vault.header, data };
}

export async function readVault(vault, file) {
  if (!file.data) return null;
  return JSON.parse(dec.decode(await aesDecrypt(vault.key, file.data)));
}

// ---------- PKCE ----------

export async function pkcePair() {
  const verifier = b64(randomBytes(48)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(verifier));
  const challenge = b64(digest).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}
