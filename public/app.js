'use strict';

// ─── World/Canvas config ─────────────────────────────────────────────────────
const WW = 100, WH = 60;
let CW = 0, CH = 0, SX = 0, SY = 0;

const canvas  = document.getElementById('world');
const ctx     = canvas.getContext('2d');
const wrap    = document.getElementById('canvas-wrap');

function resizeCanvas() {
  CW = wrap.clientWidth;
  CH = wrap.clientHeight;
  canvas.width  = CW;
  canvas.height = CH;
  SX = CW / WW;
  SY = CH / WH;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ─── State ───────────────────────────────────────────────────────────────────
let world    = null;   // full world object from last 'state' ws message
let agents   = [];
let foodNodes   = [];
let fireNodes   = [];
let shelterNodes = [];

// ─── WebSocket ───────────────────────────────────────────────────────────────
const WS_URL = `ws://${location.host}`;
let ws;

function connect() {
  ws = new WebSocket(WS_URL);
  ws.addEventListener('open',    ()  => console.log('[WS] connected'));
  ws.addEventListener('close',   ()  => setTimeout(connect, 2000));
  ws.addEventListener('error',   ()  => ws.close());
  ws.addEventListener('message', ev => handleMsg(JSON.parse(ev.data)));
  setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping' })); }, 20000);
}
connect();

function handleMsg(msg) {
  switch (msg.type) {
    case 'state':   onState(msg.data);   break;
    case 'event':   onEvent(msg.data);   break;
    case 'gods':    onGods(msg.data);    break;
    case 'audio':   onAudio(msg.data);   break;
  }
}

// ─── State update ────────────────────────────────────────────────────────────
function onState(data) {
  world        = data;
  agents       = data.agents       || [];
  foodNodes    = data.foodNodes    || [];
  fireNodes    = data.fireNodes    || [];
  shelterNodes = data.shelterNodes || [];

  // Header
  document.getElementById('h-day').textContent    = data.day      ?? 0;
  document.getElementById('h-pop').textContent    = data.population ?? 0;
  document.getElementById('h-era').textContent    = data.era      ?? '—';
  document.getElementById('h-season').textContent = data.season   ?? '—';
  document.getElementById('h-tech').textContent   = data.techLevel ?? 0;

  const tempEl = document.getElementById('h-temp');
  const temp   = data.temperature ?? 0;
  tempEl.textContent = `${temp > 0 ? '+' : ''}${temp.toFixed(0)}°`;
  tempEl.className   = `chip-val ${temp < 0 ? 'text-cblue' : temp > 30 ? 'text-cred' : 'text-gray-300'}`;

  setWeather((data.weather?.type ?? data.weather) || 'clear');

  // HUD
  document.getElementById('day-num').textContent = data.day ?? 0;
  document.getElementById('h-day').textContent   = data.day ?? 0;
  const fill = ((data.dayProgress ?? 0) * 100).toFixed(1);
  document.getElementById('day-fill').style.width = fill + '%';
  document.getElementById('hud-time').textContent = data.isDay ? '☀️ DZIEŃ' : '🌙 NOC';

  // Stats row
  document.getElementById('s-births').textContent    = data.stats?.births    ?? 0;
  document.getElementById('s-deaths').textContent    = data.stats?.deaths    ?? 0;
  document.getElementById('s-disasters').textContent = data.stats?.disasters ?? 0;
  document.getElementById('s-plugins').textContent   = data.pluginCount ?? data.stats?.plugins ?? 0;

  // Hide loading screen on first state
  const loader = document.getElementById('loading');
  if (loader && !loader.classList.contains('done')) {
    loader.classList.add('done');
    loader.style.transition = 'opacity .6s';
    loader.style.opacity = '0';
    setTimeout(() => loader.remove(), 650);
  }

  renderFrame();
}

// ─── Weather ─────────────────────────────────────────────────────────────────
const WEATHER_PROFILES = {
  clear:    { icon: '☀️',  label: 'Bezchmurnie', bodyClass: '' },
  rain:     { icon: '🌧️',  label: 'Deszcz',       bodyClass: '' },
  storm:    { icon: '⛈️',  label: 'Burza',        bodyClass: 'weather-storm' },
  blizzard: { icon: '❄️',  label: 'Zamieć',       bodyClass: 'weather-blizzard' },
  drought:  { icon: '🏜️',  label: 'Susza',        bodyClass: 'weather-drought' },
  heatwave: { icon: '🔥',  label: 'Upał',         bodyClass: 'weather-heatwave' },
  fog:      { icon: '🌫️',  label: 'Mgła',         bodyClass: 'weather-fog' },
};

let currentWeather = 'clear';

function setWeather(type) {
  if (type === currentWeather) return;
  currentWeather = type;

  const prof = WEATHER_PROFILES[type] || WEATHER_PROFILES.clear;
  document.getElementById('h-weather-icon').textContent  = prof.icon;
  document.getElementById('h-weather-label').textContent = prof.label;
  document.documentElement.setAttribute('data-weather', type);

  // Body classes
  document.body.className = document.body.className
    .replace(/weather-\S+/g, '').trim();
  if (prof.bodyClass) document.body.classList.add(prof.bodyClass);

  // CSS overlays
  document.getElementById('rain-overlay').style.opacity =
    (type === 'rain' || type === 'storm') ? '1' : '0';
  document.getElementById('snow-overlay').style.opacity =
    (type === 'blizzard') ? '0.85' : '0';
}

// ─── Lightning flash ─────────────────────────────────────────────────────────
function flashLightning() {
  const el = document.getElementById('lightning-overlay');
  el.classList.remove('active');
  void el.offsetWidth;
  el.style.opacity = '1';
  el.classList.add('active');
  setTimeout(() => { el.style.opacity = '0'; el.classList.remove('active'); }, 250);
}

// ─── Event → Timeline ────────────────────────────────────────────────────────
const MAX_TL = 80;

function classifyEvent(text) {
  const t = text.toLowerCase();
  if (t.includes('urodzi') || t.includes('narodzin'))        return 'ev-birth';
  if (t.includes('zmar') || t.includes('zgon') || t.includes('śmier')) return 'ev-death';
  if (t.includes('piorun') || t.includes('katastrof') || t.includes('zaraza') || t.includes('klęsk')) return 'ev-disaster';
  if (t.includes('architekt') || t.includes('chaos') || t.includes('bóg')) return 'ev-gods';
  if (t.includes('technolog') || t.includes('wynalaz') || t.includes('era')) return 'ev-tech';
  if (t.includes('burza') || t.includes('pogoda') || t.includes('śnieg') || t.includes('deszcz')) return 'ev-weather';
  return 'ev-default';
}

function onEvent(ev) {
  const text = ev.text || ev.message || String(ev);

  // Lightning visual trigger
  if (/piorun/i.test(text)) flashLightning();

  const tl   = document.getElementById('timeline');
  const cls  = classifyEvent(text);
  const day  = ev.day ?? (world?.day ?? '?');

  const entry = document.createElement('div');
  entry.className = `tl-entry ${cls}`;
  entry.innerHTML =
    `<div class="tl-day">DZIEŃ ${day}</div>` +
    `<div class="tl-text">${escHtml(text)}</div>`;

  tl.prepend(entry);

  // Trim excess entries
  while (tl.children.length > MAX_TL) tl.lastChild.remove();
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Gods panel ──────────────────────────────────────────────────────────────
function onGods(data) {
  const archPanel  = document.getElementById('arch-panel');
  const chaosPanel = document.getElementById('chaos-panel');

  document.getElementById('arch-decision').textContent  = data.architectDecision  || '—';
  document.getElementById('arch-narrative').textContent = data.architectNarrative || '';
  document.getElementById('chaos-decision').textContent  = data.chaosDecision     || '—';
  document.getElementById('chaos-narrative').textContent = data.chaosNarrative    || '';

  archPanel.classList.add('active');
  chaosPanel.classList.add('active');
  setTimeout(() => {
    archPanel.classList.remove('active');
    chaosPanel.classList.remove('active');
  }, 3500);

  // Also add to timeline
  if (data.architectDecision && data.architectDecision !== '—') {
    onEvent({ text: `🏛️ Architekt: ${data.architectDecision}`, day: world?.day });
  }
  if (data.chaosDecision && data.chaosDecision !== '—') {
    onEvent({ text: `⚡ Chaos: ${data.chaosDecision}`, day: world?.day });
  }
}

// ─── TTS Audio ───────────────────────────────────────────────────────────────
const audioQueue = [];
let audioPlaying = false;

function onAudio(data) {
  audioQueue.push(data);
  if (!audioPlaying) playNextAudio();
}

function playNextAudio() {
  if (!audioQueue.length) { audioPlaying = false; hideAudioRow(); return; }
  audioPlaying = true;
  const { base64, title } = audioQueue.shift();
  showAudioRow(title || 'Narrator mówi...');
  const audio = new Audio('data:audio/mpeg;base64,' + base64);
  audio.onended = () => { setTimeout(playNextAudio, 500); };
  audio.onerror = () => { setTimeout(playNextAudio, 500); };
  audio.play().catch(() => playNextAudio());
}

function showAudioRow(label) {
  const row = document.getElementById('audio-row');
  document.getElementById('audio-label').textContent = label;
  row.classList.remove('hidden');
  row.classList.add('flex');
}
function hideAudioRow() {
  const row = document.getElementById('audio-row');
  row.classList.add('hidden');
  row.classList.remove('flex');
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────
let hoveredAgent = null;
const tooltip = document.getElementById('tooltip');

canvas.addEventListener('mousemove', ev => {
  const rect = canvas.getBoundingClientRect();
  const mx   = (ev.clientX - rect.left) / SX;
  const my   = (ev.clientY - rect.top)  / SY;

  let found = null;
  for (const a of agents) {
    if (!a.dead && Math.sqrt((a.x - mx)**2 + (a.y - my)**2) < 3.5) {
      found = a; break;
    }
  }

  if (found) {
    hoveredAgent = found;
    updateTooltip(found);
    const tx = ev.clientX - rect.left + 14;
    const ty = ev.clientY - rect.top  - 20;
    tooltip.style.left = Math.min(tx, CW - 240) + 'px';
    tooltip.style.top  = Math.max(ty, 4) + 'px';
    tooltip.classList.remove('hidden');
  } else {
    hoveredAgent = null;
    tooltip.classList.add('hidden');
  }
});
canvas.addEventListener('mouseleave', () => {
  hoveredAgent = null;
  tooltip.classList.add('hidden');
});

function updateTooltip(a) {
  document.getElementById('tt-name').textContent = a.name;
  document.getElementById('tt-sub').textContent  =
    `${a.gender === 'M' ? 'Mężczyzna' : 'Kobieta'} · Wiek: ${a.age.toFixed(0)} dni · ${a.state}`;

  setBar('bt-energy', a.energy);
  setBar('bt-hunger', a.hunger);
  setBar('bt-warmth', a.warmth);
  setBar('bt-health', a.health);

  const genesEl = document.getElementById('tt-genes');
  genesEl.innerHTML = '';
  if (a.genes) {
    for (const [k, v] of Object.entries(a.genes)) {
      const span = document.createElement('div');
      span.className = 'text-cdim';
      span.innerHTML = `<span class="text-gray-400">${k.slice(0,5)}</span> <b class="text-cblue">${v.toFixed(0)}</b>`;
      genesEl.appendChild(span);
    }
  }

  document.getElementById('tt-thought').textContent = a.thought ? `"${a.thought}"` : '';
  document.getElementById('tt-psych').textContent   = a.psychState ? `[${a.psychState}]` : '';

  const treeBtn = document.getElementById('tt-tree-btn');
  treeBtn.onclick = () => openGenealogy(a.id);
}

function setBar(id, val) {
  document.getElementById(id).style.width = Math.max(0, Math.min(100, val)).toFixed(1) + '%';
}

// ─── Genealogy modal ─────────────────────────────────────────────────────────
async function openGenealogy(agentId) {
  tooltip.classList.add('hidden');
  const modal   = document.getElementById('gen-modal');
  const title   = document.getElementById('gen-title');
  const content = document.getElementById('gen-content');

  content.innerHTML = '<div class="text-cdim text-xs py-4 text-center">Ładowanie...</div>';
  modal.classList.remove('hidden');

  try {
    const resp = await fetch('/genealogy');
    const data = await resp.json();
    const target = data.find(a => a.id === agentId);
    if (!target) { content.innerHTML = '<div class="text-cred text-xs py-2">Brak danych.</div>'; return; }

    title.textContent = `🌳 Ród — ${target.name}`;
    content.innerHTML = '';
    renderGenNode(content, target, data, 0);
  } catch (e) {
    content.innerHTML = `<div class="text-cred text-xs py-2">Błąd: ${e.message}</div>`;
  }
}

function renderGenNode(container, node, all, depth) {
  if (depth > 3) return;
  const div = document.createElement('div');
  div.className = `gen-node${node.dead ? ' dead' : ''}`;
  div.style.marginLeft = (depth * 14) + 'px';
  const color = node.gender === 'M' ? '#5599ff' : '#ff55bb';
  div.innerHTML =
    `<span class="gen-dot" style="background:${color}"></span>` +
    `<span class="text-gray-300 font-mono">${escHtml(node.name)}</span>` +
    `<span class="text-cdim ml-1">Wiek ${node.age}</span>` +
    (node.dead ? '<span class="text-cred ml-1">✝</span>' : '');
  container.appendChild(div);

  for (const cid of (node.childrenIds || [])) {
    const child = all.find(a => a.id === cid);
    if (child) renderGenNode(container, child, all, depth + 1);
  }
}

document.getElementById('gen-close').addEventListener('click', () => {
  document.getElementById('gen-modal').classList.add('hidden');
});

// ─── Canvas Renderer ─────────────────────────────────────────────────────────
const TERRAIN_SEED = 42;

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

// Pre-generate terrain features (trees, rocks) once
const terrainFeatures = (() => {
  const rng    = seededRng(TERRAIN_SEED);
  const trees  = [];
  const rocks  = [];
  for (let i = 0; i < 35; i++) {
    trees.push({ x: rng() * WW, y: rng() * WH, r: 1.1 + rng() * 0.9, v: rng() });
  }
  for (let i = 0; i < 18; i++) {
    rocks.push({ x: rng() * WW, y: rng() * WH, r: 0.6 + rng() * 0.5 });
  }
  return { trees, rocks };
})();

function renderFrame() {
  if (!world) return;
  ctx.clearRect(0, 0, CW, CH);

  drawBackground();
  drawTerrain();
  drawResources();
  drawAgents();

  if (hoveredAgent) {
    const ha = agents.find(a => a.id === hoveredAgent.id);
    if (ha) updateTooltip(ha);
  }
}

function drawBackground() {
  const night = !world.isDay;
  const grad  = ctx.createLinearGradient(0, 0, 0, CH);
  if (night) {
    grad.addColorStop(0, '#020408');
    grad.addColorStop(1, '#030609');
  } else if (currentWeather === 'drought' || currentWeather === 'heatwave') {
    grad.addColorStop(0, '#1a1205');
    grad.addColorStop(1, '#0f0a03');
  } else {
    grad.addColorStop(0, '#040810');
    grad.addColorStop(1, '#060c14');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CW, CH);

  // Grid lines (very subtle)
  ctx.strokeStyle = 'rgba(22,32,64,.25)';
  ctx.lineWidth   = 0.5;
  const gs = 10 * SX;
  for (let x = 0; x < CW; x += gs) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,CH); ctx.stroke(); }
  const gsY = 10 * SY;
  for (let y = 0; y < CH; y += gsY) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(CW,y); ctx.stroke(); }
}

