// Player weapons: firing, spread, recoil, reloading, and hit resolution.

import * as THREE from 'three';
import { ITEMS, AMMO, STICK } from './config.js';
import { countIn, removeFrom, durability } from './inventory.js';
import { raySphere } from './enemies.js';
import * as Audio from './audio.js';

export class Weapons {
  constructor(game) {
    this.game = game;
    this.active = 0;
    this.fireCd = 0;
    this.reloading = 0;
    this.reloadTotal = 0;
    this.bloom = 0;
    this.switching = 0;
    this.holstered = false;
    this.meleeCd = 0;
    this.meleeHit = false;
  }

  get loadout() {
    return this.game.profile.loadout;
  }

  current() {
    return this.loadout.weapons[this.active] || null;
  }

  def() {
    const w = this.current();
    return w ? ITEMS[w.id] : null;
  }

  reserve() {
    const d = this.def();
    return d ? countIn(this.loadout.bag, AMMO[d.ammo]) : 0;
  }

  reset() {
    this.holstered = false;
    this.meleeCd = 0;
    this.game.player.melee = -1;
    this.fireCd = 0;
    this.reloading = 0;
    this.bloom = 0;
    this.switching = 0;
    if (!this.current() && this.loadout.weapons[1 - this.active]) this.active = 1 - this.active;
  }

  // Put the gun on your back (faster movement) or draw it again.
  toggleHolster() {
    if (!this.current()) return;
    this.holstered = !this.holstered;
    this.reloading = 0;
    if (!this.holstered) this.switching = 0.35;
    Audio.playReload(0);
  }

  draw() {
    if (this.holstered && this.current()) this.toggleHolster();
  }

  switchTo(i) {
    if (!this.loadout.weapons[i]) return;
    if (i === this.active) return this.draw();
    this.holstered = false;
    this.active = i;
    this.reloading = 0;
    this.switching = 0.45;
    Audio.playReload(0);
  }

  startReload() {
    const w = this.current();
    const d = this.def();
    if (!w || this.reloading > 0 || w.mag >= d.mag || this.reserve() <= 0) return;
    this.reloading = d.reload;
    this.reloadTotal = d.reload;
    Audio.playReload(0);
  }

  cancelReload() {
    this.reloading = 0;
  }

  // Current spread in degrees.
  spread() {
    const d = this.def();
    if (!d) return 0;
    const p = this.game.player;
    let s = p.ads ? d.spreadAds : d.spreadHip;
    if (durability(this.current()) < 25) s *= 1.5; // worn weapons shoot loose
    const speed = Math.hypot(p.vel.x, p.vel.z);
    s *= 1 + speed * 0.12;
    if (!p.onGround) s *= 2;
    if (p.crouch) s *= 0.7;
    return s + this.bloom;
  }

