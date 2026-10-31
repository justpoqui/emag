// Exports Scrapfall's code-built models as .glb files for Godot and Blender.
// Run with `node tools/export-glb/run.cjs` (starts Vite, drives this page in
// headless Chromium and writes the files to godot/models/).
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildWorld } from '../../src/world.js';
import { Sanctuary } from '../../src/sanctuary.js';
import { buildRaiderModel, buildGunModel } from '../../src/player.js';
import { Husk } from '../../src/enemies.js';
import { ENEMIES, ITEMS } from '../../src/config.js';
import { QUALITY } from '../../src/settings.js';

const log = (s) => (document.getElementById('log').textContent += '\n' + s);

// glTF has no sprites or points: drop them. Instanced meshes (bushes, rail
// sleepers, bulbs) are exported once as a base mesh plus a list of transforms,
// which Godot draws with a MultiMesh. Every other mesh is indexed and stripped
// of attributes its material never reads, to keep the files small.
function prepare(root, skip = new Set(), instances = null) {
  const drop = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (skip.has(o) || o.isSprite || o.isPoints) drop.push(o);
    else if (o.isInstancedMesh) {
      if (instances) {
        const m = new THREE.Matrix4();
        const xforms = [];
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          xforms.push(...m.clone().premultiply(o.matrixWorld).elements.map((v) => +v.toFixed(4)));
        }
        const base = new THREE.Mesh(o.geometry, o.material);
        base.name = `${o.name || 'instances'}_${instances.length}`;
        instances.push({ name: base.name, mesh: base, transforms: xforms });
      }
      drop.push(o);
    }
  });
  for (const o of drop) o.parent && o.parent.remove(o);
  root.traverse((o) => {
    if (o.isMesh && !o.isSkinnedMesh) o.geometry = slim(o.geometry, o.material);
  });
  return root;
}

function slim(geo, material) {
  const mats = Array.isArray(material) ? material : [material];
  const g = geo.clone();
  if (!mats.some((m) => m && m.vertexColors)) g.deleteAttribute('color');
  const textured = mats.some((m) => m && (m.map || m.bumpMap || m.normalMap || m.roughnessMap || m.emissiveMap || m.alphaMap));
  if (!textured) g.deleteAttribute('uv');
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return mergeVertices(g, 1e-4);
}

