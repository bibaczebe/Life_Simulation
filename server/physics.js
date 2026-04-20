'use strict';
const Matter = require('matter-js');
const { Engine, World, Bodies, Body, Events } = Matter;

const PW = 1000, PH = 600;        // physics world pixels
const SCALE_X = PW / 100;         // world-units → pixels
const SCALE_Y = PH / 60;

class PhysicsWorld {
  constructor() {
    this.engine = Engine.create({ gravity: { x: 0, y: 0 } });
    this.bodyMap = new Map();   // agentId -> Matter body
    this.collisionCallbacks = [];
    this._initWalls();
    this._initCollisions();
  }

  _initWalls() {
    World.add(this.engine.world, [
      Bodies.rectangle(PW/2, -10,    PW+40, 20,    { isStatic:true, label:'wall' }),
      Bodies.rectangle(PW/2, PH+10,  PW+40, 20,    { isStatic:true, label:'wall' }),
      Bodies.rectangle(-10,  PH/2,   20, PH+40,    { isStatic:true, label:'wall' }),
      Bodies.rectangle(PW+10, PH/2,  20, PH+40,    { isStatic:true, label:'wall' }),
    ]);
  }

  _initCollisions() {
    Events.on(this.engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const aId = pair.bodyA.agentId;
        const bId = pair.bodyB.agentId;
        if (aId && bId) {
          for (const cb of this.collisionCallbacks) cb(aId, bId);
        }
      }
    });
  }

  onCollision(fn) { this.collisionCallbacks.push(fn); }

  addAgent(id, x, y, genes) {
    const r = 7 + (genes.strength / 100) * 3;
    const body = Bodies.circle(
      x * SCALE_X, y * SCALE_Y, r,
      {
        friction: 0.01,
        frictionAir: 0.14 - (genes.speed / 100) * 0.06,
        restitution: 0.25,
        density: 0.001 * (0.8 + genes.strength / 250),
        label: 'agent',
        agentId: id
      }
    );
    World.add(this.engine.world, body);
    this.bodyMap.set(id, body);
    return body;
  }

  removeAgent(id) {
    const body = this.bodyMap.get(id);
    if (body) { World.remove(this.engine.world, body); this.bodyMap.delete(id); }
  }

  seekTarget(id, tx, ty, speedGene, weatherMod = 1) {
    const body = this.bodyMap.get(id);
    if (!body) return;
    const px = tx * SCALE_X, py = ty * SCALE_Y;
    const dx = px - body.position.x, dy = py - body.position.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 8) return;
    const f = 0.00006 * (0.5 + speedGene / 100) * weatherMod;
    Body.applyForce(body, body.position, { x: (dx/dist)*f, y: (dy/dist)*f });
  }

  wander(id, speedGene, weatherMod = 1) {
    const body = this.bodyMap.get(id);
    if (!body || Math.random() > 0.25) return;
    const f = 0.000025 * (0.4 + speedGene / 100) * weatherMod;
    Body.applyForce(body, body.position, {
      x: (Math.random()-0.5)*f, y: (Math.random()-0.5)*f
    });
  }

  stop(id) {
    const body = this.bodyMap.get(id);
    if (body) Body.setVelocity(body, { x: 0, y: 0 });
  }

  getPos(id) {
    const b = this.bodyMap.get(id);
    if (!b) return null;
    return { x: b.position.x / SCALE_X, y: b.position.y / SCALE_Y };
  }

  getVel(id) {
    const b = this.bodyMap.get(id);
    if (!b) return { x: 0, y: 0 };
    return { x: b.velocity.x, y: b.velocity.y };
  }

  step(deltaMs) {
    Engine.update(this.engine, deltaMs);
  }
}

module.exports = { PhysicsWorld, PW, PH };
