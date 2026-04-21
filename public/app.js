'use strict';

// ─── Canvas setup ─────────────────────────────────────────────────────────────
const WW = 100, WH = 60;
let CW = 0, CH = 0, SX = 0, SY = 0;
const canvas = document.getElementById('world');
const ctx    = canvas.getContext('2d');
const wrap   = document.getElementById('canvas-wrap');

function resizeCanvas() {
  CW = wrap.clientWidth; CH = wrap.clientHeight;
  canvas.width = CW;   canvas.height = CH;
  SX = CW / WW;        SY = CH / WH;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ─── State ────────────────────────────────────────────────────────────────────
let world = null, agents = [], foodNodes = [], animals = [], resourceNodes = [];
let fireNodes = [], shelterNodes = [];
const spriteCache = new Map();   // agentId → processed Image
const assetCache  = new Map();   // type string → Image (terrain/animals)

// ─── WebSocket ────────────────────────────────────────────────────────────────
let ws;
function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.addEventListener('open',    () => console.log('[WS] connected'));
  ws.addEventListener('close',   () => setTimeout(connect, 2000));
  ws.addEventListener('error',   () => ws.close());
  ws.addEventListener('message', ev => dispatch(JSON.parse(ev.data)));
  setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({type:'ping'})), 20000);
}
connect();

function dispatch(msg) {
  switch (msg.type) {
    case 'state':  onState(msg.data);  break;
    case 'event':  onEvent(msg.data);  break;
    case 'gods':   onGods(msg.data);   break;
    case 'audio':  onAudio(msg.data);  break;
    case 'sprite': onSprite(msg.data); break;
  }
}

// ─── State ────────────────────────────────────────────────────────────────────
function onState(d) {
  world        = d;
  agents       = d.agents       || [];
  foodNodes    = d.foodNodes    || [];
  animals      = d.animals      || [];
  resourceNodes= d.resourceNodes|| [];
  fireNodes    = d.fireNodes    || [];
  shelterNodes = d.shelterNodes || [];

  syncSprites(agents);

  // Header
  el('h-day').textContent    = d.day ?? 0;
  el('h-pop').textContent    = d.population ?? 0;
  el('h-era').textContent    = d.era ?? '—';
  el('h-season').textContent = d.season ?? '—';
  el('h-tech').textContent   = d.techLevel ?? 0;
  el('h-food').textContent   = d.resources?.food ?? 0;
  el('h-wood').textContent   = d.resources?.wood ?? 0;

  const t = d.temperature ?? 0;
  const te = el('h-temp');
  te.textContent  = `${t>0?'+':''}${t}°`;
  te.className    = `text-xs font-semibold ${t<0?'text-cblue':t>30?'text-cred':'text-gray-300'}`;

  const w = d.weather?.type ?? d.weather ?? 'clear';
  applyWeather(w);

  // Day counter
  el('day-num').textContent = d.day ?? 0;
  el('day-fill').style.width = ((d.dayProgress ?? 0) * 100).toFixed(1) + '%';
  el('hud-time').textContent = d.isDay ? '☀️ DZIEŃ' : '🌙 NOC';

  // Stats sidebar
  el('s-births').textContent    = d.stats?.births    ?? 0;
  el('s-deaths').textContent    = d.stats?.deaths    ?? 0;
  el('s-disasters').textContent = d.stats?.disasters ?? 0;
  el('s-disc').textContent      = d.stats?.discoveries ?? d.techLevel ?? 0;

  // Resources panel
  el('r-food').textContent  = Math.round(d.resources?.food  ?? 0);
  el('r-wood').textContent  = Math.round(d.resources?.wood  ?? 0);
  el('r-stone').textContent = Math.round(d.resources?.stone ?? 0);
  const fireEl = el('r-fire');
  fireEl.textContent  = d.resources?.hasFire ? '✓' : '✗';
  fireEl.className    = `res-val ${d.resources?.hasFire ? 'text-orange-400' : 'text-cred'}`;

  // First state: hide loading
  const loader = el('loading');
  if (loader && !loader._done) {
    loader._done = true;
    loader.style.transition = 'opacity .5s';
    loader.style.opacity = '0';
    setTimeout(() => loader.remove(), 550);
  }
}

