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
    // Every Sanctuary room is rebuilt in Blender (tools/blender/build_quarters.py,
    // build_sanctuary.py). Only the traders, who are characters, still come
    // from the web game: keep the objects that hold a skinned mesh.
    for (const c of [...s.scene.children]) {
      let skinned = false;
      c.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
      if (!skinned) s.scene.remove(c);
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
