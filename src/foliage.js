// Grass and wind.
//
// Grass: a field of blade clumps that follows the raider. The ground round
// them is split into 8 m cells; when they walk on, the cells left behind are
// re-seeded in front (each cell's clumps come from a hash of its coordinates,
// so a spot always grows the same grass). Dense where you are, cheap overall.
//
// Wind: one shared clock and strength. Materials that should move (grass,
// bushes, tree crowns, tarps) get a few lines added to their vertex shader.

import * as THREE from 'three';
import { terrainHeight } from './collision.js';

export const wind = {
  time: { value: 0 },
  strength: { value: 1 }, // 1 = a breeze; storms blow harder
};

// Sway a material in the wind. kind: 'grass' (instanced, bends from the root),
// 'bush' (instanced, rustles), 'canopy' (merged tree crowns), 'cloth' (tarps).
export function addWind(material, kind) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = wind.time;
    shader.uniforms.uWindStrength = wind.strength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;\nuniform float uWindStrength;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #else
            vec3 root = (modelMatrix * vec4(position, 1.0)).xyz;
          #endif
          // a slow gust rolling across the land, plus a quicker flutter
          float gust = sin(root.x * 0.045 + root.z * 0.03 - uWindTime * 0.9) * 0.5 + 0.5;
          float flutter = sin(uWindTime * 3.1 + root.x * 0.7 + root.z * 0.5);
          float s = uWindStrength * (0.35 + gust * 0.9);
          ${kind === 'grass' ? `
          float bend = clamp(position.y / 0.55, 0.0, 1.0);
          bend *= bend;
          transformed.x += (s * 0.16 + flutter * 0.04 * s) * bend;
          transformed.z += (s * 0.07 + flutter * 0.03 * s) * bend;
          transformed.y -= s * 0.04 * bend;` : ''}
          ${kind === 'bush' ? `
          float up = clamp(position.y * 0.5 + 0.5, 0.0, 1.0);
          transformed.x += (s * 0.05 + flutter * 0.02 * s) * up;
          transformed.z += flutter * 0.015 * s * up;` : ''}
          ${kind === 'canopy' ? `
          vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
          float rustle = sin(uWindTime * 2.3 + wp.x * 1.3 + wp.y * 0.9 + wp.z * 1.1);
          transformed.x += s * 0.12 + rustle * 0.04 * s;
          transformed.z += s * 0.05 + rustle * 0.03 * s;` : ''}
          ${kind === 'cloth' ? `
          vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
          transformed.y += sin(uWindTime * 4.0 + wp.x * 1.4 + wp.z * 1.1) * 0.05 * s;` : ''}
        }`);
    // blades are lit as if they faced the sky from both sides
    if (kind === 'grass') shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
  };
  material.customProgramCacheKey = () => `wind-${kind}`;
  return material;
}

// One clump: several thin blades, leaning out a little, dark at the root and
// light at the tip. Ferns use the same build with fewer, wider, longer fronds
// that arch over.
function clumpGeometry(blades_ = 5, width = 0.06, height = 0.32, lean = 0.12) {
  const blades = [];
  for (let i = 0; i < blades_; i++) {
    const a = (i / blades_) * Math.PI * 2 + i;
    const h = height + (i % 3) * height * 0.3;
    const b = new THREE.PlaneGeometry(width, h, 1, 3);
    b.translate(0, h / 2, 0);
    // narrow to a point and lean outward
    const p = b.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k);
      const t = y / h;
      p.setX(k, p.getX(k) * (1 - t * 0.85) + t * t * lean);
      if (lean > 0.2) p.setY(k, y - t * t * lean * 0.45); // fronds droop at the tip
    }
    b.rotateY(a);
    b.translate(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05);
    blades.push(b.toNonIndexed());
  }
  const pos = [];
  for (const b of blades) pos.push(...b.attributes.position.array);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const shade = [];
  for (let i = 0; i < pos.length; i += 3) {
    const t = Math.min(1, pos[i + 1] / (height * 1.4));
    const k = 0.45 + t * 0.4;
    shade.push(k, k, k);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(shade, 3));
  geo.computeVertexNormals();
  // light the blades as if they faced up, so both sides read the same
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return geo;
}

const CELL = 8;
const hash = (x, z, k) => {
  const s = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

export class GrassField {
  // perCell: clumps in each 8 m cell; radius: cells out from the raider.
  // clear(x, z): true where nothing should grow (roads, floors, trails, rock).
  // kind: 'grass' (blades, the odd wildflower) or 'fern' (low fronds, shade-lovers).
  constructor(scene, { perCell, radius, clear, kind = 'grass' }) {
    this.perCell = perCell;
    this.radius = radius;
    this.clear = clear;
    this.kind = kind;
    this.seed = kind === 'fern' ? 37 : 0;
    this.side = radius * 2 + 1;
    const count = this.side * this.side * perCell;
    const mat = addWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }), 'grass'); // ferns bend the same way
    const geo = kind === 'fern' ? clumpGeometry(7, 0.16, 0.42, 0.34) : clumpGeometry(7, 0.08, 0.34, 0.14);
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    scene.add(this.mesh);
    this.slots = new Map(); // "slot index" -> cell key it currently holds
    this.centre = null;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._c = new THREE.Color();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  // Fill slot (one cell's worth of instances) with the grass for cell cx, cz.
  fillCell(slot, cx, cz) {
    const base = slot * this.perCell;
    for (let i = 0; i < this.perCell; i++) {
      const x = (cx + hash(cx, cz, i + this.seed)) * CELL;
      const z = (cz + hash(cz, cx, i + 99 + this.seed)) * CELL;
      let scale = 0.7 + hash(x, z, 3) * 0.7;
      // patchy meadows: thick in some places, thin in others; ferns take the gaps
      const meadow = Math.sin(x * 0.05) * Math.cos(z * 0.043) * 0.5 + 0.5;
      const keep = this.kind === 'fern' ? hash(x, z, 5) < 0.75 - meadow * 0.6 : hash(x, z, 5) < 0.35 + meadow * 0.65;
      if (!keep || this.clear(x, z)) scale = 0;
      this._p.set(x, terrainHeight(x, z) - 0.03, z);
      this._q.setFromEuler(this._e.set(0, hash(x, z, 7) * 6.28, 0));
      this._s.set(scale, scale * (0.8 + hash(x, z, 8) * 0.6), scale);
      this.mesh.setMatrixAt(base + i, this._m.compose(this._p, this._q, this._s));
      // green, dry, and now and then a wildflower
      const r = hash(x, z, 11);
      if (this.kind === 'fern') this._c.setHSL(0.24 + hash(x, z, 13) * 0.06, 0.45, 0.2 + hash(x, z, 14) * 0.08);
      else if (r < 0.03) this._c.setHSL(hash(x, z, 12) < 0.5 ? 0.13 : 0.78, 0.7, 0.6);
      else this._c.setHSL(0.18 + hash(x, z, 13) * 0.09 - meadow * 0.03, 0.45 + meadow * 0.2, 0.22 + hash(x, z, 14) * 0.08);
      this.mesh.setColorAt(base + i, this._c);
    }
  }

  // Keep the field centred on the raider; re-seed cells only when they move a cell.
  update(pos) {
    const pcx = Math.floor(pos.x / CELL);
    const pcz = Math.floor(pos.z / CELL);
    if (this.centre && this.centre.x === pcx && this.centre.z === pcz) return;
    this.centre = { x: pcx, z: pcz };
    let changed = false;
    for (let dx = -this.radius; dx <= this.radius; dx++) {
      for (let dz = -this.radius; dz <= this.radius; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        // each cell always maps to the same slot (wrapping), so only new cells refill
        const slot = (((cx % this.side) + this.side) % this.side) * this.side + (((cz % this.side) + this.side) % this.side);
        const key = `${cx},${cz}`;
        if (this.slots.get(slot) === key) continue;
        this.slots.set(slot, key);
        this.fillCell(slot, cx, cz);
        changed = true;
      }
    }
    if (changed) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
