// Import der alten Excel-Dienstpläne (ein Blatt pro Monat, Personen als Spalten).

import { App } from './app.js';
import { esc, openModal, toast, loadScript, formData, pickFile } from './ui.js';
import * as K from './calc.js';
import { COLORS, now } from './store.js';
import { randomId } from './crypto.js';
import { employeesSorted, shiftsSorted, entryKey } from './model.js';

const MONTH_SHEETS = { 'jänner': 1, 'januar': 1, 'februar': 2, 'märz': 3, 'april': 4, 'mai': 5, 'juni': 6, 'juli': 7, 'august': 8, 'september': 9, 'oktober': 10, 'november': 11, 'dezember': 12 };

const STATUS_WORDS = {
  'urlaub': 'Urlaub', 'u': 'Urlaub',
  'za': 'ZA', 'zeitausgleich': 'ZA',
  'frei': 'Frei',
  'krank': 'Krankenstand', 'krankenstand': 'Krankenstand',
  'ersatzfrei': 'Ersatzfrei',
  'feiertag': 'Feiertag',
};

function toIso(v) {
  if (v instanceof Date) {
    const d = new Date(v.getTime() + 12 * 3600 * 1000); // Rundungsfehler der Bibliothek ausgleichen
    return K.iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  if (typeof v === 'string') {
    const m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) return K.iso(+m[3], +m[2], +m[1]);
  }
  return null;
}

function isNum(v) { return typeof v === 'number' || (typeof v === 'string' && /^\s*\d+([.,]\d+)?\s*$/.test(v)); }

// Zellinhalt deuten
export function parseCell(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return null;
  const s = String(v).trim();
  if (!s || /^-+$/.test(s)) return null;
  const tm = s.match(/^(\d{1,2}):?(\d{2})\s*[-–]\s*(\d{1,2}):?(\d{2})$/);
  if (tm) return { kind: 'shift', start: `${K.pad(+tm[1])}:${tm[2]}`, end: `${K.pad(+tm[3])}:${tm[4]}` };
  const low = s.toLowerCase();
  if (STATUS_WORDS[low]) return { kind: 'status', status: STATUS_WORDS[low] };
  const first = low.split(/[\s/,]+/)[0];
  if (STATUS_WORDS[first] && first.length > 1) return { kind: 'status', status: STATUS_WORDS[first], note: s };
  return { kind: 'note', note: s };
}

export function parseWorkbook(XLSX, wb) {
  const emps = {};   // name -> { name, hours, firstSheet }
  const entries = []; // { date, name, rec }
  const days = {};    // date -> { event, note }
  const years = {};
  let sheetIdx = 0;
  for (const sheetName of wb.SheetNames) {
    const month = MONTH_SHEETS[sheetName.trim().toLowerCase()];
    if (!month) continue;
    sheetIdx++;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });
    if (rows.length < 3) continue;
    const r1 = rows[0] || [], r2 = rows[1] || [];
    let evCol = r2.findIndex((c) => typeof c === 'string' && /event/i.test(c));
    let noteCol = r2.findIndex((c) => typeof c === 'string' && /anmerkung/i.test(c));
    const lastPersonCol = evCol > 0 ? evCol : r1.length;
    const cols = [];
    for (let c = 2; c < lastPersonCol; c++) {
      const v = r1[c];
      if (typeof v === 'string' && v.trim() && !isNum(v) && !v.startsWith('=')) {
        const name = v.trim();
        const hv = r1[c + 1];
        if (!emps[name]) emps[name] = { name, hours: isNum(hv) ? Number(String(hv).replace(',', '.')) : null, firstSheet: sheetIdx, firstMonth: month };
        cols.push({ c, name });
      }
    }
    for (let r = 2; r < rows.length; r++) {
      const row = rows[r];
      const date = toIso(row[1]);
      if (!date) continue;
      years[K.parseIso(date).y] = (years[K.parseIso(date).y] || 0) + 1;
      for (const { c, name } of cols) {
        const rec = parseCell(row[c]);
        if (rec) entries.push({ date, name, rec, own: K.parseIso(date).m === month });
      }
      const ev = evCol >= 0 ? parseCell(row[evCol]) : null;
      const nt = noteCol >= 0 ? parseCell(row[noteCol]) : null;
      const evText = ev ? (ev.note || (ev.kind === 'shift' ? `${ev.start}-${ev.end}` : ev.status)) : '';
      const ntText = nt ? (nt.note || (nt.kind === 'shift' ? `${nt.start}-${nt.end}` : nt.status)) : '';
      if (evText || ntText) {
        const cur = days[date] || {};
        days[date] = { event: evText || cur.event || '', note: ntText || cur.note || '' };
      }
    }
  }
  const year = Object.entries(years).sort((a, b) => b[1] - a[1])[0];
  return { emps: Object.values(emps), entries, days, year: year ? +year[0] : K.parseIso(K.today()).y, years: Object.keys(years).map(Number).sort() };
}

