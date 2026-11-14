// PDF direkt in der App erzeugen (ohne Druckdialog), immer auf eine A4-Seite.

import { App, isAdmin } from './app.js';
import { act, openModal, toast, loadScript, formData } from './ui.js';
import * as K from './calc.js';
import { employeesSorted, planEntry, resolve, employed, sollDay, monthStats, alive, isPublished, eventsOn } from './model.js';
import { LS } from './storage.js';

// Standardschrift kennt keine Emojis: nur druckbare Zeichen behalten
const clean = (s) => String(s ?? '').replace(/[^\u0000-ɏ–—‘-„€]/g, '').replace(/\s+/g, ' ').trim();

const STATUS_FILL = { Urlaub: [214, 240, 222], ZA: [250, 236, 204], Krankenstand: [246, 214, 210], Ersatzfrei: [229, 221, 243], Feiertag: [220, 228, 243], Frei: [236, 238, 240] };

function hexRgb(h) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

function cellFor(plan, d, e) {
  if (!employed(e, d)) return { text: '' };
  if (!isAdmin() && !isPublished(plan, d)) return { text: '–' };
  const r = resolve(plan, planEntry(plan, d, e.id), e, d);
  if (!r) return { text: '' };
  const note = r.note && r.type !== 'note' ? `\n${clean(r.note)}` : '';
  if (r.type === 'shift') return { text: `${r.start}–${r.end}${note}`, fill: hexRgb(r.color) };
  if (r.type === 'status') return { text: r.status + note, fill: STATUS_FILL[r.status] };
  return { text: clean(r.text), italic: true };
}

function eventText(plan, d) {
  return eventsOn(plan, d).filter((e) => !e.noPrint).map((e) => clean(e.title)).join(', ');
}

function buildWeek(plan) {
  const mon = App.week;
  const emps = employeesSorted(plan).filter((e) => [0, 1, 2, 3, 4, 5, 6].some((i) => employed(e, K.addDays(mon, i))));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = K.addDays(mon, i);
    if (i === 6 && !emps.some((e) => { const pe = planEntry(plan, d, e.id); return pe && pe.source === 'plan' && !(pe.kind === 'status' && pe.status === 'Frei'); }) && !eventText(plan, d)) continue;
    days.push(d);
  }
  const head = ['Tag', ...emps.map((e) => clean(e.name)), 'Events im Shop', 'Anmerkung'];
  const body = days.map((d) => {
    const hol = K.holidayName(d, plan.settings);
    const day = alive(plan.days[d]) ? plan.days[d] : {};
    return [
      { text: `${K.WOCHENTAGE[K.weekday(d)]} ${K.fmtDate(d)}${hol ? '\n' + clean(hol) : ''}`, bold: true },
      ...emps.map((e) => cellFor(plan, d, e)),
      { text: eventText(plan, d) },
      { text: clean(day.note) },
    ];
  });
  const foot = ['Stunden', ...emps.map((e) => {
    let h = 0, soll = 0;
    for (let i = 0; i < 7; i++) {
      const d = K.addDays(mon, i);
      soll += sollDay(e, d, plan.settings);
      if (!isAdmin() && !isPublished(plan, d)) continue;
      const r = resolve(plan, planEntry(plan, d, e.id), e, d);
      if (r) h += r.workH + r.creditH;
    }
    return e.noTimes ? `${K.fmtH(h)}` : `${K.fmtH(h)} / ${K.fmtH(soll)}`;
  }), '', ''];
  return {
    title: `Dienstplan KW ${K.isoWeek(mon)} · ${K.fmtDate(mon)}–${K.fmtDate(K.addDays(mon, 6), true)}`,
    file: `Dienstplan_KW${K.pad(K.isoWeek(mon))}_${K.parseIso(mon).y}.pdf`,
    head, body, foot: [foot], nEmp: emps.length,
  };
}

