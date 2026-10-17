// Husks: models and AI.

import * as THREE from 'three';
import { ENEMIES } from './config.js';
import * as Audio from './audio.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

const shell = new THREE.MeshStandardMaterial({ color: 0xc9cbc6, roughness: 0.45, metalness: 0.7 });
const plate = new THREE.MeshStandardMaterial({ color: 0x55595d, roughness: 0.5, metalness: 0.8 });
const dark = new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.6, metalness: 0.6 });
const hazard = new THREE.MeshStandardMaterial({ color: 0xd8902a, roughness: 0.6, metalness: 0.4 });

function eyeMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x331008, emissive: 0xff5020, emissiveIntensity: 1.2 });
}

function add(parent, geo, material, x, y, z) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

// Each builder returns { root, eye, parts, hitboxes:[{node, r, mult}] }
const BUILDERS = {
  skitter() {
    const root = new THREE.Group();
    const body = add(root, new THREE.SphereGeometry(0.42, 10, 6), shell, 0, 0.45, 0);
    body.scale.set(1, 0.55, 1.2);
    add(root, new THREE.BoxGeometry(0.5, 0.12, 0.6), plate, 0, 0.62, -0.05);
    const eye = add(root, new THREE.SphereGeometry(0.11, 8, 6), eyeMaterial(), 0, 0.5, 0.45);
    const legs = [];
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const k = (i % 3) - 1;
      const leg = new THREE.Group();
      leg.position.set(side * 0.3, 0.45, k * 0.3);
      const g = new THREE.BoxGeometry(0.6, 0.06, 0.06);
      g.translate(side * 0.3, 0, 0);
      const m = new THREE.Mesh(g, dark);
      m.rotation.z = side * -0.6;
      m.castShadow = true;
      leg.add(m);
      root.add(leg);
      legs.push(leg);
    }
    return { root, eye, legs, hitboxes: [{ node: body, r: 0.55, mult: 1 }] };
  },
  buzzer() {
    const root = new THREE.Group();
    const body = add(root, new THREE.BoxGeometry(0.6, 0.35, 0.9), shell, 0, 0, 0);
    add(root, new THREE.BoxGeometry(0.4, 0.15, 0.5), plate, 0, 0.24, -0.05);
    const eye = add(root, new THREE.SphereGeometry(0.12, 8, 6), eyeMaterial(), 0, -0.02, 0.47);
    add(root, new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), dark, 0, -0.25, 0.25).rotation.x = Math.PI / 2;
    const rotors = [];
    for (const [x, z] of [[-0.65, 0.45], [0.65, 0.45], [-0.65, -0.45], [0.65, -0.45]]) {
      add(root, new THREE.BoxGeometry(0.6, 0.06, 0.08), dark, x / 2, 0.08, z / 2).rotation.y = Math.atan2(z, x);
      const rotor = add(root, new THREE.BoxGeometry(0.7, 0.02, 0.08), plate, x, 0.14, z);
      rotors.push(rotor);
      add(root, new THREE.CylinderGeometry(0.1, 0.12, 0.12, 8), dark, x, 0.08, z);
    }
    return { root, eye, rotors, hitboxes: [{ node: body, r: 0.6, mult: 1 }, { node: eye, r: 0.2, mult: 2 }] };
  },
  watcher() {
    const root = new THREE.Group();
    const body = add(root, new THREE.CylinderGeometry(0.25, 0.4, 0.7, 8), shell, 0, 0, 0);
    const ring = add(root, new THREE.TorusGeometry(0.8, 0.05, 6, 24), hazard, 0, 0.15, 0);
    ring.rotation.x = Math.PI / 2;
    const eyeMat = eyeMaterial();
    eyeMat.emissive.setHex(0xffcc20);
    const eye = add(root, new THREE.SphereGeometry(0.18, 10, 8), eyeMat, 0, -0.35, 0.15);
    add(root, new THREE.CylinderGeometry(0.02, 0.02, 0.9, 4), dark, 0, 0.75, 0);
    return { root, eye, ring, hitboxes: [{ node: body, r: 0.55, mult: 1 }, { node: eye, r: 0.22, mult: 2 }] };
  },
  pouncer() {
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.position.y = 2.4;
    root.add(body);
    add(body, new THREE.BoxGeometry(2.2, 1.0, 3.0), shell, 0, 0, 0);
    add(body, new THREE.BoxGeometry(1.8, 0.4, 2.4), plate, 0, 0.6, 0);
    const core = add(body, new THREE.SphereGeometry(0.4, 10, 8), eyeMaterial(), 0, 0.9, -0.6);
    const eye = add(body, new THREE.BoxGeometry(1.0, 0.25, 0.1), eyeMaterial(), 0, 0.1, 1.52);
    const legs = [];
    for (const [x, z] of [[-1.1, 1.2], [1.1, 1.2], [-1.1, -1.2], [1.1, -1.2]]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0, z);
      body.add(leg);
      const upper = new THREE.BoxGeometry(0.3, 0.3, 2.0);
      upper.translate(0, 0, 1);
      const m = new THREE.Mesh(upper, dark);
      m.rotation.set(-0.7, Math.atan2(x, z), 0);
      m.castShadow = true;
      leg.add(m);
      const foot = add(leg, new THREE.BoxGeometry(0.25, 2.6, 0.25), plate, x * 0.9, -1.1, z * 0.9);
      legs.push(foot);
    }
    return { root, eye, core, body, legs, hitboxes: [{ node: body, r: 1.7, mult: 1 }, { node: core, r: 0.45, mult: 2.5, weak: true }] };
  },
  warden() {
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.position.y = 4.2;
    root.add(body);
    add(body, new THREE.BoxGeometry(3.6, 2.6, 3.0), shell, 0, 0, 0);
    add(body, new THREE.BoxGeometry(3.8, 0.5, 3.2), plate, 0, 1.4, 0);
    add(body, new THREE.BoxGeometry(2.6, 1.2, 0.3), hazard, 0, -0.4, 1.55);
    const eye = add(body, new THREE.BoxGeometry(1.8, 0.35, 0.12), eyeMaterial(), 0, 0.7, 1.56);
    const core = add(body, new THREE.SphereGeometry(0.55, 12, 10), eyeMaterial(), 0, 0.2, -1.6);
    const guns = [];
    for (const side of [-1, 1]) {
      const arm = add(body, new THREE.BoxGeometry(0.8, 0.8, 2.6), plate, side * 2.3, -0.2, 0.6);
      const barrel = add(arm, new THREE.CylinderGeometry(0.2, 0.2, 1.4, 8), dark, 0, 0, 1.6);
      barrel.rotation.x = Math.PI / 2;
      guns.push(barrel);
    }
    const legs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 1.3, 3.0, 0);
      root.add(leg);
      add(leg, new THREE.BoxGeometry(0.9, 3.0, 1.2), dark, 0, -1.5, 0);
      add(leg, new THREE.BoxGeometry(1.3, 0.4, 2.0), plate, 0, -2.9, 0.2);
      legs.push(leg);
    }
    return { root, eye, core, body, guns, legs, hitboxes: [{ node: body, r: 2.3, mult: 1 }, { node: core, r: 0.65, mult: 3, weak: true }, { node: legs[0], r: 1.0, mult: 0.7 }, { node: legs[1], r: 1.0, mult: 0.7 }] };
  },
};

