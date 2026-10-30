// Builds the topside map: terrain, ruined town, container yard, pylons, the
// crashed Husk hull, extraction lifts, loot containers and Husk spawn points.
// Static geometry is merged per material to keep draw calls low.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Collision, terrainHeight, MAP_HALF } from './collision.js';
import { makeRng } from './rng.js';
import { GrassField, addWind } from './foliage.js';

const TOWN = { x: -20, z: -10 };
// the oil refinery in the south east, with a lift in the middle of it
const REFINERY = { x: 165, z: 75 };
// Crucible Works: the robots' factory, walled, south of the West Lift
const FACTORY = { x: -150, z: 95 };

// ---------- weathering ----------
// Small deterministic noise for textures and shape jitter.
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise3(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
// Push every vertex in or out by smooth noise of its position (shared corners
// move together, so the shape stays closed). Gives rocks and foliage an organic shape.
function displace(geo, amount, freq, seed = 0) {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise3(v.x * freq + seed, v.y * freq + seed * 1.7, v.z * freq - seed) - 0.5;
    const len = v.length() || 1;
    v.multiplyScalar(1 + (n * amount) / len);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}
function canvasTexture(size, paint, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.repeat.set(repeat, repeat);
  return t;
}
// Weathering for walls, metal and paint: rain streaks running down, stains,
// chipped patches and hairline cracks. Near-white, so it tints any colour.
function weatherTexture() {
  let seed = 3;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return canvasTexture(256, (g, n) => {
    g.fillStyle = '#f2eee7';
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 160; i++) {
      g.fillStyle = r() < 0.6 ? `rgba(40,30,20,${0.02 + r() * 0.04})` : `rgba(255,255,255,${0.03 + r() * 0.05})`;
      const x = r() * n;
      const y = r() * n;
      const rad = 3 + r() * 22;
      g.beginPath();
      g.ellipse(x, y, rad, rad * (0.5 + r() * 0.6), r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    // rain streaks
    for (let i = 0; i < 40; i++) {
      const x = r() * n;
      const y = r() * n;
      const len = 30 + r() * 120;
      const grad = g.createLinearGradient(0, y, 0, y + len);
      grad.addColorStop(0, `rgba(50,38,28,${0.05 + r() * 0.09})`);
      grad.addColorStop(1, 'rgba(50,38,28,0)');
      g.fillStyle = grad;
      g.fillRect(x, y, 1 + r() * 3, len);
      if (y + len > n) g.fillRect(x, y - n, 1 + r() * 3, len); // wrap
    }
    // cracks
    g.strokeStyle = 'rgba(30,24,18,0.3)';
    for (let i = 0; i < 6; i++) {
      g.lineWidth = 0.8 + r();
      g.beginPath();
      let x = r() * n;
      let y = r() * n;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) g.lineTo((x += (r() - 0.5) * 34), (y += (r() - 0.3) * 26));
      g.stroke();
    }
  });
}
// Fine speckle for the ground (multiplied over the terrain's vertex colours).
function groundTexture() {
  let seed = 11;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return canvasTexture(128, (g, n) => {
    g.fillStyle = '#f0ece2';
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = r() < 0.55 ? `rgba(60,48,30,${r() * 0.1})` : `rgba(255,250,230,${r() * 0.08})`;
      const s = 1 + r() * 3;
      g.fillRect(r() * n, r() * n, s, s);
    }
  }, 150);
}

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
    // weathered, washed-out tones: a town the Network has been running for years
    concrete: mat(0xa8a397),
    concreteDark: mat(0x7f7a70),
    plaster: [mat(0xa8977f), mat(0x7f8e8a), mat(0xb3a586), mat(0x9a7b6d), mat(0x8d969b), mat(0xc4bcaa)],
    rust: mat(0x8a4a2a, { roughness: 0.8, metalness: 0.4 }),
    metal: mat(0x6b6f72, { roughness: 0.55, metalness: 0.6 }),
    darkMetal: mat(0x2e3236, { roughness: 0.5, metalness: 0.7 }),
    wood: mat(0x6b5038),
    asphalt: mat(0x3d3b38),
    containerColors: [mat(0xc0582e, { metalness: 0.3 }), mat(0x2f7f86, { metalness: 0.3 }), mat(0x9a8a3a, { metalness: 0.3 }), mat(0x5a6e3a, { metalness: 0.3 }), mat(0x8a2f2a, { metalness: 0.3 })],
    carColors: [mat(0x7fa8a0, { metalness: 0.35, roughness: 0.6 }), mat(0xc98a4a, { metalness: 0.35, roughness: 0.6 }), mat(0xd9cfb0, { metalness: 0.35, roughness: 0.6 }), mat(0x8a3f35, { metalness: 0.35, roughness: 0.6 })],
    glass: mat(0x223238, { roughness: 0.2, metalness: 0.6 }),
    tank: mat(0xcfc8b8, { roughness: 0.6, metalness: 0.3 }),
    tankRust: mat(0x9a6a4a, { roughness: 0.8, metalness: 0.35 }),
    pipe: mat(0x8a8f92, { roughness: 0.45, metalness: 0.7 }),
    hazard: mat(0xe8b830, { roughness: 0.6 }),
    tire: mat(0x1c1c1c, { roughness: 0.9 }),
    corrugated: mat(0x7a7f80, { roughness: 0.6, metalness: 0.5 }),
    sandbag: mat(0xb8a27a, { roughness: 1 }),
    gasCan: mat(0xb8321f, { roughness: 0.5, metalness: 0.3 }),
    forge: new THREE.MeshStandardMaterial({ color: 0x401000, emissive: 0xff6a10, emissiveIntensity: 2.2 }),
    barrels: [mat(0x2a4a7a, { metalness: 0.4, roughness: 0.6 }), mat(0x7a2a22, { metalness: 0.4, roughness: 0.6 }), mat(0x202224, { metalness: 0.4, roughness: 0.6 }), mat(0xb89a30, { metalness: 0.4, roughness: 0.6 })],
    rock: mat(0xa49b8c, { flatShading: true }),
    trunk: mat(0x4a3a2a),
    leaves: [mat(0x5f7a35, { flatShading: true }), mat(0x6f8a3a, { flatShading: true }), mat(0x4e6b30, { flatShading: true })],
    ivy: mat(0x4f6e2c, { flatShading: true }),
    huskHull: mat(0x6a7178, { roughness: 0.5, metalness: 0.55 }),
    huskGlow: new THREE.MeshStandardMaterial({ color: 0xff6a20, emissive: 0xff5a10, emissiveIntensity: 2.5 }),
    liftGlow: new THREE.MeshStandardMaterial({ color: 0x40ffd0, emissive: 0x30ffc0, emissiveIntensity: 2 }),
    stripe: mat(0xe8b830),
    tarp: [mat(0xd2672f), mat(0x2f8f8a), mat(0xd8b54a)],
    campTarp: [mat(0xd2672f, { side: THREE.DoubleSide }), mat(0x2f8f8a, { side: THREE.DoubleSide }), mat(0xd8b54a, { side: THREE.DoubleSide })],
    burnt: mat(0x2c2824, { roughness: 1, metalness: 0.2 }),
    headlight: mat(0xd8d4c4, { roughness: 0.3, metalness: 0.5 }),
    taillight: mat(0x7a1a14, { roughness: 0.4 }),
  };
  // weathered surfaces: everything built gets streaks, stains and cracks
  const weather = weatherTexture();
  for (const m of [M.burnt, M.trunk, M.rock, M.concrete, M.concreteDark, ...M.plaster, M.rust, M.metal, M.darkMetal, M.wood, M.asphalt, ...M.containerColors, ...M.carColors, M.tank, M.tankRust, M.pipe, M.hazard, M.corrugated, M.stripe, ...M.barrels, ...M.tarp, ...M.campTarp]) {
    if (m) m.map = weather;
  }

  // Static geometry is merged per material. Every vertex also gets a grime
  // shade: darker near the ground (dirt, damp, moss) with a little blotchiness,
  // multiplied with any colour the geometry already has.
  function pushGeo(material, geo) {
    if (geo.index) geo = geo.toNonIndexed();
    const p = geo.attributes.position;
    const own = geo.attributes.color;
    const col3 = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const h = y - terrainHeight(x, z);
      const grime = Math.max(0, Math.min(1, 1 - h / 1.3)) * 0.34 + (noise3(x * 0.35, y * 0.35, z * 0.35) - 0.5) * 0.16;
      const k = 1 - Math.max(-0.05, grime);
      col3[i * 3] = k * (own ? own.getX(i) : 1);
      col3[i * 3 + 1] = k * (own ? own.getY(i) : 1);
      col3[i * 3 + 2] = k * (own ? own.getZ(i) : 1);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col3, 3));
    let list = buckets.get(material);
    if (!list) {
      list = [];
      buckets.set(material, list);
    }
    list.push(geo);
  }

  // A static box. rotY rotates the visual; collision uses the rotated AABB.
  // visible: false makes a collider only (for shapes drawn some other way)
  function box(material, cx, cy, cz, sx, sy, sz, { rotY = 0, collide = true, tag = 'concrete', rotX = 0, rotZ = 0, visible = true } = {}) {
    const geo = unitBox.clone();
    // texture every ~3 m of surface, whatever the box's size
    const uv = geo.attributes.uv;
    const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) uv.setXY(f * 4 + k, (uv.getX(f * 4 + k) * dims[f][0]) / 4, (uv.getY(f * 4 + k) * dims[f][1]) / 4);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(cx, cy, cz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ)),
      new THREE.Vector3(sx, sy, sz),
    );
    geo.applyMatrix4(m);
    if (visible) pushGeo(material, geo);
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

  // ---- rubble and junk (decay) ----
  const rubbleShapes = [0, 1, 2, 3].map((v) => displace(new THREE.BoxGeometry(1, 1, 1, 2, 2, 2), 0.35, 2.5, 50 + v).toNonIndexed());
  // A heap of broken concrete with junk through it. size ~ its radius (m).
  function rubblePile(x, z, size, material = M.concreteDark, solid = false) {
    const n = Math.round(4 + size * 5);
    for (let k = 0; k < n; k++) {
      const a = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng.next()) * size;
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      const sc = rng.range(0.25, 0.75) * (1.2 - d / (size + 0.01) * 0.6);
      const geo = rng.pick(rubbleShapes).clone();
      geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(px, ground(px, pz) + sc * 0.3, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3))), new THREE.Vector3(sc * rng.range(1, 1.8), sc, sc * rng.range(0.8, 1.4))));
      pushGeo(rng.chance(0.3) ? M.concrete : material, geo);
    }
    for (let k = rng.int(1, 3); k > 0; k--) junk(x + rng.range(-size, size), z + rng.range(-size, size));
    if (solid && size > 0.8) {
      const g = ground(x, z);
      col.addBox({ x: x - size * 0.6, y: g - 0.5, z: z - size * 0.6 }, { x: x + size * 0.6, y: g + 0.5, z: z + size * 0.6 }, 'concrete');
    }
  }
  // One piece of junk lying about (no collision; it's small).
  function junk(x, z) {
    const g = ground(x, z);
    const ry = rng.range(0, Math.PI * 2);
    const at = (geo, material, y, rx = 0, rz = 0) => {
      geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, g + y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
      pushGeo(material, geo);
    };
    switch (rng.int(0, 9)) {
      case 0: // planks
        for (let k = 0; k < 3; k++) at(new THREE.BoxGeometry(0.22, 0.04, rng.range(1.2, 2.4)).translate(k * 0.25 - 0.25, k * 0.04, 0), M.wood, 0.03, 0, rng.range(-0.1, 0.1));
        break;
      case 1: // rebar sticking out at angles
        for (let k = 0; k < 4; k++) at(new THREE.CylinderGeometry(0.015, 0.015, rng.range(0.8, 1.8), 4).translate(k * 0.12, 0.5, 0), M.rust, 0, rng.range(-0.6, 0.6), rng.range(-0.6, 0.6));
        break;
      case 2: // a length of pipe
        at(new THREE.CylinderGeometry(0.12, 0.12, rng.range(1.5, 3), 10).rotateZ(Math.PI / 2), M.rust, 0.12);
        break;
      case 3: // a tyre
        at(new THREE.TorusGeometry(0.32, 0.12, 8, 16).rotateX(Math.PI / 2), M.tire, 0.12, rng.range(-0.3, 0.3));
        break;
      case 4: // a rusty drum on its side
        at(new THREE.CylinderGeometry(0.3, 0.3, 0.88, 14).rotateZ(Math.PI / 2), M.rust, 0.3);
        break;
      case 5: // cinder blocks
        for (let k = 0; k < 3; k++) at(new THREE.BoxGeometry(0.4, 0.2, 0.2).translate(k * 0.42 - 0.4, 0.1, (k % 2) * 0.1), M.concrete, 0);
        break;
      case 6: // a bent corrugated sheet
        at(new THREE.BoxGeometry(1.4, 0.03, 0.9), M.corrugated, 0.2, rng.range(-0.3, 0.3), 0.25);
        break;
      case 7: // an old television
        at(new THREE.BoxGeometry(0.55, 0.42, 0.45), M.darkMetal, 0.21, 0, rng.range(-0.2, 0.2));
        break;
      case 8: // a broken chair
        at(new THREE.BoxGeometry(0.45, 0.05, 0.45), M.wood, 0.3, 0, 0.4);
        at(new THREE.BoxGeometry(0.45, 0.5, 0.05).translate(0, 0.25, -0.2), M.wood, 0.3, 0, 0.4);
        break;
      default: // a shopping cart on its side
        at(new THREE.BoxGeometry(0.55, 0.45, 0.8), M.metal, 0.3, 0, 1.4);
    }
  }

  function geoAt(material, geo, x, y, z, rotY = 0, scale = 1) {
    const g = geo.clone();
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), new THREE.Vector3(scale, scale, scale)));
    pushGeo(material, g);
  }

  const ground = (x, z) => terrainHeight(x, z);

  // A spot where loot can appear. Each raid picks a random set of spots and a
  // random container type from the spot's pool, so caches move between raids.
  // always: filled every raid (caches under camp tarps, survivor shacks)
  function addContainer(pool, x, y, z, rotY = 0, always = false) {
    const types = Array.isArray(pool) ? pool : [pool];
    containers.push({ pool: types, type: types[0], x, y, z, rotY, always });
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
    const stone = new THREE.Color(0x8a8278);
    const road = new THREE.Color(0x4a4742);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      const n = Math.sin(x * 0.07) * Math.cos(z * 0.05) * 0.5 + 0.5;
      c.copy(grass).lerp(dry, n * 0.8);
      if (h > 6) c.lerp(dirt, Math.min(1, (h - 6) / 10));
      // bare rock on steep slopes and high ground (the north-west range)
      const slope = Math.hypot(terrainHeight(x + 1, z) - terrainHeight(x - 1, z), terrainHeight(x, z + 1) - terrainHeight(x, z - 1)) / 2;
      const bare = Math.max(Math.min(1, Math.max(0, slope - 0.45) * 1.6), Math.min(1, Math.max(0, (h - 16) / 14)));
      if (bare > 0) c.lerp(stone, bare * 0.85);
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
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: groundTexture() }));
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
            // broken stub, and what fell off it lying below
            const hh = rng.range(0.3, 1.4);
            box(paint, px, y0 + hh / 2, pz, sx, hh, sz);
            const ox = side.ax === 'x' ? 0 : side.out * 1.2;
            const oz = side.ax === 'x' ? side.out * 1.2 : 0;
            if (f === 0 || rng.chance(0.5)) rubblePile(px + ox, pz + oz, rng.range(0.6, 1.3), paint);
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
            const wr = rng.next();
            if (wr < 0.15) box(M.glass, px, y0 + 1.7, pz, sx * 0.9, 1.4, sz * 0.3, { collide: false });
            else if (wr < 0.4) {
              // boarded up: planks nailed across the opening, outside
              const ox = side.ax === 'x' ? 0 : side.out * (t / 2 + 0.03);
              const oz = side.ax === 'x' ? side.out * (t / 2 + 0.03) : 0;
              for (let k = 0; k < 3; k++) {
                box(M.wood, px + ox, y0 + 1.25 + k * 0.45, pz + oz, side.ax === 'x' ? segLen * 0.95 : 0.04, 0.18, side.ax === 'x' ? 0.04 : segLen * 0.95, { collide: false, rotX: side.ax === 'z' ? rng.range(-0.15, 0.15) : 0, rotZ: side.ax === 'x' ? rng.range(-0.15, 0.15) : 0 });
              }
            }
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
      const lx = cx + rng.range(-w / 2 + 2, w / 2 - 1.2);
      const lz = cz + rng.range(-d / 2 + 3, d / 2 - 1.2);
      addContainer(['crate', 'crate', 'locker', 'medical', 'locker', 'weapon_case'], lx, y0, lz, rng.pick([0, Math.PI / 2]));
      if (w * d > 120) {
        addContainer(['crate', 'locker', 'medical'], cx + rng.range(-w / 2 + 2, w / 2 - 1.2), y0, cz + rng.range(-d / 2 + 3, d / 2 - 1.2));
      }
    }
    // roof
    const roofY = top + floors * fh;
    if (rng.chance(0.6)) {
      box(M.concrete, cx + 1.3, roofY - 0.15, cz, w - 2.6, 0.3, d);
      // what's left on the roof: an AC unit, a water tank, an antenna, rubble
      if (rng.chance(0.5)) box(M.metal, cx + rng.range(-w / 4, w / 4), roofY + 0.45, cz + rng.range(-d / 4, d / 4), 1.2, 0.9, 0.9, { collide: false });
      if (rng.chance(0.3)) {
        const tx = cx + rng.range(-w / 4, w / 4);
        const tz = cz + rng.range(-d / 4, d / 4);
        const tank = new THREE.CylinderGeometry(0.7, 0.7, 1.4, 14);
        tank.translate(tx, roofY + 0.9, tz);
        pushGeo(M.rust, tank);
      }
      if (rng.chance(0.35)) box(M.darkMetal, cx + rng.range(-w / 3, w / 3), roofY + 1.5, cz + rng.range(-d / 3, d / 3), 0.06, 3, 0.06, { collide: false, rotZ: rng.range(-0.3, 0.3) });
      if (rng.chance(0.5)) rubblePile(cx + rng.range(-w / 4, w / 4), cz + rng.range(-d / 4, d / 4), 0.6);
    } else if (floors > 1) {
      // the roof is gone: a slab hangs down into the top floor
      box(M.concrete, cx + rng.range(-1, 1), roofY - 1.5, cz + rng.range(-1, 1), w * 0.45, 0.3, d * 0.5, { rotX: rng.range(0.35, 0.6), rotY: rng.range(0, 3), collide: false });
    }
    // ivy hanging off a wall
    if (rng.chance(0.55)) {
      const side = rng.pick([-1, 1]);
      const ivyH = rng.range(2, floors * fh * 0.9);
      box(M.ivy, cx + rng.range(-w / 3, w / 3), top + ivyH / 2, cz + side * (d / 2 + 0.2), rng.range(1.5, 3.5), ivyH, 0.25, { collide: false });
    }
    // rubble and junk outside
    for (let i = 0; i < 2; i++) {
      const rx = cx + rng.range(-w / 2 - 2, w / 2 + 2);
      const rz = cz + (rng.chance(0.5) ? -1 : 1) * (d / 2 + rng.range(1, 2.5));
      rubblePile(rx, rz, rng.range(0.5, 1.4), M.concreteDark, true);
    }
    for (let i = 0; i < 2; i++) junk(cx + rng.range(-w / 2 - 3, w / 2 + 3), cz + (rng.chance(0.5) ? -1 : 1) * (d / 2 + rng.range(1.5, 4)));
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
    if (Math.hypot(lot.x - plaza.x, lot.z - plaza.z) < 20) continue; // keep the Warden plaza open
    const w = rng.int(8, 12);
    const d = rng.int(8, 12);
    const floors = Math.max(1, Math.round(rng.range(1, 4.2) - lot.dist * 0.35));
    building(lot.x + rng.range(-1, 1), lot.z + rng.range(-1, 1), w, d, floors);
  }

  // Warden plaza: a fountain ring and broken statues
  {
    const g = ground(plaza.x, plaza.z);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      box(M.concreteDark, plaza.x + Math.cos(a) * 6, g + 0.45, plaza.z + Math.sin(a) * 6, 3.3, 0.9, 0.6, { rotY: -a + Math.PI / 2 });
    }
    box(M.concrete, plaza.x, g + 1.4, plaza.z, 1.2, 2.8, 1.2);
    box(M.metal, plaza.x, g + 3.2, plaza.z, 0.6, 1.2, 0.6, { collide: false });
    enemySpawns.push({ type: 'warden', x: plaza.x, z: plaza.z + 10, radius: 20 });
    addContainer(['weapon_case', 'crate'], plaza.x + 2, g, plaza.z - 2);
    addContainer(['husk_pod', 'weapon_case'], plaza.x - 3, g, plaza.z + 3);
  }

  // ---------- road props: cars, barriers, lamp posts ----------
  // An abandoned car: a proper body profile (hood, cabin, trunk) extruded to
  // width, glass, bumpers, wheels in their arches. Years out here show:
  // smashed or missing glass, flat or missing tyres, rust, some burnt out.
  function car(x, z, rotY) {
    const g = ground(x, z);
    const burnt = rng.chance(0.18);
    const paint = burnt ? M.burnt : rng.pick(M.carColors);
    const flat = rng.chance(0.35) ? rng.pick([-1, 1]) : 0; // a side sitting on its rims
    const tilt = flat * 0.06;
    const place = (geo, material) => {
      geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, g + (flat ? -0.08 : 0), z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, tilt, 'YXZ')), new THREE.Vector3(1, 1, 1)));
      pushGeo(material, geo);
    };
    // side profile (z along the car, y up), extruded across its width
    const W = 1.78;
    const body = new THREE.Shape();
    [[-2.2, 0.32], [-2.25, 0.72], [-1.85, 0.86], [-1.0, 0.9], [-0.6, 1.38], [0.55, 1.4], [1.05, 0.95], [2.05, 0.82], [2.2, 0.55], [2.1, 0.32]].forEach(([zz, yy], i) => (i ? body.lineTo(zz, yy) : body.moveTo(zz, yy)));
    // wheel arches cut into the bottom edge
    for (const wz of [1.35, -1.35]) {
      body.lineTo(wz + 0.45, 0.32);
      body.absarc(wz, 0.32, 0.45, 0, Math.PI, false);
    }
    body.lineTo(-2.2, 0.32);
    const bodyGeo = new THREE.ExtrudeGeometry(body, { depth: W, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2, curveSegments: 8 });
    bodyGeo.rotateY(-Math.PI / 2); // profile z -> world z, extrusion -> x
    bodyGeo.translate(W / 2, 0, 0);
    place(bodyGeo, paint);
    // glass: the greenhouse, a little inset; broken cars show a dark hole instead
    const glassShape = new THREE.Shape();
    [[-0.92, 0.92], [-0.56, 1.33], [0.5, 1.35], [0.98, 0.96]].forEach(([zz, yy], i) => (i ? glassShape.lineTo(zz, yy) : glassShape.moveTo(zz, yy)));
    const smashed = burnt || rng.chance(0.4);
    const glassGeo = new THREE.ExtrudeGeometry(glassShape, { depth: W + 0.1, bevelEnabled: false });
    glassGeo.rotateY(-Math.PI / 2);
    glassGeo.translate((W + 0.1) / 2, 0.01, 0);
    place(glassGeo, smashed ? M.darkMetal : M.glass);
    // bumpers, lights, mirrors
    for (const [zz, m] of [[2.27, M.darkMetal], [-2.3, M.darkMetal]]) {
      const b = new THREE.BoxGeometry(W + 0.08, 0.18, 0.12);
      b.translate(0, 0.42, zz);
      place(b, m);
    }
    for (const sx of [-0.62, 0.62]) {
      const hl = new THREE.BoxGeometry(0.32, 0.12, 0.05);
      hl.translate(sx, 0.7, 2.2);
      place(hl, smashed ? M.darkMetal : M.headlight);
      const tl = new THREE.BoxGeometry(0.3, 0.12, 0.05);
      tl.translate(sx, 0.72, -2.27);
      place(tl, M.taillight);
    }
    // wheels: tyre and hub; one side may be flat, a wheel may be gone
    for (const [wx, wz] of [[-0.86, 1.35], [0.86, 1.35], [-0.86, -1.35], [0.86, -1.35]]) {
      if (burnt && rng.chance(0.5)) continue;
      const isFlat = flat !== 0 && Math.sign(wx) === flat;
      const tyre = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 14);
      tyre.rotateZ(Math.PI / 2);
      if (isFlat) tyre.scale(1, 0.75, 1);
      tyre.translate(wx, isFlat ? 0.27 : 0.36, wz);
      place(tyre, burnt ? M.burnt : M.tire);
      const hub = new THREE.CylinderGeometry(0.17, 0.17, 0.26, 10);
      hub.rotateZ(Math.PI / 2);
      hub.translate(wx * 1.01, isFlat ? 0.27 : 0.36, wz);
      place(hub, M.rust);
    }
    // rust patches along the sills and wheel arches
    if (!burnt && rng.chance(0.7)) {
      for (let k = 0; k < rng.int(1, 3); k++) {
        const rp = new THREE.BoxGeometry(W + 0.13, rng.range(0.12, 0.3), rng.range(0.4, 1.1));
        rp.translate(0, rng.range(0.4, 0.7), rng.range(-1.8, 1.8));
        place(rp, M.rust);
      }
    }
    // collision: the body and the cabin
    box(paint, x, g + 0.6, z, W, 0.6, 4.4, { rotY, collide: true, visible: false });
    box(paint, x, g + 1.15, z, W - 0.2, 0.5, 1.6, { rotY, collide: true, visible: false });
    addContainer('car', x - Math.sin(rotY) * 2.4, g, z - Math.cos(rotY) * 2.4, rotY);
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
  const lampPole = new THREE.CylinderGeometry(0.07, 0.11, 5, 10);
  lampPole.translate(0, 2.5, 0);
  const lampArm = mergeGeometries([
    new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 4.9, 0), new THREE.Vector3(0, 5.6, 0.6), new THREE.Vector3(0, 5.25, 1.5)), 10, 0.05, 6).toNonIndexed(),
    new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 5.1, 1.55).toNonIndexed(),
  ]);
  const boardLeg = new THREE.CylinderGeometry(0.08, 0.1, 3.4, 8);
  boardLeg.translate(0, 1.7, 0);
  for (let t = -140; t <= 140; t += 22) {
    for (const [x, z] of [[TOWN.x + t, TOWN.z + 5.6], [TOWN.x - 5.6, TOWN.z + t]]) {
      if (Math.abs(t) < 8) continue;
      const g = ground(x, z);
      // a slim pole curving over the road into a hooded lamp
      geoAt(M.darkMetal, lampPole, x, g, z);
      col.addBox({ x: x - 0.1, y: g, z: z - 0.1 }, { x: x + 0.1, y: g + 5, z: z + 0.1 }, 'metal');
      const toRoad = z === TOWN.z + 5.6 ? Math.PI : Math.PI / 2; // arm reaches out over the road
      const arm = lampArm.clone();
      arm.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, g, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, toRoad + rng.range(-0.2, 0.2), 0)), new THREE.Vector3(1, 1, 1)));
      pushGeo(M.darkMetal, arm);
    }
  }

  // ---------- Network notices ----------
  // curved billboards along the main roads, in the Network's voice
  const SLOGANS = [
    ['THE NETWORK PROVIDES', 'REST · RATION · REMAIN'],
    ['COMPLY · CONSERVE · CONTINUE', 'YOUR QUOTA KEEPS US ALL'],
    ['CURFEW AT DUSK', 'WATCHERS KEEP YOU SAFE'],
    ['REPORT UNREGISTERED SALVAGE', 'THE NETWORK REMEMBERS'],
    ['DO NOT DISTURB THE CRADLES', 'GROWTH IS ORDER'],
    ['RATION DAY: THURSDAY', 'GRATITUDE IS MANDATORY'],
  ];
  const boardSpots = [[-95, 'x'], [-40, 'x'], [55, 'x'], [110, 'x'], [-75, 'z'], [65, 'z']];
  boardSpots.forEach(([t, axis], i) => {
    const side = i % 2 ? 1 : -1;
    const x = axis === 'x' ? TOWN.x + t : TOWN.x + side * 10;
    const z = axis === 'x' ? TOWN.z + side * 10 : TOWN.z + t;
    // skip if a building is in the way
    const near = col.query(x - 3, z - 1.5, x + 3, z + 1.5, []);
    if (near.some((b) => x + 3 > b.min.x && x - 3 < b.max.x && z + 1.5 > b.min.z && z - 1.5 < b.max.z)) return;
    const g = ground(x, z);
    // face the road
    const fx = axis === 'x' ? 0 : -side;
    const fz = axis === 'x' ? -side : 0;
    networkBoard(scene, SLOGANS[i % SLOGANS.length], x, g, z, Math.atan2(fx, fz));
    for (const o of [-2.2, 2.2]) {
      // legs sit just behind the curve of the board
      const px = x + (axis === 'x' ? o : 0) - fx * 0.45;
      const pz = z + (axis === 'x' ? 0 : o) - fz * 0.45;
      geoAt(M.darkMetal, boardLeg, px, g, pz);
      col.addBox({ x: px - 0.12, y: g, z: pz - 0.12 }, { x: px + 0.12, y: g + 3.4, z: pz + 0.12 }, 'metal');
    }
  });

  // ---------- street signs: faded, rust-spotted, some bent or leaning ----------
  {
    const kinds = ['stop', 'speed', 'distance', 'warning', 'noentry', 'curve'];
    for (let t = -160; t <= 160; t += 26) {
      for (const [axis, side] of [['x', 1], ['z', -1]]) {
        if (Math.abs(t) < 12 || rng.chance(0.35)) continue;
        const x = axis === 'x' ? TOWN.x + t : TOWN.x + side * 6.6;
        const z = axis === 'x' ? TOWN.z + side * 6.6 : TOWN.z + t;
        if (Math.abs(x) > MAP_HALF - 25 || Math.abs(z) > MAP_HALF - 25) continue;
        const facing = axis === 'x' ? (t < 0 ? Math.PI / 2 : -Math.PI / 2) : t < 0 ? 0 : Math.PI;
        streetSign(scene, rng.pick(kinds), x, ground(x, z), z, facing, rng.next() < 0.3 ? rng.range(0.15, 0.45) : rng.range(-0.05, 0.05), rng);
        box(M.darkMetal, x, ground(x, z) + 1, z, 0.08, 2, 0.08, { visible: false });
      }
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
      if (rng.chance(0.6)) addContainer(['crate', 'weapon_case', 'husk_pod', 'locker'], x, g, z + 2.2);
    }
  }
  enemySpawns.push({ type: 'pouncer', x: yard.x + 14, z: yard.z + 15, radius: 22 });
  enemySpawns.push({ type: 'skitter', x: yard.x + 10, z: yard.z - 8, radius: 14, count: 4 });
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

  // ---------- gas station (west end of the main road) ----------
  // Away from Crucible Works. A cracked, oil-stained forecourt under a sagging
  // canopy with a panel missing, two pump islands, a tall price sign, the shop
  // behind, and what people left: a car at the pumps, drums, tyres, rubble.
  {
    const x = -150;
    const z = 6;
    const g = ground(x, z);
    box(M.concreteDark, x, g + 0.1, z, 26, 0.3, 18);
    for (let k = 0; k < 7; k++) {
      // oil stains and patched cracks
      const sx = x + rng.range(-10, 10);
      const sz = z + rng.range(-7, 7);
      const st = new THREE.CircleGeometry(rng.range(0.5, 1.6), 12);
      st.rotateX(-Math.PI / 2);
      st.scale(1, 1, rng.range(0.5, 1));
      st.translate(sx, g + 0.26, sz);
      pushGeo(M.burnt, st);
    }
    // canopy on four columns; one corner has dropped
    for (const [px, pz] of [[-8, -4.5], [8, -4.5], [-8, 4.5], [8, 4.5]]) box(M.metal, x + px, g + 2.8, z + pz, 0.45, 5.4, 0.45, { tag: 'metal' });
    box(M.concrete, x - 4.5, g + 5.6, z, 11, 0.5, 12, { tag: 'metal' });
    box(M.concrete, x + 4.2, g + 5.2, z, 9.4, 0.5, 12, { rotZ: -0.08, tag: 'metal' }); // sagging half
    box(M.rust, x + 6.5, g + 4.8, z + 2.5, 3, 0.12, 3, { rotZ: 0.6, rotX: 0.3, collide: false }); // a fallen panel hanging
    box(M.tarp[0], x - 4.5, g + 5.95, z + 6.05, 11, 0.7, 0.08, { collide: false });
    box(M.tarp[0], x + 4.2, g + 5.55, z + 6.05, 9.4, 0.7, 0.08, { rotZ: -0.08, collide: false });
    gasSign(scene, x - 4.5, g + 5.95, z + 6.12);
    // pump islands
    for (const px of [-4, 4]) {
      box(M.concrete, x + px, g + 0.35, z, 1.6, 0.2, 6, { tag: 'concrete' });
      for (const pz of [-1.6, 1.6]) {
        box(M.metal, x + px, g + 1.2, z + pz, 0.9, 1.6, 0.6, { tag: 'metal' });
        box(M.stripe, x + px, g + 1.75, z + pz, 0.92, 0.25, 0.62, { collide: false });
        box(M.glass, x + px, g + 1.45, z + pz + 0.31, 0.5, 0.3, 0.02, { collide: false });
        const hose = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(x + px + 0.46, g + 1.6, z + pz), new THREE.Vector3(x + px + 0.9, g + 0.5, z + pz + 0.2), new THREE.Vector3(x + px + 0.5, g + 0.4, z + pz + 0.6)), 10, 0.025, 5);
        pushGeo(M.tire, hose);
      }
    }
    // tall price sign by the road, some digits gone
    box(M.metal, x + 11, g + 4.5, z - 8, 0.35, 9, 0.35, { tag: 'metal' });
    priceSign(scene, x + 11, g + 8.3, z - 8);
    // underground tank vents
    for (const px of [-11, -10.4]) box(M.darkMetal, x + px, g + 1.6, z + 7.6, 0.1, 3.2, 0.1, { collide: false });
    // the shop behind, a car left at the pumps, junk
    building(x, z + 16, 12, 8, 1, { ruin: 0.12 });
    car(x - 4 + 2.2, z + 0.4, Math.PI / 2 + 0.15);
    rubblePile(x + 10, z + 7, 1.3, M.concreteDark, true);
    for (let k = 0; k < 4; k++) junk(x + rng.range(-12, 12), z + rng.range(-8, 8));
    for (let k = 0; k < 4; k++) {
      const bx2 = x - 11.5 + (k % 2) * 0.65;
      const bz2 = z - 7.5 + Math.floor(k / 2) * 0.65;
      const drum = new THREE.CylinderGeometry(0.3, 0.3, 0.88, 14);
      drum.translate(bx2, g + 0.69, bz2);
      pushGeo(rng.pick(M.barrels), drum);
    }
    col.addBox({ x: x - 11.85, y: g, z: z - 7.85 }, { x: x - 10.55, y: g + 1.1, z: z - 6.55 }, 'metal');
    addContainer(['medical', 'crate'], x + 3, g + 0.25, z - 2);
    addContainer(['crate', 'locker', 'weapon_case'], x - 6, g + 0.25, z + 3);
    enemySpawns.push({ type: 'skitter', x, z, radius: 18, count: 3 });
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
    enemySpawns.push({ type: 'watcher', x: x + 10, z: z + 30, radius: 30 });
    enemySpawns.push({ type: 'skitter', x: x + 5, z: z + 5, radius: 15, count: 3 });
  }

  // ---------- crashed Husk hull (north) ----------
  {
    const hx = 40;
    const hz = -150;
    const g = ground(hx, hz);
    const ring = new THREE.TorusGeometry(16, 3.2, 10, 28);
    const ringG = ring.clone();
    ringG.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.4, 0.6, 0.15)));
    ringG.translate(hx, g + 8, hz);
    pushGeo(M.huskHull, ringG);
    // approximate collision with boxes around the ring's lower half
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const p = new THREE.Vector3(Math.cos(a) * 16, Math.sin(a) * 16, 0).applyEuler(new THREE.Euler(0.4, 0.6, 0.15));
      const y = g + 8 + p.y;
      if (y > g + 10) continue;
      col.addBox({ x: hx + p.x - 2.6, y: Math.max(g - 2, y - 2.6), z: hz + p.z - 2.6 }, { x: hx + p.x + 2.6, y: y + 2.6, z: hz + p.z + 2.6 }, 'metal');
    }
    // hull spine
    box(M.huskHull, hx - 20, g + 2, hz + 12, 6, 5, 26, { rotY: 0.6, rotZ: 0.2, tag: 'metal' });
    box(M.huskHull, hx + 18, g + 1.5, hz - 14, 5, 4, 18, { rotY: -0.4, tag: 'metal' });
    for (let i = 0; i < 6; i++) {
      const vx = hx + rng.range(-22, 22);
      const vz = hz + rng.range(-16, 16);
      box(M.huskGlow, vx, ground(vx, vz) + 0.5, vz, 0.6, 1, 0.6, { collide: false });
    }
    const glow = new THREE.PointLight(0xff6a20, 40, 40, 2);
    glow.position.set(hx, g + 4, hz);
    scene.add(glow);
    lights.push(glow);
    for (let i = 0; i < 4; i++) addContainer('husk_pod', hx + rng.range(-14, 14), 0, hz + rng.range(-10, 10));
    enemySpawns.push({ type: 'buzzer', x: hx, z: hz + 20, radius: 25, count: 2 });
    enemySpawns.push({ type: 'skitter', x: hx - 10, z: hz + 8, radius: 15, count: 3 });
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

  // ---------- oil refinery round the Refinery Lift (south east) ----------
  {
    const R = REFINERY;
    const at = (dx, dz) => [R.x + dx, R.z + dz, ground(R.x + dx, R.z + dz)];
    // a vertical cylinder, collided as two crossed boxes (close to round)
    const cyl = (material, dx, dz, r, h, { seg = 22, collide = true, y = null } = {}) => {
      const [x, z, g] = at(dx, dz);
      const y0 = y ?? g - 0.3;
      const geo = new THREE.CylinderGeometry(r, r, h, seg);
      geo.translate(x, y0 + h / 2, z);
      pushGeo(material, geo);
      if (collide) {
        const a = r * 0.93;
        const b = r * 0.62;
        col.addBox({ x: x - a, y: y0, z: z - b }, { x: x + a, y: y0 + h, z: z + b }, 'metal');
        col.addBox({ x: x - b, y: y0, z: z - a }, { x: x + b, y: y0 + h, z: z + a }, 'metal');
      }
      return y0;
    };
    // a horizontal pipe from (dx0, dz0) to (dx1, dz1) at height h above the first end's ground
    const pipe = (material, dx0, dz0, dx1, dz1, h, r = 0.22) => {
      const [x0, z0, g] = at(dx0, dz0);
      const [x1, z1] = at(dx1, dz1);
      const len = Math.hypot(x1 - x0, z1 - z0);
      const geo = new THREE.CylinderGeometry(r, r, len, 10);
      geo.rotateZ(Math.PI / 2);
      geo.rotateY(-Math.atan2(z1 - z0, x1 - x0));
      geo.translate((x0 + x1) / 2, g + h, (z0 + z1) / 2);
      pushGeo(material, geo);
    };

    // storage tanks: dome roofs, a ladder, a band of rust
    for (const [dx, dz, r, h, m] of [[-24, -12, 6, 9, M.tank], [-24, 7, 6, 9, M.tankRust], [15, 25, 5, 8, M.tank]]) {
      const y0 = cyl(m, dx, dz, r, h, { seg: 32 });
      const [x, z] = at(dx, dz);
      const dome = new THREE.SphereGeometry(r, 32, 8, 0, Math.PI * 2, 0, Math.PI * 0.22);
      dome.translate(x, y0 + h - r * Math.cos(Math.PI * 0.22), z);
      pushGeo(m, dome);
      const band = new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.5, 32, 1, true);
      band.translate(x, y0 + 1.6, z);
      pushGeo(M.hazard, band);
      box(M.darkMetal, x + r + 0.15, y0 + h / 2, z, 0.1, h, 0.6, { collide: false });
      for (let k = 0; k < h / 0.5; k++) box(M.darkMetal, x + r + 0.22, y0 + 0.4 + k * 0.5, z, 0.05, 0.05, 0.6, { collide: false });
    }
    // distillation columns with platforms, and a flare stack
    for (const [dx, dz, r, h] of [[17, -15, 1.4, 22], [22, -8, 1.05, 18]]) {
      const y0 = cyl(M.pipe, dx, dz, r, h, { seg: 18 });
      const [x, z] = at(dx, dz);
      for (let yy = 5; yy < h - 1; yy += 5) {
        const ring = new THREE.CylinderGeometry(r + 0.9, r + 0.9, 0.15, 18);
        ring.translate(x, y0 + yy, z);
        pushGeo(M.darkMetal, ring);
        const rail = new THREE.TorusGeometry(r + 0.9, 0.04, 4, 24);
        rail.rotateX(Math.PI / 2);
        rail.translate(x, y0 + yy + 1, z);
        pushGeo(M.hazard, rail);
      }
      const cap = new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      cap.translate(x, y0 + h, z);
      pushGeo(M.pipe, cap);
    }
    {
      const y0 = cyl(M.rust, 29, 19, 0.45, 30, { seg: 10 });
      const [x, z] = at(29, 19);
      for (let k = 0; k < 6; k++) {
        const brace = new THREE.CylinderGeometry(0.06, 0.06, 6.2, 4);
        brace.rotateZ(k % 2 ? 0.3 : -0.3);
        brace.translate(x, y0 + 3 + k * 4.5, z);
        pushGeo(M.darkMetal, brace);
      }
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.2, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      flame.position.set(x, y0 + 31.6, z);
      scene.add(flame);
      const core = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.8, 10), new THREE.MeshBasicMaterial({ color: 0xfff0b0 }));
      core.position.set(x, y0 + 30.9, z);
      scene.add(core);
    }
    // pipe racks: posts, a deck, and bundles of pipe between the tanks and the columns
    for (let dx = -18; dx <= 14; dx += 8) {
      const [x, z, g] = at(dx, -22);
      for (const oz of [-1.2, 1.2]) box(M.darkMetal, x, g + 2.6, z + oz, 0.3, 5.2, 0.3, { tag: 'metal' });
      box(M.darkMetal, x, g + 5.2, z, 0.3, 0.3, 2.8, { collide: false });
    }
    for (const [oz, r, m] of [[-0.7, 0.28, M.pipe], [0, 0.22, M.rust], [0.7, 0.18, M.pipe]]) pipe(m, -20, -22 + oz, 16, -22 + oz, 5.55, r);
    for (const [ox, r] of [[-0.6, 0.24], [0.6, 0.2]]) pipe(M.pipe, -17 + ox, -6, -17 + ox, -21, 1.0, r);
    pipe(M.pipe, 15.5, -21, 15.5, -15, 5.55, 0.24);
    // pumpjacks nodding over their wells
    for (const [dx, dz, ry] of [[-8, 27, 0.3], [2, 33, -0.4]]) {
      const [x, z, g] = at(dx, dz);
      const c = Math.cos(ry);
      const sn = Math.sin(ry);
      const off = (lx) => [x + lx * c, z - lx * sn];
      box(M.concreteDark, x, g + 0.2, z, 6, 0.5, 2, { rotY: ry });
      for (const side of [-0.6, 0.6]) {
        const [px, pz] = off(0);
        box(M.darkMetal, px + side * sn, g + 2, pz + side * c, 0.2, 4, 0.2, { rotY: ry, rotX: side * 0.2, collide: false });
      }
      const [bx, bz] = off(0);
      box(M.hazard, bx, g + 4.1, bz, 6.4, 0.35, 0.35, { rotY: ry, rotZ: 0.12 });
      const [hx2, hz2] = off(3.3);
      box(M.hazard, hx2, g + 3.7, hz2, 0.5, 1.6, 0.6, { rotY: ry, rotZ: 0.4, collide: false });
      const [cx, cz] = off(-2.6);
      box(M.darkMetal, cx, g + 1.4, cz, 1.4, 1.4, 1.0, { rotY: ry });
      const [wx, wz] = off(3.4);
      box(M.darkMetal, wx, g + 0.9, wz, 0.25, 1.8, 0.25, { rotY: ry, collide: false });
    }
    // the control building
    building(R.x + 2, R.z - 32, 10, 8, 1, { ruin: 0.05 });
    addContainer(['locker', 'medical', 'crate'], R.x + 2, 0, R.z - 33);

    // big trucks: a fuel tanker, a flatbed semi with pipes, a dump truck
    const truck = (dx, dz, ry, kind) => {
      const [x, z, g] = at(dx, dz);
      const c = Math.cos(ry);
      const sn = Math.sin(ry);
      const P = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c]; // local (side, forward)
      const paint = rng.pick([M.carColors[0], M.carColors[1], M.carColors[3], M.containerColors[1]]);
      // chassis and cab (forward is +lz)
      let [px, pz] = P(0, 0);
      box(M.darkMetal, px, g + 0.9, pz, 2.4, 0.4, 11, { rotY: ry, tag: 'metal' });
      [px, pz] = P(0, 4.3);
      box(paint, px, g + 2.0, pz, 2.5, 2.4, 2.3, { rotY: ry, tag: 'metal' });
      [px, pz] = P(0, 5.47);
      box(M.glass, px, g + 2.5, pz, 2.2, 0.9, 0.05, { rotY: ry, collide: false });
      [px, pz] = P(0, 5.6);
      box(M.darkMetal, px, g + 1.3, pz, 2.5, 0.6, 0.2, { rotY: ry, collide: false });
      for (const lz of [4.3, -0.5, -1.9, -3.8]) {
        for (const lx of [-1.25, 1.25]) {
          [px, pz] = P(lx, lz);
          const w = new THREE.CylinderGeometry(0.55, 0.55, 0.45, 14);
          w.rotateZ(Math.PI / 2);
          w.rotateY(ry);
          w.translate(px, g + 0.55, pz);
          pushGeo(M.tire, w);
        }
      }
      if (kind === 'tanker') {
        [px, pz] = P(0, -1.2);
        const t = new THREE.CapsuleGeometry(1.25, 5.2, 6, 18);
        t.rotateX(Math.PI / 2);
        t.rotateY(ry);
        t.translate(px, g + 2.4, pz);
        pushGeo(M.tank, t);
        col.addBox({ x: px - 1.3, y: g + 1.1, z: pz - 1.3 }, { x: px + 1.3, y: g + 3.7, z: pz + 1.3 }, 'metal');
        [px, pz] = P(0, -1.2);
        box(M.hazard, px, g + 2.4, pz, 2.55, 0.35, 5.5, { rotY: ry, collide: false });
      } else if (kind === 'flatbed') {
        [px, pz] = P(0, -1.3);
        box(M.darkMetal, px, g + 1.2, pz, 2.5, 0.2, 7.5, { rotY: ry, tag: 'metal' });
        for (let k = 0; k < 6; k++) {
          [px, pz] = P(-0.8 + (k % 3) * 0.8, -1.3);
          const pp = new THREE.CylinderGeometry(0.32, 0.32, 7, 12);
          pp.rotateX(Math.PI / 2);
          pp.rotateY(ry);
          pp.translate(px, g + 1.65 + Math.floor(k / 3) * 0.6, pz);
          pushGeo(M.pipe, pp);
        }
        [px, pz] = P(0, -1.3);
        col.addBox({ x: px - 1.4, y: g + 1.2, z: pz - 1.4 }, { x: px + 1.4, y: g + 2.6, z: pz + 1.4 }, 'metal');
      } else {
        [px, pz] = P(0, -1.6);
        box(M.rust, px, g + 2.3, pz, 2.5, 2.0, 6.0, { rotY: ry, rotX: -0.08, tag: 'metal' });
      }
      const [lx, lz] = P(2.5, 1.5);
      addContainer(['crate', 'weapon_case'], lx, 0, lz);
    };
    truck(9, 9, 0.5, 'tanker');
    truck(-10, 16, -1.2, 'flatbed');
    truck(26, -26, 2.4, 'dump');
    truck(-30, -27, 1.6, 'tanker');

    // oil barrels in loose clusters
    for (const [dx, dz] of [[-13, -9], [7, -13], [-3, 17], [19, 3], [-31, -2]]) {
      const n = rng.int(5, 10);
      for (let k = 0; k < n; k++) {
        const a = rng.range(0, Math.PI * 2);
        const rr = Math.sqrt(k / n) * 2.2;
        const [x, z, g] = at(dx + Math.cos(a) * rr, dz + Math.sin(a) * rr);
        const tipped = rng.chance(0.12);
        const geo = new THREE.CylinderGeometry(0.3, 0.3, 0.88, 14);
        if (tipped) geo.rotateZ(Math.PI / 2).rotateY(rng.range(0, 3));
        geo.translate(x, g + (tipped ? 0.3 : 0.44), z);
        pushGeo(rng.pick(M.barrels), geo);
        col.addBox({ x: x - 0.3, y: g, z: z - 0.3 }, { x: x + 0.3, y: g + (tipped ? 0.6 : 0.88), z: z + 0.3 }, 'metal');
      }
    }
    // loot round the plant, and Husks picking over it
    addContainer(['crate', 'locker', 'weapon_case'], R.x - 18, 0, R.z - 1);
    addContainer(['crate', 'medical'], R.x + 11, 0, R.z - 20);
    addContainer(['crate', 'husk_pod'], R.x - 4, 0, R.z + 22);
    enemySpawns.push({ type: 'skitter', x: R.x - 10, z: R.z + 12, radius: 14, count: 3 });
    enemySpawns.push({ type: 'buzzer', x: R.x + 10, z: R.z - 10, radius: 22, count: 1 });
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
    addContainer(['weapon_case', 'crate', 'locker'], x + 10, g, z - 6);
    enemySpawns.push({ type: 'buzzer', x, z, radius: 30, count: 2 });
    enemySpawns.push({ type: 'watcher', x: x - 30, z: z - 20, radius: 30 });
  }

  // ---------- scattered Husk probes and camps ----------
  for (let i = 0; i < 10; i++) {
    const x = rng.range(-190, 190);
    const z = rng.range(-190, 190);
    if (Math.hypot(x - TOWN.x, z - TOWN.z) < 90 || Math.hypot(x - REFINERY.x, z - REFINERY.z) < 48 || Math.hypot(x - FACTORY.x, z - FACTORY.z) < 62) continue;
    const g = ground(x, z);
    // probe pod half-buried
    box(M.huskHull, x, g + 0.5, z, 1.4, 1.4, 2.2, { rotY: rng.range(0, 3), rotX: 0.3, tag: 'metal' });
    box(M.huskGlow, x, g + 1.3, z, 0.25, 0.25, 0.25, { collide: false });
    addContainer(['husk_pod', 'husk_pod', 'crate'], x + 1.6, g, z);
    if (rng.chance(0.6)) enemySpawns.push({ type: rng.pick(['skitter', 'skitter', 'buzzer']), x, z, radius: 16, count: rng.int(1, 3) });
  }
  const stoneGeo = new THREE.DodecahedronGeometry(1, 0);

  // ---------- Crucible Works: the robot factory (south of the West Lift) ----------
  // A walled plant where the Crucible AI builds its Husks. Stretches of the
  // outer wall have fallen; survivors have built shacks, towers and nests into
  // the ones still standing. Four big buildings each make one kind of part.
  {
    const F = FACTORY;
    const HW = 35; // half width (x)
    const HD = 30; // half depth (z)
    const at = (dx, dz) => [F.x + dx, F.z + dz, ground(F.x + dx, F.z + dz)];
    const WALL_H = 4.5;
    const SEG = 5;
    const factorySign = (lines, x, y, z, rotY, w = 6, h = 1.5) => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 128;
      const g2 = c.getContext('2d');
      g2.fillStyle = '#1d1c1a';
      g2.fillRect(0, 0, 512, 128);
      g2.fillStyle = '#ff6a20';
      g2.fillRect(0, 0, 512, 10);
      g2.fillStyle = '#f4ead8';
      g2.textAlign = 'center';
      g2.font = '800 54px "Barlow Condensed", "Arial Narrow", sans-serif';
      g2.fillText(lines[0], 256, 66);
      g2.fillStyle = '#ff9a5a';
      g2.font = '600 28px "Barlow Condensed", "Arial Narrow", sans-serif';
      g2.fillText(lines[1], 256, 106);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 }));
      m.position.set(x, y, z);
      m.rotation.y = rotY;
      scene.add(m);
    };

    // ---- the outer wall: four sides of 5 m segments; gates east and north
    const sides = [
      { axis: 'x', fixed: -HD, from: -HW, to: HW, inward: 1, gate: 0 }, // north (z-)
      { axis: 'x', fixed: HD, from: -HW, to: HW, inward: -1, gate: null }, // south
      { axis: 'z', fixed: -HW, from: -HD, to: HD, inward: 1, gate: null }, // west
      { axis: 'z', fixed: HW, from: -HD, to: HD, inward: -1, gate: 0 }, // east, facing the town
    ];
    const built = [];
    for (const side of sides) {
      for (let t = side.from + SEG / 2; t < side.to; t += SEG) {
        if (side.gate !== null && Math.abs(t - side.gate) < SEG) continue; // gateway
        const [x, z, g] = side.axis === 'x' ? at(t, side.fixed) : at(side.fixed, t);
        const sx = side.axis === 'x' ? SEG : 0.6;
        const sz = side.axis === 'x' ? 0.6 : SEG;
        if (rng.chance(0.4)) {
          // fallen: a stub and rubble
          const h = rng.range(0.4, 1.6);
          box(M.concreteDark, x, g + h / 2, z, sx, h, sz);
          for (let k = 0; k < 4; k++) geoAt(M.concrete, stoneGeo, x + rng.range(-2, 2) * (side.axis === 'x' ? 1 : 0.2), g + 0.2, z + rng.range(-2, 2) * (side.axis === 'z' ? 1 : 0.2), rng.range(0, 6), rng.range(0.3, 0.7));
          continue;
        }
        box(M.concrete, x, g + WALL_H / 2 - 0.3, z, sx, WALL_H + 0.6, sz);
        box(M.stripe, x, g + WALL_H - 0.6, z, sx + 0.02, 0.25, sz + 0.02, { collide: false });
        if (rng.chance(0.38)) built.push({ side, t, x, z, g });
      }
    }
    // ---- what survivors built into the standing wall (on its inside face)
    for (const b of built) {
      const { side } = b;
      const n = side.inward; // which way is "inside"
      // local frame: u along the wall, v away from it, inward
      const P = (u, v) => (side.axis === 'x' ? [b.x + u, b.z + v * n] : [b.x + v * n, b.z + u]);
      const rotY = side.axis === 'x' ? 0 : Math.PI / 2;
      const kind = rng.pick(['shack', 'tower', 'shanty', 'nest']);
      if (kind === 'shack') {
        // a lean-to: corrugated roof sloping off the wall, plank side walls, a cache inside
        for (const u of [-2.2, 2.2]) {
          const [px, pz] = P(u, 1.6);
          box(M.wood, px, b.g + 1.2, pz, side.axis === 'x' ? 0.12 : 3.2, 2.4, side.axis === 'x' ? 3.2 : 0.12);
        }
        const [rx, rz] = P(0, 1.6);
        const roof = new THREE.BoxGeometry(4.8, 0.06, 3.6);
        roof.rotateX(-0.28);
        if (n < 0) roof.rotateY(Math.PI);
        roof.rotateY(rotY);
        roof.translate(rx, b.g + 2.85, rz);
        pushGeo(M.corrugated, roof);
        const [cx, cz] = P(-1, 1.2);
        addContainer(['crate', 'locker', 'medical'], cx, 0, cz, rotY, true);
      } else if (kind === 'tower') {
        // a scaffold watchtower against the wall with a sandbagged platform
        for (const [u, v] of [[-1.2, 0.6], [1.2, 0.6], [-1.2, 3], [1.2, 3]]) {
          const [px, pz] = P(u, v);
          box(M.wood, px, b.g + 3.3, pz, 0.18, 6.6, 0.18, { tag: 'wood' });
        }
        const [px, pz] = P(0, 1.8);
        box(M.wood, px, b.g + 5.2, pz, side.axis === 'x' ? 2.8 : 2.8, 0.15, 2.8);
        for (const [u, v, w, d] of [[0, 3.1, 2.6, 0.4], [-1.25, 1.8, 0.4, 2.6], [1.25, 1.8, 0.4, 2.6]]) {
          const [sx2, sz2] = P(u, v);
          const ww = side.axis === 'x' ? w : d;
          const dd = side.axis === 'x' ? d : w;
          box(M.sandbag, sx2, b.g + 5.55, sz2, ww, 0.55, dd);
        }
        const tg = new THREE.BoxGeometry(3.2, 0.05, 3.2);
        tg.translate(px, b.g + 7.0, pz);
        pushGeo(rng.pick(M.tarp), tg);
        for (let k = 0; k < 9; k++) {
          const [lx, lz] = P(-1.2, 3.25);
          box(M.wood, lx, b.g + 0.5 + k * 0.55, lz, 0.5, 0.06, 0.06, { rotY, collide: false });
        }
      } else if (kind === 'shanty') {
        // a container cabin bolted to the wall: door, window, a painted mark
        const [px, pz] = P(0, 1.5);
        const w = side.axis === 'x' ? 4.4 : 2.6;
        const d = side.axis === 'x' ? 2.6 : 4.4;
        box(rng.pick(M.containerColors), px, b.g + 1.3, pz, w, 2.6, d, { tag: 'metal' });
        const [dx2, dz2] = P(1.2, 2.82);
        box(M.darkMetal, dx2, b.g + 1.0, dz2, side.axis === 'x' ? 0.9 : 0.05, 1.9, side.axis === 'x' ? 0.05 : 0.9, { collide: false });
        const [wx, wz] = P(-1.0, 2.82);
        box(M.glass, wx, b.g + 1.6, wz, side.axis === 'x' ? 0.9 : 0.05, 0.6, side.axis === 'x' ? 0.05 : 0.9, { collide: false });
        const [cx, cz] = P(1.2, 3.5);
        addContainer(['crate', 'locker'], cx, 0, cz, rotY, true);
      } else {
        // a sandbag nest with a catwalk along the wall top
        const [px, pz] = P(0, 0.9);
        box(M.wood, px, b.g + WALL_H - 0.5, pz, side.axis === 'x' ? SEG : 1.2, 0.15, side.axis === 'x' ? 1.2 : SEG, { collide: false });
        for (const u of [-1.6, 0, 1.6]) {
          const [sx2, sz2] = P(u, 1.6);
          box(M.sandbag, sx2, b.g + 0.35, sz2, side.axis === 'x' ? 1.4 : 0.6, 0.7, side.axis === 'x' ? 0.6 : 1.4);
        }
      }
    }

    // ---- a building shell: four walls (a big door on one side) and a roof
    const hall = (dx, dz, w, d, h, doorSide, material, roof = true) => {
      const [cx, cz, g0] = at(dx, dz);
      const g = Math.min(g0, ground(cx - w / 2, cz - d / 2), ground(cx + w / 2, cz + d / 2)) - 0.2;
      const t = 0.5;
      const doorW = 5;
      const doorH = 5;
      const wallRun = (axis, fixed, len, hasDoor) => {
        const segs = hasDoor ? [[-len / 2, -doorW / 2], [doorW / 2, len / 2]] : [[-len / 2, len / 2]];
        for (const [a, bb] of segs) {
          const mid = (a + bb) / 2;
          const L = bb - a;
          if (axis === 'x') box(material, cx + mid, g + h / 2, cz + fixed, L, h, t, { tag: 'metal' });
          else box(material, cx + fixed, g + h / 2, cz + mid, t, h, L, { tag: 'metal' });
        }
        if (hasDoor) {
          if (axis === 'x') box(material, cx, g + doorH + (h - doorH) / 2, cz + fixed, doorW, h - doorH, t);
          else box(material, cx + fixed, g + doorH + (h - doorH) / 2, cz, t, h - doorH, doorW);
          // hazard-striped door frame
          if (axis === 'x') box(M.stripe, cx, g + doorH + 0.15, cz + fixed, doorW + 0.4, 0.3, t + 0.05, { collide: false });
          else box(M.stripe, cx + fixed, g + doorH + 0.15, cz, t + 0.05, 0.3, doorW + 0.4, { collide: false });
        }
      };
      wallRun('x', -d / 2, w, doorSide === 'n');
      wallRun('x', d / 2, w, doorSide === 's');
      wallRun('z', -w / 2, d, doorSide === 'w');
      wallRun('z', w / 2, d, doorSide === 'e');
      if (roof) box(M.darkMetal, cx, g + h + 0.15, cz, w + 0.4, 0.3, d + 0.4, { tag: 'metal' });
      box(M.concreteDark, cx, g + 0.05, cz, w, 0.1, d, { collide: false });
      return { cx, cz, g };
    };

    // 1. Casting Hall: hull plating. A furnace glows inside; two chimneys.
    {
      const { cx, cz, g } = hall(-17, -14, 20, 14, 9, 's', M.rust);
      box(M.darkMetal, cx - 5, g + 1.8, cz - 4, 4, 3.6, 3);
      box(M.forge, cx - 5, g + 1.4, cz - 2.48, 2, 1.2, 0.05, { collide: false });
      const ladle = new THREE.CylinderGeometry(1.1, 0.8, 1.2, 14);
      ladle.translate(cx + 1, g + 3.6, cz - 3);
      pushGeo(M.darkMetal, ladle);
      box(M.forge, cx + 1, g + 4.2, cz - 3, 1.6, 0.05, 1.6, { collide: false });
      for (let k = 0; k < 4; k++) box(M.huskHull, cx + 4 + (k % 2) * 1.6, g + 0.15 + Math.floor(k / 2) * 0.12, cz + 2, 1.4, 0.1, 2.2, { rotY: k * 0.2, collide: false });
      for (const ox of [-6, -2]) {
        const ch = new THREE.CylinderGeometry(0.8, 1.0, 16, 12);
        ch.translate(cx + ox, g + 8, cz - 5);
        pushGeo(M.rust, ch);
        col.addBox({ x: cx + ox - 0.9, y: g, z: cz - 5.9 }, { x: cx + ox + 0.9, y: g + 16, z: cz - 4.1 }, 'metal');
        box(M.forge, cx + ox, g + 16.05, cz - 5, 1.2, 0.1, 1.2, { collide: false });
      }
      const furnace = new THREE.PointLight(0xff6a20, 25, 16, 2);
      furnace.position.set(cx - 5, g + 2, cz - 1);
      scene.add(furnace);
      lights.push(furnace);
      factorySign(['CASTING HALL', 'HULL PLATING · SHELLS'], cx, g + 7.2, cz + 7.27, 0);
      addContainer(['husk_pod', 'crate'], cx + 6, 0, cz - 4);
      addContainer(['weapon_case', 'locker'], cx - 8, 0, cz + 4);
    }
    // 2. Optics Lab: eyes and sensors. Racks of glowing eyes; a dish on the roof.
    {
      const { cx, cz, g } = hall(18, -15, 14, 12, 6, 's', M.concrete);
      const eyeGeo = new THREE.SphereGeometry(0.12, 10, 8);
      for (let r = 0; r < 3; r++) {
        box(M.darkMetal, cx - 4 + r * 4, g + 1.2, cz - 4.6, 3, 2.4, 0.6);
        for (let k = 0; k < 12; k++) geoAt(M.huskGlow, eyeGeo, cx - 5.2 + r * 4 + (k % 6) * 0.48, g + 0.6 + Math.floor(k / 6) * 0.9, cz - 4.25, 0, 1);
      }
      const dish = new THREE.SphereGeometry(2.2, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.35);
      dish.rotateX(-0.9);
      dish.translate(cx + 3, g + 7.4, cz - 2);
      pushGeo(M.metal, dish);
      box(M.darkMetal, cx + 3, g + 6.6, cz - 2, 0.3, 1.2, 0.3, { collide: false });
      factorySign(['OPTICS LAB', 'EYES · SENSORS · LENSES'], cx, g + 5.2, cz + 6.27, 0, 5, 1.25);
      addContainer(['husk_pod', 'crate', 'locker'], cx - 3, 0, cz + 2);
    }
    // 3. Actuator Works: legs and joints. Sawtooth roof, a conveyor of limbs.
    {
      const { cx, cz, g } = hall(-16, 15, 22, 12, 7, 'n', M.concrete, false);
      for (let k = 0; k < 4; k++) {
        const r = new THREE.BoxGeometry(5.6, 0.2, 12.4);
        r.rotateZ(0.32);
        r.translate(cx - 8.3 + k * 5.5, g + 7.9, cz);
        pushGeo(M.corrugated, r);
        box(M.glass, cx - 5.6 + k * 5.5, g + 7.9, cz, 0.1, 1.8, 12, { collide: false });
      }
      col.addBox({ x: cx - 11, y: g + 7, z: cz - 6 }, { x: cx + 11, y: g + 9, z: cz + 6 }, 'metal');
      box(M.darkMetal, cx, g + 0.5, cz + 1, 16, 1, 1.6);
      box(M.stripe, cx, g + 1.02, cz + 1, 16, 0.04, 1.2, { collide: false });
      for (let k = 0; k < 7; k++) {
        const lx = cx - 7 + k * 2.3;
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(lx, g + 1.1, cz + 1), new THREE.Vector3(lx + 0.5, g + 1.6, cz + 1.2), new THREE.Vector3(lx + 1, g + 1.1, cz + 0.8));
        pushGeo(M.darkMetal, new THREE.TubeGeometry(curve, 8, 0.07, 6));
      }
      factorySign(['ACTUATOR WORKS', 'LEGS · JOINTS · LIMBS'], cx, g + 6, cz - 6.27, Math.PI, 6, 1.5);
      addContainer(['crate', 'weapon_case'], cx + 8, 0, cz - 3);
      addContainer(['husk_pod', 'locker'], cx - 8, 0, cz + 3.5);
    }
    // 4. Core Assembly: cores. A dome over a glowing core column.
    {
      const { cx, cz, g } = hall(18, 14, 14, 14, 3.5, 'n', M.concreteDark, false);
      const dome = new THREE.SphereGeometry(7.6, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.scale(1, 0.75, 1);
      dome.translate(cx, g + 3.5, cz);
      pushGeo(M.metal, dome);
      col.addBox({ x: cx - 6, y: g + 6.5, z: cz - 6 }, { x: cx + 6, y: g + 9.2, z: cz + 6 }, 'metal');
      const core = new THREE.CylinderGeometry(0.9, 0.9, 5, 18);
      core.translate(cx, g + 2.5, cz);
      pushGeo(M.huskGlow, core);
      col.addBox({ x: cx - 1, y: g, z: cz - 1 }, { x: cx + 1, y: g + 5, z: cz + 1 }, 'metal');
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(cx + Math.cos(a) * 0.9, g + 4.5, cz + Math.sin(a) * 0.9), new THREE.Vector3(cx + Math.cos(a) * 4, g + 6, cz + Math.sin(a) * 4), new THREE.Vector3(cx + Math.cos(a) * 6.5, g + 0.3, cz + Math.sin(a) * 6.5));
        pushGeo(M.darkMetal, new THREE.TubeGeometry(curve, 12, 0.1, 6));
      }
      const glow = new THREE.PointLight(0xff6a20, 18, 14, 2);
      glow.position.set(cx, g + 3, cz);
      scene.add(glow);
      lights.push(glow);
      factorySign(['CORE ASSEMBLY', 'CORES · MINDS'], cx, g + 3.0, cz - 7.27, Math.PI, 5, 1.25);
      addContainer(['husk_pod', 'weapon_case'], cx + 4, 0, cz + 4);
    }

    // ---- the yard: a gantry crane, piles of parts, conveyor runs, a gate sign
    {
      const [x, z, g] = at(0, 0);
      for (const ox of [-9, 9]) for (const oz of [-2.5, 2.5]) box(M.stripe, x + ox, g + 4, z + oz, 0.5, 8, 0.5, { tag: 'metal' });
      box(M.stripe, x, g + 8, z - 2.5, 18.5, 0.6, 0.6, { collide: false });
      box(M.stripe, x, g + 8, z + 2.5, 18.5, 0.6, 0.6, { collide: false });
      box(M.darkMetal, x + 2, g + 7.6, z, 1.2, 0.8, 5.4, { collide: false });
      box(M.darkMetal, x + 2, g + 5.5, z, 0.05, 4, 0.05, { collide: false });
      box(M.huskHull, x + 2, g + 3.2, z, 2.2, 1.0, 3.0, { rotY: 0.3, collide: false });
      // part piles
      for (const [dx, dz] of [[-5, 6], [6, -5], [4, 7]]) {
        const [px, pz, pg] = at(dx, dz);
        for (let k = 0; k < 6; k++) box(M.huskHull, px + rng.range(-1, 1), pg + 0.15 + k * 0.14, pz + rng.range(-1, 1), 1.4, 0.12, 1.8, { rotY: rng.range(0, 3), collide: k === 0 });
      }
      const [gx, gz, gg] = at(HW + 0.5, 0);
      factorySign(['CRUCIBLE WORKS', 'THE NETWORK PROVIDES'], gx + 0.4, gg + 6.2, gz, Math.PI / 2, 7, 1.75);
      box(M.darkMetal, gx, gg + 6.2, gz + 4, 0.4, 12.4, 0.4, { tag: 'metal' });
      box(M.darkMetal, gx, gg + 6.2, gz - 4, 0.4, 12.4, 0.4, { tag: 'metal' });
      box(M.darkMetal, gx, gg + 7.2, gz, 0.3, 0.3, 8.4, { collide: false });
    }
    addContainer(['husk_pod', 'crate'], F.x + 8, 0, F.z + 4);
    addContainer(['crate', 'weapon_case'], F.x - 6, 0, F.z - 4);
    // the plant is busy
    enemySpawns.push({ type: 'skitter', x: F.x, z: F.z, radius: 20, count: 4 });
    enemySpawns.push({ type: 'skitter', x: F.x - 16, z: F.z + 15, radius: 10, count: 3 });
    enemySpawns.push({ type: 'buzzer', x: F.x + 10, z: F.z - 10, radius: 25, count: 2 });
    enemySpawns.push({ type: 'watcher', x: F.x, z: F.z, radius: 30 });
  }

  const campSpots = [];
  // raider camps: a sloped tarp on four posts over a cache (always stocked),
  // with what's left of their gear round it, and sometimes a broken-down car
  for (let i = 0; i < 8; i++) {
    const x = rng.range(-180, 180);
    const z = rng.range(-180, 180);
    if (Math.hypot(x - TOWN.x, z - TOWN.z) < 100 || Math.hypot(x - REFINERY.x, z - REFINERY.z) < 48 || Math.hypot(x - FACTORY.x, z - FACTORY.z) < 62) continue;
    const g = ground(x, z);
    campSpots.push({ x, z });
    const ry = rng.range(0, Math.PI);
    const c = Math.cos(ry);
    const sn = Math.sin(ry);
    const P = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c];
    // posts reach the tarp at each corner: higher at the back, lower at the front
    const hBack = 2.9;
    const hFront = 2.1;
    for (const [lx, lz] of [[-2.1, -2], [2.1, -2], [-2.1, 2], [2.1, 2]]) {
      const [px, pz] = P(lx, lz);
      const gp = ground(px, pz);
      const top = g + (lz < 0 ? hBack : hFront);
      box(M.wood, px, (gp + top) / 2 - 0.1, pz, 0.15, top - gp + 0.2, 0.15);
    }
    const run = Math.hypot(4, hBack - hFront);
    const tarpGeo = new THREE.BoxGeometry(4.5, 0.05, run + 0.3);
    tarpGeo.rotateX(Math.atan2(hBack - hFront, 4));
    tarpGeo.rotateY(ry);
    tarpGeo.translate(x, g + (hBack + hFront) / 2 + 0.03, z);
    pushGeo(rng.pick(M.campTarp), tarpGeo);
    // the cache underneath
    const [cx, cz] = P(-0.6, -0.4);
    addContainer(['crate', 'locker', 'medical', 'weapon_case'], cx, 0, cz, ry, true);
    // their stuff: a few of these under and round the tarp
    const props = [
      () => { // gas cans
        for (let k = 0; k < rng.int(2, 4); k++) {
          const [px, pz] = P(1.2 + k * 0.32, -1.2 + rng.range(-0.2, 0.2));
          box(M.gasCan, px, ground(px, pz) + 0.19, pz, 0.18, 0.38, 0.28, { rotY: ry + rng.range(-0.3, 0.3), collide: false });
        }
      },
      () => { // a stack of tyres
        const [px, pz] = P(-1.5, 1.2);
        for (let k = 0; k < rng.int(2, 4); k++) {
          const t = new THREE.TorusGeometry(0.34, 0.13, 8, 16);
          t.rotateX(Math.PI / 2);
          t.translate(px, ground(px, pz) + 0.13 + k * 0.25, pz);
          pushGeo(M.darkMetal, t);
        }
        col.addBox({ x: px - 0.45, y: ground(px, pz), z: pz - 0.45 }, { x: px + 0.45, y: ground(px, pz) + 0.8, z: pz + 0.45 }, 'wood');
      },
      () => { // a fire pit
        const [px, pz] = P(0.4, 3.4);
        const gp = ground(px, pz);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          geoAt(M.rock, stoneGeo, px + Math.cos(a) * 0.55, gp + 0.08, pz + Math.sin(a) * 0.55, a, 0.16);
        }
        for (const r of [0.4, -0.5]) box(M.wood, px, gp + 0.1, pz, 0.9, 0.12, 0.12, { rotY: r, collide: false });
        box(M.forge, px, gp + 0.05, pz, 0.35, 0.06, 0.35, { collide: false });
      },
      () => { // a hand cart
        const [px, pz] = P(1.5, 0.6);
        const gp = ground(px, pz);
        box(M.wood, px, gp + 0.55, pz, 0.9, 0.12, 1.4, { rotY: ry });
        for (const lx of [-0.5, 0.5]) {
          const [wx, wz] = P(1.5 + lx, 0.6);
          box(M.darkMetal, wx, gp + 0.3, wz, 0.08, 0.6, 0.6, { rotY: ry, collide: false });
        }
        const [hx, hz] = P(1.5, 1.6);
        box(M.wood, hx, gp + 0.7, hz, 0.06, 0.06, 0.9, { rotY: ry, rotX: 0.3, collide: false });
      },
      () => { // bedrolls
        for (const lx of [-1.4, -0.8]) {
          const [px, pz] = P(lx, 1.0);
          const b = new THREE.CapsuleGeometry(0.22, 1.3, 4, 10);
          b.rotateX(Math.PI / 2);
          b.rotateY(ry);
          b.translate(px, ground(px, pz) + 0.18, pz);
          pushGeo(rng.pick(M.tarp), b);
        }
      },
      () => { // a crate stack
        const [px, pz] = P(1.4, -1.0);
        const gp = ground(px, pz);
        box(M.wood, px, gp + 0.35, pz, 0.7, 0.7, 0.7, { rotY: ry });
        if (rng.chance(0.6)) box(M.wood, px, gp + 1.0, pz, 0.6, 0.6, 0.6, { rotY: ry + 0.4 });
      },
    ];
    for (let k = props.length - 1; k > 0; k--) {
      const j = rng.int(0, k);
      [props[k], props[j]] = [props[j], props[k]];
    }
    props.slice(0, rng.int(3, 5)).forEach((f) => f());
    // a broken-down car next to some camps (with its own boot to search)
    if (rng.chance(0.6)) {
      const [vx, vz] = P(rng.chance(0.5) ? 5.5 : -5.5, rng.range(-1, 2));
      car(vx, vz, ry + rng.range(-0.6, 0.6));
    }
  }

  // Lifts and drop points stay clear so nothing spawns inside them.
  const KEEP_CLEAR = [[-40, -195], [REFINERY.x, REFINERY.z], [30, 195], [-195, -20], [-170, 150], [170, -170], [-160, -170], [175, 175], [-200, 60], [80, 200]];
  const onRoad = (x, z, pad) => (Math.abs(z - TOWN.z) < 5 + pad && Math.abs(x - TOWN.x) < 175) || (Math.abs(x - TOWN.x) < 5 + pad && Math.abs(z - TOWN.z) < 175);
  const nearBox = [];
  const infraSites = [];
  // true if (x,z) is free of other colliders (buildings, walls, earlier rocks) and loot
  const clearAt = (x, z, r) => {
    if (KEEP_CLEAR.some(([cx, cz]) => Math.hypot(x - cx, z - cz) < 9 + r)) return false;
    if (Math.hypot(x - REFINERY.x, z - REFINERY.z) < 44) return false; // the refinery yard stays industrial
    if (Math.abs(x - FACTORY.x) < 40 && Math.abs(z - FACTORY.z) < 35) return false; // and so does the factory
    if (infraSites.some((s) => Math.hypot(x - s.x, z - s.z) < 9 + r)) return false;
    if (containers.some((c) => Math.hypot(x - c.x, z - c.z) < 1.6 + r)) return false;
    const m = r + 0.8;
    for (const b of col.query(x - m, z - m, x + m, z + m, nearBox)) {
      if (x + m > b.min.x && x - m < b.max.x && z + m > b.min.z && z - m < b.max.z) return false;
    }
    return true;
  };
  // ---------- Husk Network build sites ----------
  // Open ground the network can build on between raids (see network.js):
  // Bulwarks where the raider fights them, Cradles where they're left alone.
  for (let i = 0; i < 600 && infraSites.length < 30; i++) {
    const x = rng.range(-MAP_HALF + 30, MAP_HALF - 30);
    const z = rng.range(-MAP_HALF + 30, MAP_HALF - 30);
    if (Math.hypot(x - TOWN.x, z - TOWN.z) < 70 || onRoad(x, z, 5)) continue;
    if (infraSites.some((s) => Math.hypot(s.x - x, s.z - z) < 38)) continue;
    if (!clearAt(x, z, 7.5)) continue;
    const index = infraSites.length;
    infraSites.push({ x, z, y: ground(x, z), rot: rng.range(0, Math.PI * 2) });
    // a Cradle's pods; only filled when the network builds one here
    containers.push({ pool: ['husk_pod'], type: 'husk_pod', x: x + 3.4, y: 0, z: z + 1.2, rotY: 0, infra: index });
    containers.push({ pool: ['husk_pod'], type: 'husk_pod', x: x - 2.6, y: 0, z: z - 2.6, rotY: 0, infra: index });
  }

  // ---------- rocks and trees ----------
  // Boulders: lumpy (noise-displaced), half-buried, moss on the upward faces,
  // a scatter of pebbles round the big ones.
  const rockShapes = [];
  for (let v = 0; v < 6; v++) {
    const geo = displace(new THREE.IcosahedronGeometry(1, 1), 0.55, 1.2, v * 3.1).toNonIndexed();
    const n = geo.attributes.normal;
    const p = geo.attributes.position;
    const cols = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const tone = 0.82 + (noise3(p.getX(i) * 2, p.getY(i) * 2, p.getZ(i) * 2 + v) - 0.5) * 0.3;
      const moss = Math.max(0, Math.min(1, (n.getY(i) - 0.55) * 3)) * (0.5 + noise3(p.getX(i) * 3, v, p.getZ(i) * 3) * 0.5);
      cols[i * 3] = tone * (1 - moss * 0.45);
      cols[i * 3 + 1] = tone * (1 - moss * 0.12);
      cols[i * 3 + 2] = tone * (1 - moss * 0.6);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    rockShapes.push(geo);
  }
  // the collider matches the rock: about 0.8 of its size around, as tall as it shows
  function rock(x, z, s, collide = true) {
    const g = ground(x, z);
    const geo = rng.pick(rockShapes).clone();
    const sy = s * rng.range(0.6, 0.85);
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, g + sy * 0.35, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.15, 0.15), rng.range(0, 6), rng.range(-0.15, 0.15))), new THREE.Vector3(s * rng.range(0.85, 1.2), sy, s * rng.range(0.85, 1.2))));
    pushGeo(M.rock, geo);
    if (!collide) return;
    const r = s * 0.8;
    col.addBox({ x: x - r, y: g - 1, z: z - r }, { x: x + r, y: g + sy * 1.3, z: z + r }, 'rock');
  }
  const rockSpots = [];
  for (let i = 0, placed = 0; i < 900 && placed < 260; i++) {
    const x = rng.range(-MAP_HALF + 10, MAP_HALF - 10);
    const z = rng.range(-MAP_HALF + 10, MAP_HALF - 10);
    const inTown = Math.hypot(x - TOWN.x, z - TOWN.z) < 105;
    if (inTown && rng.chance(0.65)) continue;
    if (onRoad(x, z, 1.5)) continue;
    const s = inTown ? rng.range(0.6, 1.6) : rng.range(0.8, 3.6);
    if (!clearAt(x, z, s)) continue;
    rock(x, z, s);
    placed++;
    if (s > 1.6) rockSpots.push({ x, z, s });
    // pebbles round it
    for (let k = rng.int(2, 6); k > 0; k--) {
      const a = rng.range(0, Math.PI * 2);
      const d = s * rng.range(0.9, 1.6);
      rock(x + Math.cos(a) * d, z + Math.sin(a) * d, rng.range(0.12, 0.3), false);
    }
    // boulder fields: a few smaller rocks huddled around the big ones
    if (s > 2.2 && rng.chance(0.6)) {
      for (let k = rng.int(1, 3); k > 0; k--) {
        const a = rng.range(0, Math.PI * 2);
        const s2 = rng.range(0.7, 1.6);
        const x2 = x + Math.cos(a) * (s + s2) * 0.85;
        const z2 = z + Math.sin(a) * (s + s2) * 0.85;
        if (!onRoad(x2, z2, 1) && clearAt(x2, z2, s2 * 0.5)) rock(x2, z2, s2);
      }
    }
  }
  // caches stashed in the lee of big boulders
  for (const r of rockSpots) {
    if (!rng.chance(0.3)) continue;
    const a = rng.range(0, Math.PI * 2);
    const x = r.x + Math.cos(a) * (r.s * 0.8 + 1.1);
    const z = r.z + Math.sin(a) * (r.s * 0.8 + 1.1);
    if (clearAt(x, z, 0.6)) addContainer(['crate', 'crate', 'medical', 'locker', 'husk_pod'], x, 0, z, rng.pick([0, Math.PI / 2]));
  }

  // Trees: conifers (tapered trunk, tiers of ragged foliage), broadleafs
  // (leaning trunk, branches, a cluster of leafy crowns) and dead snags.
  const leafShapes = [0, 1, 2, 3].map((v) => displace(new THREE.IcosahedronGeometry(1, 1), 0.45, 1.6, 10 + v * 2.3).toNonIndexed());
  const tierShapes = [0, 1, 2].map((v) => displace(new THREE.ConeGeometry(1, 1, 9, 2), 0.18, 2.2, 30 + v).toNonIndexed());
  // shade foliage: darker underneath and inside, lighter on top
  const shadeFoliage = (geo, cy, r) => {
    const p = geo.attributes.position;
    const cols = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const k = 0.62 + 0.38 * Math.max(0, Math.min(1, (p.getY(i) - cy) / r * 0.5 + 0.5));
      cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = k;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return geo;
  };
  // a limb from (x,y,z), tilted out by `tilt` towards `yaw`
  const limb = (material, x, y, z, len, r0, r1, tilt, yaw) => {
    const geo = new THREE.CylinderGeometry(r1, r0, len, 6);
    geo.translate(0, len / 2, 0);
    geo.rotateZ(tilt);
    geo.rotateY(yaw);
    geo.translate(x, y, z);
    pushGeo(material, geo);
    // the far end, for hanging things off it
    return new THREE.Vector3(x + Math.cos(yaw) * Math.sin(tilt) * -len, y + Math.cos(tilt) * len, z + Math.sin(yaw) * Math.sin(tilt) * len);
  };
  const deadWood = mat(0x7a7064);
  deadWood.map = weather;
  for (let i = 0, placed = 0; i < 1400 && placed < 480; i++) {
    const x = rng.range(-MAP_HALF + 5, MAP_HALF - 5);
    const z = rng.range(-MAP_HALF + 5, MAP_HALF - 5);
    const inTown = Math.abs(x - TOWN.x) < 110 && Math.abs(z - TOWN.z) < 110;
    if (inTown && rng.chance(0.75)) continue;
    if (onRoad(x, z, 2)) continue;
    if (!clearAt(x, z, 0.8)) continue;
    placed++;
    const g = ground(x, z);
    const h = rng.range(5, 11);
    col.addBox({ x: x - 0.35, y: g - 1, z: z - 0.35 }, { x: x + 0.35, y: g + h * 0.6, z: z + 0.35 }, 'wood');
    const leaves = rng.pick(M.leaves);
    // foliage that hangs below head height is solid too
    const canopy = (cx, cz, bottom, top, r) => {
      if (bottom - g < 2.3) col.addBox({ x: cx - r, y: bottom, z: cz - r }, { x: cx + r, y: top, z: cz + r }, 'wood');
    };
    const kind = rng.next();
    const lean = rng.range(-0.08, 0.08);
    const leanYaw = rng.range(0, Math.PI * 2);
    if (kind < 0.45) {
      // conifer
      limb(M.trunk, x, g - 0.3, z, h * 0.95, 0.24, 0.05, lean, leanYaw);
      const tiers = 4;
      for (let t = 0; t < tiers; t++) {
        const r = h * 0.3 * (1 - t * 0.2);
        const th = h * (0.42 - t * 0.05);
        const cy = g + h * 0.28 + t * h * 0.17;
        const geo = rng.pick(tierShapes).clone();
        geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x + Math.sin(lean) * cy * 0.1, cy + th / 2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.range(0, 6), 0)), new THREE.Vector3(r, th, r)));
        pushGeo(leaves, shadeFoliage(geo, cy + th / 2, th));
      }
      canopy(x, z, g + h * 0.28, g + h * 0.55, h * 0.3 * 0.6);
    } else if (kind < 0.86) {
      // broadleaf: trunk, a few branches, crowns at their ends
      const top = limb(M.trunk, x, g - 0.3, z, h * 0.62, 0.26, 0.13, lean, leanYaw);
      const crowns = [top];
      for (let b = 0; b < rng.int(2, 4); b++) {
        const yaw = rng.range(0, Math.PI * 2);
        const by = g + h * rng.range(0.35, 0.55);
        crowns.push(limb(M.trunk, x, by, z, h * rng.range(0.25, 0.38), 0.11, 0.04, rng.range(0.6, 1.0), yaw));
      }
      for (const c of crowns) {
        const r = h * rng.range(0.16, 0.24);
        const geo = rng.pick(leafShapes).clone();
        geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(c.x, c.y + r * 0.3, c.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, 3), rng.range(0, 6), 0)), new THREE.Vector3(r * 1.15, r * 0.85, r * 1.15)));
        pushGeo(leaves, shadeFoliage(geo, c.y + r * 0.3, r));
      }
      canopy(x, z, g + h * 0.5, g + h * 0.75, h * 0.18);
    } else {
      // a dead snag: grey, bare, a few broken limbs (decay)
      const th = h * rng.range(0.55, 0.85);
      limb(deadWood, x, g - 0.3, z, th, 0.22, 0.06, lean * 2, leanYaw);
      for (let b = 0; b < rng.int(2, 5); b++) limb(deadWood, x, g + th * rng.range(0.35, 0.85), z, h * rng.range(0.12, 0.3), 0.07, 0.02, rng.range(0.5, 1.2), rng.range(0, Math.PI * 2));
    }
  }

  // ---------- bushes ----------
  // Cover for stealth: you can walk and shoot through them, but Husks can't see
  // through them. Three sizes: low scrub (hides you crouched), shrubs (hide you
  // standing) and thickets.
  const BUSH_SIZES = [
    { r: 0.75, h: 0.55, count: 430 },
    { r: 1.2, h: 0.95, count: 300 },
    { r: 2.0, h: 1.45, count: 110 },
  ];
  const bushes = [];
  for (const size of BUSH_SIZES) {
    for (let i = 0, placed = 0; i < size.count * 6 && placed < size.count; i++) {
      const x = rng.range(-MAP_HALF + 8, MAP_HALF - 8);
      const z = rng.range(-MAP_HALF + 8, MAP_HALF - 8);
      const inTown = Math.hypot(x - TOWN.x, z - TOWN.z) < 100;
      if (inTown && rng.chance(0.5)) continue;
      if (onRoad(x, z, 1)) continue;
      const r = size.r * rng.range(0.8, 1.25);
      if (!clearAt(x, z, r * 0.6)) continue;
      // keep them from piling into each other
      if (bushes.some((b) => Math.hypot(b.x - x, b.z - z) < (b.r + r) * 0.8)) continue;
      bushes.push({ x, y: ground(x, z), z, r, h: size.h * rng.range(0.85, 1.2) });
      placed++;
    }
  }
  buildBushes(scene, bushes, rng);

  // ---------- extraction lifts ----------
  const liftSpots = [
    { name: 'North Lift', x: -40, z: -195 },
    { name: 'Refinery Lift', x: REFINERY.x, z: REFINERY.z },
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

  // ---------- town Husk presence ----------
  enemySpawns.push({ type: 'skitter', x: TOWN.x - 30, z: TOWN.z + 30, radius: 20, count: 3 });
  enemySpawns.push({ type: 'skitter', x: TOWN.x + 40, z: TOWN.z - 30, radius: 20, count: 2 });
  enemySpawns.push({ type: 'buzzer', x: TOWN.x - 40, z: TOWN.z - 40, radius: 25, count: 2 });
  enemySpawns.push({ type: 'watcher', x: TOWN.x, z: TOWN.z, radius: 50 });
  enemySpawns.push({ type: 'buzzer', x: TOWN.x + 60, z: TOWN.z + 60, radius: 25, count: 1 });
  enemySpawns.push({ type: 'skitter', x: TOWN.x + 50, z: TOWN.z - 70, radius: 20, count: 3 });

  // invisible walls at the map border
  const W = MAP_HALF;
  col.addBox({ x: -W - 5, y: -50, z: -W - 5 }, { x: W + 5, y: 200, z: -W }, 'wall');
  col.addBox({ x: -W - 5, y: -50, z: W }, { x: W + 5, y: 200, z: W + 5 }, 'wall');
  col.addBox({ x: -W - 5, y: -50, z: -W }, { x: -W, y: 200, z: W }, 'wall');
  col.addBox({ x: W, y: -50, z: -W }, { x: W + 5, y: 200, z: W }, 'wall');

  // ---------- dirt paths: worn trails between places, fading out at their ends ----------
  const trailMask = [];
  {
    const roadNear = (x, z) => (Math.abs(z - TOWN.z) < Math.abs(x - TOWN.x) ? [Math.max(TOWN.x - 165, Math.min(TOWN.x + 165, x)), TOWN.z + Math.sign(z - TOWN.z) * 5.5] : [TOWN.x + Math.sign(x - TOWN.x) * 5.5, Math.max(TOWN.z - 165, Math.min(TOWN.z + 165, z))]);
    const trails = [
      [[-150, -3], [-152, 20], [-140, 40], [-122, 70], [-112, 95]], // gas station -> the factory's east gate
      [[-150, 68], [-165, 40], [-180, 10], [-193, -12]], // factory north gate -> West Lift
      [[148, -4], [156, 25], [160, 50], [164, 68]], // road -> the refinery
      [[150, 116], [158, 100], [163, 86]], // radio tower -> refinery
      [[-20, 158], [5, 178], [26, 190]], // road -> South Lift
      [[-20, -172], [-30, -186], [-38, -192]], // road -> North Lift
      [[-128, -104], [-124, -60], [-121, -16]], // farmhouse -> road
      [[110, -52], [108, -30], [110, -15]], // container yard -> road
      [[40, -138], [10, -125], [-14, -115]], // the crashed hull -> road
    ];
    for (const c of campSpots) {
      const [rx, rz] = roadNear(c.x, c.z);
      if (Math.hypot(rx - c.x, rz - c.z) < 120) trails.push([[c.x, c.z], [(c.x + rx) / 2 + rng.range(-12, 12), (c.z + rz) / 2 + rng.range(-12, 12)], [rx, rz]]);
    }
    // a few that go nowhere in particular
    for (let i = 0; i < 6; i++) {
      let x = rng.range(-180, 180);
      let z = rng.range(-180, 180);
      const pts = [[x, z]];
      let a = rng.range(0, Math.PI * 2);
      for (let k = 0; k < 4; k++) {
        a += rng.range(-0.7, 0.7);
        x += Math.cos(a) * rng.range(12, 22);
        z += Math.sin(a) * rng.range(12, 22);
        pts.push([x, z]);
      }
      trails.push(pts);
    }
    scene.add(buildTrails(trails, rng, trailMask));
  }

  // ---------- merge static geometry ----------
  for (const [material, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    // a copy that reads the grime shading (the original stays usable for loose meshes)
    const shaded = material.clone();
    shaded.vertexColors = true;
    if (M.leaves.includes(material)) addWind(shaded, 'canopy');
    if (M.campTarp.includes(material)) addWind(shaded, 'cloth');
    const mesh = new THREE.Mesh(merged, shaded);
    mesh.castShadow = material !== M.glass && material !== M.ivy;
    mesh.receiveShadow = true;
    scene.add(mesh);
    for (const g of geos) g.dispose();
  }

  // ---------- grass and ferns (instanced, follow the raider, sway in the wind) ----------
  const foliage = [];
  {
    const trailGrid = new Map();
    for (const t of trailMask) {
      const k = Math.floor(t[0] / 4) * 1000 + Math.floor(t[1] / 4);
      if (!trailGrid.has(k)) trailGrid.set(k, []);
      trailGrid.get(k).push(t);
    }
    const found = [];
    const clear = (x, z) => {
      if (onRoad(x, z, 0.5)) return true;
      const h = terrainHeight(x, z);
      // nothing grows on the bare rock of the high ground
      if (h > 22) return true;
      const slope = Math.hypot(terrainHeight(x + 1, z) - terrainHeight(x - 1, z), terrainHeight(x, z + 1) - terrainHeight(x, z - 1)) / 2;
      if (slope > 0.6) return true;
      // worn trails
      const kx = Math.floor(x / 4);
      const kz = Math.floor(z / 4);
      for (let ix = kx - 1; ix <= kx + 1; ix++) {
        for (let iz = kz - 1; iz <= kz + 1; iz++) {
          for (const t of trailGrid.get(ix * 1000 + iz) ?? []) if ((t[0] - x) ** 2 + (t[1] - z) ** 2 < t[2] * t[2]) return true;
        }
      }
      // floors, slabs, rocks: anything sitting on the ground here
      for (const bx of col.query(x, z, x, z, found)) {
        if (x > bx.min.x && x < bx.max.x && z > bx.min.z && z < bx.max.z && bx.min.y < h + 0.4 && bx.max.y > h - 0.3) return true;
      }
      return false;
    };
    // quality.grass sets the density: Low 2500, Medium 5000, High 9000
    const density = (opts.grass ?? 9000) / 9000;
    const radius = 5;
    foliage.push(new GrassField(scene, { perCell: Math.round(60 + density * 240), radius, clear }));
    foliage.push(new GrassField(scene, { perCell: Math.round(8 + density * 16), radius, clear, kind: 'fern' }));
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

  return { collision: col, containers, enemySpawns, extractions, insertions, lights, infraSites, sightCover: new SightCover(bushes), town: TOWN, foliage };
}

// Dirt trails: soft-edged ribbons draped over the terrain, wandering a little,
// patchy, and fading out over their first and last stretch.
// trailMask (optional) collects [x, z, halfWidth] along each trail so grass keeps off it.
function buildTrails(trails, rng, trailMask) {
  const pos = [];
  const colors = [];
  const index = [];
  for (const pts of trails) {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const len = curve.getLength();
    const n = Math.max(4, Math.round(len / 1.2));
    const width = rng.range(0.9, 1.5);
    const fade = Math.min(14, len * 0.3);
    const base = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      // wander side to side a little
      const wob = (noise3(p.x * 0.08, 0, p.z * 0.08) - 0.5) * 1.6;
      const nx = -tan.z;
      const nz = tan.x;
      const cx = p.x + nx * wob;
      const cz = p.z + nz * wob;
      const w = width * (0.75 + noise3(p.x * 0.3, 5, p.z * 0.3) * 0.5);
      if (trailMask) trailMask.push([cx, cz, w * 0.7]);
      const d = t * len;
      const ends = Math.min(1, d / fade, (len - d) / fade);
      const alpha = Math.max(0, ends) * (0.7 + noise3(p.x * 0.5, 9, p.z * 0.5) * 0.3);
      for (const [o, a] of [[-1.35, 0], [-0.75, alpha * 0.7], [0.75, alpha * 0.7], [1.35, 0]]) {
        const x = cx + nx * w * o;
        const z = cz + nz * w * o;
        pos.push(x, terrainHeight(x, z) + 0.1, z);
        const tone = 0.9 + noise3(x * 0.9, 2, z * 0.9) * 0.2;
        colors.push(tone, tone, tone, a);
      }
      if (i > 0) {
        const r0 = base + (i - 1) * 4;
        const r1 = base + i * 4;
        for (let k = 0; k < 3; k++) index.push(r0 + k, r1 + k, r0 + k + 1, r0 + k + 1, r1 + k, r1 + k + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geo.setIndex(index);
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5e4a35, vertexColors: true, transparent: true, depthWrite: false, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  return mesh;
}

// The GAS lettering along the canopy edge, faded.
function gasSign(scene, x, y, z) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#c4672f';
  g.fillRect(0, 0, 512, 64);
  g.fillStyle = '#f4ead8';
  g.font = '800 46px "Barlow Condensed", Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('DUSTLINE  FUEL  ·  GAS  ·  DIESEL', 256, 48);
  g.fillStyle = 'rgba(60,40,20,0.35)';
  for (let i = 0; i < 30; i++) g.fillRect(Math.random() * 512, 0, 2 + Math.random() * 10, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 0.66), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  m.position.set(x, y, z);
  scene.add(m);
}

// A tall roadside price board with a few numbers fallen off.
function priceSign(scene, x, y, z) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 320;
  const g = c.getContext('2d');
  g.fillStyle = '#1d1c1a';
  g.fillRect(0, 0, 256, 320);
  g.fillStyle = '#c4672f';
  g.fillRect(0, 0, 256, 70);
  g.fillStyle = '#f4ead8';
  g.textAlign = 'center';
  g.font = '800 54px "Barlow Condensed", Arial, sans-serif';
  g.fillText('FUEL', 128, 54);
  g.font = '700 40px "Barlow Condensed", Arial, sans-serif';
  [['REG', '9.  9'], ['DSL', '  .49'], ['RATION', '— —']].forEach(([a, b], i) => {
    g.textAlign = 'left';
    g.fillText(a, 18, 130 + i * 70);
    g.textAlign = 'right';
    g.fillStyle = '#f2c14e';
    g.fillText(b, 238, 130 + i * 70);
    g.fillStyle = '#f4ead8';
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3, 0.25), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
  m.position.set(x, y, z);
  m.rotation.y = Math.PI / 2;
  scene.add(m);
}

// A street sign on a pole, faded and rust-spotted. lean: how far it's bent over.
function streetSign(scene, kind, x, y, z, facing, lean, rng) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const paint = (fill, stroke) => {
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = stroke;
    g.stroke();
  };
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '800 30px "Barlow Condensed", Arial, sans-serif';
  if (kind === 'stop' || kind === 'noentry') {
    g.beginPath();
    for (let i = 0; i < 8; i++) g.lineTo(64 + Math.cos((i / 8) * Math.PI * 2 + Math.PI / 8) * 58, 64 + Math.sin((i / 8) * Math.PI * 2 + Math.PI / 8) * 58);
    g.closePath();
    paint('#a8281e', '#e8e0d0');
    if (kind === 'noentry') {
      g.fillStyle = '#e8e0d0';
      g.fillRect(28, 56, 72, 16);
    } else {
      g.fillStyle = '#e8e0d0';
      g.fillText('STOP', 64, 66);
    }
  } else if (kind === 'warning' || kind === 'curve') {
    g.beginPath();
    g.moveTo(64, 6);
    g.lineTo(122, 64);
    g.lineTo(64, 122);
    g.lineTo(6, 64);
    g.closePath();
    paint('#d8a830', '#1d1c1a');
    g.fillStyle = '#1d1c1a';
    g.font = '800 54px "Barlow Condensed", Arial, sans-serif';
    g.fillText(kind === 'curve' ? '↱' : '!', 64, 68);
  } else {
    g.beginPath();
    g.rect(10, 6, 108, 116);
    paint(kind === 'distance' ? '#2f6a4a' : '#e8e0d0', '#1d1c1a');
    g.fillStyle = kind === 'distance' ? '#e8e0d0' : '#1d1c1a';
    if (kind === 'speed') {
      g.font = '700 20px "Barlow Condensed", Arial, sans-serif';
      g.fillText('SPEED LIMIT', 64, 28);
      g.font = '800 54px "Barlow Condensed", Arial, sans-serif';
      g.fillText(rng.pick(['30', '45', '55']), 64, 78);
    } else {
      g.font = '700 22px "Barlow Condensed", Arial, sans-serif';
      g.fillText('DUSTLINE', 64, 38);
      g.fillText(`${rng.int(2, 40)} km`, 64, 66);
      g.fillText('LIFT ▸', 64, 94);
    }
  }
  // fade, rust spots and grime
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(200,190,170,0.25)';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${110 + Math.random() * 40},60,30,${0.2 + Math.random() * 0.5})`;
    g.beginPath();
    g.arc(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 6, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0x6b6f72, metalness: 0.6, roughness: 0.6 }));
  pole.position.y = 1.2;
  group.add(pole);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, metalness: 0.2 }));
  plate.position.set(0, 2.2, 0.05);
  group.add(plate);
  group.position.set(x, y, z);
  group.rotation.set(0, facing, 0);
  group.rotateZ(lean); // bent over by a car, or by years of wind
  scene.add(group);
}

