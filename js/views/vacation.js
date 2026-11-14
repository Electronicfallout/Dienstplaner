// Urlaubsplanung: Konto pro Person, Jahresübersicht, Anträge.

import { App, registerView, isAdmin, empDoc } from '../app.js';
import { esc, act, openModal, toast, formData, confirmBox } from '../ui.js';
import * as K from '../calc.js';
import { tracked, employeesSorted, vacationAccount, requestDays, employed, entryKey, planEntry, alive, dayTarget, setEntry, sollDay } from '../model.js';
import { now } from '../store.js';
import { randomId } from '../crypto.js';

App.vyear = K.parseIso(K.today()).y;

function ranges(days) {
  // aufeinanderfolgende Tage (Sonntage/Feiertage dürfen dazwischen liegen) zusammenfassen
  const out = [];
  let start = null, prev = null;
  for (const d of days) {
    if (prev && K.dayNum(d) - K.dayNum(prev) <= 2) { prev = d; continue; }
    if (start) out.push([start, prev]);
    start = d; prev = d;
  }
  if (start) out.push([start, prev]);
  return out.map(([a, b]) => a === b ? K.fmtDate(a) : `${K.fmtDate(a)}–${K.fmtDate(b)}`);
}

function allRequests() {
  const plan = App.plan.obj;
  const list = [];
  for (const e of employeesSorted(plan, true)) {
    const doc = empDoc(e.id);
    if (!doc || !doc.obj) continue;
    for (const [id, r] of Object.entries(doc.obj.requests || {})) if (alive(r)) list.push({ id, emp: e, ...r });
  }
  return list.sort((a, b) => (a.from < b.from ? -1 : 1));
}

function statusChip(s) {
  const c = { offen: '#c48a10', genehmigt: '#2e9d5b', abgelehnt: '#c0392b', zurückgezogen: '#9aa3ad' }[s] || '#888';
  return `<span class="chip" style="--c:${c}">${esc(s)}</span>`;
}