let nextId = 1;

export class Husk {
  constructor(type, x, y, z, home, scene) {
    this.id = nextId++;
    this.type = type;
    this.def = ENEMIES[type];
    this.hp = this.def.hp;
    this.maxHp = this.def.hp;
    this.scene = scene;
    const built = BUILDERS[type]();
    this.parts = built;
    this.model = built.root;
    scene.add(this.model);
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.home = home || { x, z, radius: 15 };
    this.state = 'idle';
    this.alertTimer = 0;
    this.lastSeen = new THREE.Vector3();
    this.seeTimer = Math.random() * 0.3;
    this.canSee = false;
    this.patrol = null;
    this.cooldown = 1 + Math.random();
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.fuse = -1;
    this.leap = null;
    this.called = false;
    this.callTimer = 0;
    this.dead = false;
    this.anim = Math.random() * 10;
    this.stuck = 0;
    this.sidestep = 0;
    this.sideDir = 1;
    this.chirpTimer = 2 + Math.random() * 4;
    this.hitFlash = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    if (this.def.flying) this.pos.y = y + this.def.hover;
    // only the big pieces cast shadows; legs, rotors and eyes aren't worth a shadow pass each
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingSphere();
      o.castShadow = o.geometry.boundingSphere.radius * Math.max(o.scale.x, o.scale.y, o.scale.z) > 0.4;
    });
    this.small = this.def.radius < 1;
    this.syncModel();
  }

  get center() {
    if (this.def.flying) return this.pos;
    const h = { skitter: 0.45, pouncer: 2.4, warden: 4.2 }[this.type] || 1;
    return _w.set(this.pos.x, this.pos.y + h, this.pos.z);
  }

  hitboxes() {
    this.model.updateMatrixWorld(true);
    return this.parts.hitboxes.map((h) => ({ center: h.node.getWorldPosition(new THREE.Vector3()), r: h.r, mult: h.mult, weak: h.weak }));
  }

  alert(pos, strong = true) {
    if (this.dead) return;
    if (this.state === 'idle' && strong) Audio.playHuskChirp(this.distTo);
    this.state = 'alert';
    this.alertTimer = strong ? 12 : 6;
    this.lastSeen.copy(pos);
  }

  damage(amount, ap, mult, weak) {
    const armor = weak ? 0 : this.def.armor * (1 - (ap || 0));
    const dealt = amount * (1 - armor) * mult;
    this.hp -= dealt;
    this.hitFlash = 0.08;
    return dealt;
  }

  syncModel() {
    this.model.position.copy(this.pos);
    if (this.def.flying) this.model.position.y = this.pos.y;
    this.model.rotation.y = this.yaw;
  }

  // ctx: { player, col, effects, time, damagePlayer, spawnEnemy, explode, enemies }
  update(dt, ctx) {
    if (this.dead) return;
    const p = ctx.player;
    const playerPos = p.chest();
    const toPlayer = _v.subVectors(playerPos, this.center);
    const dist = toPlayer.length();
    this.distTo = dist;
    this.anim += dt;

    // perception, a few times a second
    this.seeTimer -= dt;
    if (this.seeTimer <= 0) {
      this.seeTimer = 0.25;
      this.canSee = false;
      if (p.alive && dist < this.def.sight * (p.crouch ? 0.6 : 1)) {
        const eye = this.center.clone();
        if (ctx.col.lineOfSight(eye, playerPos)) {
          this.canSee = true;
          if (this.state === 'idle') Audio.playHuskChirp(dist);
          this.state = 'alert';
          this.alertTimer = 10;
          this.lastSeen.copy(playerPos);
        }
      }
    }
    if (this.canSee) this.lastSeen.copy(playerPos);
    if (this.state === 'alert') {
      this.alertTimer -= dt;
      if (this.alertTimer <= 0 && !this.canSee) this.state = 'idle';
    }
    if (!p.alive) this.state = 'idle';

    this.chirpTimer -= dt;
    if (this.chirpTimer <= 0) {
      this.chirpTimer = 4 + Math.random() * 6;
      if (dist < 40) Audio.playHuskChirp(dist);
    }

    const handler = this[`think_${this.def.attack.kind}`];
    if (handler) handler.call(this, dt, ctx, dist);

    // eye glows hotter while alert, flashes white when hit
    const eye = this.parts.eye.material;
    const target = this.state === 'alert' ? 3 : 1.1;
    eye.emissiveIntensity += (target - eye.emissiveIntensity) * Math.min(1, dt * 5);
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      eye.emissiveIntensity = 6;
    }
    if (this.parts.core) this.parts.core.material.emissiveIntensity = 1.6 + Math.sin(this.anim * 6) * 0.8;
    this.syncModel();
  }

  // ---- movement helpers ----
  faceTowards(x, z, dt, rate = 6) {
    const want = Math.atan2(x - this.pos.x, z - this.pos.z);
    let diff = want - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * Math.min(1, rate * dt);
    return Math.abs(diff);
  }

  groundMove(dt, ctx, tx, tz, speed) {
    const dx = tx - this.pos.x;
    const dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) return d;
    // don't walk into the player
    const pp = ctx.player.pos;
    if (ctx.player.alive && Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z) < this.def.radius + 0.7) {
      this.faceTowards(pp.x, pp.z, dt, 8);
      return d;
    }
    let mx = dx / d;
    let mz = dz / d;
    if (this.sidestep > 0) {
      this.sidestep -= dt;
      const sx = -mz * this.sideDir;
      const sz = mx * this.sideDir;
      mx = mx * 0.3 + sx;
      mz = mz * 0.3 + sz;
      const l = Math.hypot(mx, mz);
      mx /= l;
      mz /= l;
    }
    const before = { x: this.pos.x, z: this.pos.z };
    this.pos.x += mx * speed * dt;
    this.pos.z += mz * speed * dt;
    ctx.col.resolveCylinder(this.pos, this.def.radius, this.type === 'warden' ? 6 : 1.5, this.type === 'warden' || this.type === 'pouncer' ? 1.2 : 0.55);
    const ground = ctx.col.groundHeight(this.pos.x, this.pos.z, this.pos.y, this.def.radius, this.type === 'warden' || this.type === 'pouncer' ? 1.2 : 0.6);
    this.pos.y += (ground - this.pos.y) * Math.min(1, dt * 12);
    const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    if (moved < speed * dt * 0.3) {
      this.stuck += dt;
      if (this.stuck > 0.4) {
        this.stuck = 0;
        this.sidestep = 0.8 + Math.random() * 0.8;
        this.sideDir = Math.random() < 0.5 ? -1 : 1;
      }
    } else {
      this.stuck = Math.max(0, this.stuck - dt);
    }
    this.faceTowards(this.pos.x + mx, this.pos.z + mz, dt, 8);
    return d;
  }

  airMove(dt, ctx, tx, ty, tz, speed) {
    const d = Math.hypot(tx - this.pos.x, ty - this.pos.y, tz - this.pos.z);
    if (d > 0.2) {
      const want = new THREE.Vector3(tx - this.pos.x, ty - this.pos.y, tz - this.pos.z).normalize().multiplyScalar(Math.min(speed, d * 2));
      this.vel.lerp(want, Math.min(1, dt * 2));
    } else {
      this.vel.multiplyScalar(1 - Math.min(1, dt * 3));
    }
    this.pos.addScaledVector(this.vel, dt);
    const feet = { x: this.pos.x, y: this.pos.y - 0.4, z: this.pos.z };
    ctx.col.resolveCylinder(feet, this.def.radius, 0.8, 0);
    this.pos.x = feet.x;
    this.pos.z = feet.z;
    const ground = ctx.col.groundHeight(this.pos.x, this.pos.z, this.pos.y, this.def.radius, 0);
    if (this.pos.y < ground + 1.5) this.pos.y = ground + 1.5;
  }

  patrolTarget() {
    if (!this.patrol || Math.random() < 0.003) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * this.home.radius;
      this.patrol = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r };
    }
    return this.patrol;
  }

  // ---- behaviours ----
  think_leap(dt, ctx, dist) {
    const a = this.def.attack;
    const p = ctx.player;
    this.cooldown -= dt;
    if (this.leap) {
      this.leap.t += dt;
      const t = this.leap.t / this.leap.dur;
      this.pos.lerpVectors(this.leap.from, this.leap.to, Math.min(1, t));
      this.pos.y += Math.sin(Math.min(1, t) * Math.PI) * 1.6;
      if (!this.leap.hit && p.alive && this.pos.distanceTo(p.chest()) < 1.3) {
        this.leap.hit = true;
        ctx.damagePlayer(a.damage, this.pos, this);
      }
      if (t >= 1) {
        this.leap = null;
        this.pos.y = ctx.col.groundHeight(this.pos.x, this.pos.z, this.pos.y + 1, this.def.radius);
      }
      return;
    }
    this.animateLegs(dt);
    if (this.state === 'alert') {
      const target = this.lastSeen;
      if (this.canSee && dist < a.range && this.cooldown <= 0) {
        this.cooldown = a.cooldown;
        // land just short of the player
        const to = p.pos.clone();
        const away = new THREE.Vector3(this.pos.x - to.x, 0, this.pos.z - to.z);
        if (away.lengthSq() > 0.01) to.addScaledVector(away.normalize(), 0.9);
        to.y = ctx.col.groundHeight(to.x, to.z, to.y + 0.5, 0.3);
        this.leap = { from: this.pos.clone(), to, t: 0, dur: 0.45, hit: false };
        Audio.playHuskChirp(dist);
        return;
      }
      this.groundMove(dt, ctx, target.x, target.z, this.def.speed);
    } else {
      const pt = this.patrolTarget();
      if (this.groundMove(dt, ctx, pt.x, pt.z, this.def.speed * 0.25) < 1) this.patrol = null;
    }
  }

  think_gun(dt, ctx, dist) {
    const a = this.def.attack;
    const p = ctx.player;
    this.cooldown -= dt;
    if (this.def.flying) {
      for (const r of this.parts.rotors) r.rotation.y += dt * 40;
      let tx;
      let tz;
      let ty;
      if (this.state === 'alert') {
        // orbit the last seen position at mid range
        const ang = Math.atan2(this.pos.x - this.lastSeen.x, this.pos.z - this.lastSeen.z) + this.strafe * dt * 0.6 * 6;
        const r = 16;
        tx = this.lastSeen.x + Math.sin(ang) * r;
        tz = this.lastSeen.z + Math.cos(ang) * r;
        ty = ctx.col.groundHeight(tx, tz, 200, 0.5, 0) + this.def.hover;
        if (Math.random() < dt * 0.3) this.strafe *= -1;
      } else {
        const pt = this.patrolTarget();
        tx = pt.x;
        tz = pt.z;
        ty = ctx.col.groundHeight(tx, tz, 200, 0.5, 0) + this.def.hover + Math.sin(this.anim) * 0.5;
        if (Math.hypot(tx - this.pos.x, tz - this.pos.z) < 2) this.patrol = null;
      }
      this.airMove(dt, ctx, tx, ty, tz, this.def.speed);
      if (this.state === 'alert') this.faceTowards(this.lastSeen.x, this.lastSeen.z, dt, 5);
      else this.faceTowards(tx, tz, dt, 2);
      this.model.rotation.z = -this.vel.x * 0.03;
    } else {
      // Warden: stomp towards the player, stop at range
      const moving = this.state === 'alert' && dist > 25;
      if (this.state === 'alert') {
        if (moving) this.groundMove(dt, ctx, this.lastSeen.x, this.lastSeen.z, this.def.speed);
        this.faceTowards(this.lastSeen.x, this.lastSeen.z, dt, 1.2);
      } else {
        const pt = this.patrolTarget();
        if (this.groundMove(dt, ctx, pt.x, pt.z, this.def.speed * 0.5) < 2) this.patrol = null;
      }
      const stride = Math.sin(this.anim * 2.4);
      this.parts.legs[0].position.z = stride * 0.6;
      this.parts.legs[1].position.z = -stride * 0.6;
      this.parts.body.position.y = 4.2 + Math.abs(stride) * 0.15;
      if (Math.abs(stride) > 0.98 && this._stomp !== Math.sign(stride)) {
        this._stomp = Math.sign(stride);
        Audio.playStep(dist * 0.4);
      }
    }
    if (this.state !== 'alert' || !p.alive) return;
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.burstTimer = a.rate;
        this.burstLeft--;
        this.shoot(ctx, a);
      }
    } else if (this.cooldown <= 0 && this.canSee && dist < a.range) {
      this.burstLeft = a.burst;
      this.cooldown = a.cooldown + a.burst * a.rate;
    }
  }

  shoot(ctx, a) {
    const p = ctx.player;
    let from;
    if (this.parts.guns) {
      const gun = this.parts.guns[this.burstLeft % 2];
      from = gun.getWorldPosition(new THREE.Vector3());
    } else {
      from = this.center.clone();
      from.y -= 0.3;
    }
    const aim = p.chest();
    // lead a little and add spread that grows with distance and target speed
    const spread = (a.spread + Math.hypot(p.vel.x, p.vel.z) * 0.35) * (Math.PI / 180);
    const dir = aim.sub(from).normalize();
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    const range = a.range * 1.3;
    const hit = ctx.col.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, range);
    const maxD = hit ? hit.dist : range;
    // does the ray pass through the player's body?
    const playerHit = rayHitsPlayer(from, dir, p, maxD);
    const end = from.clone().addScaledVector(dir, playerHit !== null ? playerHit : maxD);
    ctx.effects.tracer(from, end, true);
    Audio.playGun('husk', this.distTo);
    if (playerHit !== null) ctx.damagePlayer(a.damage, from, this);
    else if (hit) ctx.effects.impact(end, hit.normal, hit.tag === 'metal' ? 'metal' : 'dust');
  }

  think_alarm(dt, ctx, dist) {
    const a = this.def.attack;
    this.parts.ring.rotation.z += dt * (this.state === 'alert' ? 6 : 1.5);
    let tx;
    let tz;
    if (this.state === 'alert') {
      // hang back and watch
      const away = Math.atan2(this.pos.x - this.lastSeen.x, this.pos.z - this.lastSeen.z) + dt * 0.3;
      tx = this.lastSeen.x + Math.sin(away) * 28;
      tz = this.lastSeen.z + Math.cos(away) * 28;
      if (this.canSee && !this.called) {
        this.callTimer += dt;
        if (Math.floor(this.callTimer * 4) !== Math.floor((this.callTimer - dt) * 4)) Audio.playBeep(dist, 0.8);
        if (this.callTimer >= a.callTime) {
          this.called = true;
          this.recall = 40;
          Audio.playAlarm(dist);
          ctx.notify('A Watcher called in reinforcements!');
          for (let i = 0; i < a.calls; i++) {
            const ang = Math.random() * Math.PI * 2;
            ctx.spawnEnemy('buzzer', this.pos.x + Math.cos(ang) * 25, this.pos.z + Math.sin(ang) * 25, this.lastSeen);
          }
        }
      }
    } else {
      const pt = this.patrolTarget();
      tx = pt.x;
      tz = pt.z;
      if (Math.hypot(tx - this.pos.x, tz - this.pos.z) < 2) this.patrol = null;
      this.callTimer = Math.max(0, this.callTimer - dt);
    }
    if (this.called) {
      this.recall -= dt;
      if (this.recall <= 0) {
        this.called = false;
        this.callTimer = 0;
      }
    }
    const ty = ctx.col.groundHeight(tx, tz, 200, 0.5, 0) + this.def.hover + Math.sin(this.anim * 0.7) * 1.5;
    this.airMove(dt, ctx, tx, ty, tz, this.def.speed);
    this.faceTowards(this.state === 'alert' ? this.lastSeen.x : tx, this.state === 'alert' ? this.lastSeen.z : tz, dt, 3);
  }

  think_slam(dt, ctx, dist) {
    const a = this.def.attack;
    const p = ctx.player;
    this.cooldown -= dt;
    if (this.leap) {
      this.leap.t += dt;
      const t = Math.min(1, this.leap.t / this.leap.dur);
      this.pos.lerpVectors(this.leap.from, this.leap.to, t);
      this.pos.y += Math.sin(t * Math.PI) * 9;
      this.parts.body.rotation.x = -0.4 + t * 0.6;
      if (t >= 1) {
        this.leap = null;
        this.parts.body.rotation.x = 0;
        this.pos.y = ctx.col.groundHeight(this.pos.x, this.pos.z, this.pos.y + 2, this.def.radius, 2);
        ctx.effects.shockwave(this.pos, a.radius);
        Audio.playExplosion(dist);
        ctx.shake(0.6 * Math.max(0, 1 - dist / 40));
        if (p.alive && p.pos.distanceTo(this.pos) < a.radius && p.pos.y < this.pos.y + 2.5) {
          ctx.damagePlayer(a.damage * (1 - p.pos.distanceTo(this.pos) / (a.radius * 1.5)), this.pos, this);
        }
      }
      return;
    }
    this.animateLegs(dt);
    if (this.state === 'alert') {
      if (this.canSee && dist < a.range && dist > 5 && this.cooldown <= 0) {
        this.cooldown = a.cooldown;
        const to = p.pos.clone();
        to.y = ctx.col.groundHeight(to.x, to.z, to.y + 1, 0.5);
        this.leap = { from: this.pos.clone(), to, t: 0, dur: 1.1 };
        this.faceTowards(to.x, to.z, 1, 100);
        Audio.playHuskChirp(dist);
        return;
      }
      this.groundMove(dt, ctx, this.lastSeen.x, this.lastSeen.z, this.def.speed);
      if (dist < 5 && this.cooldown <= 0) {
        // stomp in place
        this.cooldown = a.cooldown;
        this.leap = { from: this.pos.clone(), to: this.pos.clone(), t: 0, dur: 0.6 };
      }
    } else {
      const pt = this.patrolTarget();
      if (this.groundMove(dt, ctx, pt.x, pt.z, this.def.speed * 0.3) < 2) this.patrol = null;
    }
  }

  animateLegs(dt) {
    if (!this.parts.legs) return;
    const speed = this.state === 'alert' ? 14 : 5;
    this.parts.legs.forEach((leg, i) => {
      const phase = this.anim * speed + i * Math.PI * 0.5;
      if (this.type === 'skitter') leg.rotation.y = Math.sin(phase) * 0.4;
      else leg.position.y = -1.1 + Math.max(0, Math.sin(phase)) * 0.3;
    });
  }

  destroy() {
    this.scene.remove(this.model);
    this.model.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
}

// Closest hit distance of a ray against the player's body (two spheres), or null.
export function rayHitsPlayer(from, dir, player, maxD) {
  const h = player.crouch ? 1.2 : 1.8;
  const centers = [
    { y: player.pos.y + h * 0.3, r: 0.42 },
    { y: player.pos.y + h * 0.72, r: 0.42 },
  ];
  let best = null;
  for (const c of centers) {
    const t = raySphere(from, dir, player.pos.x, c.y, player.pos.z, c.r);
    if (t !== null && t <= maxD && (best === null || t < best)) best = t;
  }
  return best;
}

export function raySphere(o, d, cx, cy, cz, r) {
  const ox = o.x - cx;
  const oy = o.y - cy;
  const oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return c < 0 ? 0 : null;
  return t;
}
