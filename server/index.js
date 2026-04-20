'use strict';
require('dotenv').config();
const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const path    = require('path');
const { Simulation } = require('./simulation');
const { testTelegram } = require('./telegram');
const { synthesize }  = require('./tts');

const PORT = process.env.PORT || 3000;
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '../public')));
app.get('/health', (_, res) => res.json({ status:'ok', day: sim.world.day, population: sim.world.population, era: sim.world.era }));
app.get('/state',  (_, res) => res.json(sim._serializeState()));
app.get('/genealogy', (_, res) => res.json(sim.getGenealogy()));

const sim = new Simulation();

wss.on('connection', (ws) => {
  console.log('[WS] Klient połączony');
  ws.send(JSON.stringify({ type:'state', data: sim._serializeState() }));
  ws.on('message', (msg) => {
    try {
      const d = JSON.parse(msg);
      if (d.type === 'ping') ws.send(JSON.stringify({ type:'pong' }));
    } catch {}
  });
  ws.on('close', () => console.log('[WS] Klient rozłączony'));
});

function broadcast(type, data) {
  const payload = JSON.stringify({ type, data });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
}

sim.on('state', data => broadcast('state', data));
sim.on('event', data => broadcast('event', data));

// TTS narration — only for important events, debounced
let narrateQueue = [];
let narrateActive = false;

sim.on('narrate', async ({ text, title }) => {
  if (narrateQueue.length > 2) return; // don't queue too many
  narrateQueue.push({ text, title });
  if (!narrateActive) processNarrateQueue();
});

async function processNarrateQueue() {
  if (narrateQueue.length === 0) { narrateActive = false; return; }
  narrateActive = true;
  const { text, title } = narrateQueue.shift();
  const narrationText = title ? `${title}. ${text}` : text;
  console.log(`[TTS] Narracja: "${narrationText.slice(0,60)}..."`);
  const audioB64 = await synthesize(narrationText);
  if (audioB64) {
    broadcast('audio', { base64: audioB64, title });
  }
  // Wait a bit before next narration to prevent overlap
  setTimeout(processNarrateQueue, 3000);
}

server.listen(PORT, async () => {
  console.log(`\n🌍 Life Simulation v2 uruchomiony!`);
  console.log(`   Dashboard: http://localhost:${PORT}`);
  await testTelegram();
  sim.start();
});

process.on('SIGTERM', () => { sim.stop(); server.close(); });
process.on('SIGINT',  () => { sim.stop(); server.close(); process.exit(0); });
