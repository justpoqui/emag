// Husk Network structures topside. The world provides build sites; each raid
// the network's plan (network.js) decides which become Bulwarks (barricade
// rings round a sentinel spire, where the raider fights them) and which become
// Cradles (pod nurseries, where they're left in peace).

import * as THREE from 'three';
import { terrainHeight } from './collision.js';

const hull = new THREE.MeshStandardMaterial({ color: 0x9aa1a6, roughness: 0.4, metalness: 0.75 });
const sinew = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.55, metalness: 0.6 });
const glow = new THREE.MeshStandardMaterial({ color: 0x2a0d06, emissive: 0xff6a20, emissiveIntensity: 2.2 });
const calmGlow = new THREE.MeshStandardMaterial({ color: 0x08241f, emissive: 0x30ffc0, emissiveIntensity: 1.6 });

const ARC = 0.75; // radians covered by one barricade arc
const RING = 6; // barricade ring radius

function lathe(profile, segments = 20) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

export class Infrastructure {
  constructor(scene, col, sites) {
    this.scene = scene;
    this.groups = [];
    this.active = [];
    // register every site's colliders up front (switched off until built)
    this.sites = sites.map((s) => {
      const off = (box) => Object.assign(box, { off: true });
      const bulwark = [off(col.addBox({ x: s.x - 0.85, y: s.y - 1, z: s.z - 0.85 }, { x: s.x + 0.85, y: s.y + 9, z: s.z + 0.85 }, 'metal'))];
      for (let k = 0; k < 3; k++) {
        const a = s.rot + (k * Math.PI * 2) / 3;
        for (const da of [-0.3, 0, 0.3]) {
          const x = s.x + Math.cos(a + da) * RING;
          const z = s.z + Math.sin(a + da) * RING;
          const g = terrainHeight(x, z);
          bulwark.push(off(col.addBox({ x: x - 0.7, y: g - 1, z: z - 0.7 }, { x: x + 0.7, y: g + 1.3, z: z + 0.7 }, 'metal')));
        }
      }
      const cradle = [off(col.addBox({ x: s.x - 1.6, y: s.y - 1, z: s.z - 1.6 }, { x: s.x + 1.6, y: s.y + 2.1, z: s.z + 1.6 }, 'metal'))];
      return { ...s, boxes: { bulwark, cradle } };
    });
  }

  clear() {
    for (const g of this.groups) {
      this.scene.remove(g);
      g.traverse((o) => o.geometry && o.geometry.dispose());
    }
    this.groups = [];
    for (const s of this.sites) for (const b of [...s.boxes.bulwark, ...s.boxes.cradle]) b.off = true;
    this.active = [];
  }

  // plan: [{ site, kind }]
  build(plan) {
    this.clear();
    for (const { site, kind } of plan) {
      const s = this.sites[site];
      if (!s) continue;
      const g = kind === 'bulwark' ? this.bulwark(s) : this.cradle(s);
      g.position.set(s.x, s.y, s.z);
      this.scene.add(g);
      this.groups.push(g);
      for (const b of s.boxes[kind]) b.off = false;
      this.active.push({ site, kind, x: s.x, z: s.z });
    }
  }

  // a sentinel spire inside three curved barricades
  bulwark(s) {
    const g = new THREE.Group();
    const spire = new THREE.Mesh(lathe([[1.05, -0.3], [0.85, 0.5], [0.5, 1.9], [0.36, 4.4], [0.52, 6.1], [0.26, 7.6], [0.07, 9.2], [0, 9.3]]), hull);
    spire.castShadow = true;
    g.add(spire);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.07, 8, 28), glow);
    band.rotation.x = Math.PI / 2;
    band.position.y = 6.1;
    g.add(band);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), glow);
    orb.position.y = 9.35;
    g.add(orb);
    for (let i = 0; i < 4; i++) {
      // tendons from the spire down into the ground
      const a = (i / 4) * Math.PI * 2 + s.rot;
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 3.2, 0),
        new THREE.Vector3(Math.cos(a) * 1.6, 2.2, Math.sin(a) * 1.6),
        new THREE.Vector3(Math.cos(a) * 2.4, -0.2, Math.sin(a) * 2.4),
      );
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.12, 6), sinew));
    }
    for (let k = 0; k < 3; k++) {
      const a = s.rot + (k * Math.PI * 2) / 3;
      const arc = new THREE.Mesh(new THREE.TorusGeometry(RING, 0.55, 8, 20, ARC), hull);
      arc.rotation.x = -Math.PI / 2;
      const holder = new THREE.Group();
      holder.rotation.y = -a - ARC / 2;
      holder.position.y = terrainHeight(s.x + Math.cos(a) * RING, s.z + Math.sin(a) * RING) - s.y + 0.55;
      holder.scale.set(1, 1.3, 1);
      holder.add(arc);
      arc.castShadow = true;
      g.add(holder);
      const seam = new THREE.Mesh(new THREE.TorusGeometry(RING, 0.06, 4, 20, ARC), glow);
      seam.rotation.x = -Math.PI / 2;
      seam.position.y = 0.5;
      holder.add(seam);
    }
    return g;
  }

  // a ribbed dome nursery with a calm glow
  cradle() {
    const g = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hull);
    dome.scale.y = 0.85;
    dome.castShadow = true;
    g.add(dome);
    for (let i = 0; i < 5; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.08, 6, 24, Math.PI), sinew);
      rib.rotation.y = (i / 5) * Math.PI;
      rib.scale.y = 0.85;
      g.add(rib);
    }
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), calmGlow);
    core.position.y = 1.95;
    g.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.1, 6, 36), calmGlow);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    g.add(ring);
    return g;
  }
}
