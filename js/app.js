// App-Zustand, Start, Anmeldung und Navigation.

import { LS, LocalProvider, DropboxProvider, startDropboxLogin, finishDropboxLogin, parseInvite, redirectUri } from './storage.js';
import { SyncDoc, PLAN_PATH, empPath, emptyPlan, emptyVaultData, now } from './store.js';
import * as C from './crypto.js';
import { esc, $, act, toast, openModal, promptPassword, confirmBox } from './ui.js';
import { employeesSorted } from './model.js';
import { getKey, setKey, clearKeys } from './keystore.js';
import { updateBell, maybeShowOnStart, collect } from './notify.js';

export const App = {
  cfg: null,
  provider: null,
  plan: null,         // SyncDoc des Dienstplans
  adminKey: null,     // privater Planer-Schlüssel (nur im Speicher)
  me: null,           // { doc, vault } des angemeldeten Mitarbeiters
  emp: {},            // Planer: { [empId]: { doc, vault } | { missing:true } }
  view: 'plan',
  views: {},          // name -> { title, render(main), roles:[...] }
};

export const isAdmin = () => App.cfg && App.cfg.role === 'admin';

function saveCfg() { LS.set('dp.config', JSON.stringify(App.cfg)); }

export function registerView(name, def) { App.views[name] = def; }

// ---------- Start ----------

export async function boot() {
  try {
    const fromDropbox = await finishDropboxLogin();
    if (fromDropbox) {
      App.cfg = { mode: 'dropbox', role: 'admin', cred: fromDropbox };
      saveCfg();
      toast('Mit Dropbox verbunden');
    }
  } catch (e) { toast(e.message, 'error'); }

  if (!App.cfg) App.cfg = JSON.parse(LS.get('dp.config') || 'null');

  const inviteInUrl = location.hash.match(/einladung=(DP1\.[A-Za-z0-9_-]+)/);
  if (inviteInUrl) {
    history.replaceState(null, '', location.pathname);
    if (!App.cfg) return welcome(inviteInUrl[1]);
    if (App.cfg.role === 'employee') toast('Dieses Gerät ist bereits eingerichtet');
  }
  if (!App.cfg) return welcome();
  await start();
}

async function start() {
  const c = App.cfg;
  App.provider = c.mode === 'dropbox' ? new DropboxProvider(c.cred) : new LocalProvider();
  App.plan = new SyncDoc(App.provider, PLAN_PATH, null, 'dp.doc:plan');
  App.plan.on(onDocChange);
  const cached = await App.plan.loadCache();

  screen(`<div class="center-card"><div class="spinner"></div><p>Dienstplan wird geladen …</p></div>`);
  if (!cached || App.plan.status !== 'ok') {
    try {
      const remote = await App.plan.fetchRemote();
      if (remote) { App.plan.obj = remote.obj; App.plan.rev = remote.rev; }
    } catch (e) {
      if (e.auth) return authBroken(e);
      if (!cached) return screen(`<div class="center-card"><h2>Keine Verbindung</h2><p>${esc(e.message)}</p><button class="btn primary" data-act="reload">Nochmal versuchen</button></div>`);
    }
  }
  if (!App.plan.obj) {
    if (c.role !== 'admin') return screen(`<div class="center-card"><h2>Noch kein Dienstplan</h2><p>Der Planer hat den Dienstplan noch nicht angelegt.</p><button class="btn" data-act="reload">Nochmal versuchen</button></div>`);
    App.plan.obj = emptyPlan();
    App.plan.dirty = true;
  }
  await App.plan.saveCache();
  if (c.role === 'admin') await adminLogin();
  else await employeeLogin();
}

function authBroken(e) {
  screen(`<div class="center-card"><h2>Zugang ungültig</h2>
    <p>${esc(e.message)}. Wurde der Zugang in der Dropbox widerrufen? ${isAdmin() ? 'Verbinde Dropbox neu.' : 'Bitte den Planer um einen neuen Einladungscode.'}</p>
    <button class="btn primary" data-act="forget-device">Dieses Gerät zurücksetzen</button></div>`);
}

