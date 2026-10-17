// Husks: models and AI.

import * as THREE from 'three';
import { ENEMIES, SENSE_RADIUS, SEARCH_SECONDS, LATCH } from './config.js';
import * as Audio from './audio.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();
const _d = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const BEAM_HALF_ANGLE = 0.24; // radians, the Watcher's lamp
// where latched Skitters cling, in the raider model's space: back, shoulders, thigh, calf
const LATCH_SPOTS = [
  new THREE.Vector3(0, 1.3, -0.42),
  new THREE.Vector3(-0.33, 1.45, -0.08),
  new THREE.Vector3(0.33, 1.4, -0.06),
  new THREE.Vector3(0.2, 0.7, 0.14),
  new THREE.Vector3(-0.2, 0.38, 0.12),
];
export const LATCH_SLOTS = LATCH_SPOTS.length;

const shell = new THREE.MeshStandardMaterial({ color: 0xc9cbc6, roughness: 0.45, metalness: 0.7 });
const plate = new THREE.MeshStandardMaterial({ color: 0x55595d, roughness: 0.5, metalness: 0.8 });
const dark = new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.6, metalness: 0.6 });
const hazard = new THREE.MeshStandardMaterial({ color: 0xd8902a, roughness: 0.6, metalness: 0.4 });

function eyeMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x331008, emissive: 0xff5020, emissiveIntensity: 1.2 });
}

function add(parent, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

// A smooth body of revolution: profile [[radius, y], ...] spun round the y axis.
function lathe(profile, segments = 18) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

// A curved limb: a tube along a bend from `a` through `b` to `c`.
function curvedLimb(a, b, c, radius) {
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(...a), new THREE.Vector3(...b), new THREE.Vector3(...c));
  return new THREE.TubeGeometry(curve, 8, radius, 6);
}

// the "?" a Husk shows while it searches for a raider it lost sight of
let huhMat = null;
function huhMaterial() {
  if (huhMat) return huhMat;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = '800 54px "Barlow Condensed", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = '#1d1c1a';
  g.strokeText('?', 32, 34);
  g.fillStyle = '#f2c14e';
  g.fillText('?', 32, 34);
  huhMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true });
  return huhMat;
}

const thrustMat = new THREE.MeshBasicMaterial({ color: 0x2f9fff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });

// soft round spot for the Watcher's searchlight on the ground
let spotTexture = null;
function spotTex() {
  if (spotTexture) return spotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.45)');
  grad.addColorStop(0.92, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  spotTexture = new THREE.CanvasTexture(c);
  return spotTexture;
}

