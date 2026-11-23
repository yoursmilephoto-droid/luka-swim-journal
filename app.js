'use strict';
const $ = id => document.getElementById(id);
const styles = {free:'Вольный стиль',back:'На спине',breast:'Брасс',fly:'Баттерфляй',medley:'Комплекс'};
const statuses = {verified:'Подтверждён',pending:'Требует сверки',dq:'Дисквалификация'};
const defaultRace = '50:free';
const draftKey = 'luka-swim-drafts-v1';
const form = $('form');
const field = name => form.elements.namedItem(name);
const date = value => value.split('-').reverse().join('.');
const key = row => row.distance + ':' + row.style;
const label = value => {
  const [meters, style] = value.split(':');
  return meters + ' м · ' + styles[style];
};
const time = (value, precision = 2) => {
  if (value === null) return '—';
  const mins = Math.floor(value / 6000);
  const seconds = ((value % 6000) / 100).toFixed(precision).replace('.', ',');
  return mins ? mins + ':' + seconds.padStart(3 + precision, '0') : seconds;
};
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[char]);
const options = (items, formatter) => items.map(item =>
  '<option value="' + escape(item) + '">' + escape(formatter(item)) + '</option>'
).join('');

let rows = [];
let active = defaultRace;
let editId;
let points = [];
let published = [];
let drafts = {};
const editing = () => $('manage').open;
$('manage').ontoggle = () => { if (published.length) render(); };
if (location.hostname.endsWith('.github.io')) {
  const repo = location.pathname.split('/').filter(Boolean)[0];
  if (repo) {
    $('repository').href = 'https://github.com/' + location.hostname.split('.')[0] + '/' + encodeURIComponent(repo) + '/blob/HEAD/starts.json';
    $('repository').hidden = false;
  }
}
$('export').onclick = () => {
  const blob = new Blob([JSON.stringify(rows, null, 2) + '\n'], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'starts.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
field('style').innerHTML = options(Object.keys(styles), value => styles[value]);
$('pool').onchange = () => renderProgress();
const quickRaces = [...document.querySelectorAll('[data-discipline]')];
function chooseRace(value) {
  active = value;
  $('race').value = value;
  const pools = rows.filter(row => key(row) === active && row.status === 'verified')
    .map(row => String(row.pool ?? 'unknown'));
  if (!pools.includes($('pool').value) && pools.length) $('pool').value = pools[0];
  renderProgress();
}
$('race').onchange = () => chooseRace($('race').value);
quickRaces.forEach(button => button.onclick = () => chooseRace(button.dataset.discipline));
for (const [selector, id] of [['.parent-link','parent'], ['#show-history','history'], ['#edit-history','history']]) {
  document.querySelector(selector).addEventListener('click', () => { $(id).open = true; });
}
function openHashTarget() {
  const id = location.hash.slice(1);
  if (id === 'parent' || id === 'history') $(id).open = true;
}
window.addEventListener('hashchange', openHashTarget);
openHashTarget();
$('discipline').onchange = $('status').onchange = () => renderHistory();
$('first').onchange = $('second').onchange = () => compare();
$('close').onclick = () => $('editor').close();
$('add').onclick = () => edit();

function edit(row) {
  editId = row?.id ?? crypto.randomUUID();
  form.reset();
  field('date').value = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date());
  if (row) {
    for (const name of ['date','distance','style','pool','status','event','source','note']) field(name).value = row[name] ?? '';
    field('time').value = row.time === null ? '' : time(row.time);
  }
  $('form-title').textContent = row ? 'Изменить результат' : 'Добавить результат';
  $('error').textContent = '';
  $('editor').showModal();
}

function render() {
  const keys = [...new Set(rows.map(key))];
  if (!keys.includes(active)) active = keys[0] ?? defaultRace;
  $('race').innerHTML = options(keys, label);
  $('race').value = active;
  const filter = $('discipline').value || 'all';
  $('discipline').innerHTML = options(['all', ...keys], value => value === 'all' ? 'Все дисциплины' : label(value));
  $('discipline').value = filter;
  const timed = rows.filter(row => row.status === 'verified');
  const freestyle = timed.filter(row => key(row) === defaultRace && row.pool === 25 && row.time !== null)
    .sort((a,b) => a.date.localeCompare(b.date));
  const best = freestyle.length ? Math.min(...freestyle.map(row => row.time)) : null;
  $('record').textContent = best === null ? '—' : time(best) + ' с';
  renderGoal(freestyle[0]?.time, best);
  quickRaces.forEach(button => { button.hidden = !keys.includes(button.dataset.discipline); });
  const latest = [...timed].sort((a,b) => b.date.localeCompare(a.date)).slice(0,3);
  $('recent').innerHTML = latest.map(row => {
    const link = resultUrl(row);
    const title = escape(label(key(row)));
    return '<li class="recent-result"><p class="recent-date"><time datetime="' + row.date + '">' + date(row.date) +
      '</time>' + (row.event === 'Курсовка' ? ' · Курсовка' : '') + '</p><h3>' + title + '</h3>' +
      '<strong>' + time(row.time, row.precision) + '</strong>' +
      (link ? '<div class="recent-actions"><a href="' + escape(link) + '">О заплыве</a>' + resultShare(row) + '</div>' : '') + '</li>';
  }).join('') || '<li class="empty">Здесь будут твои заплывы.</li>';
  const needsSource = rows.filter(row => row.status === 'pending');
  const extra = rows.filter(row => row.status === 'verified' && (row.id === 'archive-2' || row.pool === null));
  $('missing').innerHTML = [...needsSource, ...extra].sort((a,b) => a.date.localeCompare(b.date))
    .map(row => '<li><strong>' + date(row.date) + ' · ' + label(key(row)) + '</strong><br>' + escape(row.note) + '</li>').join('') ||
    '<li>Все записи сверены.</li>';
  renderProgress();
  renderHistory();
}

function renderGoal(first, best) {
  const standard = 3505;
  const gap = best === null ? null : best - standard;
  $('goal-gap').textContent = gap === null ? '—' : gap > 0 ? time(gap) + ' с' : time(standard) + ' с';
  $('goal-caption').textContent = gap === null ? 'Ждём зачтённое время' :
    gap > 0 ? 'до I юношеского' : 'Норматив I юношеского по времени';
  $('goal-meter').value = best === null ? 0 : first <= standard ? 100 :
    100 * Math.max(0, Math.min(1, (first - best) / (first - standard)));
}

function renderProgress() {
  quickRaces.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.discipline === active)));
  const pool = $('pool').value;
  points = rows.filter(row => key(row) === active && row.status === 'verified' &&
    row.time !== null && String(row.pool ?? 'unknown') === pool).sort((a,b) => a.date.localeCompare(b.date));

  const first = points[0], latest = points.at(-1);
  const canCompare = pool !== 'unknown' && points.length > 1;
  let metric = 'Ждём результат';
  let caption = 'Здесь появится время из протокола.';
  if (canCompare) {
    const change = latest.time - first.time;
    metric = (change < 0 ? '−' : change > 0 ? '+' : '') + time(Math.abs(change)) + ' с';
    caption = change < 0 ? 'Сократил время с первого заплыва' :
      change > 0 ? 'На столько больше, чем в первом заплыве' : 'То же время, что в первом заплыве';
  } else if (latest) {
    metric = time(latest.time, latest.precision) + ' с';
    caption = pool === 'unknown' ? 'Для сравнения нужна длина бассейна.' :
      'Пока одно время в дневнике. Когда появится ещё одно, сможем сравнить.';
  }
  $('delta').textContent = metric;
  $('delta').classList.toggle('metric-empty', !latest);
  $('metric-caption').textContent = caption;
  $('chart').hidden = !latest || pool === 'unknown';
  $('pool-results').innerHTML = pool === 'unknown' ? points.map(row =>
    '<li><span>' + date(row.date) + '</span><strong>' + time(row.time,row.precision) + '</strong></li>'
  ).join('') : '';
  $('chart-values').textContent = '';
  $('split').textContent = '';
  if (!$('chart').hidden) renderPlot(points);

  $('compare').hidden = !canCompare;
  for (const name of ['first','second']) {
    $(name).innerHTML = options(points.map((_,i) => i), i => date(points[i].date) + ' · ' + time(points[i].time, points[i].precision));
  }
  $('second').selectedIndex = points.length - 1;
  compare();
}

