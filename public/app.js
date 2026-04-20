'use strict';

// ─── World/Canvas config ────────────────────────────────────────────────────
const WW = 100, WH = 60;
let CW = 0, CH = 0, SX = 0, SY = 0;

const canvas = document.getElementById('world');
const ctx    = canvas.getContext('2d');
let terrainCanvas = null;
let treePositions = [];

function resize() {
  const wrap = document.getElementById('canvas-wrap');
  CW = wrap.clientWidth; CH = wrap.clientHeight;
  canvas.width = CW; canvas.height = CH;
  SX = CW / WW; SY = CH / WH;
  terrainCanvas = null;
}
window.addEventListener('resize', resize);
resize();

// ─── World coordinate helpers ──────────────────────────────────────────────
function wx(x) { return x * SX; }
function wy(y) { return y * SY; }

// ─── State ─────────────────────────────────────────────────────────────────
let prevState = null, currState = null;
let lastStateTS = 0;
let hoveredAgent = null;
let selectedAgentId = null;
let genealogyData = [];
let audioQueue = [];
let audioPlaying = false;

// ─── Terrain + Trees ────────────────────────────────────────────────────────
const TREE_DEFS = [
  // Forest edges (x, y, type: 'pine'|'oak', size)
  ...[7,5,8,9,6,8,9,10,7].map((y,i)=>({ x: 5+i*1.2,  y, type:'pine', size: 0.7+Math.random()*0.4 })),
  ...[5,6,5,7,8,6,5].map((y,i)=>      ({ x: 91+i*1.2, y, type:'pine', size: 0.7+Math.random()*0.4 })),
  ...[50,52,54,56,53,51].map((y,i)=>  ({ x: 5+i*1.5,  y, type:'oak',  size: 0.8+Math.random()*0.4 })),
  ...[50,53,55,52,51].map((y,i)=>     ({ x: 90+i*1.3, y, type:'oak',  size: 0.8+Math.random()*0.4 })),
  // Scattered interior trees
  {x:25, y:14, type:'oak',  size:0.9},  {x:28, y:17, type:'oak',  size:0.75},
  {x:74, y:14, type:'oak',  size:0.85}, {x:71, y:17, type:'oak',  size:0.7},
  {x:22, y:44, type:'pine', size:0.85}, {x:78, y:44, type:'pine', size:0.9},
  {x:40, y:8,  type:'pine', size:0.65}, {x:60, y:8,  type:'pine', size:0.7},
  {x:40, y:52, type:'oak',  size:0.65}, {x:60, y:52, type:'oak',  size:0.7},
  {x:12, y:30, type:'pine', size:0.8},  {x:88, y:30, type:'pine', size:0.8},
];

function buildTerrainCanvas(season) {
  const tc = document.createElement('canvas');
  tc.width = CW; tc.height = CH;
  const tctx = tc.getContext('2d');

  // Sky/ground gradient
  const bg = tctx.createLinearGradient(0, 0, 0, CH);
  if (season === 'Zima') {
    bg.addColorStop(0, '#0b0e18'); bg.addColorStop(1, '#101820');
  } else if (season === 'Jesień') {
    bg.addColorStop(0, '#0d0e0a'); bg.addColorStop(1, '#120e08');
  } else {
    bg.addColorStop(0, '#070d0a'); bg.addColorStop(1, '#0a120a');
  }
  tctx.fillStyle = bg;
  tctx.fillRect(0, 0, CW, CH);

  // Terrain patches
  const patchColor = season === 'Zima' ? 'rgba(150,160,180,0.06)' : 'rgba(20,55,20,0.18)';
  const patches = [
    {x:18,y:12,r:15},{x:82,y:12,r:13},{x:50,y:28,r:20},
    {x:18,y:46,r:14},{x:82,y:46,r:12},{x:50,y:56,r:8}
  ];
  for (const p of patches) {
    const g = tctx.createRadialGradient(wx(p.x),wy(p.y),0,wx(p.x),wy(p.y),wx(p.r));
    g.addColorStop(0, patchColor); g.addColorStop(1,'transparent');
    tctx.fillStyle = g; tctx.fillRect(0,0,CW,CH);
  }

  // River/path
  tctx.strokeStyle = 'rgba(30,60,100,0.25)';
  tctx.lineWidth = 3;
  tctx.beginPath();
  tctx.moveTo(wx(0), wy(35)); tctx.bezierCurveTo(wx(25),wy(33),wx(75),wy(37),wx(100),wy(35));
  tctx.stroke();

  // Grid
  tctx.strokeStyle = 'rgba(255,255,255,0.018)';
  tctx.lineWidth = 0.5;
  for (let x=0; x<CW; x+=SX*10) { tctx.beginPath(); tctx.moveTo(x,0); tctx.lineTo(x,CH); tctx.stroke(); }
  for (let y=0; y<CH; y+=SY*10) { tctx.beginPath(); tctx.moveTo(0,y); tctx.lineTo(CW,y); tctx.stroke(); }

  // Draw trees onto terrain
  for (const t of TREE_DEFS) {
    drawTree(tctx, wx(t.x), wy(t.y), t.type, t.size * SX * 2.5, season);
  }

  return tc;
}

