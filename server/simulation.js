'use strict';
require('dotenv').config();
const path = require('path');
const { Agent } = require('./agents');
const { generateEvent, generatePlugin } = require('./ai');
const { sendTelegram, formatEvent } = require('./telegram');
const plugins = require('./plugins');
const EventEmitter = require('events');

const TICK_MS       = 100;
const TICKS_PER_DAY = 900;    // 900 * 100ms = 90 seconds = 1.5 minutes
const MAX_AGENTS    = 200;
const DAYS_PER_SEASON = 90;

const ERAS = [
  { name: 'Zamierzch Dziejów',       minTech: 0  },
  { name: 'Epoka Kamienia',          minTech: 2  },
  { name: 'Rewolucja Ognia',         minTech: 3  },
  { name: 'Epoka Brązu',             minTech: 6  },
  { name: 'Starożytność',            minTech: 9  },
  { name: 'Średniowiecze',           minTech: 12 },
  { name: 'Renesans',                minTech: 15 },
  { name: 'Rewolucja Przemysłowa',   minTech: 17 },
  { name: 'Era Nowoczesna',          minTech: 19 },
  { name: 'Era Kosmiczna',           minTech: 21 }
];

const TECH_TREE = [
  { name: 'Język',             minPop:  3,  icon: '🗣️', shelter: false },
  { name: 'Ogień',             minPop:  5,  icon: '🔥', shelter: false },
  { name: 'Narzędzia',         minPop:  8,  icon: '🪨', shelter: false },
  { name: 'Schronienie',       minPop: 10,  icon: '🏕️', shelter: true  },
  { name: 'Łowiectwo',         minPop: 12,  icon: '🏹', shelter: false },
  { name: 'Ceramika',          minPop: 15,  icon: '🏺', shelter: false },
  { name: 'Rolnictwo',         minPop: 20,  icon: '🌾', shelter: false },
  { name: 'Tkactwo',           minPop: 25,  icon: '🧵', shelter: false },
  { name: 'Pismo',             minPop: 30,  icon: '📜', shelter: false },
  { name: 'Brąz',              minPop: 45,  icon: '⚔️', shelter: false },
  { name: 'Koło',              minPop: 55,  icon: '⚙️', shelter: false },
  { name: 'Nawigacja',         minPop: 70,  icon: '🧭', shelter: false },
  { name: 'Żelazo',            minPop: 90,  icon: '🔩', shelter: false },
  { name: 'Matematyka',        minPop: 110, icon: '📐', shelter: false },
  { name: 'Medycyna',          minPop: 130, icon: '⚕️', shelter: false },
  { name: 'Drukowanie',        minPop: 160, icon: '📖', shelter: false },
  { name: 'Proch',             minPop: 200, icon: '💣', shelter: false },
  { name: 'Para wodna',        minPop: 280, icon: '🏭', shelter: false },
  { name: 'Elektryczność',     minPop: 450, icon: '⚡', shelter: false },
  { name: 'Lotnictwo',         minPop: 700, icon: '✈️', shelter: false },
  { name: 'Komputery',         minPop: 1000,icon: '💻', shelter: false }
];

class Simulation extends EventEmitter {
  constructor() {
    super();
    this.tick    = 0;
    this.running = false;
    this._id     = null;
    this.world   = this._initWorld();
    this.genealogy = new Map();
    plugins.loadAll();
  }

  _initWorld() {
    return {
      day: 0, tick: 0, dayProgress: 0, isDay: true,
      dayDelta: 1 / TICKS_PER_DAY,
      season: 'Lato', seasonDay: 0,
      temperature: 22, era: 'Zamierzch Dziejów', eraIndex: 0,
      population: 2, maxPopulation: 30,
      techLevel: 0, technologies: [],
      resources: { food: 90, wood: 0, stone: 0, hasFire: false, shelterCount: 0, needsWood: 0 },
      foodNodes:    this._genFoodNodes(),
      fireNodes:    [],
      shelterNodes: [],
      buildSites:   [],
      agents:       [
        new Agent(44, 28, 'M', 'Adam'),
        new Agent(56, 32, 'F', 'Ewa')
      ],
      events:      [],
      stats:       { births: 2, deaths: 0, discoveries: 0, disasters: 0, wars: 0 },
      lastAIDay:   -99,
      lastPluginDay: -99
    };
  }

  _genFoodNodes() {
    const pos = [[18,12],[82,12],[12,48],[88,48],[50,6],[50,54],[8,28],[92,28],[33,18],[67,18],[33,42],[67,42],[50,28]];
    return pos.map(([x,y]) => ({ x, y, food: 70+Math.random()*30, maxFood: 100, regen: 0.04+Math.random()*0.04 }));
  }