// ─── Sprite management ────────────────────────────────────────────────────────
function onSprite({ id, base64 }) {
  if (!base64) return;
  processSprite(base64).then(img => spriteCache.set(id, img));
}

function syncSprites(arr) {
  for (const a of arr) {
    if (a.sprite && !spriteCache.has(a.id)) {
      processSprite(a.sprite).then(img => spriteCache.set(a.id, img));
    }
  }
}

// Remove white/near-white background from Pixellab sprites
function processSprite(base64) {
  return new Promise(resolve => {
    const tmp = new Image();
    tmp.onload = () => {
      const c = document.createElement('canvas');
      c.width = tmp.width; c.height = tmp.height;
      const x = c.getContext('2d');
      x.drawImage(tmp, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const r = d.data[i], g = d.data[i+1], b = d.data[i+2];
        // Remove near-white pixels (background artifact from Pixellab)
        if (r > 225 && g > 225 && b > 225) d.data[i+3] = 0;
      }
      x.putImageData(d, 0, 0);
      const out = new Image();
      out.onload = () => resolve(out);
      out.src = c.toDataURL('image/png');
    };
    tmp.onerror = () => resolve(null);
    tmp.src = 'data:image/png;base64,' + base64;
  });
}

// ─── Weather ──────────────────────────────────────────────────────────────────
const WEATHER_INFO = {
  clear:    { icon:'☀️',  label:'Bezchmurnie', cls:'' },
  rain:     { icon:'🌧️',  label:'Deszcz',       cls:'' },
  storm:    { icon:'⛈️',  label:'Burza',        cls:'weather-storm' },
  blizzard: { icon:'❄️',  label:'Zamieć',       cls:'weather-blizzard' },
  drought:  { icon:'🏜️',  label:'Susza',        cls:'weather-drought' },
  heatwave: { icon:'🔥',  label:'Upał',         cls:'weather-heatwave' },
  fog:      { icon:'🌫️',  label:'Mgła',         cls:'weather-fog' },
};
let _weather = 'clear';

function applyWeather(type) {
  if (type === _weather) return;
  _weather = type;
  const p = WEATHER_INFO[type] || WEATHER_INFO.clear;
  el('h-wicon').textContent = p.icon;
  el('h-wlabel').textContent = p.label;
  document.documentElement.setAttribute('data-weather', type);
  document.body.className = document.body.className.replace(/weather-\S+/g,'').trim();
  if (p.cls) document.body.classList.add(p.cls);
  el('rain-overlay').style.opacity   = (type==='rain'||type==='storm')    ? '1':'0';
  el('snow-overlay').style.opacity   = (type==='blizzard')                ? '.85':'0';
}

function flashLightning() {
  const e = el('lightning-overlay');
  e.classList.remove('active');
  void e.offsetWidth;
  e.style.opacity = '1';
  e.classList.add('active');
  setTimeout(() => { e.style.opacity='0'; e.classList.remove('active'); }, 260);
}

// ─── Events → Timeline ────────────────────────────────────────────────────────
const MAX_TL = 90;
function onEvent(ev) {
  const text = ev.text || ev.message || String(ev);
  if (/piorun/i.test(text)) flashLightning();

  const tl  = el('timeline');
  const cls = classifyEvent(text);
  const day = ev.day ?? world?.day ?? '?';

  const e = document.createElement('div');
  e.className = `tl-entry ${cls}`;
  e.innerHTML = `<div class="tl-day">DZIEŃ ${day}</div><div class="tl-text">${esc(text)}</div>`;
  tl.prepend(e);
  while (tl.children.length > MAX_TL) tl.lastChild.remove();
}