// Each builder returns { root, eye, parts, hitboxes:[{node, r, mult, weak}] }.
// The eye is each Husk's critical spot; everything else takes bodyMult damage.
const BUILDERS = {
  skitter() {
    const root = new THREE.Group();
    root.scale.setScalar(0.75); // a small thing, about knee-high
    const body = new THREE.Group();
    body.position.y = 0.32;
    root.add(body);
    const carapace = add(body, new THREE.SphereGeometry(0.3, 18, 12), shell, 0, 0, 0);
    carapace.scale.set(1, 0.58, 1.25);
    const crest = add(body, new THREE.TorusGeometry(0.19, 0.03, 8, 24), plate, 0, 0.13, -0.04);
    crest.rotation.x = Math.PI / 2;
    crest.scale.set(1, 1.35, 1);
    add(body, new THREE.SphereGeometry(0.16, 14, 10), dark, 0, 0.03, -0.37).scale.set(1, 0.7, 1.25); // abdomen
    add(body, new THREE.TorusGeometry(0.07, 0.016, 6, 18), dark, 0, 0.03, 0.345); // lens ring
    const eye = add(body, new THREE.SphereGeometry(0.05, 12, 10), eyeMaterial(), 0, 0.03, 0.36);
    const legs = [];
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const k = (i % 3) - 1;
      const leg = new THREE.Group();
      leg.position.set(side * 0.2, 0.32, k * 0.2);
      const m = new THREE.Mesh(curvedLimb([0, 0, 0], [side * 0.32, 0.18, k * 0.12], [side * 0.46, -0.32, k * 0.22], 0.022), dark);
      leg.add(m);
      root.add(leg);
      legs.push(leg);
    }
    // hitboxes are generous for its size (small, fast targets are hard to hit)
    return { root, eye, body, legs, hitboxes: [{ node: body, r: 0.38, mult: 1 }, { node: eye, r: 0.1, mult: 2.2, weak: true }] };
  },
  buzzer() {
    const root = new THREE.Group();
    // teardrop hull, nose forward (+z)
    const hullGeo = lathe([[0, -0.55], [0.1, -0.5], [0.22, -0.3], [0.3, -0.05], [0.31, 0.15], [0.25, 0.33], [0.13, 0.45], [0, 0.48]]);
    hullGeo.rotateX(Math.PI / 2);
    const body = add(root, hullGeo, shell, 0, 0, 0);
    body.scale.set(1, 0.72, 1);
    add(root, new THREE.TorusGeometry(0.22, 0.025, 8, 28), plate, 0, 0, 0.1).scale.set(1.25, 0.85, 1); // waist band
    add(root, new THREE.TorusGeometry(0.075, 0.018, 6, 18), dark, 0, 0, 0.455); // lens ring
    const eye = add(root, new THREE.SphereGeometry(0.055, 12, 10), eyeMaterial(), 0, 0, 0.47);
    // vectoring thrusters instead of rotors
    const thrusters = [];
    for (const side of [-1, 1]) {
      const pod = new THREE.Group();
      pod.position.set(side * 0.42, -0.02, -0.05);
      root.add(pod);
      add(root, curvedLimb([side * 0.2, 0, 0.05], [side * 0.34, 0.08, 0], [side * 0.42, -0.02, -0.05], 0.035), plate);
      const casing = add(pod, new THREE.CapsuleGeometry(0.09, 0.26, 6, 12), dark, 0, 0, 0);
      casing.rotation.x = Math.PI / 2;
      const nozzle = add(pod, new THREE.CylinderGeometry(0.07, 0.1, 0.1, 12, 1, true), plate, 0, -0.08, -0.12);
      nozzle.rotation.x = 0.6;
      const flameGeo = new THREE.ConeGeometry(0.06, 0.26, 10, 1, true);
      flameGeo.rotateX(Math.PI); // wide end at the nozzle, tapering away
      flameGeo.translate(0, -0.13, 0);
      const flame = new THREE.Mesh(flameGeo, thrustMat);
      flame.position.set(0, -0.12, -0.16);
      flame.rotation.x = 0.6;
      pod.add(flame);
      thrusters.push({ pod, flame });
    }
    add(root, new THREE.CylinderGeometry(0.03, 0.02, 0.32, 8), dark, 0, -0.2, 0.22).rotation.x = Math.PI / 2; // gun
    return { root, eye, thrusters, hitboxes: [{ node: body, r: 0.46, mult: 1 }, { node: eye, r: 0.095, mult: 2.2, weak: true }] };
  },
  watcher() {
    const root = new THREE.Group();
    const body = add(root, lathe([[0, -0.45], [0.15, -0.43], [0.3, -0.27], [0.36, 0], [0.29, 0.24], [0.13, 0.4], [0.05, 0.55], [0, 0.6]], 20), shell, 0, 0, 0);
    const ring = add(root, new THREE.TorusGeometry(0.72, 0.04, 8, 40), hazard, 0, 0.1, 0);
    ring.rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      add(root, curvedLimb([Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3], [Math.cos(a) * 0.55, 0.22, Math.sin(a) * 0.55], [Math.cos(a) * 0.72, 0.1, Math.sin(a) * 0.72], 0.022), plate);
    }
    const eyeMat = eyeMaterial();
    eyeMat.emissive.setHex(0xffcc20);
    // the eye (and its lamp) faces forward, so the light comes from the Watcher itself
    add(root, new THREE.TorusGeometry(0.1, 0.022, 6, 18), dark, 0, -0.05, 0.345);
    const eye = add(root, new THREE.SphereGeometry(0.075, 12, 10), eyeMat, 0, -0.05, 0.35);
    add(root, new THREE.CylinderGeometry(0.012, 0.02, 0.7, 6), dark, 0, 0.9, 0);
    // searchlight: a faint beam and a bright spot on the ground (placed in world space each frame)
    const coneGeo = new THREE.ConeGeometry(1, 1, 24, 1, true);
    coneGeo.translate(0, -0.5, 0);
    const beam = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const spotGeo = new THREE.CircleGeometry(1, 32);
    spotGeo.rotateX(-Math.PI / 2);
    const spot = new THREE.Mesh(spotGeo, new THREE.MeshBasicMaterial({ color: 0xffe08a, map: spotTex(), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.frustumCulled = false;
    return { root, eye, ring, beam, spot, hitboxes: [{ node: body, r: 0.44, mult: 1 }, { node: eye, r: 0.11, mult: 2.2, weak: true }] };
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

// States: 'idle' (going about its business), 'wary' (neutral Husks that have
// noticed the raider: watching, keeping their distance) and 'alert' (hostile).
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
    if (built.beam) scene.add(built.beam, built.spot);
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
    // what this Husk knows about the raider this raid (fed to the network)
    this.noticed = false; // has seen the raider
    this.wasHostile = false; // has fought them
    this.peaceLogged = false;
    this.tension = 0; // builds while crowded or aimed at
    this.warned = false;
    this.waryTimer = 0;
    this.calmTimer = 0;
    this.shutter = 0; // eye shutters (0 open .. 1 slit)
    this.beamAt = new THREE.Vector3(x, y, z);
    this.sweep = Math.random() * 6;
    this.beamRadius = 3;
    this.lostFor = 0; // seconds since it last saw the raider
    this.searchAt = null; // where it's hunting for them after losing sight
    this.searchLeft = 0;
    this.searchTimer = 0;
    this.latch = null; // Skitters: { slot, shook, need } while clinging to the raider
    // a "?" over its head while it's searching
    this.huh = new THREE.Sprite(huhMaterial());
    const top = this.def.flying ? 0.75 : { skitter: 0.75, pouncer: 4.2, warden: 7 }[type] || 1.6;
    this.huh.position.y = top / (this.model.scale.y || 1);
    this.huh.scale.setScalar((type === 'warden' || type === 'pouncer' ? 1.2 : 0.45) / (this.model.scale.y || 1));
    this.huh.visible = false;
    this.model.add(this.huh);
    if (this.def.flying) this.pos.y = y + this.def.hover;
    // only the big pieces cast shadows; legs, thrusters and eyes aren't worth a shadow pass each
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingSphere();
      o.castShadow = o.material !== thrustMat && o.geometry.boundingSphere.radius * Math.max(o.scale.x, o.scale.y, o.scale.z) > 0.4;
    });
    this.small = this.def.radius < 1;
    this.syncModel();
  }

  get center() {
    if (this.def.flying) return this.pos;
    if (this.latch) return this.pos;
    const h = { skitter: 0.24, pouncer: 2.4, warden: 4.2 }[this.type] || 1;
    return _w.set(this.pos.x, this.pos.y + h, this.pos.z);
  }

  get hostile() {
    return this.state === 'alert';
  }

  hitboxes() {
    this.model.updateMatrixWorld(true);
    // shutters narrow the eye, so it's harder to hit as well as hitting softer
    return this.parts.hitboxes.map((h) => ({ center: h.node.getWorldPosition(new THREE.Vector3()), r: h.weak && this.def.neutral ? h.r * (1 - this.shutter * 0.35) : h.r, mult: h.mult, weak: h.weak }));
  }

  // strong: an attack or a call for help (turns hostile). Otherwise a noise:
  // neutral Husks only grow wary.
  alert(pos, strong = true) {
    if (this.dead) return;
    if (this.def.neutral && !strong) {
      if (this.state === 'idle') {
        this.state = 'wary';
        this.waryTimer = 6;
        this.lastSeen.copy(pos);
      }
      return;
    }
    if (this.state !== 'alert') Audio.playHuskChirp(this.distTo);
    this.state = 'alert';
    this.wasHostile = true;
    this.alertTimer = strong ? 12 : 6;
    this.calmTimer = 0;
    this.lastSeen.copy(pos);
    this.lostFor = 0;
    this.searchAt = null;
  }

  // weak hits are the eye; anywhere else takes bodyMult. guard: learned eye shutters (0..1).
  damage(amount, ap, mult, weak, guard = 0) {
    const armor = weak ? 0 : this.def.armor * (1 - (ap || 0));
    let dealt = amount * (1 - armor) * mult;
    if (!weak) dealt *= this.def.bodyMult || 1;
    else if (this.def.neutral) dealt *= 1 - guard * 0.35;
    this.hp -= dealt;
    this.hitFlash = 0.08;
    return dealt;
  }

  syncModel() {
    this.model.position.copy(this.pos);
    if (this.def.flying) this.model.position.y = this.pos.y;
    this.model.rotation.y = this.yaw;
  }

  // ctx: { player, col, effects, mind (network traits), aimingAt, onSeen, onPeace, damagePlayer, spawnEnemy, ... }
  update(dt, ctx) {
    if (this.dead) return;
    if (this.latch) {
      this.anim += dt;
      this.followLatch(ctx);
      return;
    }
    const p = ctx.player;
    const mind = ctx.mind;
    const playerPos = p.chest();
    const toPlayer = _v.subVectors(playerPos, this.center);
    const dist = toPlayer.length();
    this.distTo = dist;
    this.anim += dt;

    // perception, a few times a second
    this.seeTimer -= dt;
    if (this.seeTimer <= 0) {
      this.seeTimer = 0.25;
      const could = this.canSee;
      this.canSee = p.alive && this.perceive(ctx, playerPos, dist);
      if (this.canSee) this.sighted(ctx, playerPos, dist, could);
    }
    if (this.canSee) {
      this.lastSeen.copy(playerPos);
      this.lostFor = 0;
      this.searchAt = null;
    } else if (this.state === 'alert') {
      // lost sight (something's in the way): it doesn't know where the raider
      // went, so it hunts round the last place it saw them, then gives up
      this.lostFor += dt;
      if (this.lostFor > 0.6) {
        if (!this.searchAt) {
          this.searchAt = this.lastSeen.clone();
          this.searchLeft = SEARCH_SECONDS;
          this.searchTimer = 0;
          this.alertTimer = Math.min(this.alertTimer, SEARCH_SECONDS);
          this.burstLeft = 0;
          Audio.playHuskChirp(dist);
        }
        this.searchTimer -= dt;
        if (this.searchTimer <= 0) {
          this.searchTimer = 1.4 + Math.random() * 1.2;
          const a = Math.random() * Math.PI * 2;
          const r = 3 + Math.random() * 6;
          this.lastSeen.set(this.searchAt.x + Math.cos(a) * r, this.searchAt.y, this.searchAt.z + Math.sin(a) * r);
        }
      }
    }
    this.huh.visible = this.state === 'alert' && !!this.searchAt;
    if (this.state === 'alert') {
      this.alertTimer -= dt;
      if (this.alertTimer <= 0 && !this.canSee) this.state = this.def.neutral ? 'wary' : 'idle';
      // neutral Husks stand down once nothing's happened for a while
      if (this.def.neutral) {
        this.calmTimer += dt;
        if (this.calmTimer > mind.calm && !(this.canSee && dist < mind.space)) {
          this.state = 'wary';
          this.tension = 0;
          this.warned = false;
          this.waryTimer = 8;
        }
      }
    }
    if (!p.alive && this.state !== 'idle') this.state = this.def.neutral ? 'wary' : 'idle';

    this.chirpTimer -= dt;
    if (this.chirpTimer <= 0) {
      this.chirpTimer = 4 + Math.random() * 6;
      if (dist < 40) Audio.playHuskChirp(dist);
    }

    if (this.state === 'wary') this.think_wary(dt, ctx, dist);
    else {
      const handler = this[`think_${this.def.attack.kind}`];
      if (handler) handler.call(this, dt, ctx, dist);
    }
    if (this.parts.thrusters) this.animateThrusters(dt);
    if (this.parts.beam) this.updateSearchlight(dt, ctx);

    // eye shutters close as the network learns raiders aim for the eye
    const guard = this.def.neutral ? mind.eyeGuard : 0;
    this.shutter += (guard * (this.state === 'alert' ? 1 : 0.6) - this.shutter) * Math.min(1, dt * 4);
    this.parts.eye.scale.y = 1 - this.shutter * 0.7;
    // eye glows hotter while hostile, pulses while wary, flashes white when hit
    const eye = this.parts.eye.material;
    const target = this.state === 'alert' ? 3 : this.state === 'wary' ? 1.6 + Math.sin(this.anim * 5) * 0.5 + this.tension : 1.1;
    eye.emissiveIntensity += (target - eye.emissiveIntensity) * Math.min(1, dt * 5);
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      eye.emissiveIntensity = 6;
    }
    if (this.parts.core) this.parts.core.material.emissiveIntensity = 1.6 + Math.sin(this.anim * 6) * 0.8;
    this.syncModel();
  }

  // Can this Husk see the raider right now?
  perceive(ctx, playerPos, dist) {
    const p = ctx.player;
    // the Watcher only sees what its searchlight falls on (or right next to it)
    if (this.parts.beam) {
      // inside the cone of its light (and not far past where it lands)
      if (dist > SENSE_RADIUS && this.beamDir) {
        const eye = this.parts.eye.getWorldPosition(_u);
        _d.subVectors(playerPos, eye);
        const d = _d.length();
        if (d > this.beamLen + 2.5 || _d.dot(this.beamDir) / d < Math.cos(BEAM_HALF_ANGLE * 1.15)) return false;
      }
    } else {
      if (dist >= this.def.sight * (ctx.sightMul || 1) * (p.crouch ? 0.6 : 1)) return false;
      // only what's in front of it, unless the raider is right on top of it
      if (dist > SENSE_RADIUS && this.def.fov) {
        const dx = p.pos.x - this.pos.x;
        const dz = p.pos.z - this.pos.z;
        const facing = (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / (Math.hypot(dx, dz) || 1);
        if (facing < Math.cos(((this.def.fov / 2) * Math.PI) / 180)) return false;
      }
    }
    // Skitters rear up to look (their bodies sit so low that any bump in the ground would blind them)
    const eye = this.center.clone();
    if (this.type === 'skitter') eye.y += 0.35;
    if (!ctx.col.lineOfSight(eye, playerPos)) return false;
    // foliage hides the raider (unless they're practically touching)
    if (dist > SENSE_RADIUS && ctx.cover && ctx.cover.blocks(eye, playerPos)) return false;
    return true;
  }

  sighted(ctx, playerPos, dist, could) {
    const mind = ctx.mind;
    this.lastSeen.copy(playerPos);
    if (!this.def.neutral) {
      if (this.state === 'idle') Audio.playHuskChirp(dist);
      this.state = 'alert';
      this.alertTimer = 10;
      return;
    }
    if (!this.noticed) {
      this.noticed = true;
      ctx.onSeen(this);
    }
    if (this.state === 'idle') {
      if (mind.shootFirst && dist < this.def.sight * 0.6) {
        // it has learned this raider shoots first
        this.alert(playerPos, true);
        return;
      }
      this.state = 'wary';
      this.tension = 0;
      this.warned = false;
      if (!could) Audio.playHuskChirp(dist);
    }
    if (this.state === 'wary') this.waryTimer = 8;
    else this.alertTimer = 10;
  }

  // Neutral but cautious: watch the raider, keep room, warn, and only attack
  // if crowded (or aimed at) for too long.
  think_wary(dt, ctx, dist) {
    const p = ctx.player;
    const mind = ctx.mind;
    const flat = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const space = mind.space * (this.type === 'skitter' ? 1 + mind.keepAway * 0.6 : 1.5);
    let crowd = this.canSee && flat < space ? 1 : 0;
    if (this.canSee && ctx.aimingAt(this)) crowd += 0.6;
    if (crowd) this.tension += dt * crowd;
    else this.tension = Math.max(0, this.tension - dt * 0.6);
    if (this.tension > mind.patience * 0.45 && !this.warned) {
      // a warning: chirp and flare the eye
      this.warned = true;
      this.hitFlash = 0.25;
      Audio.playHuskChirp(dist);
    }
    if (this.tension > mind.patience) {
      this.alert(p.chest(), true);
      return;
    }
    if (!this.canSee) {
      this.waryTimer -= dt;
      if (this.waryTimer <= 0) {
        this.state = 'idle';
        this.tension = 0;
        if (this.noticed && !this.wasHostile && !this.peaceLogged) {
          this.peaceLogged = true;
          ctx.onPeace(this);
        }
      }
    }
    const look = this.canSee ? p.pos : this.lastSeen;
    if (this.def.flying) {
      // hold off at a distance, out of the way, watching
      const keep = this.type === 'watcher' ? 13 : Math.max(14, space * 2.5);
      const ang = Math.atan2(this.pos.x - look.x, this.pos.z - look.z) + dt * 0.15;
      const tx = look.x + Math.sin(ang) * keep;
      const tz = look.z + Math.cos(ang) * keep;
      const ty = ctx.col.groundHeight(tx, tz, 200, 0.5, 0) + this.def.hover + Math.sin(this.anim * 0.7) * 1.2;
      this.airMove(dt, ctx, tx, ty, tz, this.def.speed * 0.7);
      this.faceTowards(look.x, look.z, dt, 3);
      if (this.parts.ring) this.parts.ring.rotation.z += dt * 2.5;
    } else {
      this.animateLegs(dt);
      if (flat < space * 1.5) {
        // back away, facing the raider
        const ax = this.pos.x - p.pos.x;
        const az = this.pos.z - p.pos.z;
        const l = Math.hypot(ax, az) || 1;
        this.groundMove(dt, ctx, this.pos.x + (ax / l) * 4, this.pos.z + (az / l) * 4, this.def.speed * 0.55);
      }
      this.faceTowards(look.x, look.z, dt, 5);
    }
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

  // Buzzer thrusters swivel against the direction of travel and burn harder when moving.
  animateThrusters(dt) {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const fwd = this.vel.x * s + this.vel.z * c; // speed along the nose
    const side = this.vel.x * c - this.vel.z * s;
    const thrust = Math.min(1, this.vel.length() / this.def.speed);
    for (const t of this.parts.thrusters) {
      t.pod.rotation.x += (Math.max(-0.7, Math.min(0.7, fwd * 0.09)) - t.pod.rotation.x) * Math.min(1, dt * 6);
      t.pod.rotation.z += (Math.max(-0.5, Math.min(0.5, -side * 0.06)) - t.pod.rotation.z) * Math.min(1, dt * 6);
      const flicker = 0.85 + Math.random() * 0.3;
      t.flame.scale.set(1, (0.55 + thrust * 0.8) * flicker, 1);
    }
    // bank into turns
    this.model.rotation.z = Math.max(-0.35, Math.min(0.35, -side * 0.04));
    this.model.rotation.x = Math.max(-0.25, Math.min(0.25, fwd * 0.025));
  }

  // The Watcher's searchlight: sweeps the ground below it while idle, locks on
  // to the raider while wary or hostile. Its pool of light is what it can see.
  updateSearchlight(dt, ctx) {
    const { beam, spot, eye } = this.parts;
    const p = ctx.player;
    let tx;
    let tz;
    if (this.state === 'idle') {
      // sweep the ground ahead of it, side to side, like someone with a torch
      this.sweep += dt * 0.6;
      const a = this.yaw + Math.sin(this.sweep) * 0.7;
      const r = 9 + Math.sin(this.anim * 0.31) * 3;
      tx = this.pos.x + Math.sin(a) * r;
      tz = this.pos.z + Math.cos(a) * r;
    } else {
      const look = this.canSee ? p.pos : this.lastSeen;
      tx = look.x;
      tz = look.z;
    }
    const k = Math.min(1, dt * (this.state === 'idle' ? 2 : 4));
    this.beamAt.x += (tx - this.beamAt.x) * k;
    this.beamAt.z += (tz - this.beamAt.z) * k;
    this.beamAt.y = ctx.col.groundHeight(this.beamAt.x, this.beamAt.z, this.pos.y, 0.3, 400);
    this.model.updateMatrixWorld(true);
    const from = eye.getWorldPosition(_u);
    const dir = _d.subVectors(this.beamAt, from);
    const len = Math.max(1, dir.length());
    dir.divideScalar(len);
    this.beamDir = (this.beamDir || new THREE.Vector3()).copy(dir);
    this.beamLen = len;
    this.beamRadius = Math.max(1.8, len * Math.tan(BEAM_HALF_ANGLE));
    beam.position.copy(from);
    beam.quaternion.setFromUnitVectors(_down, dir);
    beam.scale.set(this.beamRadius, len, this.beamRadius);
    spot.position.set(this.beamAt.x, this.beamAt.y + 0.06, this.beamAt.z);
    spot.scale.setScalar(this.beamRadius);
    const color = this.state === 'alert' ? 0xff4a2a : this.state === 'wary' ? 0xffa040 : 0xffe08a;
    beam.material.color.setHex(color);
    spot.material.color.setHex(color);
    beam.visible = spot.visible = this.model.visible;
  }

  // Clinging to the raider: ride along on its spot, legs scrabbling.
  followLatch(ctx) {
    const p = ctx.player;
    p.model.updateMatrixWorld();
    this.pos.copy(LATCH_SPOTS[this.latch.slot]).applyMatrix4(p.model.matrixWorld);
    this.model.position.copy(this.pos);
    this.model.lookAt(_u.set(p.pos.x, this.pos.y, p.pos.z));
    this.huh.visible = false;
    this.parts.legs.forEach((leg, i) => {
      leg.rotation.y = Math.sin(this.anim * 22 + i) * 0.5;
    });
  }

  patrolTarget() {
    if (!this.patrol || Math.random() < 0.003) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * this.home.radius;
      this.patrol = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r };
    }
    return this.patrol;
  }

  // ---- behaviours (hostile, or idle patrols) ----
  think_leap(dt, ctx, dist) {
    const a = this.def.attack;
    const p = ctx.player;
    this.cooldown -= dt;
    if (this.leap) {
      this.leap.t += dt;
      const t = this.leap.t / this.leap.dur;
      this.pos.lerpVectors(this.leap.from, this.leap.to, Math.min(1, t));
      this.pos.y += Math.sin(Math.min(1, t) * Math.PI) * 1.2;
      if (!this.leap.hit && p.alive && this.pos.distanceTo(p.chest()) < 1.1) {
        this.leap.hit = true;
        ctx.damagePlayer(a.damage, this.pos, this);
        if (Math.random() < LATCH.chance && ctx.latch(this)) {
          this.leap = null;
          return;
        }
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
        if (away.lengthSq() > 0.01) to.addScaledVector(away.normalize(), 0.8);
        to.y = ctx.col.groundHeight(to.x, to.z, to.y + 0.5, 0.3);
        this.leap = { from: this.pos.clone(), to, t: 0, dur: 0.42, hit: false };
        Audio.playHuskChirp(dist);
        return;
      }
      // learned to fear close fights: circle at leap range instead of closing in
      if (ctx.mind.keepAway > 0.35 && dist < a.range * 0.8) {
        const ang = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + this.strafe * 0.8;
        this.groundMove(dt, ctx, p.pos.x + Math.sin(ang) * a.range * 0.9, p.pos.z + Math.cos(ang) * a.range * 0.9, this.def.speed);
      } else {
        this.groundMove(dt, ctx, target.x, target.z, this.def.speed);
      }
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
      let tx;
      let tz;
      let ty;
      if (this.state === 'alert') {
        // orbit the last seen position at mid range; jink harder against snipers
        const jink = ctx.mind.jink;
        const ang = Math.atan2(this.pos.x - this.lastSeen.x, this.pos.z - this.lastSeen.z) + this.strafe * dt * 3.6 * (1 + jink);
        const r = 16 + ctx.mind.keepAway * 6;
        tx = this.lastSeen.x + Math.sin(ang) * r;
        tz = this.lastSeen.z + Math.cos(ang) * r;
        ty = ctx.col.groundHeight(tx, tz, 200, 0.5, 0) + this.def.hover + Math.sin(this.anim * 2.3) * jink * 2.5;
        if (Math.random() < dt * (0.3 + jink * 1.5)) this.strafe *= -1;
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
      // hang back, keep the light on the raider, and call for help
      const away = Math.atan2(this.pos.x - this.lastSeen.x, this.pos.z - this.lastSeen.z) + dt * 0.3;
      tx = this.lastSeen.x + Math.sin(away) * 11;
      tz = this.lastSeen.z + Math.cos(away) * 11;
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
    if (this.parts.beam) {
      this.scene.remove(this.parts.beam, this.parts.spot);
      this.parts.beam.geometry.dispose();
      this.parts.spot.geometry.dispose();
    }
    this.model.traverse((o) => {
      if (o.geometry && !o.isSprite) o.geometry.dispose(); // sprites share one geometry
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
