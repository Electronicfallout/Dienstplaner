// Beim Öffnen von Plan, Monat, Zeiten und Urlaub automatisch zum heutigen Tag und zur eigenen Spalte springen.
// Pro Gerät abschaltbar (Schalter in der Werkzeugleiste).
import { App } from './app.js';
import { LS } from './storage.js';

export const jumpOn = () => LS.get('dp.jump') !== 'off';

// Ansicht wurde neu geöffnet (Start, Reiter, „Heute“): beim nächsten Zeichnen springen
export function requestJump() { App.jumpPending = true; }

export function jumpToggleHtml() {
  return `<label class="jump-toggle" title="Beim Öffnen zum heutigen Tag${App.cfg.empId ? ' und zu deiner Spalte' : ''} springen"><input type="checkbox" data-jump-toggle ${jumpOn() ? 'checked' : ''}><span>Zu heute springen</span></label>`;
}

export function maybeJump(main) {
  if (!App.jumpPending) return;
  App.jumpPending = false;
  if (!jumpOn()) return;
  // erst nach dem Zeichnen messen
  requestAnimationFrame(() => {
    const day = main.querySelector('[data-day].today');
    if (day) {
      // Monatstabelle scrollt in sich selbst (feste Höhe): zuerst darin zur Zeile scrollen
      const box = day.closest('.table-scroll');
      if (box && box.scrollHeight > box.clientHeight + 2) {
        const th = box.querySelector('thead');
        const off = day.getBoundingClientRect().top - box.getBoundingClientRect().top - (th ? th.getBoundingClientRect().height : 0) - 8;
        box.scrollTop += off - day.getBoundingClientRect().height * 2;
      }
      const head = (document.querySelector('.topbar') || { offsetHeight: 0 }).offsetHeight;
      if (box && box.scrollHeight > box.clientHeight + 2) {
        window.scrollTo(0, Math.max(0, box.getBoundingClientRect().top + window.scrollY - head - 8));
      } else {
        const top = day.getBoundingClientRect().top + window.scrollY;
        const thead = day.closest('table') ? (day.closest('table').querySelector('thead') || { offsetHeight: 0 }).offsetHeight : 0;
        window.scrollTo(0, Math.max(0, top - head - thead - 56));
      }
    }
    // Spalte der eigenen Person (Plan/Monat) bzw. aktuelle Woche (Urlaubsübersicht) sichtbar machen
    let scroller = null, me = null;
    for (const s of main.querySelectorAll('.table-scroll')) {
      me = s.querySelector('thead th.me') || s.querySelector('thead th.today');
      if (me) { scroller = s; break; }
    }
    if (me) {
      const sticky = scroller.querySelector('thead th.sticky');
      const sw = sticky ? sticky.getBoundingClientRect().width : 0;
      const sr = scroller.getBoundingClientRect(), mr = me.getBoundingClientRect();
      const visL = sr.left + sw, visR = sr.right;
      if (mr.left < visL || mr.right > visR) scroller.scrollLeft += me.classList.contains('today') ? mr.left - (visL + visR) / 2 : mr.left - visL - 8;
    }
  });
}

// Kein data-act: das würde den Klick auf die Checkbox abfangen
document.addEventListener('change', (e) => {
  const el = e.target;
  if (!el.matches || !el.matches('[data-jump-toggle]')) return;
  LS.set('dp.jump', el.checked ? 'on' : 'off');
  if (el.checked) { requestJump(); maybeJump(document.getElementById('main')); }
});
