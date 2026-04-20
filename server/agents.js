'use strict';

const MALE_NAMES = ['Adam','Borys','Casimir','Dawid','Emil','Fabian','Grzegorz','Hugo','Igor','Jakub','Kamil','Leon','Marek','Norbert','Oskar','Piotr','Rafał','Stefan','Tomek','Ulryk','Viktor','Wojtek','Zygmunt'];
const FEMALE_NAMES = ['Ewa','Basia','Celina','Diana','Anna','Fiona','Grażyna','Hanna','Irena','Julia','Kasia','Lidia','Maja','Nina','Olga','Paula','Roma','Sara','Teresa','Urszula','Wanda','Xenia','Zosia'];

let agentIdCounter = 0;

const STATE = { WANDERING: 'wandering', HUNGRY: 'hungry', EATING: 'eating', COLD: 'cold', WARMING: 'warming', SLEEPING: 'sleeping', SOCIAL: 'social', MATING: 'mating', PREGNANT: 'pregnant', DYING: 'dying', DEAD: 'dead' };
const WORLD_W = 100, WORLD_H = 60;

class Agent {
  constructor(x, y, gender, name) {
    this.id = ++agentIdCounter;
    this.x = x ?? (10 + Math.random() * 80);
    this.y = y ?? (10 + Math.random() * 40);
    this.vx = (Math.random() - 0.5) * 2;
    this.vy = (Math.random() - 0.5) * 2;
    this.gender = gender ?? (Math.random() < 0.5 ? 'M' : 'F');
    this.name = name ?? (this.gender === 'M' ? MALE_NAMES[Math.floor(Math.random() * MALE_NAMES.length)] : FEMALE_NAMES[Math.floor(Math.random() * FEMALE_NAMES.length)]);
    this.age = 0;
    this.energy = 85 + Math.random() * 15;
    this.hunger = 10 + Math.random() * 20;
    this.warmth = 90 + Math.random() * 10;
    this.state = STATE.WANDERING;
    this.tribe = null;
    this.mateCooldown = 0;
    this.pregnantTicks = 0;
    this.dyingTicks = 0;
    this.dead = false;
    this.targetX = null;
    this.targetY = null;
    this.color = this.gender === 'M' ? '#4488ff' : '#ff44aa';
    this.trail = [];
  }

  update(world, dt) {
    if (this.dead) return null;

    this.age += dt;
    this.mateCooldown = Math.max(0, this.mateCooldown - dt);

    this._updateStats(world, dt);
    this._stateMachine(world);
    this._move(world, dt);

    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 8) this.trail.shift();

    if (this.state === STATE.DYING) {
      this.dyingTicks++;
      if (this.dyingTicks > 20) { this.dead = true; return null; }
    }

    if (this.state === STATE.PREGNANT) {
      this.pregnantTicks++;
      if (this.pregnantTicks >= 60) {
        this.pregnantTicks = 0;
        this.state = STATE.WANDERING;
        return this._birthChild(world);
      }
    }

