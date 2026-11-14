// Monatsübersicht mit Summen, Druck und Excel-Export.

import { App, registerView, isAdmin, timesOf } from '../app.js';
import { esc, act, loadScript, toast } from '../ui.js';
import * as K from '../calc.js';
import { employeesSorted, planEntry, resolve, employed, monthStats, alive, isPublished, eventsOn, coverageGaps } from '../model.js';
import { cellHtml, editEntry, diffBadge } from './plan.js';

const td = K.parseIso(K.today());
App.month = { y: td.y, m: td.m };

function render(main) {
  const plan = App.plan.obj;
  const { y, m } = App.month;
  const days = K.monthDays(y, m);
  const emps = employeesSorted(plan).filter((e) => days.some((d) => employed(e, d)));
  const admin = isAdmin();
  const meId = App.cfg.empId;
  const t = K.today();
  const stats = emps.map((e) => monthStats(plan, e, y, m, null));

  main.innerHTML = `
    <div class="toolbar">
      <div class="nav-group">
        <button class="icon-btn" data-act="month" data-d="-1" aria-label="Voriger Monat">‹</button>
        <div class="period"><b>${K.MONATE[m - 1]} ${y}</b></div>
        <button class="icon-btn" data-act="month" data-d="1" aria-label="Nächster Monat">›</button>
        <button class="btn small" data-act="month" data-d="0">Heute</button>
      </div>
      <div class="nav-group">
        <button class="btn small ghost" data-act="print">Drucken</button>
        <button class="btn small ghost" data-act="pdf" data-kind="month">PDF</button>
        ${admin ? '<button class="btn small ghost" data-act="export-xlsx">Excel</button>' : ''}
      </div>
    </div>
    <div class="table-scroll"><table class="plan month">
      <thead><tr><th class="sticky">Tag</th>${emps.map((e) => `<th class="${e.id === meId ? 'me' : ''}"><span class="dot" style="background:${e.color}"></span>${esc(e.name)}</th>`).join('')}<th>Event / Anmerkung</th></tr></thead>
      <tbody>${days.map((d) => {
        const wd = K.weekday(d);
        const hol = K.holidayName(d, plan.settings);
        const day = alive(plan.days[d]) ? plan.days[d] : {};
        return `<tr class="${isPublished(plan, d) ? '' : 'draft'} ${wd === 6 ? 'sun' : ''} ${wd === 5 ? 'sat' : ''} ${hol ? 'holiday' : ''} ${d === t ? 'today' : ''}">
          <th class="sticky"><b>${K.WOCHENTAGE[wd]}</b> ${K.fmtDate(d)}${isPublished(plan, d) ? '' : ' <span class="draft-tag">Entwurf</span>'}${admin && coverageGaps(plan, d).length ? ` <span class="gap" title="fehlt: ${coverageGaps(plan, d).join(', ')}">⚠ ${coverageGaps(plan, d).map((x) => x[0]).join('')}</span>` : ''}</th>
          ${emps.map((e) => {
            if (!employed(e, d)) return '<td class="off"></td>';
            if (!admin && !isPublished(plan, d)) return '<td class="muted">–</td>';
            const pe = planEntry(plan, d, e.id);
            return `<td class="${e.id === meId ? 'me' : ''} ${admin ? 'clickable' : ''}" ${admin ? `data-act="edit-entry-m" data-d="${d}" data-e="${e.id}"` : ''}>${cellHtml(resolve(plan, pe, e, d), pe, { compact: true })}</td>`;
          }).join('')}
          <td class="ev ${admin ? 'clickable' : ''}" ${admin ? `data-act="edit-day" data-d="${d}"` : ''}>${[hol && esc(hol), ...eventsOn(plan, d).map((e) => `<span class="${e.noPrint ? 'noprint' : ''}">${e.recurring ? '↻' : '🎲'} ${esc(e.title)}</span>`), day.note && esc(day.note)].filter(Boolean).join(' · ')}</td>
        </tr>`;
      }).join('')}</tbody>
      <tfoot>
        <tr><th class="sticky">Soll</th>${stats.map((s) => `<td>${K.fmtH(s.soll)} h</td>`).join('')}<td></td></tr>
        <tr><th class="sticky">Geplant</th>${stats.map((s) => `<td><b>${K.fmtH(s.planH + s.creditH)} h</b>${diffBadge(s.planH + s.creditH - s.soll)}</td>`).join('')}<td></td></tr>
        <tr><th class="sticky">Urlaub / Krank</th>${stats.map((s) => `<td>${s.urlaubTage} / ${s.krankTage} T</td>`).join('')}<td></td></tr>
      </tfoot>
    </table></div>
    <p class="hint">Geplant = Arbeitszeit laut Plan plus angerechnete Stunden für Urlaub, ZA, Krankenstand und Ersatzfrei (ZA wird dabei vom Zeitkonto abgezogen). Die tatsächlich erfassten Zeiten stehen unter „Zeiten“.</p>`;
}

