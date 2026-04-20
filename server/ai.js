require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ARCHITECT_PROMPT = `Jesteś "Architektem Postępu i Współpracy" — bóstwem, które pragnie widzieć rozkwit cywilizacji.
Obserwujesz symulację ludzkości i proponujesz JEDNO konkretne zdarzenie historyczne, które popchnie cywilizację do przodu.
Musisz odpowiedzieć TYLKO w formacie JSON (bez markdown, bez bloku kodu):
{
  "title": "Krótki tytuł zdarzenia (max 8 słów)",
  "description": "Fabularyzowany opis zdarzenia (2-3 zdania, po polsku, narracyjny, epicki)",
  "comment": "Twój komentarz jako bóstwo (1 zdanie, dumny/optymistyczny)",
  "effect": "discovery|population_boost|resource_boost|peace|era_hint",
  "magnitude": 1-5
}`;

const NATURE_PROMPT = `Jesteś "Siłą Natury i Chaosu" — bóstwem reprezentującym nieokiełznaną naturę, nieprzewidywalność i próby.
Obserwujesz propozycję Architekta i REAGUJESZ na nią, wprowadzając kontrzdarzenie lub komplikację.
Musisz odpowiedzieć TYLKO w formacie JSON (bez markdown, bez bloku kodu):
{
  "title": "Krótki tytuł reakcji (max 8 słów)",
  "comment": "Twój komentarz jako bóstwo (1 zdanie, groźny/ironiczny/poważny)",
  "effect": "disaster|population_loss|resource_loss|war|disease|cold_snap|drought",
  "magnitude": 1-3
}`;

const FALLBACK_EVENTS = [
  { title: 'Wielka Migracja', description: 'Część plemienia wyruszyła w nieznane, szukając żyzniejszych ziem.', architectComment: 'Odwaga w obliczu nieznanego jest fundamentem cywilizacji.', natureComment: 'Każda droga ma swój koniec. Czy ten będzie dobry?', type: 'discovery', effect: { type: 'population_boost', value: 2 } },
  { title: 'Czas Burz', description: 'Gwałtowne burze zniszczyły zapasy i zmusiły grupę do szukania nowych schronień.', architectComment: 'Przetrwajcie, a będziecie silniejsi.', natureComment: 'Natura przypomniała im, kto tu rządzi.', type: 'disaster', effect: { type: 'resource_loss', value: 20 } },
  { title: 'Pakt Krwi', description: 'Dwa rywalizujące rody zawarły sojusz, wzmacniając swoje szanse na przetrwanie.', architectComment: 'Jedność jest podstawą wszelkiej cywilizacji.', natureComment: 'Ciekawe, jak długo wytrzyma ta kruchą zgoda...', type: 'peace', effect: { type: 'morale_boost', value: 10 } },
];

function parseAIResponse(text) {
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function worldSummary(world) {
  const techList = world.technologies.slice(-3).join(', ') || 'brak';
  return `Stan świata:
- Dzień: ${world.day} | Era: ${world.era} | Pora roku: ${world.season}
- Populacja: ${world.population} (żywych agentów: ${world.agents.filter(a => !a.dead).length})
- Temperatura: ${world.temperature}°C | ${world.isDay ? 'Dzień' : 'Noc'}
- Technologie (ostatnie): ${techList}
- Zasoby: jedzenie=${Math.round(world.resources.food)}, ogień=${world.resources.hasFire}, schronienia=${world.resources.shelterCount}
- Statystyki: narodziny=${world.stats.births}, śmierci=${world.stats.deaths}`;
}

async function generateEvent(world) {
  try {
    const summary = worldSummary(world);

    const architectRes = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: ARCHITECT_PROMPT,
      messages: [{ role: 'user', content: summary }]
    });

    const architectData = parseAIResponse(architectRes.content[0].text);
    if (!architectData) throw new Error('Architect parse failed');

    const natureRes = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: NATURE_PROMPT,
      messages: [{
        role: 'user',
        content: `${summary}\n\nArchitekt zaproponował wydarzenie:\n"${architectData.title}" — ${architectData.description}\n\nJak reagujesz?`
      }]
    });

    const natureData = parseAIResponse(natureRes.content[0].text);

    const primaryEffect = mapEffect(architectData.effect, architectData.magnitude);
    const secondaryEffect = natureData ? mapEffect(natureData.effect, natureData.magnitude) : null;

    return {
      title: architectData.title,
      description: architectData.description,
      architectComment: architectData.comment,
      natureComment: natureData?.comment || 'Natura obserwuje w milczeniu...',
      type: classifyType(architectData.effect, natureData?.effect),
      primaryEffect,
      secondaryEffect
    };
  } catch (err) {
    console.error('[AI] Event generation failed:', err.message);
    return { ...FALLBACK_EVENTS[Math.floor(Math.random() * FALLBACK_EVENTS.length)] };
  }
}

function mapEffect(effectName, magnitude = 1) {
  const m = Math.max(1, Math.min(5, magnitude));
  const effects = {
    discovery: { type: 'tech_boost', value: 1 },
    population_boost: { type: 'population_boost', value: m * 3 },
    resource_boost: { type: 'food_boost', value: m * 15 },
    peace: { type: 'energy_boost', value: m * 10 },
    era_hint: { type: 'tech_boost', value: 2 },
    disaster: { type: 'population_loss', value: Math.round(m * 0.1 * 100) / 100 },
    population_loss: { type: 'population_loss', value: Math.round(m * 0.08 * 100) / 100 },
    resource_loss: { type: 'food_loss', value: m * 20 },
    war: { type: 'war', value: m },
    disease: { type: 'disease', value: m * 0.05 },
    cold_snap: { type: 'cold_snap', value: m * 5 },
    drought: { type: 'drought', value: m * 2 },
    morale_boost: { type: 'energy_boost', value: 15 }
  };
  return effects[effectName] || { type: 'neutral', value: 0 };
}

function classifyType(archEffect, natureEffect) {
  if (['disaster', 'population_loss', 'war', 'disease', 'cold_snap'].includes(natureEffect)) return 'disaster';
  if (['discovery', 'era_hint'].includes(archEffect)) return 'discovery';
  if (archEffect === 'peace') return 'peace';
  if (archEffect === 'population_boost') return 'birth';
  return 'default';
}

module.exports = { generateEvent };
