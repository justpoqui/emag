// Clothes, hair and hats. Each piece is a shell a little bigger than the body
// part it covers. Sleeves and trouser legs are one continuous skinned mesh
// from shoulder to wrist (hip to ankle) that bends over the elbow or knee like
// cloth, and a sleeve's top blends into the shirt so the shoulder has no seam.
// Body parts a piece covers completely are hidden, so nothing can show through.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const WARDROBE = {
  shirt: [
    { id: 'field_jacket', name: 'Field Jacket', desc: 'Long sleeves, a flared hem, chest pockets and a scarf.', color: 0xc4672f },
    { id: 'work_tee', name: 'Work Tee', desc: 'A worn short-sleeved tee with a faded Sanctuary patch.', color: 0xd9d2c0 },
  ],
  pants: [
    { id: 'cargo_pants', name: 'Cargo Pants', desc: 'Full length, bloused into the boots, thigh pockets.', color: 0x4a5242 },
    { id: 'utility_shorts', name: 'Utility Shorts', desc: 'Cut off above the knee, rolled cuffs.', color: 0x6b5a42 },
  ],
  hat: [
    { id: 'none', name: 'No hat', desc: '' },
    { id: 'cap', name: 'Work Cap', desc: 'A stiff-brimmed cap.', color: 0x3b3833 },
    { id: 'boonie', name: 'Boonie Hat', desc: 'A soft, wide brim against the dust.', color: 0x7a7350 },
  ],
  hair: [
    { id: 'crop', name: 'Short Crop', desc: 'Short and choppy.', color: 0x1f1610 },
    { id: 'ponytail', name: 'Ponytail', desc: 'Tied back, out of the way.', color: 0x3a2214 },
  ],
};

export const DEFAULT_OUTFIT = { shirt: 'field_jacket', pants: 'cargo_pants', hat: 'cap', hair: 'crop' };

// Keep only known pieces (anything else falls back to the default).
export function cleanOutfit(o) {
  const out = {};
  for (const slot of Object.keys(WARDROBE)) {
    const id = o && o[slot];
    out[slot] = WARDROBE[slot].some((w) => w.id === id) ? id : DEFAULT_OUTFIT[slot];
  }
  return out;
}

const piece = (slot, id) => WARDROBE[slot].find((w) => w.id === id) || WARDROBE[slot][0];
const cloth = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...extra });
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();

function add(geo, material, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.userData.clothing = true;
  parent.add(m);
  return m;
}

// An open, slightly tapered sleeve (short sleeves and shorts), rolled at the hem.
function openTube(rTop, rBottom, len, material, cuffMat, parent, y = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, len, 16, 1, true);
  g.translate(0, -len / 2 + y, 0);
  const m = add(g, material, parent);
  material.side = THREE.DoubleSide;
  const cuff = add(new THREE.TorusGeometry(rBottom, 0.011, 6, 18), cuffMat, parent, 0, y - len + 0.006, 0);
  cuff.rotation.x = Math.PI / 2;
  return m;
}

// A sleeve or trouser leg: a lathed tube (profile [radius, y] from bottom to
// top, in the upper joint's space) skinned to up to three joints that bend it.
//   joints: [{ group, at: [x, y, z] }] where the bone sits on `group` and
//   `at` is that bone's rest position in the tube's space; weights(y) gives
//   each joint's share at height y. The tube hangs on joints[1].group.
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function skinnedTube(profile, material, joints, weights, open = false) {
  const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 18);
  const p = geo.attributes.position;
  const idx = [];
  const wts = [];
  for (let i = 0; i < p.count; i++) {
    const w = weights(p.getY(i));
    idx.push(0, 1, 2, 0);
    wts.push(w[0], w[1], w[2], 0);
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
  if (open) material.side = THREE.DoubleSide;
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.userData.clothing = true;
  const bones = [];
  const inverses = [];
  for (const j of joints) {
    const bone = new THREE.Bone();
    bone.userData.clothing = true;
    bone.position.set(...(j.offset || [0, 0, 0]));
    j.group.add(bone);
    bones.push(bone);
    inverses.push(new THREE.Matrix4().makeTranslation(-j.at[0], -j.at[1], -j.at[2]));
  }
  joints[1].group.add(mesh);
  mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
  return mesh;
}

