// Abgeleitete Werte: was steht an einem Tag, wie viele Stunden zählen, Soll/Ist, Urlaub.

import { STATUS, statusLabel, parseTime, weekday, holidayName, workHours, autoPauseMin, durationMin, monthDays, parseIso, dayNum, iso, today, addDays } from './calc.js';

export function alive(r) { return r && !r.deleted; }

// Personen mit Zeiterfassung (ohne Chef/Selbstständige)
export function tracked(e) { return !e.noTimes; }

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
    .sort((a, b) => (a.start || "").localeCompare(b.start || "") || (a.end || "").localeCompare(b.end || ""));
}

export const entryKey = (date, empId) => `${date}|${empId}`;

export function employed(emp, date) {
  if (emp.startDate && date < emp.startDate) return false;
  if (emp.endDate && date > emp.endDate) return false;
  return true;
}

// Tagessoll in Stunden (Wochenstunden / Arbeitstage, an Mo–Fr ohne Feiertag)
export function dayTarget(emp, settings) {
  const n = Array.isArray(emp.workDays) && emp.workDays.length ? emp.workDays.length : (settings.workdaysPerWeek || 5);
  return (Number(emp.weeklyHours) || 0) / n;
}

// Arbeitet die Person laut Vertrag an diesem Wochentag? (ohne Angabe: Mo–Fr; Samstag nur, wenn ausdrücklich gewählt)
export function isWorkDay(emp, date) {
  const wd = weekday(date);
  if (Array.isArray(emp.workDays) && emp.workDays.length) return emp.workDays.includes(wd);
  return wd <= 4;
}

export function sollDay(emp, date, settings) {
  if (!employed(emp, date) || emp.noTimes) return 0;
  if (!isWorkDay(emp, date)) return 0;
  return dayTarget(emp, settings);
}

// Soll unter Berücksichtigung von „Ersatzfrei Samstag“: der freie Wochentag hat kein Soll,
// dafür bekommt der Samstag derselben Woche das Tagessoll (auch wenn Samstag sonst kein Arbeitstag ist).
const EFS = 'Ersatzfrei Sa';
function isEFS(plan, emp, d) { const pe = planEntry(plan, d, emp.id); return !!(pe && pe.kind === 'status' && pe.status === EFS); }
export function sollAt(plan, emp, date, settings = plan.settings) {
  const base = sollDay(emp, date, settings);
  if (!employed(emp, date) || emp.noTimes) return 0;
  if (isEFS(plan, emp, date)) return 0;
  if (weekday(date) === 5) {
    let n = 0;
    for (let i = 1; i <= 5; i++) { const d = addDays(date, -i); if (employed(emp, d) && isEFS(plan, emp, d)) n++; }
    if (n) return base + n * dayTarget(emp, settings);
  }
  return base;
}

// Was steht im Plan? Liefert ein Eintragsobjekt oder null.
// Quelle: 'plan' (ausdrücklich eingetragen), 'vorlage' (fixer Wochenplan), 'feiertag'
// Stunden des Dienstes laut fixem Wochenplan an diesem Tag (für Zeitausgleich), sonst null
export function templateShiftH(plan, emp, date) {
  const t = plan.template[emp.id];
  if (!alive(t) || (t.validFrom && date < t.validFrom) || (t.validTo && date > t.validTo)) return null;
  const v = t.days && t.days[weekday(date)];
  const sh = v && plan.shifts[v];
  if (!sh || !alive(sh)) return null;
  return workHours(sh.start, sh.end, plan.settings) || null;
}

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

// Schichtfarben: Früh grün, Spät rot, Samstag gelb, langer Spätdienst violett
export const SHIFT_COLORS = { gruen: ['Grün', '#c6ecc8'], rot: ['Rot', '#f6c3bf'], gelb: ['Gelb', '#fff09a'], violett: ['Violett', '#dccaf3'] };

function autoShiftColor(start, end, date, label) {
  const s = parseTime(start), e = parseTime(end);
  if ((date && weekday(date) === 5) || /samstag/i.test(label || '')) return SHIFT_COLORS.gelb[1];
  if (e !== null && e >= 21 * 60) return SHIFT_COLORS.rot[1];
  if (e !== null && e >= 19 * 60 + 30) return SHIFT_COLORS.violett[1];
  if (s !== null && s <= 9 * 60) return SHIFT_COLORS.gruen[1];
  return '';
}

