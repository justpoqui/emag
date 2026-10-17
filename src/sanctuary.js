// The Patron's Sanctuary: the raider's quarters, shown behind the menus and
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

    const M = {
      concrete: mat(0x8c8273),
      plaster: mat(0xb39b7c),
      hall: mat(0x7d7466),
      floor: mat(0x4e463c),
      tile: mat(0x5a5246),
      ceiling: mat(0x3a332b),
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
    const box = (material, x, y, z, sx, sy, sz, { collide = true, rot = [0, 0, 0], shadow = false } = {}) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
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
    const lamp = (x, z, intensity = 9, dist = 9) => {
      const l = new THREE.PointLight(0xffc38a, intensity, dist, 1.7);
      l.position.set(x, H - 0.45, z);
      scene.add(l);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), M.glowWarm);
      bulb.position.copy(l.position);
      scene.add(bulb);
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
    // round window showing dusk
    {
      const wx = 2.6;
      const wz = -3.39;
      const sky = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32), new THREE.MeshBasicMaterial({ color: 0xe8935a }));
      sky.position.set(wx, 2.15, wz);
      scene.add(sky);
      const horizon = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32, Math.PI, Math.PI), new THREE.MeshBasicMaterial({ color: 0x8a5a48 }));
      horizon.position.set(wx, 2.1, wz + 0.005);
      scene.add(horizon);
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.08, 8, 32), M.metal);
      frame.position.set(wx, 2.15, wz + 0.03);
      scene.add(frame);
      box(M.metal, wx, 2.15, wz + 0.02, 1.55, 0.05, 0.03, { collide: false });
      box(M.metal, wx, 2.15, wz + 0.02, 0.05, 1.55, 0.03, { collide: false });
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
    scene.add(new THREE.HemisphereLight(0xffe2c0, 0x2a2018, 0.55));
    this.player = new Player(scene, this.col);

    // ---------- hallway ----------
    floor(M.tile, -5, 33, -6.6, -3.6);
    wallX(M.hall, -3.6, -5, -4); // stub west of your room
    wallX(M.hall, -3.6, 4, 33);
    wallX(M.hall, -6.6, -5, 33, [{ at: 4, w: 1.8 }, { at: 14, w: 1.8 }, { at: 23.75, w: 1.8 }]);
    wallZ(M.hall, -5, -6.6, -3.6);
    // stripe along the walls, pipes overhead
    box(M.orange, 18.5, 1.05, -3.72, 29, 0.12, 0.03, { collide: false });
    box(M.orange, 14, 1.05, -6.48, 38, 0.12, 0.03, { collide: false });
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
      box(st.awning, st.x, 2.55, z + 0.9, 2.4, 0.08, 1.6, { collide: false, rot: [0.25, 0, 0] });
      box(M.darkWood, st.x, 1.4, z - 0.85, 2.3, 2.8, 0.3); // shelves behind
      for (let i = 0; i < 6; i++) box(i % 2 ? M.metal : M.orange, st.x - 0.8 + i * 0.32, 1.7 + (i % 3) * 0.35, z - 0.65, 0.22, 0.18, 0.15, { collide: false });
      const name = st.id === 'sell' ? 'PELL' : TRADERS[st.id].name.toUpperCase();
      const title = st.id === 'sell' ? 'SCRAP BUYER' : TRADERS[st.id].title.toUpperCase();
      sign([{ text: name, size: 64, y: 62 }, { text: title, size: 30, weight: 600, y: 118, color: '#cfc3ad' }], st.x, 2.2, z + 1.66, 1.4, 0.44, 0, { w: 360, h: 160 });
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

  // look: whether mouse/touch look and movement apply (no menu open)
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
    const pivot = eye.clone().addScaledVector(right, 0.5).add(new THREE.Vector3(0, 0.2, 0));
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
    p.model.visible = dist > 0.6;
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
