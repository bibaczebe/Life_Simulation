'use strict';

const MALE_NAMES   = ['Adam','Borys','Casimir','Dawid','Emil','Fabian','Grzegorz','Hugo','Igor','Jakub','Kamil','Leon','Marek','Norbert','Oskar','Piotr','Rafał','Stefan','Tomek','Ulryk','Viktor','Wojtek','Zygmunt','Henryk','Lech','Mieszko'];
const FEMALE_NAMES = ['Ewa','Basia','Celina','Diana','Anna','Fiona','Grażyna','Hanna','Irena','Julia','Kasia','Lidia','Maja','Nina','Olga','Paula','Roma','Sara','Teresa','Urszula','Wanda','Xenia','Zosia','Halina','Jadwiga'];

const THOUGHTS = {
  idle:         ['Dziś słońce przyjemnie grzeje.','Dokąd dziś pójdę?','Słyszę odgłosy w lesie.','Czas na wędrówkę.'],
  seek_food:    ['Muszę znaleźć jedzenie!','Żołądek mnie boli...','Zapach jedzenia gdzieś w pobliżu.'],
  eat:          ['Nareszcie coś do jedzenia.','To smaczne.','Odzyskuję siły.'],
  seek_warmth:  ['Zimno... muszę znaleźć ciepło!','Drżę...','Gdzie jest ogień?'],
  warm:         ['Przy ogniu jest bezpiecznie.','Ciepło... mogę odpocząć.'],
  sleep:        ['Dobranoc, świecie.','Śnię o ciepłym lecie.'],
  seek_mate:    ['Ktoś mi się podoba.','Chciałbym porozmawiać z tą osobą.'],
  gestating:    ['Czuję jak rośnie nowe życie.','Muszę być ostrożna.','Wkrótce będę matką.'],
  dying:        ['Siły mnie opuszczają...','Żyłem jak umiałem.','Zimny oddech...'],
};

let idCounter = 0;
const WW = 100, WH = 60;

class Agent {
  constructor(x, y, gender, name, parentA, parentB) {
    this.id     = ++idCounter;
    this.x      = x  ?? (15 + Math.random() * 70);
    this.y      = y  ?? (10 + Math.random() * 40);
    this.gender = gender ?? (Math.random() < 0.5 ? 'M' : 'F');
    this.name   = name ?? (this.gender === 'M'
      ? MALE_NAMES[Math.floor(Math.random() * MALE_NAMES.length)]
      : FEMALE_NAMES[Math.floor(Math.random() * FEMALE_NAMES.length)]);

    // Vitals
    this.energy  = 80 + Math.random() * 20;
    this.hunger  = 10 + Math.random() * 20;
    this.warmth  = 85 + Math.random() * 15;
    this.health  = 90 + Math.random() * 10;
    this.age     = 0;         // simulation days

    // Genetics
    this.genes = this._inheritGenes(parentA?.genes, parentB?.genes);

    // Psychology
    this.happiness   = 60 + Math.random() * 30;
    this.psychState  = 'spokojny';
    this.thought     = '';
    this.thoughtTimer = 0;

    // Genealogy
    this.motherId    = parentA?.id ?? null;
    this.fatherId    = parentB?.id ?? null;
    this.childrenIds = [];

    // FSM
    this.state        = 'idle';
    this.targetX      = null;
    this.targetY      = null;
    this.tribe        = null;
    this.mateCooldown = 0;
    this.gestatingDays = 0;    // >0 = pregnant
    this.dead         = false;
    this.dyingTicks   = 0;

    // Visual (physics position managed by PhysicsWorld)
    this.color     = this.gender === 'M' ? '#5599ff' : '#ff55bb';
    this.hairColor = `hsl(${25+Math.floor(Math.random()*18)},${40+Math.random()*30}%,${18+Math.random()*18}%)`;
    this.skinTone  = `hsl(${26+Math.floor(Math.random()*14)},${38+Math.random()*22}%,${52+Math.random()*18}%)`;
    this.trail     = [];
  }

  _inheritGenes(gA, gB) {
    const base = { speed: 50, strength: 50, intelligence: 50, coldResistance: 50, fertility: 50, endurance: 50 };
    if (!gA || !gB) {
      return Object.fromEntries(Object.entries(base).map(([k,v]) => [k, v + (Math.random()-0.5)*22]));
    }
    return Object.fromEntries(Object.entries(base).map(([k]) => {
      const avg = (gA[k] + gB[k]) / 2;
      const mut = (Math.random()-0.5) * 12;
      return [k, Math.max(5, Math.min(95, avg + mut))];
    }));
  }