// Bushes are drawn as clumps of a few leafy blobs, all in one instanced mesh.
function buildBushes(scene, bushes, rng) {
  // a ragged leafy blob, darker underneath (vertex colours x each instance's colour)
  const geo = displace(new THREE.IcosahedronGeometry(1, 2), 0.38, 2.4, 7.7);
  const p = geo.attributes.position;
  const shade = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = 0.55 + 0.45 * Math.max(0, Math.min(1, p.getY(i) * 0.6 + 0.5)) - noise3(p.getX(i) * 4, p.getY(i) * 4, p.getZ(i) * 4) * 0.15;
    shade[i * 3] = shade[i * 3 + 1] = shade[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(shade, 3));
  const mat = addWind(new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true, vertexColors: true }), 'bush');
  const mesh = new THREE.InstancedMesh(geo, mat, bushes.length * 3);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  let n = 0;
  for (const b of bushes) {
    // one main blob plus two smaller ones offset to the sides
    const blobs = [[0, 0, 1, 1], [0.55, 0.35, 0.62, 0.8], [-0.5, -0.4, 0.58, 0.72]];
    for (const [ox, oz, rs, hs] of blobs) {
      const a = rng.range(0, Math.PI * 2);
      const px = b.x + (ox * Math.cos(a) - oz * Math.sin(a)) * b.r;
      const pz = b.z + (ox * Math.sin(a) + oz * Math.cos(a)) * b.r;
      e.set(0, rng.range(0, 6), 0);
      m.compose(new THREE.Vector3(px, b.y + b.h * hs * 0.75, pz), q.setFromEuler(e), new THREE.Vector3(b.r * rs, b.h * hs, b.r * rs));
      mesh.setMatrixAt(n, m);
      mesh.setColorAt(n, col.setHSL(0.25 + rng.range(-0.04, 0.03), 0.5, rng.range(0.14, 0.21)));
      n++;
    }
  }
  mesh.count = n;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// Line-of-sight cover that isn't solid: Husks can't see through it, but
