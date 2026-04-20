'use strict';
require('dotenv').config();

const { Agent } = require('./agents');
const { generateEvent } = require('./ai');
const { sendTelegram, formatEvent } = require('./telegram');
const EventEmitter = require('events');

const TICK_MS = 100;
const TICKS_PER_DAY = 200;
const MAX_AGENTS = 180;

const ERAS = [
  { name: 'Zamierzch Dziejów', minTech: 0 }, { name: 'Epoka Kamienia', minTech: 2 },
  { name: 'Rewolucja Ognia', minTech: 3 }, { name: 'Epoka Brązu', minTech: 6 },
  { name: 'Starożytność', minTech: 9 }, { name: 'Średniowiecze', minTech: 12 },
  { name: 'Renesans', minTech: 15 }, { name: 'Rewolucja Przemysłowa', minTech: 17 },
  { name: 'Era Nowoczesna', minTech: 19 }, { name: 'Era Kosmiczna', minTech: 21 }
];

const TECH_TREE = [
  { name: 'Język', minPop: 3, icon: '🗣️' }, { name: 'Ogień', minPop: 5, icon: '🔥' },
  { name: 'Narzędzia kamienne', minPop: 8, icon: '🪨' }, { name: 'Schronienie', minPop: 10, icon: '🏕️' },
  { name: 'Łowiectwo', minPop: 12, icon: '🏹' }, { name: 'Ceramika', minPop: 15, icon: '🏺' },
  { name: 'Rolnictwo', minPop: 20, icon: '🌾' }, { name: 'Tkactwo', minPop: 25, icon: '🧵' },
  { name: 'Pismo', minPop: 30, icon: '📜' }, { name: 'Brąz', minPop: 45, icon: '⚔️' },
  { name: 'Koło', minPop: 55, icon: '⚙️' }, { name: 'Nawigacja', minPop: 70, icon: '🧭' },
  { name: 'Żelazo', minPop: 90, icon: '🔩' }, { name: 'Matematyka', minPop: 110, icon: '📐' },
  { name: 'Medycyna', minPop: 130, icon: '⚕️' }, { name: 'Drukowanie', minPop: 160, icon: '📖' },
  { name: 'Proch strzelniczy', minPop: 200, icon: '💣' }, { name: 'Para wodna', minPop: 280, icon: '🏭' },
  { name: 'Elektryczność', minPop: 450, icon: '⚡' }, { name: 'Lotnictwo', minPop: 700, icon: '✈️' },
  { name: 'Komputery', minPop: 1000, icon: '💻' }
];

class Simulation extends EventEmitter {
  constructor() {
    super();
    this.tick = 0;
    this.running = false;
    this._intervalId = null;
    this.world = this._initWorld();
  }

  _initWorld() {
    return {
      day: 0, tick: 0, dayProgress: 0, isDay: true,
      season: 'Lato', seasonDay: 0,
      temperature: 22, era: 'Zamierzch Dziejów', eraIndex: 0,
      population: 2, techLevel: 0, technologies: [],
      resources: { food: 100, hasFire: false, shelterCount: 0, farmCount: 0 },
      foodNodes: this._spawnFoodNodes(),
      fireNodes: [], shelterNodes: [],
      agents: [
        new Agent(45, 28, 'M', 'Adam'),
        new Agent(55, 32, 'F', 'Ewa')
      ],
      events: [],
      stats: { births: 2, deaths: 0, discoveries: 0, disasters: 0 },
      lastAIDay: -99
    };
  }

  _spawnFoodNodes() {
    const nodes = [];
    const positions = [
      [20,15],[80,15],[15,45],[85,45],[50,8],[50,52],[10,28],[90,28],[35,20],[65,20],[35,40],[65,40]
    ];
    for (const [x, y] of positions) {
      nodes.push({ x, y, food: 80 + Math.random() * 20, maxFood: 100, regen: 0.05 + Math.random() * 0.05 });
    }
    return nodes;
  }

  start() {
    if (this.running) return;
    this.running = true;
    console.log('[Sim] 🚀 Symulacja uruchomiona. Dzień 0 — Adam i Ewa budzą się do życia.');
    this._intervalId = setInterval(() => this._tick(), TICK_MS);
  }

  stop() {
    this.running = false;
    if (this._intervalId) clearInterval(this._intervalId);
  }