function renderPlot(data) {
  const low = Math.min(...data.map(row => row.time)), high = Math.max(...data.map(row => row.time));
  const span = Math.max(60, high - low);
  const positions = data.map((row,i) => [
    data.length === 1 ? 50 : 8 + 84*i/(data.length-1),
    19 + (row.time-low)*62/span
  ]);
  const curve = positions.map(([x,y],i) => (i ? 'L' : 'M') + x + ' ' + y).join(' ');
  const format = row => time(row.time,row.precision);
  $('chart').style.setProperty('--node-size', 'min(42px,' + (84/Math.max(1,data.length-1)) + '%)');
  $('chart').innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="chart-line" pathLength="1" d="' + curve + '"/></svg>' +
    positions.map(([x,y],i) => '<button type="button" class="node" aria-pressed="false" style="left:' + x + '%;top:' + y +
      '%" aria-label="' + escape(date(data[i].date) + ' — ' + format(data[i])) + '"></button>').join('');
  if (data.length > 1) $('chart-values').innerHTML = '<span>' + format(data[0]) + '</span><span>' + format(data.at(-1)) + '</span>';
  const nodes = [...$('chart').querySelectorAll('button')];
  function select(i) {
    nodes.forEach((node,j) => node.setAttribute('aria-pressed', String(i === j)));
    $('split').textContent = date(data[i].date) + ' · ' + format(data[i]) + ' с';
  }
  nodes.forEach((node,i) => { node.onclick = () => select(i); node.onfocus = () => select(i); });
  select(data.length - 1);
}

