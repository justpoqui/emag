// The raider's model and its animation. Limbs have two segments (thigh and
// shin, upper arm and forearm) so knees and elbows bend. Used by the player in
// raids and by the Patron's Sanctuary room behind the menus.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { applyOutfit, DEFAULT_OUTFIT } from './outfit.js';

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

// The raider. Proportions follow a 1.8 m person: hips at 0.95 m, thigh 0.46,
// shin to sole 0.49, a shaped torso that ends over a separate pelvis (the
// thighs sit inside it, so the top of a leg never shows), and a head that
// floats just clear of the shoulders with no neck.
//
// This builds the bare body (skin, with a grey base layer on the torso and
// hips) plus the gear; clothes, hair and hats go on over it (outfit.js).
// colors: { jacket, scarf, pack } tints the default outfit (the traders).
export function buildRaiderModel(colors = {}, outfit = DEFAULT_OUTFIT) {
  const skin = new THREE.MeshStandardMaterial({ color: 0xc89a7a, roughness: 0.8 });
  const jacket = new THREE.MeshStandardMaterial({ color: 0x5a5650, roughness: 0.9 }); // base layer
  const pants = jacket;
  const gear = new THREE.MeshStandardMaterial({ color: 0x3b3833, roughness: 0.8 });
  const lens = new THREE.MeshStandardMaterial({ color: 0x1a2a2a, emissive: 0x40ffd0, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.2 });
  const pack = new THREE.MeshStandardMaterial({ color: colors.pack ?? 0x8a7a55, roughness: 0.95 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e4f30, roughness: 0.85 });
  const tape = new THREE.MeshStandardMaterial({ color: 0x2f8f8a, roughness: 0.9 });

  const root = new THREE.Group();
  const body = new THREE.Group(); // everything above the hips; origin at hip height
  body.position.y = 0.95;
  root.add(body);

  // pelvis: the thighs' sockets sit inside it
  const base = { arms: [], legs: [] }; // the bare body parts clothes can cover
  const pelvis = part(new THREE.SphereGeometry(0.16, 20, 14), pants, 0, -0.03, 0, body);
  base.pelvis = pelvis;
  pelvis.scale.set(1.04, 0.78, 0.7);
  // torso: waist, chest, rounded shoulders; its hem sits over the top of the pelvis
  const torsoGeo = new THREE.LatheGeometry([
    [0, -0.02], [0.17, -0.02], [0.172, 0.06], [0.165, 0.16], [0.18, 0.28], [0.2, 0.4], [0.198, 0.48], [0.17, 0.555], [0.11, 0.61], [0.04, 0.635], [0, 0.638],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 24);
  const torso = part(torsoGeo, jacket, 0, 0, 0, body);
  torso.scale.z = 0.72;
  base.torso = torso;
  const belt = part(new THREE.TorusGeometry(0.172, 0.022, 8, 28), gear, 0, 0.0, 0, body);
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(1, 0.72, 1);
  // pack and bedroll sit behind the torso, clear of the head
  part(rounded(0.34, 0.42, 0.18, 0.07), pack, 0, 0.33, -0.235, body);
  part(new THREE.CapsuleGeometry(0.06, 0.24, 6, 12), gear, 0, 0.57, -0.24, body).rotation.z = Math.PI / 2;

  // head: a floating sphere with a visor wrapped onto its face
  const head = new THREE.Group();
  head.position.set(0, 0.79, 0);
  body.add(head);
  part(new THREE.SphereGeometry(0.12, 24, 18), skin, 0, 0, 0, head);
  // a band of the sphere centred on the face (+z)
  part(new THREE.SphereGeometry(0.123, 24, 6, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.36, Math.PI * 0.14), lens, 0, 0, 0, head);

  // legs: hip -> thigh -> knee -> shin -> boot, with a joint ball in the pants colour
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.092, 0.95, 0);
    root.add(hip);
    const thigh = hanging(0.078, 0.46, skin, hip);
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    hip.add(knee);
    const kneeBall = part(new THREE.SphereGeometry(0.07, 14, 10), skin, 0, 0, 0, knee);
    const shin = hanging(0.064, 0.42, skin, knee);
    base.legs.push({ side, thigh, kneeBall, shin });
    part(rounded(0.12, 0.1, 0.25, 0.045), gear, 0, -0.44, 0.04, knee); // boot, sole at -0.49
    return { hip, knee };
  });
  base.legs.forEach((l, i) => Object.assign(l, legs[i]));

  // arms: a shoulder cap fixed to each side of the torso, and the arm hanging
  // from inside the cap, so the arm sits just outside the body and never cuts
  // through it: shoulder -> upper arm -> elbow -> forearm -> hand
  const arms = [-1, 1].map((side) => {
    const cap = part(new THREE.SphereGeometry(0.078, 16, 12), skin, side * 0.245, 0.5, 0, body);
    cap.scale.set(1.05, 0.9, 1);
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.262, 0.495, 0);
    body.add(shoulder);
    const upper = hanging(0.056, 0.3, skin, shoulder);
    const elbow = new THREE.Group();
    elbow.position.y = -0.29;
    shoulder.add(elbow);
    const elbowBall = part(new THREE.SphereGeometry(0.052, 12, 10), skin, 0, 0, 0, elbow);
    const forearm = hanging(0.048, 0.27, skin, elbow);
    base.arms.push({ side, cap, upper, elbowBall, forearm });
    const hand = part(new THREE.SphereGeometry(0.046, 12, 10), skin, 0, -0.3, 0, elbow);
    hand.scale.set(0.9, 1.15, 0.8);
    return { shoulder, elbow, hand };
  });
  base.arms.forEach((a, i) => Object.assign(a, arms[i]));

  // the stick: carried across the back, drawn into the right hand to swing
  const stickGeo = new THREE.CylinderGeometry(0.028, 0.034, 1.05, 8);
  // the raider faces +z, so their left is +x and their right is -x
  // the stick rides upright down the right side of the pack
  const backStick = new THREE.Group();
  backStick.position.set(-0.21, 0.3, -0.24);
  backStick.rotation.set(0.1, 0, -0.08);
  body.add(backStick);
  part(stickGeo, wood, 0, 0, 0, backStick);
  part(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 8), tape, 0, -0.35, 0, backStick);
  const handStick = new THREE.Group();
  handStick.position.set(0, -0.31, 0.02);
  handStick.rotation.x = Math.PI / 2;
  arms[1].elbow.add(handStick);
  part(stickGeo, wood, 0, 0.38, 0, handStick);
  part(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 8), tape, 0, 0.0, 0, handStick);
  handStick.visible = false;

  // gun in hands, and a holster spot across the back
  // the gun's socket is the shoulder pocket the stock rests in; it yaws (to
  // cancel the side-on stance) and then pitches with the aim
  const gunSocket = new THREE.Group();
  gunSocket.rotation.order = 'YXZ';
  gunSocket.position.set(0.15, 0.47, 0.16);
  body.add(gunSocket);
  // long guns hang upright down the left side of the pack (a second one just behind it)
  const sling = (x, z, lean) => {
    const g = new THREE.Group();
    g.rotation.order = 'ZXY';
    g.position.set(x, 0.28, z);
    g.rotation.set(-Math.PI / 2, 0, lean); // muzzle up, top leaning out a little
    body.add(g);
    return g;
  };
  const backSocket = sling(0.215, -0.22, 0.1);
  const backSocket2 = sling(0.25, -0.31, 0.16);
  // hip carry: muzzle down, grip forward (pistol in a left-hip holster, SMG slung on the right)
  const hipLSocket = new THREE.Group();
  hipLSocket.rotation.order = 'YXZ';
  hipLSocket.position.set(0.215, -0.02, 0.03);
  hipLSocket.rotation.set(Math.PI / 2, Math.PI, 0);
  body.add(hipLSocket);
  const hipRSocket = new THREE.Group();
  hipRSocket.rotation.order = 'YXZ';
  hipRSocket.position.set(-0.235, 0.02, 0.02);
  hipRSocket.rotation.set(Math.PI / 2 - 0.22, Math.PI, 0);
  body.add(hipRSocket);

  // flashlight: a GI angle-head torch (olive drab, head bent forward) clipped
  // to the front of the belt; it shines from there when switched on
  const od = new THREE.MeshStandardMaterial({ color: 0x4b5320, roughness: 0.75 });
  const torch = new THREE.Group();
  body.add(torch);
  part(rounded(0.05, 0.12, 0.04, 0.012), od, 0, 0, 0, torch); // body
  part(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 6), gear, 0.031, 0.012, 0, torch); // switch rail
  part(rounded(0.034, 0.03, 0.012, 0.004), gear, 0, 0.0, -0.024, torch); // belt clip
  const torchHead = part(new THREE.CylinderGeometry(0.027, 0.024, 0.05, 14), od, 0, 0.068, 0.018, torch); // angle head
  torchHead.rotation.x = Math.PI / 2;
  const torchLens = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0xfff2cc, emissiveIntensity: 0, roughness: 0.3 });
  const torchGlass = part(new THREE.CylinderGeometry(0.022, 0.022, 0.004, 14), torchLens, 0, 0.068, 0.045, torch);
  torchGlass.rotation.x = Math.PI / 2;
  // on the belt, just to the side of the buckle, facing forward
  torch.position.set(-0.075, 0.035, 0.13);

  root.userData = { body, head, torso, legs, arms, base, backStick, handStick, gunSocket, backSocket, backSocket2, hipLSocket, hipRSocket, torch, torchLens };
  applyOutfit(root, outfit, colors);
  return root;
}