function classifyEvent(t) {
  t = t.toLowerCase();
  if (/urodzi|narodzin/.test(t))            return 'ev-birth';
  if (/zmar|zgon|śmier|umar/.test(t))       return 'ev-death';
  if (/piorun|katastrof|zaraza|klęsk|chorob/.test(t)) return 'ev-disaster';
  if (/architekt|chaos|bóg|konsensus|spór/.test(t)) return 'ev-gods';
  if (/technolog|wynalaz|era|odkryci/.test(t)) return 'ev-tech';
  if (/burza|pogoda|śnieg|deszcz|mróz/.test(t)) return 'ev-weather';
  return 'ev-default';
}

// ─── Gods dialogue ────────────────────────────────────────────────────────────
function onGods(d) {
  const panel = el('god-dialogue');
  panel.innerHTML = '';

  // ChatGPT bubble
  const b1 = mkGodBubble('💬 ChatGPT (Architekt)', d.chatGPTView || d.architectDecision, 'gpt');
  panel.appendChild(b1);

  // Claude bubble
  const b2 = mkGodBubble('💬 Claude (Chaos)', d.claudeView || d.chaosDecision, 'claude');
  panel.appendChild(b2);

  // Consensus
  const cw = el('consensus-wrap');
  const ct = el('consensus-text');
  if (d.consensusLabel) {
    const agree = d.claudeAgrees ?? true;
    ct.textContent = d.consensusLabel;
    ct.className   = `text-xs rounded px-2 py-1 leading-snug border ${agree ? 'agree' : 'disagree'}`;
    cw.classList.remove('hidden');
  } else {
    cw.classList.add('hidden');
  }

  el('god-day-label').textContent = `Dzień ${d.day ?? world?.day ?? '?'}`;

  // Pulse god panels
  panel.classList.add('ring-pulse');
  setTimeout(() => panel.classList.remove('ring-pulse'), 2500);

  // Timeline entries
  if (d.chatGPTDirective) onEvent({ text:`🏛️ Architekt: ${d.chatGPTDirective}`, day: d.day ?? world?.day });
  if (d.claudeDirective)  onEvent({ text:`⚡ Chaos: ${d.claudeDirective}`,       day: d.day ?? world?.day });
}

function mkGodBubble(source, text, cls) {
  const d = document.createElement('div');
  d.className = `god-bubble ${cls}`;
  d.innerHTML = `<div class="god-source">${esc(source)}</div><div class="god-text">${esc(text||'—')}</div>`;
  return d;
}

// ─── TTS Audio ────────────────────────────────────────────────────────────────
const audioQ = [];
let audioBusy = false;

