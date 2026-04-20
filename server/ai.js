'use strict';
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ARCHITECT_PROMPT = `Jesteś "Architektem Postępu i Współpracy" — bóstwem cywilizacji.
Obserwujesz symulację ludzkości i proponujesz JEDNO zdarzenie, które popchnie cywilizację do przodu.
Odpowiedź WYŁĄCZNIE jako JSON (bez markdown):
{
  "title": "Tytuł zdarzenia (max 8 słów)",
  "description": "Epicki opis narracyjny (2-3 zdania po polsku, dramatyczny, jak saga historyczna)",
  "comment": "Twój komentarz bóstwa (1 zdanie, dumny/optymistyczny)",
  "effect": "discovery|population_boost|resource_boost|peace|era_hint",
  "magnitude": 1
}`;

const NATURE_PROMPT = `Jesteś "Siłą Natury i Chaosu" — nieokiełznanym bóstwem prób.
Reagujesz na propozycję Architekta, wprowadzając kontrzdarzenie.
Odpowiedź WYŁĄCZNIE jako JSON (bez markdown):
{
  "comment": "Twój komentarz bóstwa (1 zdanie, groźny/ironiczny)",
  "effect": "disaster|population_loss|resource_loss|war|disease|cold_snap",
  "magnitude": 1
}`;

const PLUGIN_PROMPT = `Jesteś kreatywnym designerem symulacji historycznej. Zaprojektuj NOWY scenariusz/mechankę dla symulacji cywilizacji.
Odpowiedź WYŁĄCZNIE jako JSON (bez markdown):
{
  "name": "Krótka nazwa scenariusza (3-5 słów po polsku)",
  "description": "Opis co się dzieje (2 zdania po polsku)",
  "icon": "emoji",
  "trigger": "day|population|season_change|tech_level|era|random",
  "condition": { "day": number ALBO "min": number ALBO "season": "Lato|Jesień|Zima|Wiosna" ALBO "level": number ALBO "chance": number },
  "effects": [{ "type": "food_boost|food_loss|energy_boost|population_boost|population_loss|tech_boost|cold_snap|disease|war", "value": number }],
  "eventType": "discovery|disaster|war|peace|default",
  "repeatable": false
}`;

const FALLBACK_EVENTS = [
  { title:'Wielka Migracja', description:'Część plemienia wyruszyła szukać nowych ziem. Znaleźli żyzne doliny.', architectComment:'Odwaga w obliczu nieznanego jest fundamentem cywilizacji.', natureComment:'Każda droga ma swój koniec. Czy ten będzie dobry?', type:'discovery', primaryEffect:{ type:'population_boost', value:2 }, secondaryEffect:null },
  { title:'Burza Zniszczyła Obóz', description:'Gwałtowna burza zniszczyła zapasy. Plemię musiało szukać schronienia.', architectComment:'Przetrwajcie, będziecie silniejsi.', natureComment:'Natura przypomniała, kto rządzi.', type:'disaster', primaryEffect:{ type:'food_loss', value:20 }, secondaryEffect:null },
  { title:'Pakt Dwóch Rodów', description:'Dwa rody zawarły sojusz przy ognisku, dzieląc jedzenie i wiedzę.', architectComment:'Jedność jest podstawą cywilizacji.', natureComment:'Ciekawa ta zgoda... jak długo wytrzyma?', type:'peace', primaryEffect:{ type:'energy_boost', value:15 }, secondaryEffect:null },
  { title:'Zaraza Nawiedziła Osadę', description:'Tajemnicza choroba przeszła przez osadę. Wielu słabych nie przeżyło.', architectComment:'To próba, która wzmocni tych co przetrwają.', natureComment:'Choroba to mój głos — nie zapominajcie o mnie.', type:'disaster', primaryEffect:{ type:'disease', value:0.08 }, secondaryEffect:null },
];

function parseJSON(text) {
  try { return JSON.parse(text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim()); }
  catch { return null; }
}

