// Einstiegspunkt
import { boot } from './app.js';
import './views/plan.js';
import './views/month.js';
import './views/times.js';
import './views/vacation.js';
import './views/settings.js';
import './pdf.js';

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

boot().catch((e) => {
  console.error(e);
  document.getElementById('app').innerHTML = `<main class="screen"><div class="center-card"><h2>Fehler beim Start</h2><p>${String(e.message || e).replace(/</g, '&lt;')}</p><button class="btn primary" onclick="location.reload()">Neu laden</button></div></main>`;
});
