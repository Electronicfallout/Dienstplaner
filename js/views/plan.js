// Wochenansicht des Dienstplans (Planer bearbeitet, Mitarbeiter sehen).

import { App, registerView, isAdmin, timesOf } from '../app.js';
import { esc, act, openModal, toast, formData, confirmBox } from '../ui.js';
import * as K from '../calc.js';
import { employeesSorted, shiftsSorted, planEntry, resolve, entryKey, sollDay, employed, alive, setEntry, isPublished, eventsOn, recurringOn, recurringText } from '../model.js';
import { now } from '../store.js';
import { LS } from '../storage.js';

App.week = K.mondayOf(K.today());

export function cellHtml(r, pe, { compact = false } = {}) {
  if (!r) return '<span class="empty">·</span>';
  const tpl = pe && pe.source !== 'plan' ? ' from-tpl' : '';
  if (r.type === 'shift') {
    return `<span class="cell-shift${tpl}${r.color ? ' colored' : ''}"${r.color ? ` style="background:${esc(r.color)}"` : ''}><b>${esc(r.start)}–${esc(r.end)}</b>${compact ? '' : `<small>${K.fmtH(r.workH)} h${r.label ? ' · ' + esc(r.label) : ''}</small>`}${r.note ? `<small class="note">${esc(r.note)}</small>` : ''}</span>`;
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
      if (!any && !(alive(day) && (day.event || day.note)) && !recurringOn(plan, d).length) continue;
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

  const pubUntil = plan.settings.publishedUntil;
  const visible = (d) => admin || isPublished(plan, d);
  const draftDays = days.filter((d) => !isPublished(plan, d));

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
        ${admin ? '<button class="btn small primary" data-act="publish">Veröffentlichen</button>' : ''}
        <button class="btn small ghost" data-act="print">Drucken</button>
        <button class="btn small ghost" data-act="pdf" data-kind="week">PDF</button>
      </div>
    </div>
    ${admin && draftDays.length ? `<div class="notice draft">✏️ <b>Entwurf:</b> ${draftDays.length === days.length ? 'Diese Woche ist' : `Ab ${K.fmtDate(draftDays[0])} ist die Woche`} noch nicht veröffentlicht. Die Mitarbeiter sehen sie noch nicht. ${pubUntil ? `Veröffentlicht bis ${K.fmtDate(pubUntil, true)}.` : ''}</div>` : ''}
    ${admin && !pubUntil ? '<div class="notice">Tipp: Mit <b>Veröffentlichen</b> gibst du den Plan bis zu einem Datum für die Mitarbeiter frei. Spätere Änderungen daran werden dann protokolliert und den Betroffenen angezeigt.</div>' : ''}
    ${!admin && draftDays.length ? `<div class="notice draft">${draftDays.length === days.length ? 'Diese Woche ist noch nicht veröffentlicht.' : `Ab ${K.fmtDate(draftDays[0])} ist der Plan noch nicht veröffentlicht.`}</div>` : ''}`;

  if (!emps.length) {
    main.innerHTML = toolbar + `<div class="empty-state"><p>Noch keine Mitarbeiter.</p>${admin ? '<button class="btn primary" data-act="nav" data-view="settings">Mitarbeiter anlegen</button>' : ''}</div>`;
    return;
  }

  const dayInfo = (d) => (alive(plan.days[d]) ? plan.days[d] : {});
  const evHtml = (d) => eventsOn(plan, d).map((e) => `<span class="event ${e.recurring ? 'rec' : ''} ${e.noPrint ? 'noprint' : ''}">${e.recurring ? '↻' : '🎲'} ${esc(e.title)}</span>`).join('');
  const dayHead = (d, withEvents) => {
    const hol = K.holidayName(d, plan.settings);
    const ev = dayInfo(d);
    return `<div class="dayhead ${d === t ? 'today' : ''}">
      <b>${K.WOCHENTAGE[K.weekday(d)]} ${K.fmtDate(d)}</b>
      ${hol ? `<span class="hol">${esc(hol)}</span>` : ''}
      ${!isPublished(plan, d) ? '<span class="draft-tag">Entwurf</span>' : ''}
      ${withEvents ? evHtml(d) : ''}
      ${withEvents && ev.note ? `<span class="daynote">📝 ${esc(ev.note)}</span>` : ''}
      ${withEvents && admin && !eventsOn(plan, d).length && !ev.note ? '<span class="add-hint">+ Event / Anmerkung</span>' : ''}
    </div>`;
  };

  // Wochensummen (für Mitarbeiter nur veröffentlichte Tage)
  const sums = emps.map((e) => {
    let h = 0, soll = 0, credit = 0;
    for (let i = 0; i < 7; i++) {
      const d = K.addDays(mon, i);
      soll += sollDay(e, d, plan.settings);
      if (!visible(d)) continue;
      const r = resolve(plan, planEntry(plan, d, e.id), e, d);
      if (r) { h += r.workH; credit += r.creditH; }
    }
    return { h, soll, credit };
  });

  const cell = (d, e) => {
    if (!visible(d)) return '<span class="muted">–</span>';
    const pe = planEntry(plan, d, e.id);
    return cellHtml(resolve(plan, pe, e, d), pe);
  };
  const editAttr = (d, e) => (admin ? `data-act="edit-entry" data-d="${d}" data-e="${e.id}"` : '');
  const dayAttr = (d) => (admin ? `data-act="edit-day" data-d="${d}"` : '');

  let body;
  if (layout === 'table') {
    body = `<div class="table-scroll"><table class="plan">
      <thead><tr><th class="sticky">Tag</th>${emps.map((e) => `<th class="${e.id === meId ? 'me' : ''}"><span class="dot" style="background:${e.color}"></span>${esc(e.name)}<small>${K.fmtH(e.weeklyHours)} h</small></th>`).join('')}<th class="evcol">Events im Shop</th><th class="evcol">Anmerkung</th></tr></thead>
      <tbody>${days.map((d) => {
        const ev = dayInfo(d);
        return `<tr class="${K.weekday(d) === 5 ? 'sat' : ''} ${isPublished(plan, d) ? '' : 'draft'}">
        <th class="sticky ${admin ? 'clickable' : ''}" ${dayAttr(d)}>${dayHead(d, false)}</th>
        ${emps.map((e) => (!employed(e, d) ? '<td class="off"></td>' : `<td class="${e.id === meId ? 'me' : ''} ${admin ? 'clickable' : ''}" ${editAttr(d, e)}>${cell(d, e)}</td>`)).join('')}
        <td class="evcol ${admin ? 'clickable' : ''}" ${dayAttr(d)}>${evHtml(d) || (admin ? '<span class="add-hint">+ Event</span>' : '')}</td>
        <td class="evcol ${admin ? 'clickable' : ''}" ${dayAttr(d)}>${ev.note ? esc(ev.note) : (admin ? '<span class="add-hint">+ Anmerkung</span>' : '')}</td>
      </tr>`;
      }).join('')}</tbody>
      <tfoot><tr><th class="sticky">Woche</th>${sums.map((s, i) => `<td class="${emps[i].id === meId ? 'me' : ''}"><b>${K.fmtH(s.h + s.credit)}</b> / ${K.fmtH(s.soll)} h${diffBadge(s.h + s.credit - s.soll)}</td>`).join('')}<td colspan="2"></td></tr></tfoot>
    </table></div>`;
  } else {
    body = `<div class="day-list">${days.map((d) => `
      <section class="day-card ${d === t ? 'today' : ''}">
        <div class="${admin ? 'clickable' : ''}" ${dayAttr(d)}>${dayHead(d, true)}</div>
        <ul>${emps.filter((e) => employed(e, d)).map((e) => `<li class="${e.id === meId ? 'me' : ''} ${admin ? 'clickable' : ''}" ${editAttr(d, e)}>
            <span class="who"><span class="dot" style="background:${e.color}"></span>${esc(e.name)}</span>
            <span class="what">${cell(d, e)}</span></li>`).join('')}</ul>
      </section>`).join('')}
      <section class="day-card sums"><div class="dayhead"><b>Stunden diese Woche</b></div>
        <ul>${emps.map((e, i) => `<li class="${e.id === meId ? 'me' : ''}"><span class="who"><span class="dot" style="background:${e.color}"></span>${esc(e.name)}</span><span class="what">${K.fmtH(sums[i].h + sums[i].credit)} / ${K.fmtH(sums[i].soll)} h${diffBadge(sums[i].h + sums[i].credit - sums[i].soll)}</span></li>`).join('')}</ul>
      </section></div>`;
  }

  main.innerHTML = toolbar + body + (admin ? '<p class="hint">Tippe auf ein Feld, um eine Schicht einzutragen. Events und Anmerkungen trägst du in den rechten Spalten bzw. beim Tag ein. Blasse Einträge kommen aus dem fixen Wochenplan.</p>' : '');
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

act('print', () => printDialog());

// ---------- Drucken (Hoch- oder Querformat) ----------

export async function printDialog() {
  const cur = LS.get('dp.print') || 'landscape';
  const r = await openModal({
    title: 'Drucken',
    body: `<div class="seg"><label><input type="radio" name="o" value="landscape" ${cur === 'landscape' ? 'checked' : ''}><span>Querformat</span></label><label><input type="radio" name="o" value="portrait" ${cur === 'portrait' ? 'checked' : ''}><span>Hochformat</span></label></div>
      <p class="small muted">Gedruckt wird die aktuelle Ansicht. Tipp: In der Tabellenansicht passt eine Woche gut auf eine Seite im Querformat.</p>`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Drucken', kind: 'primary', value: 'ok' }],
    onAction(v, root) { return v ? formData(root).o : null; },
  });
  if (!r) return;
  LS.set('dp.print', r);
  // Liste druckt schlecht; für den Druck kurz auf Tabelle umschalten
  const prevLayout = LS.get('dp.layout');
  const switched = App.view === 'plan' && (prevLayout || (window.innerWidth < 760 ? 'list' : 'table')) === 'list';
  if (switched) { LS.set('dp.layout', 'table'); render(document.getElementById('main')); }
  setTimeout(() => {
    window.print();
    if (switched) { if (prevLayout) LS.set('dp.layout', prevLayout); else LS.del('dp.layout'); render(document.getElementById('main')); }
  }, 100);
}

// Vor jedem Druck (auch Strg+P): Seitenformat setzen und Tabelle auf eine Seite skalieren
function preparePrint() {
  const orient = LS.get('dp.print') || 'landscape';
  let st = document.getElementById('page-style');
  if (!st) { st = document.createElement('style'); st.id = 'page-style'; document.head.appendChild(st); }
  st.textContent = `@page { size: A4 ${orient}; margin: 8mm; }`;
  document.body.classList.add('printmode');
  const main = document.getElementById('main');
  if (!main) return;
  main.style.zoom = ''; main.style.width = '';
  if (!main.querySelector('table.plan')) return;
  // druckbare Fläche A4 minus Ränder, in CSS-Pixeln (96 dpi), mit etwas Reserve
  const mm = 96 / 25.4;
  const pageW = ((orient === 'landscape' ? 297 : 210) - 16) * mm * 0.98;
  const pageH = ((orient === 'landscape' ? 210 : 297) - 16) * mm * 0.97;
  // Breite und Höhe hängen voneinander ab (Zeilenumbrüche): größten passenden Faktor suchen
  const fits = (z) => {
    main.style.width = (pageW / z) + 'px';
    const w = Math.max(main.scrollWidth, ...Array.from(main.querySelectorAll('table')).map((t) => t.scrollWidth));
    return w * z <= pageW + 1 && main.scrollHeight * z <= pageH + 1;
  };
  let z = 1;
  if (!fits(1)) {
    let lo = 0.25, hi = 1;
    for (let i = 0; i < 10; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
    z = lo;
  }
  main.style.width = z < 1 ? (pageW / z) + 'px' : '';
  if (z < 1) main.style.zoom = String(Math.floor(z * 1000) / 1000);
}

function endPrint() {
  document.body.classList.remove('printmode');
  const main = document.getElementById('main');
  if (main) { main.style.zoom = ''; main.style.width = ''; }
}

window.addEventListener('beforeprint', preparePrint);
window.addEventListener('afterprint', endPrint);

// ---------- Veröffentlichen ----------

act('publish', async () => {
  const plan = App.plan.obj;
  const cur = plan.settings.publishedUntil;
  const sun = K.addDays(App.week, 6);
  const { y, m } = K.parseIso(sun);
  const monthEnd = K.iso(y, m, K.daysInMonth(y, m));
  const r = await openModal({
    title: 'Plan veröffentlichen',
    body: `<p>Bis zu welchem Tag ist der Plan fertig? Alles bis dahin sehen die Mitarbeiter. Ändert sich danach etwas, steht es in der Änderungsliste und die betroffene Person bekommt einen Hinweis.</p>
      <div class="seg">
        <label><input type="radio" name="opt" value="${sun}" checked><span>bis ${K.fmtDate(sun, true)} (diese Woche)</span></label>
        <label><input type="radio" name="opt" value="${monthEnd}"><span>bis ${K.fmtDate(monthEnd, true)} (Monatsende)</span></label>
        <label><input type="radio" name="opt" value="custom"><span>anderes Datum</span></label>
      </div>
      <label class="field"><span>Datum</span><input type="date" name="date" value="${sun}"></label>
      ${cur ? `<p class="small muted">Bisher veröffentlicht bis ${K.fmtDate(cur, true)}.</p>` : ''}`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Veröffentlichen', kind: 'primary', value: 'ok' }],
    onOpen(root) {
      root.addEventListener('change', (e) => { if (e.target.name === 'opt' && e.target.value !== 'custom') root.querySelector('[name=date]').value = e.target.value; });
      root.querySelector('[name=date]').addEventListener('input', () => { root.querySelector('[value=custom]').checked = true; });
    },
    onAction(v, root) {
      if (!v) return null;
      const d = formData(root).date;
      if (!d) { toast('Datum wählen', 'error'); return false; }
      return d;
    },
  });
  if (!r) return;
  if (cur && r < cur && !(await confirmBox(`Der Plan war schon bis ${K.fmtDate(cur, true)} veröffentlicht. Wirklich auf ${K.fmtDate(r, true)} zurücknehmen?`, 'Zurücknehmen'))) return;
  App.plan.update((p) => { p.settings = { ...p.settings, publishedUntil: r, publishedAt: now(), updatedAt: now() }; });
  toast(`Veröffentlicht bis ${K.fmtDate(r, true)}`);
});

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
          setEntry(p, d, e.id, rest, t);
        } else if (alive(p.entries[k])) {
          setEntry(p, d, e.id, null, t);
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
        App.plan.update((p) => setEntry(p, date, empId, null, t));
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
      App.plan.update((p) => setEntry(p, date, empId, rec, t));
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
  // wiederkehrende Events, die an diesem Wochentag laufen könnten (auch wenn hier ausgenommen)
  const recAll = Object.entries(plan.recurring || {}).filter(([, r]) => alive(r) && Number(r.weekday) === K.weekday(d))
    .map(([id, r]) => ({ id, ...r, on: recurringOn(plan, d).some((x) => x.id === id), skipped: !!(r.skip && r.skip[d]) }))
    .filter((r) => r.on || r.skipped);
  await openModal({
    title: `${K.WOCHENTAGE_LANG[K.weekday(d)]}, ${K.fmtDate(d, true)}`,
    body: `
      <label class="field"><span>Event im Shop</span><input name="event" value="${esc(day.event || '')}" maxlength="80" placeholder="z. B. MTG Prerelease"></label>
      ${recAll.length ? `<div class="field"><span>Wiederkehrende Events an diesem Tag</span>${recAll.map((r) => `<label class="check"><input type="checkbox" name="rec_${r.id}" ${r.on ? 'checked' : ''}><span>${esc(r.title)} <small class="muted">(${esc(recurringText(r))})</small></span></label>`).join('')}</div>` : ''}
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
        for (const r of recAll) {
          const want = !!f['rec_' + r.id];
          if (want === r.on) continue;
          const skip = { ...(p.recurring[r.id].skip || {}) };
          if (want) delete skip[d]; else skip[d] = true;
          p.recurring[r.id] = { ...p.recurring[r.id], skip, updatedAt: t };
        }
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
