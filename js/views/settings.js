// Einstellungen: Mitarbeiter, Schichten, fixer Wochenplan, Regeln, Daten, Verbindung.

import { App, registerView, empDoc, loadEmployeeVaults } from '../app.js';
import { esc, act, openModal, toast, formData, confirmBox, promptPassword, loadScript, download, pickFile } from '../ui.js';
import * as K from '../calc.js';
import * as C from '../crypto.js';
import { employeesSorted, shiftsSorted, alive, dayTarget } from '../model.js';
import { now, COLORS, merge, clone } from '../store.js';
import { makeInvite, redirectUri } from '../storage.js';
import { importExcel } from '../import-excel.js';

function render(main) {
  const plan = App.plan.obj;
  const s = plan.settings;
  const emps = employeesSorted(plan, true);
  const shifts = shiftsSorted(plan);
  const isDropbox = App.cfg.mode === 'dropbox';

  main.innerHTML = `
  <div class="settings">
    <section class="card">
      <div class="card-head"><h2>Mitarbeiter</h2><button class="btn small primary" data-act="emp-edit">+ Neu</button></div>
      ${emps.length ? `<ul class="list">${emps.map((e) => {
        const h = App.emp[e.id];
        const state = h ? (h.missing ? 'noch nicht angemeldet' : h.error ? 'nicht lesbar' : 'angemeldet') : '';
        return `<li class="${e.active === false ? 'inactive' : ''}">
          <span class="dot" style="background:${e.color}"></span>
          <div class="grow"><b>${esc(e.name)}</b><small>${K.fmtH(e.weeklyHours)} h/Woche · Tagessoll ${K.fmtH(dayTarget(e, s))} h${e.startDate ? ' · ab ' + K.fmtDate(e.startDate, true) : ''}${e.endDate ? ' · bis ' + K.fmtDate(e.endDate, true) : ''}${state ? ' · ' + state : ''}</small></div>
          <button class="btn small" data-act="emp-invite" data-e="${e.id}">Einladen</button>
          <button class="btn small ghost" data-act="emp-edit" data-e="${e.id}">Bearbeiten</button>
        </li>`;
      }).join('')}</ul>` : '<p class="muted">Noch niemand angelegt. Du kannst auch die alte Excel-Datei importieren (unten).</p>'}
    </section>

    <section class="card">
      <div class="card-head"><h2>Schichten</h2><button class="btn small primary" data-act="shift-edit">+ Neu</button></div>
      <ul class="list">${shifts.map((sh) => `<li><div class="grow"><b>${esc(sh.start)}–${esc(sh.end)}</b><small>${esc(sh.label)} · ${K.fmtH(K.workHours(sh.start, sh.end, s))} h Arbeitszeit</small></div><button class="btn small ghost" data-act="shift-edit" data-id="${sh.id}">Bearbeiten</button></li>`).join('')}</ul>
    </section>

    <section class="card">
      <div class="card-head"><h2>Fixer Wochenplan</h2></div>
      <p class="small muted">Wer arbeitet regelmäßig wann? Diese Dienste erscheinen automatisch im Plan, solange kein eigener Eintrag gemacht wurde.</p>
      <ul class="list">${employeesSorted(plan).map((e) => {
        const t = alive(plan.template[e.id]) ? plan.template[e.id] : null;
        const sum = t ? t.days.map((v, i) => v ? `${K.WOCHENTAGE[i]} ${v.startsWith('status:') ? v.slice(7) : (plan.shifts[v] ? plan.shifts[v].start + '–' + plan.shifts[v].end : '?')}` : '').filter(Boolean).join(', ') : '';
        return `<li><span class="dot" style="background:${e.color}"></span><div class="grow"><b>${esc(e.name)}</b><small>${esc(sum || 'kein fixer Plan')}${t && t.validFrom ? ' · ab ' + K.fmtDate(t.validFrom, true) : ''}</small></div><button class="btn small ghost" data-act="tpl-edit" data-e="${e.id}">Bearbeiten</button></li>`;
      }).join('')}</ul>
    </section>

    <section class="card">
      <div class="card-head"><h2>Regeln</h2></div>
      <form id="rules" class="grid2">
        <label class="field"><span>Name (oben in der App)</span><input name="firma" value="${esc(s.firma || '')}" maxlength="40"></label>
        <label class="field"><span>Pause ab (Stunden Dienst)</span><input type="number" name="pauseAfterH" step="0.5" min="0" value="${esc(s.pauseAfterH)}"></label>
        <label class="field"><span>Pausendauer (min)</span><input type="number" name="pauseMin" step="5" min="0" value="${esc(s.pauseMin)}"></label>
        <label class="field"><span>Urlaub (Wochen pro Jahr)</span><input type="number" name="vacationWeeks" step="0.5" min="0" value="${esc(s.vacationWeeks)}"></label>
        <label class="field"><span>Arbeitstage pro Woche (für Tagessoll)</span><input type="number" name="workdaysPerWeek" step="0.5" min="1" max="7" value="${esc(s.workdaysPerWeek)}"></label>
        <label class="field"><span>Zeitkonto zählt ab (für alle)</span><input type="date" name="saldoFrom" value="${esc(s.saldoFrom || '')}"></label>
        <div class="field"><span>&nbsp;</span><button class="btn primary" data-act="rules-save">Regeln speichern</button></div>
      </form>
      <p class="small muted">Ein Dienst, der länger als ${esc(s.pauseAfterH)} Stunden dauert, bekommt automatisch ${esc(s.pauseMin)} Minuten Pause abgezogen. Feiertage (Österreich) sind automatisch eingetragen; im Plan auf einen Tag tippen, um das zu ändern.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Daten</h2></div>
      <div class="btn-row">
        <button class="btn" data-act="import-xlsx">Alte Excel-Datei importieren</button>
        <button class="btn" data-act="backup">Sicherung herunterladen</button>
        <button class="btn" data-act="restore">Sicherung einspielen</button>
      </div>
      <p class="small muted">Die Sicherung enthält den Dienstplan (ohne die verschlüsselten Zeiten der Mitarbeiter). Zusätzlich hebt Dropbox frühere Versionen jeder Datei 30 Tage lang auf.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Verbindung und Sicherheit</h2></div>
      <p>${isDropbox ? `Verbunden mit Dropbox (Ordner <b>Apps/…/</b> der Dropbox-App). Zuletzt synchronisiert: ${App.plan.lastSync ? new Date(App.plan.lastSync).toLocaleString('de-AT') : 'noch nie'}.` : '<b>Nur auf diesem Gerät.</b> Zum Teilen mit dem Team zuerst mit Dropbox verbinden.'}</p>
      <div class="btn-row">
        ${isDropbox ? '' : '<button class="btn primary" data-act="to-dropbox">Mit Dropbox verbinden</button>'}
        <button class="btn" data-act="admin-pw">Planer-Passwort ändern</button>
        <button class="btn" data-act="admin-device">Weiteren Planer-PC einrichten</button>
        <button class="btn danger" data-act="forget-device">Dieses Gerät zurücksetzen</button>
      </div>
    </section>
    <p class="hint center">Dienstplaner · Daten liegen nur in deiner Dropbox · <a href="https://github.com/Electronicfallout/Dienstplaner" target="_blank" rel="noopener">Quellcode</a></p>
  </div>`;
}