function drawTree(tctx, px, py, type, size, season) {
  const trunkH = size * 1.4, trunkW = size * 0.22;

  // Trunk
  const tg = tctx.createLinearGradient(px-trunkW/2, py, px+trunkW/2, py);
  tg.addColorStop(0,'#2a1508'); tg.addColorStop(0.5,'#4a2510'); tg.addColorStop(1,'#2a1508');
  tctx.fillStyle = tg;
  tctx.beginPath();
  tctx.roundRect(px-trunkW/2, py-trunkH, trunkW, trunkH, trunkW/2);
  tctx.fill();

  // Canopy color by season + type
  let leafColor;
  if (season === 'Zima')   leafColor = `rgba(180,190,210,0.85)`;
  else if (season === 'Jesień') leafColor = type==='oak' ? `rgba(160,80,20,0.85)` : `rgba(20,60,20,0.85)`;
  else leafColor = type==='oak' ? `rgba(20,75,20,0.9)` : `rgba(10,55,10,0.9)`;

  const leafDark = season==='Zima' ? `rgba(140,155,180,0.7)` : (type==='oak' ? `rgba(10,50,10,0.7)` : `rgba(5,40,5,0.7)`);

  if (type === 'pine') {
    for (let i = 0; i < 3; i++) {
      const ly = py - trunkH - i * size * 0.35;
      const lw = size * (0.9 - i * 0.2);
      tctx.fillStyle = i===0 ? leafDark : leafColor;
      tctx.beginPath();
      tctx.moveTo(px, ly - size * 0.5);
      tctx.lineTo(px - lw, ly + size * 0.15);
      tctx.lineTo(px + lw, ly + size * 0.15);
      tctx.closePath(); tctx.fill();
    }
  } else {
    const blobs = [[0,-trunkH-size*0.6,size*0.7],[-size*0.4,-trunkH-size*0.3,size*0.5],[size*0.4,-trunkH-size*0.3,size*0.5],[0,-trunkH-size*0.1,size*0.45]];
    for (const [bx,by,br] of blobs) {
      tctx.fillStyle = bx===0&&by<-trunkH-size*0.5 ? leafColor : leafDark;
      tctx.beginPath(); tctx.arc(px+bx,py+by,br,0,Math.PI*2); tctx.fill();
    }
  }
}

// ─── Agent / Humanoid rendering ────────────────────────────────────────────
const ERA_CLOTH = {
  0: ['#3a2a1a','#2a1a0a'],   // Prehistory - dark furs
  1: ['#5a4a2a','#4a3a1a'],   // Stone Age - tan skins
  2: ['#6a5a2a','#7a5a1a'],   // Fire era - leather
  3: ['#7a6a3a','#6a5a2a'],   // Bronze Age - woven
  4: ['#5a6a7a','#4a5a6a'],   // Antiquity - linen blue
  5: ['#5a4a5a','#4a3a4a'],   // Medieval - dark wool
  6: ['#7a6a5a','#8a7a5a'],   // Renaissance - richer
  7: ['#3a4a5a','#4a5a6a'],   // Industrial - dark
  8: ['#6a8a9a','#5a7a8a'],   // Modern - neutral
  9: ['#8a9aaa','#9aaaaa'],   // Space - tech grey
};

