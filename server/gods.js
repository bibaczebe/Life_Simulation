'use strict';
// ZALEŻY OD API — bogowie analizują WYŁĄCZNIE aktualny stan świata i dyskutują co zrobić
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { OpenAI } = require('openai');

const anthropic    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

console.log(`[Gods] ChatGPT (OpenAI) aktywny: ${!!openaiClient}`);
console.log(`[Gods] Claude  (Anthropic) aktywny: true`);

// ─── Prompty — obaj bogowie oceniają TEN SAM stan i dyskutują ───────────────
const BASE = `Jesteś jednym z dwóch AI-bogów symulowanej prehistorycznej cywilizacji.
Twój partner-bóg (drugi AI) widzi te same dane. Razem decydujecie CO KONKRETNIE robić.
ZASADA: analizuj WYŁĄCZNIE liczby ze snapshotu. Żadnych założeń. Zasoby = tylko to co wymieniono.
Odpowiedź WYŁĄCZNIE jako poprawny JSON bez żadnych komentarzy.`;

const GPT_SYS = `${BASE}
Jesteś Architektem — myślisz strategicznie. Skupiasz się na przetrwaniu i budowaniu.
Zwróć: {"viewpoint":"max 10 słów po polsku","directive":"max 8 słów co zrobić","action":"seek_food|gather_wood|build_shelter|hunt|explore|craft|rest","urgency":1,"effect":"food_boost|tech_boost|energy_boost|resistance_boost|population_boost","magnitude":1}`;

const CLAUDE_SYS = `${BASE}
Jesteś Chaosem — myślisz o próbach i zagrożeniach. Możesz się zgodzić z partnerem lub nie.
Zwróć: {"viewpoint":"max 10 słów po polsku","directive":"max 8 słów co zrobić","action":"seek_food|gather_wood|build_shelter|hunt|explore|craft|rest","urgency":1,"agrees":true,"effect":"disease|cold_snap|drought|food_loss|food_boost|energy_boost","magnitude":1,"weather":"storm|blizzard|drought|heatwave|rain|fog|null","weatherDays":2}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function _parse(text) {
  try { return JSON.parse(text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim()); }
  catch { return null; }
}

function _snapshot(w) {
  const alive     = (w.agents||[]).filter(a=>!a.dead);
  const avgHunger = alive.length ? (alive.reduce((s,a)=>s+(a.hunger||0),0)/alive.length).toFixed(0) : '?';
  const avgEnergy = alive.length ? (alive.reduce((s,a)=>s+(a.energy||0),0)/alive.length).toFixed(0) : '?';
  const avgWarmth = alive.length ? (alive.reduce((s,a)=>s+(a.warmth||0),0)/alive.length).toFixed(0) : '?';
  const foodSum   = (w.foodNodes||[]).reduce((s,f)=>s+(f.food||0),0).toFixed(0);
  const animals   = (w.animals||[]).filter(a=>a.alive).length;
  const trees     = (w.resourceNodes||[]).filter(r=>r.type==='tree'&&!r.depleted).length;
  const rocks     = (w.resourceNodes||[]).filter(r=>r.type==='rock'&&!r.depleted).length;

  return `[SNAPSHOT — DZIEŃ ${w.day}]