// ---------- Mitarbeiter ----------

act('emp-edit', async ({ e: id }) => {
  const plan = App.plan.obj;
  const e = id ? plan.employees[id] : { name: '', weeklyHours: 38.5, color: COLORS[Object.keys(plan.employees).length % COLORS.length], active: true };
  const y = K.parseIso(K.today()).y;
  const r = await openModal({
    title: id ? e.name : 'Neuer Mitarbeiter',
    body: `
      <label class="field"><span>Name</span><input name="name" value="${esc(e.name)}" maxlength="40"></label>
      <div class="row2">
        <label class="field"><span>Wochenstunden</span><input type="number" name="weeklyHours" step="0.5" min="0" value="${esc(e.weeklyHours)}"></label>
        <label class="field"><span>Farbe</span><input type="color" name="color" value="${esc(e.color || '#1f77b4')}"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Eintritt (optional)</span><input type="date" name="startDate" value="${esc(e.startDate || '')}"></label>
        <label class="field"><span>Austritt (optional)</span><input type="date" name="endDate" value="${esc(e.endDate || '')}"></label>
      </div>
      <h3>Startwerte</h3>
      <div class="row2">
        <label class="field"><span>Zeitkonto zählt ab (leer = wie für alle)</span><input type="date" name="saldoFrom" value="${esc(e.saldoFrom || '')}"></label>
        <label class="field"><span>Stand Plus-/Minusstunden</span><input type="number" name="zaStartH" step="0.25" value="${esc(e.zaStartH ?? 0)}"></label>
      </div>
      <label class="field"><span>Urlaub ${y}: Korrektur in Stunden (z. B. Resturlaub Vorjahr +, anteilig −)</span><input type="number" name="vacAdj" step="0.5" value="${esc((e.vacationAdjust || {})[y] ?? 0)}"></label>
      <label class="check"><input type="checkbox" name="active" ${e.active !== false ? 'checked' : ''}><span>Aktiv (im Plan anzeigen)</span></label>
      ${id ? `<hr><div class="btn-row"><button class="btn small" data-act="emp-reset-pw" data-e="${id}">Passwort zurücksetzen</button><button class="btn small danger" data-act="emp-delete" data-e="${id}">Löschen</button></div>` : ''}`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Speichern', kind: 'primary', value: 'save' }],
    onAction(v, root) {
      if (!v) return null;
      const f = formData(root);
      if (!f.name.trim()) { toast('Name fehlt', 'error'); return false; }
      return f;
    },
  });
  if (!r) return;
  const newId = id || 'm' + C.randomId(6);
  App.plan.update((p) => {
    const old = p.employees[newId] || {};
    p.employees[newId] = {
      ...old,
      name: r.name.trim(), weeklyHours: Number(r.weeklyHours) || 0, color: r.color,
      startDate: r.startDate || null, endDate: r.endDate || null,
      saldoFrom: r.saldoFrom || null, zaStartH: Number(r.zaStartH) || 0,
      vacationAdjust: { ...(old.vacationAdjust || {}), [y]: Number(r.vacAdj) || 0 },
      active: r.active, order: old.order ?? Object.keys(p.employees).length,
      updatedAt: now(),
    };
  });
});