// ---------- Willkommen ----------

function welcome(invite) {
  screen(`
  <div class="center-card welcome">
    <div class="logo">🗓️</div>
    <h1>Dienstplaner</h1>
    <p class="muted">Dienstplan, Urlaub und Zeiterfassung für dein Team.</p>
    <div class="choice">
      <button class="choice-btn" data-act="welcome-emp"><b>Ich bin Mitarbeiter</b><span>Mit Einladungscode vom Planer</span></button>
      <button class="choice-btn" data-act="welcome-admin"><b>Ich plane</b><span>Dropbox verbinden oder ausprobieren</span></button>
    </div>
  </div>`);
  if (invite) enterInvite(invite);
}

act('welcome-emp', () => enterInvite(''));

async function enterInvite(prefill) {
  const code = await openModal({
    title: 'Einladungscode',
    body: `<p>Den Code bekommst du vom Planer. Füge ihn hier ein.</p>
      <label class="field"><span>Code</span><textarea name="code" rows="4" placeholder="DP1.…" autocomplete="off" autocapitalize="off" spellcheck="false">${esc(prefill)}</textarea></label>`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Weiter', kind: 'primary', value: 'ok' }],
    onAction(v, root) {
      if (!v) return null;
      const inv = parseInvite(root.querySelector('[name=code]').value);
      if (!inv) { toast('Der Code ist ungültig', 'error'); return false; }
      return inv;
    },
  });
  if (!code) return;
  App.cfg = { mode: 'dropbox', role: 'employee', cred: { appKey: code.appKey, refreshToken: code.refreshToken }, empId: code.empId };
  saveCfg();
  await start();
}

act('welcome-admin', async () => {
  const r = await openModal({
    title: 'Als Planer einrichten',
    body: `
      <p>Die Daten liegen in deiner Dropbox im Ordner <b>Apps/Dienstplaner</b>. Dafür brauchst du einmalig einen Dropbox-App-Schlüssel (Anleitung im README).</p>
      <label class="field"><span>Dropbox App-Key</span><input name="appKey" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="z. B. a1b2c3d4e5f6g7h"></label>
      <p class="small muted">Als Redirect-URI in der Dropbox-App eintragen:<br><code>${esc(redirectUri())}</code></p>
      <hr>
      <p class="small">Nur ausprobieren? Dann bleiben die Daten auf diesem Gerät und werden nicht geteilt.</p>`,
    buttons: [{ label: 'Nur ausprobieren', value: 'local' }, { label: 'Mit Dropbox verbinden', kind: 'primary', value: 'dropbox' }],
    onAction(v, root) {
      if (v === 'dropbox') {
        const raw = root.querySelector('[name=appKey]').value;
        // tolerant: unsichtbare Zeichen, Leerzeichen oder „App key:“ davor entfernen
        const tokens = raw.replace(/[\u200B-\u200D\uFEFF]/g, '').split(/[^A-Za-z0-9]+/).filter((t) => t.length >= 6);
        const k = tokens.sort((a, b) => b.length - a.length)[0] || '';
        if (!k) { toast('Bitte den App-Key eingeben', 'error'); return false; }
        if (k.length < 10 || k.length > 30) { toast(`„${k}“ sieht nicht wie ein App-Key aus (meist 15 Zeichen)`, 'error'); return false; }
        return { mode: 'dropbox', appKey: k };
      }
      return v ? { mode: 'local' } : null;
    },
  });
  if (!r) return;
  if (r.mode === 'dropbox') return startDropboxLogin(r.appKey);
  App.cfg = { mode: 'local', role: 'admin' };
  saveCfg();
  await start();
});

// Neu laden (statt onclick="…": Inline-Skripte sind per CSP gesperrt)
act('reload', () => location.reload());

