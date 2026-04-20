'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const WORLD_W = 100, WORLD_H = 60;
let canvasW = 0, canvasH = 0, scaleX = 0, scaleY = 0;
const AGENT_RADIUS = 5;

// ─── State ────────────────────────────────────────────────────────────────────
let prevState = null, currState = null, lerpT = 0;
let lastStateTime = 0;

// ─── Canvas setup ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');
let terrainCache = null;

function resize() {
  const wrap = document.getElementById('canvas-wrap');
  canvasW = wrap.clientWidth;
  canvasH = wrap.clientHeight;
  canvas.width = canvasW;
  canvas.height = canvasH;
  scaleX = canvasW / WORLD_W;
  scaleY = canvasH / WORLD_H;
  terrainCache = null;
}

window.addEventListener('resize', resize);
resize();

// ─── Terrain generation ───────────────────────────────────────────────────────
function buildTerrainCanvas() {
  const tc = document.createElement('canvas');
  tc.width = canvasW; tc.height = canvasH;
  const tctx = tc.getContext('2d');

  // Background gradient
  const bg = tctx.createRadialGradient(canvasW/2, canvasH/2, 0, canvasW/2, canvasH/2, canvasW * 0.7);
  bg.addColorStop(0,   '#0d1f0d');
  bg.addColorStop(0.5, '#0a1a0a');
  bg.addColorStop(1,   '#070f12');
  tctx.fillStyle = bg;
  tctx.fillRect(0, 0, canvasW, canvasH);

  // Terrain patches (plains/forest/hills)
  const patches = [
    { x: 20, y: 15, r: 14, color: 'rgba(20,60,20,0.5)' },
    { x: 80, y: 15, r: 12, color: 'rgba(20,60,20,0.5)' },
    { x: 50, y: 30, r: 18, color: 'rgba(25,50,15,0.4)' },
    { x: 20, y: 45, r: 13, color: 'rgba(20,60,20,0.5)' },
    { x: 80, y: 45, r: 11, color: 'rgba(20,60,20,0.5)' },
    { x: 10, y: 30, r: 8,  color: 'rgba(40,35,20,0.4)' },
    { x: 90, y: 30, r: 8,  color: 'rgba(40,35,20,0.4)' },
    { x: 50, y: 5,  r: 6,  color: 'rgba(15,40,50,0.5)' },
    { x: 50, y: 55, r: 6,  color: 'rgba(15,40,50,0.5)' },
  ];

  for (const p of patches) {
    const grad = tctx.createRadialGradient(p.x * scaleX, p.y * scaleY, 0, p.x * scaleX, p.y * scaleY, p.r * scaleX);
    grad.addColorStop(0, p.color);
    grad.addColorStop(1, 'transparent');
    tctx.fillStyle = grad;
    tctx.fillRect(0, 0, canvasW, canvasH);
  }

  // Grid overlay
  tctx.strokeStyle = 'rgba(255,255,255,0.02)';
  tctx.lineWidth = 0.5;
  for (let x = 0; x < canvasW; x += scaleX * 10) { tctx.beginPath(); tctx.moveTo(x, 0); tctx.lineTo(x, canvasH); tctx.stroke(); }
  for (let y = 0; y < canvasH; y += scaleY * 10) { tctx.beginPath(); tctx.moveTo(0, y); tctx.lineTo(canvasW, y); tctx.stroke(); }

  return tc;
}

// ─── Draw helpers ─────────────────────────────────────────────────────────────
function wx(x) { return x * scaleX; }
function wy(y) { return y * scaleY; }

function drawGlow(x, y, r, color, alpha = 0.4) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
  g.addColorStop(0, color.replace(')', `,${alpha})`).replace('rgb', 'rgba'));
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fill();
}

function lerp(a, b, t) { return a + (b - a) * t; }

