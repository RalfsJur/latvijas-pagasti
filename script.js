
const KEY = 'latvijas_pagasti_v1';
const DATA_FILE = 'pagasti.geojson';


const NAME_FIELD = null;

const SKIP_NON_PAGASTS = true;
const WORLD_W = 2000;   

let parishes = {};      // normalizēts nosaukums -> {name, features: [], paths: []}
let guessed = JSON.parse(localStorage.getItem(KEY) || '[]');
let totalCount = 0;
let byBase = {};
let W = 1, H = 1, ready = false, touched = false;
const T = {k: 1, x: 0, y: 0};
let kMin = 0.5, kMax = 50;

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const mapEl = $('map'), view = $('view'), base = $('base'), won = $('won');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const stripType = k => {
  const w = k.split(' ');
  return w.length > 1 && w[w.length - 1] === 'pagasts' ? w.slice(0, -1).join(' ') : k;
};
const lookup = input => byBase[stripType(norm(input))] || [];
const firstCoord = c => typeof c[0] === 'number' ? c : firstCoord(c[0]);


fetch(DATA_FILE)
  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
  .then(startGame)
  .catch(err => {
    console.error(err);
    $('loadStatus').textContent = 'Neizdevās ielādēt datus (' + DATA_FILE + '): ' + err.message +
      '. Ja atver failu tieši no mapes, palaid vietējo serveri (python -m http.server).';
  });

function startGame(geo) {
  const keys = Object.keys(geo.features[0].properties);
  const nf = NAME_FIELD || keys.find(k => /^(nosaukums|name)$/i.test(k)) ||
    keys.find(k => /nosauk|name|nos/i.test(k)) || keys[0];

  
  const f0 = geo.features.find(f => f.geometry && f.geometry.coordinates && f.geometry.coordinates.length);
  const planar = Math.abs(firstCoord(f0.geometry.coordinates)[0]) > 180;
  const cl = Math.cos(56.9 * Math.PI / 180);
  const pr = c => planar ? [c[0], c[1]] : [c[0] * cl, c[1]];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  parishes = {}; byBase = {}; totalCount = 0;
  for (const ft of geo.features) {
    const name = ft.properties[nf];
    if (!name || !ft.geometry) continue;
    const k = norm(name);
    if (!k) continue;
    const last = k.split(' ').pop();
    if (SKIP_NON_PAGASTS && (last === 'novads' || last === 'pilseta')) continue;
    const g = ft.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    if (!polys.length) continue;
    ft._rings = polys.flat().map(ring => ring.map(c => {
      const p = pr(c);
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      return p;
    }));
    (parishes[k] ||= {name: String(name).trim(), features: [], paths: []}).features.push(ft);
    totalCount++;
  }
  for (const k of Object.keys(parishes)) (byBase[stripType(k)] ||= []).push(k);

  const s = WORLD_W / (maxX - minX);
  W = WORLD_W; H = (maxY - minY) * s;
  let html = '';
  for (const [k, p] of Object.entries(parishes)) {
    for (const ft of p.features) {
      const d = ft._rings.map(r => 'M' + r.map(c =>
        ((c[0] - minX) * s).toFixed(1) + ' ' + ((maxY - c[1]) * s).toFixed(1)).join('L') + 'Z').join('');
      html += `<path data-k="${k}" d="${d}"/>`;
      delete ft._rings;
    }
  }
  base.innerHTML = html;
  base.querySelectorAll('path').forEach(p => parishes[p.getAttribute('data-k')].paths.push(p));

  guessed = guessed.filter(k => parishes[k]);
  $('total').textContent = totalCount;
  $('loader').hidden = true;
  $('guess').disabled = $('go').disabled = false;
  $('guess').focus();
  ready = true;
  fit();
  guessed.forEach(draw);
  render();
}


function apply() { view.setAttribute('transform', `translate(${T.x} ${T.y}) scale(${T.k})`); }
function fit() {
  const w = mapEl.clientWidth, h = mapEl.clientHeight, top = 80, pad = 24;
  const availH = Math.max(50, h - top - pad);
  const k = Math.min((w - pad * 2) / W, availH / H);
  T.k = k; T.x = (w - W * k) / 2; T.y = top + (availH - H * k) / 2;
  kMin = k * 0.9; kMax = k * 40;
  apply();
}
function zoomAt(px, py, f) {
  const nk = Math.min(kMax, Math.max(kMin, T.k * f));
  f = nk / T.k;
  T.x = px - (px - T.x) * f; T.y = py - (py - T.y) * f; T.k = nk;
  touched = true; apply();
}
new ResizeObserver(() => { if (ready && !touched) fit(); }).observe(mapEl);
mapEl.addEventListener('wheel', e => {
  e.preventDefault();
  const r = mapEl.getBoundingClientRect();
  zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
}, {passive: false});
$('zin').onclick = () => zoomAt(mapEl.clientWidth / 2, mapEl.clientHeight / 2, 1.6);
$('zout').onclick = () => zoomAt(mapEl.clientWidth / 2, mapEl.clientHeight / 2, 1 / 1.6);

