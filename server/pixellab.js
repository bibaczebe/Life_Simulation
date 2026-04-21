'use strict';
// ZALEŻY OD API — każdy sprite generowany w locie na podstawie cech agenta
const https = require('https');

const PIXELLAB_SECRET = process.env.PIXELLAB_SECRET || 'f7408ff5-eb30-44c6-8c7a-53fa08699090';
const BASE_URL = 'api.pixellab.ai';

// LIMIT TECHNICZNY — ochrona przed zalewem requestów
const MAX_QUEUE = 12;
const MIN_INTERVAL_MS = 1800;

const queue      = [];
let   processing = false;
let   lastCall   = 0;

// ─── Budowanie promptu sprite'a — 100% z cech agenta ─────────────────────────
function buildPrompt(agent, worldState) {
  const era    = worldState?.era        || 'prehistoric';
  const season = worldState?.season     || 'Spring';
  const temp   = worldState?.temperature ?? 15;
  const gender = agent.gender === 'M' ? 'male' : 'female';

  // Wiek → faza życia
  const age = agent.age ?? 0;
  let lifeStage;
  if      (age < 8)  lifeStage = 'child';
  else if (age < 18) lifeStage = 'young adult';
  else if (age < 40) lifeStage = 'adult';
  else               lifeStage = 'elder';

  // Geny → wygląd fizyczny
  const g      = agent.genes || {};
  const bulk   = g.strength     > 65 ? 'stocky muscular' : g.strength < 35 ? 'slim frail' : 'average build';
  const quick  = g.speed        > 65 ? 'alert posture'   : 'relaxed posture';
  const cold   = g.coldResistance > 60 ? 'wearing thick furs' : temp < 5 ? 'shivering, light clothes' : '';

  // Stan → ekspresja twarzy
  const stateExpr = {
    idle:        'neutral expression',
    seek_food:   'hungry desperate look',
    seek_warmth: 'cold frightened look',
    dying:       'exhausted pale dying',
    gestating:   'pregnant glowing happy',
    seek_mate:   'curious longing expression',
    sleep:       'eyes closed sleeping',
    warm:        'relieved warm expression',
  }[agent.state] || 'neutral expression';

  // Era → kostium
  const eraStyle = {
    'Zamierzch Dziejów': 'prehistoric caveman animal skin loincloth',
    'Starożytność':      'ancient roman/greek simple tunic sandals',
    'Wczesne Wieki':     'dark ages rough wool medieval peasant clothes',
    'Feudalizm':         'medieval peasant rough clothing',
    'Renesans':          'renaissance era commoner clothing',
  }[era] || 'prehistoric animal skin';

  // Losowy akcent kolorystyczny ze skóry/włosów
  const skinHex = agent.skinTone  || 'hsl(30,50%,60%)';
  const hairHex = agent.hairColor || 'hsl(30,50%,20%)';

  return [
    `${lifeStage} ${gender} ${bulk} ${quick}`,
    eraStyle,
    cold,
    stateExpr,
    `pixel art RPG character sprite`,
    `facing front, full body, transparent background`,
    `skin tone: ${skinHex.slice(0,20)}, hair: ${hairHex.slice(0,20)}`,
  ].filter(Boolean).join(', ');
}

// ─── HTTP helper (bez zewnętrznej zależności) ────────────────────────────────
function postPixellab(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      description: prompt,
      image_size:  { width: 32, height: 32 },
    });
    const req = https.request({
      hostname: BASE_URL,
      path:     '/v1/generate-image-pixflux',
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${PIXELLAB_SECRET}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          if (data.image?.base64) resolve(data.image.base64);
          else reject(new Error(JSON.stringify(data).slice(0, 120)));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// ─── Kolejka requestów ───────────────────────────────────────────────────────
async function _processQueue() {
  if (processing || !queue.length) return;
  processing = true;

  while (queue.length) {
    const { agent, worldState, resolve, reject } = queue.shift();

    const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));

    const prompt = buildPrompt(agent, worldState);
    console.log(`[Pixellab] 🎨 "${agent.name}" → ${prompt.slice(0, 70)}...`);

    try {
      lastCall = Date.now();
      const b64 = await postPixellab(prompt);
      console.log(`[Pixellab] ✅ ${agent.name} sprite gotowy (${b64.length} chars)`);
      resolve(b64);
    } catch (err) {
      console.warn(`[Pixellab] ⚠️  ${agent.name}: ${err.message}`);
      resolve(null); // nie blokuj symulacji gdy fail
    }
  }

  processing = false;
}

// ─── Publiczne API ────────────────────────────────────────────────────────────
function requestSprite(agent, worldState) {
  return new Promise((resolve, reject) => {
    if (queue.length >= MAX_QUEUE) { resolve(null); return; } // LIMIT TECHNICZNY
    queue.push({ agent, worldState, resolve, reject });
    _processQueue();
  });
}

// Używane przez simulation.js przy narodzinach i zmianie stanu
function scheduleSprite(agent, worldState, onReady) {
  requestSprite(agent, worldState).then(b64 => {
    if (b64 && onReady) onReady(agent.id, b64);
  });
}

module.exports = { requestSprite, scheduleSprite, buildPrompt };