function lerpAgent(prev, curr, t) {
  if (!prev) return curr;
  return { ...curr, x: lerp(prev.x, curr.x, t), y: lerp(prev.y, curr.y, t) };
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render(ts) {
  if (!currState) { requestAnimationFrame(render); return; }

  if (!terrainCache || terrainCache.width !== canvasW) terrainCache = buildTerrainCanvas();

  const dt = ts - lastStateTime;
  lerpT = Math.min(1, dt / 500);

  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.drawImage(terrainCache, 0, 0);

  const s = currState;
  const p = prevState;

  // Food nodes
  for (const f of (s.foodNodes || [])) {
    if (f.food < 5) continue;
    const alpha = f.food / 100;
    const px = wx(f.x), py = wy(f.y);
    ctx.beginPath();
    ctx.arc(px, py, 4 * alpha + 1, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,255,100,${alpha * 0.8})`;
    ctx.fill();
    drawGlow(px, py, 5 * alpha, 'rgb(0,255,100)', alpha * 0.15);
  }

  // Shelter nodes
  for (const sh of (s.shelterNodes || [])) {
    const px = wx(sh.x), py = wy(sh.y);
    ctx.fillStyle = 'rgba(150,100,50,0.7)';
    ctx.fillRect(px - 6, py - 5, 12, 10);
    ctx.strokeStyle = 'rgba(200,150,80,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px - 6, py - 5, 12, 10);
  }

  // Fire nodes
  for (const fi of (s.fireNodes || [])) {
    const px = wx(fi.x), py = wy(fi.y);
    const flicker = 0.7 + Math.sin(Date.now() * 0.008) * 0.3;
    drawGlow(px, py, 8 * flicker, 'rgb(255,100,0)', 0.5 * flicker);
    ctx.beginPath();
    ctx.arc(px, py, 3 * flicker, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,180,0,${flicker})`;
    ctx.fill();
  }

  // Agents
  const prevMap = new Map((p?.agents || []).map(a => [a.id, a]));
  for (const curr of (s.agents || [])) {
    const prev = prevMap.get(curr.id);
    const a = lerpAgent(prev, curr, lerpT);
    drawAgent(a);
  }

  // Night overlay
  const nightProgress = s.isDay ? 0 : Math.min(1, (1 - s.dayProgress * 2 + 1) * 1.5);
  const nightAlpha = s.isDay ? 0 : Math.max(0, (s.dayProgress < 0.2 ? (0.2 - s.dayProgress) / 0.2 : (s.dayProgress - 0.8) / 0.2) * 0.65);
  if (nightAlpha > 0.01) {
    ctx.fillStyle = `rgba(0,0,30,${nightAlpha})`;
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  requestAnimationFrame(render);
}

function drawAgent(a) {
  const px = wx(a.x), py = wy(a.y);
  const isDying = a.state === 'dying';
  const isPregnant = a.state === 'pregnant';

  // Trail
  if (a.trail && a.trail.length > 1) {
    ctx.beginPath();
    ctx.moveTo(wx(a.trail[0].x), wy(a.trail[0].y));
    for (let i = 1; i < a.trail.length; i++) {
      ctx.lineTo(wx(a.trail[i].x), wy(a.trail[i].y));
    }
    ctx.strokeStyle = isDying ? 'rgba(255,30,0,0.15)' : (a.gender === 'M' ? 'rgba(68,136,255,0.12)' : 'rgba(255,68,170,0.12)');
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const baseColor = isDying ? '#ff2200' : a.color;

  // Glow
  const glowSize = AGENT_RADIUS * (isDying ? 2 : 1.5);
  const glowAlpha = isDying ? 0.5 : (a.energy > 60 ? 0.25 : 0.1);
  const gGrad = ctx.createRadialGradient(px, py, 0, px, py, glowSize * 2);
  gGrad.addColorStop(0, isDying ? 'rgba(255,0,0,0.4)' : (a.gender === 'M' ? 'rgba(68,136,255,0.3)' : 'rgba(255,68,170,0.3)'));
  gGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = gGrad;
  ctx.beginPath(); ctx.arc(px, py, glowSize * 2, 0, Math.PI * 2); ctx.fill();

  // Body
  ctx.beginPath();
  ctx.arc(px, py, AGENT_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = baseColor;
  ctx.fill();

  // Inner highlight
  ctx.beginPath();
  ctx.arc(px - 1, py - 1, AGENT_RADIUS * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fill();

  // State indicator dot
  const stateColors = {
    hungry: '#ffaa00', cold: '#88ccff', sleeping: '#4444aa',
    mating: '#ff88ff', pregnant: '#ffccff', dying: '#ff0000', social: '#aaffcc'
  };
  if (stateColors[a.state]) {
    ctx.beginPath();
    ctx.arc(px + AGENT_RADIUS * 0.7, py - AGENT_RADIUS * 0.7, 2, 0, Math.PI * 2);
    ctx.fillStyle = stateColors[a.state];
    ctx.fill();
  }

  // Pregnant indicator ring
  if (isPregnant) {
    ctx.beginPath();
    ctx.arc(px, py, AGENT_RADIUS + 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,200,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Name (only when low population or hover)
  if ((currState?.population || 0) <= 15) {
    ctx.fillStyle = 'rgba(200,220,255,0.5)';
    ctx.font = `8px Courier New`;
    ctx.textAlign = 'center';
    ctx.fillText(a.name, px, py - AGENT_RADIUS - 3);
  }
}

// ─── UI updates ───────────────────────────────────────────────────────────────
function updateHUD(s) {
  document.getElementById('stat-pop').textContent = s.population;
  document.getElementById('stat-era').textContent = s.era;
  document.getElementById('stat-season').textContent = s.season;
  document.getElementById('stat-temp').textContent = `${s.temperature}°C`;
  document.getElementById('stat-tech').textContent = s.techLevel;
  document.getElementById('stat-births').textContent = s.stats.births;
  document.getElementById('stat-deaths').textContent = s.stats.deaths;
  document.getElementById('day-num').textContent = s.day;
  document.getElementById('day-progress-fill').style.width = `${s.dayProgress * 100}%`;

  const hudTime = document.getElementById('hud-time');
  hudTime.textContent = s.isDay ? '☀️ DZIEŃ' : '🌙 NOC';

  const tempEl = document.getElementById('stat-temp');
  tempEl.className = `stat-value ${s.temperature < 0 ? 'red' : ''}`;

  // Night overlay on sidebar
  document.getElementById('day-night-overlay').style.background = s.isDay
    ? 'transparent'
    : `rgba(0,0,30,${Math.min(0.5, (s.dayProgress < 0.2 ? (0.2 - s.dayProgress)/0.2 : (s.dayProgress - 0.8)/0.2) * 0.5)})`;

  // Technologies
  if (s.technologies && s.technologies.length > 0) {
    document.getElementById('tech-list').innerHTML = s.technologies.slice(-5).map(t => `<span>${t}</span>`).join(' · ');
  }
}

let renderedEventCount = 0;
function addEventToTimeline(evt) {
  const tl = document.getElementById('timeline');
  const div = document.createElement('div');
  div.className = 'event-item';

  let aiHtml = '';
  if (evt.architectComment || evt.natureComment) {
    aiHtml = `<div class="event-ai">`;
    if (evt.architectComment) aiHtml += `🏛️ <em>"${evt.architectComment}"</em><br>`;
    if (evt.natureComment) aiHtml += `⚡ <em>"${evt.natureComment}"</em>`;
    aiHtml += `</div>`;
  }

  div.innerHTML = `
    <div class="event-day">DZ. ${evt.day}</div>
    <div class="event-title ${evt.type || 'default'}">${evt.icon || ''} ${evt.title}</div>
    <div class="event-desc">${evt.description || ''}</div>
    ${aiHtml}
  `;

  tl.insertBefore(div, tl.firstChild);
  renderedEventCount++;
  document.getElementById('event-count').textContent = `${renderedEventCount} zdarzeń`;

  // Keep max 50 in DOM
  while (tl.children.length > 50) tl.removeChild(tl.lastChild);
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    console.log('[WS] Connected');
    document.getElementById('loading').style.display = 'none';
    setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'ping' })), 30000);
  };

  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.type === 'state') {
      prevState = currState;
      currState = msg.data;
      lastStateTime = performance.now();
      updateHUD(currState);
    } else if (msg.type === 'event') {
      addEventToTimeline(msg.data);
    }
  };

  ws.onclose = () => {
    console.log('[WS] Disconnected, reconnecting...');
    setTimeout(connect, 3000);
  };

  ws.onerror = (e) => console.error('[WS] Error:', e);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
connect();
requestAnimationFrame(render);
