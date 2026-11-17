// Ziehen & Tauschen im Plan (nur Planer): Eintrag mit gedrückter Maustaste auf einen anderen ziehen,
// am Handy lange drücken und dann ziehen. Die beiden Einträge werden getauscht.

import { App, isAdmin } from './app.js';
import { esc, toast, openModal } from './ui.js';
import * as K from './calc.js';
import { planEntry, entryText, setEntry, coverageGaps, employed } from './model.js';
import { now, clone } from './store.js';

const SEL = '[data-act="edit-entry"],[data-act="edit-entry-m"]';
const HOLD_MS = 380;

function rec(pe) {
  if (!pe) return null;
  const { source, updatedAt, ...r } = pe;
  return r;
}

function swap(plan, a, b, t) {
  const ra = rec(planEntry(plan, a.d, a.e));
  const rb = rec(planEntry(plan, b.d, b.e));
  setEntry(plan, a.d, a.e, rb, t);
  setEntry(plan, b.d, b.e, ra, t);
}

function newGaps(plan, a, b) {
  const sim = clone(plan);
  swap(sim, a, b, now());
  const out = [];
  for (const d of [...new Set([a.d, b.d])]) {
    const before = new Set(coverageGaps(plan, d));
    const added = coverageGaps(sim, d).filter((g) => !before.has(g));
    if (added.length) out.push(`${K.WOCHENTAGE[K.weekday(d)]} ${K.fmtDate(d, true)}: ${added.join(', ')}`);
  }
  return out;
}

const nm = (plan, id) => (plan.employees[id] || {}).name || '?';

async function doSwap(a, b) {
  const plan = App.plan.obj;
  for (const x of [a, b]) {
    const pe = planEntry(plan, x.d, x.e);
    if (pe && pe.source === 'feiertag') { toast('Feiertage lassen sich nicht verschieben', 'error'); return; }
    if (!employed(plan.employees[x.e], x.d)) return;
  }
  const ta = entryText(plan, a.d, a.e) || 'leer', tb = entryText(plan, b.d, b.e) || 'leer';
  if (ta === tb && a.d === b.d) { toast('Beide Einträge sind gleich'); return; }
  const gaps = newGaps(plan, a, b);
  if (gaps.length) {
    const ok = await openModal({
      title: 'Trotzdem tauschen?',
      body: `<p>${esc(nm(plan, a.e))} (${esc(ta)}) ⇄ ${esc(nm(plan, b.e))} (${esc(tb)})</p>
        <p class="warn-text">Danach fehlt die Besetzung:</p><ul>${gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>`,
      buttons: [{ label: 'Abbrechen', value: null }, { label: 'Tauschen', kind: 'primary', value: 'ok' }],
    });
    if (!ok) return;
  }
  // alter Stand fürs Rückgängigmachen (null = Eintrag war nicht gesetzt → Vorlage gilt wieder)
  const keep = [a, b].map((x) => {
    const pe = planEntry(plan, x.d, x.e);
    return { ...x, r: pe && pe.source === 'plan' ? rec(pe) : null };
  });
  App.plan.update((p) => swap(p, a, b, now()));
  const same = a.e === b.e;
  const msg = same ? `${nm(plan, a.e)}: ${K.fmtDate(a.d, true)} ⇄ ${K.fmtDate(b.d, true)} getauscht`
    : `${nm(plan, a.e)} ⇄ ${nm(plan, b.e)} getauscht`;
  toast(msg, 'info', {
    label: 'Rückgängig',
    fn: () => App.plan.update((p) => { const t = now(); for (const k of keep) setEntry(p, k.d, k.e, k.r, t); }),
  });
}

// ---------- Zeiger-Logik ----------

let st = null; // { src, x, y, pid, touch, timer, drag, ghost, over }
let swallowClick = false;

function cellAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const c = el && el.closest(SEL);
  return c && c !== st.src ? c : null;
}

function startDrag() {
  st.drag = true;
  clearTimeout(st.timer);
  st.src.classList.add('dnd-src');
  document.body.classList.add('dnd-on');
  const g = document.createElement('div');
  g.className = 'dnd-ghost';
  g.innerHTML = st.src.innerHTML;
  const r = st.src.getBoundingClientRect();
  g.style.width = Math.max(60, Math.min(220, r.width)) + 'px';
  document.body.appendChild(g);
  st.ghost = g;
  moveGhost(st.x, st.y);
  if (st.touch && navigator.vibrate) { try { navigator.vibrate(25); } catch { /* egal */ } }
}

function moveGhost(x, y) {
  st.ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
  const c = cellAt(x, y);
  if (c !== st.over) {
    if (st.over) st.over.classList.remove('dnd-over');
    if (c) c.classList.add('dnd-over');
    st.over = c;
  }
}

function end(commit) {
  if (!st) return;
  clearTimeout(st.timer);
  const { src, over, drag, ghost } = st;
  if (ghost) ghost.remove();
  src.classList.remove('dnd-src');
  if (over) over.classList.remove('dnd-over');
  document.body.classList.remove('dnd-on');
  st = null;
  if (drag) {
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 400);
    if (commit && over) {
      doSwap({ d: src.dataset.d, e: src.dataset.e }, { d: over.dataset.d, e: over.dataset.e })
        .catch((e) => { console.error(e); toast(e.message || String(e), 'error'); });
    }
  }
}

document.addEventListener('pointerdown', (ev) => {
  if (st) { end(false); return; } // zweiter Finger (z. B. Zoomen) bricht ab
  if (!isAdmin() || ev.button > 0 || document.querySelector('.modal-wrap')) return;
  const src = ev.target.closest(SEL);
  if (!src) return;
  const touch = ev.pointerType !== 'mouse';
  st = { src, x: ev.clientX, y: ev.clientY, pid: ev.pointerId, touch, drag: false, over: null };
  if (touch) st.timer = setTimeout(() => { if (st && !st.drag) startDrag(); }, HOLD_MS);
});

document.addEventListener('pointermove', (ev) => {
  if (!st || ev.pointerId !== st.pid) return;
  const dx = ev.clientX - st.x, dy = ev.clientY - st.y;
  if (!st.drag) {
    if (st.touch) { if (Math.hypot(dx, dy) > 10) end(false); return; } // Wischen = scrollen
    if (Math.hypot(dx, dy) < 6) return;
    startDrag();
  }
  st.x = ev.clientX; st.y = ev.clientY;
  moveGhost(st.x, st.y);
  ev.preventDefault();
});

document.addEventListener('pointerup', (ev) => { if (st && ev.pointerId === st.pid) end(true); });
document.addEventListener('pointercancel', (ev) => { if (st && ev.pointerId === st.pid) end(false); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && st) end(false); });

// Beim Ziehen am Handy nicht scrollen, kein Kontextmenü beim langen Drücken
document.addEventListener('touchmove', (ev) => { if (st && st.drag) ev.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', (ev) => { if (st) ev.preventDefault(); });
window.addEventListener('click', (ev) => {
  if (swallowClick) { swallowClick = false; ev.stopPropagation(); ev.preventDefault(); }
}, true);
