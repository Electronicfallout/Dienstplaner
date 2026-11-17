// Änderungsvorschläge und Diensttausch durch Mitarbeiter.
// plan.proposals[id] = {
//   kind: 'change' | 'swap', by: empId, date, created,
//   change: rec (neuer Eintrag, z. B. {kind:'shift',start,end} oder {kind:'status',status:'Frei'}), reason
//   swap:   with: empId, mode: 'same' (am selben Tag Dienste tauschen) | 'other' (ich übernehme dessen Dienst am withDate,
//           er/sie meinen am date) | 'give' (ich gebe meinen Dienst ab), withDate
//   snap: { 'datum|empId': Text vorher } – erkennt, ob sich der Plan inzwischen geändert hat
//   status: 'offen' (wartet auf Kollegen bzw. Planer) | 'planer' (Tausch angenommen, Planer muss bestätigen)
//         | 'erledigt' | 'abgelehnt' | 'zurückgezogen', gaps: [...], reply, decidedBy, updatedAt }
// Ein Tausch, der die Besetzung nicht verschlechtert, wird sofort übernommen; sonst entscheidet der Planer.

import { App, isAdmin } from './app.js';
import { esc, act, openModal, toast, formData } from './ui.js';
import * as K from './calc.js';
import { employeesSorted, shiftsSorted, planEntry, entryText, setEntry, alive, isPublished, employed, coverageGaps } from './model.js';
import { now, clone } from './store.js';
import { randomId } from './crypto.js';

const name = (plan, id) => (plan.employees[id] && !plan.employees[id].deleted ? plan.employees[id].name : '?');
const day = (d) => `${K.WOCHENTAGE[K.weekday(d)]} ${K.fmtDate(d)}`;
const OPEN = ['offen', 'planer'];

// Vom Planer geschickter Tausch: wer muss noch zustimmen?
function pendingFor(plan, p) {
  return (p.need || []).filter((id) => !(p.accepted || {})[id]);
}