  _tick() {
    const w = this.world;
    w.tick++;
    w.dayProgress = (w.tick % TICKS_PER_DAY) / TICKS_PER_DAY;
    w.isDay = w.dayProgress > 0.2 && w.dayProgress < 0.8;

    this._updateDayNight(w);
    this._updateAgents(w);
    this._updateFood(w);
    this._checkTech(w);

    if (w.tick % TICKS_PER_DAY === 0) {
      w.day++;
      w.seasonDay++;
      this._onNewDay(w);
    }

    if (w.tick % 5 === 0) {
      this.emit('state', this._serializeState());
    }
  }

  _updateDayNight(w) {
    const angle = w.dayProgress * Math.PI * 2;
    const baseTempBySeason = { Lato: 24, Jesień: 12, Zima: -2, Wiosna: 14 };
    const base = baseTempBySeason[w.season] ?? 15;
    const diurnal = Math.sin(angle) * 8;
    w.temperature = Math.round(base + diurnal);
  }

  _updateAgents(w) {
    const toAdd = [];
    for (let i = w.agents.length - 1; i >= 0; i--) {
      const a = w.agents[i];
      if (a.dead) { w.agents.splice(i, 1); w.stats.deaths++; continue; }
      const child = a.update(w, 1);
      if (child) {
        w.stats.births++;
        toAdd.push(child);
        const childEvt = { day: w.day, title: `Narodziny: ${child.name}`, description: `Nowy Thronglet ${child.name} przyszedł na świat.`, type: 'birth', icon: '👶' };
        w.events.unshift(childEvt);
        this.emit('event', childEvt);
      }
    }

    for (const c of toAdd) {
      if (w.agents.length < MAX_AGENTS) w.agents.push(c);
    }

    w.population = w.agents.filter(a => !a.dead).length;
  }

  _updateFood(w) {
    for (const f of w.foodNodes) {
      f.food = Math.min(f.maxFood, f.food + f.regen);
    }
    const totalFood = w.foodNodes.reduce((s, f) => s + f.food, 0);
    w.resources.food = Math.round(totalFood / w.foodNodes.length);
  }

  _onNewDay(w) {
    if (w.seasonDay >= 90) {
      w.seasonDay = 0;
      const seasons = ['Lato', 'Jesień', 'Zima', 'Wiosna'];
      const idx = seasons.indexOf(w.season);
      w.season = seasons[(idx + 1) % 4];
    }

    if (w.temperature < 0) {
      for (const a of w.agents) {
        if (!a.dead) a.warmth = Math.max(0, a.warmth - 8);
      }
    }

    if (w.day % 3 === 0 && (w.day - w.lastAIDay) >= 3) {
      w.lastAIDay = w.day;
      this._runAIEvent(w);
    }
  }

  _checkTech(w) {
    const w_world = this.world;
    for (let i = w_world.techLevel; i < TECH_TREE.length; i++) {
      const tech = TECH_TREE[i];
      if (w_world.population >= tech.minPop && Math.random() < 0.0005) {
        w_world.technologies.push(tech.name);
        w_world.techLevel = i + 1;
        this._onTechDiscovery(w_world, tech, i + 1);
        break;
      }
    }

    const newEraIdx = ERAS.findLastIndex(e => w_world.techLevel >= e.minTech);
    if (newEraIdx > w_world.eraIndex) {
      const prevEra = w_world.era;
      w_world.eraIndex = newEraIdx;
      w_world.era = ERAS[newEraIdx].name;
      this._onEraChange(w_world, prevEra);
    }
  }

  _onTechDiscovery(w, tech, level) {
    if (tech.name === 'Ogień') { w.resources.hasFire = true; w.fireNodes.push({ x: 50, y: 30 }); }
    if (tech.name === 'Schronienie') { w.resources.shelterCount++; w.shelterNodes.push({ x: 48, y: 28 }, { x: 52, y: 32 }); }
    if (tech.name === 'Rolnictwo') { w.resources.farmCount++; for (const f of w.foodNodes) f.maxFood = 150; }

    const evt = {
      day: w.day,
      title: `${tech.icon} Odkrycie: ${tech.name}`,
      description: `Thronglety odkryły ${tech.name}! Poziom technologii: ${level}.`,
      type: 'discovery',
      icon: tech.icon
    };
    w.events.unshift(evt);
    w.stats.discoveries++;
    this.emit('event', evt);

    const msg = `${tech.icon} *ODKRYCIE: ${tech.name.toUpperCase()}*\n\nPopulacja ${w.population} istot poznała tajemnicę: *${tech.name}*!\n\nEra: *${w.era}* | Dzień: ${w.day}`;
    sendTelegram(msg).catch(console.error);
  }

