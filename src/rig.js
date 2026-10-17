// The raider's model and its animation. Limbs have two segments (thigh and
// shin, upper arm and forearm) so knees and elbows bend. Used by the player in
// raids and by the Patron's Sanctuary room behind the menus.

import * as THREE from 'three';

function part(geo, material, x, y, z, parent) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

// A box that hangs down from its group's origin, so rotating the group swings it.
function hanging(w, h, d, material, parent) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, -h / 2, 0);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  parent.add(m);
  return m;
}

// Patchwork raider: worn jacket, scarf, goggles, big backpack, a stick on the back.
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

  const torso = part(new THREE.BoxGeometry(0.52, 0.62, 0.3), jacket, 0, 0.32, 0, body);
  part(new THREE.BoxGeometry(0.5, 0.18, 0.32), gear, 0, 0.02, 0, body); // belt
  part(new THREE.BoxGeometry(0.42, 0.55, 0.28), pack, 0, 0.36, -0.29, body);
  part(new THREE.BoxGeometry(0.34, 0.2, 0.16), gear, 0, 0.72, -0.3, body); // bedroll
  part(new THREE.BoxGeometry(0.46, 0.14, 0.34), scarf, 0, 0.62, 0.02, body);

  const head = new THREE.Group();
  head.position.set(0, 0.82, 0);
  body.add(head);
  part(new THREE.BoxGeometry(0.26, 0.28, 0.26), skin, 0, 0.06, 0, head);
  part(new THREE.BoxGeometry(0.3, 0.14, 0.3), gear, 0, 0.2, -0.01, head); // cap
  part(new THREE.BoxGeometry(0.28, 0.08, 0.1), lens, 0, 0.1, 0.13, head); // goggles
  part(new THREE.BoxGeometry(0.28, 0.12, 0.12), scarf, 0, -0.04, 0.1, head); // face wrap

  // legs: hip -> thigh -> knee -> shin -> boot
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.13, 0.95, 0);
    root.add(hip);
    hanging(0.2, 0.47, 0.2, pants, hip);
    const knee = new THREE.Group();
    knee.position.y = -0.47;
    hip.add(knee);
    part(new THREE.BoxGeometry(0.21, 0.12, 0.22), gear, 0, 0, 0.02, knee); // knee pad
    hanging(0.18, 0.4, 0.18, pants, knee);
    part(new THREE.BoxGeometry(0.21, 0.14, 0.3), gear, 0, -0.41, 0.04, knee); // boot
    return { hip, knee };
  });

  // arms: shoulder -> upper arm -> elbow -> forearm -> hand
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.33, 0.58, 0);
    body.add(shoulder);
    hanging(0.15, 0.32, 0.15, jacket, shoulder);
    const elbow = new THREE.Group();
    elbow.position.y = -0.32;
    shoulder.add(elbow);
    hanging(0.13, 0.3, 0.13, jacket, elbow);
    const hand = part(new THREE.BoxGeometry(0.12, 0.12, 0.12), skin, 0, -0.34, 0, elbow);
    return { shoulder, elbow, hand };
  });

  // the stick: carried across the back, drawn into the right hand to swing
  const stickGeo = new THREE.CylinderGeometry(0.03, 0.035, 1.05, 6);
  const backStick = new THREE.Group();
  backStick.position.set(0.05, 0.42, -0.46);
  backStick.rotation.set(0, 0, 0.9);
  body.add(backStick);
  part(stickGeo, wood, 0, 0, 0, backStick);
  part(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 6), tape, 0, -0.35, 0, backStick);
  const handStick = new THREE.Group();
  handStick.position.set(0, -0.36, 0.02);
  handStick.rotation.x = Math.PI / 2;
  arms[1].elbow.add(handStick);
  part(stickGeo, wood, 0, 0.38, 0, handStick);
  part(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 6), tape, 0, 0.0, 0, handStick);
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

// Pose the rig for one frame. s = {
//   speed (m/s on the ground), phase (walk cycle), crouch, sprint, airborne,
//   armed (gun in hands), ads, pitch, recoil, melee (0..1 through a swing, or -1),
//   idle (seconds standing still, for breathing), crouchBlend (0..1) }
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
  lLeg.hip.rotation.x = lerp(lLeg.hip.rotation.x, thighL, k);
  rLeg.hip.rotation.x = lerp(rLeg.hip.rotation.x, thighR, k);
  lLeg.knee.rotation.x = lerp(lLeg.knee.rotation.x, kneeL, k);
  rLeg.knee.rotation.x = lerp(rLeg.knee.rotation.x, kneeR, k);

  // ---- body ----
  const breathe = Math.sin((s.idle || 0) * 2.2) * 0.012 * (1 - move);
  const bodyY = 0.95 - drop + breathe;
  u.body.position.y = lerp(u.body.position.y, bodyY, k);
  lLeg.hip.position.y = rLeg.hip.position.y = u.body.position.y;
  const lean = (s.sprint ? 0.22 : 0.05 * move) + cb * 0.2;
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
  const kk = m >= 0 ? Math.min(1, dt * 30) : k;
  rArm.shoulder.rotation.x = lerp(rArm.shoulder.rotation.x, rUp.x, kk);
  rArm.shoulder.rotation.z = lerp(rArm.shoulder.rotation.z, rUp.z, kk);
  rArm.elbow.rotation.x = lerp(rArm.elbow.rotation.x, rEl, kk);
  lArm.shoulder.rotation.x = lerp(lArm.shoulder.rotation.x, lUp.x, k);
  lArm.shoulder.rotation.z = lerp(lArm.shoulder.rotation.z, lUp.z, k);
  lArm.elbow.rotation.x = lerp(lArm.elbow.rotation.x, lEl, k);
}
