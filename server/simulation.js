'use strict';
require('dotenv').config();
const EventEmitter = require('events');
const { Agent }       = require('./agents');
const { PhysicsWorld }= require('./physics');
const { WeatherSystem}= require('./weather');
const { consultGods } = require('./gods');
const { sendTelegram, formatEvent } = require('./telegram');
const { synthesize }  = require('./tts');
const plugins         = require('./plugins');
const { scheduleSprite } = require('./pixellab');

const TICK_MS       = 100;
const TICKS_PER_DAY = 200;    // 200 * 100ms = 20 seconds = 1 day
const MAX_AGENTS    = 180;
const DAYS_SEASON   = 90;

const ERAS = [
  { name:'Zamierzch Dziejów', minTech:0 },{ name:'Epoka Kamienia', minTech:2 },
  { name:'Rewolucja Ognia',   minTech:3 },{ name:'Epoka Brązu',    minTech:6 },
  { name:'Starożytność',      minTech:9 },{ name:'Średniowiecze',  minTech:12 },
  { name:'Renesans',          minTech:15},{ name:'Rewolucja Przemysłowa', minTech:17 },
  { name:'Era Nowoczesna',    minTech:19},{ name:'Era Kosmiczna',  minTech:21 }
];
const TECH_TREE = [
  { name:'Język',       minPop:3,   icon:'🗣️' },{ name:'Ogień',       minPop:5,   icon:'🔥' },
  { name:'Narzędzia',   minPop:8,   icon:'🪨' },{ name:'Schronienie', minPop:10,  icon:'🏕️' },
  { name:'Łowiectwo',   minPop:12,  icon:'🏹' },{ name:'Ceramika',    minPop:15,  icon:'🏺' },
  { name:'Rolnictwo',   minPop:20,  icon:'🌾' },{ name:'Tkactwo',     minPop:25,  icon:'🧵' },
  { name:'Pismo',       minPop:30,  icon:'📜' },{ name:'Brąz',        minPop:45,  icon:'⚔️' },
  { name:'Koło',        minPop:55,  icon:'⚙️' },{ name:'Nawigacja',   minPop:70,  icon:'🧭' },
  { name:'Żelazo',      minPop:90,  icon:'🔩' },{ name:'Matematyka',  minPop:110, icon:'📐' },
  { name:'Medycyna',    minPop:130, icon:'⚕️' },{ name:'Drukowanie',  minPop:160, icon:'📖' },
  { name:'Proch',       minPop:200, icon:'💣' },{ name:'Para wodna',  minPop:280, icon:'🏭' },
  { name:'Elektryczność',minPop:450,icon:'⚡' },{ name:'Lotnictwo',   minPop:700, icon:'✈️' },
  { name:'Komputery',   minPop:1000,icon:'💻' }
];

class Simulation extends EventEmitter {
  constructor() {
    super();
    this.physics = new PhysicsWorld();
    this.weather = new WeatherSystem();
    this.tick    = 0;
    this.running = false;
    this._id     = null;
    this.world   = this._initWorld();
    this.genealogy = new Map();
    plugins.loadAll();
    this._setupCollisions();
  }

  _initWorld() {
    const adam = new Agent(44, 28, 'M', 'Adam');
    const ewa  = new Agent(56, 32, 'F', 'Ewa');
    this.physics.addAgent(adam.id, adam.x, adam.y, adam.genes);
    this.physics.addAgent(ewa.id,  ewa.x,  ewa.y,  ewa.genes);
    return {
      day: 0, tick: 0, dayProgress: 0, isDay: true,
      dayDelta: 1 / TICKS_PER_DAY,
      season: 'Lato', seasonDay: 0,
      temperature: 22, era: 'Zamierzch Dziejów', eraIndex: 0,
      population: 2,   maxPopulation: 25,
      techLevel: 0,    technologies: [],
      weather: 'clear', weatherSpeedMod: 1,
      resources: { food: 90, wood: 0, hasFire: false, shelterCount: 0, farmCount: 0 },
      foodNodes:    this._genFood(),
      fireNodes:    [],
      shelterNodes: [],
      agents:       [adam, ewa],
      events:       [],
      stats:        { births: 2, deaths: 0, discoveries: 0, disasters: 0, wars: 0 },
      lastGodDay:   -99,
      lastPluginDay:-99,
    };
  }

