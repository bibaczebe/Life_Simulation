'use strict';
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { Simulation } = require('./simulation');
const { testTelegram } = require('./telegram');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '../public')));
app.get('/health', (_, res) => res.json({ status: 'ok', day: sim.world.day, population: sim.world.population }));
app.get('/state', (_, res) => res.json(sim._serializeState()));

const sim = new Simulation();

wss.on('connection', (ws) => {
  console.log('[WS] Klient połączony');
  ws.send(JSON.stringify({ type: 'state', data: sim._serializeState() }));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    } catch {}
  });
  ws.on('close', () => console.log('[WS] Klient rozłączony'));
});

function broadcast(type, data) {
  const payload = JSON.stringify({ type, data });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

sim.on('state', (data) => broadcast('state', data));
sim.on('event', (data) => broadcast('event', data));

server.listen(PORT, async () => {
  console.log(`\n🌍 Life Simulation uruchomiony!`);
  console.log(`   Dashboard: http://localhost:${PORT}`);
  console.log(`   Klienci WS: ${wss.clients.size}\n`);

  await testTelegram();
  sim.start();
});

process.on('SIGTERM', () => { sim.stop(); server.close(); });
process.on('SIGINT', () => { sim.stop(); server.close(); process.exit(0); });
