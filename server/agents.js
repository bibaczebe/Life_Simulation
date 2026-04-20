'use strict';

const MALE_NAMES   = ['Adam','Borys','Casimir','Dawid','Emil','Fabian','Grzegorz','Hugo','Igor','Jakub','Kamil','Leon','Marek','Norbert','Oskar','Piotr','Rafał','Stefan','Tomek','Ulryk','Viktor','Wojtek','Zygmunt','Henryk','Władek','Lech','Mieszko','Bolesław'];
const FEMALE_NAMES = ['Ewa','Basia','Celina','Diana','Anna','Fiona','Grażyna','Hanna','Irena','Julia','Kasia','Lidia','Maja','Nina','Olga','Paula','Roma','Sara','Teresa','Urszula','Wanda','Xenia','Zosia','Halina','Jadwiga','Krystyna','Wiesława'];

const THOUGHTS = {
  wandering: ['Gdzie dziś znajdę pożywienie?','Niebo wygląda pięknie...','Słyszę odgłosy w lesie.','Muszę odpocząć przy ognisku.','Co dziś przyniesie los?'],
  hungry:    ['Żołądek mnie boli...','Muszę znaleźć coś do jedzenia!','Ostatni raz jadłem dawno temu.','Zapach jedzenia...'],
  cold:      ['Zimno... muszę znaleźć ciepło!','Drżę z zimna...','Ogień... gdzie jest ogień?','Nie mogę dłużej wytrzymać tego mrozu.'],
  sleeping:  ['Spokojna noc...','Śni mi się ciepłe lato.','Zmęczony byłem...','Jutro ruszy się świat.'],
  social:    ['Ta osoba wydaje mi się bliska.','Chciałbym porozmawiać.','Razem radzimy sobie lepiej.'],
  mating:    ['Czuję silne przyciąganie...','To jest właściwa osoba.'],
  pregnant:  ['Czuję jak rośnie nowe życie...','Muszę być ostrożna.','Wkrótce będę matką.','Chronię nas oboje.'],
  building:  ['Buduję dom dla nas wszystkich.','Ta ściana musi być solidna.','Wbijam kamień za kamieniem.'],
  gathering: ['Zbieram drewno na schronienie.','Te gałęzie się przydadzą.'],
  dying:     ['Czuję jak siły mnie opuszczają...','Zimny oddech śmierci...','Żyłem tak, jak umiałem.']
};

const PSYCH_STATES = ['spokojny','radosny','niespokojny','przygnębiony','euforyczny','zestresowany','samotny','zakochany','wojowniczy','refleksyjny'];

let agentIdCounter = 0;
const WORLD_W = 100, WORLD_H = 60;

class Agent {
  constructor(x, y, gender, name, parentA, parentB) {
    this.id = ++agentIdCounter;
    this.x  = x ?? (15 + Math.random() * 70);
    this.y  = y ?? (10 + Math.random() * 40);
    this.vx = (Math.random() - 0.5) * 4;
    this.vy = (Math.random() - 0.5) * 4;
    this.gender = gender ?? (Math.random() < 0.5 ? 'M' : 'F');
    this.name   = name ?? (this.gender === 'M'
      ? MALE_NAMES[Math.floor(Math.random() * MALE_NAMES.length)]
      : FEMALE_NAMES[Math.floor(Math.random() * FEMALE_NAMES.length)]);

    // Vital stats
    this.age    = 0;        // simulation days
    this.energy = 80 + Math.random() * 20;
    this.hunger = 10 + Math.random() * 20;
    this.warmth = 85 + Math.random() * 15;
    this.health = 90 + Math.random() * 10;

    // Genetics — inherited from parents + mutation
    this.genes = this._inheritGenes(parentA?.genes, parentB?.genes);

    // Psychology
    this.psychState   = PSYCH_STATES[Math.floor(Math.random() * 5)];
    this.happiness    = 60 + Math.random() * 30;
    this.socialBonds  = 0;     // number of known allies
    this.thought      = '';
    this.thoughtTimer = 0;

    // Genealogy
    this.motherId  = parentA?.id ?? null;
    this.fatherId  = parentB?.id ?? null;
    this.childrenIds = [];

    // State machine
    this.state         = 'wandering';
    this.tribe         = null;
    this.mateCooldown  = 0;
    this.pregnantDays  = 0;   // days pregnant (0 = not pregnant)
    this.woodCarried   = 0;
    this.stoneCarried  = 0;
    this.targetX       = null;
    this.targetY       = null;
    this.dead          = false;
    this.dyingTicks    = 0;

    this.color = this.gender === 'M' ? '#5599ff' : '#ff55bb';
    this.hairColor = `hsl(${25 + Math.floor(Math.random() * 20)}, ${40+Math.random()*30}%, ${20+Math.random()*20}%)`;
    this.skinTone  = `hsl(${28 + Math.floor(Math.random() * 12)}, ${40+Math.random()*20}%, ${55+Math.random()*15}%)`;

    this.trail = [];
  }