// Farbe einer Schicht: eigene Farbe der Vorlage, sonst automatisch nach Uhrzeit/Wochentag
export function shiftColor(plan, shiftId, start, end, date) {
  let sh = shiftId && alive(plan.shifts[shiftId]) ? plan.shifts[shiftId] : null;
  if (!sh) sh = Object.values(plan.shifts).find((x) => alive(x) && x.start === start && x.end === end) || null;
  if (sh && sh.color !== undefined && sh.color !== null) return sh.color;
  return autoShiftColor(start, end, date, sh && sh.label);
}

// Zeiten eines Eintrags auflösen.
// Feiertage zählen als voller Arbeitstag: Soll bleibt, und es gibt automatisch das Tagessoll als Feiertagsstunden gutgeschrieben.
// Wer am Feiertag arbeitet, bekommt die Arbeitszeit zusätzlich (Plusstunden).
export function resolve(plan, entry, emp, date) {
  const r = resolveRaw(plan, entry, emp, date);
  if (!r || !emp || !holidayName(date, plan.settings)) return r;
  const hol = sollDay(emp, date, plan.settings);
  if (r.type === 'status' && entry.credit !== undefined && entry.credit !== null && entry.credit !== '') return r;
  if (r.type === 'shift' || r.type === 'note') return { ...r, creditH: r.creditH + hol };
  return { ...r, creditH: Math.max(r.creditH, hol) };
}

function resolveRaw(plan, entry, emp, date) {
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
    return { type: 'shift', start, end, pause, workH: h || 0, creditH: 0, label, text: `${start}–${end}`, note: entry.note, color: shiftColor(plan, entry.shiftId, start, end, date), ...nightBonus(start, end, s) };
  }
  if (entry.kind === 'status') {
    const def = STATUS[entry.status] || { credit: 'null' };
    let credit = 0;
    if (entry.credit !== undefined && entry.credit !== null && entry.credit !== '') credit = Number(entry.credit);
    else if (def.credit === 'za' && emp && templateShiftH(plan, emp, date) !== null) credit = templateShiftH(plan, emp, date);
    else if (def.credit === 'tag' || def.credit === 'za') credit = emp ? sollDay(emp, date, s) : 0;
    return { type: 'status', status: entry.status, workH: 0, creditH: credit, text: statusLabel(entry.status), note: entry.note };
  }
  if (entry.kind === 'note') {
    return { type: 'note', workH: 0, creditH: 0, text: entry.note || '', note: entry.note };
  }
  return null;
}

// Nachtzuschlag: Arbeitszeit ab settings.nightFrom (Standard 21:00) zählt mit Faktor settings.nightFactor (Standard 1,5).
// Geliefert wird nur der Aufschlag (bei 1,5 also die Hälfte der Stunden ab 21 Uhr), getrennt von der tatsächlichen Arbeitszeit.
export function nightBonus(start, end, settings) {
  const a = parseTime(start); let b = parseTime(end);
  if (a === null || b === null) return { nightH: 0, bonusH: 0 };
  if (b <= a) b += 1440;
  const n = parseTime(settings.nightFrom || '21:00') ?? 1260;
  const nightH = Math.max(0, b - Math.max(a, n)) / 60;
  const f = Number(settings.nightFactor ?? 1.5);
  return { nightH, bonusH: nightH * Math.max(0, f - 1) };
}

// Vom Mitarbeiter erfasste Zeit auflösen
export function resolveTime(t, settings) {
  if (!alive(t)) return null;
  if (t.status) return { type: 'status', status: t.status, workH: 0, text: statusLabel(t.status) };
  const h = workHours(t.start, t.end, settings, t.pause);
  const pause = (t.pause === undefined || t.pause === null || t.pause === '') ? autoPauseMin(t.start, t.end, settings) : Number(t.pause);
  return { type: 'shift', start: t.start, end: t.end, pause, workH: h || 0, text: `${t.start}–${t.end}`, ...nightBonus(t.start, t.end, settings) };
}