  _onEraChange(w, prevEra) {
    const evt = { day: w.day, title: `🌍 Nowa Era: ${w.era}`, description: `Cywilizacja wkroczyła w ${w.era}! Poprzednia era: ${prevEra}.`, type: 'era_change', icon: '🌍' };
    w.events.unshift(evt);
    this.emit('event', evt);
    const msg = `🌍 *ZMIANA ERY*\n\nCywilizacja opuściła *${prevEra}*\ni wkroczyła w *${w.era}*!\n\nPopulacja: ${w.population} | Technologie: ${w.techLevel}`;
    sendTelegram(msg).catch(console.error);
  }

  async _runAIEvent(w) {
    console.log(`[Sim] 🧠 Generuję zdarzenie AI dla dnia ${w.day}...`);
    try {
      const event = await generateEvent(w);
      this._applyAIEvent(w, event);

      const evt = {
        day: w.day, title: event.title, description: event.description,
        architectComment: event.architectComment, natureComment: event.natureComment,
        type: event.type, icon: this._eventIcon(event.type)
      };
      w.events.unshift(evt);
      if (w.events.length > 100) w.events = w.events.slice(0, 100);
      this.emit('event', evt);

      const msg = formatEvent(evt, w);
      await sendTelegram(msg);
      console.log(`[Sim] ✅ Zdarzenie AI "${event.title}" zastosowane.`);
    } catch (err) {
      console.error('[Sim] AI event failed:', err.message);
    }
  }

  _applyAIEvent(w, event) {
    for (const eff of [event.primaryEffect, event.secondaryEffect]) {
      if (!eff) continue;
      switch (eff.type) {
        case 'tech_boost':
          for (let i = 0; i < eff.value; i++) {
            if (w.techLevel < TECH_TREE.length) {
              const tech = TECH_TREE[w.techLevel];
              w.technologies.push(tech.name);
              w.techLevel++;
              this._onTechDiscovery(w, tech, w.techLevel);
            }
          }
          break;
        case 'population_boost':
          for (let i = 0; i < eff.value && w.agents.length < MAX_AGENTS; i++) {
            w.agents.push(new Agent());
            w.stats.births++;
          }
          break;
        case 'population_loss':
          const kills = Math.floor(w.agents.length * eff.value);
          for (let i = 0; i < kills; i++) {
            const living = w.agents.filter(a => !a.dead);
            if (living.length > 2) {
              living[Math.floor(Math.random() * living.length)].energy = 0;
            }
          }
          w.stats.disasters++;
          break;
        case 'food_boost':
          for (const f of w.foodNodes) f.food = Math.min(f.maxFood, f.food + eff.value);
          break;
        case 'food_loss':
          for (const f of w.foodNodes) f.food = Math.max(0, f.food - eff.value);
          break;
        case 'energy_boost':
          for (const a of w.agents.filter(ag => !ag.dead)) a.energy = Math.min(100, a.energy + eff.value);
          break;
        case 'cold_snap':
          w.temperature -= eff.value;
          for (const a of w.agents.filter(ag => !ag.dead)) a.warmth = Math.max(0, a.warmth - eff.value * 3);
          break;
        case 'disease':
          for (const a of w.agents.filter(ag => !ag.dead)) {
            if (Math.random() < eff.value) a.energy -= 30;
          }
          w.stats.disasters++;
          break;
        case 'war':
          const warDeaths = Math.min(eff.value * 3, w.agents.length - 2);
          for (let i = 0; i < warDeaths; i++) {
            const living = w.agents.filter(a => !a.dead);
            if (living.length > 2) living[Math.floor(Math.random() * living.length)].energy = 0;
          }
          w.stats.disasters++;
          break;
      }
    }
  }

  _eventIcon(type) {
    return { discovery: '💡', disaster: '💥', war: '⚔️', peace: '🕊️', era_change: '🌍', birth: '👶', death: '💀' }[type] || '📜';
  }

  _serializeState() {
    const w = this.world;
    return {
      day: w.day, dayProgress: w.dayProgress, isDay: w.isDay,
      season: w.season, temperature: w.temperature, era: w.era,
      eraIndex: w.eraIndex, population: w.population,
      techLevel: w.techLevel, technologies: w.technologies,
      resources: w.resources,
      foodNodes: w.foodNodes.map(f => ({ x: f.x, y: f.y, food: Math.round(f.food) })),
      fireNodes: w.fireNodes, shelterNodes: w.shelterNodes,
      agents: w.agents.filter(a => !a.dead).map(a => a.serialize()),
      events: w.events.slice(0, 30),
      stats: w.stats
    };
  }
}

module.exports = { Simulation };
