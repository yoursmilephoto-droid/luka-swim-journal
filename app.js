'use strict';
const $ = id => document.getElementById(id);
const styles = {free:'Вольный стиль',back:'На спине',breast:'Брасс',fly:'Баттерфляй',medley:'Комплекс'};
const statuses = {verified:'Подтверждён',pending:'Требует сверки',dq:'Дисквалификация'};
const defaults = ['50:free','50:back','50:breast','50:fly','100:medley','100:free','400:free'];
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
let active = defaults[0];
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
  const keys = [...new Set([...defaults, ...rows.map(key)])];
  const filter = $('discipline').value || 'all';
  $('discipline').innerHTML = options(['all', ...keys], value => value === 'all' ? 'Все дисциплины' : label(value));
  $('discipline').value = filter;
  const timed = rows.filter(row => row.status === 'verified');
  const freestyle = timed.filter(row => key(row) === '50:free' && row.pool === 25);
  const best = freestyle.length ? time(Math.min(...freestyle.map(row => row.time))) + ' с' : '—';
  const longest = Math.max(0, ...timed.map(row => row.distance));
  const stats = [
    ['Лучшие 50 м кролем · бассейн 25 м', best],
    ['Самый длинный заплыв', longest ? longest + ' м' : '—'],
    ['Заплывов со временем', timed.length]
  ];
  const needsSource = rows.filter(row => row.status === 'pending');
  const extra = rows.filter(row => row.status === 'verified' && (row.id === 'archive-2' || row.pool === null));
  $('missing').innerHTML = [...needsSource, ...extra].sort((a,b) => a.date.localeCompare(b.date))
    .map(row => '<li><strong>' + date(row.date) + ' · ' + label(key(row)) + '</strong><br>' + escape(row.note) + '</li>').join('') ||
    '<li>Все записи сверены.</li>';
  $('stats').innerHTML = stats.map(([title, number]) => '<article class="metric"><span>' + title + '</span><strong>' + number + '</strong></article>').join('');
  $('tabs').replaceChildren(...keys.map(value => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label(value);
    button.dataset.key = value;
    button.onclick = () => {
      active = value;
      const verified = rows.filter(row => key(row) === value && row.status === 'verified');
      const pools = verified.map(row => String(row.pool ?? 'unknown'));
      if (!pools.includes($('pool').value)) $('pool').value = pools[0] ?? '25';
      renderProgress();
    };
    return button;
  }));
  renderProgress();
  renderHistory();
}

function renderProgress() {
  for (const button of $('tabs').children) button.setAttribute('aria-pressed', String(button.dataset.key === active));
  points = rows.filter(row => key(row) === active && row.status === 'verified' &&
    row.time !== null && String(row.pool ?? 'unknown') === $('pool').value).sort((a,b) => a.date.localeCompare(b.date));
  const unknownPool = $('pool').value === 'unknown';
  $('chart').innerHTML = unknownPool && points.length > 1
    ? '<ul class="result-list">' + points.map(row => '<li><span>' + date(row.date) +
      '</span><strong>' + time(row.time, row.precision) + '</strong></li>').join('') + '</ul>'
    : chart(points);
  const latest = points.at(-1);
  const previous = points.at(-2);
  let title = 'Ждём подтверждённое время';
  let message = 'Когда появится результат из протокола, он будет здесь.';
  if (latest) {
    title = points.length === 1 ? 'Твоя точка отсчёта' : 'Результаты заплывов';
    message = unknownPool ? 'Для сравнения нужно узнать длину бассейна.' :
      'После следующего заплыва на этой дистанции ты сможешь сравнить время.';
  }
  if (!unknownPool && previous) {
    const delta = latest.time - previous.time;
    const total = latest.time - points[0].time;
    title = delta === 0 ? 'То же время, что в прошлый раз' :
      time(Math.abs(delta)) + ' с ' + (delta < 0 ? 'быстрее' : 'медленнее') + ', чем в прошлый раз';
    const sinceFirst = points.length < 3 ? '' : total === 0 ? ' В первом заплыве было такое же время.' :
      ' С первого заплыва время стало на ' + time(Math.abs(total)) + ' с ' + (total < 0 ? 'меньше.' : 'больше.');
    message = time(previous.time) + ' → ' + time(latest.time) + ' с.' + sinceFirst +
      (delta < 0 ? ' Здорово, Лука! Запомни, что помогло тебе плыть быстрее.' :
        ' Бывает. Выбери с тренером одну вещь, которую хочешь попробовать на следующем старте.');
  }
  $('progress-summary').innerHTML = '<h3>' + title + '</h3><p>' + message + '</p>';
  $('compare').hidden = unknownPool || points.length < 2;
  for (const name of ['first','second']) {
    $(name).innerHTML = options(points.map((_, i) => i), i => date(points[i].date) + ' · ' + time(points[i].time));
  }
  $('second').selectedIndex = points.length - 1;
  compare();
}

function chart(data) {
  if (!data.length) return '<p class="empty">Для этой дисциплины и бассейна пока нет подтверждённого времени.</p>';
  const times = data.map(row => row.time);
  const min = Math.min(...times), max = Math.max(...times);
  const span = Math.max(max - min, 200);
  const timestamps = data.map(row => Date.parse(row.date));
  const first = timestamps[0], last = timestamps.at(-1);
  const width = $('chart').clientWidth < 520 ? 340 : 800;
  const coords = times.map((value,i) => [
    first === last ? (times.length === 1 ? width / 2 : 52 + i * (width - 104) / (times.length-1)) :
      52 + (timestamps[i] - first) * (width - 104) / (last - first),
    32 + (value - min + (span - (max-min))/2) * 110 / span
  ]);
  const marks = coords.map(([x,y],i) => {
    const showValue = data.length <= 5 || i === data.length - 1;
    return '<circle cx="' + x + '" cy="' + y + '" r="5"><title>' + date(data[i].date) + ' · ' + time(times[i], data[i].precision) + '</title></circle>' +
      (showValue ? '<text class="value" x="' + x + '" y="' + (y-14) + '" text-anchor="middle">' + time(times[i], data[i].precision) + '</text>' : '');
  }).join('');
  const ticks = (data.length > 1 ? [0, data.length - 1] : [0]).map(i =>
    '<text x="' + coords[i][0] + '" y="178" text-anchor="middle">' + date(data[i].date) + '</text>').join('');
  const grid = [40,85,130,155].map(y => '<path class="grid" d="M22 ' + y + 'H' + (width-22) + '"/>').join('');
  const chartLabel = data.length === 1 ? 'Первый подтверждённый старт · ' + time(times[0], data[0].precision) : 'График времени по датам';
  return '<svg role="img" aria-label="' + chartLabel + '" viewBox="0 0 ' + width + ' 188">' +
    grid + '<polyline class="line" points="' + coords.map(c => c.join(',')).join(' ') + '"/>' +
    marks + ticks + '</svg>';
}

function compare() {
  const a = points[$('first').value], b = points[$('second').value];
  if (!a || !b) return;
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
      (row.source ? '<small>' + escape(row.source) + '</small>' : '') +
      (row.note ? '<small>' + escape(row.note) + '</small>' : '') +
      '</td><td>' + (editing() ? '<button class="quiet" type="button" data-edit="' + escape(row.id) + '">Изменить</button>' : '') + '</td></tr>';
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
    $('notice').textContent = 'Не удалось загрузить историю. Обнови страницу, чтобы попробовать ещё раз.';
  }
}
load();