function onAudio(d) {
  audioQ.push(d);
  if (!audioBusy) playNext();
}
function playNext() {
  if (!audioQ.length) { audioBusy = false; el('audio-row').classList.add('hidden'); return; }
  audioBusy = true;
  const { base64, title } = audioQ.shift();
  const ar = el('audio-row'); ar.classList.remove('hidden'); ar.classList.add('flex');
  el('audio-label').textContent = title || 'Narrator';
  const a = new Audio('data:audio/mpeg;base64,' + base64);
  a.onended = a.onerror = () => setTimeout(playNext, 400);
  a.play().catch(() => playNext());
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────
let _hoverId = null;
const tooltip = el('tooltip');

canvas.addEventListener('mousemove', ev => {
  const r  = canvas.getBoundingClientRect();
  const mx = (ev.clientX - r.left) / SX;
  const my = (ev.clientY - r.top)  / SY;
  const hit = agents.find(a => !a.dead && Math.hypot(a.x-mx, a.y-my) < 3.5);
  if (hit) {
    _hoverId = hit.id;
    fillTooltip(hit);
    const tx = Math.min(ev.clientX - r.left + 14, CW - 230);
    const ty = Math.max(ev.clientY - r.top  - 20, 4);
    tooltip.style.left = tx + 'px';
    tooltip.style.top  = ty + 'px';
    tooltip.classList.remove('hidden');
  } else {
    _hoverId = null;
    tooltip.classList.add('hidden');
  }
});
canvas.addEventListener('mouseleave', () => { _hoverId=null; tooltip.classList.add('hidden'); });

function fillTooltip(a) {
  el('tt-dot').style.background = a.color || '#5599ff';
  el('tt-name').textContent = a.name;
  el('tt-sub').textContent  = `${a.gender==='M'?'Mężczyzna':'Kobieta'} · Wiek ${a.age?.toFixed(0)||0} dni · ${a.state}`;

  setBar('bt-energy','bv-energy', a.energy);
  setBar('bt-hunger','bv-hunger', a.hunger);
  setBar('bt-warmth','bv-warmth', a.warmth);
  setBar('bt-health','bv-health', a.health);

  const genesEl = el('tt-genes');
  genesEl.innerHTML = '';
  if (a.genes) for (const [k,v] of Object.entries(a.genes)) {
    const d = document.createElement('div');
    d.className = 'text-cdim';
    d.innerHTML = `<span class="text-gray-500">${k.slice(0,5)}</span> <b class="text-cblue">${v.toFixed(0)}</b>`;
    genesEl.appendChild(d);
  }

  el('tt-thought').textContent = a.thought ? `"${a.thought}"` : '';
  el('tt-psych').textContent   = a.psychState ? `[${a.psychState}]` : '';
  el('tt-tree-btn').onclick    = () => openGenealogy(a.id);
}

function setBar(fillId, valId, v) {
  const pct = Math.max(0, Math.min(100, v ?? 0));
  el(fillId).style.width      = pct.toFixed(1) + '%';
  el(valId).textContent       = Math.round(pct);
}

// ─── Genealogy ────────────────────────────────────────────────────────────────
async function openGenealogy(id) {
  tooltip.classList.add('hidden');
  const modal = el('gen-modal');
  el('gen-content').innerHTML = '<div class="text-cdim text-xs py-3 text-center">Ładowanie...</div>';
  modal.classList.remove('hidden');
  try {
    const data = await fetch('/genealogy').then(r=>r.json());
    const target = data.find(a=>a.id===id);
    if (!target) { el('gen-content').innerHTML='<div class="text-cred text-xs py-2">Brak danych.</div>'; return; }
    el('gen-title').textContent = `🌳 Ród — ${target.name}`;
    const c = el('gen-content'); c.innerHTML='';
    renderGenNode(c, target, data, 0);
  } catch (e) { el('gen-content').innerHTML=`<div class="text-cred text-xs">${esc(e.message)}</div>`; }
}
function renderGenNode(container, node, all, depth) {
  if (depth > 3) return;
  const d = document.createElement('div');
  d.className = `gen-node${node.dead?' dead':''}`;
  d.style.marginLeft = (depth*12)+'px';
  d.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:${node.gender==='M'?'#5599ff':'#f472b6'};display:inline-block;flex-shrink:0"></span><span class="text-gray-300 font-mono">${esc(node.name)}</span><span class="text-cdim ml-1 text-xs">Wiek ${node.age}</span>${node.dead?'<span class="text-cred ml-1 text-xs">✝</span>':''}`;
  container.appendChild(d);
  for (const cid of (node.childrenIds||[])) {
    const ch = all.find(a=>a.id===cid);
    if (ch) renderGenNode(container, ch, all, depth+1);
  }
}
el('gen-close').onclick = () => el('gen-modal').classList.add('hidden');

// ─── Terrain (pre-seeded, stable) ─────────────────────────────────────────────
const terrain = (() => {
  function rng(seed) { let s=seed; return ()=>{ s=(s*1664525+1013904223)&0xffffffff; return (s>>>0)/0xffffffff; }; }
  const r = rng(7);
  const trees=[]; const rocks=[];
  for (let i=0;i<30;i++) trees.push({x:r()*WW,y:r()*WH,sz:1+r()*.8,v:r()});
  for (let i=0;i<14;i++) rocks.push({x:r()*WW,y:r()*WH,sz:.5+r()*.4});
  return {trees,rocks};
})();

// ─── Canvas renderer ──────────────────────────────────────────────────────────
function render() {
  if (!world) return;
  ctx.clearRect(0, 0, CW, CH);
  drawBg();
  drawTerrainBg();
  drawResourceNodes();
  drawFoodNodes();
  drawAnimals();
  drawFire();
  drawShelters();
  drawAgents();
  if (_hoverId) {
    const a = agents.find(a=>a.id===_hoverId);
    if (a) fillTooltip(a);
  }
}

function drawBg() {
  const night = !world.isDay;
  const g = ctx.createLinearGradient(0,0,0,CH);
  if (night) { g.addColorStop(0,'#020306'); g.addColorStop(1,'#030509'); }
  else if (_weather==='heatwave'||_weather==='drought') { g.addColorStop(0,'#150e04'); g.addColorStop(1,'#0d0902'); }
  else { g.addColorStop(0,'#030710'); g.addColorStop(1,'#050a14'); }
  ctx.fillStyle=g; ctx.fillRect(0,0,CW,CH);
  // subtle grid
  ctx.strokeStyle='rgba(20,32,58,.22)'; ctx.lineWidth=.4;
  const gx=10*SX, gy=10*SY;
  for (let x=0;x<CW;x+=gx){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,CH);ctx.stroke();}
  for (let y=0;y<CH;y+=gy){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(CW,y);ctx.stroke();}
}

