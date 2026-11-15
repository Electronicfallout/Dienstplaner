// Samstags-Rad: Vollzeitkräfte übernehmen der Reihe nach die Samstagsdienste.
// Wer an einem Samstag schon eingetragen ist (z. B. als Judge bei einem Event, Urlaub, Frei), wird übersprungen;
// ein Judge-Einsatz zählt als gearbeiteter Samstag. Vorschlag: wer seit Beginn am wenigsten Samstage hatte,
// bei Gleichstand wer am längsten keinen mehr hatte.
// plan.settings.satRotation = { members: [empId] | null (= alle Vollzeitkräfte), shiftId, count, from }

import { App, isAdmin } from './app.js';
import { esc, act, openModal, toast, formData } from './ui.js';
import * as K from './calc.js';
import { employeesSorted, shiftsSorted, planEntry, resolve, employed, alive, setEntry, tracked } from './model.js';
import { now } from './store.js';

export function isJudge(r) {
  return !!r && (/judge/i.test(r.text || '') || /judge/i.test(r.note || ''));
}

export function satConfig(plan) {
  const c = plan.settings.satRotation || {};
  const shifts = shiftsSorted(plan);
  const sh = (c.shiftId && plan.shifts[c.shiftId] && alive(plan.shifts[c.shiftId])) ? c.shiftId
    : (shifts.find((x) => /samstag/i.test(x.label || '')) || shifts.find((x) => x.start >= '10:00') || shifts[0] || {}).id;
  return {
    members: Array.isArray(c.members) ? c.members : null,
    shiftId: sh,
    count: Math.max(1, Number(c.count) || 1),
    from: c.from || K.addDays(K.mondayOf(K.today()), -7 * 12 + 5),
  };
}

export function rotationMembers(plan) {
  const c = satConfig(plan);
  const all = employeesSorted(plan).filter(tracked);
  if (c.members) return all.filter((e) => c.members.includes(e.id));
  return all.filter((e) => Number(e.weeklyHours) >= 38);
}

function satWork(plan, e, d) {
  const r = resolve(plan, planEntry(plan, d, e.id), e, d);
  if (!r) return null;
  if (isJudge(r)) return 'judge';
  if (r.type === 'shift') return 'shift';
  return null;
}

// Samstage pro Person seit Beginn (vor dem Datum)
export function satHistory(plan, members, before) {
  const c = satConfig(plan);
  const h = {};
  for (const e of members) h[e.id] = { n: 0, last: null, judge: 0 };
  const start = K.addDays(c.from, (5 - K.weekday(c.from) + 7) % 7);
  for (let d = start; d < before; d = K.addDays(d, 7)) {
    for (const e of members) {
      if (!employed(e, d)) continue;
      const w = satWork(plan, e, d);
      if (w) { h[e.id].n++; h[e.id].last = d; if (w === 'judge') h[e.id].judge++; }
    }
  }
  return h;
}

// Vorschlag für die Samstage im Bereich [from, to]
export function suggestSaturdays(plan, from, to) {
  const c = satConfig(plan);
  const members = rotationMembers(plan);
  const first = K.addDays(from, (5 - K.weekday(from) + 7) % 7);
  const hist = satHistory(plan, members, first);
  const out = [];
  for (let d = first; d <= to; d = K.addDays(d, 7)) {
    if (K.holidayName(d, plan.settings)) { out.push({ date: d, skip: 'Feiertag' }); continue; }
    const busy = [];
    let have = 0;
    for (const e of members) {
      const w = employed(e, d) ? satWork(plan, e, d) : null;
      if (w === 'shift') have++;
      if (w) { hist[e.id].n++; hist[e.id].last = d; }
      const pe = planEntry(plan, d, e.id);
      if (pe && pe.source === 'plan') busy.push(e.id);
    }
    const need = c.count - have;
    if (need <= 0) { out.push({ date: d, skip: 'schon besetzt' }); continue; }
    const cand = members.filter((e) => employed(e, d) && !busy.includes(e.id))
      .sort((a, b) => hist[a.id].n - hist[b.id].n || (hist[a.id].last || '').localeCompare(hist[b.id].last || '') || 0);
    const pick = cand.slice(0, need);
    for (const e of pick) { hist[e.id].n++; hist[e.id].last = d; }
    out.push({ date: d, pick, judges: members.filter((e) => satWork(plan, e, d) === 'judge').map((e) => e.name), missing: need - pick.length });
  }
  return out;
}