// Monatsauswertung für eine Person. times = erfasste Zeiten des Mitarbeiters (oder null, wenn nicht zugänglich)
export function monthStats(plan, emp, y, m, times, untilDate) {
  const s = plan.settings;
  const r = { soll: 0, planH: 0, istH: 0, creditH: 0, bonusH: 0, erfasstTage: 0, abweichTage: 0, urlaubTage: 0, krankTage: 0, zaTage: 0, tage: [] };
  for (const d of monthDays(y, m)) {
    if (untilDate && d > untilDate) break;
    const pe = planEntry(plan, d, emp.id);
    const pr = resolve(plan, pe, emp, d);
    const soll = sollAt(plan, emp, d, s);
    const tr = times ? resolveTime(times[d], s) : null;
    const planWork = pr ? pr.workH : 0;
    // vom Mitarbeiter als Zeitausgleich bestätigt, obwohl ein Dienst geplant war: Dienststunden gelten als ZA
    const trZA = tr && tr.type === 'status' && tr.status === 'ZA' && pr && pr.type === 'shift';
    const credit = trZA ? planWork : pr ? pr.creditH : 0;
    const ist = trZA ? 0 : tr ? tr.workH : planWork;
    r.soll += soll;
    r.planH += planWork;
    r.istH += ist;
    r.creditH += credit;
    const bonus = tr ? (tr.bonusH || 0) : (pr && pr.bonusH) || 0;
    r.bonusH += bonus;
    if (tr) { r.erfasstTage++; if (Math.abs(tr.workH - planWork) > 0.01) r.abweichTage++; }
    if (pr && pr.type === 'status') {
      if (pr.status === 'Urlaub' && soll > 0) r.urlaubTage++;
      if (pr.status === 'Krankenstand' && soll > 0) r.krankTage++;
      if (pr.status === 'ZA') r.zaTage++;
    }
    if (trZA) r.zaTage++;
    const za = (trZA || (pr && pr.type === 'status' && pr.status === 'ZA')) && !holidayName(d, s) ? credit : 0;
    r.tage.push({ date: d, pe, pr, tr, soll, ist, credit, za, bonus });
  }
  r.saldo = r.tage.reduce((a, t) => a + t.ist + t.credit - t.za - t.soll + t.bonus, 0);
  return r;
}

// Saldo (Plus-/Minusstunden) vom Startdatum bis einschließlich untilDate
// Bis wann gerechnet wird: der heutige Tag zählt erst, wenn er erfasst ist oder der geplante Dienst vorbei ist
export function countedUntil(plan, emp, times) {
  const t = today();
  const y = addDays(t, -1);
  if (times && alive(times[t])) return t;
  const r = resolve(plan, planEntry(plan, t, emp.id), emp, t);
  if (r && r.type === 'shift' && r.end) {
    const d = new Date();
    const nowMin = d.getHours() * 60 + d.getMinutes();
    const end = parseTime(r.end);
    if (end !== null && end > parseTime(r.start) && nowMin >= end) return t;
  }
  return y;
}

export function saldoUntil(plan, emp, untilDate, times) {
  return saldoDetail(plan, emp, untilDate, times).saldo;
}

// Zeitkonto mit Aufteilung: Startwert, Plus/Minus aus Arbeitszeit, Nachtzuschlag
export function saldoDetail(plan, emp, untilDate, times) {
  // Zeitkonto zählt ab dem Startdatum der Person, sonst ab dem allgemeinen Start (Inbetriebnahme der App)
  let from = emp.saldoFrom || plan.settings.saldoFrom || `${parseIso(untilDate).y}-01-01`;
  if (emp.startDate && emp.startDate > from) from = emp.startDate;
  const startH = Number(emp.zaStartH) || 0;
  let arbeitH = 0, bonusH = 0;
  const weeks = []; // Aufschlüsselung pro Woche
  if (from > untilDate) return { saldo: startH, startH, arbeitH, bonusH, from, weeks };
  let { y, m } = parseIso(from);
  const end = parseIso(untilDate);
  while (y < end.y || (y === end.y && m <= end.m)) {
    const st = monthStats(plan, emp, y, m, times, untilDate);
    for (const t of st.tage) {
      if (t.date < from) continue;
      arbeitH += t.ist + t.credit - t.za - t.soll; bonusH += t.bonus; // ZA zählt als Stunden, verbraucht aber das Zeitkonto
      const wk = addDays(t.date, -weekday(t.date));
      let w = weeks[weeks.length - 1];
      if (!w || w.mon !== wk) { w = { mon: wk, soll: 0, ist: 0, credit: 0, za: 0, bonus: 0, offen: 0 }; weeks.push(w); }
      w.soll += t.soll; w.ist += t.ist; w.credit += t.credit; w.za += t.za; w.bonus += t.bonus;
      if (times && !t.tr && t.pr && t.pr.type === 'shift') w.offen++;
    }
    m++; if (m > 12) { m = 1; y++; }
  }
  return { saldo: startH + arbeitH + bonusH, startH, arbeitH, bonusH, from, weeks };
}