  // Called every tick by simulation, physics already stepped
  update(world, physics, dayDelta) {
    if (this.dead) return null;

    this.age          += dayDelta;
    this.mateCooldown  = Math.max(0, this.mateCooldown - dayDelta);

    this._updateVitals(world, dayDelta);
    this._updatePsych(dayDelta);
    this._updateThought();
    const child = this._fsm(world, physics, dayDelta);

    // Sync position from physics
    const pos = physics.getPos(this.id);
    if (pos) {
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 8) this.trail.shift();
      this.x = pos.x;
      this.y = pos.y;
    }

    // Death conditions
    if (this.energy <= 0 || this.warmth <= 0 || this.health <= 0) {
      if (this.state !== 'dying') this.state = 'dying';
    }
    if (this.state === 'dying') {
      physics.stop(this.id);
      this.dyingTicks++;
      if (this.dyingTicks > 25) { this.dead = true; return null; }
    }

    const maxAge = 55 + this.genes.endurance * 0.35 + world.techLevel * 1.5;
    if (this.age >= maxAge) this.state = 'dying';

    // Gestation: 30 sim-days (= 600 real-sec with 20s days)
    if (this.gestatingDays > 0) {
      this.gestatingDays += dayDelta;
      if (this.gestatingDays >= 30) {
        this.gestatingDays = 0;
        this.state = 'idle';
        return this._birth(world);
      }
    }