// bullets and the raider pass straight through. Each bush is an ellipsoid.
const COVER_CELL = 16;
class SightCover {
  constructor(bushes) {
    this.bushes = bushes;
    this.grid = new Map();
    for (const b of bushes) {
      for (let ix = Math.floor((b.x - b.r) / COVER_CELL); ix <= Math.floor((b.x + b.r) / COVER_CELL); ix++) {
        for (let iz = Math.floor((b.z - b.r) / COVER_CELL); iz <= Math.floor((b.z + b.r) / COVER_CELL); iz++) {
          const k = ix * 10000 + iz;
          if (!this.grid.has(k)) this.grid.set(k, []);
          this.grid.get(k).push(b);
        }
      }
    }
    this.stamp = 0;
  }

  // Does foliage hide b from a? (both {x,y,z})
  blocks(a, b) {
    this.stamp++;
    const x0 = Math.floor(Math.min(a.x, b.x) / COVER_CELL);
    const x1 = Math.floor(Math.max(a.x, b.x) / COVER_CELL);
    const z0 = Math.floor(Math.min(a.z, b.z) / COVER_CELL);
    const z1 = Math.floor(Math.max(a.z, b.z) / COVER_CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const cell = this.grid.get(ix * 10000 + iz);
        if (!cell) continue;
        for (const bush of cell) {
          if (bush.mark === this.stamp) continue;
          bush.mark = this.stamp;
          if (segmentHitsBush(a, b, bush)) return true;
        }
      }
    }
    return false;
  }
}

