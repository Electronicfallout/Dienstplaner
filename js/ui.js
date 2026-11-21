// Kleine UI-Helfer: Escape, Dialoge, Hinweise, Klick-Verteilung.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------- Aktionen per data-act ----------
const actions = {};
export function act(name, fn) { actions[name] = fn; }

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  ev.preventDefault();
  Promise.resolve(fn(el.dataset, el, ev)).catch((e) => { console.error(e); toast(e.message || String(e), 'error'); });
});

// ---------- Hinweis unten ----------
let toastTimer;
export function toast(msg, kind = 'info', action) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'toast-btn'; b.textContent = action.label;
    b.addEventListener('click', () => { t.className = ''; action.fn(); });
    t.appendChild(b);
  }
  t.className = 'show ' + kind + (action ? ' has-btn' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, kind === 'error' ? 6000 : action ? 7000 : 2800);
}

// ---------- Dialog ----------
// Dialoge an den sichtbaren Bereich anpassen: geht am Handy die Tastatur oder die Zeitauswahl auf,
// bleibt der Knopf zum Speichern trotzdem sichtbar (iPhone und ältere Android-Browser).
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => {
    document.documentElement.style.setProperty('--vv-h', vv.height + 'px');
    document.documentElement.style.setProperty('--vv-top', vv.offsetTop + 'px');
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  fit();
}
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!el.closest || !el.closest('.modal-body')) return;
  setTimeout(() => el.scrollIntoView({ block: 'nearest' }), 300);
});
// openModal({title, body (HTML), buttons:[{label, kind, value}], onOpen(root), onAction(value, root) -> false hält offen})
export function openModal({ title, body, buttons = [], onOpen, onAction, wide }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
        <div class="modal-body">${body}</div>
        ${buttons.length ? `<div class="modal-foot">${buttons.map((b, i) => `<button class="btn ${b.kind || ''}" data-mbtn="${i}">${esc(b.label)}</button>`).join('')}</div>` : ''}
      </div>`;
    document.body.appendChild(wrap);
    document.body.classList.add('modal-open');
    const root = wrap.querySelector('.modal');
    const close = (v) => {
      wrap.remove();
      if (!$('.modal-wrap')) { document.body.classList.remove('modal-open'); document.dispatchEvent(new Event('modal-closed')); }
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape' && wrap === $$('.modal-wrap').pop()) close(null); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(null); });
    root.querySelector('[data-close]').addEventListener('click', () => close(null));
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-mbtn]');
      if (!b) return;
      const btn = buttons[+b.dataset.mbtn];
      if (onAction) {
        try {
          const r = await onAction(btn.value, root);
          if (r === false) return;
          close(r === undefined ? btn.value : r);
        } catch (err) { console.error(err); toast(err.message || String(err), 'error'); }
      } else close(btn.value);
    });
    root.closeModal = close;
    if (onOpen) onOpen(root, close);
    const first = root.querySelector('input:not([type=hidden]):not([readonly]), select, textarea');
    if (first && window.matchMedia('(min-width: 700px)').matches) setTimeout(() => first.focus(), 30);
  });
}

export async function confirmBox(text, okLabel = 'OK', danger = false) {
  const r = await openModal({
    title: 'Bitte bestätigen',
    body: `<p>${esc(text)}</p>`,
    buttons: [{ label: 'Abbrechen', value: false }, { label: okLabel, kind: danger ? 'danger' : 'primary', value: true }],
  });
  return r === true;
}

export async function promptPassword(title, text, { confirm = false, okLabel = 'Weiter', user = null } = {}) {
  return openModal({
    title,
    body: `<p>${esc(text)}</p>
      ${user ? `<label class="field"><span>Benutzer</span><input type="text" name="username" autocomplete="username" value="${esc(user)}" readonly></label>` : ''}
      <label class="field"><span>Passwort</span><input type="password" name="pw" autocomplete="${confirm ? 'new-password' : 'current-password'}"></label>
      ${confirm ? '<label class="field"><span>Passwort wiederholen</span><input type="password" name="pw2" autocomplete="new-password"></label>' : ''}`,
    buttons: [{ label: 'Abbrechen', value: null }, { label: okLabel, kind: 'primary', value: 'ok' }],
    onOpen(root) {
      root.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') root.querySelector('[data-mbtn="1"]').click(); }));
    },
    onAction(v, root) {
      if (v !== 'ok') return null;
      const pw = root.querySelector('[name=pw]').value;
      if (pw.length < 4) { toast('Mindestens 4 Zeichen', 'error'); return false; }
      if (confirm && pw !== root.querySelector('[name=pw2]').value) { toast('Passwörter stimmen nicht überein', 'error'); return false; }
      return pw;
    },
  });
}

export function formData(root) {
  const o = {};
  root.querySelectorAll('[name]').forEach((el) => {
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  });
  return o;
}

// Externes Skript einmalig laden (für Excel-Export, QR-Code)
const loaded = {};
export function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('Konnte Bibliothek nicht laden (offline?)')); };
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}

export function download(name, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Datei auswählen (Input muss im DOM hängen, sonst reagieren manche Browser nicht)
export function pickFile(accept) {
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => { res(inp.files[0] || null); inp.remove(); });
    inp.click();
  });
}
