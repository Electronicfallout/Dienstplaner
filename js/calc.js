// Datums-, Stunden- und Feiertagsberechnungen. Alle Daten als 'YYYY-MM-DD' (lokal, ohne Zeitzone).

export const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const WOCHENTAGE_LANG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const MONATE = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Status, die keine Arbeitszeit sind. credit: wie viele Stunden angerechnet werden.
//  'tag'  = Tagessoll (Wochenstunden / Arbeitstage pro Woche)
//  'null' = 0 Stunden
//  'za'   = Tagessoll in den Stunden (wie Urlaub), das Zeitkonto sinkt aber um diesen Tag
export const STATUS = {
  'Frei':         { credit: 'null', farbe: '#9aa3ad', kurz: 'F' },
  'Urlaub':       { credit: 'tag',  farbe: '#2e9d5b', kurz: 'U' },
  'ZA':           { credit: 'za',    farbe: '#c48a10', kurz: 'ZA' },
  'Krankenstand': { credit: 'tag',  farbe: '#c0392b', kurz: 'K' },
  'Ersatzfrei':   { credit: 'tag',  farbe: '#7d5bbe', kurz: 'EF' },
  'Feiertag':     { credit: 'null', farbe: '#5b7dbe', kurz: 'FT' },
};

export function pad(n) { return String(n).padStart(2, '0'); }

export function iso(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

export function parseIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

// Tage seit Epoche (UTC-basiert, damit Sommerzeit egal ist)
export function dayNum(s) {
  const { y, m, d } = parseIso(s);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function fromDayNum(n) {
  const dt = new Date(n * 86400000);
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(s, n) { return fromDayNum(dayNum(s) + n); }

// 0 = Montag ... 6 = Sonntag
export function weekday(s) { return (dayNum(s) + 3) % 7; }

export function mondayOf(s) { return addDays(s, -weekday(s)); }

export function today() {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

export function monthDays(y, m) {
  const out = [];
  for (let d = 1; d <= daysInMonth(y, m); d++) out.push(iso(y, m, d));
  return out;
}

export function isoWeek(s) {
  const n = dayNum(s);
  const thursday = n - weekday(s) + 3;
  const ty = parseIso(fromDayNum(thursday)).y;
  const firstThursday = dayNum(iso(ty, 1, 4));
  const ftMon = firstThursday - weekday(iso(ty, 1, 4)) + 3;
  return 1 + Math.round((thursday - ftMon) / 7);
}

export function fmtDate(s, withYear = false) {
  const { y, m, d } = parseIso(s);
  return `${pad(d)}.${pad(m)}.${withYear ? y : ''}`;
}

export function fmtH(h) {
  if (h === null || h === undefined || isNaN(h)) return '–';
  const r = Math.round(h * 100) / 100;
  return r.toLocaleString('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// --- Uhrzeiten ---

export function parseTime(t) {
  if (!t) return null;
  const m = String(t).trim().match(/^(\d{1,2})[:.]?(\d{2})$/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

export function fmtTime(min) {
  if (min === null || min === undefined) return '';
  return `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
}

// Dauer in Minuten (über Mitternacht möglich)
export function durationMin(start, end) {
  const a = parseTime(start), b = parseTime(end);
  if (a === null || b === null) return null;
  let d = b - a;
  if (d <= 0) d += 24 * 60;
  return d;
}

// Automatische Pause: sobald der Dienst länger als pauseAfterH Stunden ist.
export function autoPauseMin(start, end, settings) {
  const d = durationMin(start, end);
  if (d === null) return 0;
  return d > settings.pauseAfterH * 60 ? settings.pauseMin : 0;
}

// Arbeitsstunden einer Zeitspanne; pause === undefined/null/'' => automatische Pause
export function workHours(start, end, settings, pause) {
  const d = durationMin(start, end);
  if (d === null) return null;
  const p = (pause === undefined || pause === null || pause === '') ? autoPauseMin(start, end, settings) : Number(pause);
  return Math.max(0, d - p) / 60;
}

// --- Feiertage Österreich ---

function easterSunday(y) {
  // Gauß / Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

const holidayCache = {};
export function holidaysAT(y) {
  if (holidayCache[y]) return holidayCache[y];
  const e = easterSunday(y);
  const list = {
    [iso(y, 1, 1)]: 'Neujahr',
    [iso(y, 1, 6)]: 'Heilige Drei Könige',
    [addDays(e, 1)]: 'Ostermontag',
    [iso(y, 5, 1)]: 'Staatsfeiertag',
    [addDays(e, 39)]: 'Christi Himmelfahrt',
    [addDays(e, 50)]: 'Pfingstmontag',
    [addDays(e, 60)]: 'Fronleichnam',
    [iso(y, 8, 15)]: 'Mariä Himmelfahrt',
    [iso(y, 10, 26)]: 'Nationalfeiertag',
    [iso(y, 11, 1)]: 'Allerheiligen',
    [iso(y, 12, 8)]: 'Mariä Empfängnis',
    [iso(y, 12, 25)]: 'Christtag',
    [iso(y, 12, 26)]: 'Stefanitag',
  };
  holidayCache[y] = list;
  return list;
}

// Feiertag eines Datums, unter Berücksichtigung eigener Einträge (settings.holidays: {datum: name|null})
export function holidayName(s, settings) {
  const own = settings && settings.holidays ? settings.holidays[s] : undefined;
  if (own === null || own === false || own === '') return null; // bewusst ausgeschaltet
  if (typeof own === 'string') return own;
  return holidaysAT(parseIso(s).y)[s] || null;
}
