// PDF-Berichte: Urlaub pro Monat (alle), Urlaubs-Jahresübersicht pro Person, Zeiterfassung pro Person und Monat.
// Mehrseitig erlaubt (anders als der Dienstplan-PDF, der immer auf eine Seite passt).

import { App, isAdmin, timesOf } from './app.js';
import { act, openModal, toast, loadScript, formData, esc } from './ui.js';
import * as K from './calc.js';
import { employeesSorted, tracked, planEntry, resolve, employed, isWorkDay, monthStats, vacationAccount, saldoDetail, countedUntil, alive } from './model.js';

const clean = (s) => String(s ?? '').replace(/[^\u0000-ɏ–—‘-„€]/g, '').replace(/\s+/g, ' ').trim();
const H = (h) => K.fmtH(h).replace('−', '-');
const sgn = (h) => (h > 0.004 ? '+' : '') + H(h);

async function jsPdf() {
  await loadScript('vendor/jspdf.umd.min.js');
  await loadScript('vendor/jspdf.plugin.autotable.min.js');
  return window.jspdf.jsPDF;
}

// pages: [{ title, sub, blocks: [{ heading?, head, body, foot? , widths? }] }]
async function report(file, pages, orientation = 'portrait') {
  const jsPDF = await jsPdf();
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const m = 12;
  const W = doc.internal.pageSize.getWidth();
  const firma = clean(App.plan.obj.settings.firma || '');
  const stamp = new Date().toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' });
  pages.forEach((pg, i) => {
    if (i) doc.addPage();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(0);
    doc.text(clean(pg.title), m, m + 4);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`${firma}${firma ? ' · ' : ''}erstellt ${stamp}`, W - m, m + 4, { align: 'right' });
    let y = m + 9;
    if (pg.sub) { doc.setFontSize(9.5); doc.setTextColor(60); const lines = doc.splitTextToSize(clean(pg.sub), W - 2 * m); doc.text(lines, m, y + 2); y += lines.length * 4.5 + 2; }
    doc.setTextColor(0);
    for (const b of pg.blocks) {
      if (b.heading) { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(clean(b.heading), m, y + 5); y += 7; doc.setFont('helvetica', 'normal'); }
      doc.autoTable({
        head: [b.head], body: b.body.map((r) => r.map((c) => (typeof c === 'object' && c ? c : { content: clean(c) }))), foot: b.foot ? [b.foot] : undefined,
        startY: y + 1, margin: { left: m, right: m, top: m, bottom: m },
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.4, lineColor: [180, 180, 180], lineWidth: 0.1, valign: 'top', textColor: [20, 20, 20] },
        headStyles: { fillColor: [29, 92, 140], textColor: 255, fontStyle: 'bold' },
        footStyles: { fillColor: [238, 240, 243], textColor: 20, fontStyle: 'bold' },
        columnStyles: b.columnStyles || {},
        showFoot: 'lastPage',
      });
      y = doc.lastAutoTable.finalY + 6;
    }
  });
  // Seitenzahlen
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120); doc.text(`Seite ${i} von ${n}`, W - m, doc.internal.pageSize.getHeight() - 5, { align: 'right' }); }
  doc.save(file);
  toast('PDF gespeichert: ' + file);
}

// ---------- Urlaub ----------

// Urlaubstage einer Person in [from, to] (wie im Urlaubskonto: nur Arbeitstage, keine Feiertage)
function vacDays(plan, e, from, to, status = 'Urlaub') {
  const out = [];
  for (let d = from; d <= to; d = K.addDays(d, 1)) {
    const pe = planEntry(plan, d, e.id);
    if (!pe || pe.kind !== 'status' || pe.status !== status || pe.source === 'feiertag') continue;
    if (!employed(e, d)) continue;
    out.push(d);
  }
  return out;
}
const countable = (plan, e, days) => days.filter((d) => !K.holidayName(d, plan.settings) && isWorkDay(e, d)).length;

