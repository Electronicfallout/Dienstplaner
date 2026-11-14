// Abgeleitete Werte: was steht an einem Tag, wie viele Stunden zählen, Soll/Ist, Urlaub.

import { STATUS, weekday, holidayName, workHours, autoPauseMin, durationMin, monthDays, parseIso, dayNum, iso, today } from './calc.js';

export function alive(r) { return r && !r.deleted; }

export function employeesSorted(plan, includeInactive = false) {
  return Object.entries(plan.employees)
    .filter(([, e]) => alive(e) && (includeInactive || e.active !== false))
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
}

export function shiftsSorted(plan) {
  return Object.entries(plan.shifts)
    .filter(([, s]) => alive(s))
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export const entryKey = (date, empId) => `${date}|${empId}`;

export function employed(emp, date) {
  if (emp.startDate && date < emp.startDate) return false;
  if (emp.endDate && date > emp.endDate) return false;
  return true;
}

// Tagessoll in Stunden (Wochenstunden / Arbeitstage, an Mo–Fr ohne Feiertag)
export function dayTarget(emp, settings) {
  return (Number(emp.weeklyHours) || 0) / (settings.workdaysPerWeek || 5);
}

export function sollDay(emp, date, settings) {
  if (!employed(emp, date)) return 0;
  if (weekday(date) > 4) return 0;
  if (holidayName(date, settings)) return 0;
  return dayTarget(emp, settings);
}

// Was steht im Plan? Liefert ein Eintragsobjekt oder null.
// Quelle: 'plan' (ausdrücklich eingetragen), 'vorlage' (fixer Wochenplan), 'feiertag'
export function planEntry(plan, date, empId) {
  const e = plan.entries[entryKey(date, empId)];
  if (alive(e)) return { ...e, source: 'plan' };
  const emp = plan.employees[empId];
  if (!emp || !employed(emp, date)) return null;
  const hol = holidayName(date, plan.settings);
  if (hol) return { kind: 'status', status: 'Feiertag', source: 'feiertag', note: hol };
  const t = plan.template[empId];
  if (alive(t) && (!t.validFrom || date >= t.validFrom) && (!t.validTo || date <= t.validTo)) {
    const v = t.days && t.days[weekday(date)];
    if (v) {
      if (v.startsWith('status:')) return { kind: 'status', status: v.slice(7), source: 'vorlage' };
      if (plan.shifts[v] && alive(plan.shifts[v])) return { kind: 'shift', shiftId: v, source: 'vorlage' };
    }
  }
  return null;
}

// Zeiten eines Eintrags auflösen
export function resolve(plan, entry, emp, date) {
  if (!entry) return null;
  const s = plan.settings;
  if (entry.kind === 'shift') {
    let start = entry.start, end = entry.end, label = null;
    if (entry.shiftId && plan.shifts[entry.shiftId]) {
      const sh = plan.shifts[entry.shiftId];
      start = start || sh.start; end = end || sh.end; label = sh.label;
    }
    const pause = (entry.pause === undefined || entry.pause === null || entry.pause === '') ? autoPauseMin(start, end, s) : Number(entry.pause);
    const h = workHours(start, end, s, entry.pause);
    return { type: 'shift', start, end, pause, workH: h || 0, creditH: 0, label, text: `${start}–${end}`, note: entry.note };
  }
  if (entry.kind === 'status') {
    const def = STATUS[entry.status] || { credit: 'null' };
    let credit = 0;
    if (entry.credit !== undefined && entry.credit !== null && entry.credit !== '') credit = Number(entry.credit);
    else if (def.credit === 'tag') credit = emp ? sollDay(emp, date, s) : 0;
    return { type: 'status', status: entry.status, workH: 0, creditH: credit, text: entry.status, note: entry.note };
  }
  if (entry.kind === 'note') {
    return { type: 'note', workH: 0, creditH: 0, text: entry.note || '', note: entry.note };
  }
  return null;
}

// Vom Mitarbeiter erfasste Zeit auflösen
export function resolveTime(t, settings) {
  if (!alive(t)) return null;
  if (t.status) return { type: 'status', status: t.status, workH: 0, text: t.status };
  const h = workHours(t.start, t.end, settings, t.pause);
  const pause = (t.pause === undefined || t.pause === null || t.pause === '') ? autoPauseMin(t.start, t.end, settings) : Number(t.pause);
  return { type: 'shift', start: t.start, end: t.end, pause, workH: h || 0, text: `${t.start}–${t.end}` };
}

// Monatsauswertung für eine Person. times = erfasste Zeiten des Mitarbeiters (oder null, wenn nicht zugänglich)
export function monthStats(plan, emp, y, m, times, untilDate) {
  const s = plan.settings;
  const r = { soll: 0, planH: 0, istH: 0, creditH: 0, erfasstTage: 0, abweichTage: 0, urlaubTage: 0, krankTage: 0, zaTage: 0, tage: [] };
  for (const d of monthDays(y, m)) {
    if (untilDate && d > untilDate) break;
    const pe = planEntry(plan, d, emp.id);
    const pr = resolve(plan, pe, emp, d);
    const soll = sollDay(emp, d, s);
    const tr = times ? resolveTime(times[d], s) : null;
    const planWork = pr ? pr.workH : 0;
    const credit = pr ? pr.creditH : 0;
    const ist = tr ? tr.workH : planWork;
    r.soll += soll;
    r.planH += planWork;
    r.istH += ist;
    r.creditH += credit;
    if (tr) { r.erfasstTage++; if (Math.abs(tr.workH - planWork) > 0.01) r.abweichTage++; }
    if (pr && pr.type === 'status') {
      if (pr.status === 'Urlaub' && soll > 0) r.urlaubTage++;
      if (pr.status === 'Krankenstand' && soll > 0) r.krankTage++;
      if (pr.status === 'ZA') r.zaTage++;
    }
    r.tage.push({ date: d, pe, pr, tr, soll, ist, credit });
  }
  r.saldo = r.istH + r.creditH - r.soll;
  return r;
}

// Saldo (Plus-/Minusstunden) vom Startdatum bis einschließlich untilDate
export function saldoUntil(plan, emp, untilDate, times) {
  // Zeitkonto zählt ab dem Startdatum der Person, sonst ab dem allgemeinen Start (Inbetriebnahme der App)
  let from = emp.saldoFrom || plan.settings.saldoFrom || `${parseIso(untilDate).y}-01-01`;
  if (emp.startDate && emp.startDate > from) from = emp.startDate;
  let saldo = Number(emp.zaStartH) || 0;
  if (from > untilDate) return saldo;
  let { y, m } = parseIso(from);
  const end = parseIso(untilDate);
  while (y < end.y || (y === end.y && m <= end.m)) {
    const st = monthStats(plan, emp, y, m, times, untilDate);
    for (const t of st.tage) if (t.date >= from) saldo += t.ist + t.credit - t.soll;
    m++; if (m > 12) { m = 1; y++; }
  }
  return saldo;
}

// Urlaubskonto eines Jahres (in Stunden und Tagen)
export function vacationYear(plan, emp, y) {
  const s = plan.settings;
  const target = dayTarget(emp, s);
  const anspruchH = (s.vacationWeeks || 5) * (Number(emp.weeklyHours) || 0) + (Number((emp.vacationAdjust || {})[y]) || 0);
  let verbrauchtH = 0, geplantH = 0, tageVerbraucht = 0, tageGeplant = 0;
  const heute = today();
  const tage = [];
  for (let m = 1; m <= 12; m++) {
    for (const d of monthDays(y, m)) {
      const pe = planEntry(plan, d, emp.id);
      if (!pe || pe.kind !== 'status' || pe.status !== 'Urlaub') continue;
      const soll = sollDay(emp, d, s);
      tage.push(d);
      if (soll <= 0) continue;
      const h = (pe.credit !== undefined && pe.credit !== null && pe.credit !== '') ? Number(pe.credit) : soll;
      if (d <= heute) { verbrauchtH += h; tageVerbraucht++; } else { geplantH += h; tageGeplant++; }
    }
  }
  return {
    anspruchH, verbrauchtH, geplantH, restH: anspruchH - verbrauchtH - geplantH,
    tageVerbraucht, tageGeplant, anspruchTage: target ? anspruchH / target : 0,
    restTage: target ? (anspruchH - verbrauchtH - geplantH) / target : 0,
    tage,
  };
}

// Tage, die ein Urlaubsantrag umfasst (ohne Sonntage und Feiertage)
export function requestDays(plan, from, to) {
  const out = [];
  for (let n = dayNum(from); n <= dayNum(to); n++) {
    const d = new Date(n * 86400000);
    const ds = iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    if (weekday(ds) === 6) continue;
    if (holidayName(ds, plan.settings)) continue;
    out.push(ds);
  }
  return out;
}

export { durationMin };

// ---------- Veröffentlichung und Änderungsprotokoll ----------

export function isPublished(plan, date) {
  const pu = plan.settings.publishedUntil;
  return !pu || date <= pu;
}

export function entryText(plan, date, empId) {
  const emp = plan.employees[empId];
  const r = resolve(plan, planEntry(plan, date, empId), emp ? { id: empId, ...emp } : null, date);
  if (!r) return 'kein Dienst';
  if (r.type === 'shift') return `${r.start}–${r.end}`;
  if (r.type === 'status') return r.status;
  return r.text || 'Notiz';
}

// Eintrag setzen (rec = null löscht). Protokolliert Änderungen an bereits veröffentlichten Tagen.
export function setEntry(plan, date, empId, rec, t) {
  const k = entryKey(date, empId);
  const before = entryText(plan, date, empId);
  plan.entries[k] = rec ? { ...rec, updatedAt: t } : { deleted: true, updatedAt: t };
  const after = entryText(plan, date, empId);
  const pu = plan.settings.publishedUntil;
  if (pu && date <= pu && before !== after) {
    plan.changes = plan.changes || {};
    // mehrere Änderungen am selben Tag/Person innerhalb kurzer Zeit zusammenfassen
    const id = `${date}|${empId}|${Math.floor(t / 600000)}`;
    const prev = plan.changes[id];
    plan.changes[id] = { date, empId, from: prev ? prev.from : before, to: after, at: t, updatedAt: t };
    if (plan.changes[id].from === after) plan.changes[id] = { deleted: true, updatedAt: t };
  }
}