export function proposalsOf(plan) {
  return Object.entries(plan.proposals || {}).filter(([, p]) => alive(p)).map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

// Was ein Eintrag als neuer, ausdrücklicher Eintrag ist (Vorlage/Feiertag werden zu echten Einträgen)
function asRec(pe) {
  if (!pe || pe.source === 'feiertag') return { kind: 'status', status: 'Frei' };
  const { source, updatedAt, ...rec } = pe;
  return rec;
}

const FREI = { kind: 'status', status: 'Frei' };
function mode(p) { return p.mode || (p.withDate && p.withDate !== p.date ? 'other' : 'same'); }
function swapDays(p) { return mode(p) === 'other' ? [p.date, p.withDate] : [p.date]; }
function people(p) { return p.kind === 'swap' ? [p.by, p.with] : [p.by]; }

function snapshot(plan, p) {
  const s = {};
  const days = p.kind === 'swap' ? swapDays(p) : [p.date];
  for (const d of days) for (const e of people(p)) s[`${d}|${e}`] = entryText(plan, d, e);
  if (p.kind === 'change') return { [`${p.date}|${p.by}`]: s[`${p.date}|${p.by}`] };
  return s;
}

function stale(plan, p) {
  return Object.entries(p.snap || {}).some(([k, v]) => { const [d, e] = k.split('|'); return entryText(plan, d, e) !== v; });
}

// Vorschlag auf einen Plan anwenden (mutiert plan)
function apply(plan, p, t) {
  if (p.kind === 'change') { setEntry(plan, p.date, p.by, p.change, t); return; }
  const mine = asRec(planEntry(plan, p.date, p.by));
  if (mode(p) === 'same') {
    const theirs = asRec(planEntry(plan, p.date, p.with));
    setEntry(plan, p.date, p.by, theirs, t);
    setEntry(plan, p.date, p.with, mine, t);
    return;
  }
  setEntry(plan, p.date, p.with, mine, t);
  setEntry(plan, p.date, p.by, FREI, t);
  if (mode(p) === 'other') {
    const theirs = asRec(planEntry(plan, p.withDate, p.with));
    setEntry(plan, p.withDate, p.by, theirs, t);
    setEntry(plan, p.withDate, p.with, FREI, t);
  }
}

// Besetzungslücken, die durch den Vorschlag neu entstehen würden
export function newGaps(plan, p) {
  const days = p.kind === 'swap' ? swapDays(p) : [p.date];
  const sim = clone(plan);
  apply(sim, p, now());
  const out = [];
  for (const d of days) {
    const before = new Set(coverageGaps(plan, d));
    const added = coverageGaps(sim, d).filter((g) => !before.has(g));
    if (added.length) out.push(`${day(d)}: ${added.join(', ')}`);
  }
  return out;
}

export function describe(plan, p) {
  if (p.kind === 'change') {
    const was = p.snap ? Object.values(p.snap)[0] : entryText(plan, p.date, p.by);
    const to = p.change.kind === 'status' ? p.change.status : `${p.change.start}–${p.change.end}`;
    return `${name(plan, p.by)} möchte am ${day(p.date)} ${to} statt ${was}`;
  }
  const txt = (d, e) => (p.snap && p.snap[`${d}|${e}`]) || entryText(plan, d, e);
  const A = name(plan, p.by), B = name(plan, p.with);
  if (mode(p) === 'same') return `${day(p.date)}: ${A} (${txt(p.date, p.by)}) tauscht mit ${B} (${txt(p.date, p.with)})`;
  if (mode(p) === 'give') return `${A} gibt ${day(p.date)} (${txt(p.date, p.by)}) an ${B} ab`;
  return `${A} gibt ${day(p.date)} (${txt(p.date, p.by)}) an ${B} und übernimmt dafür ${day(p.withDate)} (${txt(p.withDate, p.with)})`;
}

const STATUS_TEXT = { offen: 'wartet', planer: 'wartet auf Planer', erledigt: 'übernommen', abgelehnt: 'abgelehnt', 'zurückgezogen': 'zurückgezogen' };

// ---------- Anzeige im Wochenplan ----------

export function proposalsHtml(plan) {
  const me = App.cfg.empId;
  const admin = isAdmin();
  const list = proposalsOf(plan).filter((p) => p.date >= K.addDays(K.today(), -7));
  const rows = [];
  for (const p of list) {
    const txt = `<div class="grow">${esc(describe(plan, p))}${p.reason ? `<small>„${esc(p.reason)}“</small>` : ''}${p.gaps && p.gaps.length ? `<small class="warn-text">⚠ Danach fehlt: ${esc(p.gaps.join(' · '))}</small>` : ''}</div>`;
    if (p.fromPlaner) {
      const open = pendingFor(plan, p);
      if (admin && p.status === 'offen') rows.push(`<li><div class="grow">Dein Vorschlag: ${esc(describe(plan, p))}<small>wartet auf ${esc(open.map((id) => name(plan, id)).join(', '))}</small></div><div class="btn-row"><button class="btn small ghost" data-act="prop-withdraw" data-id="${p.id}">Zurückziehen</button></div></li>`);
      else if (!admin && p.status === 'offen' && open.includes(me)) rows.push(`<li><div class="grow">Vorschlag vom Planer: ${esc(describe(plan, p))}${p.reason ? `<small>„${esc(p.reason)}“</small>` : ''}</div><div class="btn-row"><button class="btn small primary" data-act="prop-accept" data-id="${p.id}">Annehmen</button><button class="btn small" data-act="prop-decline" data-id="${p.id}">Ablehnen</button></div></li>`);
      continue;
    }
    if (admin && ((p.kind === 'change' && p.status === 'offen') || p.status === 'planer')) {
      rows.push(`<li>${txt}<div class="btn-row"><button class="btn small primary" data-act="prop-confirm" data-id="${p.id}">Bestätigen</button><button class="btn small" data-act="prop-reject" data-id="${p.id}">Ablehnen</button></div></li>`);
    } else if (!admin && p.kind === 'swap' && p.with === me && p.status === 'offen') {
      rows.push(`<li>${txt}<div class="btn-row"><button class="btn small primary" data-act="prop-accept" data-id="${p.id}">Annehmen</button><button class="btn small" data-act="prop-decline" data-id="${p.id}">Ablehnen</button></div></li>`);
    } else if (!admin && p.by === me && OPEN.includes(p.status)) {
      rows.push(`<li>${txt}<div class="btn-row"><span class="small muted">${STATUS_TEXT[p.status]}${p.kind === 'swap' && p.status === 'offen' ? ` auf ${esc(name(plan, p.with))}` : p.status === 'offen' ? ' auf Planer' : ''}</span><button class="btn small ghost" data-act="prop-withdraw" data-id="${p.id}">Zurückziehen</button></div></li>`);
    }
  }
  if (!rows.length) return '';
  return `<div class="notice proposals"><b>${admin ? 'Tausch-Vorschläge' : 'Anfragen'}</b><ul class="prop-list">${rows.join('')}</ul></div>`;
}

// Für die Glocke: was ist zu tun, was ist neu?
export function proposalNotices(plan) {
  const me = App.cfg.empId;
  const admin = isAdmin();
  const todo = [], news = [];
  for (const p of proposalsOf(plan)) {
    if (p.date < K.addDays(K.today(), -7)) continue;
    const text = describe(plan, p);
    if (p.fromPlaner) {
      if (admin && ['erledigt', 'abgelehnt'].includes(p.status)) news.push({ at: p.updatedAt, icon: p.status === 'erledigt' ? '✅' : '❌', text: `Dein Tauschvorschlag ${STATUS_TEXT[p.status]}: ${text}`, sub: p.reply || '', view: 'plan', date: p.date });
      if (!admin && p.status === 'offen' && pendingFor(plan, p).includes(me)) todo.push({ icon: '🔁', text: 'Der Planer schlägt einen Tausch vor', sub: text, view: 'plan', date: p.date });
      if (!admin && (p.by === me || p.with === me) && ['erledigt', 'abgelehnt'].includes(p.status)) news.push({ at: p.updatedAt, icon: p.status === 'erledigt' ? '✅' : '❌', text: `Tausch ${STATUS_TEXT[p.status]}: ${text}`, sub: p.reply || '', view: 'plan', date: p.date });
      continue;
    }
    if (admin) {
      if ((p.kind === 'change' && p.status === 'offen') || p.status === 'planer') todo.push({ icon: '✋', text: `Bitte entscheiden: ${text}`, sub: p.gaps && p.gaps.length ? `Danach fehlt: ${p.gaps.join(' · ')}` : '', view: 'plan', date: p.date });
      else if (p.kind === 'swap' && p.status === 'erledigt' && !p.decidedBy) news.push({ at: p.updatedAt, icon: '🔁', text: `Getauscht: ${text}`, view: 'plan', date: p.date });
    } else {
      if (p.kind === 'swap' && p.with === me && p.status === 'offen') todo.push({ icon: '🔁', text: `${name(plan, p.by)} möchte mit dir tauschen`, sub: text, view: 'plan', date: p.date });
      if ((p.by === me || p.with === me) && ['erledigt', 'abgelehnt'].includes(p.status)) {
        news.push({ at: p.updatedAt, icon: p.status === 'erledigt' ? '✅' : '❌', text: `${p.kind === 'swap' ? 'Tausch' : 'Vorschlag'} ${STATUS_TEXT[p.status]}: ${text}`, sub: p.reply || '', view: 'plan', date: p.date });
      }
      if (p.by === me && p.status === 'planer') news.push({ at: p.updatedAt, icon: '⏳', text: `Tausch angenommen, wartet auf den Planer: ${text}`, sub: p.gaps && p.gaps.length ? `Grund: danach fehlt ${p.gaps.join(' · ')}` : '', view: 'plan', date: p.date });
    }
  }
  return { todo, news };
}

// ---------- Vorschlag machen (Mitarbeiter) ----------

// planerFor: der Planer tauscht direkt für diese Person (wird sofort übernommen, keine Anfrage)
export async function propose(date, planerFor = null) {
  const plan = App.plan.obj;
  const planer = !!planerFor && isAdmin();
  const me = planer ? planerFor : App.cfg.empId;
  const du = planer ? name(plan, me) : 'du';
  const mine = entryText(plan, date, me);
  const others = employeesSorted(plan).filter((e) => e.id !== me && employed(e, date));
  const shifts = shiftsSorted(plan);
  const r = await openModal({
    title: planer ? `${name(plan, me)} · ${day(date)}: ${mine}` : `${day(date)}: ${mine}`,
    body: `
      <div class="seg" ${planer ? 'hidden' : ''}>
        <label><input type="radio" name="kind" value="swap" checked><span>Mit jemandem tauschen</span></label>
        <label><input type="radio" name="kind" value="change"><span>Andere Zeit</span></label>
        <label><input type="radio" name="kind" value="free"><span>Frei wünschen</span></label>
      </div>
      <div data-k="swap">
        <label class="field"><span>Mit</span><select name="with">${others.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></label>
        <div class="seg">
          <label><input type="radio" name="mode" value="same" checked><span>am selben Tag tauschen</span></label>
          <label><input type="radio" name="mode" value="other"><span>dafür einen anderen Tag übernehmen</span></label>
          <label><input type="radio" name="mode" value="give"><span>nur abgeben</span></label>
        </div>
        <label class="field" data-m="other" hidden><span>Welchen Tag übernimmt ${planer ? esc(name(plan, me)) : 'du'}?</span><input type="date" name="withDate" value="${K.addDays(date, 1)}"></label>
        ${planer ? `<div class="seg">
          <label><input type="radio" name="how" value="now" checked><span>sofort tauschen</span></label>
          <label><input type="radio" name="how" value="ask"><span>als Vorschlag schicken (Bestätigung nötig)</span></label>
        </div>` : ''}
        <p class="calc" id="preview"></p>
      </div>
      <div data-k="change" hidden>
        <div class="preset-grid">${shifts.map((sh) => `<label class="preset"><input type="radio" name="preset" value="${sh.start}|${sh.end}"><span><b>${esc(sh.start)}–${esc(sh.end)}</b></span></label>`).join('')}</div>
        <div class="row2">
          <label class="field"><span>Beginn</span><input type="time" name="start"></label>
          <label class="field"><span>Ende</span><input type="time" name="end"></label>
        </div>
      </div>
      <label class="field"><span>Nachricht (optional)</span><input name="reason" maxlength="120" placeholder="z. B. Arzttermin"></label>
      <p class="small muted" ${planer ? 'hidden' : ''}>Ein Tausch gilt, sobald die andere Person annimmt und danach weiterhin alles besetzt ist. Sonst entscheidet der Planer. Andere Zeiten und Frei-Wünsche bestätigt immer der Planer.</p>`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Senden', kind: 'primary', value: 'ok' }],
    onOpen(root) {
      const upd = () => {
        const f = formData(root);
        root.querySelectorAll('[data-k]').forEach((el) => { el.hidden = el.dataset.k !== f.kind; });
        root.querySelectorAll('[data-m]').forEach((el) => { el.hidden = el.dataset.m !== f.mode; });
        if (f.kind === 'swap' && f.with) {
          const p = { kind: 'swap', by: me, with: f.with, date, mode: f.mode, withDate: f.mode === 'other' ? f.withDate : null };
          const B = name(plan, f.with);
          const lines = [];
          if (f.mode === 'same') lines.push(`${day(date)}: ${du} bekommt „${entryText(plan, date, f.with)}“, ${B} bekommt „${mine}“`);
          else {
            lines.push(`${day(date)}: ${B} übernimmt „${mine}“, ${du} hat frei`);
            if (entryText(plan, date, f.with) !== 'kein Dienst' && entryText(plan, date, f.with) !== 'Frei') lines.push(`Achtung: ${B}s bisheriger Eintrag an diesem Tag („${entryText(plan, date, f.with)}“) wird ersetzt`);
            if (f.mode === 'other' && f.withDate) {
              lines.push(`${day(f.withDate)}: ${du} übernimmt „${entryText(plan, f.withDate, f.with)}“ von ${B}`);
              if (!['kein Dienst', 'Frei'].includes(entryText(plan, f.withDate, me))) lines.push(`Achtung: ${planer ? name(plan, me) + 's' : 'dein'} bisheriger Eintrag an diesem Tag („${entryText(plan, f.withDate, me)}“) wird ersetzt`);
            }
          }
          const g = f.mode === 'other' && !f.withDate ? [] : newGaps(plan, p);
          root.querySelector('#preview').innerHTML = lines.map(esc).join('<br>') + (g.length ? `<br><span class="warn-text">⚠ Danach fehlt: ${esc(g.join(' · '))}${planer ? '' : '. Der Planer muss bestätigen'}.</span>` : '');
        }
      };
      root.addEventListener('change', (e) => {
        if (e.target.name === 'preset') { const [a, b] = e.target.value.split('|'); root.querySelector('[name=start]').value = a; root.querySelector('[name=end]').value = b; }
        upd();
      });
      root.addEventListener('input', upd);
      upd();
    },
    onAction(v, root) {
      if (!v) return null;
      const f = formData(root);
      if (f.kind === 'swap' && !f.with) { toast('Niemand zum Tauschen da', 'error'); return false; }
      if (f.kind === 'swap' && f.mode !== 'same' && (planEntry(plan, date, me) || {}).kind !== 'shift') { toast(planer ? 'An diesem Tag gibt es keinen Dienst zum Abgeben' : 'Du hast an diesem Tag keinen Dienst zum Abgeben', 'error'); return false; }
      if (f.kind === 'swap' && f.mode === 'other') {
        if (!f.withDate || f.withDate === date) { toast('Einen anderen Tag wählen', 'error'); return false; }
        if (!planer && (!isPublished(plan, f.withDate) || f.withDate < K.today())) { toast('Dieser Tag ist nicht veröffentlicht oder schon vorbei', 'error'); return false; }
        const r2 = planEntry(plan, f.withDate, f.with);
        if (!r2 || r2.kind !== 'shift') { toast(`${name(plan, f.with)} hat an diesem Tag keinen Dienst`, 'error'); return false; }
      }
      if (f.kind === 'change' && (K.parseTime(f.start) === null || K.parseTime(f.end) === null)) { toast('Beginn und Ende angeben', 'error'); return false; }
      return f;
    },
  });
  if (!r) return;
  const t = now();
  const p = { by: me, date, created: t, status: 'offen', reason: r.reason.trim(), updatedAt: t };
  if (r.kind === 'swap') Object.assign(p, { kind: 'swap', with: r.with, mode: r.mode, withDate: r.mode === 'other' ? r.withDate : null });
  else Object.assign(p, { kind: 'change', change: r.kind === 'free' ? { kind: 'status', status: 'Frei' } : { kind: 'shift', start: r.start, end: r.end } });
  p.snap = snapshot(plan, p);
  if (planer && r.how === 'ask') {
    const need = [p.by, p.with].filter((id) => plan.employees[id] && !plan.employees[id].noTimes);
    Object.assign(p, { fromPlaner: true, need, accepted: {} });
    App.plan.update((pl) => { pl.proposals = pl.proposals || {}; pl.proposals['p' + randomId(8)] = p; });
    toast(`Vorschlag an ${need.map((id) => name(plan, id)).join(' und ')} geschickt`);
    return;
  }
  if (planer) {
    App.plan.update((pl) => {
      apply(pl, p, t);
      pl.proposals = pl.proposals || {};
      pl.proposals['p' + randomId(8)] = { ...p, status: 'erledigt', decidedBy: 'planer', reply: 'vom Planer getauscht', gaps: [] };
    });
    toast('Getauscht');
    return;
  }
  App.plan.update((pl) => { pl.proposals = pl.proposals || {}; pl.proposals['p' + randomId(8)] = p; });
  toast(p.kind === 'swap' ? `Anfrage an ${name(plan, p.with)} gesendet` : 'Vorschlag an den Planer gesendet');
}

// ---------- Entscheidungen ----------

function update(id, fn) {
  App.plan.update((pl) => {
    const p = pl.proposals && pl.proposals[id];
    if (!alive(p)) return;
    fn(pl, p, now());
  });
}

act('propose', ({ d }) => propose(d));

act('prop-withdraw', ({ id }) => update(id, (pl, p, t) => { pl.proposals[id] = { ...p, status: 'zurückgezogen', updatedAt: t }; }));

act('prop-decline', ({ id }) => update(id, (pl, p, t) => { pl.proposals[id] = { ...p, status: 'abgelehnt', reply: `${name(pl, p.fromPlaner ? App.cfg.empId : p.with)} hat abgelehnt`, updatedAt: t }; }));

act('prop-accept', ({ id }) => {
  let msg = '';
  update(id, (pl, p, t) => {
    if (stale(pl, p)) { pl.proposals[id] = { ...p, status: 'abgelehnt', reply: 'Der Plan hat sich inzwischen geändert. Bitte neu anfragen.', updatedAt: t }; msg = 'Plan hat sich geändert, Anfrage verfällt'; return; }
    if (p.fromPlaner) {
      const q = { ...p, accepted: { ...(p.accepted || {}), [App.cfg.empId]: true }, updatedAt: t };
      if (pendingFor(pl, q).length) { pl.proposals[id] = q; msg = `Angenommen. Jetzt fehlt noch die Zustimmung von ${pendingFor(pl, q).map((x) => name(pl, x)).join(', ')}.`; return; }
      apply(pl, q, t);
      pl.proposals[id] = { ...q, status: 'erledigt', decidedBy: 'planer', reply: 'von allen bestätigt', updatedAt: t };
      msg = 'Getauscht. Der Plan ist aktualisiert.';
      return;
    }
    const gaps = newGaps(pl, p);
    if (gaps.length) { pl.proposals[id] = { ...p, status: 'planer', gaps, updatedAt: t }; msg = 'Angenommen. Weil danach nicht alles besetzt ist, muss der Planer bestätigen.'; return; }
    apply(pl, p, t);
    pl.proposals[id] = { ...p, status: 'erledigt', gaps: [], updatedAt: t };
    msg = 'Getauscht. Der Plan ist aktualisiert.';
  });
  if (msg) toast(msg);
});

act('prop-confirm', ({ id }) => {
  update(id, (pl, p, t) => {
    if (stale(pl, p)) { pl.proposals[id] = { ...p, status: 'abgelehnt', reply: 'Der Plan hat sich inzwischen geändert.', decidedBy: 'planer', updatedAt: t }; toast('Plan hat sich inzwischen geändert, Vorschlag verfällt', 'error'); return; }
    apply(pl, p, t);
    pl.proposals[id] = { ...p, status: 'erledigt', decidedBy: 'planer', reply: 'vom Planer bestätigt', updatedAt: t };
    toast('Übernommen');
  });
});

act('prop-reject', async ({ id }) => {
  const r = await openModal({
    title: 'Vorschlag ablehnen',
    body: '<label class="field"><span>Begründung (optional)</span><input name="reply" maxlength="120"></label>',
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Ablehnen', kind: 'danger', value: 'ok' }],
    onAction(v, root) { return v ? formData(root) : null; },
  });
  if (!r) return;
  update(id, (pl, p, t) => { pl.proposals[id] = { ...p, status: 'abgelehnt', decidedBy: 'planer', reply: r.reply.trim() || 'vom Planer abgelehnt', updatedAt: t }; });
});

act('planer-swap', ({ d, e }) => {
  document.querySelectorAll('.modal-wrap').forEach((w) => w.remove());
  document.body.classList.remove('modal-open');
  propose(d, e);
});