function ranges(days) {
  const out = [];
  let a = null, p = null;
  for (const d of days) {
    if (p && K.dayNum(d) - K.dayNum(p) <= 2) { p = d; continue; }
    if (a) out.push([a, p]);
    a = d; p = d;
  }
  if (a) out.push([a, p]);
  return out.map(([x, z]) => (x === z ? K.fmtDate(x) : `${K.fmtDate(x)}–${K.fmtDate(z)}`)).join(', ');
}

const T = (x) => K.fmtNum(Math.round(x * 100) / 100);

function vacMonthPage(plan, y, m) {
  const from = K.iso(y, m, 1), to = K.iso(y, m, K.daysInMonth(y, m));
  const emps = employeesSorted(plan).filter(tracked).filter((e) => employed(e, from) || employed(e, to));
  let sum = 0;
  const body = emps.map((e) => {
    const days = vacDays(plan, e, from, to);
    const n = countable(plan, e, days);
    sum += n;
    const acc = vacationAccount(plan, e, to);
    return [e.name, { content: n ? T(n) : '–', styles: { halign: 'right' } }, ranges(days) || '–', { content: to < acc.from ? '–' : T(acc.standT), styles: { halign: 'right' } }];
  });
  return {
    title: `Verbrauchter Urlaub ${K.MONATE[m - 1]} ${y}`,
    sub: 'Gezählt werden Urlaubstage an Arbeitstagen der Person, ohne Feiertage. „Stand Monatsende“ = Urlaubsanspruch am letzten Tag des Monats nach Abzug der genommenen Tage.',
    blocks: [{ head: ['Mitarbeiter', 'Urlaubstage', 'Zeitraum', 'Stand Monatsende'], body, foot: ['Summe', { content: T(sum), styles: { halign: 'right' } }, '', ''], columnStyles: { 0: { cellWidth: 38 }, 1: { cellWidth: 24 }, 3: { cellWidth: 30 } } }],
  };
}

function vacYearPage(plan, e, y) {
  const end = `${y}-12-31` < K.today() ? `${y}-12-31` : K.today();
  const acc = vacationAccount(plan, e, end);
  const rows = [];
  let su = 0, sz = 0, sk = 0;
  for (let m = 1; m <= 12; m++) {
    const from = K.iso(y, m, 1), to = K.iso(y, m, K.daysInMonth(y, m));
    const u = vacDays(plan, e, from, to), z = vacDays(plan, e, from, to, 'ZA'), k = vacDays(plan, e, from, to, 'Krankenstand');
    const nu = countable(plan, e, u);
    su += nu; sz += z.length; sk += k.length;
    rows.push([K.MONATE[m - 1], { content: nu ? T(nu) : '–', styles: { halign: 'right' } }, ranges(u) || '', { content: z.length ? String(z.length) : '–', styles: { halign: 'right' } }, { content: k.length ? String(k.length) : '–', styles: { halign: 'right' } }]);
  }
  return {
    title: `Urlaub ${y}: ${e.name}`,
    sub: `Urlaubsjahr ${K.fmtDate(acc.ujFrom, true)} – ${K.fmtDate(acc.ujTo, true)} · Anspruch ${T(acc.jahrT)} Tage pro Jahr (${T(acc.monatT)} pro Monat) · Stand am ${K.fmtDate(end, true)}: ${T(acc.standT)} Tage · danach geplant: ${T(acc.geplantT)} · Rest: ${T(acc.restT)} Tage`,
    blocks: [{ head: ['Monat', 'Urlaub (Tage)', 'Zeitraum', 'Zeitausgleich', 'Krankenstand'], body: rows, foot: ['Summe', { content: T(su), styles: { halign: 'right' } }, '', { content: String(sz), styles: { halign: 'right' } }, { content: String(sk), styles: { halign: 'right' } }], columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 24 }, 3: { cellWidth: 26 }, 4: { cellWidth: 26 } } }],
  };
}