const ptrs = new Map();
mapEl.addEventListener('pointerdown', e => {
  if (e.target.closest('.zoom')) return;
  const r = mapEl.getBoundingClientRect();
  ptrs.set(e.pointerId, {x: e.clientX - r.left, y: e.clientY - r.top});
  mapEl.setPointerCapture(e.pointerId);
  mapEl.classList.add('drag');
});
mapEl.addEventListener('pointermove', e => {
  const prev = ptrs.get(e.pointerId);
  if (!prev) return;
  const r = mapEl.getBoundingClientRect();
  const cur = {x: e.clientX - r.left, y: e.clientY - r.top};
  if (ptrs.size === 1) {
    T.x += cur.x - prev.x; T.y += cur.y - prev.y; touched = true; apply();
  } else if (ptrs.size === 2) {
    const other = [...ptrs.entries()].find(([id]) => id !== e.pointerId)[1];
    const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
    const d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
    if (d0 > 0) zoomAt((cur.x + other.x) / 2, (cur.y + other.y) / 2, d1 / d0);
  }
  ptrs.set(e.pointerId, cur);
});
const endPtr = e => { ptrs.delete(e.pointerId); if (!ptrs.size) mapEl.classList.remove('drag'); };
mapEl.addEventListener('pointerup', endPtr);
mapEl.addEventListener('pointercancel', endPtr);


function draw(k) {
  for (const p of parishes[k].paths) {
    p.classList.add('on');
    won.appendChild(p);   // virs pārējiem, lai dzeltenā robeža nav aizsegta
    const t = document.createElementNS(NS, 'title');
    t.textContent = parishes[k].name;
    p.appendChild(t);
  }
}
function pulse(k) {
  if (reduced) return;
  for (const p of parishes[k].paths)
    p.animate([{fill: '#ffffff'}, {fill: '#ffd23f'}], {duration: 900, easing: 'ease-out'});
}
function say(text, cls) {
  const m = $('msg'); m.textContent = text; m.className = 'show ' + cls;
  clearTimeout(say.t); say.t = setTimeout(() => m.className = '', 2500);
}
const countOf = ks => ks.reduce((s, k) => s + parishes[k].features.length, 0);

function submit() {
  const raw = $('guess').value;
  if (!norm(raw)) return;
  const keys = lookup(raw);
  if (!keys.length) { say('Tāda pagasta nav sarakstā', 'err'); return; }
  const fresh = keys.filter(k => !guessed.includes(k));
  if (!fresh.length) {
    say('Šo jau esi atminējis', 'err');
    keys.forEach(pulse);
    return;
  }
  fresh.forEach(k => { guessed.unshift(k); draw(k); pulse(k); });
  localStorage.setItem(KEY, JSON.stringify(guessed));
  $('guess').value = '';
  const n = countOf(fresh);
  say('✓ ' + fresh.map(k => parishes[k].name).join(', ') + (n > 1 ? ` (${n} pagasti)` : ''), 'ok');
  render(fresh[0]);
}
$('go').onclick = submit;
$('guess').addEventListener('keydown', e => e.key === 'Enter' && submit());


function render(newKey) {
  $('cnt').textContent = countOf(guessed);
  $('empty').hidden = guessed.length > 0;
  $('rows').innerHTML = guessed.map(k =>
    `<li class="${k === newKey ? 'new' : ''}">${parishes[k].name}</li>`).join('');
}
$('reset').onclick = () => {
  if (!confirm('Dzēst visu progresu?')) return;
  for (const k of guessed) for (const p of parishes[k].paths) {
    p.classList.remove('on'); p.replaceChildren(); base.appendChild(p);
  }
  guessed = []; localStorage.removeItem(KEY); render();
};


(() => {
  const grip = $('grip'), panel = $('panel');
  let startY = null, startH = 0;
  grip.addEventListener('pointerdown', e => {
    startY = e.clientY; startH = panel.offsetHeight;
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener('pointermove', e => {
    if (startY === null) return;
    const h = Math.min(innerHeight * 0.85, Math.max(130, startH + startY - e.clientY));
    panel.style.setProperty('--ph', h + 'px');
  });
  const end = () => { startY = null; };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
})();