function drawTerrainBg() {
  const night  = !world.isDay;
  const alpha  = night ? .28 : .48;
  const season = world.season;

  for (const r of terrain.rocks) {
    ctx.fillStyle=`rgba(36,44,60,${alpha*.9})`;
    ctx.beginPath(); ctx.ellipse(r.x*SX,r.y*SY,r.sz*SX*1.3,r.sz*SY*.8,r.sz,0,Math.PI*2); ctx.fill();
  }

  for (const t of terrain.trees) {
    let foliage;
    if      (season==='Zima')  foliage=`rgba(190,210,255,${alpha*.55})`;
    else if (season==='Jesień')foliage=`rgba(200,95,25,${alpha*.9})`;
    else if (night)            foliage=`rgba(10,50,18,${alpha})`;
    else                       foliage=`rgba(18,75,30,${alpha*1.1})`;
    const tx=t.x*SX, ty=t.y*SY, ts=t.sz*SX;
    // trunk
    ctx.strokeStyle=`rgba(55,38,15,${alpha})`; ctx.lineWidth=ts*.4;
    ctx.beginPath(); ctx.moveTo(tx,ty); ctx.lineTo(tx,ty+ts); ctx.stroke();
    // canopy layers
    ctx.fillStyle=foliage;
    for (let i=2;i>=0;i--){ctx.beginPath();ctx.arc(tx,ty-i*ts*.5,ts*(1-i*.12),0,Math.PI*2);ctx.fill();}
  }
}

