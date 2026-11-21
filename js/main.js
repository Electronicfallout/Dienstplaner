// Einstiegspunkt
import { boot } from './app.js';
import { esc } from './ui.js';
import './views/plan.js';
import './views/month.js';
import './views/times.js';
import './views/vacation.js';
import './views/settings.js';
import './pdf.js';
import './dnd.js';
import './reports.js';

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch((e) => console.warn('SW', e));
  // Neue Version übernommen: einmal neu laden, damit sie sofort sichtbar ist
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded || document.querySelector('.modal-wrap')) return;
    reloaded = true;
    location.reload();
  });
}

// Plan-Tabellen so hoch machen, dass sie bis zum unteren Rand reichen: dann scrollt man in der Tabelle
// und Namenszeile oben sowie Tagesspalte links bleiben stehen (wie fixierte Zeilen in Excel).
function fitTables() {
  const bar = document.querySelector('.tabs');
  const barH = bar && getComputedStyle(bar).position === 'fixed' ? bar.offsetHeight : 0;
  document.querySelectorAll('.table-scroll').forEach((el) => {
    if (!el.querySelector(':scope > table.plan')) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const h = Math.max(300, window.innerHeight - top - barH - 12);
    el.style.maxHeight = h + 'px';
  });
}
let fitT = 0;
const fitSoon = () => { clearTimeout(fitT); fitT = setTimeout(fitTables, 30); };
new MutationObserver(fitSoon).observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('resize', fitSoon);

boot().catch((e) => {
  console.error(e);
  document.getElementById('app').innerHTML = `<main class="screen"><div class="center-card"><h2>Fehler beim Start</h2><p>${esc(e.message || e)}</p><button class="btn primary" data-act="reload">Neu laden</button></div></main>`;
});
