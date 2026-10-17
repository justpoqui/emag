// The raider's model and its animation. Limbs have two segments (thigh and
// shin, upper arm and forearm) so knees and elbows bend. Used by the player in
// raids and by the Patron's Sanctuary room behind the menus.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

function part(geo, material, x, y, z, parent) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

// A rounded limb segment that hangs down from its group's origin, so rotating
// the group swings it. len is the full length including the rounded ends.
function hanging(radius, len, material, parent) {
  const g = new THREE.CapsuleGeometry(radius, Math.max(0.01, len - radius * 2), 6, 12);
  g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  parent.add(m);
  return m;
}

const rounded = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 3, r);

// Patchwork raider: long coat, scarf, goggles, rounded pack, a stick on the back.
export function buildRaiderModel(colors = {}) {
  const jacket = new THREE.MeshStandardMaterial({ color: colors.jacket ?? 0xc4672f, roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: colors.pants ?? 0x4a5242, roughness: 0.95 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc89a7a, roughness: 0.8 });
  const gear = new THREE.MeshStandardMaterial({ color: 0x3b3833, roughness: 0.8 });
  const scarf = new THREE.MeshStandardMaterial({ color: colors.scarf ?? 0x2f8f8a, roughness: 0.95 });
  const lens = new THREE.MeshStandardMaterial({ color: 0x1a2a2a, emissive: 0x40ffd0, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.2 });
  const pack = new THREE.MeshStandardMaterial({ color: colors.pack ?? 0x8a7a55, roughness: 0.95 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e4f30, roughness: 0.85 });
  const tape = new THREE.MeshStandardMaterial({ color: 0x2f8f8a, roughness: 0.9 });

  const root = new THREE.Group();
  const body = new THREE.Group(); // everything above the hips
  body.position.y = 0.95;
  root.add(body);

  // torso: a tapered capsule, coat flaring over the hips
  const torso = part(new THREE.CapsuleGeometry(0.235, 0.28, 8, 16), jacket, 0, 0.33, 0, body);
  torso.scale.set(1.05, 0.82, 0.66);
  const coat = part(new THREE.CylinderGeometry(0.235, 0.29, 0.34, 18, 1, true), jacket, 0, -0.06, 0, body);
  coat.scale.set(1, 1, 0.68);
  coat.material = jacket.clone();
  coat.material.side = THREE.DoubleSide;
  const belt = part(new THREE.TorusGeometry(0.235, 0.045, 8, 24), gear, 0, 0.04, 0, body);
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(1.02, 0.68, 1);
  part(rounded(0.42, 0.52, 0.27, 0.09), pack, 0, 0.36, -0.29, body);
  part(new THREE.CapsuleGeometry(0.085, 0.24, 6, 12), gear, 0, 0.72, -0.3, body).rotation.z = Math.PI / 2; // bedroll
  const wrap = part(new THREE.TorusGeometry(0.16, 0.065, 8, 22), scarf, 0, 0.64, 0.02, body); // scarf
  wrap.rotation.x = Math.PI / 2 - 0.15;
  wrap.scale.set(1.1, 0.95, 1);

  const head = new THREE.Group();
  head.position.set(0, 0.82, 0);
  body.add(head);
  part(new THREE.SphereGeometry(0.14, 18, 14), skin, 0, 0.06, 0, head).scale.set(0.95, 1.08, 1);
  part(new THREE.SphereGeometry(0.155, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), gear, 0, 0.09, -0.01, head); // hood cap
  const goggles = part(new THREE.CapsuleGeometry(0.045, 0.14, 4, 10), lens, 0, 0.1, 0.12, head);
  goggles.rotation.z = Math.PI / 2;
  const mask = part(new THREE.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.32), scarf, 0, 0.04, 0.02, head); // face wrap
  mask.scale.set(1.05, 1, 1.1);

  // legs: hip -> thigh -> knee -> shin -> boot
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.12, 0.95, 0);
    root.add(hip);
    hanging(0.1, 0.49, pants, hip);
    const knee = new THREE.Group();
    knee.position.y = -0.47;
    hip.add(knee);
    part(new THREE.SphereGeometry(0.085, 12, 10), gear, 0, 0, 0.04, knee).scale.set(1.1, 0.9, 1); // knee pad
    hanging(0.085, 0.42, pants, knee);
    part(rounded(0.17, 0.13, 0.29, 0.06), gear, 0, -0.415, 0.045, knee); // boot
    return { hip, knee };
  });

  // arms: shoulder -> upper arm -> elbow -> forearm -> hand
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.3, 0.58, 0);
    body.add(shoulder);
    part(new THREE.SphereGeometry(0.095, 12, 10), jacket, 0, -0.02, 0, shoulder);
    hanging(0.075, 0.34, jacket, shoulder);
    const elbow = new THREE.Group();
    elbow.position.y = -0.32;
    shoulder.add(elbow);
    hanging(0.065, 0.32, jacket, elbow);
    const hand = part(new THREE.SphereGeometry(0.06, 12, 10), skin, 0, -0.34, 0, elbow);
    hand.scale.set(1, 1.15, 0.9);
    return { shoulder, elbow, hand };
  });

  // the stick: carried across the back, drawn into the right hand to swing
  const stickGeo = new THREE.CylinderGeometry(0.028, 0.034, 1.05, 8);
  const backStick = new THREE.Group();
  backStick.position.set(0.05, 0.42, -0.46);
  backStick.rotation.set(0, 0, 0.9);
  body.add(backStick);
  part(stickGeo, wood, 0, 0, 0, backStick);
  part(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 8), tape, 0, -0.35, 0, backStick);
  const handStick = new THREE.Group();
  handStick.position.set(0, -0.36, 0.02);
  handStick.rotation.x = Math.PI / 2;
  arms[1].elbow.add(handStick);
  part(stickGeo, wood, 0, 0.38, 0, handStick);
  part(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 8), tape, 0, 0.0, 0, handStick);
  handStick.visible = false;

  // gun in hands, and a holster spot across the back
  const gunSocket = new THREE.Group();
  gunSocket.position.set(0.2, 0.42, 0.32);
  body.add(gunSocket);
  const backSocket = new THREE.Group();
  backSocket.position.set(-0.05, 0.4, -0.5);
  backSocket.rotation.set(0.15, Math.PI / 2, -0.95);
  body.add(backSocket);

  root.userData = { body, head, torso, legs, arms, backStick, handStick, gunSocket, backSocket };
  return root;
}