  start() {
    if (this.running) return;
    this.running = true;
    // Register starting agents to genealogy
    for (const a of this.world.agents) this.genealogy.set(a.id, a.genealogyEntry());
    console.log('[Sim] 🚀 Symulacja uruchomiona. Adam i Ewa wyruszają w nieznane.');
    this._id = setInterval(() => this._tick(), TICK_MS);
  }

  stop() {
    this.running = false;
    if (this._id) clearInterval(this._id);
  }

  _tick() {
    const w = this.world;
    w.tick++;
    w.dayProgress = (w.tick % TICKS_PER_DAY) / TICKS_PER_DAY;
    w.isDay = w.dayProgress > 0.2 && w.dayProgress < 0.8;
    w.dayDelta = 1 / TICKS_PER_DAY;

    this._updateDayNight(w);
    this._updateAgents(w);
    this._updateFood(w);
    this._checkTech(w);
    this._checkPluginTriggers(w);
    this._checkBuilding(w);

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
    const tempBySeason = { Lato: 25, Jesień: 10, Zima: -3, Wiosna: 13 };
    const base = tempBySeason[w.season] ?? 15;
    const diurnal = Math.sin(w.dayProgress * Math.PI * 2) * 9;
    w.temperature = Math.round(base + diurnal);
  }

  _updateAgents(w) {
    const toAdd = [];
    for (let i = w.agents.length - 1; i >= 0; i--) {
      const a = w.agents[i];
      if (a.dead) {
        this.genealogy.set(a.id, a.genealogyEntry());
        w.agents.splice(i, 1);
        w.stats.deaths++;
        const evt = { day: w.day, title: `Śmierć: ${a.name}`, description: `${a.name} odszedł po ${a.age.toFixed(0)} dniach życia.`, type: 'death', icon: '💀' };
        w.events.unshift(evt);
        this.emit('event', evt);
        continue;
      }
      const child = a.update(w);
      if (child) {
        w.stats.births++;
        toAdd.push(child);
        this.genealogy.set(child.id, child.genealogyEntry());
        const evt = { day: w.day, title: `Narodziny: ${child.name}`, description: `${a.name} urodziła ${child.gender === 'F' ? 'córkę' : 'syna'} — ${child.name}.`, type: 'birth', icon: '👶' };
        w.events.unshift(evt);
        this.emit('event', evt);
      }
    }
    for (const c of toAdd) {
      if (w.agents.length < MAX_AGENTS) w.agents.push(c);
    }
    w.population = w.agents.filter(a => !a.dead).length;
    // Grow maxPopulation with tech
    w.maxPopulation = 20 + w.techLevel * 15;
  }

  _updateFood(w) {
    for (const f of w.foodNodes) {
      const regenBonus = w.resources.farmCount ? 1.5 : 1.0;
      f.food = Math.min(f.maxFood, f.food + f.regen * regenBonus);
    }
    w.resources.food = Math.round(w.foodNodes.reduce((s,f) => s + f.food, 0) / w.foodNodes.length);
  }

  _onNewDay(w) {
    if (w.seasonDay >= DAYS_PER_SEASON) {
      w.seasonDay = 0;
      const s = ['Lato','Jesień','Zima','Wiosna'];
      w.season = s[(s.indexOf(w.season)+1) % 4];
      const evt = { day: w.day, title: `Zmiana pory roku: ${w.season}`, description: `Nadeszła ${w.season}.`, type: 'default', icon: { Lato:'☀️',Jesień:'🍂',Zima:'❄️',Wiosna:'🌸' }[w.season] };
      w.events.unshift(evt);
      this.emit('event', evt);
    }

    // Winter health damage
    if (w.temperature < 0) {
      for (const a of w.agents) {
        if (!a.dead && a.warmth < 30) a.health = Math.max(0, a.health - 3);
      }
    }

    // AI events every 3 days (with offset)
    if ((w.day - w.lastAIDay) >= 3) {
      w.lastAIDay = w.day;
      this._runAIEvent(w);
    }

    // Auto-generate new plugin every 20 days
    if ((w.day - w.lastPluginDay) >= 20 && w.day > 10) {
      w.lastPluginDay = w.day;
      this._runPluginGeneration(w);
    }
  }

  _checkTech(w) {
    if (w.techLevel >= TECH_TREE.length) return;
    const tech = TECH_TREE[w.techLevel];
    // Intelligence of smartest agent increases discovery speed
    const smartest = w.agents.reduce((m, a) => a.genes?.intelligence > (m?.genes?.intelligence ?? 0) ? a : m, null);
    const intBonus  = smartest ? smartest.genes.intelligence / 100 : 0.5;
    const chance    = 0.00008 * intBonus;

    if (w.population >= tech.minPop && Math.random() < chance) {
      w.technologies.push(tech.name);
      w.techLevel++;
      this._onTechDiscovery(w, tech, w.techLevel);
    }
  }