// Flashlight on or off: the lens lights up (it stays clipped to the belt).
export function setTorch(u, on) {
  u.torchLens.emissiveIntensity = on ? 3 : 0;
}

const lerp = (a, b, t) => a + (b - a) * t;
const ZERO2 = [0, 0];
const THIGH = 0.46;
const SHIN = 0.49;

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
  // holding a gun, the upper body turns side-on (left shoulder forward) like a real shooter
  const gun = s.armed ? u.gunSocket.children[0] : null;
  const twist = gun ? gun.userData.hold.twist : 0;
  u.body.rotation.y = lerp(u.body.rotation.y, gun ? twist : sw * 0.08 * move, k);
  u.head.rotation.x = lerp(u.head.rotation.x, -(s.pitch || 0) * 0.5 - lean * 0.6, k);
  // the head keeps facing forward whatever the shoulders do
  u.lookY = lerp(u.lookY || 0, s.look || 0, Math.min(1, dt * 3));
  u.head.rotation.y = u.lookY - u.body.rotation.y;
  // a ponytail trails behind and swings with each step
  if (u.tail) {
    u.tail.rotation.x = lerp(u.tail.rotation.x, 0.3 + move * 0.45 + Math.cos(s.phase * 2) * 0.1 * move - u.head.rotation.x * 0.8 + (s.airborne ? 0.4 : 0), Math.min(1, dt * 8));
    u.tail.rotation.z = lerp(u.tail.rotation.z, Math.sin(s.phase) * 0.18 * move + Math.sin((s.idle || 0) * 1.3) * 0.03, Math.min(1, dt * 8));
  }

  // ---- arms ----
  let rUp = { x: sw * amp * 0.9, z: 0.1 }; // z > 0 swings the right arm outward
  let rEl = -0.25 - Math.abs(sw) * 0.5 * amp - (s.sprint ? 1.0 : 0);
  let lUp = { x: -sw * amp * 0.9, z: -0.1 };
  let lEl = -0.25 - Math.abs(sw) * 0.5 * amp - (s.sprint ? 1.0 : 0);
  if (gun) {
    // the stock sits in the shoulder pocket and the gun points where the
    // raider aims; a sprint carries it low across the body
    const aim = s.pitch || 0;
    const kick = s.recoil || 0;
    u.gunSocket.position.set(0.15, 0.47, 0.16 - kick * 0.06);
    if (s.sprint && !s.ads) u.gunSocket.rotation.set(0.55, -u.body.rotation.y - 0.5, 0);
    else u.gunSocket.rotation.set(-aim - kick * 0.3, -u.body.rotation.y, 0);
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
  if (gun && tuck < 0.5) {
    // hands on the gun: right hand on the grip, left on the fore-grip
    u.gunSocket.updateMatrix();
    gun.updateMatrix();
    const toBody = (v) => _t.copy(v).applyMatrix4(gun.matrix).applyMatrix4(u.gunSocket.matrix);
    reachArm(rArm, toBody(gun.userData.grip), 1, Math.min(1, dt * 20));
    reachArm(lArm, toBody(gun.userData.fore), -1, Math.min(1, dt * 20));
    return;
  }
  for (const [arm, up, el, rate] of [[rArm, rUp, rEl, kk], [lArm, lUp, lEl, k]]) {
    arm.shoulder.rotation.x = lerp(arm.shoulder.rotation.x, up.x, rate);
    arm.shoulder.rotation.y = lerp(arm.shoulder.rotation.y, 0, rate);
    arm.shoulder.rotation.z = lerp(arm.shoulder.rotation.z, up.z, rate);
    arm.elbow.rotation.x = lerp(arm.elbow.rotation.x, el, rate);
  }
}

