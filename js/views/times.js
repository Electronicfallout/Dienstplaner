// Zeiterfassung: Mitarbeiter tragen ihre tatsächlichen Zeiten ein, der Planer sieht Soll/Ist und Saldo.

import { App, registerView, isAdmin, timesOf, empDoc, loadEmployeeVaults } from '../app.js';
import { esc, act, openModal, toast, formData } from '../ui.js';
import * as K from '../calc.js';
import { employeesSorted, planEntry, resolve, resolveTime, employed, monthStats, saldoUntil, alive, isPublished } from '../model.js';
import { now } from '../store.js';
import { diffBadge } from './plan.js';

const td = K.parseIso(K.today());
App.tmonth = { y: td.y, m: td.m };
App.tEmp = null;

function currentEmp() {
  const plan = App.plan.obj;
  if (!isAdmin()) return { id: App.cfg.empId, ...plan.employees[App.cfg.empId] };
  const emps = employeesSorted(plan);
  if (!App.tEmp || !plan.employees[App.tEmp]) App.tEmp = emps[0] && emps[0].id;
  return App.tEmp ? { id: App.tEmp, ...plan.employees[App.tEmp] } : null;
}

function render(main) {
  const plan = App.plan.obj;
  const emp = currentEmp();
  const admin = isAdmin();
  if (!emp) { main.innerHTML = '<div class="empty-state"><p>Noch keine Mitarbeiter.</p></div>'; return; }
  const { y, m } = App.tmonth;
  const holder = admin ? App.emp[emp.id] : { doc: App.me.doc };
  const times = timesOf(emp.id);
  const t = K.today();
  const st = monthStats(plan, emp, y, m, times);
  const stToday = monthStats(plan, emp, y, m, times, t);
  const saldo = saldoUntil(plan, emp, t, times);

  let accessNote = '';
  if (admin && (!holder || holder.missing)) accessNote = `<div class="notice">${esc(emp.name)} hat sich noch nicht angemeldet. Bis dahin zählen die geplanten Zeiten.</div>`;
  else if (admin && holder && holder.error) accessNote = `<div class="notice warn">Zeiten von ${esc(emp.name)} konnten nicht geladen werden (${esc(holder.error)}). <button class="link" data-act="reload-vaults">Nochmal laden</button></div>`;
  else if (admin && !holder) accessNote = '<div class="notice">Lade Zeiten …</div>';

  const todayPlan = resolve(plan, planEntry(plan, t, emp.id), emp, t);
  const todayRec = times && alive(times[t]) ? times[t] : null;
  const canEdit = !!(times);

  main.innerHTML = `
    <div class="toolbar">
      ${admin ? `<label class="select-inline"><span class="sr">Mitarbeiter</span><select data-change="t-emp">${employeesSorted(plan).map((e) => `<option value="${e.id}" ${e.id === emp.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>` : `<h2 class="h-inline">Meine Zeiten</h2>`}
      <div class="nav-group">
        <button class="icon-btn" data-act="tmonth" data-d="-1" aria-label="Voriger Monat">‹</button>
        <div class="period"><b>${K.MONATE[m - 1]} ${y}</b></div>
        <button class="icon-btn" data-act="tmonth" data-d="1" aria-label="Nächster Monat">›</button>
      </div>
    </div>
    ${accessNote}
    <div class="stats">
      <div class="stat"><span>Soll ${K.MONATE[m - 1]}</span><b>${K.fmtH(st.soll)} h</b></div>
      <div class="stat"><span>Ist bis heute</span><b>${K.fmtH(stToday.istH + stToday.creditH)} h</b><small>Soll bis heute ${K.fmtH(stToday.soll)} h</small></div>
      <div class="stat"><span>Monat</span><b class="${stToday.saldo >= 0 ? 'pos' : 'neg'}">${stToday.saldo >= 0 ? '+' : ''}${K.fmtH(stToday.saldo)} h</b></div>
      <div class="stat"><span>Zeitkonto gesamt</span><b class="${saldo >= 0 ? 'pos' : 'neg'}">${saldo >= 0 ? '+' : ''}${K.fmtH(saldo)} h</b><small>Plus-/Minusstunden bis heute</small></div>
    </div>
    ${!admin && todayPlan && todayPlan.type === 'shift' && !todayRec && y === td.y && m === td.m ? `
      <div class="quick">
        <span>Heute geplant: <b>${esc(todayPlan.text)}</b></span>
        <button class="btn primary" data-act="t-asplanned" data-d="${t}">Wie geplant erfassen</button>
        <button class="btn" data-act="t-edit" data-d="${t}">Andere Zeit</button>
      </div>` : ''}
    <div class="table-scroll"><table class="times">
      <thead><tr><th>Tag</th><th>Geplant</th><th>Erfasst</th><th class="num">h</th><th class="num">Diff</th></tr></thead>
      <tbody>${st.tage.map((x) => {
        const wd = K.weekday(x.date);
        const pl = !admin && !isPublished(plan, x.date) ? '<span class="muted">Entwurf</span>' : x.pr ? (x.pr.type === 'shift' ? `${esc(x.pr.text)} <small>${K.fmtH(x.pr.workH)} h</small>` : esc(x.pr.text)) : '';
        const rec = x.tr ? (x.tr.type === 'shift' ? `${esc(x.tr.text)} <small>${x.tr.pause} min Pause</small>` : esc(x.tr.text)) : (x.date <= t && x.pr && x.pr.type === 'shift' ? '<span class="muted">nicht erfasst</span>' : '');
        const note = x.tr && times[x.date] && times[x.date].note ? `<small class="note">${esc(times[x.date].note)}</small>` : '';
        const h = x.ist + x.credit;
        const diff = x.tr && x.pr ? x.tr.workH - x.pr.workH : 0;
        if (!x.pr && !x.tr && wd === 6) return '';
        return `<tr class="${x.date === t ? 'today' : ''} ${canEdit ? 'clickable' : ''} ${wd === 5 ? 'sat' : ''}" ${canEdit ? `data-act="t-edit" data-d="${x.date}"` : ''}>
          <td><b>${K.WOCHENTAGE[wd]}</b> ${K.fmtDate(x.date)}</td><td>${pl}</td><td>${rec}${note}</td>
          <td class="num">${h ? K.fmtH(h) : ''}</td><td class="num">${diff ? diffBadge(diff) : ''}</td></tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td colspan="3">Summe (Ist inkl. Urlaub/Krankenstand) / Soll</td><td class="num"><b>${K.fmtH(st.istH + st.creditH)}</b></td><td class="num">${K.fmtH(st.soll)}</td></tr></tfoot>
    </table></div>
    <p class="hint">${admin ? 'Ist = erfasste Zeit, sonst die geplante. ' : 'Tippe auf einen Tag, um deine tatsächliche Zeit einzutragen. Ohne Eintrag zählt die geplante Zeit. '}Ab ${esc(plan.settings.pauseAfterH)} Stunden werden automatisch ${esc(plan.settings.pauseMin)} Minuten Pause abgezogen.</p>`;

  const sel = main.querySelector('[data-change="t-emp"]');
  if (sel) sel.addEventListener('change', () => { App.tEmp = sel.value; render(main); });
}

act('tmonth', ({ d }) => {
  let { y, m } = App.tmonth; m += +d;
  if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
  App.tmonth = { y, m };
  render(document.getElementById('main'));
});

act('reload-vaults', () => loadEmployeeVaults(true));

act('t-asplanned', ({ d }) => {
  const emp = currentEmp();
  const r = resolve(App.plan.obj, planEntry(App.plan.obj, d, emp.id), emp, d);
  if (!r || r.type !== 'shift') return;
  const doc = empDoc(emp.id);
  doc.update((o) => { o.times[d] = { start: r.start, end: r.end, updatedAt: now() }; });
  toast('Erfasst: ' + r.text);
});

act('t-edit', async ({ d }) => {
  const plan = App.plan.obj;
  const emp = currentEmp();
  const doc = empDoc(emp.id);
  if (!doc) return;
  const cur = alive(doc.obj.times[d]) ? doc.obj.times[d] : null;
  const pr = resolve(plan, planEntry(plan, d, emp.id), emp, d);
  const s = plan.settings;
  const v0 = cur || (pr && pr.type === 'shift' ? { start: pr.start, end: pr.end } : {});
  await openModal({
    title: `${K.WOCHENTAGE[K.weekday(d)]} ${K.fmtDate(d, true)}`,
    body: `
      ${pr ? `<p class="small">Geplant: <b>${esc(pr.text)}</b></p>` : '<p class="small muted">Kein Dienst geplant.</p>'}
      <div class="row3">
        <label class="field"><span>Beginn</span><input type="time" name="start" value="${esc(v0.start || '')}"></label>
        <label class="field"><span>Ende</span><input type="time" name="end" value="${esc(v0.end || '')}"></label>
        <label class="field"><span>Pause (min)</span><input type="number" name="pause" min="0" step="5" inputmode="numeric" placeholder="auto" value="${v0.pause ?? ''}"></label>
      </div>
      <label class="field"><span>Notiz</span><input name="note" maxlength="100" value="${esc((cur && cur.note) || '')}" placeholder="z. B. länger wegen Event"></label>
      <p class="calc" id="calc"></p>`,
    buttons: [
      ...(cur ? [{ label: 'Löschen', value: 'del', kind: 'ghost' }] : []),
      { label: 'Abbrechen', value: null },
      { label: 'Speichern', value: 'save', kind: 'primary' },
    ],
    onOpen(root) {
      const upd = () => {
        const f = formData(root);
        const dur = K.durationMin(f.start, f.end);
        if (dur === null) { root.querySelector('#calc').textContent = ''; return; }
        const p = f.pause === '' ? K.autoPauseMin(f.start, f.end, s) : Number(f.pause);
        root.querySelector('#calc').textContent = `${K.fmtH(dur / 60)} h − ${p} min Pause = ${K.fmtH(Math.max(0, dur - p) / 60)} h`;
      };
      root.addEventListener('input', upd);
      upd();
    },
    onAction(v, root) {
      if (!v) return null;
      const t = now();
      if (v === 'del') { doc.update((o) => { o.times[d] = { deleted: true, updatedAt: t }; }); return 'ok'; }
      const f = formData(root);
      if (K.parseTime(f.start) === null || K.parseTime(f.end) === null) { toast('Beginn und Ende eingeben', 'error'); return false; }
      const rec = { start: f.start, end: f.end, updatedAt: t };
      if (f.pause !== '') rec.pause = Number(f.pause);
      if (f.note.trim()) rec.note = f.note.trim();
      if (isAdmin()) rec.byAdmin = true;
      doc.update((o) => { o.times[d] = rec; });
      return 'ok';
    },
  });
});

registerView('times', { title: 'Zeiten', icon: '⏱️', roles: ['admin', 'employee'], render });
