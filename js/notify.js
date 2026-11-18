// Hinweise in der App: Urlaubsentscheidungen, Planänderungen, fehlende Stunden, neue Veröffentlichungen.
// Es gibt keinen Server, daher erscheinen Hinweise beim nächsten Öffnen der App (Glocke oben).

import { App, isAdmin, timesOf, empDoc } from './app.js';
import { esc, act, openModal } from './ui.js';
import * as K from './calc.js';
import { employeesSorted, planEntry, resolve, alive, isPublished, employed } from './model.js';
import { LS } from './storage.js';
import { proposalNotices } from './proposals.js';

const seenKey = () => `dp.seen:${App.cfg.role}:${App.cfg.empId || ''}`;
export const getSeen = () => Number(LS.get(seenKey()) || 0);
const setSeen = (t) => LS.set(seenKey(), String(t));

// Tage der letzten abgeschlossenen Woche mit geplantem Dienst, aber ohne erfasste Zeit
export function missingTimes(empId) {
  const plan = App.plan.obj;
  const times = timesOf(empId);
  if (!times) return null; // nicht lesbar / noch nicht angemeldet
  const emp = { id: empId, ...plan.employees[empId] };
  if (emp.noTimes) return null;
  const from = plan.settings.saldoFrom || '0000-00-00';
  const mon = K.addDays(K.mondayOf(K.today()), -7);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = K.addDays(mon, i);
    if (d < from || !employed(emp, d) || !isPublished(plan, d)) continue;
    const r = resolve(plan, planEntry(plan, d, empId), emp, d);
    if (r && (r.type === 'shift' || r.status === 'ZA') && !alive(times[d])) out.push(d);
  }
  return { week: K.isoWeek(mon), days: out };
}

function fmtRange(a, b) { return a === b ? K.fmtDate(a, true) : `${K.fmtDate(a)}–${K.fmtDate(b, true)}`; }

export function collect() {
  const plan = App.plan.obj;
  const todo = [];   // bleibt, bis erledigt
  const news = [];   // { at, icon, text, sub }
  const admin = isAdmin();
  const changes = Object.values(plan.changes || {}).filter(alive);

  if (admin) {
    for (const e of employeesSorted(plan)) {
      const doc = empDoc(e.id);
      if (doc && doc.obj) {
        for (const r of Object.values(doc.obj.requests || {})) {
          if (alive(r) && r.status === 'offen') todo.push({ icon: '🌴', text: `${e.name} beantragt ${r.kind || 'Urlaub'} ${fmtRange(r.from, r.to)}`, view: 'vacation' });
          if (alive(r) && r.status === 'zurückgezogen') news.push({ at: r.updatedAt, icon: '↩️', text: `${e.name} hat den Antrag ${fmtRange(r.from, r.to)} zurückgezogen` });
        }
      }
      const m = missingTimes(e.id);
      if (m && m.days.length) todo.push({ icon: '⏱️', text: `${e.name}: Stunden für KW ${m.week} fehlen`, sub: m.days.map((d) => `${K.WOCHENTAGE[K.weekday(d)]} ${K.fmtDate(d)}`).join(', '), view: 'times', emp: e.id });
    }
  } else {
    const me = App.cfg.empId;
    const doc = App.me && App.me.doc;
    for (const r of Object.values((doc && doc.obj.requests) || {})) {
      if (!alive(r) || (r.status !== 'genehmigt' && r.status !== 'abgelehnt')) continue;
      news.push({
        at: r.updatedAt, icon: r.status === 'genehmigt' ? '✅' : '❌',
        text: `Dein Antrag ${r.kind || 'Urlaub'} ${fmtRange(r.from, r.to)} wurde ${r.status}`,
        sub: r.reply ? `Antwort: ${r.reply}` : '', view: 'vacation',
      });
    }
    for (const c of changes) {
      if (c.empId !== me) continue;
      news.push({ at: c.at, icon: '🔄', text: `Dein Dienst am ${K.WOCHENTAGE[K.weekday(c.date)]} ${K.fmtDate(c.date)} wurde geändert`, sub: `${c.from} → ${c.to}`, view: 'plan', date: c.date });
    }
    if (plan.settings.publishedAt && plan.settings.publishedUntil) {
      news.push({ at: plan.settings.publishedAt, icon: '📅', text: `Dienstplan veröffentlicht bis ${K.fmtDate(plan.settings.publishedUntil, true)}`, view: 'plan' });
    }
    const m = missingTimes(me);
    if (m && m.days.length) todo.push({ icon: '⏱️', text: `Bitte trag deine Stunden für KW ${m.week} ein`, sub: m.days.map((d) => `${K.WOCHENTAGE[K.weekday(d)]} ${K.fmtDate(d)}`).join(', '), view: 'times' });
  }
  const pn = proposalNotices(plan);
  todo.unshift(...pn.todo); // Tausch-Anfragen ganz oben
  news.push(...pn.news);
  news.sort((a, b) => b.at - a.at);
  const seen = getSeen();
  const unread = news.filter((n) => n.at > seen).length;
  return { todo, news: news.slice(0, 40), unread, seen, count: todo.length + unread };
}