// Datum + k Monate (Tag wird auf das Monatsende gekürzt, z. B. 31.01. + 1 Monat = 28.02.)
export function addMonths(date, k) {
  const { y, m, d } = parseIso(date);
  const t = (y * 12 + (m - 1)) + k;
  const ny = Math.floor(t / 12), nm = (t % 12) + 1;
  return iso(ny, nm, Math.min(d, new Date(Date.UTC(ny, nm, 0)).getUTCDate()));
}

// Urlaubskonto in Tagen (Urlaubsjahr ab Eintritt): Jahresanspruch = Urlaubswochen × Arbeitstage pro Woche (Vollzeit 5 × 5 = 25 Tage).
// Jeden Monat am Eintrittstag kommt ein Zwölftel dazu. Stand am Stichtag (emp.vacFrom, sonst Zeitkonto-Start) = emp.vacStartT (Resturlaub in Tagen).
export function workDaysPerWeek(emp, settings) {
  return Array.isArray(emp.workDays) && emp.workDays.length ? emp.workDays.length : (settings.workdaysPerWeek || 5);
}

export function vacationAccount(plan, emp, at = today()) {
  const s = plan.settings;
  const jahrT = (s.vacationWeeks || 5) * workDaysPerWeek(emp, s);
  const monatT = jahrT / 12;
  let from = emp.vacFrom || s.saldoFrom || emp.startDate || `${parseIso(at).y}-01-01`;
  const anchor = emp.startDate || from;
  let startT = Number(emp.vacStartT ?? (emp.vacStartH ? emp.vacStartH / (dayTarget(emp, s) || 1) : 0)) || 0;
  if (emp.startDate && emp.startDate > from) { from = emp.startDate; startT = 0; }
  let erworbenT = 0, k = 1, next = null;
  for (;; k++) {
    const d = addMonths(anchor, k);
    if (d <= from) continue;
    if (d > at) { next = d; break; }
    erworbenT += monatT;
  }
  let n = 0;
  while (addMonths(anchor, 12 * (n + 1)) <= at) n++;
  const ujFrom = addMonths(anchor, 12 * n);
  const ujTo = addDays(addMonths(anchor, 12 * (n + 1)), -1);
  let nochT = 0;
  for (let d = next; d && d <= ujTo; d = addMonths(anchor, ++k)) nochT += monatT;
  // genommene und geplante Urlaubstage seit dem Stichtag (nur Arbeitstage der Person, keine Feiertage)
  let verbrauchtT = 0, geplantT = 0;
  const tage = [];
  for (const [key, pe] of Object.entries(plan.entries)) {
    if (!alive(pe) || pe.kind !== 'status' || pe.status !== 'Urlaub') continue;
    const [d, id] = key.split('|');
    if (id !== emp.id || d < from) continue;
    tage.push(d);
    if (holidayName(d, s) || !isWorkDay(emp, d) || !employed(emp, d)) continue;
    if (d <= at) verbrauchtT++; else geplantT++;
  }
  const standT = startT + erworbenT - verbrauchtT;
  return { from, startT, jahrT, monatT, erworbenT, verbrauchtT, geplantT, standT, restT: standT - geplantT, next, ujFrom, ujTo, nochT, tage: tage.sort() };
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

// ---------- Wiederkehrende Events ----------
// plan.recurring[id] = { title, weekday 0–6, every: 'week'|'2weeks'|'month', nth: 1–4 | -1 (letzter), from, to, noPrint, skip:{datum:true}, updatedAt }

export const NTH = { 1: '1.', 2: '2.', 3: '3.', 4: '4.', '-1': 'letzten' };

export function recurringMatches(r, date) {
  if (!alive(r)) return false;
  if (weekday(date) !== Number(r.weekday)) return false;
  if (r.from && date < r.from) return false;
  if (r.to && date > r.to) return false;
  if (r.skip && r.skip[date]) return false;
  const { y, m, d } = parseIso(date);
  if (r.every === '2weeks') {
    const anchor = r.from || '2026-01-05';
    const first = dayNum(anchor) + ((Number(r.weekday) - weekday(anchor) + 7) % 7);
    return ((dayNum(date) - first) / 7) % 2 === 0;
  }
  if (r.every === 'month') {
    const nth = Number(r.nth || 1);
    if (nth === -1) return d + 7 > new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Math.ceil(d / 7) === nth;
  }
  return true;
}

export function recurringOn(plan, date) {
  return Object.entries(plan.recurring || {})
    .filter(([, r]) => recurringMatches(r, date))
    .map(([id, r]) => ({ id, ...r }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function recurringText(r) {
  const wd = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'][Number(r.weekday)];
  if (r.every === '2weeks') return `jeden 2. ${wd}`;
  if (r.every === 'month') return `jeden ${NTH[String(r.nth || 1)]} ${wd} im Monat`;
  return `jeden ${wd}`;
}

// Alle Events eines Tages: [{title, recurring, noPrint}]
export function eventsOn(plan, date) {
  const out = [];
  const day = plan.days[date];
  if (alive(day) && day.event) out.push({ title: day.event, recurring: false, noPrint: false });
  for (const r of recurringOn(plan, date)) out.push({ title: r.title, recurring: true, noPrint: !!r.noPrint, id: r.id });
  return out;
}

// Besetzungsprüfung: Mo–Fr je eine Früh- und Mittelschicht, an den Spätdienst-Tagen auch eine Spätschicht;
// außerdem muss während der Öffnungszeiten immer jemand da sein
export function coverageOn(plan) {
  return plan.settings.coverageCheck !== false;
}

export function shiftSlot(start, end, settings) {
  const s = parseTime(start), e = parseTime(end);
  if (s === null || e === null) return null;
  if (s <= (parseTime(settings.fruehBis || '09:00') ?? 540)) return 'Früh';
  if (e >= (parseTime(settings.spaetAb || '21:00') ?? 1260)) return 'Spät';
  return 'Mittel';
}

// Öffnungszeiten je Wochentag (Mo=0 … So=6), null = geschlossen
export const DEFAULT_OPEN = [['11:00', '18:00'], ['11:00', '18:00'], ['11:00', '19:00'], ['11:00', '19:00'], ['11:00', '19:00'], ['12:00', '18:00'], null];

export function openHours(plan, date) {
  const o = (plan.settings.openHours || DEFAULT_OPEN)[weekday(date)];
  return o && o[0] && o[1] ? o : null;
}

const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Fehlende Besetzung eines Tages: 'Früh' / 'Mittel' / 'Spät' (Mo–Fr) und Zeiten der Öffnungszeit ohne Personal ('18:00–19:00')
export function coverageGaps(plan, date) {
  if (!coverageOn(plan) || holidayName(date, plan.settings)) return [];
  const wd = weekday(date);
  const have = new Set();
  const iv = [];
  for (const e of employeesSorted(plan)) {
    if (!employed(e, date)) continue;
    const r = resolve(plan, planEntry(plan, date, e.id), e, date);
    if (r && r.type === 'shift') {
      have.add(shiftSlot(r.start, r.end, plan.settings));
      const a = parseTime(r.start), b = parseTime(r.end);
      if (a !== null && b !== null) iv.push([a, b > a ? b : b + 1440]);
    }
  }
  const out = [];
  if (wd <= 4) {
    const spaetTage = plan.settings.spaetTage || [2, 3, 4]; // Standard: Mi–Fr
    const need = spaetTage.includes(wd) ? ['Früh', 'Mittel', 'Spät'] : ['Früh', 'Mittel'];
    out.push(...need.filter((x) => !have.has(x)));
  }
  const oh = openHours(plan, date);
  if (oh) {
    const o = parseTime(oh[0]), c = parseTime(oh[1]);
    let cur = o;
    for (const [a, b] of iv.sort((x, y) => x[0] - y[0])) {
      if (b <= cur) continue;
      if (a > cur) out.push(`${hm(cur)}–${hm(Math.min(a, c))}`);
      cur = Math.max(cur, b);
      if (cur >= c) break;
    }
    if (cur < c) out.push(`${hm(cur)}–${hm(c)}`);
  }
  return out;
}