// Two-bone arm reach: turn the shoulder and bend the elbow so the hand lands
// on target (body space), with the elbow hanging down and out. side: +1 right, -1 left.
const UPPER = 0.29; // shoulder to elbow
const FORE = 0.3; // elbow to the centre of the hand
const _t = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _twist = new THREE.Quaternion();
function reachArm(arm, target, side, rate) {
  _dir.subVectors(target, arm.shoulder.position);
  const d = Math.min(UPPER + FORE - 0.002, Math.max(0.08, _dir.length()));
  _dir.normalize();
  // elbow bend from the law of cosines
  const cosInner = (UPPER * UPPER + FORE * FORE - d * d) / (2 * UPPER * FORE);
  const bend = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosInner)));
  // where the hand is with that bend and no shoulder turn, then turn it onto the target
  _hand.set(0, -UPPER - FORE * Math.cos(bend), FORE * Math.sin(bend)).normalize();
  _q.setFromUnitVectors(_hand, _dir);
  // spin about the shoulder->hand line so the elbow points down and outward
  _elbow.set(0, -1, 0).applyQuaternion(_q);
  // the trigger arm's elbow sits out to the side; the support elbow hangs lower
  if (side > 0) _pole.set(1, -0.55, -0.2).normalize();
  else _pole.set(-0.6, -1, -0.2).normalize();
  _elbow.addScaledVector(_dir, -_elbow.dot(_dir));
  _pole.addScaledVector(_dir, -_pole.dot(_dir));
  const angle = Math.atan2(_dir.dot(_hand.crossVectors(_elbow, _pole)), _elbow.dot(_pole));
  _twist.setFromAxisAngle(_dir, angle);
  _q.premultiply(_twist);
  arm.shoulder.quaternion.slerp(_q, rate);
  arm.elbow.rotation.x = lerp(arm.elbow.rotation.x, -bend, rate);
}
