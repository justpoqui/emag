// Builds the topside map: terrain, ruined town, container yard, pylons, the
// crashed ARC hull, extraction lifts, loot containers and ARC spawn points.
// Static geometry is merged per material to keep draw calls low.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Collision, terrainHeight, MAP_HALF } from './collision.js';
import { makeRng } from './rng.js';

const TOWN = { x: -20, z: -10 };

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.9, metalness: opts.metalness ?? 0.05, ...opts });
}

export function buildWorld(scene, opts = {}) {
  const rng = makeRng(1337);
  const col = new Collision();
  const buckets = new Map(); // material -> geometries[]
  const containers = [];
  const enemySpawns = [];
  const extractions = [];
  const insertions = [];
  const lights = [];
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  const M = {
    concrete: mat(0xb9ae9a),
    concreteDark: mat(0x8f8676),
    plaster: [mat(0xc9a27e), mat(0x8fb3a6), mat(0xd6c08a), mat(0xc27f6b), mat(0xa9b7bf), mat(0xe0d4bd)],
    rust: mat(0x8a4a2a, { roughness: 0.8, metalness: 0.4 }),
    metal: mat(0x6b6f72, { roughness: 0.55, metalness: 0.6 }),
    darkMetal: mat(0x2e3236, { roughness: 0.5, metalness: 0.7 }),
    wood: mat(0x6b5038),
    asphalt: mat(0x3d3b38),
    containerColors: [mat(0xc0582e, { metalness: 0.3 }), mat(0x2f7f86, { metalness: 0.3 }), mat(0x9a8a3a, { metalness: 0.3 }), mat(0x5a6e3a, { metalness: 0.3 }), mat(0x8a2f2a, { metalness: 0.3 })],
    carColors: [mat(0x7fa8a0, { metalness: 0.35, roughness: 0.6 }), mat(0xc98a4a, { metalness: 0.35, roughness: 0.6 }), mat(0xd9cfb0, { metalness: 0.35, roughness: 0.6 }), mat(0x8a3f35, { metalness: 0.35, roughness: 0.6 })],
    glass: mat(0x223238, { roughness: 0.2, metalness: 0.6 }),
    rock: mat(0x7d756a, { flatShading: true }),
    trunk: mat(0x4a3a2a),
    leaves: [mat(0x5f7a35, { flatShading: true }), mat(0x6f8a3a, { flatShading: true }), mat(0x4e6b30, { flatShading: true })],
    ivy: mat(0x4f6e2c, { flatShading: true }),
    arcHull: mat(0x6a7178, { roughness: 0.5, metalness: 0.55 }),
    arcGlow: new THREE.MeshStandardMaterial({ color: 0xff6a20, emissive: 0xff5a10, emissiveIntensity: 2.5 }),
    liftGlow: new THREE.MeshStandardMaterial({ color: 0x40ffd0, emissive: 0x30ffc0, emissiveIntensity: 2 }),
    stripe: mat(0xe8b830),
    tarp: [mat(0xd2672f), mat(0x2f8f8a), mat(0xd8b54a)],
  };

  function pushGeo(material, geo) {
    if (geo.index) geo = geo.toNonIndexed();
    let list = buckets.get(material);
    if (!list) {
      list = [];
      buckets.set(material, list);
    }
    list.push(geo);
  }

  // A static box. rotY rotates the visual; collision uses the rotated AABB.
  function box(material, cx, cy, cz, sx, sy, sz, { rotY = 0, collide = true, tag = 'concrete', rotX = 0, rotZ = 0 } = {}) {
    const geo = unitBox.clone();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(cx, cy, cz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ)),
      new THREE.Vector3(sx, sy, sz),
    );
    geo.applyMatrix4(m);
    pushGeo(material, geo);
    if (collide) {
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      // shrink rotated boxes a little so the AABB isn't too generous
      const shrink = rotY % (Math.PI / 2) !== 0 ? 0.15 : 0;
      col.addBox(
        { x: bb.min.x + shrink, y: bb.min.y, z: bb.min.z + shrink },
        { x: bb.max.x - shrink, y: bb.max.y, z: bb.max.z - shrink },
        tag,
      );
    }
    return geo;
  }

  function geoAt(material, geo, x, y, z, rotY = 0, scale = 1) {
    const g = geo.clone();
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), new THREE.Vector3(scale, scale, scale)));
    pushGeo(material, g);
  }

  const ground = (x, z) => terrainHeight(x, z);

  function addContainer(type, x, y, z, rotY = 0) {
    containers.push({ type, x, y, z, rotY });
  }

  // ---------- terrain ----------
  {
    const size = MAP_HALF * 2 + 60;
    const seg = 220;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const grass = new THREE.Color(0x6f7d3e);
    const dry = new THREE.Color(0xa59466);
    const dirt = new THREE.Color(0x7e6a4c);
    const road = new THREE.Color(0x4a4742);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      const n = Math.sin(x * 0.07) * Math.cos(z * 0.05) * 0.5 + 0.5;
      c.copy(grass).lerp(dry, n * 0.8);
      if (h > 6) c.lerp(dirt, Math.min(1, (h - 6) / 10));
      const roadX = Math.abs(z - TOWN.z) < 5 && Math.abs(x - TOWN.x) < 170;
      const roadZ = Math.abs(x - TOWN.x) < 5 && Math.abs(z - TOWN.z) < 170;
      if (roadX || roadZ) c.copy(road).lerp(dirt, hash2(x, z) * 0.25);
      else c.lerp(dirt, hash2(x * 3, z * 3) * 0.2);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---------- ruined buildings ----------
  function building(cx, cz, w, d, floors, opts = {}) {
    const base = Math.min(ground(cx - w / 2, cz - d / 2), ground(cx + w / 2, cz + d / 2), ground(cx, cz)) - 0.2;
    const fh = 3.4;
    const t = 0.3;
    const paint = rng.pick(M.plaster);
    const ruin = opts.ruin ?? 0.18;
    // foundation
    box(M.concreteDark, cx, base + 0.15, cz, w + 0.4, 0.5, d + 0.4);
    const top = base + 0.4;
    for (let f = 0; f < floors; f++) {
      const y0 = top + f * fh;
      const collapse = f === floors - 1 && floors > 1 ? 0.35 : 0;
      // floor slab (upper floors) with a stair hole in one corner
      if (f > 0) {
        const holeW = 2.6;
        // slab split into two pieces leaving the stair hole at -x,-z corner
        box(M.concrete, cx + holeW / 2, y0 - 0.15, cz, w - holeW, 0.3, d);
        box(M.concrete, cx - w / 2 + holeW / 2, y0 - 0.15, cz + 2.6 / 2, holeW, 0.3, d - 2.6);
      }
      // walls: four sides, split into 2m segments
      const sides = [
        { ax: 'x', len: w, fixed: cz - d / 2, out: -1 },
        { ax: 'x', len: w, fixed: cz + d / 2, out: 1 },
        { ax: 'z', len: d, fixed: cx - w / 2, out: -1 },
        { ax: 'z', len: d, fixed: cx + w / 2, out: 1 },
      ];
      sides.forEach((side, si) => {
        const segs = Math.max(1, Math.round(side.len / 2));
        const segLen = side.len / segs;
        const doorAt = f === 0 ? Math.floor(rng.next() * segs) : -1;
        const door2 = f === 0 && si < 2 ? Math.floor(rng.next() * segs) : -1;
        for (let s = 0; s < segs; s++) {
          const along = -side.len / 2 + segLen * (s + 0.5);
          const px = side.ax === 'x' ? cx + along : side.fixed;
          const pz = side.ax === 'x' ? side.fixed : cz + along;
          const sx = side.ax === 'x' ? segLen : t;
          const sz = side.ax === 'x' ? t : segLen;
          const roll = rng.next();
          if (roll < ruin + collapse) {
            // broken stub
            const hh = rng.range(0.3, 1.4);
            box(paint, px, y0 + hh / 2, pz, sx, hh, sz);
            continue;
          }
          if (s === doorAt || s === door2) {
            box(paint, px, y0 + 2.6 + (fh - 2.6) / 2, pz, sx, fh - 2.6, sz);
            continue;
          }
          if (roll < 0.62) {
            // window: sill + lintel
            box(paint, px, y0 + 0.5, pz, sx, 1.0, sz);
            box(paint, px, y0 + 2.4 + (fh - 2.4) / 2, pz, sx, fh - 2.4, sz);
            if (rng.chance(0.3)) box(M.glass, px, y0 + 1.7, pz, sx * 0.9, 1.4, sz * 0.3, { collide: false });
          } else {
            box(paint, px, y0 + fh / 2, pz, sx, fh, sz);
          }
        }
      });
      // stairs to the next floor in the -x,-z corner
      if (f < floors - 1) {
        const steps = 12;
        const stepH = fh / steps;
        for (let i = 0; i < steps; i++) {
          const sx0 = cx - w / 2 + 0.3 + 1.1;
          const sz0 = cz - d / 2 + 0.3 + 0.12 + i * (2.2 / steps);
          box(M.concreteDark, sx0, y0 + stepH * (i + 0.5), sz0 + 0.1, 2.0, stepH, 2.2 / steps + 0.05);
        }
      }
      // loot inside
      if (rng.chance(0.75)) {
        const lx = cx + rng.range(-w / 2 + 2, w / 2 - 1.2);
        const lz = cz + rng.range(-d / 2 + 3, d / 2 - 1.2);
        addContainer(rng.pick(['crate', 'crate', 'locker', 'medical', 'locker', 'weapon_case']), lx, y0, lz, rng.pick([0, Math.PI / 2]));
      }
      if (w * d > 120 && rng.chance(0.5)) {
        addContainer(rng.pick(['crate', 'locker']), cx + rng.range(-w / 2 + 2, w / 2 - 1.2), y0, cz + rng.range(-d / 2 + 3, d / 2 - 1.2));
      }
    }
    // roof
    const roofY = top + floors * fh;
    if (rng.chance(0.6)) {
      box(M.concrete, cx + 1.3, roofY - 0.15, cz, w - 2.6, 0.3, d);
      // parapet rubble on top
      if (rng.chance(0.5)) box(M.concreteDark, cx + rng.range(-w / 3, w / 3), roofY + 0.4, cz + rng.range(-d / 3, d / 3), rng.range(1, 2.5), 0.8, rng.range(1, 2.5));
    }
    // ivy hanging off a wall
    if (rng.chance(0.55)) {
      const side = rng.pick([-1, 1]);
      const ivyH = rng.range(2, floors * fh * 0.9);
      box(M.ivy, cx + rng.range(-w / 3, w / 3), top + ivyH / 2, cz + side * (d / 2 + 0.2), rng.range(1.5, 3.5), ivyH, 0.25, { collide: false });
    }
    // rubble outside
    for (let i = 0; i < 3; i++) {
      const rx = cx + rng.range(-w / 2 - 2, w / 2 + 2);
      const rz = cz + (rng.chance(0.5) ? -1 : 1) * (d / 2 + rng.range(0.6, 2));
      const s = rng.range(0.4, 1.0);
      box(M.concreteDark, rx, ground(rx, rz) + s / 2, rz, s * 1.5, s, s, { rotY: rng.range(0, 3), collide: s > 0.7 });
    }
  }

  // Town blocks along the two roads
  const lots = [];
  for (let bx = -6; bx <= 6; bx++) {
    for (let bz = -6; bz <= 6; bz++) {
      if (bx === 0 || bz === 0) continue; // roads
      const x = TOWN.x + bx * 16 + (bx > 0 ? -4 : 4);
      const z = TOWN.z + bz * 16 + (bz > 0 ? -4 : 4);
      const dist = Math.hypot(bx, bz);
      if (dist > 6.2) continue;
      if (rng.chance(0.18 + dist * 0.05)) continue;
      lots.push({ x, z, dist });
    }
  }
  const plaza = { x: TOWN.x + 32, z: TOWN.z + 32 };
  for (const lot of lots) {
    if (Math.hypot(lot.x - plaza.x, lot.z - plaza.z) < 20) continue; // keep the Bastion plaza open
    const w = rng.int(8, 12);
    const d = rng.int(8, 12);
    const floors = Math.max(1, Math.round(rng.range(1, 4.2) - lot.dist * 0.35));
    building(lot.x + rng.range(-1, 1), lot.z + rng.range(-1, 1), w, d, floors);
  }

  // Bastion plaza: a fountain ring and broken statues
  {
    const g = ground(plaza.x, plaza.z);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      box(M.concreteDark, plaza.x + Math.cos(a) * 6, g + 0.45, plaza.z + Math.sin(a) * 6, 3.3, 0.9, 0.6, { rotY: -a + Math.PI / 2 });
    }
    box(M.concrete, plaza.x, g + 1.4, plaza.z, 1.2, 2.8, 1.2);
    box(M.metal, plaza.x, g + 3.2, plaza.z, 0.6, 1.2, 0.6, { collide: false });
    enemySpawns.push({ type: 'bastion', x: plaza.x, z: plaza.z + 10, radius: 20 });
    addContainer('weapon_case', plaza.x + 2, g, plaza.z - 2);
    addContainer('arc_probe', plaza.x - 3, g, plaza.z + 3);
  }

  // ---------- road props: cars, barriers, lamp posts ----------
  function car(x, z, rotY) {
    const g = ground(x, z);
    const paint = rng.pick(M.carColors);
    box(paint, x, g + 0.75, z, 1.9, 0.8, 4.2, { rotY, tag: 'metal' });
    // cabin (offset along the car's length)
    const off = -0.3;
    box(paint, x + Math.sin(rotY) * off, g + 1.45, z + Math.cos(rotY) * off, 1.7, 0.6, 2.2, { rotY, tag: 'metal' });
    box(M.glass, x + Math.sin(rotY) * off, g + 1.46, z + Math.cos(rotY) * off, 1.75, 0.45, 2.0, { rotY, collide: false });
    for (const [wx, wz] of [[-0.9, 1.3], [0.9, 1.3], [-0.9, -1.3], [0.9, -1.3]]) {
      const c = Math.cos(rotY);
      const s = Math.sin(rotY);
      box(M.darkMetal, x + wx * c + wz * s, g + 0.35, z - wx * s + wz * c, 0.3, 0.7, 0.7, { rotY, collide: false });
    }
    if (rng.chance(0.55)) addContainer('car', x - Math.sin(rotY) * 2.4, g, z - Math.cos(rotY) * 2.4, rotY);
  }
  for (let i = 0; i < 26; i++) {
    const alongX = rng.chance(0.5);
    const t = rng.range(-150, 150);
    const lane = rng.range(-3.2, 3.2);
    const x = alongX ? TOWN.x + t : TOWN.x + lane;
    const z = alongX ? TOWN.z + lane : TOWN.z + t;
    if (Math.abs(x - TOWN.x) < 8 && Math.abs(z - TOWN.z) < 8) continue;
    const rot = (alongX ? Math.PI / 2 : 0) + rng.range(-0.5, 0.5);
    car(x, z, rot);
  }
  // overturned bus at the crossroads
  {
    const x = TOWN.x + 9;
    const z = TOWN.z - 3;
    const g = ground(x, z);
    box(M.tarp[2], x, g + 1.3, z, 10, 2.6, 2.6, { tag: 'metal' });
    box(M.glass, x, g + 1.7, z + 1.31, 9.5, 0.9, 0.05, { collide: false });
    box(M.darkMetal, x, g + 2.65, z, 10, 0.1, 2.6, { collide: false });
  }
  // jersey barriers
  for (let i = 0; i < 30; i++) {
    const x = TOWN.x + rng.range(-120, 120);
    const z = TOWN.z + rng.range(-120, 120);
    const onRoad = Math.abs(z - TOWN.z) < 6 || Math.abs(x - TOWN.x) < 6;
    if (!onRoad) continue;
    const rot = rng.pick([0, Math.PI / 2]) + rng.range(-0.2, 0.2);
    box(M.concrete, x, ground(x, z) + 0.5, z, 0.7, 1.0, 3.0, { rotY: rot });
    box(M.stripe, x, ground(x, z) + 0.75, z, 0.72, 0.15, 3.02, { rotY: rot, collide: false });
  }
  // street lamps
  for (let t = -140; t <= 140; t += 22) {
    for (const [x, z] of [[TOWN.x + t, TOWN.z + 5.6], [TOWN.x - 5.6, TOWN.z + t]]) {
      if (Math.abs(t) < 8) continue;
      const g = ground(x, z);
      box(M.darkMetal, x, g + 2.5, z, 0.18, 5, 0.18);
      box(M.darkMetal, x, g + 5, z, 0.9, 0.12, 0.25, { collide: false, rotZ: rng.range(-0.3, 0.3) });
    }
  }

  // ---------- shipping-container yard (east) ----------
  const yard = { x: 110, z: -60 };
  for (let row = 0; row < 5; row++) {
    for (let colI = 0; colI < 4; colI++) {
      if (rng.chance(0.2)) continue;
      const x = yard.x + colI * 9 + rng.range(-0.5, 0.5);
      const z = yard.z + row * 7;
      const g = ground(x, z);
      const stack = rng.int(1, 3);
      for (let s = 0; s < stack; s++) {
        const m = rng.pick(M.containerColors);
        const rot = rng.range(-0.06, 0.06);
        box(m, x + rng.range(-0.3, 0.3), g + 1.3 + s * 2.6, z, 6, 2.6, 2.5, { rotY: rot, tag: 'metal' });
      }
      if (rng.chance(0.35)) addContainer(rng.pick(['crate', 'weapon_case', 'arc_probe']), x, g, z + 2.2);
    }
  }
  enemySpawns.push({ type: 'leaper', x: yard.x + 14, z: yard.z + 15, radius: 22 });
  enemySpawns.push({ type: 'tick', x: yard.x + 10, z: yard.z - 8, radius: 14, count: 4 });
  // gantry crane
  {
    const g = ground(yard.x + 14, yard.z + 14);
    for (const dx of [-16, 30]) {
      box(M.stripe, yard.x + dx, g + 9, yard.z - 4, 1, 18, 1, { tag: 'metal' });
      box(M.stripe, yard.x + dx, g + 9, yard.z + 32, 1, 18, 1, { tag: 'metal' });
    }
    box(M.stripe, yard.x + 7, g + 18, yard.z - 4, 47, 1.2, 1.2, { tag: 'metal' });
    box(M.stripe, yard.x + 7, g + 18, yard.z + 32, 47, 1.2, 1.2, { tag: 'metal' });
    box(M.rust, yard.x + 10, g + 17, yard.z + 14, 4, 2, 37, { tag: 'metal' });
  }

  // ---------- gas station (south west) ----------
  {
    const x = -120;
    const z = 70;
    const g = ground(x, z);
    box(M.concreteDark, x, g + 0.1, z, 26, 0.3, 18);
    for (const [px, pz] of [[-8, -5], [8, -5], [-8, 5], [8, 5]]) box(M.metal, x + px, g + 2.8, z + pz, 0.5, 5.4, 0.5, { tag: 'metal' });
    box(M.tarp[0], x, g + 5.6, z, 20, 0.6, 13, { tag: 'metal' });
    for (const px of [-4, 4]) {
      box(M.metal, x + px, g + 1, z, 1, 2, 0.8, { tag: 'metal' });
      box(M.stripe, x + px, g + 1.6, z + 0.41, 0.8, 0.3, 0.02, { collide: false });
    }
    building(x, z + 16, 12, 8, 1, { ruin: 0.1 });
    addContainer('medical', x + 3, g + 0.25, z - 2);
    addContainer('crate', x - 6, g + 0.25, z + 3);
    enemySpawns.push({ type: 'pop', x, z, radius: 18, count: 3 });
  }

  // ---------- farmhouse + fields (north west) ----------
  {
    const x = -130;
    const z = -110;
    building(x, z, 12, 10, 2, { ruin: 0.12 });
    building(x + 22, z + 4, 9, 14, 1, { ruin: 0.3 });
    for (let i = 0; i < 18; i++) {
      const fx = x - 20 + i * 3;
      const fz = z + 22;
      box(M.wood, fx, ground(fx, fz) + 0.6, fz, 0.15, 1.2, 0.15);
      if (i % 2 === 0) box(M.wood, fx + 1.5, ground(fx, fz) + 0.9, fz, 3, 0.1, 0.08, { collide: false });
    }
    // hay bales
    for (let i = 0; i < 6; i++) {
      const hx = x + rng.range(-20, 20);
      const hz = z + rng.range(26, 40);
      box(M.tarp[2], hx, ground(hx, hz) + 0.6, hz, 1.6, 1.2, 1.2, { rotY: rng.range(0, 3) });
    }
    enemySpawns.push({ type: 'snitch', x: x + 10, z: z + 30, radius: 30 });
    enemySpawns.push({ type: 'tick', x: x + 5, z: z + 5, radius: 15, count: 3 });
  }

  // ---------- crashed ARC hull (north) ----------
  {
    const hx = 40;
    const hz = -150;
    const g = ground(hx, hz);
    const ring = new THREE.TorusGeometry(16, 3.2, 10, 28);
    const ringG = ring.clone();
    ringG.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.4, 0.6, 0.15)));
    ringG.translate(hx, g + 8, hz);
    pushGeo(M.arcHull, ringG);
    // approximate collision with boxes around the ring's lower half
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const p = new THREE.Vector3(Math.cos(a) * 16, Math.sin(a) * 16, 0).applyEuler(new THREE.Euler(0.4, 0.6, 0.15));
      const y = g + 8 + p.y;
      if (y > g + 10) continue;
      col.addBox({ x: hx + p.x - 2.6, y: Math.max(g - 2, y - 2.6), z: hz + p.z - 2.6 }, { x: hx + p.x + 2.6, y: y + 2.6, z: hz + p.z + 2.6 }, 'metal');
    }
    // hull spine
    box(M.arcHull, hx - 20, g + 2, hz + 12, 6, 5, 26, { rotY: 0.6, rotZ: 0.2, tag: 'metal' });
    box(M.arcHull, hx + 18, g + 1.5, hz - 14, 5, 4, 18, { rotY: -0.4, tag: 'metal' });
    for (let i = 0; i < 6; i++) {
      const vx = hx + rng.range(-22, 22);
      const vz = hz + rng.range(-16, 16);
      box(M.arcGlow, vx, ground(vx, vz) + 0.5, vz, 0.6, 1, 0.6, { collide: false });
    }
    const glow = new THREE.PointLight(0xff6a20, 40, 40, 2);
    glow.position.set(hx, g + 4, hz);
    scene.add(glow);
    lights.push(glow);
    for (let i = 0; i < 4; i++) addContainer('arc_probe', hx + rng.range(-14, 14), 0, hz + rng.range(-10, 10));
    enemySpawns.push({ type: 'wasp', x: hx, z: hz + 20, radius: 25, count: 2 });
    enemySpawns.push({ type: 'tick', x: hx - 10, z: hz + 8, radius: 15, count: 3 });
  }

  // ---------- power pylons with cables ----------
  const pylonPts = [];
  for (let i = 0; i < 7; i++) {
    const x = -200 + i * 62;
    const z = 150 + Math.sin(i) * 12;
    const g = ground(x, z);
    pylonPts.push(new THREE.Vector3(x, g + 22, z));
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      box(M.darkMetal, x + dx * 0.6, g + 11, z + dz * 0.6, 0.3, 22, 0.3, { rotX: dz * -0.04, rotZ: dx * 0.04, tag: 'metal' });
    }
    box(M.darkMetal, x, g + 22, z, 7, 0.4, 0.4, { collide: false });
    box(M.darkMetal, x, g + 17, z, 5, 0.3, 0.3, { collide: false });
    for (let k = 0; k < 5; k++) box(M.darkMetal, x, g + 3 + k * 4, z, 2.6 - k * 0.3, 0.2, 2.6 - k * 0.3, { collide: false });
  }
  {
    const cableMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a });
    for (let i = 0; i < pylonPts.length - 1; i++) {
      for (const off of [-3.2, 3.2]) {
        const a = pylonPts[i].clone().add(new THREE.Vector3(off, 0, 0));
        const b = pylonPts[i + 1].clone().add(new THREE.Vector3(off, 0, 0));
        const pts = [];
        for (let k = 0; k <= 16; k++) {
          const t = k / 16;
          const p = a.clone().lerp(b, t);
          p.y -= Math.sin(t * Math.PI) * 5;
          pts.push(p);
        }
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cableMat));
      }
    }
  }

  // ---------- radio tower (south east hill) ----------
  {
    const x = 150;
    const z = 120;
    const g = ground(x, z);
    box(M.rust, x, g + 18, z, 0.8, 36, 0.8, { tag: 'metal' });
    for (let k = 0; k < 8; k++) box(M.rust, x, g + 2 + k * 4.5, z, 3, 0.2, 3, { collide: false });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
    beacon.position.set(x, g + 36.5, z);
    scene.add(beacon);
    building(x + 10, z - 6, 8, 8, 1, { ruin: 0.05 });
    addContainer('weapon_case', x + 10, g, z - 6);
    enemySpawns.push({ type: 'wasp', x, z, radius: 30, count: 2 });
    enemySpawns.push({ type: 'snitch', x: x - 30, z: z - 20, radius: 30 });
  }

  // ---------- scattered ARC probes and camps ----------
  for (let i = 0; i < 10; i++) {
    const x = rng.range(-190, 190);
    const z = rng.range(-190, 190);
    if (Math.hypot(x - TOWN.x, z - TOWN.z) < 90) continue;
    const g = ground(x, z);
    // probe pod half-buried
    box(M.arcHull, x, g + 0.5, z, 1.4, 1.4, 2.2, { rotY: rng.range(0, 3), rotX: 0.3, tag: 'metal' });
    box(M.arcGlow, x, g + 1.3, z, 0.25, 0.25, 0.25, { collide: false });
    addContainer('arc_probe', x + 1.6, g, z);
    if (rng.chance(0.6)) enemySpawns.push({ type: rng.pick(['tick', 'pop', 'wasp']), x, z, radius: 16, count: rng.int(1, 3) });
  }
  // raider camps with tarps
  for (let i = 0; i < 6; i++) {
    const x = rng.range(-180, 180);
    const z = rng.range(-180, 180);
    if (Math.hypot(x - TOWN.x, z - TOWN.z) < 100) continue;
    const g = ground(x, z);
    const tarp = rng.pick(M.tarp);
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) box(M.wood, x + dx, g + 1.2, z + dz, 0.15, 2.4, 0.15);
    box(tarp, x, g + 2.5, z, 4.6, 0.08, 4.6, { rotZ: 0.12, collide: false });
    addContainer(rng.pick(['crate', 'medical', 'locker']), x, g, z);
  }

  // ---------- rocks and trees ----------
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  for (let i = 0; i < 120; i++) {
    const x = rng.range(-MAP_HALF + 10, MAP_HALF - 10);
    const z = rng.range(-MAP_HALF + 10, MAP_HALF - 10);
    if (Math.hypot(x - TOWN.x, z - TOWN.z) < 105) continue;
    const s = rng.range(0.8, 3.5);
    const g = ground(x, z);
    geoAt(M.rock, rockGeo, x, g + s * 0.3, z, rng.range(0, 6), s);
    if (s > 1.2) col.addBox({ x: x - s * 0.7, y: g - 1, z: z - s * 0.7 }, { x: x + s * 0.7, y: g + s * 1.0, z: z + s * 0.7 }, 'rock');
  }
  const coneGeo = new THREE.ConeGeometry(1, 1, 7);
  const blobGeo = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < 260; i++) {
    const x = rng.range(-MAP_HALF + 5, MAP_HALF - 5);
    const z = rng.range(-MAP_HALF + 5, MAP_HALF - 5);
    const inTown = Math.abs(x - TOWN.x) < 110 && Math.abs(z - TOWN.z) < 110;
    if (inTown && rng.chance(0.8)) continue;
    if (Math.abs(z - TOWN.z) < 7 || Math.abs(x - TOWN.x) < 7) continue;
    const g = ground(x, z);
    const h = rng.range(5, 11);
    box(M.trunk, x, g + h * 0.3, z, 0.4, h * 0.6, 0.4, { tag: 'wood' });
    const leaves = rng.pick(M.leaves);
    if (rng.chance(0.5)) {
      const c = coneGeo.clone();
      c.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, g + h * 0.65, z), new THREE.Quaternion(), new THREE.Vector3(h * 0.32, h * 0.8, h * 0.32)));
      pushGeo(leaves, c);
    } else {
      geoAt(leaves, blobGeo, x, g + h * 0.7, z, rng.range(0, 6), h * 0.32);
      geoAt(leaves, blobGeo, x + 0.8, g + h * 0.55, z + 0.5, rng.range(0, 6), h * 0.22);
    }
  }

  // ---------- extraction lifts ----------
  const liftSpots = [
    { name: 'North Lift', x: -40, z: -195 },
    { name: 'East Lift', x: 195, z: 20 },
    { name: 'South Lift', x: 30, z: 195 },
    { name: 'West Lift', x: -195, z: -20 },
  ];
  for (const spot of liftSpots) {
    const g = ground(spot.x, spot.z);
    const pad = g + 0.2;
    box(M.concreteDark, spot.x, g - 0.3, spot.z, 9, 1.1, 9);
    // cabin frame: three walls + roof, open on the side facing the map centre
    const toCentre = Math.atan2(-spot.x, -spot.z);
    const c = Math.cos(toCentre);
    const s = Math.sin(toCentre);
    const local = (lx, lz) => [spot.x + lx * c + lz * s, spot.z - lx * s + lz * c];
    const wall = (lx, lz, sx, sz) => {
      const [wx, wz] = local(lx, lz);
      box(M.metal, wx, pad + 2, wz, sx, 4, sz, { rotY: toCentre, tag: 'metal' });
    };
    wall(-2.1, 0, 0.3, 4.2);
    wall(2.1, 0, 0.3, 4.2);
    wall(0, -2.1, 4.5, 0.3);
    box(M.darkMetal, spot.x, pad + 4.15, spot.z, 4.6, 0.3, 4.6, { tag: 'metal' });
    box(M.stripe, spot.x, pad + 0.03, spot.z, 3.6, 0.06, 3.6, { collide: false });
    const [ax, az] = local(-2.1, -2.1);
    box(M.darkMetal, ax, pad + 7, az, 0.2, 6, 0.2, { collide: false });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 10), M.liftGlow);
    lamp.position.set(ax, pad + 10.2, az);
    scene.add(lamp);
    const [px, pz] = local(1.4, 3.2);
    // call panel
    box(M.darkMetal, px, pad + 0.6, pz, 0.6, 1.2, 0.4, { rotY: toCentre, tag: 'metal' });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.05), M.liftGlow);
    panel.position.set(px, pad + 1.1, pz);
    panel.rotation.y = toCentre;
    scene.add(panel);
    // doors (animated by the raid)
    const doorMat = mat(0x9a9c94, { metalness: 0.6, roughness: 0.5 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.9, 0.2), doorMat);
    const [dx, dz] = local(0, 2.1);
    door.position.set(dx, pad + 1.95, dz);
    door.rotation.y = toCentre;
    door.castShadow = true;
    scene.add(door);
    const doorBox = col.addBox({ x: dx - 2.2, y: pad, z: dz - 2.2 }, { x: dx + 2.2, y: pad + 3.9, z: dz + 2.2 }, 'metal');
    // the AABB of a rotated door is large; restrict to a thin slab along the facing
    const nx = Math.abs(s) > Math.abs(c);
    if (nx) {
      doorBox.min.x = dx - 0.2; doorBox.max.x = dx + 0.2;
    } else {
      doorBox.min.z = dz - 0.2; doorBox.max.z = dz + 0.2;
    }
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 120, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x40ffd0, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    beam.position.set(spot.x, pad + 60, spot.z);
    scene.add(beam);
    extractions.push({
      ...spot, y: pad, panel: { x: px, y: pad + 1.1, z: pz }, door, doorBox, doorBase: door.position.clone(),
      beam, lamp, state: 'idle', timer: 0,
    });
  }

  // ---------- insertion points ----------
  for (const [x, z] of [[-170, 150], [170, -170], [-160, -170], [175, 175], [-200, 60], [80, 200]]) {
    insertions.push({ x, z });
  }

  // ---------- town ARC presence ----------
  enemySpawns.push({ type: 'tick', x: TOWN.x - 30, z: TOWN.z + 30, radius: 20, count: 3 });
  enemySpawns.push({ type: 'pop', x: TOWN.x + 40, z: TOWN.z - 30, radius: 20, count: 2 });
  enemySpawns.push({ type: 'wasp', x: TOWN.x - 40, z: TOWN.z - 40, radius: 25, count: 2 });
  enemySpawns.push({ type: 'snitch', x: TOWN.x, z: TOWN.z, radius: 50 });
  enemySpawns.push({ type: 'wasp', x: TOWN.x + 60, z: TOWN.z + 60, radius: 25, count: 1 });
  enemySpawns.push({ type: 'tick', x: TOWN.x + 50, z: TOWN.z - 70, radius: 20, count: 3 });

  // invisible walls at the map border
  const W = MAP_HALF;
  col.addBox({ x: -W - 5, y: -50, z: -W - 5 }, { x: W + 5, y: 200, z: -W }, 'wall');
  col.addBox({ x: -W - 5, y: -50, z: W }, { x: W + 5, y: 200, z: W + 5 }, 'wall');
  col.addBox({ x: -W - 5, y: -50, z: -W }, { x: -W, y: 200, z: W }, 'wall');
  col.addBox({ x: W, y: -50, z: -W }, { x: W + 5, y: 200, z: W }, 'wall');

  // ---------- merge static geometry ----------
  for (const [material, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = material !== M.glass && material !== M.ivy;
    mesh.receiveShadow = true;
    scene.add(mesh);
    for (const g of geos) g.dispose();
  }

  // ---------- grass tufts (instanced, no collision) ----------
  {
    const tuft = new THREE.ConeGeometry(0.07, 0.45, 3);
    tuft.translate(0, 0.22, 0);
    const count = opts.grass ?? 9000;
    const grassMesh = new THREE.InstancedMesh(tuft, new THREE.MeshStandardMaterial({ color: 0x8a9147, roughness: 1 }), count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    let n = 0;
    for (let i = 0; i < count * 2 && n < count; i++) {
      const x = rng.range(-MAP_HALF, MAP_HALF);
      const z = rng.range(-MAP_HALF, MAP_HALF);
      if (Math.abs(z - TOWN.z) < 5.5 || Math.abs(x - TOWN.x) < 5.5) continue;
      const s = rng.range(0.5, 1.1);
      q.setFromEuler(new THREE.Euler(rng.range(-0.3, 0.3), rng.range(0, 6), rng.range(-0.3, 0.3)));
      m.compose(new THREE.Vector3(x, ground(x, z) - 0.05, z), q, new THREE.Vector3(s, s * rng.range(0.7, 1.4), s));
      grassMesh.setMatrixAt(n, m);
      grassMesh.setColorAt(n, color.setHSL(0.16 + rng.range(-0.04, 0.05), 0.38, rng.range(0.36, 0.5)));
      n++;
    }
    grassMesh.count = n;
    scene.add(grassMesh);
  }

  // distant mountains for a horizon silhouette
  {
    const mountainMat = new THREE.MeshBasicMaterial({ color: 0x9b8f86, fog: true });
    const mGeo = new THREE.ConeGeometry(1, 1, 5);
    const geos = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + rng.range(-0.05, 0.05);
      const r = rng.range(420, 560);
      const h = rng.range(60, 160);
      const g = mGeo.clone();
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, h / 2 - 10, Math.sin(a) * r), new THREE.Quaternion(), new THREE.Vector3(rng.range(80, 160), h, rng.range(80, 160))));
      geos.push(g);
    }
    scene.add(new THREE.Mesh(mergeGeometries(geos), mountainMat));
  }

  // fix container heights: anything placed at y=0 sits on the ground / floor below
  for (const c of containers) {
    if (!c.y) c.y = col.groundHeight(c.x, c.z, 100, 0.3, 0);
  }

  return { collision: col, containers, enemySpawns, extractions, insertions, lights, town: TOWN };
}

function hash2(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