act('forget-device', async () => {
  if (!(await confirmBox('Alle Daten und Zugänge auf diesem Gerät entfernen? Die Daten in der Dropbox bleiben erhalten.', 'Zurücksetzen', true))) return;
  await clearKeys();
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('dp.')).forEach((k) => localStorage.removeItem(k));
  } catch { }
  location.href = location.pathname;
});

// ---------- Planer-Anmeldung ----------

function loginFields(user, visible = false) {
  // Benutzername hilft dem Passwort-Manager des Browsers beim Speichern (Mitarbeiter: Nachname, sichtbar)
  return `${visible
    ? `<label class="field"><span>Benutzer</span><input type="text" name="username" autocomplete="username" value="${esc(user)}" readonly></label>`
    : `<input type="text" name="username" autocomplete="username" value="${esc('Dienstplaner ' + user)}" hidden>`}
    <input type="password" name="pw" autocomplete="current-password" aria-label="Passwort" placeholder="Passwort">
    <label class="check"><input type="checkbox" name="remember" checked><span>Auf diesem Gerät angemeldet bleiben</span></label>
    <button class="btn primary">Öffnen</button>`;
}

async function adminLogin() {
  const p = App.plan.obj;
  if (!p.admin || !p.admin.publicKey) {
    screen(`<div class="center-card"><h2>Planer-Passwort festlegen</h2>
      <p>Mit diesem Passwort öffnest du den Planer-Bereich und kannst die Zeiten und Anträge aller Mitarbeiter lesen. <b>Gut merken:</b> Ohne dieses Passwort sind die Mitarbeiter-Daten nicht mehr lesbar.</p>
      <button class="btn primary" data-act="admin-create">Passwort festlegen</button></div>`);
    return;
  }
  const remembered = await getKey('admin');
  if (remembered && remembered.pub === p.admin.publicKey) {
    App.adminKey = remembered.key;
    App.remembered = true;
    return enterApp();
  }
  screen(`<div class="center-card"><h2>Planer</h2><p>Bitte Planer-Passwort eingeben.</p>
    <form id="login" class="stack">${loginFields('Planer')}</form>
    <button class="link" data-act="forget-device">Anderes Konto / Gerät zurücksetzen</button></div>`);
  const f = $('#login');
  f.pw.focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      // Im Speicher nur eine nicht exportierbare Kopie halten (Passwort ändern entsperrt selbst neu)
      App.adminKey = await C.nonExtractableAdmin(await C.unlockAdmin(App.plan.obj.admin.privateWrapped, f.pw.value));
    } catch { toast('Passwort falsch', 'error'); f.pw.select(); return; }
    if (f.remember.checked) {
      App.remembered = await setKey('admin', { key: App.adminKey, pub: App.plan.obj.admin.publicKey });
    }
    enterApp();
  });
}

act('admin-create', async () => {
  const pw = await promptPassword('Planer-Passwort', 'Mindestens 8 Zeichen empfohlen.', { confirm: true, okLabel: 'Festlegen' });
  if (!pw) return;
  const k = await C.createAdminKeys(pw);
  App.adminKey = await C.nonExtractableAdmin(k.privateKey);
  App.remembered = await setKey('admin', { key: App.adminKey, pub: k.publicKey });
  App.plan.update((p) => { p.admin = { publicKey: k.publicKey, privateWrapped: k.privateWrapped, updatedAt: now() }; });
  await App.plan.sync();
  enterApp();
});

// ---------- Mitarbeiter-Anmeldung ----------

function vaultCodec(holder) {
  return {
    async decode(file) {
      if (!holder.vault) throw new Error('Tresor nicht geöffnet');
      // Kopf aus der Datei übernehmen, wenn er neuer ist (z. B. Passwort vom Planer zurückgesetzt)
      if ((file.hdrAt || 0) > (holder.vault.header.hdrAt || 0)) {
        const { data, ...h } = file;
        holder.vault.header = h;
      }
      return C.readVault(holder.vault, file);
    },
    async encode(obj) { return C.sealVault(holder.vault, obj); },
  };
}