act('emp-delete', async ({ e }) => {
  const plan = App.plan.obj;
  if (!(await confirmBox(`${plan.employees[e].name} wirklich löschen? Die Einträge im Plan bleiben gespeichert, werden aber nicht mehr angezeigt. Besser: Austrittsdatum setzen.`, 'Löschen', true))) return;
  document.querySelectorAll('.modal-wrap').forEach((w) => w.remove());
  document.body.classList.remove('modal-open');
  App.plan.update((p) => { p.employees[e] = { deleted: true, updatedAt: now() }; });
});

act('emp-reset-pw', async ({ e }) => {
  const h = App.emp[e];
  if (!h || !h.doc) { toast(h && h.missing ? 'Hat noch kein Passwort. Einfach einladen.' : 'Daten nicht geladen', 'error'); return; }
  const pw = await promptPassword('Neues Passwort', `Neues Passwort für ${App.plan.obj.employees[e].name}. Gib es ihm persönlich weiter.`, { confirm: true, okLabel: 'Setzen' });
  if (!pw) return;
  await C.resetVaultPassword(h.doc.holder.vault, pw);
  h.doc.holder.vault.header.hdrAt = now();
  h.doc.dirty = true;
  await h.doc.sync();
  toast(h.doc.status === 'ok' ? 'Passwort geändert' : 'Noch nicht übertragen: ' + h.doc.error, h.doc.status === 'ok' ? 'info' : 'error');
});

act('emp-invite', async ({ e }) => {
  if (App.cfg.mode !== 'dropbox') { toast('Zuerst mit Dropbox verbinden', 'error'); return; }
  const plan = App.plan.obj;
  const code = makeInvite(App.cfg.cred, e);
  const link = redirectUri() + '#einladung=' + code;
  await openModal({
    title: `${plan.employees[e].name} einladen`,
    wide: true,
    body: `
      <ol class="steps">
        <li>Am Handy diesen QR-Code mit der Kamera scannen, oder den Link schicken.</li>
        <li>Am iPhone: in Safari auf Teilen → „Zum Home-Bildschirm“. Am Android: Menü → „App installieren“ bzw. „Zum Startbildschirm“.</li>
        <li>Die installierte App öffnen, „Ich bin Mitarbeiter“ wählen und den Code einfügen (wird beim Öffnen des Links automatisch vorgeschlagen).</li>
        <li>Eigenes Passwort festlegen. Fertig.</li>
      </ol>
      <div class="qr" id="qr">QR-Code wird erstellt …</div>
      <label class="field"><span>Einladungscode</span><textarea readonly rows="3" id="code">${esc(code)}</textarea></label>
      <div class="btn-row"><button class="btn" data-copy="code">Code kopieren</button><button class="btn" data-copy="link">Link kopieren</button>${navigator.share ? '<button class="btn" data-share>Teilen …</button>' : ''}</div>
      <p class="small muted">Der Code gibt Zugriff auf den Dienstplan-Ordner. Die Zeiten der anderen Mitarbeiter bleiben trotzdem verschlüsselt. Nur an die richtige Person geben.</p>`,
    onOpen(root) {
      root.addEventListener('click', async (ev) => {
        const c = ev.target.closest('[data-copy]');
        if (c) { await copy(c.dataset.copy === 'code' ? code : link); toast('Kopiert'); }
        if (ev.target.closest('[data-share]')) { try { await navigator.share({ title: 'Dienstplaner Einladung', text: 'Deine Einladung zum Dienstplaner', url: link }); } catch { } }
      });
      loadScript('vendor/qrcode.js').then(() => {
        const q = window.qrcode(0, 'L');
        q.addData(link);
        q.make();
        root.querySelector('#qr').innerHTML = q.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
      }).catch((err) => { root.querySelector('#qr').textContent = err.message; });
    },
  });
});

