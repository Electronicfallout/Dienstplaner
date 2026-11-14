// Wochenansicht des Dienstplans (Planer bearbeitet, Mitarbeiter sehen).

import { App, registerView, isAdmin, timesOf } from '../app.js';
import { esc, act, openModal, toast, formData, confirmBox } from '../ui.js';
import * as K from '../calc.js';
import { employeesSorted, shiftsSorted, planEntry, resolve, entryKey, sollDay, employed, alive } from '../model.js';
import { now } from '../store.js';
import { LS } from '../storage.js';

App.week = K.mondayOf(K.today());

export function cellHtml(r, pe, { compact = false } = {}) {
  if (!r) return '<span class="empty">·</span>';
  const tpl = pe && pe.source !== 'plan' ? ' from-tpl' : '';
  if (r.type === 'shift') {
    return `<span class="cell-shift${tpl}"><b>${esc(r.start)}–${esc(r.end)}</b>${compact ? '' : `<small>${K.fmtH(r.workH)} h${r.label ? ' · ' + esc(r.label) : ''}</small>`}${r.note ? `<small class="note">${esc(r.note)}</small>` : ''}</span>`;
  }
  if (r.type === 'status') {
    const st = K.STATUS[r.status] || {};
    return `<span class="chip${tpl}" style="--c:${st.farbe || '#888'}">${esc(compact ? (st.kurz || r.status) : r.status)}</span>${r.note && !compact ? `<small class="note">${esc(r.note)}</small>` : ''}`;
  }
  return `<span class="cell-note">${esc(r.text)}</span>`;
}

function weekDays(mon, plan, emps) {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = K.addDays(mon, i);
    if (i === 6) {
      const any = emps.some((e) => { const pe = planEntry(plan, d, e.id); return pe && pe.source === 'plan' && !(pe.kind === 'status' && pe.status === 'Frei'); });
      const day = plan.days[d];
      if (!any && !(alive(day) && (day.event || day.note))) continue;
    }
    out.push(d);
  }
  return out;
}