// A whole sleeve (shoulder to wrist) on an arm, blending into the shirt at the top.
function sleeve(u, a, material, profile, open = false) {
  const top = [a.side * 0.262, 0.495, 0];
  return skinnedTube(profile, material, [
    { group: u.body, offset: top, at: [0, 0, 0] },
    { group: a.shoulder, at: [0, 0, 0] },
    { group: a.elbow, at: [0, -0.29, 0] },
  ], (y) => {
    const t = smooth(-0.03, 0.07, y) * 0.85;
    const low = smooth(-0.25, -0.33, y);
    return [t, (1 - t) * (1 - low), (1 - t) * low];
  }, open);
}

// A trouser leg, hip to ankle, bending at the knee.
function trouserLeg(l, material, profile) {
  return skinnedTube(profile, material, [
    { group: l.hip, at: [0, 0, 0] },
    { group: l.hip, at: [0, 0, 0] },
    { group: l.knee, at: [0, -0.46, 0] },
  ], (y) => {
    const low = smooth(-0.41, -0.51, y);
    return [0, 1 - low, low];
  });
}

// The torso's own outline (matches rig.js), pushed out by `grow`, with a hem
// that can hang below the waist and flare a little.
function torsoShell(grow, hemY, hemFlare, material) {
  const pts = [[0.17, -0.02], [0.172, 0.06], [0.165, 0.16], [0.18, 0.28], [0.2, 0.4], [0.198, 0.48], [0.17, 0.555], [0.11, 0.61], [0.04, 0.635], [0, 0.638]];
  const prof = [];
  if (hemY < -0.02) prof.push([0.17 + hemFlare, hemY], [0.17 + hemFlare * 0.5, (hemY - 0.02) / 2]);
  for (const [r, y] of pts) prof.push(r === 0 ? [0, y + grow] : [r, y]);
  material.side = THREE.DoubleSide; // the open hem shows its inside from below
  return new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r === 0 ? 0 : r + grow, y)), 28);
}

// A head-hugging shell: part of a sphere around the head (radius 0.12).
function headShell(r, phiStart, phiLength, thetaLength, material, parent, rough = 0) {
  const g = new THREE.SphereGeometry(r, 28, 14, phiStart, phiLength, 0, thetaLength);
  if (rough) {
    // choppy, uneven hair: nudge each vertex in or out a little
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = Math.sin(v.x * 90 + v.y * 40) * Math.cos(v.z * 70 - v.y * 30);
      v.multiplyScalar(1 + n * rough);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
  }
  return add(g, material, parent);
}

// Front of the face is +z. In SphereGeometry, phi = PI/2 points at +z, so a
// band that skips the face runs from PI/2 + gap round the back to PI/2 - gap.
const AROUND_BACK = (gap) => [Math.PI / 2 + gap, Math.PI * 2 - gap * 2];

