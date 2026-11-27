// Kalender-Abo: schreibt die Dienste einzelner Personen als .ics-Datei in den Dropbox-App-Ordner.
// Über einen geteilten Dropbox-Link kann z. B. Google Kalender die Datei abonnieren ("Per URL hinzufügen").
// Eingeschaltet wird das pro Person (employees[id].calFeed = zufälliges Kürzel für den Dateinamen).
// Die Datei wird nach jeder synchronisierten Planänderung neu geschrieben, aber nur, wenn sich ihr Inhalt geändert hat.

import * as K from './calc.js';
import { LS } from './storage.js';
import { alive, planEntry, resolve, eventsOn, isPublished } from './model.js';

const PAST_DAYS = 31;      // so weit zurück bleiben Dienste im Kalender
const AHEAD_DAYS = 120;    // so weit voraus, wenn nichts "veröffentlicht bis" eingestellt ist
const SKIP_STATUS = new Set(['Frei', 'Feiertag']);

export function feedPath(emp) {
  const slug = String(emp.name || 'person').normalize('NFD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'person';
  return `kalender/dienste-${slug}-${emp.calFeed}.ics`;
}

function escText(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

// Zeilen nach RFC 5545 auf 75 Bytes falten
function fold(line) {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const out = [];
  let cur = '', len = 0, max = 75;
  for (const ch of line) {
    const n = bytes.encode(ch).length;
    if (len + n > max) { out.push(cur); cur = ''; len = 0; max = 74; }
    cur += ch; len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const ymd = (date) => date.replace(/-/g, '');
const hm = (min) => K.pad(Math.floor(min / 60)) + K.pad(min % 60) + '00';

function stamp(t) {
  const d = new Date(t || Date.UTC(2026, 0, 1));
  return `${d.getUTCFullYear()}${K.pad(d.getUTCMonth() + 1)}${K.pad(d.getUTCDate())}T${K.pad(d.getUTCHours())}${K.pad(d.getUTCMinutes())}${K.pad(d.getUTCSeconds())}Z`;
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Vienna',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

// Änderungszeit des Datensatzes, aus dem der Eintrag stammt (damit die Datei ohne Planänderung gleich bleibt)
function sourceTime(plan, date, empId, entry) {
  if (entry.source === 'plan') return entry.updatedAt;
  if (entry.source === 'vorlage') return plan.template[empId] && plan.template[empId].updatedAt;
  return 0;
}

export function buildIcs(plan, empId, today = K.today()) {
  const emp = plan.employees[empId];
  const s = plan.settings;
  const from = K.addDays(today, -PAST_DAYS);
  const to = s.publishedUntil || K.addDays(today, AHEAD_DAYS);
  const firma = s.firma || 'Dienstplan';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dienstplaner//Kalender-Abo//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escText('Dienste ' + emp.name)}`, 'X-WR-TIMEZONE:Europe/Vienna',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE,
  ];
  for (let d = from; d <= to; d = K.addDays(d, 1)) {
    if (!isPublished(plan, d)) continue;
    const entry = planEntry(plan, d, empId);
    if (!entry) continue;
    const r = resolve(plan, entry, { id: empId, ...emp }, d);
    if (!r) continue;
    const desc = [];
    const ev = [
      'BEGIN:VEVENT',
      `UID:${ymd(d)}-${empId}@dienstplaner`,
      `DTSTAMP:${stamp(sourceTime(plan, d, empId, entry))}`,
    ];
    if (r.type === 'shift') {
      const a = K.parseTime(r.start);
      if (a === null) continue;
      let b = K.parseTime(r.openEnd ? r.endCalc : r.end);
      let endDate = d;
      if (b === null) b = Math.min(a + 60, 24 * 60 - 1);
      if (b <= a) endDate = K.addDays(d, 1);
      if (b === 24 * 60) { b = 0; endDate = K.addDays(d, 1); }
      ev.push(`DTSTART;TZID=Europe/Vienna:${ymd(d)}T${hm(a)}`, `DTEND;TZID=Europe/Vienna:${ymd(endDate)}T${hm(b)}`);
      ev.push(`SUMMARY:${escText(r.openEnd ? `Dienst ab ${r.start} (offenes Ende)` : `Dienst ${r.start}–${r.end}`)}`);
      if (r.label) desc.push('Schicht: ' + r.label);
      if (r.pause) desc.push(`Pause: ${r.pause} min`);
      if (r.openEnd) desc.push('Ende offen' + (r.endCalc ? `, geschätzt bis ${r.endCalc}` : ''));
      ev.push(`LOCATION:${escText(firma)}`);
    } else if (r.type === 'status') {
      if (SKIP_STATUS.has(r.status)) continue;
      ev.push(`DTSTART;VALUE=DATE:${ymd(d)}`, `DTEND;VALUE=DATE:${ymd(K.addDays(d, 1))}`, `SUMMARY:${escText(r.text)}`, 'TRANSP:TRANSPARENT');
    } else {
      if (!r.text) continue;
      ev.push(`DTSTART;VALUE=DATE:${ymd(d)}`, `DTEND;VALUE=DATE:${ymd(K.addDays(d, 1))}`, `SUMMARY:${escText(r.text)}`, 'TRANSP:TRANSPARENT');
    }
    if (r.note && r.type !== 'note') desc.push('Notiz: ' + r.note);
    const events = eventsOn(plan, d).map((x) => x.title);
    if (events.length) desc.push('Im Shop: ' + events.join(' · '));
    if (desc.length) ev.push(`DESCRIPTION:${escText(desc.join('\n'))}`);
    ev.push('END:VEVENT');
    lines.push(...ev);
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function feedPeople(plan) {
  return Object.entries(plan.employees).filter(([, e]) => alive(e) && e.calFeed).map(([id, e]) => ({ id, ...e }));
}

export const feedState = (emp) => { try { return JSON.parse(LS.get('dp.cal:' + feedPath(emp)) || 'null'); } catch { return null; } };

// Schreibt alle eingeschalteten Kalender-Dateien, deren Inhalt sich geändert hat. force = auch unverändert schreiben.
export async function writeFeeds(doc, provider, force = false) {
  if (!provider || !provider.writeText || !doc.obj) return 0;
  let n = 0;
  for (const emp of feedPeople(doc.obj)) {
    const path = feedPath(emp);
    const text = buildIcs(doc.obj, emp.id);
    const hash = await sha(text);
    const st = feedState(emp);
    if (!force && st && st.hash === hash) continue;
    await provider.writeText(path, text);
    LS.set('dp.cal:' + path, JSON.stringify({ hash, at: Date.now() }));
    n++;
  }
  return n;
}

// Nach jeder erfolgreichen Synchronisation (und einmal am Tag wegen des wandernden Zeitfensters) prüfen
let timer = 0, running = false;
export function watchFeeds(doc, provider) {
  if (!provider || !provider.writeText) return;
  const check = () => {
    if (doc.status !== 'ok' || doc.dirty || !doc.obj || !feedPeople(doc.obj).length) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (running) return;
      running = true;
      try { await writeFeeds(doc, provider); } catch (e) { console.warn('Kalender-Abo', e); } finally { running = false; }
    }, 3000);
  };
  doc.on(check);
  check();
}
