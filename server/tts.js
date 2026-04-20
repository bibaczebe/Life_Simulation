'use strict';
require('dotenv').config();
const https = require('https');

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
const MODEL = 'eleven_turbo_v2_5';

let lastCallTime = 0;
const MIN_INTERVAL_MS = 8000;

async function synthesize(text) {
  if (!API_KEY) { console.log('[TTS] Brak klucza ElevenLabs'); return null; }

  const now = Date.now();
  if (now - lastCallTime < MIN_INTERVAL_MS) {
    console.log('[TTS] Za szybko — pomijam');
    return null;
  }
  lastCallTime = now;

  const cleanText = text.replace(/\*|_|`/g, '').slice(0, 380);

  const body = JSON.stringify({
    text: cleanText,
    model_id: MODEL,
    voice_settings: { stability: 0.80, similarity_boost: 0.75, style: 0.0, use_speaker_boost: false }
  });

  return new Promise((resolve) => {
    const opts = {
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${VOICE_ID}`,
      method: 'POST',
      headers: {
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode === 200) {
          const buf = Buffer.concat(chunks);
          console.log(`[TTS] ✅ Audio wygenerowane (${Math.round(buf.length/1024)}KB)`);
          resolve(buf.toString('base64'));
        } else {
          console.error(`[TTS] ❌ Błąd HTTP ${res.statusCode}`);
          resolve(null);
        }
      });
    });

    req.on('error', (e) => { console.error('[TTS] Błąd połączenia:', e.message); resolve(null); });
    req.write(body);
    req.end();
  });
}

module.exports = { synthesize };
