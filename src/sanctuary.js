// The Patron's Sanctuary: an old mine shaft turned survivalist town under the
// Dustline. The raider's quarters are shown behind the menus and are
// walkable when exploring. A door leads to a hallway with the Trade Hall,
// the Workshop, the Checkout (pick where to deploy) and the Lift topside.
//
// Layout (metres, floor at y = 0, ceiling 3.4):
//   your room      x -4..4,     z -3.5..3.5   (front wall only while exploring)
//   hallway        x -5..33,    z -6.6..-3.6
//   Trade Hall     x -0.5..9,   z -15..-6.6   door at x 4
//   Workshop       x 9..19,     z -15..-6.6   door at x 14
//   Checkout       x 19..28.5,  z -15..-6.6   door at x 23.75
//   Lift           x 33..36.5,  z -6.6..-3.6  at the east end of the hallway

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { poseRig, buildRaiderModel } from './rig.js';
import { Player, buildGunModel } from './player.js';
import { Collision } from './collision.js';
import { TRADERS, BENCH_SECTIONS } from './config.js';

const H = 3.4;

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0.05, ...opts });
}

// A sign painted on a canvas.
function signTexture(lines, opts = {}) {
  const c = document.createElement('canvas');
  c.width = opts.w || 512;
  c.height = opts.h || 160;
  const g = c.getContext('2d');
  g.fillStyle = opts.bg || '#1d1c1a';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = opts.edge || '#ea6a2c';
  g.lineWidth = 8;
  g.strokeRect(6, 6, c.width - 12, c.height - 12);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const line of lines) {
    g.font = `${line.weight || 800} ${line.size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.fillStyle = line.color || opts.fg || '#f4ead8';
    g.fillText(line.text, c.width / 2, line.y);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- procedural surface textures (world-scaled on big surfaces) ----------
function canvasTex(size, paint) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const rnd = (() => {
  let s = 7;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
})();
// rough rock: mottled stone with strata and cracks
function rockTexture(base) {
  return canvasTex(256, (g, n) => {
    g.fillStyle = base;
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 260; i++) {
      const r = 4 + rnd() * 26;
      g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${0.05 + rnd() * 0.12})` : `rgba(255,240,220,${0.03 + rnd() * 0.07})`;
      g.beginPath();
      // draw each blob three times so it wraps across the tile edges
      for (const [ox, oy] of [[0, 0], [n, 0], [0, n]]) g.ellipse((rnd() * n + ox) % n, (rnd() * n + oy) % n, r, r * (0.4 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(0,0,0,${0.06 + rnd() * 0.06})`;
      g.fillRect(0, rnd() * n, n, 2 + rnd() * 6); // strata
    }
    g.strokeStyle = 'rgba(20,14,10,0.55)';
    for (let i = 0; i < 14; i++) {
      g.lineWidth = 1 + rnd() * 1.5;
      g.beginPath();
      let x = rnd() * n;
      let y = rnd() * n;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) g.lineTo((x += (rnd() - 0.5) * 50), (y += rnd() * 30));
      g.stroke();
    }
  });
}
// packed earth with grit
function dirtTexture() {
  return canvasTex(256, (g, n) => {
    g.fillStyle = '#4a3f33';
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${rnd() * 0.25})` : `rgba(200,170,130,${rnd() * 0.15})`;
      const r = 0.6 + rnd() * 2.2;
      g.fillRect(rnd() * n, rnd() * n, r, r);
    }
  });
}
// steel diamond plate
function plateTexture() {
  return canvasTex(128, (g, n) => {
    g.fillStyle = '#4f5254';
    g.fillRect(0, 0, n, n);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    for (let y = 0; y < n; y += 16) {
      for (let x = (y / 16) % 2 ? 8 : 0; x < n; x += 16) {
        g.save();
        g.translate(x + 4, y + 8);
        g.rotate(0.6);
        g.fillRect(-5, -1.2, 10, 2.4);
        g.restore();
      }
    }
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(90,60,40,${rnd() * 0.18})`; // rust and grime
      g.fillRect(rnd() * n, rnd() * n, 3, 3);
    }
  });
}
// a material whose texture tiles every `tile` metres on big surfaces
function surface(tex, tile, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: opts.bump ?? 1.2, roughness: opts.roughness ?? 0.95, metalness: opts.metalness ?? 0.02, color: opts.color ?? 0xffffff });
  m.userData.tile = tile;
  return m;
}
// Scale a box's UVs to its size, so textures keep a real-world scale.
function worldUV(geo, sx, sy, sz, tile) {
  const uv = geo.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]]; // +x -x +y -y +z -z faces
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  }
}

// Glowing neon lettering on a transparent board.
function neonSign(text, color, w = 512, h = 128, size = 78) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.font = `800 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 22;
  g.fillStyle = color;
  for (let i = 0; i < 3; i++) g.fillText(text, w / 2, h / 2 + 4);
  g.shadowBlur = 0;
  g.fillStyle = '#fffaf0';
  g.globalAlpha = 0.85;
  g.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
}

const ROOMS = [
  { name: "PATRON'S SANCTUARY", test: (x, z) => z > -3.55 },
  { name: 'TRADE HALL', test: (x, z) => z < -6.6 && x < 9 },
  { name: 'WORKSHOP', test: (x, z) => z < -6.6 && x < 19 },
  { name: 'CHECKOUT', test: (x, z) => z < -6.6 },
  { name: 'LIFT', test: (x) => x > 33 },
  { name: 'HALLWAY', test: () => true },
];

export class Sanctuary {
  constructor(quality) {
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.background = new THREE.Color(0x15130f);
    scene.fog = new THREE.Fog(0x15130f, 14, 30);
    this.camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.05, 80);
    this.col = new Collision(() => 0);
    this.time = 0;
    this.look = 0;
    this.lookTimer = 3;
    this.interactables = [];
    this.npcs = [];
    this.exploring = false;

    // hewn rock walls and ceilings, packed-earth floors, steel plate in the workshop
    const rock = rockTexture('#6e6457');
    const M = {
      concrete: surface(rock, 2.2, { color: 0xd8d0c4 }),
      plaster: surface(rock, 2.2, { color: 0xf0dcc4 }),
      hall: surface(rock, 2.2, { color: 0xc8beb0 }),
      floor: surface(dirtTexture(), 2.5, { bump: 0.6 }),
      tile: surface(plateTexture(), 1.2, { bump: 0.5, roughness: 0.6, metalness: 0.4 }),
      ceiling: surface(rock, 2.6, { color: 0x8a8074 }),
      timber: mat(0x5a4128, { roughness: 0.95 }),
      steel: mat(0x45494c, { metalness: 0.6, roughness: 0.5 }),
      shade: mat(0x45494c, { metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }),
      rust: mat(0x7a4a2a, { metalness: 0.4, roughness: 0.8 }),
      wood: mat(0x6b4c30),
      darkWood: mat(0x3f2d1e),
      metal: mat(0x5f6468, { metalness: 0.5, roughness: 0.5 }),
      fabric: mat(0x2f6f6a),
      blanket: mat(0xc4672f),
      rug: mat(0x7a3328),
      teal: mat(0x2f8f8a),
      orange: mat(0xc4672f),
      glowTeal: new THREE.MeshStandardMaterial({ color: 0x0e3b36, emissive: 0x30ffc0, emissiveIntensity: 0.9 }),
      glowWarm: new THREE.MeshBasicMaterial({ color: 0xffe0b0 }),
    };
    this.M = M;

    // ---------- helpers ----------
    // furniture-sized boxes get rounded edges; walls and floors stay crisp
    const box = (material, x, y, z, sx, sy, sz, { collide = true, rot = [0, 0, 0], shadow = false } = {}) => {
      const small = Math.max(sx, sy, sz) < 3 && Math.min(sx, sy, sz) > 0.05;
      const geo = small ? new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(0.05, Math.min(sx, sy, sz) * 0.3)) : new THREE.BoxGeometry(sx, sy, sz);
      if (!small && material.userData.tile) worldUV(geo, sx, sy, sz, material.userData.tile);
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.rotation.set(...rot);
      m.castShadow = shadow;
      m.receiveShadow = true;
      scene.add(m);
      if (collide) this.col.addBox({ x: x - sx / 2, y: y - sy / 2, z: z - sz / 2 }, { x: x + sx / 2, y: y + sy / 2, z: z + sz / 2 });
      return m;
    };
    // A wall along x (at z) or along z (at x), with door gaps [{at, w}].
    const wallX = (material, z, x0, x1, doors = [], t = 0.2) => {
      let cur = x0;
      for (const d of [...doors].sort((a, b) => a.at - b.at)) {
        const a = d.at - d.w / 2;
        if (a > cur) box(material, (cur + a) / 2, H / 2, z, a - cur, H, t);
        box(material, d.at, H - 0.35, z, d.w, 0.7, t); // lintel
        cur = d.at + d.w / 2;
      }
      if (x1 > cur) box(material, (cur + x1) / 2, H / 2, z, x1 - cur, H, t);
    };
    const wallZ = (material, x, z0, z1, doors = [], t = 0.2) => {
      let cur = z0;
      for (const d of [...doors].sort((a, b) => a.at - b.at)) {
        const a = d.at - d.w / 2;
        if (a > cur) box(material, x, H / 2, (cur + a) / 2, t, H, a - cur);
        box(material, x, H - 0.35, d.at, t, 0.7, d.w);
        cur = d.at + d.w / 2;
      }
      if (z1 > cur) box(material, x, H / 2, (cur + z1) / 2, t, H, z1 - cur);
    };
    const floor = (material, x0, x1, z0, z1) => {
      box(material, (x0 + x1) / 2, -0.05, (z0 + z1) / 2, x1 - x0, 0.1, z1 - z0, { collide: false });
      box(M.ceiling, (x0 + x1) / 2, H + 0.07, (z0 + z1) / 2, x1 - x0, 0.15, z1 - z0);
    };
    const sign = (lines, x, y, z, w, h, rotY = 0, opts = {}) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: signTexture(lines, opts), roughness: 0.7 }));
      m.position.set(x, y, z);
      m.rotation.y = rotY;
      scene.add(m);
      return m;
    };
    // a caged work lamp hanging on its cable
    const lamp = (x, z, intensity = 9, dist = 9) => {
      const l = new THREE.PointLight(0xffc38a, intensity, dist, 1.7);
      l.position.set(x, H - 0.55, z);
      scene.add(l);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), M.glowWarm);
      bulb.position.copy(l.position);
      scene.add(bulb);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.45, 4), M.steel);
      cord.position.set(x, H - 0.3, z);
      scene.add(cord);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.1, 14, 1, true), M.shade);
      shade.position.set(x, H - 0.47, z);
      scene.add(shade);
      for (const dy of [-0.05, -0.12]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.006, 4, 16), M.steel);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(x, H - 0.55 + dy + 0.05, z);
        scene.add(ring);
      }
      return l;
    };
    const interact = (kind, x, z, label, data = {}) => this.interactables.push({ kind, x, z, label, ...data });

    // ---------- your room ----------
    floor(M.floor, -4, 4, -3.5, 3.5);
    wallX(M.plaster, -3.5, -4, 4, [{ at: -2.0, w: 1.2 }]);
    wallZ(M.concrete, -4, -3.5, 3.5);
    wallZ(M.concrete, 4, -3.5, 3.5);
    // front wall: only there while exploring (the menus look in from here)
    this.frontWall = box(M.concrete, 0, H / 2, 3.6, 8.2, H, 0.2);
    this.frontWall.visible = false;
    for (let i = -3; i <= 3; i++) box(M.darkWood, i * 1.2, H - 0.12, 0, 0.18, 0.18, 7, { collide: false });
    // no windows down here: a round monitor shows the topside camera feed
    {
      const wx = 2.6;
      const wz = -3.39;
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d');
      const sky = g.createLinearGradient(0, 0, 0, 256);
      sky.addColorStop(0, '#3a4a5a');
      sky.addColorStop(0.55, '#e8935a');
      sky.addColorStop(1, '#5a3a30');
      g.fillStyle = sky;
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#2a1e1a'; // the Dustline skyline
      g.beginPath();
      g.moveTo(0, 256);
      for (let x = 0; x <= 256; x += 16) g.lineTo(x, 150 + Math.sin(x * 0.05) * 14 - (x % 48 < 20 ? 28 : 0));
      g.lineTo(256, 256);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.18)'; // scanlines
      for (let y = 0; y < 256; y += 4) g.fillRect(0, y, 256, 2);
      g.font = '700 22px "Barlow Condensed", Arial, sans-serif';
      g.fillStyle = '#9effe0';
      g.fillText('CAM 03 · TOPSIDE', 60, 52);
      g.fillStyle = '#ff4a3a';
      g.beginPath();
      g.arc(46, 45, 6, 0, Math.PI * 2);
      g.fill();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const screen = new THREE.Mesh(new THREE.CircleGeometry(0.75, 40), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      screen.position.set(wx, 2.15, wz);
      scene.add(screen);
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.08, 8, 32), M.metal);
      frame.position.set(wx, 2.15, wz + 0.03);
      scene.add(frame);
    }
    sign([{ text: "PATRON'S SANCTUARY", size: 62, y: 66 }, { text: 'REST · REARM · RETURN', size: 30, weight: 600, y: 118, color: '#cfc3ad' }], 0.2, 2.85, -3.38, 2.2, 0.6);
    // bed, nightstand, lamp
    box(M.metal, -2.9, 0.25, -1.4, 1.0, 0.1, 2.1);
    box(M.fabric, -2.9, 0.38, -1.4, 0.95, 0.16, 2.0, { collide: false });
    box(M.blanket, -2.9, 0.5, -1.1, 1.0, 0.08, 1.3, { collide: false, rot: [0.02, 0, 0.03] });
    box(mat(0xe0d6c2), -2.9, 0.52, -2.2, 0.6, 0.12, 0.3, { collide: false });
    box(M.wood, -3.4, 0.3, 0.2, 0.5, 0.6, 0.5);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.18, 12, 1, true), mat(0xd8b54a, { side: THREE.DoubleSide }));
    shade.position.set(-3.4, 0.86, 0.2);
    scene.add(shade);
    // stash locker (interactive) and footlocker
    box(mat(0x5f7f86, { metalness: 0.4, roughness: 0.6 }), 3.4, 1.0, -2.6, 0.8, 2.0, 0.6, { shadow: true });
    box(M.glowTeal, 2.99, 1.35, -2.6, 0.02, 0.25, 0.35, { collide: false });
    sign([{ text: 'STASH', size: 70, y: 82 }], 2.98, 1.85, -2.6, 0.5, 0.17, -Math.PI / 2, { w: 300, h: 160 });
    interact('stash', 2.6, -2.6, 'Open your stash & loadout');
    box(mat(0x55603a), 2.6, 0.22, 0.6, 1.1, 0.44, 0.6);
    // weapon rack on the back wall
    box(M.darkWood, -0.4, 1.95, -3.34, 1.4, 0.08, 0.1, { collide: false });
    box(M.darkWood, -0.4, 1.45, -3.34, 1.4, 0.08, 0.1, { collide: false });
    this.rack = new THREE.Group();
    this.rack.position.set(-0.4, 1.7, -3.22);
    scene.add(this.rack);
    // rug, posters, plant
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.4, 28), M.rug);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.01, 0.2);
    rug.receiveShadow = true;
    scene.add(rug);
    sign([{ text: '◉', size: 160, y: 120, color: '#1d1c1a' }, { text: 'THE DUSTLINE', size: 40, y: 260 }], -3.88, 1.8, 1.6, 0.9, 1.25, Math.PI / 2, { w: 300, h: 420, bg: '#2f8f8a', edge: '#1d1c1a' });
    sign([{ text: '◉', size: 160, y: 120, color: '#1d1c1a' }, { text: 'KEEP YOUR PLATING', size: 34, y: 260 }], 3.88, 1.8, 1.0, 0.9, 1.25, -Math.PI / 2, { w: 300, h: 420, bg: '#c4672f', edge: '#1d1c1a' });
    box(mat(0x7a4a2a), -3.4, 0.2, 2.6, 0.4, 0.4, 0.4);
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), mat(0x5f7a35, { flatShading: true }));
    leaves.position.set(-3.4, 0.75, 2.6);
    scene.add(leaves);
    // room light: a spotlight shadow (one pass) plus a soft fill
    const bulb = new THREE.SpotLight(0xffc38a, 30, 9, 1.25, 0.7, 1.6);
    bulb.position.set(0, H - 0.7, 0.4);
    bulb.target.position.set(0, 0, 0.4);
    bulb.castShadow = !!quality.shadows;
    bulb.shadow.mapSize.set(1024, 1024);
    bulb.shadow.bias = -0.002;
    scene.add(bulb, bulb.target);
    this.bulb = bulb;
    const fill = new THREE.PointLight(0xffc38a, 8, 7, 1.8);
    fill.position.set(0, H - 0.75, 0.4);
    scene.add(fill);
    const bulbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), M.glowWarm);
    bulbMesh.position.copy(bulb.position);
    scene.add(bulbMesh);
    const windowLight = new THREE.SpotLight(0xff9a60, 14, 10, 0.6, 0.6, 1.5);
    windowLight.position.set(2.6, 2.2, -3.1);
    windowLight.target.position.set(1.0, 0, 0.8);
    scene.add(windowLight, windowLight.target);
    scene.add(new THREE.HemisphereLight(0xffe2c0, 0x2a2018, 0.8));
    this.player = new Player(scene, this.col);

    // ---------- hallway ----------
    floor(M.tile, -5, 33, -6.6, -3.6);
    wallX(M.hall, -3.6, -5, -4); // stub west of your room
    wallX(M.hall, -3.6, 4, 33);
    wallX(M.hall, -6.6, -5, 33, [{ at: 4, w: 1.8 }, { at: 14, w: 1.8 }, { at: 23.75, w: 1.8 }]);
    wallZ(M.hall, -5, -6.6, -3.6);
    // stripe along the walls, pipes overhead
    box(M.orange, 18.5, 1.05, -3.72, 29, 0.12, 0.03, { collide: false });
    // the north stripe stops at each doorway
    {
      let cur = -5;
      for (const at of [4, 14, 23.75, 33]) {
        const end = at === 33 ? 33 : at - 0.9;
        if (end > cur) box(M.orange, (cur + end) / 2, 1.05, -6.48, end - cur, 0.12, 0.03, { collide: false });
        cur = at + 0.9;
      }
    }
    box(M.metal, 14, H - 0.25, -6.3, 38, 0.12, 0.12, { collide: false });
    box(M.metal, 14, H - 0.4, -6.3, 38, 0.08, 0.08, { collide: false });
    lamp(0, -5.1);
    lamp(9, -5.1);
    lamp(18.5, -5.1);
    lamp(28, -5.1);
    sign([{ text: 'TRADE HALL', size: 70, y: 82 }], 4, 2.75, -6.48, 1.8, 0.5, 0, { w: 420, h: 160 });
    sign([{ text: 'WORKSHOP', size: 70, y: 82 }], 14, 2.75, -6.48, 1.8, 0.5, 0, { w: 420, h: 160 });
    sign([{ text: 'CHECKOUT', size: 70, y: 82 }], 23.75, 2.75, -6.48, 1.8, 0.5, 0, { w: 420, h: 160 });
    sign([{ text: 'LIFT ▸ TOPSIDE', size: 64, y: 82 }], 30, 2.75, -3.72, 2.0, 0.5, Math.PI, { w: 460, h: 160, edge: '#2fbfa0' });
    sign([{ text: 'YOUR QUARTERS', size: 54, y: 82, color: '#cfc3ad' }], -2.0, 2.75, -3.72, 1.8, 0.45, Math.PI, { w: 460, h: 160, edge: '#3f2d1e' });
    // benches along the hall
    box(M.darkWood, 9, 0.25, -3.95, 2.0, 0.5, 0.5);
    box(M.darkWood, 19, 0.25, -3.95, 2.0, 0.5, 0.5);

    // ---------- Trade Hall ----------
    floor(M.floor, -0.5, 9, -15, -6.6);
    wallZ(M.plaster, -0.5, -15, -6.6);
    wallX(M.plaster, -15, -0.5, 9);
    wallZ(M.plaster, 9, -15, -6.6);
    lamp(4.25, -10.5, 14, 12);
    const stalls = [
      { id: 'gunsmith', x: 1.6, colors: { jacket: 0x4f5a3a, scarf: 0xc4672f, pack: 0x5a4a35 }, awning: M.orange },
      { id: 'medic', x: 4.25, colors: { jacket: 0xd9d2c0, scarf: 0xc23a2a, pack: 0x8a8a7a }, awning: M.teal },
      { id: 'sell', x: 6.9, colors: { jacket: 0x6b4b2e, scarf: 0xd8b54a, pack: 0x3b3833 }, awning: mat(0xd8b54a) },
    ];
    for (const st of stalls) {
      const z = -13.2;
      box(M.wood, st.x, 0.55, z + 1.3, 2.2, 1.1, 0.6, { shadow: true }); // counter
      box(M.darkWood, st.x, 1.12, z + 1.3, 2.3, 0.06, 0.7, { collide: false });
      // awning high enough that the name board hangs below it, above the trader's head
      box(st.awning, st.x, 3.05, z + 0.9, 2.4, 0.08, 1.6, { collide: false, rot: [0.25, 0, 0] });
      box(M.darkWood, st.x, 1.4, z - 0.85, 2.3, 2.8, 0.3); // shelves behind
      for (let k = 0; k < 3; k++) box(M.darkWood, st.x, 1.59 + k * 0.35, z - 0.55, 2.2, 0.04, 0.3, { collide: false });
      for (let i = 0; i < 6; i++) box(i % 2 ? M.metal : M.orange, st.x - 0.8 + i * 0.32, 1.7 + (i % 3) * 0.35, z - 0.55, 0.22, 0.18, 0.15, { collide: false });
      const name = st.id === 'sell' ? 'PELL' : TRADERS[st.id].name.toUpperCase();
      const title = st.id === 'sell' ? 'SCRAP BUYER' : TRADERS[st.id].title.toUpperCase();
      sign([{ text: name, size: 64, y: 62 }, { text: title, size: 30, weight: 600, y: 118, color: '#cfc3ad' }], st.x, 2.6, z + 1.75, 1.4, 0.44, 0, { w: 360, h: 160 });
      const npc = buildRaiderModel(st.colors);
      npc.position.set(st.x, 0, z + 0.2);
      scene.add(npc);
      this.npcs.push({ model: npc, look: 0, timer: Math.random() * 3 });
      interact('trader', st.x, z + 2.2, st.id === 'sell' ? 'Sell to Pell' : `Talk to ${TRADERS[st.id].name} (${TRADERS[st.id].title})`, { trader: st.id });
    }

    // ---------- Workshop ----------
    floor(M.tile, 9, 19, -15, -6.6);
    wallX(M.concrete, -15, 9, 19);
    lamp(14, -10.8, 14, 12);
    const spots = [
      { x: 11, z: -14.3, r: 0 }, { x: 14, z: -14.3, r: 0 }, { x: 17, z: -14.3, r: 0 },
      { x: 9.75, z: -11.0, r: Math.PI / 2 }, { x: 18.25, z: -11.0, r: -Math.PI / 2 }, { x: 18.25, z: -8.4, r: -Math.PI / 2 },
      { x: 9.75, z: -8.4, r: Math.PI / 2 },
    ];
    BENCH_SECTIONS.forEach((sec, i) => {
      const b = spots[i];
      const alongX = b.r === 0;
      const w = alongX ? 2.2 : 0.9;
      const d = alongX ? 0.9 : 2.2;
      box(M.wood, b.x, 0.85, b.z, w, 0.08, d, { shadow: true });
      box(M.darkWood, b.x, 0.42, b.z, w * 0.9, 0.84, d * 0.9);
      box(M.metal, b.x + (alongX ? -0.5 : 0), 0.97, b.z + (alongX ? 0 : -0.5), 0.35, 0.16, 0.3, { collide: false });
      box(sec.repair || sec.salvage ? M.orange : M.teal, b.x + (alongX ? 0.5 : 0), 0.95, b.z + (alongX ? 0 : 0.5), 0.2, 0.12, 0.2, { collide: false });
      const sx = b.x + (alongX ? 0 : (b.r > 0 ? -0.4 : 0.4));
      const sz = b.z + (alongX ? -0.4 : 0);
      sign([{ text: sec.name.toUpperCase(), size: 70, y: 70 }, { text: sec.blurb, size: 28, weight: 600, y: 124, color: '#cfc3ad' }], sx, 1.75, sz, 1.4, 0.44, alongX ? 0 : b.r, { w: 400, h: 160, edge: sec.repair || sec.salvage ? '#ea6a2c' : '#2fbfa0' });
      const ix = b.x + (alongX ? 0 : (b.r > 0 ? 0.9 : -0.9));
      const iz = b.z + (alongX ? 0.9 : 0);
      interact('bench', ix, iz, `Use the ${sec.name} bench`, { section: sec.id });
    });

    // ---------- Checkout ----------
    floor(M.floor, 19, 28.5, -15, -6.6);
    wallZ(M.concrete, 19, -15, -6.6);
    wallZ(M.concrete, 28.5, -15, -6.6);
    wallX(M.concrete, -15, 19, 28.5);
    lamp(23.75, -10.8, 12, 12);
    box(M.metal, 23.75, 0.5, -12.6, 3.2, 1.0, 0.8, { shadow: true }); // desk
    box(M.glowTeal, 23.75, 1.35, -12.85, 1.4, 0.75, 0.06, { collide: false, rot: [-0.25, 0, 0] });
    box(M.darkWood, 23.75, 1.0, -12.9, 0.12, 0.2, 0.12, { collide: false });
    sign([{ text: 'CHECKOUT', size: 72, y: 70 }, { text: 'PICK YOUR DROP · SIGN OUT', size: 28, weight: 600, y: 124, color: '#cfc3ad' }], 23.75, 2.6, -14.88, 2.2, 0.6, 0, { w: 460, h: 160 });
    this.mapBoard = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshStandardMaterial({ color: 0x8a8a6a, roughness: 0.9 }));
    this.mapBoard.position.set(19.12, 1.7, -10.8);
    this.mapBoard.rotation.y = Math.PI / 2;
    scene.add(this.mapBoard);
    interact('checkout', 23.75, -11.6, 'Choose where to deploy');

    // ---------- Lift ----------
    floor(M.metal, 33, 36.5, -6.6, -3.6);
    wallX(M.metal, -3.6, 33, 36.5);
    wallX(M.metal, -6.6, 33, 36.5);
    wallZ(M.metal, 36.5, -6.6, -3.6);
    box(mat(0xe8b830), 33.05, 0.02, -5.1, 0.1, 0.03, 3.0, { collide: false }); // threshold stripe
    const liftLight = new THREE.PointLight(0x40ffd0, 6, 6, 1.8);
    liftLight.position.set(34.8, H - 0.5, -5.1);
    scene.add(liftLight);
    this.liftLight = liftLight;
    box(M.glowTeal, 36.38, 1.3, -5.1, 0.05, 0.6, 0.8, { collide: false });
    interact('lift', 35.0, -5.1, 'Ride the lift topside', { hold: 1.2 });

    // ---------- the mine town: supports, rails, cables, shops ----------
    this.dressMine(M, box, sign);

    // ---------- dust ----------
    const count = 160;
    const dustGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 7.2;
      pos[i * 3 + 1] = Math.random() * H;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 6.3;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xffd9a8, size: 0.025, transparent: true, opacity: 0.55, depthWrite: false }));
    scene.add(this.dust);

    this.player.model.visible = true;
    this.placeIdle();
    this.rackIds = '';
    this.yaw = Math.PI;
    this.pitch = -0.1;
  }

  placeIdle() {
    const p = this.player;
    p.pos.set(0, 0, 0.3);
    p.vel.set(0, 0, 0);
    p.bodyYaw = 0;
    p.yaw = 0;
    p.crouch = false;
  }

  // Show this profile's gear: first weapon slung on the back, the rest on the rack.
  refresh(profile) {
    const weapons = profile ? profile.loadout.weapons.filter(Boolean).map((w) => w.id) : [];
    this.player.setGun(weapons[0] || null, true);
    const rackIds = weapons.slice(1).join(',');
    if (rackIds !== this.rackIds) {
      this.rackIds = rackIds;
      this.rack.clear();
      weapons.slice(1).forEach((id, i) => {
        const g = buildGunModel(id);
        g.rotation.set(0, Math.PI / 2, 0);
        g.position.set(-0.3 + i * 0.6, 0, 0);
        g.scale.setScalar(1.2);
        this.rack.add(g);
      });
    }
  }

  // Paint the top-down map onto the Checkout's wall board.
  setMapImage(canvas) {
    if (!canvas || this.mapBoard.material.map) return;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.mapBoard.material.map = tex;
    this.mapBoard.material.color.set(0xffffff);
    this.mapBoard.material.needsUpdate = true;
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  roomName() {
    const { x, z } = this.player.pos;
    return ROOMS.find((r) => r.test(x, z)).name;
  }

  // ---------- exploring ----------
  enterExplore() {
    this.exploring = true;
    this.frontWall.visible = true;
    const p = this.player;
    if (!this.explored) {
      this.placeIdle();
      this.yaw = Math.PI; // facing the door
      this.pitch = -0.1;
      this.explored = true;
    }
    p.alive = true;
    p.health = 100;
    p.stamina = 100;
  }

  leaveExplore() {
    this.exploring = false;
    this.frontWall.visible = false;
    this.explored = false;
    this.placeIdle();
  }

  // Nearest thing in reach that the raider is facing.
  findInteractable() {
    const p = this.player.pos;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    let best = null;
    let bestScore = Infinity;
    for (const it of this.interactables) {
      const dx = it.x - p.x;
      const dz = it.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.9) continue;
      const facing = d < 0.5 ? 1 : (dx * fx + dz * fz) / d;
      if (facing < 0.2 && it.kind !== 'lift') continue;
      const score = d * (2 - facing);
      if (score < bestScore) {
        bestScore = score;
        best = it;
      }
    }
    return best;
  }

  // look: whether mouse look and movement apply (no menu open)
  updateExplore(dt, input, look, sensitivity) {
    this.time += dt;
    const p = this.player;
    if (look) {
      this.yaw -= input.mouse.dx * sensitivity;
      this.pitch = Math.max(-1.0, Math.min(0.9, this.pitch - input.mouse.dy * sensitivity));
    }
    p.yaw = this.yaw;
    p.pitch = this.pitch;
    p.speedMul = 0.9;
    const axis = look ? input.axis() : { x: 0, y: 0 };
    p.update(dt, { x: axis.x, y: axis.y, sprint: look && (input.down('ShiftLeft') || input.down('ShiftRight')), jump: look && input.hit('Space') });
    if (look && input.hit('KeyC')) p.crouch = !p.crouch;
    this.updateCamera();
    this.ambient(dt);
  }

  updateCamera() {
    const p = this.player;
    const eye = p.eye();
    const look = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const pivot = eye.clone().addScaledVector(right, 0.45).add(new THREE.Vector3(0, 0.2, 0));
    const toPivot = pivot.clone().sub(eye);
    const pd = toPivot.length();
    const side = this.col.raycast(eye.x, eye.y, eye.z, toPivot.x / pd, toPivot.y / pd, toPivot.z / pd, pd + 0.15);
    if (side) pivot.copy(eye).addScaledVector(toPivot.normalize(), Math.max(0, side.dist - 0.15));
    const back = look.clone().multiplyScalar(-1);
    const hit = this.col.raycast(pivot.x, pivot.y, pivot.z, back.x, back.y, back.z, 2.8);
    const dist = hit ? Math.max(0.3, hit.dist - 0.2) : 2.6;
    const cam = pivot.clone().addScaledVector(back, dist);
    this.camera.position.copy(cam);
    this.camera.lookAt(cam.clone().add(look));
    // too close in a tight corridor: hide the raider rather than fill the screen with them
    p.model.visible = dist > 1.0;
  }

  // Set dressing that makes the Sanctuary an old mine turned underground town.
  // Everything here is decoration: it stays out of the walkways and only a few
  // solid props (cart, barrels, tank, crates) add collision.
  dressMine(M, box, sign) {
    const scene = this.scene;
    const add = (geo, material, x, y, z, rot) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      if (rot) m.rotation.set(...rot);
      m.receiveShadow = true;
      scene.add(m);
      return m;
    };
    const deco = { collide: false };
    const wood = M.timber;

    // timber mine sets along the hallway: posts against the walls, a cap beam, knee braces
    for (const x of [-4.4, 0.4, 2.6, 6.2, 11.0, 16.4, 21.2, 26.0, 28.6, 32.4]) {
      box(wood, x, H / 2, -6.41, 0.18, H, 0.16, deco);
      box(wood, x, H / 2, x < 4 ? -3.69 : -3.79, 0.18, H, 0.16, deco);
      box(wood, x, H - 0.13, -5.1, 0.2, 0.22, 2.95, deco);
      for (const [z, r] of [[-6.15, 0.75], [-4.05, -0.75]]) box(wood, x, H - 0.45, z, 0.12, 0.6, 0.1, { collide: false, rot: [r, 0, 0] });
    }
    // mine-cart rails down the middle of the hallway, on sleepers
    for (const z of [-4.85, -5.35]) box(M.steel, 14.1, 0.025, z, 37.6, 0.05, 0.05, deco);
    {
      const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.03, 0.8), wood, 64);
      const m = new THREE.Matrix4();
      let n = 0;
      for (let x = -4.4; x < 33 && n < 64; x += 0.6) sleepers.setMatrixAt(n++, m.makeTranslation(x, 0.015, -5.1));
      sleepers.count = n;
      sleepers.receiveShadow = true;
      scene.add(sleepers);
    }
    // an ore cart parked at the dead end, barrels beside it
    box(M.rust, -4.25, 0.55, -5.1, 0.9, 0.55, 1.1, { shadow: true });
    box(M.steel, -4.25, 0.24, -5.1, 0.7, 0.1, 0.9, deco);
    for (const [dx, dz] of [[-0.3, -0.4], [0.3, -0.4], [-0.3, 0.4], [0.3, 0.4]]) add(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 12), M.steel, -4.25 + dx, 0.13, -5.1 + dz, [0, 0, Math.PI / 2]);
    for (let i = 0; i < 5; i++) add(new THREE.DodecahedronGeometry(0.16 + rnd() * 0.06, 0), M.hall, -4.25 + (rnd() - 0.5) * 0.5, 0.86, -5.1 + (rnd() - 0.5) * 0.7);
    for (const [x, z] of [[-4.55, -6.2], [-4.55, -3.95]]) {
      add(new THREE.CylinderGeometry(0.28, 0.28, 0.85, 16), M.rust, x, 0.43, z);
      this.col.addBox({ x: x - 0.28, y: 0, z: z - 0.28 }, { x: x + 0.28, y: 0.85, z: z + 0.28 });
    }
    // cables and a vent duct along the ceiling
    [0x1c1c1c, 0x8a2a20, 0xb89a30].forEach((c, i) => add(new THREE.CylinderGeometry(0.018, 0.018, 38, 6), mat(c), 14, H - 0.42 - i * 0.05, -6.36 + i * 0.03, [0, 0, Math.PI / 2]));
    box(M.steel, 14, H - 0.2, -6.15, 37.8, 0.3, 0.45, deco);
    for (let x = -4; x < 33; x += 3) box(M.shade, x, H - 0.2, -6.15, 0.05, 0.34, 0.49, deco); // duct bands
    // string lights sagging down the hallway
    {
      const pts = [];
      for (let x = -4.2; x <= 32.6; x += 0.25) pts.push(new THREE.Vector3(x, H - 0.4 - Math.abs(Math.sin(((x + 4.2) / 4.6) * Math.PI)) * 0.35, -5.1));
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x222222 })));
      const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), 80);
      const colors = [0xffc070, 0xff7a3a, 0x40ffd0, 0xffe0a0];
      const m = new THREE.Matrix4();
      const c = new THREE.Color();
      let n = 0;
      for (let i = 0; i < pts.length && n < 80; i += 2) {
        bulbs.setMatrixAt(n, m.makeTranslation(pts[i].x, pts[i].y - 0.05, pts[i].z));
        bulbs.setColorAt(n, c.setHex(colors[n % colors.length]));
        n++;
      }
      bulbs.count = n;
      scene.add(bulbs);
    }
    // shopfronts cut into the south wall: shutter, frame, awning, neon sign, a crate counter
    const shops = [
      { x: 6.4, name: 'NOODLES', color: '#ff5a3a' },
      { x: 13.2, name: 'BUNKS', color: '#40ffd0' },
      { x: 17.8, name: 'CLINIC', color: '#7ad0ff' },
      { x: 23.4, name: 'WATER · RATION', color: '#4fb3e8', size: 56 },
      { x: 27.4, name: 'RADIO & PARTS', color: '#f2c14e', size: 52 },
    ];
    for (const sh of shops) {
      const z = -3.72;
      box(M.steel, sh.x, 1.0, z, 1.7, 2.0, 0.06, deco); // rolled-down shutter
      for (let y = 0.12; y < 2.0; y += 0.12) box(M.shade, sh.x, y, z - 0.035, 1.66, 0.02, 0.012, deco);
      for (const dx of [-0.9, 0.9]) box(wood, sh.x + dx, 1.1, z - 0.06, 0.12, 2.2, 0.12, deco);
      box(M.orange, sh.x, 2.35, z - 0.28, 2.0, 0.05, 0.6, { collide: false, rot: [-0.3, 0, 0] });
      const neon = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.42), neonSign(sh.name, sh.color, 512, 128, sh.size || 78));
      neon.position.set(sh.x, 2.75, z - 0.08);
      neon.rotation.y = Math.PI;
      scene.add(neon);
      box(M.wood, sh.x + 0.45, 0.3, -3.98, 0.55, 0.6, 0.4); // crate counter
    }
    // north wall: a hydroponic grow rack, a notice board, a water tank
    {
      const x = 9.2;
      const z = -6.32;
      box(M.steel, x, 0.95, z, 1.6, 1.9, 0.3, { collide: false });
      const grow = new THREE.MeshBasicMaterial({ color: 0xd060ff, toneMapped: false });
      const leaf = mat(0x4f8a3a, { flatShading: true });
      for (const y of [0.45, 1.05, 1.65]) {
        box(M.shade, x, y - 0.18, z + 0.02, 1.5, 0.03, 0.26, deco);
        add(new THREE.BoxGeometry(1.4, 0.02, 0.02), grow, x, y + 0.2, z + 0.12);
        for (let k = 0; k < 5; k++) add(new THREE.IcosahedronGeometry(0.1 + rnd() * 0.04, 0), leaf, x - 0.56 + k * 0.28, y - 0.08, z + 0.03);
      }
      const glow = new THREE.PointLight(0xc060ff, 3, 4, 2);
      glow.position.set(x, 1.4, z + 0.6);
      scene.add(glow);
    }
    sign([{ text: 'NOTICES', size: 56, y: 40 }, { text: 'RATIONS THU · CURFEW 22:00', size: 26, weight: 600, y: 96, color: '#cfc3ad' }, { text: 'LIFT CREW WANTED · ASK AT CHECKOUT', size: 22, weight: 600, y: 132, color: '#cfc3ad' }], 18.6, 1.55, -6.48, 1.5, 0.75, 0, { w: 420, h: 210, bg: '#3f2d1e', edge: '#2a1e14' });
    for (const [dx, dy, c] of [[-0.5, 0.15, '#e6dccb'], [0.45, -0.2, '#f2c14e'], [0.15, 0.25, '#e6dccb']]) {
      const paper = add(new THREE.PlaneGeometry(0.22, 0.28), mat(c), 18.6 + dx, 1.55 + dy, -6.47);
      paper.rotation.z = (rnd() - 0.5) * 0.3;
    }
    add(new THREE.CylinderGeometry(0.38, 0.38, 1.6, 18), M.steel, 31.2, 0.8, -6.05);
    this.col.addBox({ x: 30.82, y: 0, z: -6.43 }, { x: 31.58, y: 1.6, z: -5.67 });
    add(new THREE.CylinderGeometry(0.05, 0.05, H - 1.6, 8), M.steel, 31.2, 1.6 + (H - 1.6) / 2, -6.3);
    // laundry strung across the west end
    {
      const a = new THREE.Vector3(-0.9, 3.0, -6.45);
      const b = new THREE.Vector3(1.6, 2.95, -3.7);
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0x9a8a6a })));
      [0x2f8f8a, 0xc4672f, 0xd9d2c0, 0x6b4b2e].forEach((c, i) => {
        const t = (i + 1) / 5;
        const cloth = add(new THREE.PlaneGeometry(0.32, 0.36), mat(c, { side: THREE.DoubleSide }), a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - 0.2, a.z + (b.z - a.z) * t);
        cloth.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
      });
    }
    // a little warm and cool light from the street fronts
    const neonGlow = new THREE.PointLight(0xff6a40, 2.5, 6, 2);
    neonGlow.position.set(6.4, 2.4, -4.4);
    scene.add(neonGlow);
    const cool = new THREE.PointLight(0x40c0ff, 2, 6, 2);
    cool.position.set(23.4, 2.4, -4.4);
    scene.add(cool);

    // Trade Hall: steel arch ribs, string lights, a market sign, stacked crates
    for (const z of [-8.3, -10.2]) {
      const rib = add(new THREE.TorusGeometry(4.6, 0.07, 6, 40, Math.PI), M.steel, 4.25, -1.2, z);
      rib.scale.set(1, 1, 1);
    }
    const market = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), neonSign('MARKET', '#ff9a3a', 512, 128, 90));
    market.position.set(4.25, 2.95, -6.75);
    scene.add(market);
    for (const [x, z, h] of [[0.2, -7.3, 2], [8.3, -7.3, 1], [0.2, -8.2, 1]]) {
      for (let k = 0; k < h; k++) box(M.wood, x, 0.35 + k * 0.7, z, 0.7, 0.68, 0.7, { shadow: true });
    }

    // Workshop: overhead beams, a chain hoist, a drum
    for (const x of [11.6, 14, 16.4]) box(wood, x, H - 0.13, -10.8, 0.22, 0.24, 8.3, deco);
    box(M.steel, 14, H - 0.4, -10.8, 0.12, 0.12, 8.3, deco);
    for (let i = 0; i < 8; i++) add(new THREE.TorusGeometry(0.035, 0.01, 4, 8), M.steel, 14, H - 0.55 - i * 0.07, -10.8, [0, i % 2 ? Math.PI / 2 : 0, 0]);
    add(new THREE.TorusGeometry(0.08, 0.02, 6, 12, Math.PI * 1.4), M.orange, 14, H - 1.2, -10.8);
    add(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16), M.teal, 12.6, 0.45, -7.15);
    this.col.addBox({ x: 12.3, y: 0, z: -7.45 }, { x: 12.9, y: 0.9, z: -6.85 });

    // Checkout: steel ribs and a server rack blinking on the east wall
    for (const z of [-8.6, -12.6]) add(new THREE.TorusGeometry(4.75, 0.07, 6, 40, Math.PI), M.steel, 23.75, -1.35, z);
    box(M.steel, 28.2, 1.0, -9.0, 0.5, 2.0, 1.2);
    const blink = new THREE.MeshBasicMaterial({ color: 0x40ffd0, toneMapped: false });
    const amber = new THREE.MeshBasicMaterial({ color: 0xffa040, toneMapped: false });
    for (let i = 0; i < 18; i++) add(new THREE.BoxGeometry(0.01, 0.03, 0.05), i % 4 ? blink : amber, 27.94, 0.4 + (i % 9) * 0.18, -9.3 + Math.floor(i / 9) * 0.55);

    // Lift: a cage of bars and the winch cable going up the shaft
    for (const z of [-3.72, -6.48]) for (let x = 33.3; x < 36.4; x += 0.28) box(M.steel, x, H / 2, z, 0.035, H, 0.035, deco);
    add(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), M.steel, 34.8, H - 0.2, -5.1);

    // your quarters: timber corner posts and a cross beam
    for (const [x, z] of [[-3.8, -3.3], [3.8, -3.3], [-3.8, 3.3], [3.8, 3.3]]) box(wood, x, H / 2, z, 0.2, H, 0.2, deco);
  }

  // ---------- idle (behind the menus) ----------
  // mode: 'home' | 'login' | 'hub' | 'results'
  update(dt, mode) {
    this.time += dt;
    const t = this.time;
    const p = this.player;
    p.model.visible = true;
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = 3 + Math.random() * 4;
      this.look = Math.random() < 0.4 ? 0 : (Math.random() - 0.5) * 1.1;
    }
    p.model.position.copy(p.pos);
    p.model.rotation.set(0, Math.sin(t * 0.25) * 0.12, 0);
    poseRig(p.model.userData, {
      speed: 0, phase: 0, crouchBlend: 0, sprint: false, airborne: false,
      armed: false, ads: false, pitch: 0, recoil: 0, melee: -1, idle: t, look: this.look,
    }, dt);
    // the hub frames the raider on the right, beside the stash panel
    const hub = mode === 'hub' ? 1 : 0;
    const drift = Math.sin(t * 0.18) * 0.2;
    this.camera.position.set(0.2 + drift - hub * 1.9, 1.55 + hub * 0.1, 4.3 + hub * 0.6);
    this.camera.lookAt(0.05 + drift * 0.3 - hub * 1.75, 1.05, 0);
    this.ambient(dt);
  }

  ambient(dt) {
    const t = this.time;
    this.bulb.intensity = 30 + Math.sin(t * 13) * 0.6 + (Math.random() < 0.004 ? -12 : 0);
    this.dust.rotation.y = t * 0.01;
    this.liftLight.intensity = 5 + Math.sin(t * 2) * 1.5;
    for (const n of this.npcs) {
      n.timer -= dt;
      if (n.timer <= 0) {
        n.timer = 2 + Math.random() * 4;
        n.look = (Math.random() - 0.5) * 1.2;
      }
      poseRig(n.model.userData, {
        speed: 0, phase: 0, crouchBlend: 0, sprint: false, airborne: false,
        armed: false, ads: false, pitch: 0, recoil: 0, melee: -1, idle: t + n.timer, look: n.look,
      }, dt);
    }
  }
}