act('month', ({ d }) => {
  if (+d === 0) { const x = K.parseIso(K.today()); App.month = { y: x.y, m: x.m }; }
  else {
    let { y, m } = App.month; m += +d;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    App.month = { y, m };
  }
  render(document.getElementById('main'));
});

act('edit-entry-m', ({ d, e }) => editEntry(d, e));

// ---------- Excel-Export (ein Blatt Plan, ein Blatt Zeiten) ----------

act('export-xlsx', async () => {
  await loadScript('vendor/xlsx.full.min.js');
  const XLSX = window.XLSX;
  const plan = App.plan.obj;
  const { y, m } = App.month;
  const days = K.monthDays(y, m);
  const emps = employeesSorted(plan).filter((e) => days.some((d) => employed(e, d)));
  const rows = [['Tag', 'Datum', ...emps.flatMap((e) => [e.name, 'h']), 'Event', 'Anmerkung']];
  for (const d of days) {
    const day = alive(plan.days[d]) ? plan.days[d] : {};
    const row = [K.WOCHENTAGE[K.weekday(d)], K.fmtDate(d, true)];
    for (const e of emps) {
      const r = employed(e, d) ? resolve(plan, planEntry(plan, d, e.id), e, d) : null;
      row.push(r ? (r.type === 'shift' ? `${r.start} - ${r.end}` : r.text) + (r.note && r.type !== 'note' ? ` (${r.note})` : '') : '');
      row.push(r && (r.workH || r.creditH) ? Math.round((r.workH + r.creditH) * 100) / 100 : '');
    }
    row.push([K.holidayName(d, plan.settings), ...eventsOn(plan, d).filter((e) => !e.noPrint).map((e) => e.title)].filter(Boolean).join(' · '), day.note || '');
    rows.push(row);
  }
  const st = emps.map((e) => monthStats(plan, e, y, m, timesOf(e.id)));
  rows.push([]);
  rows.push(['', 'Soll', ...st.flatMap((s) => ['', Math.round(s.soll * 100) / 100])]);
  rows.push(['', 'Geplant', ...st.flatMap((s) => ['', Math.round((s.planH + s.creditH) * 100) / 100])]);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 4 }, { wch: 11 }, ...emps.flatMap(() => [{ wch: 14 }, { wch: 5 }]), { wch: 24 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, ws, `${K.MONATE[m - 1]} ${y}`);

  // Erfasste Zeiten (nur wenn lesbar)
  const trows = [['Datum', 'Person', 'Geplant', 'Erfasst Beginn', 'Erfasst Ende', 'Pause min', 'Erfasst h', 'Geplant h', 'Differenz']];
  emps.forEach((e, i) => {
    for (const t of st[i].tage) {
      if (!t.tr && !t.pr) continue;
      trows.push([K.fmtDate(t.date, true), e.name, t.pr ? t.pr.text : '', t.tr ? t.tr.start || '' : '', t.tr ? t.tr.end || '' : '', t.tr ? t.tr.pause ?? '' : '',
        t.tr ? Math.round(t.tr.workH * 100) / 100 : '', t.pr ? Math.round(t.pr.workH * 100) / 100 : '', t.tr && t.pr ? Math.round((t.tr.workH - t.pr.workH) * 100) / 100 : '']);
    }
  });
  if (trows.length > 1) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(trows), 'Zeiten');
  XLSX.writeFile(wb, `Dienstplan_${y}-${K.pad(m)}.xlsx`);
  toast('Excel-Datei erstellt');
});

registerView('month', { title: 'Monat', icon: '🗓️', roles: ['admin', 'employee'], render });