  _genFood() {
    const pos = [[18,12],[82,12],[12,48],[88,48],[50,6],[50,54],[8,28],[92,28],[33,18],[67,18],[33,42],[67,42]];
    return pos.map(([x,y]) => ({ x, y, food: 65+Math.random()*35, maxFood:100, regen:0.04+Math.random()*0.04 }));
  }

  _setupCollisions() {
    this.physics.onCollision((aId, bId) => {
      const a = this.world.agents.find(ag => ag.id === aId);
      const b = this.world.agents.find(ag => ag.id === bId);
      if (a && b && !a.dead && !b.dead) {
        a.socialBonds = (a.socialBonds || 0) + 0.1;
        b.socialBonds = (b.socialBonds || 0) + 0.1;
      }
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    const w = this.world;
    for (const a of w.agents) {
      this.genealogy.set(a.id, a.genealogyEntry());
      scheduleSprite(a, { era: w.era, season: w.season, temperature: w.temperature },
        (id, b64) => { a.sprite = b64; this.emit('sprite', { id, base64: b64 }); });
    }
    console.log('[Sim] 🚀 Symulacja v3 uruchomiona. Matter.js aktywny. Dzień = 20s.');
    this._id = setInterval(() => this._tick(), TICK_MS);
  }

  stop() { this.running = false; if (this._id) clearInterval(this._id); }

  _tick() {
    const w = this.world;
    w.tick++;
    w.dayProgress = (w.tick % TICKS_PER_DAY) / TICKS_PER_DAY;
    w.isDay = w.dayProgress > 0.2 && w.dayProgress < 0.8;
    w.dayDelta = 1 / TICKS_PER_DAY;
    w.weatherSpeedMod = this.weather.speedMod;

    this.physics.step(TICK_MS);
    this._dayNight(w);
    this._updateAgents(w);
    this._updateFood(w);
    this._checkTech(w);
    this._checkPlugins(w);

    if (w.tick % TICKS_PER_DAY === 0) {
      w.day++;
      w.seasonDay++;
      this._onNewDay(w);
    }

    if (w.tick % 5 === 0) this.emit('state', this._serialize());
  }

  _dayNight(w) {
    const tempBySeason = { Lato:25, Jesień:9, Zima:-5, Wiosna:12 };
    const base  = tempBySeason[w.season] ?? 15;
    const diurnal  = Math.sin(w.dayProgress * Math.PI * 2) * 8;
    const nightDrop = w.isDay ? 0 : -20;   // Night drops 20°C
    w.temperature = Math.round(base + diurnal + nightDrop + this.weather.tempMod);
  }

  _updateAgents(w) {
    const toAdd = [];
    for (let i = w.agents.length - 1; i >= 0; i--) {
      const a = w.agents[i];
      if (a.dead) {
        this.genealogy.set(a.id, a.genealogyEntry());
        this.physics.removeAgent(a.id);
        w.agents.splice(i, 1);
        w.stats.deaths++;
        const evt = this._mkEvt(w.day, `[Dzień ${w.day}] ${a.name} nie żyje. Populacja: ${w.agents.length-1}.`, 'death', '💀');
        this._pushEvent(w, evt);
        continue;
      }
      const child = a.update(w, this.physics, w.dayDelta);
      if (child && w.agents.length < MAX_AGENTS) {
        w.stats.births++;
        w.agents.push(child);
        this.physics.addAgent(child.id, child.x, child.y, child.genes);
        this.genealogy.set(child.id, child.genealogyEntry());
        const evt = this._mkEvt(w.day, `[Dzień ${w.day}] ${a.name} urodziła ${child.name}. Populacja: ${w.agents.length}.`, 'birth', '👶');
        this._pushEvent(w, evt);
        // Generuj sprite asynchronicznie — nie blokuje pętli
        scheduleSprite(child, {
          era: w.era, season: w.season, temperature: w.temperature
        }, (id, b64) => {
          child.sprite = b64;
          this.emit('sprite', { id, base64: b64 });
        });
      }
    }
    w.population = w.agents.filter(a => !a.dead).length;
    w.maxPopulation = 20 + w.techLevel * 15;
  }

  _updateFood(w) {
    const rMod = this.weather.foodMod;
    for (const f of w.foodNodes) {
      const bonus = w.resources.farmCount ? 1.4 : 1.0;
      f.food = Math.min(f.maxFood, f.food + f.regen * bonus * rMod);
    }
    w.resources.food = Math.round(w.foodNodes.reduce((s,f)=>s+f.food,0) / w.foodNodes.length);
  }

  _onNewDay(w) {
    // Season cycle
    if (w.seasonDay >= DAYS_SEASON) {
      w.seasonDay = 0;
      const s = ['Lato','Jesień','Zima','Wiosna'];
      const prev = w.season;
      w.season = s[(s.indexOf(w.season)+1)%4];
      const evt = this._mkEvt(w.day, `[Dzień ${w.day}] ${prev} minęło. Nadeszła ${w.season}. Temperatura: ${w.temperature}°C.`, 'default',
        { Lato:'☀️', Jesień:'🍂', Zima:'❄️', Wiosna:'🌸' }[w.season]);
      this._pushEvent(w, evt);
    }

    // Weather tick
    const wChange = this.weather.tick(true);
    if (wChange?.changed) {
      w.weather = this.weather.type;
      const evt = this._mkEvt(w.day, `[Dzień ${w.day}] Pogoda zmieniona: ${this.weather.label}. ${wChange.to === 'storm' ? 'Błyskawice nad osadą.' : ''}`, 'disaster', this.weather.icon);
      this._pushEvent(w, evt);
    } else if (wChange?.cleared) {
      w.weather = 'clear';
      const evt = this._mkEvt(w.day, `[Dzień ${w.day}] ${wChange.from === 'storm' ? 'Burza minęła.' : 'Pogoda się poprawiła.'} Temperatura: ${w.temperature}°C.`, 'default', '☀️');
      this._pushEvent(w, evt);
    } else {
      w.weather = this.weather.type;
    }

    // Lightning strike during storm
    if (this.weather.checkLightning()) {
      const victims = w.agents.filter(a => !a.dead);
      if (victims.length > 0) {
        const v = victims[Math.floor(Math.random() * victims.length)];
        v.health = 0;
        const evt = this._mkEvt(w.day, `[Dzień ${w.day}] Piorun zabił ${v.name}. Populacja w szoku.`, 'disaster', '⚡');
        this._pushEvent(w, evt);
        sendTelegram(`⚡ *Piorun uderzył!*\n${v.name} nie żyje. Pop: ${w.population}.`).catch(()=>{});
      }
    }

    // God system every 2 days
    if ((w.day - w.lastGodDay) >= 2) {
      w.lastGodDay = w.day;
      this._runGods(w);
    }

    // Plugin generation every 20 days
    if ((w.day - w.lastPluginDay) >= 20 && w.day > 15) {
      w.lastPluginDay = w.day;
      this._genPlugin(w);
    }
  }

  _checkTech(w) {
    if (w.techLevel >= TECH_TREE.length) return;
    const tech = TECH_TREE[w.techLevel];
    const smart = w.agents.reduce((m,a) => (a.genes?.intelligence ?? 0) > (m?.genes?.intelligence ?? 0) ? a : m, null);
    const intBonus = smart ? smart.genes.intelligence / 100 : 0.5;
    if (w.population >= tech.minPop && Math.random() < 0.00010 * intBonus) {
      this._discoverTech(w, tech);
    }
  }

  _discoverTech(w, tech) {
    w.technologies.push(tech.name);
    w.techLevel++;
    w.stats.discoveries++;
    if (tech.name === 'Ogień')     { w.resources.hasFire = true; w.fireNodes.push({ x:50, y:30 }); }
    if (tech.name === 'Schronienie') { w.resources.shelterCount++; w.shelterNodes.push({ x:48,y:28 }, { x:52,y:32 }); }
    if (tech.name === 'Rolnictwo')   { w.resources.farmCount = (w.resources.farmCount||0)+1; for (const f of w.foodNodes) f.maxFood = 150; }

    const evt = this._mkEvt(w.day, `[Dzień ${w.day}] Odkrycie: ${tech.name}. Poziom technologii: ${w.techLevel}.`, 'discovery', tech.icon);
    this._pushEvent(w, evt);
    sendTelegram(`${tech.icon} *ODKRYCIE: ${tech.name.toUpperCase()}*\nPop: ${w.population} | Dzień: ${w.day} | Era: ${w.era}`).catch(()=>{});

    // Era change
    const ni = ERAS.findLastIndex(e => w.techLevel >= e.minTech);
    if (ni > w.eraIndex) {
      const prev = w.era;
      w.eraIndex = ni; w.era = ERAS[ni].name;
      const eraEvt = this._mkEvt(w.day, `[Dzień ${w.day}] Nowa era: ${w.era}. Koniec ${prev}.`, 'era_change', '🌍');
      this._pushEvent(w, eraEvt);
      sendTelegram(`🌍 *NOWA ERA: ${w.era}*\nPop: ${w.population}`).catch(()=>{});
    }
  }

  _checkPlugins(w) {
    const triggered = plugins.checkTriggers(w);
    for (const plugin of triggered) {
      for (const eff of (plugin.effects || [])) this._applyEffect(w, eff);
      const evt = this._mkEvt(w.day, `[Dzień ${w.day}] ${plugin.name}. ${plugin.description || ''}`, plugin.eventType || 'default', plugin.icon || '🔌');
      this._pushEvent(w, evt);
    }
  }

  async _runGods(w) {
    console.log(`[Sim] 🧠 Konsultacja bogów — Dzień ${w.day}`);
    try {
      const consensus = await consultGods({
        day: w.day, era: w.era, population: w.population, maxPopulation: w.maxPopulation,
        temperature: w.temperature, season: w.season, weather: w.weather,
        techLevel: w.techLevel, technologies: w.technologies,
        resources: w.resources, stats: w.stats
      });
      if (!consensus) return;

      // Apply effects
      if (consensus.archEffect)  this._applyEffect(w, consensus.archEffect);
      if (consensus.chaosEffect) this._applyEffect(w, consensus.chaosEffect);
      if (consensus.weather)     this.weather.set(consensus.weather, consensus.weatherDays || 2);

      w.stats.disasters += consensus.chaosEffect?.type === 'disease' || consensus.chaosEffect?.type === 'population_loss' ? 1 : 0;

      // Factual event
      const archPart  = `Architekt: ${consensus.architectDecision}.`;
      const chaosPart = `Chaos: ${consensus.chaosDecision}.`;
      const archEvt = this._mkEvt(w.day, `[Dzień ${w.day}] ${archPart}`, 'discovery', '🏛️',
        consensus.architectDecision, consensus.architectNarrative);
      const chaosEvt = this._mkEvt(w.day, `[Dzień ${w.day}] ${chaosPart}`, 'disaster', '⚡',
        consensus.chaosDecision, consensus.chaosNarrative);

      this._pushEvent(w, archEvt);
      this._pushEvent(w, chaosEvt);

      // God panel update
      this.emit('gods', {
        architectDecision:  consensus.architectDecision,
        architectNarrative: consensus.architectNarrative,
        chaosDecision:      consensus.chaosDecision,
        chaosNarrative:     consensus.chaosNarrative,
        weather:            consensus.weather,
        day:                w.day
      });

      // Telegram
      const tgMsg = `🏛️ *Architekt*: _${consensus.architectNarrative || consensus.architectDecision}_\n\n⚡ *Chaos*: _${consensus.chaosNarrative || consensus.chaosDecision}_\n\nDzień ${w.day} | ${w.era} | Pop: ${w.population}`;
      await sendTelegram(tgMsg);

      // TTS narration (only architectNarrative - the positive part)
      if (consensus.architectNarrative) {
        this.emit('narrate', { text: consensus.architectNarrative, title: `Dzień ${w.day}` });
      }

    } catch (err) {
      console.error('[Sim] Gods error:', err.message);
    }
  }

  async _genPlugin(w) {
    try {
      const { generatePlugin } = require('./ai');
      const plugin = await generatePlugin(w);
      if (plugin?.name) {
        plugins.save(plugin, w.day);
        const evt = this._mkEvt(w.day, `[Dzień ${w.day}] Nowy scenariusz aktywowany: ${plugin.name}.`, 'discovery', '⚗️');
        this._pushEvent(w, evt);
      }
    } catch (e) { console.error('[Sim] Plugin gen error:', e.message); }
  }

  _applyEffect(w, eff) {
    if (!eff || eff.type === 'neutral') return;
    const mag = eff.value || 1;
    switch (eff.type) {
      case 'food_boost':
        for (const f of w.foodNodes) f.food = Math.min(f.maxFood, f.food + mag * 18);
        break;
      case 'food_loss':
        for (const f of w.foodNodes) f.food = Math.max(0, f.food - mag * 15);
        break;
      case 'tech_boost':
        for (let i = 0; i < Math.ceil(mag) && w.techLevel < TECH_TREE.length; i++) {
          this._discoverTech(w, TECH_TREE[w.techLevel]);
        }
        break;
      case 'energy_boost':
        for (const a of w.agents.filter(a=>!a.dead)) a.energy = Math.min(100, a.energy + mag * 12);
        break;
      case 'resistance_boost':
        for (const a of w.agents.filter(a=>!a.dead)) {
          a.genes.coldResistance = Math.min(95, a.genes.coldResistance + mag * 5);
          a.genes.endurance = Math.min(95, a.genes.endurance + mag * 3);
        }
        break;
      case 'population_boost':
        for (let i = 0; i < Math.round(mag * 3) && w.agents.length < MAX_AGENTS; i++) {
          const a = new Agent(); this.physics.addAgent(a.id, a.x, a.y, a.genes);
          this.genealogy.set(a.id, a.genealogyEntry()); w.agents.push(a); w.stats.births++;
        }
        break;
      case 'population_loss': {
        const kills = Math.floor(w.agents.filter(a=>!a.dead).length * Math.min(0.4, mag * 0.08));
        let killed = 0;
        for (const a of w.agents.filter(a=>!a.dead).sort(()=>Math.random()-0.5)) {
          if (killed >= kills) break;
          a.health = 0; killed++;
        }
        break;
      }
      case 'disease':
        for (const a of w.agents.filter(a=>!a.dead)) {
          const res = (a.genes?.resistance ?? 50) / 100;
          if (Math.random() < Math.min(0.5, mag * 0.08) * (1 - res * 0.5)) a.health -= 30;
        }
        break;
      case 'cold_snap':
        w.temperature -= Math.round(mag * 5);
        for (const a of w.agents.filter(a=>!a.dead)) a.warmth = Math.max(0, a.warmth - mag * 15);
        break;
    }
  }

  _mkEvt(day, text, type, icon, decision, narrative) {
    return { day, text, type: type || 'default', icon: icon || '📜', decision, narrative };
  }

  _pushEvent(w, evt) {
    w.events.unshift(evt);
    if (w.events.length > 150) w.events = w.events.slice(0, 150);
    this.emit('event', evt);
  }

  _serialize() {
    const w = this.world;
    return {
      day: w.day, dayProgress: w.dayProgress, isDay: w.isDay,
      season: w.season, temperature: w.temperature, era: w.era, eraIndex: w.eraIndex,
      population: w.population, maxPopulation: w.maxPopulation,
      techLevel: w.techLevel, technologies: w.technologies,
      resources: { ...w.resources },
      weather: this.weather.serialize(),
      foodNodes:    w.foodNodes.map(f=>({ x:f.x, y:f.y, food:+f.food.toFixed(0) })),
      fireNodes:    w.fireNodes,
      shelterNodes: w.shelterNodes,
      agents:  w.agents.filter(a=>!a.dead).map(a=>a.serialize()),
      events:  w.events.slice(0, 50),
      stats:   { ...w.stats },
      pluginCount: plugins.getAll().length
    };
  }

  getGenealogy() {
    const byId = new Map(this.genealogy);
    for (const a of this.world.agents) byId.set(a.id, a.genealogyEntry());
    return [...byId.values()];
  }
}

module.exports = { Simulation };