function render(main) {
  const plan = App.plan.obj;
  const emps = employeesSorted(plan).filter((e) => {
    // nur Personen, die in dieser Woche beschäftigt sind
    for (let i = 0; i < 7; i++) if (employed(e, K.addDays(App.week, i))) return true;
    return false;
  });
  const mon = App.week;
  const days = weekDays(mon, plan, emps);
  const admin = isAdmin();
  const meId = App.cfg.empId;
  const layout = LS.get('dp.layout') || (window.innerWidth < 760 ? 'list' : 'table');
  const t = K.today();

  const toolbar = `
    <div class="toolbar">
      <div class="nav-group">
        <button class="icon-btn" data-act="week" data-d="-7" aria-label="Vorige Woche">‹</button>
        <div class="period"><b>KW ${K.isoWeek(mon)}</b><span>${K.fmtDate(mon)} – ${K.fmtDate(K.addDays(mon, 6), true)}</span></div>
        <button class="icon-btn" data-act="week" data-d="7" aria-label="Nächste Woche">›</button>
        <button class="btn small" data-act="week" data-d="0">Heute</button>
      </div>
      <div class="nav-group">
        <button class="btn small ghost" data-act="layout" data-l="${layout === 'table' ? 'list' : 'table'}">${layout === 'table' ? 'Liste' : 'Tabelle'}</button>
        ${admin ? '<button class="btn small ghost" data-act="copy-week">Vorwoche übernehmen</button>' : ''}
        <button class="btn small ghost" data-act="print">Drucken</button>
      </div>
    </div>`;

  if (!emps.length) {
    main.innerHTML = toolbar + `<div class="empty-state"><p>Noch keine Mitarbeiter.</p>${admin ? '<button class="btn primary" data-act="nav" data-view="settings">Mitarbeiter anlegen</button>' : ''}</div>`;
    return;
  }

  const dayHead = (d) => {
    const hol = K.holidayName(d, plan.settings);
    const day = plan.days[d];
    const ev = alive(day) ? day : {};
    return `<div class="dayhead ${d === t ? 'today' : ''}">
      <b>${K.WOCHENTAGE[K.weekday(d)]} ${K.fmtDate(d)}</b>
      ${hol ? `<span class="hol">${esc(hol)}</span>` : ''}
      ${ev.event ? `<span class="event">🎲 ${esc(ev.event)}</span>` : ''}
      ${ev.note ? `<span class="daynote">${esc(ev.note)}</span>` : ''}
    </div>`;
  };

  // Wochensummen
  const sums = emps.map((e) => {
    let h = 0, soll = 0, credit = 0;
    for (let i = 0; i < 7; i++) {
      const d = K.addDays(mon, i);
      const r = resolve(plan, planEntry(plan, d, e.id), e, d);
      if (r) { h += r.workH; credit += r.creditH; }
      soll += sollDay(e, d, plan.settings);
    }
    return { h, soll, credit };
  });

  let body;
  if (layout === 'table') {
    body = `<div class="table-scroll"><table class="plan">
      <thead><tr><th class="sticky">Tag</th>${emps.map((e) => `<th class="${e.id === meId ? 'me' : ''}"><span class="dot" style="background:${e.color}"></span>${esc(e.name)}<small>${K.fmtH(e.weeklyHours)} h</small></th>`).join('')}</tr></thead>
      <tbody>${days.map((d) => `<tr class="${K.weekday(d) === 5 ? 'sat' : ''}">
        <th class="sticky ${admin ? 'clickable' : ''}" ${admin ? `data-act="edit-day" data-d="${d}"` : ''}>${dayHead(d)}</th>
        ${emps.map((e) => {
          if (!employed(e, d)) return '<td class="off"></td>';
          const pe = planEntry(plan, d, e.id);
          const r = resolve(plan, pe, e, d);
          return `<td class="${e.id === meId ? 'me' : ''} ${admin ? 'clickable' : ''}" ${admin ? `data-act="edit-entry" data-d="${d}" data-e="${e.id}"` : ''}>${cellHtml(r, pe)}</td>`;
        }).join('')}
      </tr>`).join('')}</tbody>
      <tfoot><tr><th class="sticky">Woche</th>${sums.map((s, i) => `<td class="${emps[i].id === meId ? 'me' : ''}"><b>${K.fmtH(s.h + s.credit)}</b> / ${K.fmtH(s.soll)} h${diffBadge(s.h + s.credit - s.soll)}</td>`).join('')}</tr></tfoot>
    </table></div>`;
  } else {
    body = `<div class="day-list">${days.map((d) => `
      <section class="day-card ${d === t ? 'today' : ''}">
        <div class="${admin ? 'clickable' : ''}" ${admin ? `data-act="edit-day" data-d="${d}"` : ''}>${dayHead(d)}</div>
        <ul>${emps.filter((e) => employed(e, d)).map((e) => {
          const pe = planEntry(plan, d, e.id);
          const r = resolve(plan, pe, e, d);
          return `<li class="${e.id === meId ? 'me' : ''} ${admin ? 'clickable' : ''}" ${admin ? `data-act="edit-entry" data-d="${d}" data-e="${e.id}"` : ''}>
            <span class="who"><span class="dot" style="background:${e.color}"></span>${esc(e.name)}</span>
            <span class="what">${cellHtml(r, pe)}</span></li>`;
        }).join('')}</ul>
      </section>`).join('')}
      <section class="day-card sums"><div class="dayhead"><b>Stunden diese Woche</b></div>
        <ul>${emps.map((e, i) => `<li class="${e.id === meId ? 'me' : ''}"><span class="who"><span class="dot" style="background:${e.color}"></span>${esc(e.name)}</span><span class="what">${K.fmtH(sums[i].h + sums[i].credit)} / ${K.fmtH(sums[i].soll)} h${diffBadge(sums[i].h + sums[i].credit - sums[i].soll)}</span></li>`).join('')}</ul>
      </section></div>`;
  }

  main.innerHTML = toolbar + body + (admin ? '<p class="hint">Tippe auf ein Feld, um eine Schicht einzutragen, oder auf einen Tag für Events und Anmerkungen. Blasse Einträge kommen aus dem fixen Wochenplan.</p>' : '');
}

export function diffBadge(d) {
  if (Math.abs(d) < 0.01) return '';
  return ` <span class="diff ${d > 0 ? 'plus' : 'minus'}">${d > 0 ? '+' : ''}${K.fmtH(d)}</span>`;
}

act('week', ({ d }) => {
  App.week = +d === 0 ? K.mondayOf(K.today()) : K.addDays(App.week, +d);
  render(document.getElementById('main'));
});

act('layout', ({ l }) => { LS.set('dp.layout', l); render(document.getElementById('main')); });

act('print', () => window.print());

act('copy-week', async () => {
  const plan = App.plan.obj;
  const prev = K.addDays(App.week, -7);
  const emps = employeesSorted(plan);
  const has = emps.some((e) => { for (let i = 0; i < 7; i++) { const x = plan.entries[entryKey(K.addDays(App.week, i), e.id)]; if (alive(x)) return true; } return false; });
  if (has && !(await confirmBox('Diese Woche hat schon Einträge. Mit der Vorwoche überschreiben? Feiertage werden übersprungen.', 'Überschreiben'))) return;
  App.plan.update((p) => {
    const t = now();
    for (const e of emps) {
      for (let i = 0; i < 7; i++) {
        const src = p.entries[entryKey(K.addDays(prev, i), e.id)];
        const d = K.addDays(App.week, i);
        if (K.holidayName(d, p.settings)) continue;
        const k = entryKey(d, e.id);
        if (alive(src) && !(src.kind === 'status' && ['Urlaub', 'Krankenstand', 'ZA'].includes(src.status))) {
          const { updatedAt, ...rest } = src;
          p.entries[k] = { ...rest, updatedAt: t };
        } else if (alive(p.entries[k])) {
          p.entries[k] = { deleted: true, updatedAt: t };
        }
      }
    }
  });
  toast('Vorwoche übernommen (ohne Urlaub, ZA und Krankenstand)');
});