  _checkBuilding(w) {
    // Trigger shelter build when wood is sufficient and tech allows
    if (w.techLevel >= 3 && w.resources.wood >= 10 && w.agents.length > 0) {
      const site = { x: 48 + (Math.random()-0.5)*10, y: 28 + (Math.random()-0.5)*8 };
      w.shelterNodes.push(site);
      w.resources.shelterCount++;
      w.resources.wood -= 10;
      w.resources.needsWood = Math.max(0, (w.resources.needsWood || 0) - 10);
      if (w.agents.length > 2) {
        const evt = { day: w.day, title: '🏕️ Zbudowano schronienie', description: 'Thronglety wzniosły nowe schronienie.', type: 'discovery', icon: '🏕️' };
        w.events.unshift(evt);
        this.emit('event', evt);
      }
    }

    // Request more wood when few shelters
    if (w.techLevel >= 3 && w.resources.shelterCount < Math.ceil(w.population / 5)) {
      w.resources.needsWood = Math.max(w.resources.needsWood, 15);
    }
  }

  _checkPluginTriggers(w) {
    const triggered = plugins.checkTriggers(w);
    for (const plugin of triggered) {
      console.log(`[Plugin] 🔌 Wyzwolony: "${plugin.name}"`);
      const effects = plugin.effects || [];
      for (const eff of effects) this._applyEffectObject(w, eff);
      const evt = { day: w.day, title: plugin.name, description: plugin.description || '', type: plugin.eventType || 'default', icon: plugin.icon || '🔌' };
      w.events.unshift(evt);
      this.emit('event', evt);
      const msg = `🔌 *NOWY SCENARIUSZ: ${plugin.name}*\n\n${plugin.description}\n\nEra: ${w.era} | Dzień: ${w.day}`;
      sendTelegram(msg).catch(console.error);
    }
  }

  _onTechDiscovery(w, tech, level) {
    if (tech.name === 'Ogień')     { w.resources.hasFire = true; w.fireNodes.push({ x: 50, y: 30 }); }
    if (tech.name === 'Schronienie') { w.resources.needsWood = 20; }
    if (tech.name === 'Rolnictwo') { w.resources.farmCount = (w.resources.farmCount||0)+1; for (const f of w.foodNodes) f.maxFood = 150; }

    w.stats.discoveries++;
    const evt = { day: w.day, title: `${tech.icon} Odkrycie: ${tech.name}`, description: `Thronglety odkryły ${tech.name}! Poziom: ${level}.`, type: 'discovery', icon: tech.icon };
    w.events.unshift(evt);
    this.emit('event', evt);
    const msg = `${tech.icon} *ODKRYCIE: ${tech.name.toUpperCase()}*\n\nPopulacja ${w.population} — nowa technologia!\n\nEra: *${w.era}* | Dzień: ${w.day}`;
    sendTelegram(msg).catch(console.error);
  }

  _onEraChange(w, prev) {
    const evt = { day: w.day, title: `🌍 Nowa Era: ${w.era}`, description: `Cywilizacja wkroczyła w ${w.era}!`, type: 'era_change', icon: '🌍' };
    w.events.unshift(evt);
    this.emit('event', evt);
    sendTelegram(`🌍 *ZMIANA ERY*\n*${prev}* → *${w.era}*\nPopulacja: ${w.population}`).catch(console.error);
  }

  async _runAIEvent(w) {
    console.log(`[Sim] 🧠 Generuję zdarzenie AI dla dnia ${w.day}...`);
    try {
      const event = await generateEvent(w);
      this._applyAIEvent(w, event);
      const evt = { day: w.day, title: event.title, description: event.description, architectComment: event.architectComment, natureComment: event.natureComment, type: event.type, icon: this._typeIcon(event.type) };
      w.events.unshift(evt);
      if (w.events.length > 120) w.events = w.events.slice(0, 120);
      this.emit('event', evt);
      this.emit('narrate', { text: event.description, title: event.title });
      await sendTelegram(formatEvent(evt, w));
      console.log(`[Sim] ✅ Zdarzenie: "${event.title}"`);
    } catch (err) {
      console.error('[Sim] AI event błąd:', err.message);
    }
  }