function drawAgent(a, eraIndex) {
  const px = wx(a.x), py = wy(a.y);
  const isM = a.gender === 'M';
  const isDying = a.state === 'dying';
  const isPregnant = a.pregnantDays > 0;
  const isSleeping = a.state === 'sleeping';

  // Scale by age (children smaller)
  const s = a.age < 5 ? 0.45 : a.age < 15 ? 0.7 : 1.0;
  const scale = s * Math.min(SX, SY) * 1.1;

  const cloth = (ERA_CLOTH[Math.min(eraIndex, 9)] || ERA_CLOTH[0])[isM ? 0 : 1];
  const skin  = a.skinTone || '#c8a060';
  const hair  = a.hairColor || '#3a2010';

  ctx.save();

  // Glow
  const glowColor = isDying ? 'rgba(255,30,0,' : (isM ? 'rgba(68,136,255,' : 'rgba(255,68,170,');
  const glowR = scale * (isDying ? 14 : 8);
  const gg = ctx.createRadialGradient(px,py,0,px,py,glowR);
  gg.addColorStop(0, glowColor + (isDying ? '0.35)' : '0.18)'));
  gg.addColorStop(1, glowColor + '0)');
  ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(px,py,glowR,0,Math.PI*2); ctx.fill();

  // Trail
  if (a.trail && a.trail.length > 1) {
    ctx.beginPath(); ctx.moveTo(wx(a.trail[0].x), wy(a.trail[0].y));
    for (let i=1; i<a.trail.length; i++) ctx.lineTo(wx(a.trail[i].x), wy(a.trail[i].y));
    ctx.strokeStyle = isDying ? 'rgba(255,30,0,0.1)' : (isM ? 'rgba(68,136,255,0.08)' : 'rgba(255,68,170,0.08)');
    ctx.lineWidth = 1; ctx.stroke();
  }

  if (isSleeping) {
    ctx.globalAlpha = 0.5;
  }

  // Walking animation
  const t = Date.now() * 0.004 + a.id * 0.7;
  const walk = (a.state === 'wandering' || a.state === 'hungry' || a.state === 'cold') ? Math.sin(t) : 0;

  // Shadow
  ctx.globalAlpha *= 0.3;
  ctx.fillStyle = '#000'; ctx.beginPath();
  ctx.ellipse(px, py + scale*9, scale*5, scale*1.5, 0, 0, Math.PI*2); ctx.fill();
  ctx.globalAlpha = isSleeping ? 0.5 : 1.0;

  if (isSleeping) {
    // Sleeping: curled up
    ctx.fillStyle = cloth;
    ctx.beginPath(); ctx.ellipse(px, py+scale*2, scale*6, scale*3.5, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(px+scale*4, py, scale*3.5, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    if ((currState?.population || 0) <= 20) _drawName(px, py-scale*8, a.name);
    return;
  }

  // Legs
  ctx.strokeStyle = isDying ? '#663322' : cloth;
  ctx.lineWidth = scale * 2.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(px-scale*1.5, py+scale*3);
  ctx.lineTo(px-scale*3+walk*scale*1.5, py+scale*9); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(px+scale*1.5, py+scale*3);
  ctx.lineTo(px+scale*3-walk*scale*1.5, py+scale*9); ctx.stroke();

  // Body
  ctx.fillStyle = isDying ? '#553322' : cloth;
  if (isPregnant) {
    ctx.beginPath(); ctx.ellipse(px, py, scale*4.5, scale*5, 0, 0, Math.PI*2); ctx.fill();
  } else {
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(px-scale*3.5, py-scale*3.5, scale*7, scale*7, scale*1.5);
    else { ctx.rect(px-scale*3.5, py-scale*3.5, scale*7, scale*7); }
    ctx.fill();
  }

  // Arms
  ctx.strokeStyle = skin; ctx.lineWidth = scale*1.8;
  ctx.beginPath(); ctx.moveTo(px-scale*3.5, py-scale*1);
  ctx.lineTo(px-scale*7-walk*scale, py+scale*2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(px+scale*3.5, py-scale*1);
  ctx.lineTo(px+scale*7+walk*scale, py+scale*2); ctx.stroke();

  // Head
  ctx.fillStyle = isDying ? '#cc8844' : skin;
  ctx.beginPath(); ctx.arc(px, py-scale*6, scale*4, 0, Math.PI*2); ctx.fill();

  // Hair
  ctx.fillStyle = hair;
  if (isM) {
    ctx.fillRect(px-scale*4, py-scale*10, scale*8, scale*3);
  } else {
    ctx.beginPath(); ctx.arc(px, py-scale*6, scale*4.5, Math.PI*1.2, Math.PI*1.8); ctx.fill();
    ctx.fillRect(px-scale*4.5, py-scale*8, scale*3, scale*7);
    ctx.fillRect(px+scale*1.5, py-scale*8, scale*3, scale*7);
  }

  // Eyes
  const eyeColor = isDying ? '#cc2200' : '#1a1005';
  ctx.fillStyle = eyeColor;
  ctx.beginPath(); ctx.arc(px-scale*1.4, py-scale*6.5, scale*0.75, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(px+scale*1.4, py-scale*6.5, scale*0.75, 0, Math.PI*2); ctx.fill();
  // Eye whites
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath(); ctx.arc(px-scale*1.6, py-scale*6.7, scale*0.35, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(px+scale*1.2, py-scale*6.7, scale*0.35, 0, Math.PI*2); ctx.fill();

  // State dot
  const stateC = { hungry:'#ffaa00', cold:'#aaccff', mating:'#ff88ff', pregnant:'#ffccff', dying:'#ff2200', social:'#aaffcc', gathering:'#cc8822', building:'#aa8844' };
  if (stateC[a.state]) {
    ctx.fillStyle = stateC[a.state];
    ctx.beginPath(); ctx.arc(px+scale*4, py-scale*9, scale*1.5, 0, Math.PI*2); ctx.fill();
  }

  // Pregnancy ring
  if (isPregnant) {
    const pPct = a.pregnantDays / 270;
    ctx.beginPath(); ctx.arc(px, py, scale*7, -Math.PI/2, -Math.PI/2+Math.PI*2*pPct);
    ctx.strokeStyle = 'rgba(255,200,255,0.6)'; ctx.lineWidth = scale*1.5; ctx.stroke();
  }

  // Thought bubble (only few agents, periodically)
  if (a.thought && a.id % 4 === (Math.floor(Date.now()/6000) % 4)) {
    _drawThought(px, py - scale * 14, a.thought);
  }

  ctx.restore();

  if ((currState?.population || 0) <= 25) _drawName(px, py - scale*16, a.name);
}

function _drawName(px, py, name) {
  ctx.font = `bold ${Math.round(9*Math.min(SX,SY)/8)}px Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillText(name, px+1, py+1);
  ctx.fillStyle = 'rgba(220,235,255,0.8)';
  ctx.fillText(name, px, py);
}

function _drawThought(px, py, text) {
  const maxW = 100, pad = 6;
  ctx.font = `italic ${Math.round(8*Math.min(SX,SY)/8)}px "IM Fell English", serif`;
  ctx.textAlign = 'center';
  const tw = Math.min(ctx.measureText(text).width + pad*2, maxW);
  const th = 16;
  ctx.fillStyle = 'rgba(8,12,28,0.82)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(px-tw/2, py-th, tw, th, 4);
  else ctx.rect(px-tw/2, py-th, tw, th);
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,100,180,0.4)'; ctx.lineWidth = 0.5; ctx.stroke();
  ctx.fillStyle = 'rgba(200,215,255,0.75)';
  const display = text.length > 30 ? text.slice(0,28)+'…' : text;
  ctx.fillText(display, px, py-4);
}

// ─── Render loop ────────────────────────────────────────────────────────────
function render(ts) {
  if (!currState) { requestAnimationFrame(render); return; }

  if (!terrainCanvas) terrainCanvas = buildTerrainCanvas(currState.season);

  ctx.clearRect(0, 0, CW, CH);
  ctx.drawImage(terrainCanvas, 0, 0);

  const s = currState;
  const ei = s.eraIndex || 0;

  // Food nodes
  for (const f of (s.foodNodes || [])) {
    if (f.food < 5) continue;
    const alpha = f.food / 100, fpx = wx(f.x), fpy = wy(f.y);
    const rg = ctx.createRadialGradient(fpx,fpy,0,fpx,fpy,SX*3*alpha);
    rg.addColorStop(0,`rgba(60,255,100,${alpha*0.7})`); rg.addColorStop(1,'transparent');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(fpx,fpy,SX*3,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(fpx,fpy,SX*1.2*alpha+0.5,0,Math.PI*2);
    ctx.fillStyle=`rgba(60,255,100,${alpha*0.9})`; ctx.fill();
  }

  // Shelter nodes
  for (const sh of (s.shelterNodes || [])) {
    const spx = wx(sh.x), spy = wy(sh.y), sw = SX*4, sh2 = SY*3;
    ctx.fillStyle='rgba(120,80,40,0.7)';
    ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(spx-sw,spy-sh2,sw*2,sh2*2,3); else ctx.rect(spx-sw,spy-sh2,sw*2,sh2*2);
    ctx.fill();
    ctx.strokeStyle='rgba(180,130,60,0.5)'; ctx.lineWidth=1; ctx.stroke();
    // Roof
    ctx.beginPath(); ctx.moveTo(spx-sw-2,spy-sh2); ctx.lineTo(spx,spy-sh2-SY*2); ctx.lineTo(spx+sw+2,spy-sh2);
    ctx.fillStyle='rgba(100,60,20,0.7)'; ctx.fill();
  }

  // Fire nodes
  for (const fi of (s.fireNodes || [])) {
    const fpx = wx(fi.x), fpy = wy(fi.y);
    const flk = 0.7 + Math.sin(ts*0.008)*0.3;
    for (let r = SX*8*flk; r > 0; r -= SX*2) {
      const alpha = (r/(SX*8*flk))*0.15;
      ctx.beginPath(); ctx.arc(fpx,fpy,r,0,Math.PI*2);
      ctx.fillStyle=`rgba(255,80,0,${alpha})`; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(fpx,fpy,SX*1.5*flk,0,Math.PI*2);
    ctx.fillStyle=`rgba(255,200,50,${flk*0.9})`; ctx.fill();
  }

  // Agents (back to front by y)
  const sortedAgents = [...(s.agents || [])].sort((a,b)=>a.y-b.y);
  for (const a of sortedAgents) drawAgent(a, ei);

  // Night overlay
  const dp = s.dayProgress;
  let nightAlpha = 0;
  if (dp < 0.2)  nightAlpha = (0.2-dp)/0.2 * 0.72;
  if (dp > 0.8)  nightAlpha = (dp-0.8)/0.2 * 0.72;
  if (nightAlpha > 0.01) {
    ctx.fillStyle = `rgba(0,0,25,${nightAlpha})`; ctx.fillRect(0,0,CW,CH);
    // Stars at night
    if (nightAlpha > 0.3) {
      ctx.fillStyle = `rgba(255,255,255,${(nightAlpha-0.3)*0.8})`;
      for (let i=0; i<80; i++) {
        const sx = ((i*137+31)%CW), sy2 = ((i*79+17)%CH)*0.3;
        ctx.beginPath(); ctx.arc(sx,sy2,0.6,0,Math.PI*2); ctx.fill();
      }
    }
  }

  requestAnimationFrame(render);
}

// ─── Hover tooltip ──────────────────────────────────────────────────────────
const tooltip = document.getElementById('agent-tooltip');
canvas.addEventListener('mousemove', (e) => {
  if (!currState) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const wx2 = mx / SX, wy2 = my / SY;

  let found = null;
  const s = Math.min(SX, SY);
  for (const a of (currState.agents || [])) {
    const dist = Math.sqrt((wx(a.x)-mx)**2+(wy(a.y)-my)**2);
    if (dist < s * (a.age < 10 ? 3 : 5)) { found = a; break; }
  }

  if (found) {
    hoveredAgent = found;
    tooltip.classList.add('visible');

    let tx = e.clientX + 14, ty = e.clientY - 10;
    if (tx + 230 > window.innerWidth) tx = e.clientX - 244;
    if (ty + 320 > window.innerHeight) ty = e.clientY - 320;
    tooltip.style.left = tx + 'px'; tooltip.style.top = ty + 'px';

    document.getElementById('tt-name').textContent = found.name;
    document.getElementById('tt-sub').textContent  = `${found.gender==='M'?'Mężczyzna':'Kobieta'} · Wiek: ${Math.round(found.age)} dni · ${found.state} · ${found.psychState}`;

    document.getElementById('tt-energy').style.width = found.energy + '%';
    document.getElementById('tt-hunger').style.width = found.hunger + '%';
    document.getElementById('tt-warmth').style.width = found.warmth + '%';
    document.getElementById('tt-health').style.width = found.health + '%';
    document.getElementById('tt-happy').style.width  = found.happiness + '%';

    const g = found.genes || {};
    document.getElementById('tt-g-str').textContent = Math.round(g.strength||50);
    document.getElementById('tt-g-int').textContent = Math.round(g.intelligence||50);
    document.getElementById('tt-g-fer').textContent = Math.round(g.fertility||50);
    document.getElementById('tt-g-end').textContent = Math.round(g.endurance||50);
    document.getElementById('tt-g-res').textContent = Math.round(g.resistance||50);

    document.getElementById('tt-thought').textContent = found.thought ? `"${found.thought}"` : '';
    document.getElementById('tt-psych').textContent   = found.psychState ? `Stan: ${found.psychState}` : '';
    document.getElementById('tt-genealogy-btn').onclick = () => showGenealogy(found.id);
  } else {
    hoveredAgent = null;
    tooltip.classList.remove('visible');
  }
});
canvas.addEventListener('mouseleave', () => { tooltip.classList.remove('visible'); });

// ─── Genealogy viewer ───────────────────────────────────────────────────────
async function showGenealogy(agentId) {
  tooltip.classList.remove('visible');
  try {
    const res = await fetch('/genealogy');
    genealogyData = await res.json();
  } catch { genealogyData = []; }

  const modal   = document.getElementById('genealogy-modal');
  const content = document.getElementById('genealogy-content');
  const title   = document.getElementById('genealogy-title');
  const me = genealogyData.find(a=>a.id===agentId) || (currState?.agents||[]).find(a=>a.id===agentId);
  if (!me) return;

  title.textContent = `🌳 Ród: ${me.name}`;
  content.innerHTML = '';

  const byId = new Map(genealogyData.map(a=>[a.id,a]));
  const living = currState?.agents || [];
  for (const la of living) if (!byId.has(la.id)) byId.set(la.id, la);

  function personDiv(a, cls='') {
    if (!a) return '';
    const d = document.createElement('div');
    d.className = `gen-person ${cls}`;
    d.innerHTML = `<span class="gname">${a.gender==='M'?'👨':'👩'} ${a.name}</span> <span class="ginfo">Wiek: ${Math.round(a.age||0)} dni${a.dead?' · †':''}</span>`;
    return d;
  }

  // Parents
  if (me.motherId || me.fatherId) {
    const sec = document.createElement('div');
    sec.innerHTML = '<div style="color:#4a5a88;font-size:10px;letter-spacing:2px;margin:8px 0 4px">RODZICE</div>';
    content.appendChild(sec);
    if (me.motherId) { const p=byId.get(me.motherId); if(p) content.appendChild(personDiv(p)); }
    if (me.fatherId) { const p=byId.get(me.fatherId); if(p) content.appendChild(personDiv(p)); }
  }

  // Self
  const selfSec = document.createElement('div');
  selfSec.innerHTML = '<div style="color:#4a5a88;font-size:10px;letter-spacing:2px;margin:8px 0 4px">OSOBA</div>';
  content.appendChild(selfSec);
  content.appendChild(personDiv(me, 'selected'));

  // Genes detail
  if (me.genes) {
    const gd = document.createElement('div');
    gd.style.cssText = 'padding:8px 10px;margin:4px 0;background:rgba(58,111,255,0.05);border-radius:5px;font-size:11px;';
    gd.innerHTML = Object.entries(me.genes).map(([k,v])=>`<span style="color:#4a5a88;margin-right:4px">${k}:</span><span style="color:#4488ff">${Math.round(v)}</span>`).join('  ');
    content.appendChild(gd);
  }

  // Children
  if (me.childrenIds && me.childrenIds.length > 0) {
    const sec2 = document.createElement('div');
    sec2.innerHTML = '<div style="color:#4a5a88;font-size:10px;letter-spacing:2px;margin:8px 0 4px">DZIECI</div>';
    content.appendChild(sec2);
    for (const cid of me.childrenIds) {
      const c = byId.get(cid);
      if (c) content.appendChild(personDiv(c));
    }
  }

  modal.classList.add('visible');
}

document.getElementById('genealogy-close').addEventListener('click', () => {
  document.getElementById('genealogy-modal').classList.remove('visible');
});

// ─── TTS audio ──────────────────────────────────────────────────────────────
function handleAudio(base64, title) {
  audioQueue.push({ base64, title });
  if (!audioPlaying) playNextAudio();
}

function playNextAudio() {
  if (audioQueue.length === 0) {
    audioPlaying = false;
    document.getElementById('audio-indicator').classList.remove('active');
    return;
  }
  audioPlaying = true;
  const { base64, title } = audioQueue.shift();

  const ind = document.getElementById('audio-indicator');
  document.getElementById('audio-text').textContent = title || 'Narrator mówi...';
  ind.classList.add('active');

  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type:'audio/mpeg' });
  const url  = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => {
    URL.revokeObjectURL(url);
    ind.classList.remove('active');
    setTimeout(playNextAudio, 2000);
  };
  audio.onerror = () => {
    ind.classList.remove('active');
    setTimeout(playNextAudio, 1000);
  };
  audio.play().catch(() => { ind.classList.remove('active'); setTimeout(playNextAudio,500); });
}

// ─── UI updates ─────────────────────────────────────────────────────────────
let eventCount = 0;

function updateHUD(s) {
  document.getElementById('stat-pop').textContent    = s.population;
  document.getElementById('stat-era').textContent    = s.era;
  document.getElementById('stat-season').textContent = s.season;
  const temp = s.temperature;
  const tempEl = document.getElementById('stat-temp');
  tempEl.textContent = `${temp}°C`;
  tempEl.className = `stat-value${temp < 0 ? ' red' : temp > 35 ? ' gold' : ''}`;
  document.getElementById('stat-tech').textContent    = s.techLevel;
  document.getElementById('stat-plugins').textContent = s.pluginCount || 0;
  document.getElementById('stat-births').textContent  = s.stats.births;
  document.getElementById('stat-deaths').textContent  = s.stats.deaths;
  document.getElementById('day-num').textContent      = s.day;
  document.getElementById('day-progress-fill').style.width = (s.dayProgress*100)+'%';
  document.getElementById('hud-time').textContent = s.isDay ? '☀️ DZIEŃ' : '🌙 NOC';

  // Tech tags
  if (s.technologies && s.technologies.length > 0) {
    const last6 = s.technologies.slice(-6);
    document.getElementById('tech-list').innerHTML = last6.map(t=>`<span class="tech-tag">${t}</span>`).join('');
  }

  // Rebuild terrain on season change
  if (terrainCanvas && s.season !== (window._lastSeason||'Lato')) {
    terrainCanvas = null;
  }
  window._lastSeason = s.season;
}

function addEvent(evt) {
  const tl = document.getElementById('timeline');
  const div = document.createElement('div');
  div.className = 'event-item';

  let ai = '';
  if (evt.architectComment || evt.natureComment) {
    ai = `<div class="event-ai">`;
    if (evt.architectComment) ai += `🏛️ <em>"${evt.architectComment}"</em><br>`;
    if (evt.natureComment)    ai += `⚡ <em>"${evt.natureComment}"</em>`;
    ai += '</div>';
  }

  div.innerHTML = `
    <div class="event-day">DZ. ${evt.day}</div>
    <div class="event-title ${evt.type||'default'}">${evt.icon||''} ${evt.title}</div>
    <div class="event-desc">${evt.description||''}</div>
    ${ai}`;

  tl.insertBefore(div, tl.firstChild);
  eventCount++;
  document.getElementById('event-count').textContent = `${eventCount} zdarzeń`;
  while (tl.children.length > 60) tl.removeChild(tl.lastChild);
}

// ─── WebSocket ───────────────────────────────────────────────────────────────
function connect() {
  const proto = location.protocol==='https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    document.getElementById('loading').style.display = 'none';
    setInterval(() => ws.readyState===WebSocket.OPEN && ws.send(JSON.stringify({type:'ping'})), 25000);
  };

  ws.onmessage = ({data}) => {
    const msg = JSON.parse(data);
    if (msg.type === 'state') {
      prevState  = currState;
      currState  = msg.data;
      lastStateTS = performance.now();
      updateHUD(currState);
    } else if (msg.type === 'event') {
      addEvent(msg.data);
    } else if (msg.type === 'audio') {
      handleAudio(msg.data.base64, msg.data.title);
    }
  };

  ws.onclose = () => setTimeout(connect, 3000);
  ws.onerror = (e) => console.error('[WS]', e);
}

// ─── Boot ─────────────────────────────────────────────────────────────────
connect();
requestAnimationFrame(render);