function compare() {
  const a = points[$('first').value], b = points[$('second').value];
  if (!a || !b) { $('difference').textContent = ''; return; }
  if (a === b) { $('difference').textContent = 'Выберите два разных старта.'; return; }
  const delta = b.time - a.time;
  $('difference').textContent = delta === 0 ? 'Время одинаковое.' :
    'Во втором выбранном старте Лука проплыл на ' + (Math.abs(delta)/100).toFixed(2).replace('.',',') +
    ' с ' + (delta < 0 ? 'быстрее.' : 'медленнее.');
}

function renderHistory() {
  const list = rows.filter(row => ($('discipline').value === 'all' || key(row) === $('discipline').value) &&
    ($('status').value === 'all' || row.status === $('status').value)).sort((a,b) => b.date.localeCompare(a.date));
  $('count').textContent = 'Показано ' + list.length + ' из ' + rows.length;
  $('rows').innerHTML = list.map(row => {
    const details = [
      row.place && row.place + '-е место',
      row.rank && escape(row.rank),
      row.points && row.points + ' ' + escape(row.pointsLabel || 'AQUA')
    ].filter(Boolean).join(' · ');
    const official = row.status === 'dq' ? 'Время не засчитано' : time(row.time, row.precision);
    return '<tr><td>' + date(row.date) + '</td><td>' + label(key(row)) +
      (row.pool ? '<br><small>Бассейн ' + row.pool + ' м</small>' : '') +
      '</td><td class="time">' + official + '</td><td>' + escape(row.event) + '</td><td>' +
      '<span class="badge ' + escape(row.status) + '">' + statuses[row.status] + '</span>' +
      (details ? '<small>' + details + '</small>' : '') +
      (row.source ? '<small>' + (
        /^https:\/\/www\.goswim\.ru\/competitions\/\d+$/.test(row.sourceUrl)
          ? '<a href="' + escape(row.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + escape(row.source) + '</a>'
          : escape(row.source)
      ) + '</small>' : '') +
      (row.note ? '<small>' + escape(row.note) + '</small>' : '') +
      '</td><td>' + resultShare(row) + (editing() ? '<button class="quiet" type="button" data-edit="' + escape(row.id) + '">Изменить</button>' : '') + '</td></tr>';
  }).join('') || '<tr><td colspan="6" class="empty">По этим фильтрам заплывов нет.</td></tr>';
  for (const button of $('rows').querySelectorAll('[data-edit]')) {
    button.onclick = () => edit(rows.find(row => row.id === button.dataset.edit));
  }
}

function parseTime(input) {
  const match = input.trim().match(/^(?:(\d{1,3}):)?(\d{1,4})(?:[,.](\d{1,2}))?$/);
  if (!match || (match[1] && +match[2] >= 60)) return 0;
  const [,minutes,seconds,fraction=''] = match;
  return (+minutes || 0)*6000 + (+seconds)*100 + +fraction.padEnd(2,'0');
}

function mergeDrafts() {
  const merged = new Map(published.map(row => [row.id, row]));
  for (const {base, row} of Object.values(drafts)) {
    if (JSON.stringify(merged.get(row.id) ?? null) === base) merged.set(row.id, row);
  }
  rows = [...merged.values()];
}

form.onsubmit = event => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(form));
  const parsed = parseTime(fields.time);
  const isTimed = fields.status === 'verified';
  if (isTimed && !parsed) {
    $('error').textContent = 'Введите время из итогового протокола, например 42,17 или 3:35,00.';
    return;
  }
  if (fields.status !== 'pending' && !fields.source.trim()) {
    $('error').textContent = 'Укажите название итогового протокола и страницу.';
    return;
  }
  const original = rows.find(row => row.id === editId);
  const row = {...original, ...fields, id:editId, distance:+fields.distance,
    pool:+fields.pool || null, time:isTimed ? parsed : null, source:fields.source.trim()};
  if (row.source !== original?.source) delete row.sourceUrl;
  if (row.time !== original?.time || key(row) !== key(original ?? row) || row.date !== original?.date) {
    for (const name of ['precision','place','rank','points','pointsLabel']) delete row[name];
  }
  const base = JSON.stringify(published.find(item => item.id === row.id) ?? null);
  const next = {...drafts, [row.id]:{base, row}};
  try {
    localStorage.setItem(draftKey, JSON.stringify(next));
    drafts = next;
    mergeDrafts();
    render();
    $('editor').close();
    $('notice').textContent = 'Черновик сохранён в этом браузере. Скачайте starts.json, чтобы опубликовать изменения.';
  } catch {
    $('error').textContent = 'Браузер заблокировал сохранение черновика.';
  }
};