export function makeEmpDoc(empId, vault, cacheKey = null) {
  const holder = { vault };
  const doc = new SyncDoc(App.provider, empPath(empId), vaultCodec(holder), cacheKey);
  doc.holder = holder;
  return doc;
}

async function employeeLogin() {
  const emps = employeesSorted(App.plan.obj);
  if (!App.cfg.empId || !App.plan.obj.employees[App.cfg.empId]) {
    screen(`<div class="center-card"><h2>Wer bist du?</h2>
      <div class="stack">${emps.map((e) => `<button class="btn" data-act="emp-pick" data-id="${esc(e.id)}">${esc(e.name)}</button>`).join('') || '<p>Noch keine Mitarbeiter angelegt.</p>'}</div></div>`);
    return;
  }
  const empId = App.cfg.empId;
  const emp = App.plan.obj.employees[empId];
  const cacheKey = 'dp.vdoc:' + empId;
  let cached = null;
  try { cached = JSON.parse(LS.get(cacheKey) || 'null'); } catch { }
  screen(`<div class="center-card"><div class="spinner"></div></div>`);
  let file = null;
  try {
    const r = await App.provider.read(empPath(empId));
    file = r ? r.data : null;
  } catch (e) {
    if (e.auth) return authBroken(e);
    file = cached ? cached.file : null;
    if (!file) return screen(`<div class="center-card"><h2>Keine Verbindung</h2><p>${esc(e.message)}</p><button class="btn primary" data-act="reload">Nochmal versuchen</button></div>`);
  }
  if (!file) {
    screen(`<div class="center-card"><h2>Hallo ${esc(emp.name)}!</h2>
      <p>Lege dein persönliches Passwort fest. Damit sind deine Zeiten und Anträge geschützt: Nur du und der Planer können sie sehen.</p>
      <button class="btn primary" data-act="emp-create">Passwort festlegen</button>
      <button class="link" data-act="emp-switch">Ich bin nicht ${esc(emp.name)}</button></div>`);
    return;
  }
  const openWith = async (vault) => {
    const doc = makeEmpDoc(empId, vault, cacheKey);
    let fromCache = false;
    if (cached) { try { fromCache = await doc.loadCache(); } catch { fromCache = false; } }
    if (!fromCache) { doc.obj = await C.readVault(vault, file); await doc.saveCache(); }
    App.me = { doc };
    doc.on(onDocChange);
    doc.sync();
    enterApp();
  };
  const remembered = await getKey('emp:' + empId);
  if (remembered) {
    const v = C.vaultFromKey(file, remembered);
    try { await C.readVault(v, file); App.remembered = true; return openWith(v); } catch { /* Schlüssel passt nicht mehr */ }
  }
  screen(`<div class="center-card"><h2>${esc(emp.name)}</h2><p>Bitte dein Passwort eingeben.</p>
    <form id="login" class="stack">${loginFields(emp.name, true)}</form>
    <p class="small muted">Passwort vergessen? Der Planer kann es zurücksetzen.</p>
    <button class="link" data-act="emp-switch">Ich bin nicht ${esc(emp.name)}</button></div>`);
  const f = $('#login');
  f.pw.focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    let vault;
    try { vault = await C.openVaultWithPassword(file, f.pw.value); } catch { toast('Passwort falsch', 'error'); f.pw.select(); return; }
    if (f.remember.checked) App.remembered = await setKey('emp:' + empId, await C.nonExtractableData(vault.rawKey));
    openWith(vault);
  });
}

act('logout', async () => {
  const msg = App.remembered
    ? 'Abmelden? Beim nächsten Öffnen wird wieder das Passwort verlangt.'
    : 'Abmelden?';
  if (!(await confirmBox(msg, 'Abmelden'))) return;
  await clearKeys();
  location.reload();
});