function drawTerrain() {
  const night = !world.isDay;
  const alpha = night ? 0.35 : 0.55;

  // Rocks
  for (const r of terrainFeatures.rocks) {
    const rx = r.x * SX, ry = r.y * SY, rr = r.r * SX;
    ctx.fillStyle = `rgba(40,50,70,${alpha})`;
    ctx.beginPath();
    ctx.ellipse(rx, ry, rr * 1.4, rr * 0.9, r.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Trees
  for (const t of terrainFeatures.trees) {
    drawTree(t.x * SX, t.y * SY, t.r * SX, night, alpha);
  }
}

function drawTree(x, y, r, night, alpha) {
  const season = world?.season || 'Wiosna';
  let foliage;
  if (season === 'Zima')  foliage = `rgba(200,220,255,${alpha * 0.55})`;
  else if (season === 'Jesień') foliage = `rgba(200,100,30,${alpha * 0.9})`;
  else if (night) foliage = `rgba(10,55,20,${alpha})`;
  else foliage = `rgba(20,80,35,${alpha * 1.1})`;

  // Trunk
  ctx.strokeStyle = `rgba(60,40,20,${alpha})`;
  ctx.lineWidth   = r * 0.45;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + r * 1.1); ctx.stroke();

  // Canopy layers
  for (let i = 2; i >= 0; i--) {
    ctx.fillStyle = foliage;
    ctx.beginPath();
    ctx.arc(x, y - i * r * 0.55, r * (1.0 - i * 0.15), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawResources() {
  // Food nodes
  for (const f of foodNodes) {
    if (f.food < 3) continue;
    const fx = f.x * SX, fy = f.y * SY;
    const intensity = Math.min(1, f.food / 100);
    ctx.fillStyle = `rgba(61,220,140,${0.25 + intensity * 0.45})`;
    ctx.beginPath();
    ctx.arc(fx, fy, 2.2 * SX * intensity, 0, Math.PI * 2);
    ctx.fill();
    // Glow
    ctx.shadowColor = '#3ddc8c';
    ctx.shadowBlur  = 6;
    ctx.fillStyle   = `rgba(61,220,140,${0.4 + intensity * 0.3})`;
    ctx.beginPath();
    ctx.arc(fx, fy, 1.1 * SX, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Fire nodes
  for (const f of fireNodes) {
    const fx = f.x * SX, fy = f.y * SY;
    ctx.shadowColor = '#ff8822';
    ctx.shadowBlur  = 14;
    ctx.fillStyle   = '#ff6600';
    ctx.beginPath(); ctx.arc(fx, fy, 2.5 * SX, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle   = '#ffcc44';
    ctx.beginPath(); ctx.arc(fx, fy, 1.3 * SX, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur  = 0;
    // Flicker
    const t = Date.now() * 0.005;
    ctx.fillStyle = `rgba(255,200,60,${0.6 + Math.sin(t + fx) * 0.3})`;
    ctx.beginPath(); ctx.arc(fx, fy - SY * 1.5, SX * 0.8, 0, Math.PI * 2); ctx.fill();
  }

  // Shelter nodes
  for (const s of shelterNodes) {
    const sx2 = s.x * SX, sy2 = s.y * SY;
    ctx.fillStyle   = 'rgba(85,153,255,.12)';
    ctx.strokeStyle = 'rgba(85,153,255,.35)';
    ctx.lineWidth   = 0.8;
    ctx.beginPath(); ctx.arc(sx2, sy2, 3.5 * SX, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5599ff';
    ctx.beginPath(); ctx.arc(sx2, sy2, 1 * SX, 0, Math.PI * 2); ctx.fill();
  }
}

function drawAgents() {
  for (const a of agents) {
    if (a.dead) { drawDyingAgent(a); continue; }
    drawTrail(a);
    drawHumanoid(a);
  }
}

function drawTrail(a) {
  if (!a.trail || a.trail.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(a.trail[0].x * SX, a.trail[0].y * SY);
  for (let i = 1; i < a.trail.length; i++) {
    ctx.lineTo(a.trail[i].x * SX, a.trail[i].y * SY);
  }
  ctx.lineTo(a.x * SX, a.y * SY);
  ctx.strokeStyle = a.gender === 'M'
    ? 'rgba(85,153,255,.12)'
    : 'rgba(255,85,187,.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawHumanoid(a) {
  const ax = a.x * SX, ay = a.y * SY;
  const sc = SX * 0.9; // scale

  // State-based glow
  let glowColor = null;
  if (a.state === 'dying')     glowColor = '#e83a4a';
  else if (a.state === 'gestating') glowColor = '#aa55ff';
  else if (a.state === 'warm') glowColor = '#ff8822';
  if (glowColor) {
    ctx.shadowColor = glowColor;
    ctx.shadowBlur  = 10;
  }

  // Head
  ctx.fillStyle = a.skinTone || '#c47a3a';
  ctx.beginPath();
  ctx.arc(ax, ay - sc * 2.2, sc * 0.9, 0, Math.PI * 2);
  ctx.fill();

  // Hair
  ctx.fillStyle = a.hairColor || '#3a2a10';
  ctx.beginPath();
  ctx.arc(ax, ay - sc * 2.2, sc * 0.9, Math.PI, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = a.color || '#5599ff';
  ctx.fillRect(ax - sc * 0.55, ay - sc * 1.7, sc * 1.1, sc * 1.6);

  // Legs
  ctx.fillRect(ax - sc * 0.55, ay - sc * 0.1, sc * 0.45, sc * 1.1);
  ctx.fillRect(ax + sc * 0.1,  ay - sc * 0.1, sc * 0.45, sc * 1.1);

  ctx.shadowBlur = 0;

  // Pregnancy indicator
  if (a.gestatingDays > 0) {
    ctx.fillStyle = 'rgba(170,85,255,.55)';
    ctx.beginPath();
    ctx.arc(ax, ay - sc * 0.9, sc * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  // Name label (only when close enough on a larger canvas)
  if (SX > 7) {
    ctx.font      = `${Math.max(8, SX * 0.9)}px "Roboto Mono", monospace`;
    ctx.fillStyle = 'rgba(200,210,240,.7)';
    ctx.textAlign = 'center';
    ctx.fillText(a.name, ax, ay - sc * 3.4);
    ctx.textAlign = 'left';
  }
}

function drawDyingAgent(a) {
  const ax = a.x * SX, ay = a.y * SY;
  const fade = Math.max(0, 1 - a.dyingTicks / 25);
  ctx.globalAlpha = fade * 0.6;
  ctx.fillStyle = '#e83a4a';
  ctx.beginPath();
  ctx.arc(ax, ay, SX * 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ─── Render loop ──────────────────────────────────────────────────────────────
let lastRaf = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  if (ts - lastRaf < 80) return; // ~12 fps cap (server drives state)
  lastRaf = ts;
  if (world) renderFrame();
}
requestAnimationFrame(loop);