function render(main) {
  const plan = App.plan.obj;
  const admin = isAdmin();
  const y = App.vyear;
  const emps = admin ? employeesSorted(plan).filter(tracked).filter((e) => !e.endDate || e.endDate >= `${y}-01-01`) : [{ id: App.cfg.empId, ...plan.employees[App.cfg.empId] }];
  const acc = emps.map((e) => ({ e, v: vacationAccount(plan, e) }));
  const reqs = admin ? allRequests() : Object.entries((App.me.doc.obj.requests) || {}).filter(([, r]) => alive(r)).map(([id, r]) => ({ id, emp: emps[0], ...r })).sort((a, b) => (a.from < b.from ? 1 : -1));
  const open = reqs.filter((r) => r.status === 'offen');

  const toolbar = `
    <div class="toolbar">
      <div class="nav-group">
        <button class="icon-btn" data-act="vyear" data-d="-1" aria-label="Voriges Jahr">‹</button>
        <div class="period"><b>Urlaub ${y}</b></div>
        <button class="icon-btn" data-act="vyear" data-d="1" aria-label="Nächstes Jahr">›</button>
      </div>
      <div class="nav-group">
        ${admin ? '<button class="btn small primary" data-act="v-enter">Urlaub eintragen</button>' : '<button class="btn small primary" data-act="v-request">Urlaub beantragen</button>'}
      </div>
    </div>`;

  const accTable = `
    <h3>Urlaubskonto heute</h3>
    <div class="table-scroll"><table class="times">
      <thead><tr><th>Person</th><th>Urlaubsjahr</th><th class="num">Anspruch pro Jahr</th><th class="num">Stand heute</th><th class="num">Geplant</th><th class="num">Rest</th><th class="num">Kommt noch dazu</th></tr></thead>
      <tbody>${acc.map(({ e, v }) => {
        const fmt = (h) => `${K.fmtH(h)} h<small>${v.target ? K.fmtH(v.T(h)) + ' T' : ''}</small>`;
        return `<tr><td class="nowrap"><span class="dot" style="background:${e.color}"></span>${esc(e.name)}${e.startDate ? '' : (admin ? ' <span class="gap" title="Eintrittsdatum fehlt">Eintritt?</span>' : '')}</td>
          <td class="nowrap">${K.fmtDate(v.ujFrom)}–${K.fmtDate(v.ujTo, true)}<small>+ ${K.fmtH(v.monatH)} h pro Monat</small></td>
          <td class="num"><b>${v.target ? K.fmtH(v.T(v.jahrH)) + ' Tage' : '–'}</b><small>${K.fmtH(v.jahrH)} h · ${esc(plan.settings.vacationWeeks)} Wochen</small></td>
          <td class="num">${fmt(v.standH)}</td><td class="num">${fmt(v.geplantH)}</td>
          <td class="num"><b class="${v.restH < 0 ? 'neg' : ''}">${fmt(v.restH)}</b></td>
          <td class="num">${fmt(v.nochH)}<small>${v.next ? 'nächste am ' + K.fmtDate(v.next) : ''}</small></td></tr>`;
      }).join('')}</tbody>
    </table></div>
    <p class="hint">Pro Jahr ${esc(plan.settings.vacationWeeks)} Wochen × Wochenstunden. Jeden Monat am Tag des Eintritts kommt ein Zwölftel dazu, das Urlaubsjahr beginnt jeweils am Eintrittstag. Stand heute = Resturlaub am Stichtag + bisher erworben − genommen. Rest = Stand heute − schon eingetragener künftiger Urlaub. Ein Urlaubstag zählt ein Tagessoll; Feiertage und freie Tage der Person zählen nicht.${admin ? ' Eintritt, Stichtag und Resturlaub stellst du unter Einstellungen → Mitarbeiter ein.' : ''}</p>`;

  const reqList = (list, title) => list.length ? `
    <h3>${title}</h3>
    <ul class="req-list">${list.map((r) => {
      const days = requestDays(plan, r.from, r.to).filter((d) => employed(r.emp, d));
      return `<li>
        <div><b>${admin ? esc(r.emp.name) + ': ' : ''}${esc(r.kind || 'Urlaub')} ${K.fmtDate(r.from, true)} – ${K.fmtDate(r.to, true)}</b>
        <small>${days.length} Tage${r.note ? ' · ' + esc(r.note) : ''}${r.reply ? ' · Antwort: ' + esc(r.reply) : ''}</small></div>
        <div class="req-actions">${statusChip(r.status)}
          ${admin && r.status === 'offen' ? `<button class="btn small primary" data-act="v-approve" data-e="${r.emp.id}" data-r="${r.id}">Genehmigen</button><button class="btn small" data-act="v-reject" data-e="${r.emp.id}" data-r="${r.id}">Ablehnen</button>` : ''}
          ${!admin && r.status === 'offen' ? `<button class="btn small" data-act="v-withdraw" data-r="${r.id}">Zurückziehen</button>` : ''}
        </div></li>`;
    }).join('')}</ul>` : '';

  // Jahresübersicht: Wochen × Personen
  const mon0 = K.mondayOf(`${y}-01-01`);
  const weeks = [];
  for (let w = mon0; w <= `${y}-12-31`; w = K.addDays(w, 7)) weeks.push(w);
  const overview = `
    <h3>Wer ist wann weg?</h3>
    <div class="table-scroll"><table class="yearview">
      <thead><tr><th class="sticky"></th>${weeks.map((w) => { const p = K.parseIso(K.addDays(w, 3)); const first = p.d <= 7; return `<th title="KW ${K.isoWeek(w)}">${first && p.y === y ? K.MONATE[p.m - 1].slice(0, 3) : ''}</th>`; }).join('')}</tr></thead>
      <tbody>${employeesSorted(plan).map((e) => `<tr><th class="sticky"><span class="dot" style="background:${e.color}"></span>${esc(e.name)}</th>${weeks.map((w) => {
        let u = 0, k = 0;
        const list = [];
        for (let i = 0; i < 6; i++) {
          const d = K.addDays(w, i);
          const pe = planEntry(plan, d, e.id);
          if (pe && pe.kind === 'status' && (pe.status === 'Urlaub' || pe.status === 'ZA')) { u++; list.push(d); }
          if (pe && pe.kind === 'status' && pe.status === 'Krankenstand') k++;
        }
        const cls = u >= 4 ? 'v3' : u >= 2 ? 'v2' : u ? 'v1' : k ? 'k' : '';
        return `<td class="${cls}" title="KW ${K.isoWeek(w)}: ${u ? u + ' Tage Urlaub/ZA' : ''}${k ? ' ' + k + ' Tage krank' : ''}"></td>`;
      }).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <div class="legend"><span><i class="v1"></i>1 Tag</span><span><i class="v2"></i>2–3 Tage</span><span><i class="v3"></i>ganze Woche</span><span><i class="k"></i>Krankenstand</span></div>`;

  const myDays = !admin ? `<h3>Eingetragene Urlaubstage ${y}</h3><p>${ranges(acc[0].v.tage).join(', ') || '<span class="muted">Keine</span>'}</p>` : '';

  main.innerHTML = toolbar
    + (admin && open.length ? reqList(open, `Offene Anträge (${open.length})`) : '')
    + accTable
    + (admin ? overview : myDays)
    + (admin ? reqList(reqs.filter((r) => r.status !== 'offen' && r.to >= `${y}-01-01` && r.from <= `${y}-12-31`), 'Erledigte Anträge') : reqList(reqs, 'Meine Anträge'));
}

act('vyear', ({ d }) => { App.vyear += +d; render(document.getElementById('main')); });

function writeDays(p, empId, days, status) {
  const t = now();
  const emp = p.employees[empId];
  for (const d of days) {
    if (!employed(emp, d)) continue;
    setEntry(p, d, empId, { kind: 'status', status }, t);
  }
}

async function rangeDialog(title, { withEmp, withNote, okLabel }) {
  const plan = App.plan.obj;
  const t = K.today();
  return openModal({
    title,
    body: `
      ${withEmp ? `<label class="field"><span>Mitarbeiter</span><select name="emp">${employeesSorted(plan).map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></label>` : ''}
      <div class="row2">
        <label class="field"><span>Von</span><input type="date" name="from" value="${t}"></label>
        <label class="field"><span>Bis</span><input type="date" name="to" value="${t}"></label>
      </div>
      <div class="seg"><label><input type="radio" name="kind" value="Urlaub" checked><span>Urlaub</span></label><label><input type="radio" name="kind" value="ZA"><span>Zeitausgleich</span></label></div>
      ${withNote ? '<label class="field"><span>Notiz (optional)</span><input name="note" maxlength="120"></label>' : ''}
      <p class="calc" id="calc"></p>`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: okLabel, kind: 'primary', value: 'ok' }],
    onOpen(root) {
      const upd = () => {
        const f = formData(root);
        if (f.from && f.to && f.to < f.from) root.querySelector('[name=to]').value = f.from;
        const g = formData(root);
        if (!g.from || !g.to) return;
        const n = requestDays(plan, g.from, g.to).filter((d) => K.weekday(d) < 5).length;
        root.querySelector('#calc').textContent = `${n} Arbeitstage (Mo–Fr, ohne Feiertage)`;
      };
      root.addEventListener('input', upd); root.addEventListener('change', upd); upd();
    },
    onAction(v, root) {
      if (!v) return null;
      const f = formData(root);
      if (!f.from || !f.to || f.to < f.from) { toast('Zeitraum prüfen', 'error'); return false; }
      return f;
    },
  });
}

act('v-enter', async () => {
  const f = await rangeDialog('Urlaub eintragen', { withEmp: true, okLabel: 'Eintragen' });
  if (!f) return;
  const days = requestDays(App.plan.obj, f.from, f.to);
  App.plan.update((p) => writeDays(p, f.emp, days, f.kind));
  toast(`${days.length} Tage eingetragen`);
});

act('v-request', async () => {
  const f = await rangeDialog('Urlaub beantragen', { withNote: true, okLabel: 'Beantragen' });
  if (!f) return;
  App.me.doc.update((o) => {
    o.requests[randomId(8)] = { from: f.from, to: f.to, kind: f.kind, note: f.note || '', status: 'offen', createdAt: now(), updatedAt: now() };
  });
  toast('Antrag gestellt. Der Planer sieht ihn beim nächsten Öffnen.');
});

act('v-withdraw', async ({ r }) => {
  if (!(await confirmBox('Antrag zurückziehen?', 'Zurückziehen'))) return;
  App.me.doc.update((o) => { o.requests[r] = { ...o.requests[r], status: 'zurückgezogen', updatedAt: now() }; });
});

act('v-approve', async ({ e, r }) => {
  const doc = empDoc(e);
  const req = doc.obj.requests[r];
  const plan = App.plan.obj;
  const days = requestDays(plan, req.from, req.to);
  // Konflikte zeigen: wer ist an diesen Tagen schon weg?
  const away = [];
  for (const d of days) {
    for (const o of employeesSorted(plan)) {
      if (o.id === e) continue;
      const pe = planEntry(plan, d, o.id);
      if (pe && pe.kind === 'status' && ['Urlaub', 'ZA', 'Krankenstand'].includes(pe.status)) away.push(`${o.name} ${K.fmtDate(d)}`);
    }
  }
  const v = vacationAccount(plan, { id: e, ...plan.employees[e] });
  const msg = `${plan.employees[e].name}: ${req.kind || 'Urlaub'} ${K.fmtDate(req.from, true)}–${K.fmtDate(req.to, true)} genehmigen? Rest danach etwa ${K.fmtH(v.restH - days.reduce((a, d) => a + sollDay(plan.employees[e], d, plan.settings), 0))} h.`
    + (away.length ? ` Gleichzeitig weg: ${away.slice(0, 8).join(', ')}${away.length > 8 ? ' …' : ''}` : '');
  if (!(await confirmBox(msg, 'Genehmigen'))) return;
  App.plan.update((p) => writeDays(p, e, days, req.kind || 'Urlaub'));
  doc.update((o) => { o.requests[r] = { ...o.requests[r], status: 'genehmigt', updatedAt: now() }; });
  toast('Genehmigt und im Plan eingetragen');
});

act('v-reject', async ({ e, r }) => {
  const doc = empDoc(e);
  const reason = await openModal({
    title: 'Antrag ablehnen',
    body: '<label class="field"><span>Begründung (optional, sieht der Mitarbeiter)</span><input name="reply" maxlength="120"></label>',
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Ablehnen', kind: 'danger', value: 'ok' }],
    onAction(v, root) { return v ? root.querySelector('[name=reply]').value : null; },
  });
  if (reason === null) return;
  doc.update((o) => { o.requests[r] = { ...o.requests[r], status: 'abgelehnt', reply: reason, updatedAt: now() }; });
});

registerView('vacation', { title: 'Urlaub', icon: '🌴', roles: ['admin', 'employee'], render });