act('vac-pdf', async () => {
  if (!isAdmin()) return;
  const plan = App.plan.obj;
  const y = App.vyear;
  const now = K.parseIso(K.today());
  const defM = y === now.y ? now.m : 12;
  const emps = employeesSorted(plan).filter(tracked);
  const r = await openModal({
    title: `Urlaub ${y} als PDF`,
    body: `<div class="seg"><label><input type="radio" name="k" value="month" checked><span>Verbrauch pro Monat (alle)</span></label><label><input type="radio" name="k" value="year"><span>Jahresübersicht pro Person</span></label></div>
      <label class="field" data-k="month"><span>Monat</span><select name="m">${K.MONATE.map((n, i) => `<option value="${i + 1}" ${i + 1 === defM ? 'selected' : ''}>${n} ${y}</option>`).join('')}<option value="all">Alle Monate ${y} (eine Seite pro Monat)</option></select></label>
      <label class="field" data-k="year" hidden><span>Mitarbeiter</span><select name="e"><option value="all">Alle (eine Seite pro Person)</option>${emps.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></label>`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'PDF erstellen', kind: 'primary', value: 'ok' }],
    onOpen(root) { root.addEventListener('change', () => { const k = formData(root).k; root.querySelectorAll('[data-k]').forEach((el) => { el.hidden = el.dataset.k !== k; }); }); },
    onAction(v, root) { return v ? formData(root) : null; },
  });
  if (!r) return;
  toast('PDF wird erstellt …');
  if (r.k === 'month') {
    const months = r.m === 'all' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [Number(r.m)];
    await report(r.m === 'all' ? `Urlaub-${y}-Monate.pdf` : `Urlaub-${y}-${K.pad(months[0])}.pdf`, months.map((m) => vacMonthPage(plan, y, m)));
  } else {
    const list = r.e === 'all' ? emps : emps.filter((e) => e.id === r.e);
    await report(r.e === 'all' ? `Urlaub-${y}-alle.pdf` : `Urlaub-${y}-${clean(list[0].name)}.pdf`, list.map((e) => vacYearPage(plan, e, y)));
  }
});

// ---------- Zeiterfassung ----------