// ---------- Eintrag bearbeiten ----------

act('edit-entry', ({ d, e }) => editEntry(d, e));

export async function editEntry(date, empId) {
  const plan = App.plan.obj;
  const emp = { id: empId, ...plan.employees[empId] };
  const cur = plan.entries[entryKey(date, empId)];
  const pe = planEntry(plan, date, empId);
  const shifts = shiftsSorted(plan);
  const s = plan.settings;
  const st = alive(cur) ? cur : (pe || {});
  const kind0 = st.kind === 'shift' ? (st.shiftId && !st.start ? 'preset' : 'custom') : st.kind === 'status' ? 'status' : st.kind === 'note' ? 'note' : 'preset';
  const times = timesOf(empId);
  const recorded = times && alive(times[date]) ? times[date] : null;

  const startV = st.start || (st.shiftId && plan.shifts[st.shiftId] ? plan.shifts[st.shiftId].start : '');
  const endV = st.end || (st.shiftId && plan.shifts[st.shiftId] ? plan.shifts[st.shiftId].end : '');

  const body = `
    <div class="seg" role="radiogroup">
      ${[['preset', 'Schicht'], ['custom', 'Eigene Zeit'], ['status', 'Abwesend/Frei'], ['note', 'Nur Notiz']].map(([k, l]) => `<label><input type="radio" name="kind" value="${k}" ${kind0 === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}
    </div>
    <div class="pane" data-pane="preset">
      <div class="preset-grid">${shifts.map((sh) => `<label class="preset"><input type="radio" name="shiftId" value="${sh.id}" ${st.shiftId === sh.id && !st.start ? 'checked' : ''}><span><b>${esc(sh.start)}–${esc(sh.end)}</b><small>${esc(sh.label)} · ${K.fmtH(K.workHours(sh.start, sh.end, s))} h</small></span></label>`).join('')}</div>
    </div>
    <div class="pane" data-pane="custom">
      <div class="row3">
        <label class="field"><span>Beginn</span><input type="time" name="start" value="${esc(startV)}"></label>
        <label class="field"><span>Ende</span><input type="time" name="end" value="${esc(endV)}"></label>
        <label class="field"><span>Pause (min)</span><input type="number" name="pause" min="0" step="5" inputmode="numeric" placeholder="auto" value="${st.pause ?? ''}"></label>
      </div>
    </div>
    <div class="pane" data-pane="status">
      <div class="preset-grid">${Object.entries(K.STATUS).map(([k, v]) => `<label class="preset"><input type="radio" name="status" value="${k}" ${st.status === k ? 'checked' : ''}><span><b style="color:${v.farbe}">${k}</b></span></label>`).join('')}</div>
      <label class="field"><span>Angerechnete Stunden (leer = automatisch)</span><input type="number" name="credit" step="0.25" inputmode="decimal" value="${st.credit ?? ''}" placeholder="auto"></label>
    </div>
    <label class="field"><span>Notiz (z. B. Judge, Prerelease)</span><input name="note" value="${esc(st.note && pe && pe.source !== 'feiertag' ? st.note : (alive(cur) ? cur.note || '' : ''))}" maxlength="80"></label>
    <p class="calc" id="calc"></p>
    ${recorded ? `<p class="small muted">Vom Mitarbeiter erfasst: ${recorded.status ? esc(recorded.status) : `${esc(recorded.start)}–${esc(recorded.end)}`}</p>` : ''}
    ${pe && pe.source === 'vorlage' ? '<p class="small muted">Aktuell aus dem fixen Wochenplan.</p>' : ''}
    ${pe && pe.source === 'feiertag' ? `<p class="small muted">Feiertag: ${esc(pe.note)}</p>` : ''}`;

  await openModal({
    title: `${emp.name} · ${K.WOCHENTAGE[K.weekday(date)]} ${K.fmtDate(date, true)}`,
    body,
    buttons: [
      { label: 'Leeren', value: 'clear', kind: 'ghost' },
      { label: 'Abbrechen', value: null },
      { label: 'Speichern', value: 'save', kind: 'primary' },
    ],
    onOpen(root) {
      const upd = () => {
        const f = formData(root);
        root.querySelectorAll('.pane').forEach((p) => { p.hidden = p.dataset.pane !== f.kind; });
        let txt = '';
        if (f.kind === 'preset' && f.shiftId) { const sh = plan.shifts[f.shiftId]; txt = calcText(sh.start, sh.end, '', s); }
        if (f.kind === 'custom') txt = calcText(f.start, f.end, f.pause, s);
        if (f.kind === 'status' && f.status) {
          const r = resolve(plan, { kind: 'status', status: f.status, credit: f.credit }, emp, date);
          txt = `Angerechnet: ${K.fmtH(r.creditH)} h`;
        }
        root.querySelector('#calc').textContent = txt;
      };
      root.addEventListener('input', upd);
      root.addEventListener('change', upd);
      // Schicht antippen = direkt übernehmen
      root.querySelectorAll('[name=shiftId]').forEach((i) => i.addEventListener('click', () => {
        setTimeout(() => root.querySelector('[data-mbtn="2"]').click(), 120);
      }));
      upd();
    },
    onAction(v, root) {
      if (!v) return null;
      const f = formData(root);
      const k = entryKey(date, empId);
      const t = now();
      if (v === 'clear') {
        App.plan.update((p) => { p.entries[k] = { deleted: true, updatedAt: t }; });
        return 'ok';
      }
      let rec;
      if (f.kind === 'preset') {
        if (!f.shiftId) { toast('Bitte eine Schicht wählen', 'error'); return false; }
        rec = { kind: 'shift', shiftId: f.shiftId };
      } else if (f.kind === 'custom') {
        if (K.parseTime(f.start) === null || K.parseTime(f.end) === null) { toast('Beginn und Ende eingeben', 'error'); return false; }
        rec = { kind: 'shift', start: f.start, end: f.end };
        if (f.pause !== '') rec.pause = Number(f.pause);
      } else if (f.kind === 'status') {
        if (!f.status) { toast('Bitte auswählen', 'error'); return false; }
        rec = { kind: 'status', status: f.status };
        if (f.credit !== '') rec.credit = Number(f.credit);
      } else {
        if (!f.note.trim()) { toast('Notiz eingeben', 'error'); return false; }
        rec = { kind: 'note' };
      }
      if (f.note.trim()) rec.note = f.note.trim();
      rec.updatedAt = t;
      App.plan.update((p) => { p.entries[k] = rec; });
      return 'ok';
    },
  });
}

function calcText(start, end, pause, s) {
  const d = K.durationMin(start, end);
  if (d === null) return '';
  const p = pause === '' || pause === undefined ? K.autoPauseMin(start, end, s) : Number(pause);
  return `${K.fmtH(d / 60)} h Anwesenheit − ${p} min Pause = ${K.fmtH(Math.max(0, d - p) / 60)} h Arbeitszeit`;
}

// ---------- Tag bearbeiten (Events, Anmerkung, Feiertag) ----------

act('edit-day', async ({ d }) => {
  const plan = App.plan.obj;
  const day = alive(plan.days[d]) ? plan.days[d] : {};
  const autoHol = K.holidaysAT(K.parseIso(d).y)[d] || '';
  const own = plan.settings.holidays ? plan.settings.holidays[d] : undefined;
  const holName = K.holidayName(d, plan.settings) || '';
  await openModal({
    title: `${K.WOCHENTAGE_LANG[K.weekday(d)]}, ${K.fmtDate(d, true)}`,
    body: `
      <label class="field"><span>Event im Shop</span><input name="event" value="${esc(day.event || '')}" maxlength="80" placeholder="z. B. MTG Prerelease"></label>
      <label class="field"><span>Anmerkung</span><input name="note" value="${esc(day.note || '')}" maxlength="120" placeholder="z. B. Mitarbeiterbesprechung"></label>
      <label class="check"><input type="checkbox" name="hol" ${holName ? 'checked' : ''}><span>Feiertag (Shop zu, kein Soll)</span></label>
      <label class="field"><span>Name des Feiertags</span><input name="holName" value="${esc(holName || autoHol)}" maxlength="40"></label>`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Speichern', kind: 'primary', value: 'save' }],
    onAction(v, root) {
      if (!v) return null;
      const f = formData(root);
      const t = now();
      App.plan.update((p) => {
        p.days[d] = { event: f.event.trim(), note: f.note.trim(), updatedAt: t };
        const hol = { ...(p.settings.holidays || {}) };
        if (f.hol) {
          const name = f.holName.trim() || autoHol || 'Feiertag';
          if (autoHol && name === autoHol) delete hol[d]; else hol[d] = name;
        } else if (autoHol) hol[d] = null; // gesetzlicher Feiertag, Shop hat aber offen
        else delete hol[d];
        p.settings = { ...p.settings, holidays: hol, updatedAt: t };
      });
      return 'ok';
    },
  });
});

registerView('plan', { title: 'Plan', icon: '📅', roles: ['admin', 'employee'], render });