    return child;
  }

  _updateVitals(world, dd) {
    const endMod = this.genes.endurance / 100;
    const resMod = this.genes.coldResistance / 100;

    this.hunger = Math.min(100, this.hunger + dd * 1.4);
    this.energy -= dd * (0.45 - endMod * 0.15);
    if (this.hunger > 65) this.energy -= dd * 0.55;

    // Night cold
    if (!world.isDay) {
      const baseCold = world.temperature < 0 ? 0.20 : world.temperature < 8 ? 0.08 : 0.02;
      const fireProt = world.resources.hasFire ? (0.4 + resMod * 0.3) : (resMod * 0.5);
      const wMod = world.weatherSpeedMod ?? 1;
      this.warmth = Math.max(0, this.warmth - baseCold * dd * (1 - fireProt) * (2 - wMod));
    } else {
      this.warmth = Math.min(100, this.warmth + dd * 0.06);
    }
    if (this.warmth < 15) this.health -= dd * 0.12;

    this.energy = Math.max(0, Math.min(100, this.energy));
    this.health = Math.max(0, Math.min(100, this.health));
  }

  _updatePsych(dd) {
    const delta = (this.hunger < 35 && this.warmth > 50 && this.energy > 45) ? 0.2 : -0.18;
    this.happiness = Math.max(0, Math.min(100, this.happiness + delta * dd));
    if (this.happiness > 78) this.psychState = 'radosny';
    else if (this.happiness > 55) this.psychState = 'spokojny';
    else if (this.happiness < 20) this.psychState = 'przygnębiony';
    else if (this.hunger > 70) this.psychState = 'zestresowany';
    else if (this.warmth < 25) this.psychState = 'niespokojny';
    else if (this.gestatingDays > 0) this.psychState = 'euforyczny';
  }

  _updateThought() {
    if (--this.thoughtTimer <= 0) {
      const pool = THOUGHTS[this.state] || THOUGHTS.idle;
      this.thought = pool[Math.floor(Math.random() * pool.length)];
      this.thoughtTimer = 60 + Math.floor(Math.random() * 100);
    }
  }

  _fsm(world, physics, dd) {
    if (this.state === 'dying') return null;

    switch (this.state) {
      case 'idle': {
        if (this.warmth < 22 && !world.isDay) { this.state = 'seek_warmth'; break; }
        if (this.hunger > 58) { this.state = 'seek_food'; break; }
        if (!world.isDay && world.resources.shelterCount > 0 && this.energy < 50) { this.state = 'sleep'; break; }
        if (Math.random() < 0.004) { this.state = 'seek_mate'; break; }
        physics.wander(this.id, this.genes.speed, world.weatherSpeedMod ?? 1);
        break;
      }
      case 'seek_food': {
        const food = this._nearestFood(world);
        if (food) {
          physics.seekTarget(this.id, food.x, food.y, this.genes.speed, world.weatherSpeedMod ?? 1);
          if (this._distTo(food.x, food.y) < 5 && food.food > 5) {
            const ate = Math.min(food.food, 10 + this.genes.strength * 0.06);
            food.food -= ate;
            this.hunger  = Math.max(0, this.hunger  - ate * 1.3);
            this.energy  = Math.min(100, this.energy  + ate * 0.6);
            this.health  = Math.min(100, this.health  + ate * 0.05);
            if (this.hunger < 20) { this.state = 'idle'; physics.wander(this.id, this.genes.speed); }
          }
        } else if (this.hunger < 35) { this.state = 'idle'; }
        break;
      }
      case 'seek_warmth': {
        const ws = this._nearestWarmth(world);
        if (ws) {
          physics.seekTarget(this.id, ws.x, ws.y, this.genes.speed, world.weatherSpeedMod ?? 1);
          if (this._distTo(ws.x, ws.y) < 7) { this.state = 'warm'; physics.stop(this.id); }
        } else { this.state = 'idle'; }
        break;
      }
      case 'warm': {
        this.warmth = Math.min(100, this.warmth + 1.8 * dd);
        if (this.warmth > 72 || world.isDay) { this.state = 'idle'; }
        break;
      }
      case 'sleep': {
        physics.stop(this.id);
        this.energy = Math.min(100, this.energy + 0.5 * dd);
        this.warmth = Math.min(100, this.warmth + 0.3 * dd);
        this.health = Math.min(100, this.health + 0.04 * dd);
        if (world.isDay) { this.state = 'idle'; }
        break;
      }
      case 'seek_mate': {
        if (Math.random() < 0.006) { this.state = 'idle'; break; }
        const mate = this._nearestOpposite(world);
        if (mate && this.mateCooldown <= 0 && mate.mateCooldown <= 0 &&
            this.energy > 62 && mate.energy > 62 &&
            this.age > 14 && this.age < 55 && mate.age > 14 && mate.age < 55 &&
            this.gestatingDays === 0 && mate.gestatingDays === 0 &&
            world.population < world.maxPopulation) {
          physics.seekTarget(this.id, mate.x, mate.y, this.genes.speed);
          if (this._distTo(mate.x, mate.y) < 6) {
            // Mate!
            const fertAvg = (this.genes.fertility + mate.genes.fertility) / 200;
            this.mateCooldown = 80 + (1 - fertAvg) * 60;
            mate.mateCooldown = this.mateCooldown;
            this.energy -= 7; mate.energy -= 5;
            if (this.gender === 'F') {
              this.state = 'gestating';
              this.gestatingDays = 1;
              this._mateRef = mate;
            } else {
              this.state = 'idle';
            }
            mate.state = 'idle';
          }
        } else if (!mate) { this.state = 'idle'; }
        break;
      }
      case 'gestating': {
        physics.wander(this.id, this.genes.speed * 0.6);
        break;
      }
    }
    return null;
  }

  _birth(world) {
    const father = world.agents.find(a => a.id === (this._mateRef?.id));
    const child = new Agent(
      this.x + (Math.random()-0.5)*4, this.y + (Math.random()-0.5)*4,
      Math.random() < 0.5 ? 'M' : 'F', null, this, father
    );
    child.energy = 55; child.hunger = 30; child.age = 0; child.tribe = this.tribe;
    this.childrenIds.push(child.id);
    if (father) father.childrenIds.push(child.id);
    this._mateRef = null;
    return child;
  }

  _nearestFood(world)  {
    let best = null, bd = Infinity;
    for (const f of world.foodNodes) {
      if (f.food < 5) continue;
      const d = this._distTo(f.x, f.y);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  _nearestWarmth(world) {
    const src = [...world.fireNodes, ...world.shelterNodes];
    let best = null, bd = Infinity;
    for (const s of src) {
      const d = this._distTo(s.x, s.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  _nearestOpposite(world) {
    const opp = this.gender === 'M' ? 'F' : 'M';
    let best = null, bd = 25;
    for (const a of world.agents) {
      if (a.id === this.id || a.gender !== opp || a.dead) continue;
      const d = this._distTo(a.x, a.y);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  _distTo(x, y) { return Math.sqrt((this.x-x)**2 + (this.y-y)**2); }

  serialize() {
    return {
      id: this.id, x: +this.x.toFixed(2), y: +this.y.toFixed(2),
      gender: this.gender, name: this.name, age: +this.age.toFixed(1),
      state: this.state,
      energy: +this.energy.toFixed(1), hunger: +this.hunger.toFixed(1),
      warmth: +this.warmth.toFixed(1), health: +this.health.toFixed(1),
      happiness: +this.happiness.toFixed(1), psychState: this.psychState,
      genes: this.genes, thought: this.thought,
      gestatingDays: +this.gestatingDays.toFixed(1),
      tribe: this.tribe, color: this.color,
      hairColor: this.hairColor, skinTone: this.skinTone,
      motherId: this.motherId, fatherId: this.fatherId,
      childrenIds: [...this.childrenIds],
      trail: this.trail.slice(-5), dead: this.dead,
      sprite: this.sprite || null
    };
  }

  genealogyEntry() {
    return { id: this.id, name: this.name, gender: this.gender,
      age: +this.age.toFixed(0), dead: this.dead,
      motherId: this.motherId, fatherId: this.fatherId,
      childrenIds: [...this.childrenIds], genes: { ...this.genes } };
  }
}

module.exports = { Agent };