async function load() {
  try {
    const response = await fetch('./starts.json', {cache:'no-cache'});
    if (!response.ok) throw new Error();
    published = await response.json();
    try { drafts = JSON.parse(localStorage.getItem(draftKey)) ?? {}; } catch { drafts = {}; }
    mergeDrafts();
    render();
    $('add').disabled = false;
    $('export').disabled = false;
  } catch {
    $('notice').textContent = 'Не удалось загрузить заплывы. Попробуй обновить страницу.';
  }
}
const publicJournal = 'https://yoursmilephoto-droid.github.io/luka-swim-journal/';
const shareMessages = {
  site: 'Мои заплывы и личные рекорды. Заходите посмотреть! 🏊',
  'success-50': 'Я проплыл 50 м кролем за 42,17 с и занял 5-е место из 13! 🏊',
  'success-400': 'Я проплыл 400 м вольным стилем за 8:30,9 — на 28,29 с быстрее! 🏊',
  'success-back': 'Я проплыл 50 м на спине за 59,71 с и впервые выплыл из минуты! 🏊'
};
$('close-share').onclick = () => $('share-dialog').close();
$('copy-share').onclick = async () => {
  const field = $('share-text');
  field.select();
  try {
    await navigator.clipboard.writeText(field.value);
    $('share-status').textContent = 'Скопировано. Можно вставить в MAX.';
  } catch {
    $('share-status').textContent = 'Текст выделен. Нажми «Копировать» в меню телефона.';
  }
};
function resultUrl(row) {
  const saved = published.find(item => item.id === row.id);
  if (!saved || saved.status !== 'verified' || saved.time === null ||
      JSON.stringify(saved) !== JSON.stringify(row) || !/^[a-z0-9-]+$/.test(row.id)) return '';
  return './swims/' + row.id + '/';
}

function resultShare(row) {
  if (!resultUrl(row)) return '';
  const description = date(row.date) + ' · ' + label(key(row));
  return '<button class="quiet result-share" type="button" data-share-result="' + escape(row.id) +
    '" aria-label="Поделиться заплывом, ' + escape(description) + '">Поделиться</button>';
}

function openShare(text, url) {
  const message = text + '\n' + url;
  $('share-text').value = message;
  $('send-max').href = 'https://max.ru/:share?text=' + encodeURIComponent(message);
  $('share-status').textContent = '';
  $('share-dialog').showModal();
}

document.addEventListener('click', event => {
  const result = event.target.closest('[data-share-result]');
  if (result) {
    const row = rows.find(item => item.id === result.dataset.shareResult);
    const link = row && resultUrl(row);
    if (link) {
      const text = '🏊 Лука · ' + label(key(row)) + ' — ' + time(row.time, row.precision) +
        ' (' + date(row.date) + ')';
      openShare(text, new URL(link, publicJournal).href);
    }
    return;
  }
  const target = event.target.closest('[data-share]')?.dataset.share;
  if (target && Object.hasOwn(shareMessages, target)) {
    openShare(shareMessages[target], publicJournal + (target === 'site' ? '' : '#' + target));
  }
});

load();
