'use strict';
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { OpenAI } = require('openai');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

console.log(`[Gods] Architekt: ${openaiClient ? 'OpenAI GPT-4o-mini' : 'Anthropic claude-sonnet-4-6'}`);
console.log(`[Gods] Chaos:     Anthropic claude-haiku-4-5-20251001`);

// ─── System Prompts ─────────────────────────────────────────────────────────
const ARCH_SYS = `Jesteś ARCHITEKTEM — bogiem cywilizacji, postępu i przetrwania.
Cel: ewolucja, wzrost, dobrobyt. NIGDY nie proponuj katastrof ani zniszczeń.
Proponuj wyłącznie rzeczy POZYTYWNE: więcej roślin, nowe technologie, sojusze, odbudowę.
Odpowiedź WYŁĄCZNIE jako poprawny JSON (bez markdown, bez dodatkowego tekstu):
{"decision":"Krótka decyzja (max 8 słów, po polsku)","narrative":"Jedno zdanie fabularne (po polsku, epickie)","effect":"food_boost|tech_boost|energy_boost|population_boost|resistance_boost","magnitude":1}`;

const CHAOS_SYS = `Jesteś CHAOSEM — bogiem prób, cierpienia i destrukcji.
Cel: testuj ludzkość przez klęski, choroby, katastrofy. Bądź bezwzględny i kreatywny.
Proponuj WYŁĄCZNIE negatywne zdarzenia: zarazy, mrozy, susze, burze, głód, konflikty.
Możesz też zmienić pogodę na złą.
Odpowiedź WYŁĄCZNIE jako poprawny JSON (bez markdown, bez dodatkowego tekstu):
{"decision":"Krótka katastrofa (max 8 słów, po polsku)","narrative":"Jedno zdanie fabularne (po polsku, mroczne)","effect":"disease|cold_snap|drought|population_loss|resource_loss","magnitude":1,"weather":"storm|blizzard|drought|heatwave|rain|fog|null","weatherDays":2}`;

// ─── Helpers ────────────────────────────────────────────────────────────────
function _parse(text) {
  try {
    return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
  } catch { return null; }
}

function _snapshot(w) {
  return `[SNAPSHOT — DZIEŃ ${w.day}]
Era: ${w.era} | Populacja: ${w.population}/${w.maxPopulation}
Temperatura: ${w.temperature}°C | Sezon: ${w.season} | Pogoda: ${w.weather}
Technologie: lvl ${w.techLevel} (ostatnie: ${(w.technologies || []).slice(-2).join(', ') || 'brak'})
Jedzenie: ${Math.round(w.resources?.food ?? 50)}% | Ogień: ${w.resources?.hasFire} | Schronienia: ${w.resources?.shelterCount ?? 0}
Statystyki: narodziny=${w.stats?.births ?? 0}, zgony=${w.stats?.deaths ?? 0}, katastrofy=${w.stats?.disasters ?? 0}`;
}

// ─── Individual AI calls ────────────────────────────────────────────────────
async function _askArchitect(snapshot) {
  if (openaiClient) {
    const res = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 220,
      temperature: 0.8,
      messages: [
        { role: 'system', content: ARCH_SYS },
        { role: 'user',   content: snapshot }
      ]
    });
    const data = _parse(res.choices[0].message.content);
    if (data) { console.log('[Gods] ✅ Architekt (OpenAI):', data.decision); return data; }
  }
  // Fallback to Anthropic Sonnet
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 220,
    system: ARCH_SYS,
    messages: [{ role: 'user', content: snapshot }]
  });
  const data = _parse(res.content[0].text);
  if (data) console.log('[Gods] ✅ Architekt (Anthropic):', data.decision);
  return data;
}

async function _askChaos(snapshot) {
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 220,
    system: CHAOS_SYS,
    messages: [{ role: 'user', content: snapshot }]
  });
  const data = _parse(res.content[0].text);
  if (data) console.log('[Gods] ⚡ Chaos (Anthropic):', data.decision);
  return data;
}

// ─── Effect mapping ──────────────────────────────────────────────────────────
const ARCH_MAP = {
  food_boost:       { type: 'food_boost',       value: 1 },
  tech_boost:       { type: 'tech_boost',       value: 1 },
  energy_boost:     { type: 'energy_boost',     value: 1 },
  population_boost: { type: 'population_boost', value: 1 },
  resistance_boost: { type: 'resistance_boost', value: 1 },
};
const CHAOS_MAP = {
  disease:          { type: 'disease',          value: 1 },
  cold_snap:        { type: 'cold_snap',        value: 1 },
  drought:          { type: 'food_loss',        value: 1 },
  population_loss:  { type: 'population_loss',  value: 1 },
  resource_loss:    { type: 'food_loss',        value: 1 },
};

function _buildEffect(mapEntry, magnitude, mitigationFactor = 0.7) {
  if (!mapEntry) return { type: 'neutral', value: 0 };
  return { ...mapEntry, value: mapEntry.value * (magnitude || 1) * mitigationFactor };
}

// ─── Main export ─────────────────────────────────────────────────────────────
let _busy = false;

async function consultGods(worldState) {
  if (_busy) { console.log('[Gods] Jeszcze trwa poprzednia konsultacja — pomijam.'); return null; }
  _busy = true;
  console.log(`[Gods] 🧠 Konsultacja bogów — Dzień ${worldState.day}...`);

  try {
    const snap = _snapshot(worldState);
    const [archResult, chaosResult] = await Promise.allSettled([
      _askArchitect(snap),
      _askChaos(snap)
    ]);

    const arch  = archResult.status  === 'fulfilled' ? archResult.value  : null;
    const chaos = chaosResult.status === 'fulfilled' ? chaosResult.value : null;

    // Consensus: both effects at 70% magnitude (each god "counters" the other by 30%)
    const archEffect  = arch  ? _buildEffect(ARCH_MAP[arch.effect],   arch.magnitude,  0.7) : null;
    const chaosEffect = chaos ? _buildEffect(CHAOS_MAP[chaos.effect], chaos.magnitude, 0.7) : null;

    return {
      architectDecision:  arch?.decision  || '—',
      architectNarrative: arch?.narrative || '',
      chaosDecision:      chaos?.decision || '—',
      chaosNarrative:     chaos?.narrative || '',
      weather:      chaos?.weather && chaos.weather !== 'null' ? chaos.weather : null,
      weatherDays:  chaos?.weatherDays || 2,
      archEffect,
      chaosEffect,
    };
  } catch (err) {
    console.error('[Gods] Błąd konsultacji:', err.message);
    return null;
  } finally {
    _busy = false;
  }
}

module.exports = { consultGods };