  update(dt, input) {
    const p = this.game.player;
    this.fireCd -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 6);
    if (this.switching > 0) this.switching -= dt;
    const w = this.current();
    const d = this.def();
    const other = this.game.profile.loadout.weapons[1 - this.active];
    p.setGuns(w ? w.id : null, this.holstered, other ? other.id : null);
    this.updateMelee(dt);
    // no gun in hand: the trigger swings the stick
    if (!w || this.holstered) {
      if (input.firePressed) this.melee();
      return;
    }
    if (p.melee >= 0) return;

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = d.mag - w.mag;
        const got = removeFrom(this.loadout.bag, AMMO[d.ammo], need);
        w.mag += got;
        Audio.playReload(1);
        this.game.ui.refreshInventory();
      }
      return;
    }
    const blocked = p.sprinting || p.roll > 0 || this.switching > 0 || this.game.using || p.melee >= 0;
    if (blocked) return;
    const wantFire = d.auto ? input.fire : input.firePressed;
    if (wantFire && this.fireCd <= 0) {
      if (durability(w) <= 0) {
        if (input.firePressed) {
          Audio.playEmpty();
          this.game.ui.notify(`${d.name} is broken. Repair it at the Workbench.`);
        }
        return;
      }
      if (w.mag <= 0) {
        if (input.firePressed) Audio.playEmpty();
        if (this.reserve() > 0) this.startReload();
        return;
      }
      this.fire(w, d);
    }
  }

  // ---- the stick ----
  melee() {
    const p = this.game.player;
    if (this.meleeCd > 0 || p.melee >= 0 || p.roll > 0 || !p.alive || this.game.using) return;
    if (p.stamina < STICK.stamina * 0.5) return;
    p.stamina = Math.max(0, p.stamina - STICK.stamina);
    this.reloading = 0;
    this.meleeCd = STICK.cooldown;
    this.meleeHit = false;
    p.melee = 0;
    Audio.playSwing();
  }

  updateMelee(dt) {
    const p = this.game.player;
    this.meleeCd -= dt;
    if (p.melee < 0) return;
    p.melee += dt / STICK.swing;
    if (!this.meleeHit && p.melee >= STICK.hitAt) {
      this.meleeHit = true;
      this.meleeStrike();
    }
    if (p.melee >= 1) p.melee = -1;
  }

  meleeStrike() {
    const game = this.game;
    const p = game.player;
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    const chest = p.chest();
    const cosArc = Math.cos(((STICK.arc / 2) * Math.PI) / 180);
    let hits = 0;
    let kills = 0;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const c = e.center.clone();
      const dx = c.x - chest.x;
      const dz = c.z - chest.z;
      const flat = Math.hypot(dx, dz);
      if (flat - e.def.radius > STICK.range || Math.abs(c.y - chest.y) > 1.6 + e.def.radius) continue;
      if (flat > 0.3 && (dx * fx + dz * fz) / flat < cosArc) continue;
      const res = game.damageEnemy(e, STICK.damage, 0.3, 1, false, c, 'melee');
      hits++;
      if (res.killed) kills++;
      if (!e.dead) {
        // knock small Husks back and interrupt whatever they were doing
        if (!e.def.flying && e.def.radius < 1) {
          const n = Math.max(0.3, flat);
          e.pos.x += (dx / n) * STICK.knockback;
          e.pos.z += (dz / n) * STICK.knockback;
          game.col.resolveCylinder(e.pos, e.def.radius, 1.5);
        }
        e.leap = null;
        e.burstLeft = 0;
        e.cooldown = Math.max(e.cooldown, STICK.stagger);
      }
      game.effects.impact(c, [-fx, 0.3, -fz], 'metal');
    }
    if (hits) {
      Audio.playMetalHit(0);
      game.shake(0.15);
      game.ui.hitMarker(false, kills > 0);
    }
    game.noise(p.pos, 15);
  }

  fire(w, d) {
    const game = this.game;
    const p = game.player;
    this.fireCd = 60 / d.rpm;
    w.mag--;
    const before = durability(w);
    w.dur = Math.max(0, before - (d.wear || 0.1));
    if (before > 25 && w.dur <= 25) game.ui.notify(`${d.name} is badly worn. Its accuracy is dropping.`);
    if (before > 0 && w.dur <= 0) game.ui.notify(`${d.name} broke!`);
    const cam = game.camera;
    const camDir = new THREE.Vector3();
    cam.getWorldDirection(camDir);
    // find what the crosshair is over
    const aimHit = this.trace(cam.position, camDir, d.range, true);
    const aimPoint = cam.position.clone().addScaledVector(camDir, aimHit.dist);
    // bullets leave from just in front of the player's shoulder
    const origin = p.eye();
    origin.x += Math.cos(p.yaw) * -0.25;
    origin.z += Math.sin(p.yaw) * 0.25;
    const baseDir = aimPoint.clone().sub(origin).normalize();
    const muzzle = p.muzzleWorld();
    const spreadRad = this.spread() * (Math.PI / 180);
    let anyHit = false;
    let anyWeak = false;
    let kills = 0;
    let total = 0;
    for (let i = 0; i < d.pellets; i++) {
      const dir = baseDir.clone();
      // uniform cone
      const r = Math.sqrt(Math.random()) * spreadRad;
      const a = Math.random() * Math.PI * 2;
      const up = Math.abs(dir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(dir, up).normalize();
      const up2 = new THREE.Vector3().crossVectors(right, dir).normalize();
      dir.addScaledVector(right, Math.cos(a) * Math.tan(r)).addScaledVector(up2, Math.sin(a) * Math.tan(r)).normalize();
      const hit = this.trace(origin, dir, d.range, false);
      const end = origin.clone().addScaledVector(dir, hit.dist);
      if (i < 3 || d.pellets <= 3) game.effects.tracer(muzzle, end);
      if (hit.enemy) {
        // damage falls off past half range
        const fall = hit.dist > d.range * 0.5 ? 1 - ((hit.dist - d.range * 0.5) / (d.range * 0.5)) * 0.5 : 1;
        const res = game.damageEnemy(hit.enemy, d.damage * fall, d.armorPierce || 0, hit.mult, hit.weak, end);
        anyHit = true;
        if (hit.weak) anyWeak = true;
        total += res.dealt;
        if (res.killed) kills++;
        game.effects.impact(end, [-dir.x, -dir.y, -dir.z], 'metal');
      } else if (hit.normal) {
        game.effects.impact(end, hit.normal, hit.tag === 'metal' ? 'metal' : 'dust');
        if (hit.tag === 'metal') Audio.playMetalHit(hit.dist);
      }
    }
    if (anyHit) game.ui.hitMarker(anyWeak, kills > 0);
    game.effects.muzzle(muzzle);
    Audio.playGun(d.shape);
    game.noise(p.pos, d.shape === 'smg' ? 45 : 70);
    // recoil
    const kick = d.recoil * (p.ads ? 0.6 : 1) * (p.crouch ? 0.8 : 1);
    game.addRecoil(kick * 0.012, (Math.random() - 0.5) * kick * 0.008);
    this.bloom = Math.min(this.bloom + d.recoil * 0.35, 6);
    p.recoilKick = Math.min(1, p.recoilKick + kick * 0.25);
    if (w.mag <= 0 && this.reserve() > 0) setTimeout(() => this.startReload(), 250);
    game.ui.refreshAmmo();
  }

  // Closest hit along a ray: world geometry or a Husk hitbox.
  trace(origin, dir, range, forAim) {
    const game = this.game;
    const world = game.col.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range);
    let best = { dist: world ? world.dist : range, normal: world ? world.normal : null, tag: world ? world.tag : null };
    for (const e of game.enemies) {
      if (e.dead) continue;
      const c = e.center;
      // cheap reject
      const toE = new THREE.Vector3(c.x - origin.x, c.y - origin.y, c.z - origin.z);
      const along = toE.dot(dir);
      if (along < 0 || along > best.dist + 4) continue;
      if (toE.lengthSq() - along * along > 16) continue;
      for (const hb of e.hitboxes()) {
        const t = raySphere(origin, dir, hb.center.x, hb.center.y, hb.center.z, hb.r);
        if (t !== null && t < best.dist) {
          best = { dist: t, enemy: e, mult: hb.mult, weak: hb.weak };
        } else if (t !== null && best.enemy === e && hb.weak && Math.abs(t - best.dist) < hb.r) {
          // weak point overlaps the body: prefer it
          best = { dist: t, enemy: e, mult: hb.mult, weak: true };
        }
      }
    }
    if (forAim && best.dist < 2) best.dist = 2; // don't converge bullets inside your own face
    return best;
  }
}