async function copy(text) {
  try { await navigator.clipboard.writeText(text); } catch {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
}

// ---------- Schichten ----------

act('shift-edit', async ({ id }) => {
  const plan = App.plan.obj;
  const sh = id ? plan.shifts[id] : { label: '', start: '09:00', end: '17:00' };
  const s = plan.settings;
  const r = await openModal({
    title: id ? 'Schicht bearbeiten' : 'Neue Schicht',
    body: `
      <label class="field"><span>Bezeichnung</span><input name="label" value="${esc(sh.label)}" maxlength="20" placeholder="z. B. Früh"></label>
      <div class="row2">
        <label class="field"><span>Beginn</span><input type="time" name="start" value="${esc(sh.start)}"></label>
        <label class="field"><span>Ende</span><input type="time" name="end" value="${esc(sh.end)}"></label>
      </div>
      <p class="calc" id="calc"></p>
      ${id ? '<hr><button class="btn small danger" data-act="shift-delete" data-id="' + id + '">Schicht löschen</button>' : ''}`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Speichern', kind: 'primary', value: 'save' }],
    onOpen(root) {
      const upd = () => { const f = formData(root); const h = K.workHours(f.start, f.end, s); root.querySelector('#calc').textContent = h === null ? '' : `${K.fmtH(h)} h Arbeitszeit (inkl. Pausenregel)`; };
      root.addEventListener('input', upd); upd();
    },
    onAction(v, root) {
      if (!v) return null;
      const f = formData(root);
      if (K.parseTime(f.start) === null || K.parseTime(f.end) === null) { toast('Zeiten prüfen', 'error'); return false; }
      return f;
    },
  });
  if (!r) return;
  App.plan.update((p) => {
    const nid = id || 's' + C.randomId(6);
    p.shifts[nid] = { label: r.label.trim() || `${r.start}–${r.end}`, start: r.start, end: r.end, order: (p.shifts[nid] && p.shifts[nid].order) ?? Object.keys(p.shifts).length, updatedAt: now() };
  });
});

act('shift-delete', async ({ id }) => {
  if (!(await confirmBox('Schicht löschen? Bereits eingetragene Dienste behalten ihre Uhrzeit nicht. Nur löschen, wenn sie nie verwendet wurde.', 'Löschen', true))) return;
  document.querySelectorAll('.modal-wrap').forEach((w) => w.remove());
  document.body.classList.remove('modal-open');
  App.plan.update((p) => {
    // verwendete Schicht in feste Zeiten umwandeln, damit nichts verloren geht
    const sh = p.shifts[id];
    for (const [k, e] of Object.entries(p.entries)) {
      if (alive(e) && e.kind === 'shift' && e.shiftId === id) p.entries[k] = { ...e, shiftId: undefined, start: e.start || sh.start, end: e.end || sh.end, updatedAt: now() };
    }
    p.shifts[id] = { deleted: true, updatedAt: now() };
  });
});

// ---------- Fixer Wochenplan ----------

act('tpl-edit', async ({ e }) => {
  const plan = App.plan.obj;
  const t = alive(plan.template[e]) ? plan.template[e] : { days: [null, null, null, null, null, null, 'status:Frei'] };
  const shifts = shiftsSorted(plan);
  const opts = (v) => `<option value="">–</option>${shifts.map((sh) => `<option value="${sh.id}" ${v === sh.id ? 'selected' : ''}>${esc(sh.start)}–${esc(sh.end)} (${esc(sh.label)})</option>`).join('')}
    ${['Frei', 'ZA'].map((st) => `<option value="status:${st}" ${v === 'status:' + st ? 'selected' : ''}>${st}</option>`).join('')}`;
  const r = await openModal({
    title: `Fixer Wochenplan: ${plan.employees[e].name}`,
    body: `${K.WOCHENTAGE_LANG.map((n, i) => `<label class="field inline"><span>${n}</span><select name="d${i}">${opts(t.days[i])}</select></label>`).join('')}
      <label class="field"><span>Gilt ab</span><input type="date" name="validFrom" value="${esc(t.validFrom || K.mondayOf(K.today()))}"></label>
      <p class="small muted">Leer = nichts eintragen. Gilt nur für Tage ohne eigenen Eintrag; frühere Wochen bleiben unverändert.</p>`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Speichern', kind: 'primary', value: 'save' }],
    onAction(v, root) { return v ? formData(root) : null; },
  });
  if (!r) return;
  App.plan.update((p) => {
    p.template[e] = { days: [0, 1, 2, 3, 4, 5, 6].map((i) => r['d' + i] || null), validFrom: r.validFrom || null, updatedAt: now() };
  });
});

// ---------- Regeln ----------

act('rules-save', () => {
  const f = formData(document.getElementById('rules'));
  App.plan.update((p) => {
    p.settings = {
      ...p.settings, firma: f.firma.trim(), pauseAfterH: Number(f.pauseAfterH), pauseMin: Number(f.pauseMin),
      vacationWeeks: Number(f.vacationWeeks), workdaysPerWeek: Number(f.workdaysPerWeek) || 5, saldoFrom: f.saldoFrom || null, updatedAt: now(),
    };
  });
  document.querySelector('.brand span').textContent = f.firma.trim() || 'Dienstplaner';
  toast('Gespeichert');
});

// ---------- Daten ----------

act('backup', () => {
  download(`dienstplan-sicherung-${K.today()}.json`, JSON.stringify(App.plan.obj, null, 1));
});

act('restore', async () => {
  const f = await pickFile('application/json,.json');
  {
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch { toast('Keine gültige Sicherung', 'error'); return; }
    if (!data.employees || !data.entries) { toast('Keine gültige Sicherung', 'error'); return; }
    if (!(await confirmBox('Sicherung mit dem aktuellen Plan zusammenführen? Neuere Einträge bleiben erhalten.', 'Einspielen'))) return;
    App.plan.update((p) => {
      const m = merge(p, data);
      m.admin = p.admin; // Schlüssel nie aus einer Datei übernehmen
      Object.keys(p).forEach((k) => delete p[k]);
      Object.assign(p, m);
    });
    toast('Sicherung eingespielt');
  }
});

act('import-xlsx', () => importExcel());

// ---------- Verbindung ----------

act('to-dropbox', async () => {
  await openModal({
    title: 'Mit Dropbox verbinden',
    body: `<p>Lade zuerst eine <b>Sicherung</b> herunter. Dann dieses Gerät zurücksetzen, „Ich plane“ wählen, Dropbox verbinden und die Sicherung einspielen.</p>`,
    buttons: [{ label: 'OK', kind: 'primary', value: true }],
  });
});

act('admin-pw', async () => {
  const pw = await promptPassword('Neues Planer-Passwort', 'Das alte Passwort ist dann nicht mehr gültig.', { confirm: true, okLabel: 'Ändern' });
  if (!pw) return;
  const wrapped = await C.rewrapAdmin(App.adminKey, pw);
  App.plan.update((p) => { p.admin = { ...p.admin, privateWrapped: wrapped, updatedAt: now() }; });
  toast('Planer-Passwort geändert');
});

act('admin-device', async () => {
  if (App.cfg.mode !== 'dropbox') { toast('Zuerst mit Dropbox verbinden', 'error'); return; }
  await openModal({
    title: 'Weiteren Planer-PC einrichten',
    body: `<p>Am anderen PC die App öffnen und dort <b>„Ich plane“</b> mit Dropbox verbinden (gleiches Dropbox-Konto). Danach mit dem Planer-Passwort anmelden.</p>
`,
    buttons: [{ label: 'OK', kind: 'primary', value: true }],
  });
});

registerView('settings', { title: 'Einstellungen', icon: '⚙️', roles: ['admin'], render });
