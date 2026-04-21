'use strict';
require('dotenv').config();
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const { Simulation } = require('./simulation');
const { testTelegram } = require('./telegram');
const { synthesize }   = require('./tts');

const PORT   = process.env.PORT || 3000;
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '../public')));
app.get('/health',    (_, res) => res.json({ status:'ok', day:sim.world.day, population:sim.world.population, era:sim.world.era, weather:sim.world.weather }));
app.get('/state',     (_, res) => res.json(sim._serialize()));
app.get('/genealogy', (_, res) => res.json(sim.getGenealogy()));

const sim = new Simulation();

wss.on('connection', (ws) => {
  console.log('[WS] Klient połączony');
  ws.send(JSON.stringify({ type:'state', data: sim._serialize() }));
  ws.on('message', (msg) => {
    try { const d = JSON.parse(msg); if (d.type==='ping') ws.send(JSON.stringify({type:'pong'})); } catch {}
  });
  ws.on('close', () => console.log('[WS] Klient rozłączony'));
});

function broadcast(type, data) {
  const payload = JSON.stringify({ type, data });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
}

sim.on('state',   data => broadcast('state',   data));
sim.on('event',   data => broadcast('event',   data));
sim.on('gods',    data => broadcast('gods',    data));
sim.on('sprite',  data => broadcast('sprite',  data));

// TTS queue (non-overlapping narration)
const narrateQueue = [];
let   narrateActive = false;

sim.on('narrate', ({ text, title }) => {
  if (narrateQueue.length >= 2) return;
  narrateQueue.push({ text, title });
  if (!narrateActive) _processNarrate();
});

async function _processNarrate() {
  if (!narrateQueue.length) { narrateActive = false; return; }
  narrateActive = true;
  const { text, title } = narrateQueue.shift();
  console.log(`[TTS] Narruję: "${text.slice(0,55)}..."`);
  const b64 = await synthesize(text);
  if (b64) broadcast('audio', { base64: b64, title });
  setTimeout(_processNarrate, 4000);
}

server.listen(PORT, async () => {
  console.log(`\n🌍 Life Simulation v3 [Matter.js + Dual Gods]`);
  console.log(`   Dashboard: http://localhost:${PORT}\n`);
  await testTelegram();
  sim.start();
});

process.on('SIGTERM', () => { sim.stop(); server.close(); });
process.on('SIGINT',  () => { sim.stop(); server.close(); process.exit(0); });