  async _runPluginGeneration(w) {
    console.log(`[Sim] 🧪 Generuję nowy scenariusz dla dnia ${w.day}...`);
    try {
      const plugin = await generatePlugin(w);
      if (plugin && plugin.name) {
        const filename = plugins.save(plugin, w.day);
        console.log(`[Sim] 🔌 Nowy scenariusz: ${plugin.name} → ${filename}`);
        this.emit('event', { day: w.day, title: `⚗️ Nowy scenariusz: ${plugin.name}`, description: plugin.description, type: 'discovery', icon: '⚗️' });
      }
    } catch (err) {
      console.error('[Sim] Plugin generation błąd:', err.message);
    }
  }

  _applyAIEvent(w, event) {
    this._applyEffectObject(w, event.primaryEffect);
    this._applyEffectObject(w, event.secondaryEffect);
  }

  _applyEffectObject(w, eff) {
    if (!eff) return;
    switch (eff.type) {
      case 'tech_boost':
        for (let i = 0; i < (eff.value||1) && w.techLevel < TECH_TREE.length; i++) {
          const tech = TECH_TREE[w.techLevel];
          w.technologies.push(tech.name);
          w.techLevel++;
          this._onTechDiscovery(w, tech, w.techLevel);
          const ni = ERAS.findLastIndex(e => w.techLevel >= e.minTech);
          if (ni > w.eraIndex) { const prev = w.era; w.eraIndex = ni; w.era = ERAS[ni].name; this._onEraChange(w, prev); }
        }
        break;
      case 'population_boost':
        for (let i = 0; i < (eff.value||2) && w.agents.length < MAX_AGENTS; i++) {
          const a = new Agent(); this.genealogy.set(a.id, a.genealogyEntry()); w.agents.push(a); w.stats.births++;
        }
        break;
      case 'population_loss':
        const kills = Math.floor(w.agents.filter(a=>!a.dead).length * (eff.value||0.1));
        for (let i = 0; i < kills; i++) {
          const living = w.agents.filter(a=>!a.dead);
          if (living.length > 2) living[Math.floor(Math.random()*living.length)].health = 0;
        }
        w.stats.disasters++;
        break;
      case 'food_boost':  for (const f of w.foodNodes) f.food = Math.min(f.maxFood, f.food+(eff.value||20)); break;
      case 'food_loss':   for (const f of w.foodNodes) f.food = Math.max(0, f.food-(eff.value||15)); break;
      case 'energy_boost': for (const a of w.agents.filter(a=>!a.dead)) a.energy = Math.min(100,a.energy+(eff.value||15)); break;
      case 'cold_snap':
        w.temperature -= eff.value||5;
        for (const a of w.agents.filter(a=>!a.dead)) a.warmth = Math.max(0,a.warmth-(eff.value||5)*3);
        w.stats.disasters++;
        break;
      case 'disease':
        for (const a of w.agents.filter(a=>!a.dead)) {
          const resMod = a.genes?.resistance ?? 50;
          if (Math.random() < (eff.value||0.05) * (1 - resMod/200)) a.health -= 25;
        }
        w.stats.disasters++;
        break;
      case 'war':
        const wd = Math.min((eff.value||2)*4, w.agents.length-2);
        for (let i=0;i<wd;i++) { const l=w.agents.filter(a=>!a.dead); if(l.length>2) l[Math.floor(Math.random()*l.length)].health=0; }
        w.stats.wars++;
        break;
    }
    // Era check after any tech boost
    const ni = ERAS.findLastIndex(e => w.techLevel >= e.minTech);
    if (ni > w.eraIndex) { const prev = w.era; w.eraIndex = ni; w.era = ERAS[ni].name; this._onEraChange(w, prev); }
  }

  _typeIcon(t) {
    return { discovery:'💡',disaster:'💥',war:'⚔️',peace:'🕊️',era_change:'🌍',birth:'👶',death:'💀',default:'📜' }[t]||'📜';
  }

  _serializeState() {
    const w = this.world;
    return {
      day: w.day, dayProgress: w.dayProgress, isDay: w.isDay,
      season: w.season, temperature: w.temperature, era: w.era, eraIndex: w.eraIndex,
      population: w.population, maxPopulation: w.maxPopulation,
      techLevel: w.techLevel, technologies: w.technologies,
      resources: { ...w.resources },
      foodNodes:    w.foodNodes.map(f=>({ x:f.x, y:f.y, food:+f.food.toFixed(0) })),
      fireNodes:    w.fireNodes,
      shelterNodes: w.shelterNodes,
      agents:  w.agents.filter(a=>!a.dead).map(a=>a.serialize()),
      events:  w.events.slice(0, 40),
      stats:   { ...w.stats },
      pluginCount: plugins.getAll().length
    };
  }

  getGenealogy() {
    const entries = [];
    for (const [, entry] of this.genealogy) entries.push(entry);
    for (const a of this.world.agents) if (!a.dead) entries.push(a.genealogyEntry());
    return entries;
  }
}

module.exports = { Simulation };