function drawResourceNodes() {
  for (const r of resourceNodes) {
    const sprite = assetCache.get(r.type);
    const rx=r.x*SX, ry=r.y*SY;
    if (sprite) {
      ctx.imageSmoothingEnabled=false;
      ctx.drawImage(sprite, rx-SX*1.6, ry-SY*3.2, SX*3.2, SY*3.2);
      ctx.imageSmoothingEnabled=true;
    } else {
      // Fallback
      if (r.type==='tree'){
        ctx.fillStyle='rgba(20,80,30,.7)'; ctx.beginPath(); ctx.arc(rx,ry-SY*.8,SX*1.4,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='rgba(60,40,15,.7)'; ctx.fillRect(rx-SX*.25,ry-SY*.1,SX*.5,SY*.9);
      } else {
        ctx.fillStyle='rgba(80,80,95,.7)'; ctx.beginPath(); ctx.ellipse(rx,ry,SX*1.2,SY*.8,.4,0,Math.PI*2); ctx.fill();
      }
    }
  }
}

function drawFoodNodes() {
  for (const f of foodNodes) {
    if (f.food < 2) continue;
    const fx=f.x*SX, fy=f.y*SY;
    const pct = f.food / 20;
    ctx.shadowColor='#3ddc8c'; ctx.shadowBlur=7;
    ctx.fillStyle=`rgba(61,220,140,${.2+pct*.45})`;
    ctx.beginPath(); ctx.arc(fx,fy,SX*(1.2+pct*.8),0,Math.PI*2); ctx.fill();
    ctx.fillStyle=`rgba(61,220,140,${.5+pct*.3})`;
    ctx.beginPath(); ctx.arc(fx,fy,SX*.7,0,Math.PI*2); ctx.fill();
    ctx.shadowBlur=0;
  }
}

function drawAnimals() {
  for (const a of animals) {
    const ax=a.x*SX, ay=a.y*SY;
    const sprite = assetCache.get(`animal_${a.type}`);
    if (sprite) {
      ctx.imageSmoothingEnabled=false;
      ctx.drawImage(sprite, ax-SX*1.2, ay-SY*2.4, SX*2.4, SY*2.4);
      ctx.imageSmoothingEnabled=true;
    } else {
      // Fallback dot + label
      const col = { deer:'#c8a060', rabbit:'#d8c8a0', boar:'#806050', bird:'#a0a8c8' }[a.type]||'#888';
      ctx.fillStyle=col; ctx.beginPath(); ctx.ellipse(ax,ay,SX*.9,SY*.6,.2,0,Math.PI*2); ctx.fill();
      if (SX>5){ctx.fillStyle='rgba(200,190,160,.6)';ctx.font=`${Math.max(7,SX*.75)}px Roboto Mono`;ctx.textAlign='center';ctx.fillText(a.type.slice(0,3),ax,ay-SY*.9);ctx.textAlign='left';}
    }
  }
}

function drawFire() {
  for (const f of fireNodes) {
    const fx=f.x*SX, fy=f.y*SY;
    const t=Date.now()*.005;
    ctx.shadowColor='#ff8822'; ctx.shadowBlur=18;
    ctx.fillStyle='#ff5500'; ctx.beginPath(); ctx.arc(fx,fy,SX*2,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#ffcc44'; ctx.beginPath(); ctx.arc(fx,fy,SX*1.1,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=`rgba(255,220,80,${.5+Math.sin(t+fx)*.35})`;
    ctx.beginPath(); ctx.arc(fx,fy-SY*1.6,SX*.7,0,Math.PI*2); ctx.fill();
    ctx.shadowBlur=0;
  }
}

function drawShelters() {
  for (const s of shelterNodes) {
    const sx=s.x*SX, sy=s.y*SY;
    ctx.fillStyle='rgba(85,153,255,.1)'; ctx.strokeStyle='rgba(85,153,255,.3)'; ctx.lineWidth=.8;
    ctx.beginPath(); ctx.arc(sx,sy,3.5*SX,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#5599ff'; ctx.beginPath(); ctx.arc(sx,sy,.9*SX,0,Math.PI*2); ctx.fill();
  }
}

function drawAgents() {
  for (const a of agents) {
    if (a.dead) { drawDying(a); continue; }
    drawTrail(a);
    drawHumanoid(a);
    drawActionIndicator(a);
  }
}

function drawTrail(a) {
  if (!a.trail || a.trail.length < 2) return;
  ctx.beginPath(); ctx.moveTo(a.trail[0].x*SX, a.trail[0].y*SY);
  for (let i=1;i<a.trail.length;i++) ctx.lineTo(a.trail[i].x*SX, a.trail[i].y*SY);
  ctx.lineTo(a.x*SX, a.y*SY);
  ctx.strokeStyle=a.gender==='M'?'rgba(85,153,255,.1)':'rgba(255,85,187,.1)';
  ctx.lineWidth=.8; ctx.stroke();
}

function drawHumanoid(a) {
  const ax=a.x*SX, ay=a.y*SY, sc=SX*.85;
  const sprite = spriteCache.get(a.id);

  // Glow by state
  let glow=null;
  if      (a.state==='dying')       glow='#e83a4a';
  else if (a.state==='gestating')   glow='#aa55ff';
  else if (a.state==='warm')        glow='#ff8822';
  else if (a.state==='seek_mate')   glow='#e8a820';
  else if (a.state==='seek_food' && a.hunger>75) glow='#e83a4a';

  if (sprite) {
    const sw = Math.max(16, sc*3.2), sh=sw;
    if (glow){ctx.shadowColor=glow;ctx.shadowBlur=12;}
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(sprite, ax-sw/2, ay-sh, sw, sh);
    ctx.imageSmoothingEnabled=true;
    ctx.shadowBlur=0;
  } else {
    // Geometric fallback
    if (glow){ctx.shadowColor=glow;ctx.shadowBlur=9;}
    ctx.fillStyle=a.skinTone||'#c47a3a'; ctx.beginPath(); ctx.arc(ax,ay-sc*2.2,sc*.85,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=a.hairColor||'#3a2a10'; ctx.beginPath(); ctx.arc(ax,ay-sc*2.2,sc*.85,Math.PI,Math.PI*2); ctx.fill();
    ctx.fillStyle=a.color||'#5599ff'; ctx.fillRect(ax-sc*.5,ay-sc*1.6,sc,sc*1.5);
    ctx.fillRect(ax-sc*.5,ay-sc*.1,sc*.42,sc); ctx.fillRect(ax+sc*.08,ay-sc*.1,sc*.42,sc);
    ctx.shadowBlur=0;
    if (a.gestatingDays>0){ctx.fillStyle='rgba(170,85,255,.5)';ctx.beginPath();ctx.arc(ax,ay-sc*.9,sc*.5,0,Math.PI*2);ctx.fill();}
  }

  // Name label
  if (SX>6.5) {
    ctx.font=`${Math.max(7,SX*.8)}px "Roboto Mono",monospace`;
    ctx.fillStyle='rgba(196,204,232,.72)'; ctx.textAlign='center';
    ctx.fillText(a.name, ax, ay-(sprite?sc*3.8:sc*3.3));
    ctx.textAlign='left';
  }
}

// Visual indicators for current action
function drawActionIndicator(a) {
  const ax=a.x*SX, ay=a.y*SY, sc=SX*.85;
  const hasSprite = spriteCache.has(a.id);
  const headY = ay - (hasSprite ? sc*3.2 : sc*3.0);

  // Gathering: spinning dashed arc
  if (a.state==='seek_food'||a.state==='hunt') {
    const t=Date.now()*.002;
    ctx.strokeStyle=a.state==='hunt'?'rgba(255,150,50,.6)':'rgba(61,220,140,.5)';
    ctx.lineWidth=1; ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.arc(ax, ay-sc*.9, sc*2.3, t, t+Math.PI*1.4); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Sleep: Z particles
  if (a.state==='sleep') {
    const n = Math.floor(Date.now()/700) % 3;
    ctx.fillStyle='rgba(140,160,255,.65)';
    ctx.font=`${Math.max(8, sc*1.2)}px Roboto Mono`;
    ctx.textAlign='center';
    ctx.fillText('Z'.repeat(n+1), ax, headY - sc*.4);
    ctx.textAlign='left';
  }

  // Seek mate: heart pulse
  if (a.state==='seek_mate') {
    const pulse=(Math.sin(Date.now()*.004)+1)*.5;
    ctx.fillStyle=`rgba(255,100,150,${.35+pulse*.5})`;
    ctx.font=`${sc*1.3}px serif`; ctx.textAlign='center';
    ctx.fillText('♥', ax, headY - sc*.4); ctx.textAlign='left';
  }

  // Warmth: flame glow ring
  if (a.state==='warm') {
    ctx.strokeStyle='rgba(255,140,30,.35)'; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.arc(ax, ay-sc*.9, sc*2, 0, Math.PI*2); ctx.stroke();
  }
}

function drawDying(a) {
  const ax=a.x*SX, ay=a.y*SY;
  const fade=Math.max(0,1-(a.dyingTicks||0)/25);
  ctx.globalAlpha=fade*.5; ctx.fillStyle='#e83a4a';
  ctx.beginPath(); ctx.arc(ax,ay,SX*1.1,0,Math.PI*2); ctx.fill();
  ctx.globalAlpha=1;
}

// ─── Render loop ──────────────────────────────────────────────────────────────
let _lastRaf = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  if (ts - _lastRaf < 80) return; // ~12fps — server drives state
  _lastRaf = ts;
  if (world) render();
}
requestAnimationFrame(loop);

// ─── Utils ────────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
