// Einstellungen: Mitarbeiter, Schichten, fixer Wochenplan, Regeln, Daten, Verbindung.

import { App, registerView, empDoc, loadEmployeeVaults } from '../app.js';
import { esc, act, openModal, toast, formData, confirmBox, promptPassword, loadScript, download, pickFile } from '../ui.js';
import * as K from '../calc.js';
import * as C from '../crypto.js';
import { employeesSorted, shiftsSorted, alive, dayTarget, recurringText, shiftColor, SHIFT_COLORS, DEFAULT_OPEN } from '../model.js';
import { importIcs } from '../ics.js';
import { APP_VERSION } from '../version.js';
import { now, COLORS, merge, clone } from '../store.js';
import { makeInvite, redirectUri } from '../storage.js';
import { importExcel } from '../import-excel.js';
import { satSettingsHtml } from '../saturday.js';

function render(main) {
  const plan = App.plan.obj;
  const s = plan.settings;
  const emps = employeesSorted(plan, true);
  const shifts = shiftsSorted(plan);
  const isDropbox = App.cfg.mode === 'dropbox';
  const recs = Object.entries(plan.recurring || {}).filter(([, r]) => alive(r)).map(([id, r]) => ({ id, ...r })).sort((a, b) => a.weekday - b.weekday || a.title.localeCompare(b.title));

  main.innerHTML = `
  <div class="settings">
    <section class="card">
      <div class="card-head"><h2>Mitarbeiter</h2><button class="btn small primary" data-act="emp-edit">+ Neu</button></div>
      ${emps.length ? `<ul class="list">${emps.map((e) => {
        const h = App.emp[e.id];
        const state = h ? (h.missing ? 'noch nicht angemeldet' : h.error ? 'nicht lesbar' : 'angemeldet') : '';
        return `<li class="${e.active === false ? 'inactive' : ''}">
          <span class="dot" style="background:${e.color}"></span>
          <div class="grow"><b>${esc(e.name)}</b><small>${e.noTimes ? 'ohne Zeiterfassung' : `${K.fmtH(e.weeklyHours)} h/Woche · Tagessoll ${K.fmtH(dayTarget(e, s))} h${e.workDays && e.workDays.length ? ' (' + e.workDays.map((i) => K.WOCHENTAGE[i]).join(', ') + ')' : ''}`}${e.startDate ? ' · ab ' + K.fmtDate(e.startDate, true) : ''}${e.endDate ? ' · bis ' + K.fmtDate(e.endDate, true) : ''}${state ? ' · ' + state : ''}</small></div>
          ${e.noTimes ? '' : `<button class="btn small" data-act="emp-invite" data-e="${e.id}">Einladen</button>`}
          <button class="btn small ghost" data-act="emp-edit" data-e="${e.id}">Bearbeiten</button>
        </li>`;
      }).join('')}</ul>` : '<p class="muted">Noch niemand angelegt. Du kannst auch die alte Excel-Datei importieren (unten).</p>'}
    </section>

    <section class="card">
      <div class="card-head"><h2>Schichten</h2><button class="btn small primary" data-act="shift-edit">+ Neu</button></div>
      <ul class="list">${shifts.map((sh) => `<li><div class="grow"><b><span class="swatch" style="background:${esc(shiftColor(plan, sh.id, sh.start, sh.end, null) || 'transparent')}"></span>${esc(sh.start)}–${esc(sh.end)}</b><small>${esc(sh.label)} · ${K.fmtH(K.workHours(sh.start, sh.end, s))} h Arbeitszeit</small></div><button class="btn small ghost" data-act="shift-edit" data-id="${sh.id}">Bearbeiten</button></li>`).join('')}</ul>
    </section>

    ${satSettingsHtml(plan)}

    <section class="card">
      <div class="card-head"><h2>Events im Shop</h2><div class="btn-row"><button class="btn small" data-act="ics-import">Kalender (.ics) importieren</button><button class="btn small primary" data-act="rec-edit">+ Wiederkehrend</button></div></div>
      <p class="small muted">Einzelne Events trägst du direkt im Plan beim Tag ein. Hier legst du regelmäßige Events an, z. B. jeden Freitag Commander.</p>
      ${recs.length ? `<ul class="list">${recs.map((r) => `<li><div class="grow"><b>↻ ${esc(r.title)}</b><small>${esc(recurringText(r))}${r.from ? ' · ab ' + K.fmtDate(r.from, true) : ''}${r.to ? ' · bis ' + K.fmtDate(r.to, true) : ''}${r.noPrint ? ' · wird nicht gedruckt' : ''}</small></div><button class="btn small ghost" data-act="rec-edit" data-id="${r.id}">Bearbeiten</button></li>`).join('')}</ul>` : '<p class="muted">Noch keine wiederkehrenden Events.</p>'}
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
        <label class="field"><span>Zuschlag ab (Uhrzeit)</span><input type="time" name="nightFrom" value="${esc(s.nightFrom || '21:00')}"></label>
        <label class="field"><span>Faktor ab dieser Zeit (1,5 = +50 %)</span><input type="number" name="nightFactor" step="0.05" min="1" value="${esc(s.nightFactor ?? 1.5)}"></label>
        <label class="field"><span>Frühschicht = Beginn bis</span><input type="time" name="fruehBis" value="${esc(s.fruehBis || '09:00')}"></label>
        <label class="field"><span>Spätschicht = Ende ab</span><input type="time" name="spaetAb" value="${esc(s.spaetAb || '21:00')}"></label>
        <label class="check"><input type="checkbox" name="coverageCheck" ${s.coverageCheck !== false ? 'checked' : ''}><span>Mo–Fr prüfen, ob Früh, Mittel und Spät besetzt sind</span></label>
        <div class="field wide"><span>Öffnungszeiten (leer = geschlossen)</span><div class="open-grid">${[0, 1, 2, 3, 4, 5, 6].map((i) => { const o = (s.openHours || DEFAULT_OPEN)[i] || ['', '']; return `<label><b>${K.WOCHENTAGE[i]}</b><input type="time" name="oa${i}" value="${esc(o[0] || '')}"><input type="time" name="ob${i}" value="${esc(o[1] || '')}"></label>`; }).join('')}</div></div>
        <div class="field"><span>Spätdienst nötig an</span><div class="seg">${[0, 1, 2, 3, 4].map((i) => `<label><input type="checkbox" name="spaet${i}" ${(s.spaetTage || [2, 3, 4]).includes(i) ? 'checked' : ''}><span>${K.WOCHENTAGE[i]}</span></label>`).join('')}</div></div>
        <div class="field"><span>&nbsp;</span><button class="btn primary" data-act="rules-save">Regeln speichern</button></div>
      </form>
      <p class="small muted">Ein Dienst, der länger als ${esc(s.pauseAfterH)} Stunden dauert, bekommt automatisch ${esc(s.pauseMin)} Minuten Pause abgezogen. Feiertage (Österreich) sind automatisch eingetragen und zählen als voller Arbeitstag: Das Tagessoll wird als Feiertag gutgeschrieben, Arbeit am Feiertag kommt zusätzlich dazu. Im Plan auf einen Tag tippen, um das zu ändern. Besetzung: Alles zwischen Früh- und Spätschicht zählt als Mittelschicht. Während der Öffnungszeiten muss immer jemand eingeteilt sein. Feiertage werden nicht geprüft.</p>
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
      <p class="small muted">App-Version: ${APP_VERSION.replace('dp-', '')}</p>
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
      <div class="field"><span>Arbeitstage (für Tagessoll, Urlaub und Zeitausgleich)</span><div class="seg">${[0, 1, 2, 3, 4, 5].map((i) => `<label><input type="checkbox" name="wd${i}" ${(e.workDays && e.workDays.length) ? (e.workDays.includes(i) ? 'checked' : '') : (i < 5 ? 'checked' : '')}><span>${K.WOCHENTAGE[i]}</span></label>`).join('')}</div>
        <small class="muted">Die Wochenstunden werden auf diese Tage verteilt. Bei freier Zeiteinteilung die Tage wählen, an denen sie meistens arbeitet.</small></div>
      <div class="row2">
        <label class="field"><span>Eintritt (Beginn Urlaubsjahr)</span><input type="date" name="startDate" value="${esc(e.startDate || '')}"></label>
        <label class="field"><span>Austritt (optional)</span><input type="date" name="endDate" value="${esc(e.endDate || '')}"></label>
      </div>
      <h3>Startwerte</h3>
      <div class="row2">
        <label class="field"><span>Zeitkonto zählt ab (leer = wie für alle)</span><input type="date" name="saldoFrom" value="${esc(e.saldoFrom || '')}"></label>
        <label class="field"><span>Stand Plus-/Minusstunden</span><input type="number" name="zaStartH" step="0.25" value="${esc(e.zaStartH ?? 0)}"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Urlaubskonto: Stand am</span><input type="date" name="vacFrom" value="${esc(e.vacFrom || '')}" placeholder="wie Zeitkonto"></label>
        <label class="field"><span>Resturlaub an diesem Tag (Tage)</span><input type="number" name="vacStartT" step="0.5" value="${esc(e.vacStartT ?? 0)}"></label>
      </div>
      <p class="small muted">Urlaub wird in Tagen gerechnet (Vollzeit 25 Tage pro Jahr). Ab dem Eintritt kommt jeden Monat am Eintrittstag ein Zwölftel dazu. Leeres Datum = gleicher Stichtag wie das Zeitkonto. Für neue Mitarbeiter: Eintritt eintragen, Resturlaub 0.</p>
      <label class="check"><input type="checkbox" name="noTimes" ${e.noTimes ? 'checked' : ''}><span>Keine Zeiterfassung (z. B. Chef, selbstständig): nur im Plan, ohne Soll, Stunden, Urlaubskonto und Einladung</span></label>
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
      vacFrom: r.vacFrom || null, vacStartT: Number(r.vacStartT) || 0, vacStartH: null,
      workDays: (() => { const w = [0, 1, 2, 3, 4, 5].filter((i) => r['wd' + i]); return w.length && w.join() !== '0,1,2,3,4' ? w : null; })(),
      noTimes: !!r.noTimes,
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
  const named = Object.entries(SHIFT_COLORS).find(([, [, hex]]) => hex === sh.color);
  const cm = sh.color === undefined || sh.color === null ? 'auto' : sh.color === '' ? 'none' : named ? named[0] : 'custom';
  const r = await openModal({
    title: id ? 'Schicht bearbeiten' : 'Neue Schicht',
    body: `
      <label class="field"><span>Bezeichnung</span><input name="label" value="${esc(sh.label)}" maxlength="20" placeholder="z. B. Früh"></label>
      <div class="row2">
        <label class="field"><span>Beginn</span><input type="time" name="start" value="${esc(sh.start)}"></label>
        <label class="field"><span>Ende</span><input type="time" name="end" value="${esc(sh.end)}"></label>
      </div>
      <p class="calc" id="calc"></p>
      <div class="row2">
        <label class="field"><span>Farbe</span><select name="colorMode">
          <option value="auto" ${cm === 'auto' ? 'selected' : ''}>Automatisch</option>
          ${Object.entries(SHIFT_COLORS).map(([k, [n]]) => `<option value="${k}" ${cm === k ? 'selected' : ''}>${n}</option>`).join('')}
          <option value="custom" ${cm === 'custom' ? 'selected' : ''}>Eigene Farbe</option>
          <option value="none" ${cm === 'none' ? 'selected' : ''}>Keine Farbe</option>
        </select></label>
        <label class="field" id="cc"><span>Eigene Farbe</span><input type="color" name="customColor" value="${esc(cm === 'custom' ? sh.color : '#cfe3f7')}"></label>
      </div>
      <p class="small muted">Automatisch: Samstag gelb, Ende ab 21 Uhr rot, Ende ab 19:30 violett, Beginn bis 9 Uhr grün.</p>
      ${id ? '<hr><button class="btn small danger" data-act="shift-delete" data-id="' + id + '">Schicht löschen</button>' : ''}`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Speichern', kind: 'primary', value: 'save' }],
    onOpen(root) {
      const upd = () => { const f = formData(root); const h = K.workHours(f.start, f.end, s); root.querySelector('#calc').textContent = h === null ? '' : `${K.fmtH(h)} h Arbeitszeit (inkl. Pausenregel)`; };
      const cc = () => { root.querySelector('#cc').style.display = formData(root).colorMode === 'custom' ? '' : 'none'; };
      root.addEventListener('input', upd); root.addEventListener('change', cc); upd(); cc();
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
    const color = r.colorMode === 'auto' ? undefined : r.colorMode === 'none' ? '' : r.colorMode === 'custom' ? r.customColor : SHIFT_COLORS[r.colorMode][1];
    p.shifts[nid] = { label: r.label.trim() || `${r.start}–${r.end}`, start: r.start, end: r.end, ...(color !== undefined ? { color } : {}), order: (p.shifts[nid] && p.shifts[nid].order) ?? Object.keys(p.shifts).length, updatedAt: now() };
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
    ${['Frei', 'ZA'].map((st) => `<option value="status:${st}" ${v === 'status:' + st ? 'selected' : ''}>${K.statusLabel(st)}</option>`).join('')}`;
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
      vacationWeeks: Number(f.vacationWeeks), workdaysPerWeek: Number(f.workdaysPerWeek) || 5, saldoFrom: f.saldoFrom || null,
      nightFrom: f.nightFrom || '21:00', nightFactor: Number(f.nightFactor) || 1.5,
      fruehBis: f.fruehBis || '09:00', spaetAb: f.spaetAb || '21:00', coverageCheck: !!f.coverageCheck, spaetTage: [0, 1, 2, 3, 4].filter((i) => f['spaet' + i]),
      openHours: [0, 1, 2, 3, 4, 5, 6].map((i) => (f['oa' + i] && f['ob' + i] ? [f['oa' + i], f['ob' + i]] : null)), updatedAt: now(),
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

// ---------- Wiederkehrende Events ----------

act('rec-edit', async ({ id }) => {
  const plan = App.plan.obj;
  const r0 = id ? plan.recurring[id] : { title: '', weekday: 4, every: 'week', nth: 1, from: K.today(), to: '', noPrint: true };
  const r = await openModal({
    title: id ? 'Wiederkehrendes Event' : 'Neues wiederkehrendes Event',
    body: `
      <label class="field"><span>Name</span><input name="title" value="${esc(r0.title)}" maxlength="60" placeholder="z. B. Commander Night"></label>
      <div class="row2">
        <label class="field"><span>Wochentag</span><select name="weekday">${K.WOCHENTAGE_LANG.map((n, i) => `<option value="${i}" ${Number(r0.weekday) === i ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field"><span>Wie oft</span><select name="every">
          <option value="week" ${r0.every === 'week' ? 'selected' : ''}>jede Woche</option>
          <option value="2weeks" ${r0.every === '2weeks' ? 'selected' : ''}>jede 2. Woche</option>
          <option value="month" ${r0.every === 'month' ? 'selected' : ''}>einmal im Monat</option></select></label>
      </div>
      <label class="field" data-nth><span>Welcher im Monat</span><select name="nth">${[1, 2, 3, 4, -1].map((n) => `<option value="${n}" ${Number(r0.nth || 1) === n ? 'selected' : ''}>${n === -1 ? 'letzter' : n + '.'}</option>`).join('')}</select></label>
      <div class="row2">
        <label class="field"><span>Ab</span><input type="date" name="from" value="${esc(r0.from || '')}"></label>
        <label class="field"><span>Bis (optional)</span><input type="date" name="to" value="${esc(r0.to || '')}"></label>
      </div>
      <label class="check"><input type="checkbox" name="noPrint" ${r0.noPrint ? 'checked' : ''}><span>Beim Drucken ausblenden</span></label>
      <p class="small muted">Einzelne Termine nimmst du aus, indem du im Plan auf den Tag tippst und das Häkchen beim Event entfernst. Bei „jede 2. Woche“ zählt das Ab-Datum als erster Termin.</p>
      ${id ? `<hr><button class="btn small danger" data-act="rec-delete" data-id="${id}">Event löschen</button>` : ''}`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Speichern', kind: 'primary', value: 'ok' }],
    onOpen(root) {
      const upd = () => { root.querySelector('[data-nth]').hidden = root.querySelector('[name=every]').value !== 'month'; };
      root.addEventListener('change', upd); upd();
    },
    onAction(v, root) {
      if (!v) return null;
      const f = formData(root);
      if (!f.title.trim()) { toast('Name fehlt', 'error'); return false; }
      return f;
    },
  });
  if (!r) return;
  App.plan.update((p) => {
    p.recurring = p.recurring || {};
    const nid = id || 'r' + C.randomId(6);
    const old = p.recurring[nid] || {};
    p.recurring[nid] = { ...old, title: r.title.trim(), weekday: Number(r.weekday), every: r.every, nth: Number(r.nth), from: r.from || null, to: r.to || null, noPrint: r.noPrint, skip: old.skip || {}, updatedAt: now() };
  });
});

act('rec-delete', async ({ id }) => {
  if (!(await confirmBox('Wiederkehrendes Event löschen?', 'Löschen', true))) return;
  document.querySelectorAll('.modal-wrap').forEach((w) => w.remove());
  document.body.classList.remove('modal-open');
  App.plan.update((p) => { p.recurring[id] = { deleted: true, updatedAt: now() }; });
});

act('ics-import', () => importIcs());

// ---------- Verbindung ----------

act('to-dropbox', async () => {
  await openModal({
    title: 'Mit Dropbox verbinden',
    body: `<p>Lade zuerst eine <b>Sicherung</b> herunter. Dann dieses Gerät zurücksetzen, „Ich plane“ wählen, Dropbox verbinden und die Sicherung einspielen.</p>`,
    buttons: [{ label: 'OK', kind: 'primary', value: true }],
  });
});

act('admin-pw', async () => {
  const oldPw = await promptPassword('Aktuelles Planer-Passwort', 'Zur Sicherheit zuerst das aktuelle Passwort.', { okLabel: 'Weiter' });
  if (!oldPw) return;
  let key;
  try { key = await C.unlockAdmin(App.plan.obj.admin.privateWrapped, oldPw); } catch { toast('Passwort falsch', 'error'); return; }
  const pw = await promptPassword('Neues Planer-Passwort', 'Das alte Passwort ist dann nicht mehr gültig.', { confirm: true, okLabel: 'Ändern' });
  if (!pw) return;
  const wrapped = await C.rewrapAdmin(key, pw);
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
