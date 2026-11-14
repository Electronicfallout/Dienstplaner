// Import von Events aus einer Kalenderdatei (.ics), z. B. Export aus Google Kalender oder Outlook.

import { App } from './app.js';
import { esc, openModal, toast, pickFile, formData } from './ui.js';
import * as K from './calc.js';
import { now } from './store.js';
import { randomId } from './crypto.js';
import { alive, recurringText } from './model.js';

const DAYS = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(s) {
  return s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}

function parseDate(prop, value) {
  // 20261121 | 20261121T180000 | 20261121T170000Z
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  if (m[7]) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    return { date: K.iso(d.getFullYear(), d.getMonth() + 1, d.getDate()), time: `${K.pad(d.getHours())}:${K.pad(d.getMinutes())}` };
  }
  return { date: K.iso(+m[1], +m[2], +m[3]), time: m[4] ? `${m[4]}:${m[5]}` : null };
}

export function parseIcs(text) {
  const events = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur && cur.title && cur.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const prop = line.slice(0, i), value = line.slice(i + 1);
    const name = prop.split(';')[0].toUpperCase();
    if (name === 'SUMMARY') cur.title = unescapeText(value);
    else if (name === 'DTSTART') cur.start = parseDate(prop, value);
    else if (name === 'RRULE') cur.rrule = Object.fromEntries(value.split(';').map((kv) => kv.split('=')));
    else if (name === 'STATUS') cur.status = value.toUpperCase();
  }
  return events.filter((e) => e.status !== 'CANCELLED' && e.start);
}

// RRULE in unsere einfache Form übersetzen, wenn möglich
function toRecurring(e) {
  const r = e.rrule;
  if (!r) return null;
  const wdFromDate = K.weekday(e.start.date);
  const until = r.UNTIL ? parseDate('', r.UNTIL)?.date : null;
  const byday = (r.BYDAY || '').split(',').filter(Boolean);
  if (byday.length > 1) return null;
  const bd = byday[0] || '';
  const m = bd.match(/^(-?\d)?([A-Z]{2})$/);
  const weekday = m ? DAYS[m[2]] : wdFromDate;
  const interval = Number(r.INTERVAL || 1);
  if (r.FREQ === 'WEEKLY' && (interval === 1 || interval === 2)) {
    return { weekday, every: interval === 2 ? '2weeks' : 'week', nth: 1, from: e.start.date, to: until };
  }
  if (r.FREQ === 'MONTHLY' && interval === 1) {
    let nth = m && m[1] ? Number(m[1]) : (r.BYSETPOS ? Number(r.BYSETPOS) : Math.ceil(K.parseIso(e.start.date).d / 7));
    if (nth < -1 || nth > 4 || nth === 0) return null;
    return { weekday, every: 'month', nth, from: e.start.date, to: until };
  }
  return null;
}

export async function importIcs() {
  const file = await pickFile('.ics,text/calendar');
  if (!file) return;
  const events = parseIcs(await file.text());
  if (!events.length) { toast('Keine Termine in der Datei gefunden', 'error'); return; }
  const plan = App.plan.obj;
  const from = K.addDays(K.today(), -31);
  const rows = [];
  for (const e of events) {
    const rec = toRecurring(e);
    if (rec) rows.push({ kind: 'rec', title: e.title, rec, text: recurringText(rec) + (e.start.time ? ` · ${e.start.time}` : '') });
    else if (e.start.date >= from) rows.push({ kind: 'single', title: e.title + (e.start.time ? ` (${e.start.time})` : ''), date: e.start.date, text: `${K.WOCHENTAGE[K.weekday(e.start.date)]} ${K.fmtDate(e.start.date, true)}${e.rrule ? ' · Wiederholung nicht übernommen' : ''}` });
  }
  rows.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'rec' ? -1 : 1) : (a.date || '').localeCompare(b.date || '')));
  if (!rows.length) { toast('Keine aktuellen Termine in der Datei', 'error'); return; }
  const r = await openModal({
    title: 'Events importieren',
    wide: true,
    body: `<p class="small muted">${rows.length} Termine gefunden (ab ${K.fmtDate(from, true)}). Auswählen, was übernommen werden soll.</p>
      <ul class="list">${rows.map((x, i) => `<li><label class="check grow"><input type="checkbox" name="i${i}" checked><span>${x.kind === 'rec' ? '↻ ' : '🎲 '}<b>${esc(x.title)}</b><small>${esc(x.text)}</small></span></label></li>`).join('')}</ul>
      <label class="check"><input type="checkbox" name="noPrint" checked><span>Wiederkehrende Events beim Drucken ausblenden</span></label>`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Importieren', kind: 'primary', value: 'ok' }],
    onAction(v, root) { return v ? formData(root) : null; },
  });
  if (!r) return;
  let n = 0;
  App.plan.update((p) => {
    const t = now();
    p.recurring = p.recurring || {};
    rows.forEach((x, i) => {
      if (!r['i' + i]) return;
      if (x.kind === 'rec') {
        const dup = Object.values(p.recurring).some((q) => alive(q) && q.title === x.title && Number(q.weekday) === x.rec.weekday && q.every === x.rec.every);
        if (dup) return;
        p.recurring['r' + randomId(6)] = { title: x.title, ...x.rec, noPrint: r.noPrint, skip: {}, updatedAt: t };
      } else {
        const day = alive(p.days[x.date]) ? p.days[x.date] : { event: '', note: '' };
        const list = (day.event || '').split(' · ').filter(Boolean);
        if (list.includes(x.title)) return;
        list.push(x.title);
        p.days[x.date] = { ...day, event: list.join(' · '), updatedAt: t };
      }
      n++;
    });
  });
  toast(`${n} Events übernommen`);
}
