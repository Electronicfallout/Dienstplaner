// Einstiegspunkt
import { boot } from './app.js';
import './views/plan.js';
import './views/month.js';
import './views/times.js';
import './views/vacation.js';
import './views/settings.js';

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e));
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('app').innerHTML = `<main class="screen"><div class="center-card"><h2>Fehler beim Start</h2><p>${String(e.message || e).replace(/</g, '&lt;')}</p><button class="btn primary" onclick="location.reload()">Neu laden</button></div></main>`;
});
