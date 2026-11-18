// Zeiterfassung: Mitarbeiter tragen ihre tatsächlichen Zeiten ein, der Planer sieht Soll/Ist und Saldo.

import { App, registerView, isAdmin, timesOf, empDoc, loadEmployeeVaults } from '../app.js';
import { esc, act, openModal, toast, formData } from '../ui.js';
import * as K from '../calc.js';
import { countedUntil, tracked, employeesSorted, planEntry, resolve, resolveTime, employed, monthStats, saldoDetail, alive, isPublished } from '../model.js';
import { now } from '../store.js';
import { diffBadge } from './plan.js';

const td = K.parseIso(K.today());
App.tmonth = { y: td.y, m: td.m };
App.tEmp = null;

function currentEmp() {
  const plan = App.plan.obj;
  if (!isAdmin()) return { id: App.cfg.empId, ...plan.employees[App.cfg.empId] };
  const emps = employeesSorted(plan).filter(tracked);
  if (!App.tEmp || (plan.employees[App.tEmp] || {}).noTimes || !plan.employees[App.tEmp]) App.tEmp = emps[0] && emps[0].id;
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
  const cu = countedUntil(plan, emp, times); // heute zählt erst nach Dienstende
  const stToday = monthStats(plan, emp, y, m, times, cu);
  const sd = saldoDetail(plan, emp, cu, times);
  const saldo = sd.saldo;
  const sg = (h) => `${h >= 0 ? '+' : ''}${K.fmtH(h)} h`;

  let accessNote = '';
  if (admin && (!holder || holder.missing)) accessNote = `<div class="notice">${esc(emp.name)} hat sich noch nicht angemeldet. Bis dahin zählen die geplanten Zeiten.</div>`;
  else if (admin && holder && holder.error) accessNote = `<div class="notice warn">Zeiten von ${esc(emp.name)} konnten nicht geladen werden (${esc(holder.error)}). <button class="link" data-act="reload-vaults">Nochmal laden</button></div>`;
  else if (admin && !holder) accessNote = '<div class="notice">Lade Zeiten …</div>';

  const todayPlan = resolve(plan, planEntry(plan, t, emp.id), emp, t);
  const todayRec = times && alive(times[t]) ? times[t] : null;
  const canEdit = !!(times);

  main.innerHTML = `
    <div class="toolbar">
      ${admin ? `<label class="select-inline"><span class="sr">Mitarbeiter</span><select data-change="t-emp">${employeesSorted(plan).filter(tracked).map((e) => `<option value="${e.id}" ${e.id === emp.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>` : `<h2 class="h-inline">Meine Zeiten</h2>`}
      <div class="nav-group">
        <button class="icon-btn" data-act="tmonth" data-d="-1" aria-label="Voriger Monat">‹</button>
        <div class="period"><b>${K.MONATE[m - 1]} ${y}</b></div>
        <button class="icon-btn" data-act="tmonth" data-d="1" aria-label="Nächster Monat">›</button>
      </div>
    </div>
    ${accessNote}
    <div class="stats">
      <div class="stat"><span>Soll ${K.MONATE[m - 1]}</span><b>${K.fmtH(st.soll)} h</b></div>
      <div class="stat"><span>Ist bis ${cu === t ? 'heute' : 'gestern'}</span><b>${K.fmtH(stToday.istH + stToday.creditH)} h</b><small>Soll bis ${cu === t ? 'heute' : 'gestern'} ${K.fmtH(stToday.soll)} h</small></div>
      <div class="stat"><span>Monat</span><b class="${stToday.saldo >= 0 ? 'pos' : 'neg'}">${stToday.saldo >= 0 ? '+' : ''}${K.fmtH(stToday.saldo)} h</b>${stToday.bonusH ? `<small>davon Zuschlag ab ${esc(plan.settings.nightFrom || '21:00')}: +${K.fmtH(stToday.bonusH)} h</small>` : ''}</div>
      <div class="stat"><span>Zeitkonto gesamt</span><b class="${saldo >= 0 ? 'pos' : 'neg'}">${saldo >= 0 ? '+' : ''}${K.fmtH(saldo)} h</b><small>Gearbeitet ${sg(sd.arbeitH)} · Zuschlag ${sg(sd.bonusH)}${sd.startH ? ` · alt ${sg(sd.startH)}` : ''}<br>Plus-/Minusstunden bis ${cu === t ? 'heute' : 'gestern'}${admin ? `<br><button class="link" data-act="t-carry" data-e="${emp.id}">Alte Überstunden nachtragen${Number(emp.zaStartH) ? ` (${Number(emp.zaStartH) > 0 ? '+' : ''}${K.fmtH(Number(emp.zaStartH))} h)` : ''}</button>` : ''}</small></div>
    </div>
    ${!admin && todayPlan && todayPlan.type === 'shift' && !todayRec && y === td.y && m === td.m ? `
      <div class="quick">
        <span>Heute geplant: <b>${esc(todayPlan.text)}</b></span>
        <button class="btn primary" data-act="t-asplanned" data-d="${t}">Wie geplant erfassen</button>
        <button class="btn" data-act="t-edit" data-d="${t}">Andere Zeit</button>
      </div>` : ''}
    <div class="table-scroll"><table class="times">
      <thead><tr><th>Tag</th><th>Geplant</th><th>Erfasst</th><th class="num">h</th></tr></thead>
      <tbody>${st.tage.map((x) => {
        const wd = K.weekday(x.date);
        const pl = !admin && !isPublished(plan, x.date) ? '<span class="muted">Entwurf</span>' : x.pr ? (x.pr.type === 'shift' ? `${esc(x.pr.text)} <small>${K.fmtH(x.pr.workH)} h</small>` : esc(x.pr.text)) : '';
        const rec = x.tr ? (x.tr.type === 'shift' ? `${esc(x.tr.text)} <small>${x.tr.pause} min Pause</small>` : esc(x.tr.text)) : (x.date <= t && x.pr && x.pr.type === 'shift' ? '<span class="muted">nicht erfasst</span>' : x.date <= t && x.pr && x.pr.status === 'ZA' ? '<span class="muted">bitte bestätigen</span>' : '');
        const note = x.tr && times[x.date] && times[x.date].note ? `<small class="note">${esc(times[x.date].note)}</small>` : '';
        const h = x.ist + x.credit;
        const diff = x.tr && x.pr ? x.tr.workH - x.pr.workH : 0;
        if (!x.pr && !x.tr && wd === 6) return '';
        return `<tr class="${x.date === t ? 'today' : ''} ${canEdit ? 'clickable' : ''} ${wd === 5 ? 'sat' : ''}" ${canEdit ? `data-act="t-edit" data-d="${x.date}"` : ''}>
          <td><b>${K.WOCHENTAGE[wd]}</b> ${K.fmtDate(x.date)}</td><td>${pl}</td><td>${rec}${note}</td>
          <td class="num">${h ? K.fmtH(h) : ''}${diff ? `<small>${diffBadge(diff)}</small>` : ''}${x.bonus ? `<small title="Zuschlag ab ${esc(plan.settings.nightFrom || '21:00')}">+${K.fmtH(x.bonus)} Z</small>` : ''}</td></tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td colspan="3">Summe Ist / Soll</td><td class="num"><b>${K.fmtH(st.istH + st.creditH)}</b><small>/ ${K.fmtH(st.soll)}</small>${diffBadge(st.istH + st.creditH - st.soll) ? `<small>${diffBadge(st.istH + st.creditH - st.soll)}</small>` : ''}${st.bonusH ? `<small>+${K.fmtH(st.bonusH)} Z</small>` : ''}</td></tr></tfoot>
    </table></div>
    <details class="card saldo-detail"><summary><b>Wie kommt das Zeitkonto zustande?</b></summary>
      <p class="small muted">Gerechnet ab ${K.fmtDate(sd.from, true)}${emp.startDate ? '' : ' (kein Eintrittsdatum hinterlegt)'} bis ${K.fmtDate(cu, true)}. Pro Woche: Ist (gearbeitet plus Feiertag/Urlaub/Krankenstand/Zeitausgleich) minus Soll, minus Zeitausgleich, plus Zuschlag.</p>
      <table class="times"><thead><tr><th>Woche</th><th class="num">Soll</th><th class="num">Ist</th><th class="num">ZA</th><th class="num">±</th></tr></thead>
      <tbody>${sd.weeks.map((w) => { const d = w.ist + w.credit - w.za - w.soll + w.bonus; return `<tr><td>KW ${K.isoWeek(w.mon)}<small>${K.fmtDate(w.mon)}${w.offen ? ` · ${w.offen} Tag${w.offen > 1 ? 'e' : ''} nicht erfasst` : ''}</small></td><td class="num">${K.fmtH(w.soll)}</td><td class="num">${K.fmtH(w.ist + w.credit)}${w.bonus ? `<small>+${K.fmtH(w.bonus)} Z</small>` : ''}</td><td class="num">${w.za ? '−' + K.fmtH(w.za) : ''}</td><td class="num ${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '+' : ''}${K.fmtH(d)}</td></tr>`; }).join('')}</tbody>
      <tfoot>${sd.startH ? `<tr><td colspan="4">Alte Überstunden</td><td class="num">${sg(sd.startH)}</td></tr>` : ''}<tr><td colspan="4">Zeitkonto</td><td class="num"><b>${sg(saldo)}</b></td></tr></tfoot></table>
    </details>
    <p class="hint">${admin ? 'Ist = erfasste Zeit, sonst die geplante. ' : 'Tippe auf einen Tag, um deine tatsächliche Zeit einzutragen. Ohne Eintrag zählt die geplante Zeit. '}Feiertage, Urlaub, Zeitausgleich und Krankenstand zählen bei Ist mit. Der heutige Tag zählt erst, wenn er erfasst oder der Dienst vorbei ist. Ab ${esc(plan.settings.pauseAfterH)} Stunden werden automatisch ${esc(plan.settings.pauseMin)} Minuten Pause abgezogen. Arbeit ab ${esc(plan.settings.nightFrom || '21:00')} zählt mit ${K.fmtH(Number(plan.settings.nightFactor ?? 1.5))}: Der Aufschlag (Z) kommt getrennt aufs Zeitkonto.</p>`;

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

// Aus dem Dienstplan: Arbeitszeit für einen Tag eintragen (Planer: für die gewählte Person)
act('plan-time', async ({ d, e }) => {
  document.querySelectorAll('.modal-wrap').forEach((w) => w.remove());
  document.body.classList.remove('modal-open');
  if (isAdmin() && e) App.tEmp = e;
  const emp = currentEmp();
  if (!emp || emp.noTimes) return;
  if (!empDoc(emp.id)) { toast(isAdmin() ? `Die Zeiten von ${emp.name} sind auf diesem Gerät noch nicht geöffnet (Tab „Zeiten“).` : 'Zeiten sind noch nicht geladen', 'error'); return; }
  await editTime(d);
  App.rerender && App.rerender();
});

act('t-edit', ({ d }) => editTime(d));

async function editTime(d) {
  const plan = App.plan.obj;
  const emp = currentEmp();
  const doc = empDoc(emp.id);
  if (!doc) return;
  const cur = alive(doc.obj.times[d]) ? doc.obj.times[d] : null;
  const pr = resolve(plan, planEntry(plan, d, emp.id), emp, d);
  const s = plan.settings;
  const v0 = cur && !cur.status ? cur : (pr && pr.type === 'shift' ? { start: pr.start, end: pr.end } : {});
  const plannedZA = !!(pr && pr.type === 'status' && pr.status === 'ZA');
  const zaOk = plannedZA || (pr && pr.type === 'shift');
  await openModal({
    title: `${K.WOCHENTAGE[K.weekday(d)]} ${K.fmtDate(d, true)}`,
    body: `
      ${pr ? `<p class="small">Geplant: <b>${esc(pr.text)}</b>${plannedZA ? ` (${K.fmtH(pr.creditH)} h)` : ''}</p>` : '<p class="small muted">Kein Dienst geplant.</p>'}
      ${plannedZA ? '<p>Du hast an diesem Tag Zeitausgleich. Bitte nur bestätigen, Zeiten musst du keine eintragen.</p>' : ''}
      ${cur && cur.status ? `<p class="small">Erfasst: <b>${esc(K.statusLabel(cur.status))}</b></p>` : ''}
      <div class="row3" ${plannedZA ? 'hidden' : ''}>
        <label class="field"><span>Beginn</span><input type="time" name="start" value="${esc(v0.start || '')}"></label>
        <label class="field"><span>Ende</span><input type="time" name="end" value="${esc(v0.end || '')}"></label>
        <label class="field"><span>Pause (min)</span><input type="number" name="pause" min="0" step="5" inputmode="numeric" placeholder="auto" value="${v0.pause ?? ''}"></label>
      </div>
      <label class="field"><span>Notiz</span><input name="note" maxlength="100" value="${esc((cur && cur.note) || '')}" placeholder="z. B. länger wegen Event"></label>
      <p class="calc" id="calc"></p>`,
    buttons: [
      ...(cur ? [{ label: 'Löschen', value: 'del', kind: 'ghost' }] : []),
      { label: 'Abbrechen', value: null },
      ...(zaOk ? [{ label: 'Zeitausgleich bestätigen', value: 'za', kind: plannedZA ? 'primary' : '' }] : []),
      ...(K.weekday(d) < 5 && !plannedZA ? [{ label: 'Ersatzfrei Samstag', value: 'efs' }] : []),
      ...(plannedZA ? [] : [{ label: 'Speichern', value: 'save', kind: 'primary' }]),
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
      if (v === 'efs') { doc.update((o) => { o.times[d] = { status: 'Ersatzfrei Sa', updatedAt: t, ...(isAdmin() ? { byAdmin: true } : {}) }; }); toast('Ersatzfrei Samstag eingetragen: das Soll zählt am Samstag dieser Woche'); return 'ok'; }
      if (v === 'za') { doc.update((o) => { o.times[d] = { status: 'ZA', updatedAt: t, ...(isAdmin() ? { byAdmin: true } : {}) }; }); toast('Zeitausgleich bestätigt'); return 'ok'; }
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
}

registerView('times', { title: 'Zeiten', icon: '⏱️', roles: ['admin', 'employee'], render });

// Nur Planer: Stand der alten Überstunden (vor Beginn des Zeitkontos) nachtragen
act('t-carry', async ({ e: id }) => {
  const plan = App.plan.obj;
  const e = plan.employees[id];
  if (!isAdmin() || !e) return;
  const from = e.saldoFrom || plan.settings.saldoFrom || '';
  const r = await openModal({
    title: `${esc(e.name)}: alte Überstunden`,
    body: `<p>Stand der Plus- oder Minusstunden ${from ? `zum Beginn des Zeitkontos am <b>${K.fmtDate(from, true)}</b>` : 'zum Beginn des Zeitkontos'}. Alles, was danach geplant oder erfasst wird, rechnet die App selbst dazu.</p>
      <label class="field"><span>Überstunden (Minusstunden mit −, z. B. 60 oder −4,5)</span><input type="text" inputmode="decimal" name="h" value="${esc(String(e.zaStartH ?? 0).replace('.', ','))}"></label>
      <label class="field"><span>Stand am (leer = Beginn Zeitkonto für alle)</span><input type="date" name="from" value="${esc(e.saldoFrom || '')}"></label>`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Speichern', kind: 'primary', value: 'ok' }],
    onAction(v, root) {
      if (!v) return null;
      const f = formData(root);
      const h = Number(String(f.h).replace('−', '-').replace(',', '.').trim() || 0);
      if (!Number.isFinite(h)) { toast('Bitte eine Zahl eingeben', 'error'); return false; }
      return { h, from: f.from };
    },
  });
  if (!r) return;
  App.plan.update((p) => { p.employees[id] = { ...p.employees[id], zaStartH: r.h, saldoFrom: r.from || null, updatedAt: now() }; });
  toast(`Gespeichert: ${r.h >= 0 ? '+' : ''}${K.fmtH(r.h)} h`);
});