async function toGlb(root) {
  const data = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
  const bytes = new Uint8Array(data);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Writes <scene>_instances/<name>.glb for each instanced mesh, and
// <scene>_instances.json listing each one's file and transforms (Three.js
// column-major 4x4 matrices, 16 numbers per instance).
async function addInstances(out, scene, inst) {
  const list = [];
  for (const it of inst) {
    const file = `${scene}_instances/${it.name}.glb`;
    out[file] = await toGlb(prepare(it.mesh));
    list.push({ file, transforms: it.transforms });
  }
  out[`${scene}_instances.json`] = btoa(JSON.stringify(list));
}

async function run() {
  const out = {};

  // The Dustline (Golden Hour). The grass and ferns follow the raider at runtime,
  // so they are left out; Godot gets its own grass.
  {
    const scene = new THREE.Scene();
    const world = buildWorld(scene, { grass: QUALITY.high.grass });
    const grass = new Set((world.foliage || []).map((f) => f.mesh).filter(Boolean));
    const root = new THREE.Group();
    root.name = 'Dustline';
    for (const c of [...scene.children]) root.add(c);
    const inst = [];
    out['dustline.glb'] = await toGlb(prepare(root, grass, inst));
    await addInstances(out, 'dustline', inst);
    log('dustline.glb');
  }

  // The Patron's Sanctuary hub.
  {
    const s = new Sanctuary(QUALITY.high);
    s.frontWall.visible = true; // only hidden for the title-screen camera
    s.scene.remove(s.player.model); // Godot has its own walkable raider
    // Sanctuary rooms are rebuilt in Blender one at a time (tools/blender/
    // build_quarters.py, build_sanctuary.py). Leave out everything inside a
    // finished room's footprint; keep the rest, and always keep the traders
    // (characters, reworked separately). Add a room here when it's finished.
    const FINISHED = [
      { name: 'quarters', x: [-4.3, 4.3], z: [-3.56, 3.75] },
      { name: 'hallway', x: [-5.2, 33.0], z: [-6.7, -3.56] },
      { name: 'trade_hall', x: [-0.6, 9.0], z: [-15.1, -6.7] },
      { name: 'workshop', x: [9.0, 19.0], z: [-15.1, -6.7] },
      { name: 'checkout', x: [19.0, 28.7], z: [-15.1, -6.7] },
      { name: 'lift', x: [32.9, 36.7], z: [-6.7, -3.5] },
    ];
    // Each trader gets a room of their own (author request). The Trade Hall
    // is Tobias's gun shop; Nia and Pell have the rooms behind the CLINIC and
    // RADIO & PARTS shopfronts, south of the hallway, where they face north
    // across their counters (rot: turned to face -z).
    const TRADERS_NOW = [
      { x: 1.6, z: -13.0, to: [3.2, 0, -11.7] }, // Tobias
      { x: 4.25, z: -13.0, to: [17.4, 0, -0.35], rot: Math.PI }, // Nia, in her clinic
      { x: 6.9, z: -13.0, to: [27.0, 0, -0.35], rot: Math.PI }, // Pell, in his radio and parts shop
    ];
    // In Godot the hallway is 5 m wide, so everything north of it (the Trade
    // Hall, Workshop, Checkout and their traders) sits 2 m further north.
    const ROOM_SHIFT = -2.0;
    const box = new THREE.Box3();
    const centre = new THREE.Vector3();
    for (const c of [...s.scene.children]) {
      let skinned = false;
      c.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
      if (skinned) {
        const t = TRADERS_NOW.find((n) => Math.abs(c.position.x - n.x) < 0.3 && Math.abs(c.position.z - n.z) < 0.3);
        if (t && !t.to) {
          s.scene.remove(c);
          continue;
        }
        if (t) {
          c.position.set(...t.to);
          if (t.rot !== undefined) c.rotation.y = t.rot;
        }
      }
      if (c.isLight) c.getWorldPosition(centre);
      else if (box.setFromObject(c).isEmpty()) continue;
      else box.getCenter(centre);
      const inside = FINISHED.some((r) => centre.x > r.x[0] && centre.x < r.x[1] && centre.z > r.z[0] && centre.z < r.z[1] && centre.y < 3.7);
      if (inside && !skinned) s.scene.remove(c);
      else if (centre.z < -6.7) c.position.z += ROOM_SHIFT;
    }
    const root = new THREE.Group();
    root.name = 'Sanctuary';
    for (const c of [...s.scene.children]) root.add(c);
    const inst = [];
    out['sanctuary.glb'] = await toGlb(prepare(root, new Set(), inst));
    await addInstances(out, 'sanctuary', inst);
    log('sanctuary.glb');
  }

  // The raider in its default outfit.
  {
    const root = buildRaiderModel();
    root.name = 'Raider';
    out['raider.glb'] = await toGlb(prepare(root));
    log('raider.glb');
  }

  // One file per Husk type.
  for (const type of Object.keys(ENEMIES)) {
    const scene = new THREE.Scene();
    const h = new Husk(type, 0, 0, 0, null, scene);
    if (h.huh) h.model.remove(h.huh);
    h.model.position.set(0, 0, 0);
    h.model.rotation.set(0, 0, 0);
    h.model.name = ENEMIES[type].name;
    out[`husks/${type}.glb`] = await toGlb(prepare(h.model));
    log(`husks/${type}.glb`);
  }

  // One file per gun.
  for (const [id, item] of Object.entries(ITEMS)) {
    if (item.type !== 'weapon') continue;
    const root = buildGunModel(id);
    root.name = item.name;
    out[`weapons/${id}.glb`] = await toGlb(prepare(root));
    log(`weapons/${id}.glb`);
  }

  window.__glb = out;
  log('done');
}

run().catch((e) => {
  window.__glbError = String(e && e.stack ? e.stack : e);
  log('ERROR ' + window.__glbError);
});