const BUILD = {
  // ---------- shirts ----------
  field_jacket(u, def, colors) {
    const c = colors.jacket ?? def.color;
    const m = cloth(c);
    const trim = cloth(shade(c, 0.7));
    const scarf = cloth(colors.scarf ?? 0x2f8f8a, { roughness: 0.95 });
    // the hem sits close over the hips rather than flaring out
    const t = add(torsoShell(0.016, -0.075, 0.004, m), m, u.body);
    t.scale.z = 0.74;
    // a zip down the front and two chest pockets with flaps
    add(new THREE.BoxGeometry(0.012, 0.5, 0.01), trim, u.body, 0, 0.17, 0.152).rotation.x = -0.05;
    for (const s of [-1, 1]) {
      add(new RoundedBoxGeometry(0.075, 0.085, 0.022, 2, 0.008), m, u.body, s * 0.085, 0.35, 0.148).rotation.y = s * 0.28;
      add(new RoundedBoxGeometry(0.08, 0.025, 0.026, 2, 0.006), trim, u.body, s * 0.085, 0.395, 0.15).rotation.y = s * 0.28;
    }
    // scarf: a flat collar resting on the shoulders (there is no neck)
    const collar = add(new THREE.TorusGeometry(0.1, 0.032, 8, 24), scarf, u.body, 0, 0.6, 0);
    collar.rotation.x = Math.PI / 2;
    collar.scale.set(1.18, 0.82, 1);
    for (const a of u.base.arms) {
      sleeve(u, a, m, [[0, -0.548], [0.04, -0.546], [0.054, -0.535], [0.058, -0.5], [0.059, -0.42], [0.061, -0.34], [0.064, -0.29], [0.066, -0.22], [0.068, -0.12], [0.071, -0.03], [0.072, 0.0], [0.069, 0.035], [0.056, 0.066], [0.03, 0.084], [0, 0.088]]);
      const cuff = add(new THREE.TorusGeometry(0.054, 0.01, 6, 18), trim, a.elbow, 0, -0.235, 0);
      cuff.rotation.x = Math.PI / 2;
    }
    return { torso: true, caps: true, upper: true, elbow: true, forearm: true };
  },

  work_tee(u, def, colors) {
    const c = colors.jacket ?? def.color;
    const m = cloth(c);
    const trim = cloth(shade(c, 0.78));
    const t = add(torsoShell(0.011, -0.04, 0.008, m), m, u.body);
    t.scale.z = 0.73;
    const neck = add(new THREE.TorusGeometry(0.1, 0.016, 6, 24), trim, u.body, 0, 0.605, 0);
    neck.rotation.x = Math.PI / 2;
    neck.scale.set(1.1, 0.78, 1);
    // a faded round patch on the chest
    const patch = add(new THREE.CircleGeometry(0.045, 20), cloth(0x2f8f8a), u.body, -0.08, 0.37, 0.148);
    patch.rotation.y = -0.3;
    for (const a of u.base.arms) {
      // short sleeve: open at the hem, blending into the shirt at the top
      sleeve(u, a, m.clone(), [[0.072, -0.15], [0.071, -0.1], [0.07, -0.03], [0.071, 0.0], [0.068, 0.035], [0.055, 0.066], [0.03, 0.083], [0, 0.087]], true);
      const cuff = add(new THREE.TorusGeometry(0.072, 0.01, 6, 18), trim, a.shoulder, 0, -0.145, 0);
      cuff.rotation.x = Math.PI / 2;
    }
    return { torso: true, caps: true };
  },

  // ---------- trousers ----------
  cargo_pants(u, def, colors) {
    const c = colors.pants ?? def.color;
    const m = cloth(c);
    const pocket = cloth(shade(c, 0.85));
    const seat = add(new THREE.SphereGeometry(0.172, 22, 14), m, u.body, 0, -0.03, 0);
    seat.scale.set(1.04, 0.78, 0.72);
    for (const l of u.base.legs) {
      trouserLeg(l, m, [[0, -0.885], [0.06, -0.88], [0.074, -0.86], [0.076, -0.76], [0.079, -0.62], [0.082, -0.5], [0.084, -0.45], [0.087, -0.36], [0.091, -0.22], [0.093, -0.08], [0.09, 0.0], [0.07, 0.05], [0.035, 0.07], [0, 0.075]]);
      // a bellows pocket on the outside of each thigh, and a knee patch
      add(new RoundedBoxGeometry(0.045, 0.12, 0.11, 2, 0.012), pocket, l.hip, l.side * 0.088, -0.25, 0.005);
      add(new RoundedBoxGeometry(0.08, 0.075, 0.03, 2, 0.01), pocket, l.knee, 0, -0.02, 0.07);
    }
    return { pelvis: true, thigh: true, knee: true, shin: true };
  },

  utility_shorts(u, def, colors) {
    const c = colors.pants ?? def.color;
    const m = cloth(c);
    const trim = cloth(shade(c, 0.8));
    const seat = add(new THREE.SphereGeometry(0.172, 22, 14), m, u.body, 0, -0.03, 0);
    seat.scale.set(1.04, 0.78, 0.72);
    for (const l of u.base.legs) {
      openTube(0.095, 0.098, 0.3, m.clone(), trim, l.hip, 0.04);
      add(new RoundedBoxGeometry(0.035, 0.09, 0.09, 2, 0.01), trim, l.hip, l.side * 0.1, -0.13, 0.0);
    }
    return { pelvis: true };
  },

  // ---------- hats ----------
  none() {
    return {};
  },

  cap(u, def) {
    const m = cloth(def.color, { roughness: 0.85 });
    const crown = add(new THREE.SphereGeometry(0.133, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.4), m, u.head, 0, 0.012, 0);
    crown.scale.set(1, 0.95, 1.02);
    add(new THREE.SphereGeometry(0.014, 8, 6), m, u.head, 0, 0.138, 0);
    // stiff brim out over the visor
    const brim = add(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 24, 1, false, -Math.PI / 2, Math.PI), m, u.head, 0, 0.05, 0.09);
    brim.scale.set(1.05, 1, 0.95);
    brim.rotation.x = 0.16;
    return { hat: true };
  },

  boonie(u, def) {
    const m = cloth(def.color, { roughness: 0.95, side: THREE.DoubleSide });
    const band = cloth(shade(def.color, 0.65));
    add(new THREE.SphereGeometry(0.134, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.4), m, u.head, 0, 0.02, 0).scale.set(1, 0.9, 1);
    // the soft brim droops all the way round
    const brim = add(new THREE.LatheGeometry([[0.128, 0.064], [0.18, 0.045], [0.22, 0.02], [0.235, 0.004]].map(([r, y]) => new THREE.Vector2(r, y)), 32), m, u.head);
    brim.scale.set(1, 1, 1.05);
    const ring = add(new THREE.TorusGeometry(0.129, 0.012, 6, 28), band, u.head, 0, 0.075, 0);
    ring.rotation.x = Math.PI / 2;
    return { hat: true };
  },

  // ---------- hair ----------
  crop(u, def) {
    const m = cloth(def.color, { roughness: 0.9 });
    headShell(0.127, 0, Math.PI * 2, Math.PI * 0.36, m, u.head, 0.035); // top, a fringe just above the visor
    headShell(0.126, ...AROUND_BACK(1.0), Math.PI * 0.66, m, u.head, 0.03); // sides and back, to the nape
    return {};
  },

  ponytail(u, def) {
    const m = cloth(def.color, { roughness: 0.85 });
    headShell(0.127, 0, Math.PI * 2, Math.PI * 0.36, m, u.head, 0.012); // smooth, pulled back
    headShell(0.126, ...AROUND_BACK(1.0), Math.PI * 0.6, m, u.head, 0.01);
    // the tail swings from the tie as the raider moves (see poseRig)
    const tail = new THREE.Group();
    tail.position.set(0, 0.03, -0.13);
    u.head.add(tail);
    const tie = add(new THREE.TorusGeometry(0.027, 0.009, 6, 14), cloth(0x2f8f8a), tail, 0, -0.025, 0);
    tie.rotation.x = Math.PI / 2;
    const g = new THREE.CapsuleGeometry(0.028, 0.15, 6, 10);
    g.translate(0, -0.1, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 1 - Math.max(0, -p.getY(i) - 0.04) * 2.6; // tapers toward the tip
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    add(g, m, tail);
    tail.userData.clothing = true;
    u.tail = tail;
    return {};
  },
};