act('sat-rotate', async () => {
  if (!isAdmin()) return;
  const plan = App.plan.obj;
  const c = satConfig(plan);
  const sh = plan.shifts[c.shiftId];
  if (!sh) { toast('Bitte zuerst unter Einstellungen → Samstags-Rad eine Schicht wählen', 'error'); return; }
  const mon = App.week;
  const { y, m } = K.parseIso(K.addDays(mon, 5));
  const monthEnd = K.iso(y, m, K.daysInMonth(y, m));
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const nextEnd = K.iso(ny, nm, K.daysInMonth(ny, nm));
  const preview = (to) => suggestSaturdays(plan, mon, to).map((x) => `<li><b>${K.WOCHENTAGE[5]} ${K.fmtDate(x.date)}</b> ${x.skip ? `<span class="muted">${esc(x.skip)}</span>`
    : `${x.pick.map((e) => esc(e.name)).join(', ') || '<span class="warn-text">niemand frei</span>'}${x.missing > 0 && x.pick.length ? ' <span class="warn-text">(zu wenige frei)</span>' : ''}${x.judges.length ? ` <small>Judge: ${esc(x.judges.join(', '))}</small>` : ''}`}</li>`).join('');
  const r = await openModal({
    title: 'Samstage verteilen',
    body: `<p class="small muted">Schicht ${esc(sh.start)}–${esc(sh.end)}, ${c.count} Person${c.count > 1 ? 'en' : ''} pro Samstag. Wer schon eingetragen ist (Judge, Urlaub, Frei …), wird übersprungen.</p>
      <div class="seg">
        <label><input type="radio" name="to" value="${K.addDays(mon, 6)}" checked><span>diese Woche</span></label>
        <label><input type="radio" name="to" value="${monthEnd}"><span>bis ${K.fmtDate(monthEnd, true)}</span></label>
        <label><input type="radio" name="to" value="${nextEnd}"><span>bis ${K.fmtDate(nextEnd, true)}</span></label>
      </div>
      <ul class="list" id="satprev">${preview(K.addDays(mon, 6))}</ul>`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Eintragen', kind: 'primary', value: 'ok' }],
    onOpen(root) { root.addEventListener('change', () => { root.querySelector('#satprev').innerHTML = preview(formData(root).to); }); },
    onAction(v, root) { return v ? formData(root).to : null; },
  });
  if (!r) return;
  const sug = suggestSaturdays(plan, mon, r);
  let n = 0;
  App.plan.update((p) => {
    const t = now();
    for (const x of sug) for (const e of x.pick || []) { setEntry(p, x.date, e.id, { kind: 'shift', shiftId: c.shiftId }, t); n++; }
  });
  toast(n ? `${n} Samstagsdienste eingetragen` : 'Nichts einzutragen');
});

// ---------- Einstellungen ----------

export function satSettingsHtml(plan) {
  const c = satConfig(plan);
  const members = rotationMembers(plan);
  const hist = satHistory(plan, members, K.addDays(K.today(), 1));
  const shifts = shiftsSorted(plan);
  const ids = members.map((e) => e.id);
  return `
    <section class="card">
      <div class="card-head"><h2>Samstags-Rad</h2><button class="btn small primary" data-act="sat-save">Speichern</button></div>
      <p class="small muted">Diese Personen wechseln sich bei den Samstagen ab. Im Plan verteilt „Samstage“ die Dienste: Wer seit ${K.fmtDate(c.from, true)} am wenigsten Samstage hatte, kommt zuerst dran. Judge-Einsätze (Notiz „Judge“) zählen als Samstag, und wer am Samstag schon etwas eingetragen hat, wird übersprungen.</p>
      <form id="satform">
        <div class="seg">${employeesSorted(plan).filter(tracked).map((e) => `<label><input type="checkbox" name="m_${e.id}" ${ids.includes(e.id) ? 'checked' : ''}><span>${esc(e.name)}</span></label>`).join('')}</div>
        <div class="row2">
          <label class="field"><span>Samstagsschicht</span><select name="shiftId">${shifts.map((s) => `<option value="${s.id}" ${s.id === c.shiftId ? 'selected' : ''}>${esc(s.start)}–${esc(s.end)} ${esc(s.label || '')}</option>`).join('')}</select></label>
          <label class="field"><span>Personen pro Samstag</span><input type="number" name="count" min="1" max="5" value="${c.count}"></label>
        </div>
        <label class="field"><span>Zählen ab</span><input type="date" name="from" value="${esc(c.from)}"></label>
      </form>
      <ul class="list">${members.map((e) => `<li><span class="dot" style="background:${e.color}"></span><div class="grow"><b>${esc(e.name)}</b><small>${hist[e.id].n} Samstage${hist[e.id].judge ? `, davon ${hist[e.id].judge} als Judge` : ''}${hist[e.id].last ? ` · zuletzt ${K.fmtDate(hist[e.id].last, true)}` : ''}</small></div></li>`).join('')}</ul>
    </section>`;
}

act('sat-save', () => {
  const f = formData(document.getElementById('satform'));
  const members = employeesSorted(App.plan.obj).filter(tracked).filter((e) => f['m_' + e.id]).map((e) => e.id);
  App.plan.update((p) => {
    p.settings = { ...p.settings, satRotation: { members, shiftId: f.shiftId, count: Number(f.count) || 1, from: f.from || null }, updatedAt: now() };
  });
  toast('Samstags-Rad gespeichert');
});