    return null;
  }

  _updateStats(world, dt) {
    const metab = 0.015 * dt;
    this.hunger = Math.min(100, this.hunger + metab * 1.5);

    if (this.hunger > 60) this.energy -= metab * 0.8;
    this.energy = Math.max(0, this.energy - metab * 0.3);

    if (!world.isDay) {
      const coldPenalty = world.temperature < 5 ? 0.08 : world.temperature < 15 ? 0.03 : 0.01;
      const protection = world.resources.hasFire ? 0.5 : 1.0;
      this.warmth = Math.max(0, this.warmth - coldPenalty * dt * protection);
    } else {
      this.warmth = Math.min(100, this.warmth + 0.05 * dt);
    }

    if (this.warmth < 30) this.energy -= 0.02 * dt;
    if (this.age > 200) this.energy -= 0.01 * dt;
  }

  _stateMachine(world) {
    if (this.energy < 8 || this.warmth < 5) { this.state = STATE.DYING; return; }

    switch (this.state) {
      case STATE.WANDERING:
        if (this.warmth < 30 && !world.isDay) { this.state = STATE.COLD; this.targetX = null; break; }
        if (this.hunger > 55) { this.state = STATE.HUNGRY; this.targetX = null; break; }
        if (!world.isDay && world.resources.shelterCount > 0 && this.energy < 60) { this.state = STATE.SLEEPING; this.targetX = null; break; }
        if (Math.random() < 0.002) { this.state = STATE.SOCIAL; }
        break;

      case STATE.HUNGRY:
        const food = this._nearestFood(world);
        if (food) {
          this.targetX = food.x; this.targetY = food.y;
          if (this._distTo(food.x, food.y) < 3 && food.food > 0) {
            food.food = Math.max(0, food.food - 8);
            this.hunger = Math.max(0, this.hunger - 12);
            this.energy = Math.min(100, this.energy + 6);
            if (this.hunger < 20) { this.state = STATE.WANDERING; this.targetX = null; }
          }
        } else if (this.hunger < 40) {
          this.state = STATE.WANDERING; this.targetX = null;
        }
        break;

      case STATE.COLD:
        const warmSource = this._nearestWarmth(world);
        if (warmSource) {
          this.targetX = warmSource.x; this.targetY = warmSource.y;
          if (this._distTo(warmSource.x, warmSource.y) < 5) {
            this.warmth = Math.min(100, this.warmth + 1.5);
            if (this.warmth > 70) { this.state = STATE.WANDERING; this.targetX = null; }
          }
        } else { this.state = STATE.WANDERING; }
        break;

      case STATE.SLEEPING:
        this.energy = Math.min(100, this.energy + 0.3);
        this.warmth = Math.min(100, this.warmth + 0.2);
        if (world.isDay) { this.state = STATE.WANDERING; }
        break;

      case STATE.SOCIAL:
        if (Math.random() < 0.01) { this.state = STATE.WANDERING; break; }
        const partner = this._nearestOpposite(world);
        if (partner && this.mateCooldown <= 0 && partner.mateCooldown <= 0 &&
            this.energy > 70 && partner.energy > 70 && this.age > 15 && partner.age > 15 &&
            this.state !== STATE.PREGNANT && partner.state !== STATE.PREGNANT) {
          if (this._distTo(partner.x, partner.y) < 6) {
            this.state = STATE.MATING; partner.state = STATE.MATING;
          } else {
            this.targetX = partner.x; this.targetY = partner.y;
          }
        }
        break;

      case STATE.MATING:
        this.mateCooldown = 150;
        this.energy -= 5;
        if (this.gender === 'F') {
          this.state = STATE.PREGNANT;
          this.pregnantTicks = 0;
        } else {
          this.state = STATE.WANDERING;
        }
        break;
    }
  }

  _move(world, dt) {
    if (this.state === STATE.SLEEPING || this.state === STATE.DEAD || this.state === STATE.DYING) return;

    const speed = this.state === STATE.HUNGRY || this.state === STATE.COLD ? 20 : 10;

    if (this.targetX !== null) {
      const dx = this.targetX - this.x, dy = this.targetY - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 1) {
        this.vx = (dx / dist) * speed;
        this.vy = (dy / dist) * speed;
      }
    } else {
      if (Math.random() < 0.05) {
        this.vx += (Math.random() - 0.5) * 4;
        this.vy += (Math.random() - 0.5) * 4;
      }
      const maxV = speed;
      this.vx = Math.max(-maxV, Math.min(maxV, this.vx));
      this.vy = Math.max(-maxV, Math.min(maxV, this.vy));
    }

    const dtSec = dt * 0.005;
    this.x += this.vx * dtSec;
    this.y += this.vy * dtSec;
    this.x = Math.max(2, Math.min(WORLD_W - 2, this.x));
    this.y = Math.max(2, Math.min(WORLD_H - 2, this.y));

    if (this.x <= 2 || this.x >= WORLD_W - 2) this.vx *= -1;
    if (this.y <= 2 || this.y >= WORLD_H - 2) this.vy *= -1;
  }

  _birthChild(world) {
    const nearX = this.x + (Math.random() - 0.5) * 4;
    const nearY = this.y + (Math.random() - 0.5) * 4;
    const gender = Math.random() < 0.5 ? 'M' : 'F';
    const child = new Agent(nearX, nearY, gender);
    child.energy = 60;
    child.hunger = 30;
    child.tribe = this.tribe;
    return child;
  }

  _nearestFood(world) {
    let best = null, bestDist = Infinity;
    for (const f of world.foodNodes) {
      if (f.food < 5) continue;
      const d = this._distTo(f.x, f.y);
      if (d < bestDist) { bestDist = d; best = f; }
    }
    return best;
  }

  _nearestWarmth(world) {
    const sources = [...world.fireNodes, ...world.shelterNodes];
    let best = null, bestDist = Infinity;
    for (const s of sources) {
      const d = this._distTo(s.x, s.y);
      if (d < bestDist) { bestDist = d; best = s; }
    }
    return best;
  }

  _nearestOpposite(world) {
    const opposite = this.gender === 'M' ? 'F' : 'M';
    let best = null, bestDist = 20;
    for (const a of world.agents) {
      if (a.id === this.id || a.gender !== opposite || a.dead) continue;
      const d = this._distTo(a.x, a.y);
      if (d < bestDist) { bestDist = d; best = a; }
    }
    return best;
  }

  _distTo(x, y) {
    return Math.sqrt((this.x - x) ** 2 + (this.y - y) ** 2);
  }

  serialize() {
    return {
      id: this.id, x: this.x, y: this.y, gender: this.gender,
      name: this.name, age: Math.round(this.age), state: this.state,
      energy: Math.round(this.energy), hunger: Math.round(this.hunger),
      warmth: Math.round(this.warmth), color: this.color, tribe: this.tribe,
      trail: this.trail.slice(-5), dead: this.dead
    };
  }
}

module.exports = { Agent };