act('emp-pick', ({ id }) => {
  App.cfg.empId = id; saveCfg(); employeeLogin();
});
act('emp-switch', () => { App.cfg.empId = null; saveCfg(); employeeLogin(); });

act('emp-create', async () => {
  const pw = await promptPassword('Dein Passwort', 'Mindestens 4 Zeichen. Merk es dir gut.', { confirm: true, okLabel: 'Festlegen', user: (App.plan.obj.employees[App.cfg.empId] || {}).name });
  if (!pw) return;
  const pub = App.plan.obj.admin && App.plan.obj.admin.publicKey;
  if (!pub) { toast('Der Planer muss zuerst sein Passwort festlegen', 'error'); return; }
  const vault = await C.createVault(pw, pub);
  vault.header.hdrAt = now();
  App.remembered = await setKey('emp:' + App.cfg.empId, await C.nonExtractableData(vault.rawKey));
  const doc = makeEmpDoc(App.cfg.empId, vault, 'dp.vdoc:' + App.cfg.empId);
  doc.obj = emptyVaultData();
  doc.dirty = true;
  App.me = { doc };
  doc.on(onDocChange);
  await doc.sync();
  if (doc.status !== 'ok') toast('Noch nicht gespeichert: ' + (doc.error || ''), 'error');
  enterApp();
});

// ---------- Planer: Mitarbeiter-Tresore öffnen ----------

export async function loadEmployeeVaults(force = false) {
  if (!App.adminKey) return;
  const emps = employeesSorted(App.plan.obj, true);
  await Promise.all(emps.map(async (e) => {
    const cur = App.emp[e.id];
    if (cur && cur.doc && !force) { cur.doc.sync(); return; }
    try {
      const r = await App.provider.read(empPath(e.id));
      if (!r) { App.emp[e.id] = { missing: true }; return; }
      const vault = await C.openVaultAsAdmin(r.data, App.adminKey);
      const doc = makeEmpDoc(e.id, vault);
      doc.obj = await C.readVault(vault, r.data);
      doc.rev = r.rev;
      doc.status = 'ok';
      doc.on(onDocChange);
      App.emp[e.id] = { doc };
    } catch (err) {
      console.warn('Tresor', e.id, err);
      App.emp[e.id] = { error: err.offline ? 'offline' : (err.message || 'nicht lesbar') };
    }
  }));
  rerender();
}

// Mitarbeiterdaten (für den Planer oder sich selbst)
export function timesOf(empId) {
  if (App.me && App.cfg.empId === empId) return App.me.doc.obj.times;
  const h = App.emp[empId];
  return h && h.doc ? h.doc.obj.times : null;
}

export function empDoc(empId) {
  if (App.me && App.cfg.empId === empId) return App.me.doc;
  const h = App.emp[empId];
  return h && h.doc ? h.doc : null;
}

// ---------- Hauptansicht ----------

function screen(html) {
  document.body.classList.remove('in-app');
  $('#app').innerHTML = `<main class="screen">${html}</main>`;
}

let rerenderQueued = false;
let rerenderPending = false;
document.addEventListener('modal-closed', () => { if (rerenderPending) { rerenderPending = false; rerender(); } });
function onDocChange() {
  updateSyncBadge();
  try { updateBell(); } catch (e) { console.warn(e); }
  if (rerenderQueued) return;
  rerenderQueued = true;
  requestAnimationFrame(() => {
    rerenderQueued = false;
    if (document.body.classList.contains('modal-open')) rerenderPending = true; else rerender();
  });
}

function navItems() {
  return Object.entries(App.views).filter(([, v]) => v.roles.includes(App.cfg.role));
}