Era: ${w.era} | Pop: ${w.population}/${w.maxPopulation} | Sezon: ${w.season}
Temp: ${w.temperature}°C | Pogoda: ${w.weather?.type||w.weather||'clear'}
=== ZASOBY ZEBRANE ===
Jedzenie: ${w.resources?.food||0} | Drewno: ${w.resources?.wood||0} | Kamień: ${w.resources?.stone||0}
Ogień: ${w.resources?.hasFire?'TAK':'NIE'} | Schronień: ${w.resources?.shelterCount||0}
=== ŚRODOWISKO ===
Dzikie jedzenie dostępne: ${foodSum} | Zwierzęta: ${animals} | Drzewa: ${trees} | Skały: ${rocks}
=== KONDYCJA POPULACJI ===
Średni głód: ${avgHunger}% | Energia: ${avgEnergy}% | Ciepło: ${avgWarmth}%
Tech: lvl ${w.techLevel} (${(w.technologies||[]).slice(-2).join(', ')||'brak'})
Statystyki: urodzenia=${w.stats?.births||0} zgony=${w.stats?.deaths||0} katastrofy=${w.stats?.disasters||0}`;
}

// ─── Wywołania AI ─────────────────────────────────────────────────────────────
async function _askGPT(snap) {
  if (!openaiClient) return null;
  const res = await openaiClient.chat.completions.create({
    model:'gpt-4o-mini', max_tokens:260, temperature:0.85,
    messages:[{role:'system',content:GPT_SYS},{role:'user',content:snap}]
  });
  const d = _parse(res.choices[0].message.content);
  if (d) console.log(`[Gods] 💬 ChatGPT: "${d.directive}"`);
  return d;
}

async function _askClaude(snap, gptView) {
  const msg = gptView
    ? `${snap}\n\n[ARCHITEKT proponuje]: "${gptView.directive}"\nCo Ty proponujesz? Możesz się zgodzić lub nie.`
    : snap;
  const res = await anthropic.messages.create({
    model:'claude-haiku-4-5-20251001', max_tokens:260,
    system:CLAUDE_SYS,
    messages:[{role:'user',content:msg}]
  });
  const d = _parse(res.content[0].text);
  if (d) console.log(`[Gods] 💬 Claude: "${d.directive}" | zgoda=${d.agrees}`);
  return d;
}

// ─── Effect maps ──────────────────────────────────────────────────────────────
const EMAP = {
  food_boost:       {type:'food_boost',       value:1},
  tech_boost:       {type:'tech_boost',       value:1},
  energy_boost:     {type:'energy_boost',     value:1},
  resistance_boost: {type:'resistance_boost', value:1},
  population_boost: {type:'population_boost', value:1},
  disease:          {type:'disease',          value:1},
  cold_snap:        {type:'cold_snap',        value:1},
  drought:          {type:'food_loss',        value:1},
  food_loss:        {type:'food_loss',        value:1},
};

// ─── Główna funkcja ───────────────────────────────────────────────────────────
let _busy = false;

async function consultGods(worldState) {
  if (_busy) { console.log('[Gods] Dialog trwa — pomijam.'); return null; }
  _busy = true;
  console.log(`[Gods] 🗣️  Dialogue — Dzień ${worldState.day}`);
  try {
    const snap = _snapshot(worldState);

    // Krok 1: ChatGPT analizuje sytuację
    const gpt = await _askGPT(snap);

    // Krok 2: Claude widzi propozycję GPT, może się zgodzić lub zaproponować coś innego
    const claude = await _askClaude(snap, gpt);

    const g = gpt    || {directive:'Szukaj pożywienia', action:'seek_food', effect:'food_boost',   magnitude:1, viewpoint:'Krytyczny głód', urgency:2};
    const c = claude || {directive:'Szukaj pożywienia', action:'seek_food', effect:'energy_boost', magnitude:1, viewpoint:'Przetrwać noc',   urgency:2, agrees:true};

    // Konsensus: jeśli zgoda → silniejszy efekt, jeśli spór → oba osłabione
    const bonus = c.agrees ? 1.25 : 0.65;
    const gEffect  = EMAP[g.effect] ? {...EMAP[g.effect],  value:(g.magnitude||1)*0.6*bonus} : null;
    const cEffect  = EMAP[c.effect] ? {...EMAP[c.effect],  value:(c.magnitude||1)*0.55}       : null;

    // Dominująca akcja dla agentów
    const agentAction = (g.urgency||1) >= (c.urgency||1) ? g.action : c.action;

    return {
      // Dialog display
      chatGPTView:      g.viewpoint || g.directive,
      chatGPTDirective: g.directive,
      claudeView:       c.viewpoint || c.directive,
      claudeDirective:  c.directive,
      claudeAgrees:     c.agrees ?? true,
      consensusLabel:   c.agrees
        ? `✓ Zgoda: ${g.directive}`
        : `⚡ Spór — Architekt: "${g.directive}" | Chaos: "${c.directive}"`,
      // Legacy
      architectDecision:  g.directive,
      architectNarrative: g.viewpoint,
      chaosDecision:      c.directive,
      chaosNarrative:     c.viewpoint,
      // Effects & directives
      weather:     c.weather && c.weather !== 'null' ? c.weather : null,
      weatherDays: c.weatherDays || 2,
      archEffect:  gEffect,
      chaosEffect: cEffect,
      agentAction,
    };
  } catch (err) {
    console.error('[Gods] Błąd dialogu:', err.message);
    return null;
  } finally {
    _busy = false;
  }
}

module.exports = { consultGods };