const lerp = (a, b, t) => a + (b - a) * t;
const ZERO2 = [0, 0];
const THIGH = 0.47;
const SHIN = 0.48;

// Pose the rig for one frame. s = {
//   speed (m/s on the ground), phase (walk cycle), crouch, sprint, airborne,
//   armed (gun in hands), ads, pitch, recoil, melee (0..1 through a swing, or -1),
//   idle (seconds standing still, for breathing), crouchBlend (0..1),
//   ground: [left, right] height of the ground under each foot relative to the
//   model's origin (feet plant on it and never sink below), tuck (0..1, rolling) }
export function poseRig(u, s, dt) {
  const k = Math.min(1, dt * 14);
  const move = Math.min(1, s.speed / 4.5);
  const amp = (s.sprint ? 0.95 : 0.6) * move;
  const sw = Math.sin(s.phase);
  const [lLeg, rLeg] = u.legs;
  const [lArm, rArm] = u.arms;

  // ---- legs ----
  let thighL = -sw * amp;
  let thighR = sw * amp;
  // knees bend on the leg that is swinging forward, and a little on contact
  let kneeL = (0.15 + Math.max(0, Math.sin(s.phase + 0.9)) * 1.25) * amp;
  let kneeR = (0.15 + Math.max(0, Math.sin(s.phase + 0.9 + Math.PI)) * 1.25) * amp;
  let drop = Math.abs(Math.cos(s.phase)) * 0.05 * move; // body bob
  const cb = s.crouchBlend || 0;
  if (cb > 0) {
    thighL = lerp(thighL, -1.05 - sw * 0.3 * move, cb);
    thighR = lerp(thighR, -0.55 + sw * 0.3 * move, cb);
    kneeL = lerp(kneeL, 1.75, cb);
    kneeR = lerp(kneeR, 1.35, cb);
    drop = lerp(drop, 0.36, cb);
  }
  if (s.airborne) {
    thighL = -0.7;
    thighR = -0.2;
    kneeL = 1.1;
    kneeR = 0.6;
  }
  // on a slope, drop the hips to the lower foot and bend the uphill knee
  const ground = s.ground || ZERO2;
  drop += Math.min(0.3, Math.max(0, -Math.min(ground[0], ground[1])));
  const tuck = s.tuck || 0;
  if (tuck > 0) {
    // roll: curl up into a ball
    thighL = lerp(thighL, -2.1, tuck);
    thighR = lerp(thighR, -2.0, tuck);
    kneeL = lerp(kneeL, 2.4, tuck);
    kneeR = lerp(kneeR, 2.3, tuck);
    drop = lerp(drop, 0.42, tuck);
  }
  lLeg.hip.rotation.x = lerp(lLeg.hip.rotation.x, thighL, k);
  rLeg.hip.rotation.x = lerp(rLeg.hip.rotation.x, thighR, k);
  lLeg.knee.rotation.x = lerp(lLeg.knee.rotation.x, kneeL, k);
  rLeg.knee.rotation.x = lerp(rLeg.knee.rotation.x, kneeR, k);

  // ---- body ----
  const breathe = Math.sin((s.idle || 0) * 2.2) * 0.012 * (1 - move);
  const bodyY = 0.95 - drop + breathe;
  u.body.position.y = lerp(u.body.position.y, bodyY, k);
  lLeg.hip.position.y = rLeg.hip.position.y = u.body.position.y;
  // plant the feet: if a sole would end up under the ground, bend that knee
  // just enough to keep it on top (two-bone leg: thigh 0.47, shin to sole 0.48)
  if (tuck < 0.05) {
    u.legs.forEach((leg, i) => {
      const a = leg.hip.rotation.x;
      const hipY = leg.hip.position.y;
      const g = ground[i];
      const kneeY = hipY - THIGH * Math.cos(a);
      if (kneeY - SHIN * Math.cos(a + leg.knee.rotation.x) >= g) return;
      const ratio = (kneeY - g) / SHIN;
      if (ratio >= 1) return;
      const bend = Math.acos(Math.max(-1, ratio)) - a;
      if (bend > leg.knee.rotation.x) leg.knee.rotation.x = Math.min(2.6, bend);
    });
  }
  const lean = lerp((s.sprint ? 0.22 : 0.05 * move) + cb * 0.2, 1.0, tuck);
  u.body.rotation.x = lerp(u.body.rotation.x, lean, k);
  u.body.rotation.y = lerp(u.body.rotation.y, s.armed ? 0 : sw * 0.08 * move, k);
  u.head.rotation.x = lerp(u.head.rotation.x, -(s.pitch || 0) * 0.5 - lean * 0.6, k);
  u.head.rotation.y = lerp(u.head.rotation.y, s.look || 0, Math.min(1, dt * 3));

  // ---- arms ----
  let rUp = { x: sw * amp * 0.9, z: -0.08 };
  let rEl = -0.25 - Math.abs(sw) * 0.5 * amp - (s.sprint ? 1.0 : 0);
  let lUp = { x: -sw * amp * 0.9, z: 0.08 };
  let lEl = -0.25 - Math.abs(sw) * 0.5 * amp - (s.sprint ? 1.0 : 0);
  if (s.armed) {
    const aim = s.sprint && !s.ads ? -0.7 : s.pitch || 0;
    const kick = s.recoil || 0;
    rUp = { x: -0.95 - aim * 0.9 - kick * 0.25, z: -0.15 };
    rEl = -0.85 + kick * 0.2;
    lUp = { x: -1.15 - aim * 0.9, z: 0.55 };
    lEl = -0.75;
    u.gunSocket.rotation.set(-aim - kick * 0.3, 0, 0);
    u.gunSocket.position.set(0.18, 0.5 + Math.sin(-aim) * 0.1, 0.38 - kick * 0.08);
    if (s.sprint && !s.ads) u.gunSocket.rotation.set(0.6, -0.6, 0);
  }
  // melee swing: wind up over the shoulder, chop forward and across, recover
  const m = s.melee ?? -1;
  u.handStick.visible = m >= 0;
  u.backStick.visible = m < 0;
  if (m >= 0) {
    let x;
    let z;
    let el;
    if (m < 0.3) {
      const t = m / 0.3;
      x = lerp(-0.4, -2.7, t);
      z = lerp(-0.1, -0.5, t);
      el = lerp(-0.4, -1.4, t);
    } else if (m < 0.55) {
      const t = (m - 0.3) / 0.25;
      x = lerp(-2.7, -0.5, t);
      z = lerp(-0.5, 0.45, t);
      el = lerp(-1.4, -0.2, t);
    } else {
      const t = (m - 0.55) / 0.45;
      x = lerp(-0.5, -0.2, t);
      z = lerp(0.45, -0.1, t);
      el = lerp(-0.2, -0.4, t);
    }
    rUp = { x, z };
    rEl = el;
    u.body.rotation.y = lerp(u.body.rotation.y, m < 0.3 ? -0.35 : 0.35, Math.min(1, dt * 18));
  }
  if (tuck > 0) {
    // hug the knees
    rUp = { x: lerp(rUp.x, -1.3, tuck), z: lerp(rUp.z, -0.25, tuck) };
    lUp = { x: lerp(lUp.x, -1.3, tuck), z: lerp(lUp.z, 0.25, tuck) };
    rEl = lerp(rEl, -1.7, tuck);
    lEl = lerp(lEl, -1.7, tuck);
  }
  const kk = m >= 0 ? Math.min(1, dt * 30) : k;
  rArm.shoulder.rotation.x = lerp(rArm.shoulder.rotation.x, rUp.x, kk);
  rArm.shoulder.rotation.z = lerp(rArm.shoulder.rotation.z, rUp.z, kk);
  rArm.elbow.rotation.x = lerp(rArm.elbow.rotation.x, rEl, kk);
  lArm.shoulder.rotation.x = lerp(lArm.shoulder.rotation.x, lUp.x, k);
  lArm.shoulder.rotation.z = lerp(lArm.shoulder.rotation.z, lUp.z, k);
  lArm.elbow.rotation.x = lerp(lArm.elbow.rotation.x, lEl, k);
}