function enterApp() {
  document.body.classList.add('in-app');
  const saved = LS.get('dp.view');
  const items = navItems();
  App.view = items.some(([k]) => k === saved) ? saved : items[0][0];
  const emp = !isAdmin() && App.plan.obj.employees[App.cfg.empId];
  $('#app').innerHTML = `
    <header class="topbar">
      <div class="brand">🗓️ <span>${esc(App.plan.obj.settings.firma || 'Dienstplaner')}</span></div>
      <nav class="tabs" aria-label="Bereiche">${items.map(([k, v]) => `<button class="tab" data-act="nav" data-view="${k}"><span class="ti">${v.icon}</span><span class="tl">${esc(v.title)}</span></button>`).join('')}</nav>
      <div class="top-right">
        ${emp ? `<span class="whoami">${esc(emp.name)}</span>` : ''}
        <button class="icon-btn small-icon bell" id="bell" data-act="notices" title="Hinweise" aria-label="Hinweise"></button>
        <button class="sync-badge" id="sync" data-act="sync-now" title="Jetzt synchronisieren"></button>
        <button class="icon-btn small-icon" data-act="logout" title="Abmelden" aria-label="Abmelden">⏻</button>
      </div>
    </header>
    <main id="main" tabindex="-1"></main>`;
  rerender();
  updateSyncBadge();
  updateBell();
  const syncs = [App.plan.sync()];
  if (App.me) syncs.push(App.me.doc.sync());
  if (isAdmin()) syncs.push(loadEmployeeVaults());
  Promise.allSettled(syncs).then(() => {
    updateBell();
    maybeShowOnStart();
    if (isAdmin()) { const c = collect(); if (c.count) toast(`${c.count} Hinweis${c.count > 1 ? 'e' : ''}: oben auf die Glocke tippen`); }
  });
  startPolling();
}

export function rerender() {
  const main = $('#main');
  if (!main) return;
  const v = App.views[App.view];
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === App.view));
  const scroll = window.scrollY;
  v.render(main);
  window.scrollTo(0, scroll);
}

act('nav', ({ view }) => {
  App.view = view;
  LS.set('dp.view', view);
  rerender();
  window.scrollTo(0, 0);
});

function allDocs() {
  const docs = [App.plan];
  if (App.me) docs.push(App.me.doc);
  for (const h of Object.values(App.emp)) if (h.doc) docs.push(h.doc);
  return docs;
}

function updateSyncBadge() {
  const b = $('#sync');
  if (!b) return;
  const docs = allDocs();
  const st = docs.some((d) => d.status === 'error') ? 'error'
    : docs.some((d) => d.status === 'syncing') ? 'syncing'
      : docs.some((d) => d.status === 'offline' || d.dirty) ? 'offline' : 'ok';
  const local = App.cfg.mode === 'local';
  const txt = local ? 'Nur dieses Gerät' : { ok: 'Gespeichert', syncing: 'Speichert …', offline: 'Offline', error: 'Fehler' }[st];
  b.className = 'sync-badge ' + (local ? 'local' : st);
  b.innerHTML = `<i></i><span>${txt}</span>`;
  const err = docs.find((d) => d.error);
  b.title = err ? err.error : 'Jetzt synchronisieren';
}

act('sync-now', async () => {
  await Promise.all(allDocs().map((d) => d.sync()));
  if (isAdmin()) await loadEmployeeVaults();
  const err = allDocs().find((d) => d.status !== 'ok');
  toast(err ? 'Nicht alles übertragen: ' + (err.error || 'offline') : 'Alles aktuell', err ? 'error' : 'info');
});

let pollTimer;
function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible') allDocs().forEach((d) => d.sync()); }, 60000);
  document.addEventListener('visibilitychange', () => {
    // App wird verlassen: ungespeicherte Änderungen sofort übertragen
    if (document.visibilityState === 'hidden') allDocs().forEach((d) => { if (d.dirty) d.sync(); });
    if (document.visibilityState === 'visible') { allDocs().forEach((d) => d.sync()); if (isAdmin()) loadEmployeeVaults(); }
  });
  window.addEventListener('online', () => allDocs().forEach((d) => d.sync()));
}