export async function importExcel() {
  const file = await pickFile('.xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if (!file) return;
  toast('Excel wird gelesen …');
  await loadScript('vendor/xlsx.full.min.js');
  const XLSX = window.XLSX;
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const data = parseWorkbook(XLSX, wb);
  if (!data.emps.length) { toast('Keine Monatsblätter gefunden (Blattnamen wie „Jänner“, „Februar“ …)', 'error'); return; }
  await previewAndImport(data);
}

async function previewAndImport(data) {
  const plan = App.plan.obj;
  const existing = employeesSorted(plan, true);
  const byName = (n) => existing.find((e) => e.name.toLowerCase() === n.toLowerCase());
  const y = data.year;
  const inYear = data.entries.filter((x) => K.parseIso(x.date).y === y);
  const counts = {};
  inYear.forEach((x) => { counts[x.name] = (counts[x.name] || 0) + 1; });

  const r = await openModal({
    title: 'Excel importieren',
    wide: true,
    body: `
      <label class="field"><span>Jahr</span><select name="year">${data.years.map((yy) => `<option ${yy === y ? 'selected' : ''}>${yy}</option>`).join('')}</select></label>
      <p class="small muted">Gefunden: ${data.emps.length} Personen, ${inYear.length} Einträge, ${Object.keys(data.days).filter((d) => d.startsWith(y + '-')).length} Tage mit Events/Anmerkungen. Bitte Wochenstunden prüfen.</p>
      <table class="times"><thead><tr><th></th><th>Name</th><th class="num">Wochenstunden</th><th>Eintritt</th><th class="num">Einträge</th></tr></thead>
      <tbody>${data.emps.map((e, i) => {
        const ex = byName(e.name);
        const start = e.firstMonth > 1 && e.firstSheet > 1 ? K.iso(y, e.firstMonth, 1) : '';
        return `<tr><td><input type="checkbox" name="use${i}" checked aria-label="${esc(e.name)} importieren"></td>
          <td>${esc(e.name)}${ex ? ' <small>(vorhanden)</small>' : ''}</td>
          <td class="num"><input type="number" step="0.5" min="0" name="h${i}" value="${esc(ex ? ex.weeklyHours : (e.hours ?? 38.5))}" class="narrow"></td>
          <td><input type="date" name="s${i}" value="${esc(ex ? ex.startDate || '' : start)}"></td>
          <td class="num">${counts[e.name] || 0}</td></tr>`;
      }).join('')}</tbody></table>
      <label class="check"><input type="checkbox" name="overwrite"><span>Vorhandene Einträge im Plan überschreiben</span></label>
      <p class="small muted">Uhrzeiten werden als Schichten übernommen. Wörter wie „Urlaub“, „ZA“, „Krankenstand“ werden zum Status, alles andere (z. B. „Judge“) zur Notiz. Die Stunden aus der Excel werden nicht übernommen, sondern nach der Pausenregel neu berechnet.</p>`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Importieren', kind: 'primary', value: 'ok' }],
    onAction(v, root) { return v ? formData(root) : null; },
  });
  if (!r) return;
  const year = +r.year;
  const shifts = shiftsSorted(plan);
  let nEntries = 0;
  App.plan.update((p) => {
    const t = now();
    const ids = {};
    data.emps.forEach((e, i) => {
      if (!r['use' + i]) return;
      const ex = byName(e.name);
      const id = ex ? ex.id : 'm' + randomId(6);
      ids[e.name] = id;
      const old = p.employees[id] || {};
      p.employees[id] = {
        ...old,
        name: e.name,
        weeklyHours: Number(r['h' + i]) || 0,
        color: old.color || COLORS[Object.keys(p.employees).length % COLORS.length],
        startDate: r['s' + i] || old.startDate || null,
        active: old.active !== false,
        order: old.order ?? i,
        updatedAt: t,
      };
    });
    // Einträge aus dem eigenen Monatsblatt haben Vorrang vor Überlappungen am Blattrand
    const ordered = [...data.entries.filter((x) => !x.own), ...data.entries.filter((x) => x.own)];
    const written = new Set();
    for (const x of ordered) {
      if (K.parseIso(x.date).y !== year || !ids[x.name]) continue;
      const k = entryKey(x.date, ids[x.name]);
      if (!r.overwrite && !written.has(k) && p.entries[k] && !p.entries[k].deleted) continue;
      written.add(k);
      const rec = { ...x.rec, updatedAt: t };
      if (rec.kind === 'shift') {
        const sh = shifts.find((s) => s.start === rec.start && s.end === rec.end);
        if (sh) { rec.shiftId = sh.id; delete rec.start; delete rec.end; }
      }
      p.entries[k] = rec;
      nEntries++;
    }
    for (const [d, v] of Object.entries(data.days)) {
      if (K.parseIso(d).y !== year) continue;
      if (!r.overwrite && p.days[d] && !p.days[d].deleted) continue;
      p.days[d] = { ...v, updatedAt: t };
    }
  });
  toast(`${nEntries} Einträge importiert`);
}