function timesPage(plan, e, y, m) {
  const times = timesOf(e.id);
  const monthEnd = K.iso(y, m, K.daysInMonth(y, m));
  const cu = countedUntil(plan, e, times);
  const until = monthEnd < cu ? monthEnd : cu; // laufender Monat: nur bis gestern (bzw. heute nach Dienstende)
  const st = monthStats(plan, e, y, m, times, until);
  const rows = [];
  for (const x of st.tage) {
    const wd = K.weekday(x.date);
    if (!x.pr && !x.tr && !x.soll && wd === 6) continue;
    const pl = x.pr ? (x.pr.type === 'shift' ? `${x.pr.text} (${H(x.pr.workH)})` : x.pr.text) : '';
    const rec = times && alive(times[x.date]) ? times[x.date] : null;
    const er = x.tr ? (x.tr.type === 'shift' ? `${x.tr.text}, ${x.tr.pause} min Pause` : x.tr.text) : (x.pr && x.pr.type === 'shift' ? (times ? 'nicht erfasst' : 'wie geplant') : '');
    const h = x.ist + x.credit;
    const d = h - x.za - x.soll + x.bonus;
    rows.push([
      { content: `${K.WOCHENTAGE[wd]} ${K.fmtDate(x.date)}`, styles: wd >= 5 ? { fillColor: [246, 246, 240] } : {} },
      pl, er + (rec && rec.note ? ` – ${clean(rec.note)}` : ''),
      { content: H(x.soll), styles: { halign: 'right' } },
      { content: h ? H(h) : '–', styles: { halign: 'right' } },
      { content: x.za ? '-' + H(x.za) : '', styles: { halign: 'right' } },
      { content: x.bonus ? '+' + H(x.bonus) : '', styles: { halign: 'right' } },
      { content: Math.abs(d) > 0.004 ? sgn(d) : '', styles: { halign: 'right' } },
    ]);
  }
  const sd = saldoDetail(plan, e, until, times);
  const tot = st.istH + st.creditH;
  const zaSum = st.tage.reduce((a, t) => a + t.za, 0);
  return {
    title: `Zeiterfassung ${K.MONATE[m - 1]} ${y}: ${e.name}${until < monthEnd ? ` (bis ${K.fmtDate(until)})` : ''}`,
    sub: `${H(Number(e.weeklyHours) || 0)} h/Woche${times ? '' : ' · Hinweis: erfasste Zeiten auf diesem Gerät nicht lesbar, es zählen die geplanten Zeiten'} · Ist = gearbeitet plus Feiertag/Urlaub/Krankenstand/Zeitausgleich. Zuschlag ab ${plan.settings.nightFrom || '21:00'} (Faktor ${K.fmtNum(Number(plan.settings.nightFactor ?? 1.5))}).`,
    blocks: [
      { head: ['Tag', 'Geplant', 'Erfasst', 'Soll', 'Ist', 'ZA', 'Zuschl.', '±'], body: rows,
        foot: ['Summe', '', '', { content: H(st.soll), styles: { halign: 'right' } }, { content: H(tot), styles: { halign: 'right' } }, { content: zaSum ? '-' + H(zaSum) : '', styles: { halign: 'right' } }, { content: st.bonusH ? '+' + H(st.bonusH) : '', styles: { halign: 'right' } }, { content: sgn(st.saldo), styles: { halign: 'right' } }],
        columnStyles: { 0: { cellWidth: 20 }, 3: { cellWidth: 13 }, 4: { cellWidth: 13 }, 5: { cellWidth: 12 }, 6: { cellWidth: 14 }, 7: { cellWidth: 14 } } },
      { head: ['Zeitkonto', ''], body: [
        ['Saldo dieser Monat', { content: `${sgn(st.saldo)} h`, styles: { halign: 'right' } }],
        ...(sd.startH ? [['Alte Überstunden (Übertrag)', { content: `${sgn(sd.startH)} h`, styles: { halign: 'right' } }]] : []),
        [`Zeitkonto gesamt am ${K.fmtDate(until, true)} (gerechnet ab ${K.fmtDate(sd.from, true)})`, { content: `${sgn(sd.saldo)} h`, styles: { halign: 'right', fontStyle: 'bold' } }],
      ], columnStyles: { 1: { cellWidth: 30 } } },
      { head: ['Bestätigung', ''], body: [['Mitarbeiter (Datum, Unterschrift)', ''], ['Arbeitgeber (Datum, Unterschrift)', '']], columnStyles: { 0: { cellWidth: 70 }, 1: { minCellHeight: 12 } } },
    ],
  };
}

act('times-pdf', async () => {
  const plan = App.plan.obj;
  const { y, m } = App.tmonth;
  const admin = isAdmin();
  const emps = admin ? employeesSorted(plan).filter(tracked) : [{ id: App.cfg.empId, ...plan.employees[App.cfg.empId] }];
  const cur = admin ? (App.tEmp || (emps[0] && emps[0].id)) : App.cfg.empId;
  let list = emps.filter((e) => e.id === cur);
  if (admin) {
    const r = await openModal({
      title: `Zeiterfassung ${K.MONATE[m - 1]} ${y} als PDF`,
      body: `<label class="field"><span>Mitarbeiter</span><select name="e">${emps.map((e) => `<option value="${e.id}" ${e.id === cur ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}<option value="all">Alle (eine Seite pro Person)</option></select></label>`,
      buttons: [{ label: 'Abbrechen', value: null }, { label: 'PDF erstellen', kind: 'primary', value: 'ok' }],
      onAction(v, root) { return v ? formData(root).e : null; },
    });
    if (!r) return;
    list = r === 'all' ? emps : emps.filter((e) => e.id === r);
  }
  if (!list.length) return;
  toast('PDF wird erstellt …');
  await report(list.length > 1 ? `Zeiten-${y}-${K.pad(m)}-alle.pdf` : `Zeiten-${y}-${K.pad(m)}-${clean(list[0].name)}.pdf`, list.map((e) => timesPage(plan, e, y, m)));
});