  _inheritGenes(genesA, genesB) {
    const base = { strength: 50, intelligence: 50, fertility: 50, endurance: 50, resistance: 50, aggression: 30 };
    if (!genesA || !genesB) {
      return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v + (Math.random() - 0.5) * 20]));
    }
    return Object.fromEntries(Object.entries(base).map(([k]) => {
      const avg  = (genesA[k] + genesB[k]) / 2;
      const mut  = (Math.random() - 0.5) * 10;
      return [k, Math.max(1, Math.min(100, avg + mut))];
    }));
  }

  update(world) {
    if (this.dead) return null;

    this.age += world.dayDelta ?? 0;
    this.mateCooldown = Math.max(0, this.mateCooldown - (world.dayDelta ?? 0));

    this._updateVitals(world);
    this._updatePsychology(world);
    this._updateThought();
    this._stateMachine(world);
    this._move(world);

    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 10) this.trail.shift();

    // Death check
    if (this.energy <= 0 || this.warmth <= 0 || this.health <= 0) {
      if (this.state !== 'dying') this.state = 'dying';
    }
    if (this.state === 'dying') {
      this.dyingTicks++;
      if (this.dyingTicks > 30) { this.dead = true; return null; }
    }

    // Max lifespan (scales with intelligence gene)
    const maxAge = 60 + this.genes.endurance * 0.4 + world.techLevel * 2;
    if (this.age >= maxAge) { this.state = 'dying'; }

    // Pregnancy: 270 simulation days = 9 months
    if (this.pregnantDays > 0) {
      this.pregnantDays += (world.dayDelta ?? 0);
      const gestationDays = 270 * (1 - (this.genes.fertility - 50) * 0.002);
      if (this.pregnantDays >= gestationDays) {
        this.pregnantDays = 0;
        this.state = 'wandering';
        return this._birthChild(world);
      }
    }

    return null;
  }

  _updateVitals(world) {
    const dd = world.dayDelta ?? 0;
    const endMod = this.genes.endurance / 100;
    const resMod = this.genes.resistance / 100;

    // Metabolism
    this.hunger = Math.min(100, this.hunger + dd * 1.2);
    this.energy -= dd * (0.4 - endMod * 0.15);
    if (this.hunger > 70) this.energy -= dd * 0.5;

    // Cold
    if (!world.isDay) {
      const cold = world.temperature < 0 ? 0.15 : world.temperature < 10 ? 0.06 : 0.02;
      const prot = world.resources.hasFire ? 0.4 * (1 + resMod) : 1.0 / (1 + resMod);
      this.warmth = Math.max(0, this.warmth - cold * dd * prot);
    } else {
      this.warmth = Math.min(100, this.warmth + dd * 0.08);
    }
    if (this.warmth < 20) this.health -= dd * 0.1;

    // Disease random
    if (world.season === 'Zima' && Math.random() < 0.00005) {
      this.health -= 5 * (1 - resMod * 0.8);
    }

    this.health = Math.max(0, Math.min(100, this.health));
    this.energy = Math.max(0, Math.min(100, this.energy));
  }

  _updatePsychology(world) {
    const dd = world.dayDelta ?? 0;
    const dH = this.hunger < 30 && this.warmth > 50 && this.energy > 50 ? 0.2 : -0.15;
    this.happiness = Math.max(0, Math.min(100, this.happiness + dH * dd));
    this.happiness += this.socialBonds * 0.005 * dd;

    if (this.happiness > 80) this.psychState = 'radosny';
    else if (this.happiness > 60) this.psychState = 'spokojny';
    else if (this.happiness < 20) this.psychState = 'przygnębiony';
    else if (this.hunger > 70) this.psychState = 'zestresowany';
    else if (this.warmth < 30) this.psychState = 'niespokojny';
    else if (this.pregnantDays > 0) this.psychState = 'euforyczny';
    else if (this.state === 'dying') this.psychState = 'niespokojny';
  }

  _updateThought() {
    this.thoughtTimer--;
    if (this.thoughtTimer <= 0) {
      const pool = THOUGHTS[this.state] || THOUGHTS.wandering;
      this.thought = pool[Math.floor(Math.random() * pool.length)];
      this.thoughtTimer = 80 + Math.floor(Math.random() * 120);
    }
  }

  _stateMachine(world) {
    if (this.state === 'dying') return;

    switch (this.state) {
      case 'wandering': {
        if (this.warmth < 25 && !world.isDay) { this.state = 'cold'; this.targetX = null; break; }
        if (this.hunger > 60) { this.state = 'hungry'; this.targetX = null; break; }
        if (!world.isDay && world.resources.shelterCount > 0 && this.energy < 55) { this.state = 'sleeping'; break; }
        if (world.resources.needsWood > 0 && this.woodCarried === 0 && Math.random() < 0.003) { this.state = 'gathering'; break; }
        if (Math.random() < 0.003) { this.state = 'social'; break; }
        break;
      }
      case 'hungry': {
        const food = this._nearestFood(world);
        if (food) {
          this.targetX = food.x; this.targetY = food.y;
          if (this._distTo(food.x, food.y) < 4 && food.food > 5) {
            const eat = Math.min(food.food, 10 + this.genes.strength * 0.05);
            food.food -= eat;
            this.hunger  = Math.max(0, this.hunger  - eat * 1.2);
            this.energy  = Math.min(100, this.energy + eat * 0.6);
            this.health  = Math.min(100, this.health + eat * 0.1);
            if (this.hunger < 20) { this.state = 'wandering'; this.targetX = null; }
          }
        } else if (this.hunger < 35) { this.state = 'wandering'; this.targetX = null; }
        break;
      }
      case 'cold': {
        const ws = this._nearestWarmth(world);
        if (ws) {
          this.targetX = ws.x; this.targetY = ws.y;
          if (this._distTo(ws.x, ws.y) < 6) {
            this.warmth = Math.min(100, this.warmth + 1.8);
            if (this.warmth > 75) { this.state = 'wandering'; this.targetX = null; }
          }
        } else { this.state = 'wandering'; }
        break;
      }
      case 'sleeping': {
        this.energy = Math.min(100, this.energy + 0.5);
        this.warmth = Math.min(100, this.warmth + 0.3);
        this.health = Math.min(100, this.health + 0.05);
        if (world.isDay) { this.state = 'wandering'; }
        break;
      }
      case 'social': {
        if (Math.random() < 0.008) { this.state = 'wandering'; break; }
        const mate = this._nearestOpposite(world);
        if (mate && this.mateCooldown <= 0 && mate.mateCooldown <= 0 &&
            this.energy > 65 && mate.energy > 65 &&
            this.age > 15 && this.age < 55 && mate.age > 15 && mate.age < 55 &&
            this.pregnantDays === 0 && mate.pregnantDays === 0 &&
            world.population < world.maxPopulation) {
          if (this._distTo(mate.x, mate.y) < 7) {
            this.state = 'mating'; mate.state = 'mating';
          } else {
            this.targetX = mate.x; this.targetY = mate.y;
          }
        }
        break;
      }
      case 'mating': {
        const fertMod = (this.genes.fertility / 100) * (this._nearestOpposite(world)?.genes?.fertility ?? 50) / 100;
        this.mateCooldown = 100 + (1 - fertMod) * 50;
        this.energy -= 8;
        if (this.gender === 'F') {
          this.state = 'pregnant';
          this.pregnantDays = 1;
        } else {
          this.state = 'wandering';
        }
        break;
      }
      case 'gathering': {
        const forestPos = { x: 10 + Math.random() * 5, y: 10 + Math.random() * 40 };
        this.targetX = forestPos.x; this.targetY = forestPos.y;
        if (this._distTo(forestPos.x, forestPos.y) < 8) {
          this.woodCarried = 5 + Math.floor(this.genes.strength / 20);
          world.resources.wood = (world.resources.wood || 0) + this.woodCarried;
          world.resources.needsWood = Math.max(0, (world.resources.needsWood || 0) - this.woodCarried);
          this.woodCarried = 0;
          this.state = 'wandering';
        }
        break;
      }
    }
  }

  _move(world) {
    if (['sleeping', 'dead', 'dying'].includes(this.state)) return;

    const strMod  = 0.8 + this.genes.strength * 0.004;
    const baseSpd = this.state === 'hungry' || this.state === 'cold' ? 18 : 10;
    const speed   = baseSpd * strMod;

    if (this.targetX !== null) {
      const dx = this.targetX - this.x, dy = this.targetY - this.y;
      const d  = Math.sqrt(dx*dx + dy*dy);
      if (d > 0.5) { this.vx = (dx/d)*speed; this.vy = (dy/d)*speed; }
    } else {
      if (Math.random() < 0.04) {
        this.vx += (Math.random() - 0.5) * 5;
        this.vy += (Math.random() - 0.5) * 5;
      }
      const mx = speed * 0.7;
      this.vx = Math.max(-mx, Math.min(mx, this.vx));
      this.vy = Math.max(-mx, Math.min(mx, this.vy));
    }

    const dt = 0.006;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.x  = Math.max(3, Math.min(WORLD_W - 3, this.x));
    this.y  = Math.max(3, Math.min(WORLD_H - 3, this.y));
    if (this.x <= 3 || this.x >= WORLD_W-3) this.vx *= -1;
    if (this.y <= 3 || this.y >= WORLD_H-3) this.vy *= -1;
  }

  _birthChild(world) {
    const father = world.agents.find(a => a.id === this.fatherId) || null;
    const child  = new Agent(
      this.x + (Math.random()-0.5)*4,
      this.y + (Math.random()-0.5)*4,
      Math.random() < 0.5 ? 'M' : 'F',
      null,
      this,
      father
    );
    child.energy = 55;
    child.hunger = 25;
    child.age    = 0;
    child.tribe  = this.tribe;
    this.childrenIds.push(child.id);
    if (father) father.childrenIds.push(child.id);
    return child;
  }

  _nearestFood(world) {
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
    let best = null, bd = 22;
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
      id: this.id, x: this.x, y: this.y, vx: this.vx, vy: this.vy,
      gender: this.gender, name: this.name,
      age: +this.age.toFixed(2), state: this.state,
      energy: +this.energy.toFixed(1), hunger: +this.hunger.toFixed(1),
      warmth: +this.warmth.toFixed(1), health: +this.health.toFixed(1),
      happiness: +this.happiness.toFixed(1), psychState: this.psychState,
      genes: { ...this.genes },
      thought: this.thought,
      pregnantDays: +this.pregnantDays.toFixed(1),
      tribe: this.tribe, color: this.color,
      hairColor: this.hairColor, skinTone: this.skinTone,
      motherId: this.motherId, fatherId: this.fatherId,
      childrenIds: [...this.childrenIds],
      trail: this.trail.slice(-6), dead: this.dead
    };
  }

  genealogyEntry() {
    return {
      id: this.id, name: this.name, gender: this.gender,
      age: +this.age.toFixed(0), dead: this.dead,
      motherId: this.motherId, fatherId: this.fatherId,
      childrenIds: [...this.childrenIds],
      genes: { ...this.genes }
    };
  }
}

module.exports = { Agent };