// Segment vs ellipsoid: squash y so the bush becomes a sphere, then test.
// The leafy part sits from the ground up to about 1.5x its half-height.
function segmentHitsBush(a, b, bush) {
  const sy = bush.r / bush.h;
  const cy = bush.y + bush.h * 0.75;
  const ax = a.x - bush.x;
  const ay = (a.y - cy) * sy;
  const az = a.z - bush.z;
  const dx = b.x - a.x;
  const dy = (b.y - a.y) * sy;
  const dz = b.z - a.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy + az * dz) / len2)) : 0;
  const px = ax + dx * t;
  const py = ay + dy * t;
  const pz = az + dz * t;
  return px * px + py * py + pz * pz < bush.r * bush.r * 0.8;
}

// A curved Network billboard: a strip of a cylinder with a slogan on it.
function networkBoard(scene, [line1, line2], x, y, z, facing) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e3d6';
  g.fillRect(0, 0, 1024, 256);
  g.fillStyle = '#b8321f';
  g.fillRect(0, 0, 1024, 22);
  g.fillRect(0, 234, 1024, 22);
  // the Network's eye
  g.beginPath();
  g.arc(120, 128, 70, 0, Math.PI * 2);
  g.fillStyle = '#1d1c1a';
  g.fill();
  g.beginPath();
  g.arc(120, 128, 26, 0, Math.PI * 2);
  g.fillStyle = '#ff6a20';
  g.fill();
  g.fillStyle = '#1d1c1a';
  g.textBaseline = 'middle';
  g.font = '800 64px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.fillText(line1, 225, 100, 770);
  g.fillStyle = '#5a554c';
  g.font = '600 38px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.fillText(line2, 228, 172, 770);
  // years of weather: water stains running down, and paper torn away in patches
  for (let i = 0; i < 26; i++) {
    const sx = Math.random() * 1024;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, 'rgba(70,52,30,0)');
    grad.addColorStop(1, `rgba(70,52,30,${0.12 + Math.random() * 0.2})`);
    g.fillStyle = grad;
    g.fillRect(sx, Math.random() * 120, 6 + Math.random() * 30, 256);
  }
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    const tx = Math.random() * 1024;
    const ty = Math.random() < 0.5 ? 0 : 256;
    g.moveTo(tx, ty);
    for (let k = 0; k < 7; k++) g.lineTo(tx + (Math.random() - 0.3) * 140, ty + (ty ? -1 : 1) * Math.random() * 110);
    g.closePath();
    g.globalCompositeOperation = 'destination-out';
    g.fill();
    g.globalCompositeOperation = 'source-over';
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const R = 9;
  const arc = 5.6 / R;
  const geo = new THREE.CylinderGeometry(R, R, 1.6, 18, 1, true, -arc / 2, arc);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12, alphaTest: 0.5, side: THREE.DoubleSide }));
  // the cylinder's axis sits behind the board so its outside faces the road
  mesh.position.set(x - Math.sin(facing) * R, y + 3.1, z - Math.cos(facing) * R);
  mesh.rotation.y = facing;
  mesh.castShadow = true;
  scene.add(mesh);
  const backGeo = new THREE.CylinderGeometry(R - 0.06, R - 0.06, 1.75, 18, 1, true, -arc / 2 - 0.01, arc + 0.02);
  const back = new THREE.Mesh(backGeo, new THREE.MeshStandardMaterial({ color: 0x2e3236, roughness: 0.6, metalness: 0.6, side: THREE.BackSide }));
  back.position.copy(mesh.position);
  back.rotation.y = facing;
  scene.add(back);
}

function hash2(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