export function bellHtml() {
  const { count } = collect();
  return `<span aria-hidden="true">🔔</span>${count ? `<span class="badge">${count > 9 ? '9+' : count}</span>` : ''}`;
}

export function updateBell() {
  const b = document.getElementById('bell');
  if (b) { b.innerHTML = bellHtml(); b.setAttribute('aria-label', 'Hinweise'); }
}

function changeList(limitDays = 60) {
  const plan = App.plan.obj;
  const since = Date.now() - limitDays * 86400000;
  const list = Object.values(plan.changes || {}).filter((c) => alive(c) && c.at >= since).sort((a, b) => b.at - a.at);
  if (!list.length) return '<p class="muted small">Noch keine Änderungen an veröffentlichten Tagen.</p>';
  const me = App.cfg.empId;
  return `<ul class="notif-list">${list.map((c) => {
    const e = plan.employees[c.empId];
    return `<li class="${c.empId === me ? 'unread' : ''}"><span class="ic">🔄</span><div class="grow">${esc(e && !e.deleted ? e.name : '?')}: ${K.WOCHENTAGE[K.weekday(c.date)]} ${K.fmtDate(c.date, true)}
      <small>${esc(c.from)} → ${esc(c.to)} · geändert ${new Date(c.at).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></div></li>`;
  }).join('')}</ul>`;
}

export async function openNotices() {
  const c = collect();
  const item = (n, unread) => `<li class="${unread ? 'unread' : ''} ${n.view ? 'clickable' : ''}" ${n.view ? `data-go="${n.view}" data-emp="${n.emp || ''}" data-date="${n.date || ''}"` : ''}>
    <span class="ic">${n.icon}</span><div class="grow">${esc(n.text)}${n.sub ? `<small>${esc(n.sub)}</small>` : ''}${n.at ? `<small>${new Date(n.at).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>` : ''}</div></li>`;
  await openModal({
    title: 'Hinweise',
    wide: true,
    body: `
      ${c.todo.length ? `<h3>Zu erledigen</h3><ul class="notif-list">${c.todo.map((n) => item(n, true)).join('')}</ul>` : ''}
      <h3>Neuigkeiten</h3>
      ${c.news.length ? `<ul class="notif-list">${c.news.map((n) => item(n, n.at > c.seen)).join('')}</ul>` : '<p class="muted small">Nichts Neues.</p>'}
      <h3>Änderungen am veröffentlichten Plan (alle)</h3>
      ${changeList()}`,
    onOpen(root, close) {
      root.addEventListener('click', (e) => {
        const li = e.target.closest('[data-go]');
        if (!li) return;
        close(null);
        const { go, emp, date } = li.dataset;
        if (emp) App.tEmp = emp;
        if (date) App.week = K.mondayOf(date);
        document.querySelector(`.tab[data-view="${go}"]`)?.click();
      });
    },
  });
  setSeen(Date.now());
  updateBell();
}

act('notices', () => openNotices());

// Beim Start: Mitarbeiter bekommen neue Hinweise sofort angezeigt
let shownOnStart = false;
export function maybeShowOnStart() {
  if (shownOnStart) return;
  const c = collect();
  if (!isAdmin() && (c.unread || c.todo.length)) { shownOnStart = true; openNotices(); }
  else if (isAdmin() && c.count) shownOnStart = true;
}