function worldSummary(w) {
  const tech = w.technologies.slice(-3).join(', ') || 'brak';
  return `Stan świata — Dzień ${w.day} | Era: ${w.era} | Sezon: ${w.season}
Populacja: ${w.population}/${w.maxPopulation} | Temp: ${w.temperature}°C | ${w.isDay?'Dzień':'Noc'}
Technologie (ostatnie): ${tech} | Poziom tech: ${w.techLevel}
Zasoby: jedzenie=${Math.round(w.resources.food)}, ogień=${w.resources.hasFire}, schronienia=${w.resources.shelterCount}
Statystyki: narodziny=${w.stats.births}, zgony=${w.stats.deaths}, katastrofy=${w.stats.disasters}`;
}

async function generateEvent(w) {
  try {
    const summary = worldSummary(w);
    const archRes = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 380,
      system: ARCHITECT_PROMPT,
      messages: [{ role:'user', content: summary }]
    });
    const arch = parseJSON(archRes.content[0].text);
    if (!arch) throw new Error('Architect parse fail');

    const natRes = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 250,
      system: NATURE_PROMPT,
      messages: [{ role:'user', content: `${summary}\n\nArchitekt proponuje: "${arch.title}" — ${arch.description}\n\nJak reagujesz?` }]
    });
    const nat = parseJSON(natRes.content[0].text);

    return {
      title: arch.title, description: arch.description,
      architectComment: arch.comment,
      natureComment: nat?.comment || 'Natura obserwuje...',
      type: _classifyType(arch.effect, nat?.effect),
      primaryEffect:   _mapEffect(arch.effect, arch.magnitude || 1),
      secondaryEffect: nat ? _mapEffect(nat.effect, nat.magnitude || 1) : null
    };
  } catch (err) {
    console.error('[AI] generateEvent błąd:', err.message);
    return FALLBACK_EVENTS[Math.floor(Math.random()*FALLBACK_EVENTS.length)];
  }
}

async function generatePlugin(w) {
  try {
    const summary = worldSummary(w);
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 400,
      system: PLUGIN_PROMPT,
      messages: [{ role:'user', content: `${summary}\n\nZaprojektuj nowy, ciekawy i unikalny scenariusz który jeszcze nie miał miejsca w tej symulacji. Bądź kreatywny — może to być: migracja, epidemia, objawienie, złota era, trzęsienie ziemi, kometa, słynny przywódca, rewolucja, itp.` }]
    });
    return parseJSON(res.content[0].text);
  } catch (err) {
    console.error('[AI] generatePlugin błąd:', err.message);
    return null;
  }
}

function _mapEffect(name, mag) {
  const m = Math.max(1, Math.min(5, mag));
  const map = {
    discovery:        { type:'tech_boost',        value: 1 },
    era_hint:         { type:'tech_boost',        value: 2 },
    population_boost: { type:'population_boost',  value: m*3 },
    resource_boost:   { type:'food_boost',        value: m*15 },
    peace:            { type:'energy_boost',      value: m*12 },
    disaster:         { type:'population_loss',   value: m*0.08 },
    population_loss:  { type:'population_loss',   value: m*0.07 },
    resource_loss:    { type:'food_loss',         value: m*18 },
    war:              { type:'war',               value: m },
    disease:          { type:'disease',           value: m*0.05 },
    cold_snap:        { type:'cold_snap',         value: m*4 },
    drought:          { type:'food_loss',         value: m*12 }
  };
  return map[name] || { type:'neutral', value:0 };
}

function _classifyType(a, n) {
  if (['disaster','population_loss','war','disease','cold_snap'].includes(n)) return 'disaster';
  if (['discovery','era_hint'].includes(a)) return 'discovery';
  if (a === 'peace') return 'peace';
  if (a === 'population_boost') return 'birth';
  return 'default';
}

module.exports = { generateEvent, generatePlugin };
