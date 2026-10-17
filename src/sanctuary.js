// The Patron's Sanctuary: the raider's own room, shown behind the title
// screen and the Burrow menus. The raider stands in it with their loadout
// (first weapon slung on their back, the rest on the wall rack) and idles
// until deployed.

import * as THREE from 'three';
import { buildRaiderModel, poseRig } from './rig.js';
import { buildGunModel } from './player.js';

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0.05, ...opts });
}

function box(parent, material, x, y, z, sx, sy, sz, rot = [0, 0, 0]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  m.position.set(x, y, z);
  m.rotation.set(...rot);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
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
  g.fillStyle = opts.fg || '#f4ead8';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((line, i) => {
    g.font = `${line.weight || 800} ${line.size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.fillStyle = line.color || opts.fg || '#f4ead8';
    g.fillText(line.text, c.width / 2, line.y);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Sanctuary {
  constructor(quality) {
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.background = new THREE.Color(0x15130f);
    scene.fog = new THREE.Fog(0x15130f, 9, 18);
    this.camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 50);
    this.time = 0;
    this.look = 0;
    this.lookTimer = 3;

    const W = 8;
    const D = 7;
    const H = 3.4;
    const concrete = mat(0x8c8273);
    const plaster = mat(0xb39b7c);
    const wood = mat(0x6b4c30);
    const darkWood = mat(0x3f2d1e);
    const metal = mat(0x5f6468, { metalness: 0.5, roughness: 0.5 });
    const fabric = mat(0x2f6f6a);
    const blanket = mat(0xc4672f);
    const rugMat = mat(0x7a3328);

    // room: floor, walls, ceiling (open towards the camera)
    box(scene, mat(0x4e463c), 0, -0.05, 0, W, 0.1, D);
    box(scene, plaster, 0, H / 2, -D / 2, W, H, 0.2); // back wall
    box(scene, concrete, -W / 2, H / 2, 0, 0.2, H, D); // left wall
    box(scene, concrete, W / 2, H / 2, 0, 0.2, H, D); // right wall
    box(scene, mat(0x3a332b), 0, H, 0, W, 0.15, D); // ceiling
    for (let i = -3; i <= 3; i++) box(scene, darkWood, i * 1.2, H - 0.15, 0, 0.18, 0.18, D); // beams
    box(scene, darkWood, 0, 0.12, -D / 2 + 0.12, W, 0.24, 0.06); // skirting

    // round window in the back wall showing the dusk outside
    const sky = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32), new THREE.MeshBasicMaterial({ color: 0xe8935a }));
    sky.position.set(2.75, 2.15, -D / 2 + 0.11);
    scene.add(sky);
    const horizon = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32, Math.PI, Math.PI), new THREE.MeshBasicMaterial({ color: 0x8a5a48 }));
    horizon.position.set(2.75, 2.1, -D / 2 + 0.115);
    scene.add(horizon);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.08, 8, 32), metal);
    frame.position.set(2.75, 2.15, -D / 2 + 0.14);
    scene.add(frame);
    box(scene, metal, 2.75, 2.15, -D / 2 + 0.13, 1.55, 0.05, 0.03);
    box(scene, metal, 2.75, 2.15, -D / 2 + 0.13, 0.05, 1.55, 0.03);

    // sign over the door
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 0.6),
      new THREE.MeshStandardMaterial({ map: signTexture([{ text: "PATRON'S SANCTUARY", size: 62, y: 66 }, { text: 'REST · REARM · RETURN', size: 30, weight: 600, y: 118, color: '#cfc3ad' }]), roughness: 0.7 }),
    );
    sign.position.set(0, 2.85, -D / 2 + 0.12);
    scene.add(sign);
    // door under it
    box(scene, darkWood, -2.0, 1.05, -D / 2 + 0.12, 1.0, 2.1, 0.08);
    box(scene, metal, -1.65, 1.05, -D / 2 + 0.18, 0.06, 0.06, 0.06);

    // bed (left) with blanket and pillow
    box(scene, metal, -2.9, 0.25, -1.4, 1.0, 0.1, 2.1);
    for (const [x, z] of [[-3.35, -2.4], [-2.45, -2.4], [-3.35, -0.4], [-2.45, -0.4]]) box(scene, metal, x, 0.12, z, 0.06, 0.25, 0.06);
    box(scene, fabric, -2.9, 0.38, -1.4, 0.95, 0.16, 2.0);
    box(scene, blanket, -2.9, 0.5, -1.1, 1.0, 0.08, 1.3, [0.02, 0, 0.03]);
    box(scene, mat(0xe0d6c2), -2.9, 0.52, -2.2, 0.6, 0.12, 0.3);
    // nightstand crate with a lamp
    box(scene, wood, -2.0, 0.3, -2.5, 0.5, 0.6, 0.5);
    box(scene, metal, -2.0, 0.7, -2.5, 0.06, 0.2, 0.06);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.18, 12, 1, true), mat(0xd8b54a, { side: THREE.DoubleSide }));
    shade.position.set(-2.0, 0.86, -2.5);
    scene.add(shade);

    // locker and footlocker (right)
    box(scene, mat(0x5f7f86, { metalness: 0.4, roughness: 0.6 }), 3.4, 1.0, -2.6, 0.8, 2.0, 0.6);
    box(scene, metal, 3.05, 1.05, -2.29, 0.04, 0.3, 0.02);
    box(scene, mat(0x55603a), 2.6, 0.22, -0.4, 1.1, 0.44, 0.6);
    // workbench with clutter (right, near)
    box(scene, wood, 3.3, 0.85, 0.6, 0.8, 0.08, 1.8);
    for (const z of [-0.2, 1.4]) box(scene, darkWood, 3.3, 0.42, z, 0.7, 0.84, 0.08);
    box(scene, metal, 3.25, 0.95, 0.3, 0.3, 0.12, 0.25);
    box(scene, mat(0xc98a3e), 3.4, 0.93, 1.0, 0.15, 0.08, 0.1);
    box(scene, mat(0x3fd0c9, { emissive: 0x30c0b0, emissiveIntensity: 0.6 }), 3.2, 0.95, 1.2, 0.12, 0.08, 0.12);

    // weapon rack on the back wall (right of the window)
    box(scene, darkWood, -0.35, 1.95, -D / 2 + 0.16, 1.4, 0.08, 0.1);
    box(scene, darkWood, -0.35, 1.45, -D / 2 + 0.16, 1.4, 0.08, 0.1);
    this.rack = new THREE.Group();
    this.rack.position.set(-0.35, 1.7, -D / 2 + 0.3);
    scene.add(this.rack);

    // rug, posters, a plant
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.4, 28), rugMat);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.01, 0.2);
    rug.receiveShadow = true;
    scene.add(rug);
    for (const [x, color, text] of [[-3.88, '#2f8f8a', 'THE DUSTLINE'], [3.88, '#c4672f', 'KEEP YOUR PLATING']]) {
      const poster = new THREE.Mesh(
        new THREE.PlaneGeometry(0.9, 1.25),
        new THREE.MeshStandardMaterial({ map: signTexture([{ text, size: 40, y: 260 }, { text: '◉', size: 160, y: 120, color: '#1d1c1a' }], { w: 300, h: 420, bg: color, edge: '#1d1c1a' }), roughness: 0.9 }),
      );
      poster.position.set(x, 1.8, 0.6);
      poster.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      scene.add(poster);
    }
    box(scene, mat(0x7a4a2a), -3.4, 0.2, 1.6, 0.4, 0.4, 0.4);
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), mat(0x5f7a35, { flatShading: true }));
    leaves.position.set(-3.4, 0.75, 1.6);
    scene.add(leaves);

    // lights: warm bulb overhead, bedside lamp, window glow, cool fill
    scene.add(new THREE.HemisphereLight(0xffe2c0, 0x2a2018, 0.55));
    const bulb = new THREE.PointLight(0xffc38a, 30, 9, 1.6);
    bulb.position.set(0, H - 0.7, 0.4);
    bulb.castShadow = !!quality.shadows;
    bulb.shadow.mapSize.set(1024, 1024);
    bulb.shadow.bias = -0.002;
    scene.add(bulb);
    this.bulb = bulb;
    const bulbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe0b0 }));
    bulbMesh.position.copy(bulb.position);
    scene.add(bulbMesh);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.62, 4), mat(0x111111));
    cord.position.set(0, H - 0.38, 0.4);
    scene.add(cord);
    this.bulbParts = [bulbMesh, cord];
    const lamp = new THREE.PointLight(0xffb060, 6, 4, 2);
    lamp.position.set(-2.0, 0.8, -2.5);
    scene.add(lamp);
    const windowLight = new THREE.SpotLight(0xff9a60, 18, 10, 0.6, 0.6, 1.5);
    windowLight.position.set(2.75, 2.2, -D / 2 + 0.3);
    windowLight.target.position.set(0.3, 0, 0.8);
    scene.add(windowLight, windowLight.target);
    const fill = new THREE.DirectionalLight(0x9fc0d0, 0.35);
    fill.position.set(3, 3, 5);
    scene.add(fill);

    // dust drifting in the light
    const count = 220;
    const dustGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * W * 0.9;
      pos[i * 3 + 1] = Math.random() * H;
      pos[i * 3 + 2] = (Math.random() - 0.5) * D * 0.9;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xffd9a8, size: 0.025, transparent: true, opacity: 0.55, depthWrite: false }));
    scene.add(this.dust);

    // the raider
    this.raider = buildRaiderModel();
    this.raider.position.set(0, 0, 0.3);
    scene.add(this.raider);
    this.gunId = null;
    this.gun = null;
    this.rackIds = '';
  }

  // Show this profile's gear: first weapon slung on the back, the rest on the rack.
  refresh(profile) {
    const weapons = profile ? profile.loadout.weapons.filter(Boolean).map((w) => w.id) : [];
    const inHand = weapons[0] || null;
    const u = this.raider.userData;
    if (inHand !== this.gunId) {
      if (this.gun) this.gun.parent.remove(this.gun);
      this.gun = inHand ? buildGunModel(inHand) : null;
      if (this.gun) u.backSocket.add(this.gun);
      this.gunId = inHand;
    }
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

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // mode: 'home' | 'login' | 'hub' | 'results'
  update(dt, mode) {
    this.time += dt;
    const t = this.time;
    // the raider glances around now and then
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = 3 + Math.random() * 4;
      this.look = Math.random() < 0.4 ? 0 : (Math.random() - 0.5) * 1.1;
    }
    poseRig(this.raider.userData, {
      speed: 0, phase: 0, crouchBlend: 0, sprint: false, airborne: false,
      armed: false, ads: false, pitch: 0, recoil: 0, melee: -1,
      idle: t, look: this.look,
    }, dt);
    this.raider.rotation.y = Math.sin(t * 0.25) * 0.12;

    // camera: framed so the raider sits between the menu and the side cards;
    // in the Burrow it pulls back a little behind the panels
    const far = mode === 'hub' ? 1 : 0;
    const drift = Math.sin(t * 0.18) * 0.25;
    this.camera.position.set(0.2 + drift - far * 0.4, 1.55 + far * 0.25, 4.3 + far * 0.8);
    this.camera.lookAt(0.05 + drift * 0.3, 1.05, 0);

    // flickering bulb, swaying cord
    this.bulb.intensity = 30 + Math.sin(t * 13) * 0.6 + (Math.random() < 0.004 ? -12 : 0);
    const sway = Math.sin(t * 0.7) * 0.02;
    for (const p of this.bulbParts) p.position.x = sway;
    this.bulb.position.x = sway;
    this.dust.rotation.y = t * 0.01;
    this.dust.position.y = Math.sin(t * 0.2) * 0.05;
  }
}