// Dress the raider model in an outfit ({shirt, pants, hat, hair}). Safe to call
// again: the old pieces come off first.
export function applyOutfit(model, outfit, colors = {}) {
  const u = model.userData;
  const o = cleanOutfit(outfit);
  const key = `${o.shirt}|${o.pants}|${o.hat}|${o.hair}`;
  if (u.outfitKey === key) return;
  u.outfitKey = key;
  for (const m of u.clothes || []) {
    m.parent.remove(m);
    m.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
  }
  u.tail = null;
  // collect what gets added under each joint, so it can be removed next time
  const before = new Set();
  model.traverse((c) => before.add(c));
  const covers = {};
  for (const slot of ['shirt', 'pants', 'hat', 'hair']) Object.assign(covers, BUILD[o[slot]](u, piece(slot, o[slot]), colors));
  u.clothes = [];
  model.traverse((c) => {
    if (!before.has(c) && c.userData.clothing && !(c.parent && c.parent.userData.clothing)) u.clothes.push(c);
  });
  // hide what's fully covered
  const b = u.base;
  b.torso.visible = !covers.torso;
  b.pelvis.visible = !covers.pelvis;
  for (const a of b.arms) {
    a.cap.visible = !covers.caps;
    a.upper.visible = !covers.upper;
    a.elbowBall.visible = !covers.elbow;
    a.forearm.visible = !covers.forearm;
  }
  for (const l of b.legs) {
    l.thigh.visible = !covers.thigh;
    l.kneeBall.visible = !covers.knee;
    l.shin.visible = !covers.shin;
  }
}