function buildMonth(plan) {
  const { y, m } = App.month;
  const days = K.monthDays(y, m);
  const emps = employeesSorted(plan).filter((e) => days.some((d) => employed(e, d)));
  const head = ['Tag', ...emps.map((e) => clean(e.name)), 'Event / Anmerkung'];
  const body = days.map((d) => {
    const hol = K.holidayName(d, plan.settings);
    const day = alive(plan.days[d]) ? plan.days[d] : {};
    const wd = K.weekday(d);
    return [
      { text: `${K.WOCHENTAGE[wd]} ${K.fmtDate(d)}`, bold: true, fill: wd === 6 ? [238, 240, 243] : null },
      ...emps.map((e) => cellFor(plan, d, e)),
      { text: [hol && clean(hol), eventText(plan, d), clean(day.note)].filter(Boolean).join(' · ') },
    ];
  });
  const stats = emps.map((e) => monthStats(plan, e, y, m, null));
  const foot = [
    ['Soll', ...stats.map((s, i) => (emps[i].noTimes ? '–' : `${K.fmtH(s.soll)} h`)), ''],
    ['Geplant', ...stats.map((s) => `${K.fmtH(s.planH + s.creditH)} h`), ''],
  ];
  return { title: `Dienstplan ${K.MONATE[m - 1]} ${y}`, file: `Dienstplan_${y}-${K.pad(m)}.pdf`, head, body, foot, nEmp: emps.length };
}

function render(jsPDF, data, orientation, fontSize) {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const margin = 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize + 4);
  doc.text(clean(data.title), margin, margin + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(Math.max(6, fontSize - 2));
  doc.setTextColor(120);
  doc.text(`${clean(App.plan.obj.settings.firma || '')} · erstellt ${new Date().toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}`, doc.internal.pageSize.getWidth() - margin, margin + 4, { align: 'right' });
  doc.setTextColor(0);
  const bodyRows = data.body.map((row) => row.map((c) => ({
    content: c.text,
    styles: { ...(c.fill ? { fillColor: c.fill } : {}), ...(c.bold ? { fontStyle: 'bold' } : {}), ...(c.italic ? { fontStyle: 'italic' } : {}) },
  })));
  const evIdx = data.head.length - (data.head[data.head.length - 1] === 'Anmerkung' ? 2 : 1);
  const columnStyles = {};
  columnStyles[0] = { cellWidth: 'wrap' };
  for (let i = evIdx; i < data.head.length; i++) columnStyles[i] = { cellWidth: 'auto', overflow: 'linebreak' };
  doc.autoTable({
    head: [data.head],
    body: bodyRows,
    foot: data.foot,
    startY: margin + 8,
    margin: { left: margin, right: margin, top: margin, bottom: margin },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize, cellPadding: Math.max(0.6, fontSize / 7), lineColor: [170, 170, 170], lineWidth: 0.1, valign: 'top', textColor: [20, 20, 20] },
    headStyles: { fillColor: [29, 92, 140], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [238, 240, 243], textColor: 20, fontStyle: 'bold' },
    columnStyles,
    showHead: 'firstPage',
    showFoot: 'lastPage',
  });
  return doc;
}

export async function makePdf(kind, orientation) {
  await loadScript('vendor/jspdf.umd.min.js');
  await loadScript('vendor/jspdf.plugin.autotable.min.js');
  const { jsPDF } = window.jspdf;
  const plan = App.plan.obj;
  const data = kind === 'month' ? buildMonth(plan) : buildWeek(plan);
  // größte Schrift wählen, bei der alles auf eine Seite passt
  let doc = null;
  for (let fs = 10; fs >= 4; fs -= 0.5) {
    doc = render(jsPDF, data, orientation, fs);
    if (doc.getNumberOfPages() === 1) break;
  }
  return { doc, file: data.file };
}

export async function pdfDialog(kind) {
  const cur = LS.get('dp.print') || 'landscape';
  const r = await openModal({
    title: 'Als PDF speichern',
    body: `<div class="seg"><label><input type="radio" name="o" value="landscape" ${cur === 'landscape' ? 'checked' : ''}><span>Querformat</span></label><label><input type="radio" name="o" value="portrait" ${cur === 'portrait' ? 'checked' : ''}><span>Hochformat</span></label></div>
      <p class="small muted">Die PDF-Datei passt immer auf eine A4-Seite und lässt sich am Handy teilen oder drucken. Wiederkehrende Events mit „nicht drucken“ fehlen darin.</p>`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'PDF erstellen', kind: 'primary', value: 'ok' }],
    onAction(v, root) { return v ? formData(root).o : null; },
  });
  if (!r) return;
  LS.set('dp.print', r);
  toast('PDF wird erstellt …');
  const { doc, file } = await makePdf(kind, r);
  doc.save(file);
  toast('PDF gespeichert: ' + file);
}

act('pdf', ({ kind }) => pdfDialog(kind));
