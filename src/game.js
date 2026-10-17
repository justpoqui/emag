// The game: renderer, the topside raid loop, Husk spawning, looting,
// extraction, and the hand-off between the hub (menus) and raids.

import * as THREE from 'three';
import {
  ITEMS, MAPS, CARRY_LIMIT, HOLSTER_SPEED_BONUS, SHIELD_WEAR, MAX_DURABILITY, isDurable, LOOT_TABLES, ENEMIES, RAID_SECONDS, EXTRACT_CALL_SECONDS, EXTRACT_OPEN_SECONDS, PLAYER,
} from './config.js';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { Husk } from './enemies.js';
import { Weapons } from './weapons.js';
import { Effects } from './effects.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { rollTable, makeRng } from './rng.js';
import {
  blankProfile, loadoutWeight, durability, saveProfile, addToSlots, removeFrom, loadoutValue, emptyLoadout, countIn,
} from './inventory.js';
import * as Audio from './audio.js';
import { getQuality, IS_TOUCH } from './settings.js';
import { TouchControls } from './touch.js';
import { Sanctuary } from './sanctuary.js';

const SEARCH_TIME = { crate: 1.2, locker: 1.0, medical: 1.0, weapon_case: 1.8, husk_pod: 2.0, car: 1.4, wreck: 0.9 };
const MAX_HUSKS = 40;
// share of loot spots that get a container each raid
const CONTAINER_FILL = 0.6;

export class Game {
  constructor(container) {
    this.container = container;
    this.profile = blankProfile(); // replaced when a player signs in
    this.mode = 'login';
    this.paused = false;
    this.using = null;
    this.enemies = [];
    this.grenades = [];
    this.shakeAmt = 0;
    this.time = 0;

    // ---- renderer ----
    const quality = getQuality();
    this.quality = quality;
    const renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = quality.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    scene.fog = new THREE.FogExp2(0xd9b48f, 0.0065);
    scene.background = new THREE.Color(0xd9b48f);
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 1500);
    this.baseFov = 72;

    this.buildSky();
    // image-based lighting from the sky so metal (Husk plating, containers) isn't pitch black
    {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      envScene.add(this.sky.clone());
      const groundDisc = new THREE.Mesh(new THREE.CircleGeometry(1000, 16), new THREE.MeshBasicMaterial({ color: 0x6a5a40, side: THREE.DoubleSide }));
      groundDisc.rotation.x = -Math.PI / 2;
      groundDisc.position.y = -20;
      envScene.add(groundDisc);
      scene.environment = pmrem.fromScene(envScene, 0.04, 0.1, 3000).texture;
      scene.environmentIntensity = 0.7;
      pmrem.dispose();
    }
    const hemi = new THREE.HemisphereLight(0xffe2c0, 0x5a5040, 0.7);
    this.hemi = hemi;
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd2a0, 2.6);
    sun.castShadow = quality.shadows;
    sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
    const sc = sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 70;
    sc.bottom = -70;
    sc.near = 1;
    sc.far = 400;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;
    // headlamp for night raids
    this.headlamp = new THREE.SpotLight(0xfff0d8, 0, 45, 0.45, 0.55, 1.4);
    scene.add(this.headlamp, this.headlamp.target);
    try {
      this.selectedMap = MAPS.find((m) => m.id === localStorage.getItem('scrapfall_map')) || MAPS[0];
    } catch (err) {
      this.selectedMap = MAPS[0];
    }
    this.map = MAPS[0];
    this.sunDir = new THREE.Vector3(-0.55, 0.42, 0.72).normalize();

    // ---- world ----
    this.world = buildWorld(scene, { grass: quality.grass });
    this.sanctuary = new Sanctuary(quality);
    this.col = this.world.collision;
    this.buildContainers();

    this.player = new Player(scene, this.col);
    this.player.model.visible = false;
    this.weapons = new Weapons(this);
    this.overlay = document.getElementById('overlay');
    this.effects = new Effects(scene, this.camera, document.getElementById('numbers'));
    this.input = new Input(renderer.domElement);
    try {
      const sens = Number(localStorage.getItem('scrapfall_sens'));
      if (sens > 0) this.input.sensitivity = sens;
    } catch (err) {
      // storage blocked: keep the default
    }
    try {
      const vol = localStorage.getItem('scrapfall_vol');
      if (vol !== null) this.savedVolume = Number(vol);
    } catch (err) {
      // ignore
    }
    renderer.domElement.addEventListener('click', () => {
      if ((this.mode === 'raid' || this.mode === 'explore') && !this.paused && !this.ui.menuOpen() && !this.input.locked) this.input.lock();
    });
    this.ui = new UI(this);
    if (this.savedVolume !== undefined) {
      this.ui.volume = this.savedVolume;
      Audio.setVolume(this.savedVolume);
    }
    if (IS_TOUCH) {
      document.body.classList.add('touch');
      this.touch = new TouchControls(this.input, this);
    }
    this.input.onLockChange = (locked) => {
      if (!locked && this.mode === 'raid' && !this.ui.menuOpen() && this.player.alive) this.setPaused(true);
      if (!locked && this.mode === 'explore' && !this.ui.menuOpen()) this.ui.showExplorePause();
    };

    this.yaw = 0;
    this.pitch = 0;
    this.recoil = { pitch: 0, yaw: 0 };
    this.camDist = 3.2;
    this.adsT = 0;
    this.interact = { target: null, progress: 0 };

    window.addEventListener('resize', () => this.resize());
    this.clock = new THREE.Clock();
    this.player.alive = false; // keeps menu-scene Husks from noticing the hidden player
    this.ui.showLogin();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(1200, 32, 16);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        sunDir: { value: new THREE.Vector3(-0.55, 0.42, 0.72).normalize() },
        horizonC: { value: new THREE.Color(0.93, 0.74, 0.55) },
        midC: { value: new THREE.Color(0.7, 0.72, 0.72) },
        zenithC: { value: new THREE.Color(0.33, 0.5, 0.62) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 sunDir; uniform vec3 horizonC; uniform vec3 midC; uniform vec3 zenithC; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 horizon = horizonC;
          vec3 mid = midC;
          vec3 zenith = zenithC;
          vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, h));
          col = mix(col, zenith, smoothstep(0.25, 0.9, h));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          col += vec3(1.0, 0.75, 0.45) * pow(s, 8.0) * 0.45;
          col += vec3(1.0, 0.9, 0.7) * pow(s, 400.0) * 3.0;
          if (h < 0.0) col = mix(col, vec3(0.6, 0.5, 0.4), -h * 4.0);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, material);
    this.scene.add(this.sky);
  }

  // ---------- containers ----------
  // The world lists every spot loot can appear at. Each raid a random share of
  // them gets a container, of a random type from the spot's pool.
  buildContainers() {
    this.containerMats = {
      wood: new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.9 }),
      olive: new THREE.MeshStandardMaterial({ color: 0x55603a, roughness: 0.7, metalness: 0.3 }),
      locker: new THREE.MeshStandardMaterial({ color: 0x5f7f86, roughness: 0.6, metalness: 0.5 }),
      white: new THREE.MeshStandardMaterial({ color: 0xe6e2d6, roughness: 0.6 }),
      red: new THREE.MeshStandardMaterial({ color: 0xc23a2a, roughness: 0.6 }),
      case: new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.5, metalness: 0.6 }),
      husk: new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.4, metalness: 0.8 }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.7 }),
      podGlow: new THREE.MeshStandardMaterial({ color: 0x40ffd0, emissive: 0x30ffc0, emissiveIntensity: 1.5 }),
      marker: new THREE.MeshBasicMaterial({ color: 0xffd27a }),
    };
    this.markerGeo = new THREE.OctahedronGeometry(0.08, 0);
    // one collider per spot, sized for the biggest container and switched off
    // until a raid puts something there
    this.containerSpots = this.world.containers.map((c) => ({
      ...c,
      box: c.pool.includes('car') ? null : Object.assign(this.col.addBox({ x: c.x - 0.8, y: c.y, z: c.z - 0.8 }, { x: c.x + 0.8, y: c.y + 1.9, z: c.z + 0.8 }, 'metal'), { off: true }),
    }));
    this.containers = [];
  }

  makeContainer(spot, type, id) {
    const mats = this.containerMats;
    const g = new THREE.Group();
    const add = (sx, sy, sz, m, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    let size = [1, 1, 1];
    let lid = null;
    switch (type) {
      case 'crate':
        add(1.1, 0.7, 0.8, mats.wood, 0, 0.35, 0);
        lid = add(1.14, 0.1, 0.84, mats.olive, 0, 0.75, 0);
        size = [1.1, 0.8, 0.8];
        break;
      case 'locker':
        add(0.8, 1.9, 0.55, mats.locker, 0, 0.95, 0);
        lid = add(0.76, 1.8, 0.04, mats.locker, 0, 0.95, 0.29);
        size = [0.8, 1.9, 0.55];
        break;
      case 'medical':
        add(0.9, 0.55, 0.5, mats.white, 0, 0.28, 0);
        add(0.3, 0.1, 0.02, mats.red, 0, 0.3, 0.26);
        add(0.1, 0.3, 0.02, mats.red, 0, 0.3, 0.26);
        lid = add(0.92, 0.08, 0.52, mats.white, 0, 0.6, 0);
        size = [0.9, 0.6, 0.5];
        break;
      case 'weapon_case':
        add(1.5, 0.35, 0.55, mats.case, 0, 0.18, 0);
        lid = add(1.52, 0.1, 0.57, mats.olive, 0, 0.4, 0);
        size = [1.5, 0.45, 0.55];
        break;
      case 'husk_pod':
        add(0.9, 0.9, 0.9, mats.husk, 0, 0.45, 0).rotation.set(0.3, 0.6, 0.2);
        lid = add(0.3, 0.3, 0.3, mats.podGlow, 0, 1.0, 0);
        size = [1, 1, 1];
        break;
      case 'car':
        lid = add(1.2, 0.08, 0.6, mats.trunk, 0, 1.0, 0);
        size = null; // the car already collides
        break;
      default:
        break;
    }
    if (lid) lid.castShadow = false;
    const marker = new THREE.Mesh(this.markerGeo, mats.marker);
    marker.position.y = (size ? size[1] : 1) + 0.35;
    g.add(marker);
    g.position.set(spot.x, spot.y, spot.z);
    g.rotation.y = spot.rotY || 0;
    this.scene.add(g);
    if (spot.box && size) {
      const rotated = Math.abs(Math.sin(spot.rotY || 0)) > 0.5;
      const hx = rotated ? size[2] / 2 : size[0] / 2;
      const hz = rotated ? size[0] / 2 : size[2] / 2;
      Object.assign(spot.box.min, { x: spot.x - hx, y: spot.y, z: spot.z - hz });
      Object.assign(spot.box.max, { x: spot.x + hx, y: spot.y + size[1] * (type === 'locker' ? 1 : 0.95), z: spot.z + hz });
      spot.box.off = false;
    }
    return { ...spot, type, id, group: g, lid, marker, items: [], searched: false, name: LOOT_TABLES[type].name, height: size ? size[1] : 1 };
  }

  resetContainers() {
    for (const c of this.containers) {
      this.scene.remove(c.group);
      c.group.traverse((o) => o.geometry && o.geometry !== this.markerGeo && o.geometry.dispose());
    }
    for (const spot of this.containerSpots) if (spot.box) spot.box.off = true;
    this.containers = [];
    for (const spot of this.containerSpots) {
      if (Math.random() > CONTAINER_FILL) continue;
      const type = spot.pool[Math.floor(Math.random() * spot.pool.length)];
      const c = this.makeContainer(spot, type, this.containers.length);
      c.items = rollTable(LOOT_TABLES[type]);
      // richer conditions roll extra stacks
      const extra = (this.map ? this.map.loot : 1) - 1;
      if (extra > 0 && Math.random() < extra) c.items.push(...rollTable(LOOT_TABLES[type]).slice(0, 1));
      // gear found topside is used
      for (const it of c.items) if (isDurable(it.id)) it.dur = Math.round(MAX_DURABILITY * (0.35 + Math.random() * 0.55));
      this.containers.push(c);
    }
    for (const w of this.wrecks || []) {
      this.scene.remove(w.group);
    }
    this.wrecks = [];
  }

  openContainerVisual(c) {
    if (!c.lid || c.lid.userData.opened === c.searchedAt) return;
    c.lid.userData.opened = c.searchedAt;
    if (c.type === 'locker') {
      c.lid.position.x += 0.3;
      c.lid.position.z += 0.3;
      c.lid.rotation.y = -1.3;
    } else if (c.type === 'husk_pod') {
      c.lid.visible = false;
    } else {
      c.lid.position.y += 0.2;
      c.lid.position.z -= 0.35;
      c.lid.rotation.x = -1.1;
    }
  }

  spawnWreck(enemy) {
    const drops = rollTable(enemy.def.drops);
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: 0x5a5e62, roughness: 0.6, metalness: 0.7 });
    const scale = Math.max(0.5, enemy.def.radius);
    for (let i = 0; i < 5; i++) {
      const piece = new THREE.Mesh(new THREE.BoxGeometry(0.4 * scale, 0.2 * scale, 0.3 * scale), m);
      piece.position.set((Math.random() - 0.5) * scale, 0.1 * scale, (Math.random() - 0.5) * scale);
      piece.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      piece.castShadow = true;
      g.add(piece);
    }
    const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
    glow.position.y = 0.6;
    g.add(glow);
    const y = this.col.groundHeight(enemy.pos.x, enemy.pos.z, enemy.pos.y + 1, 0.3, 50);
    g.position.set(enemy.pos.x, y, enemy.pos.z);
    this.scene.add(g);
    const wreck = {
      type: 'wreck', name: `${enemy.def.name} Wreck`, x: g.position.x, y, z: g.position.z, group: g, marker: glow, items: drops, searched: false, height: 0.5,
    };
    this.wrecks.push(wreck);
  }

  // ---------- deployment conditions ----------
  applyMap(map) {
    this.map = map;
    const scene = this.scene;
    scene.fog.color.setHex(map.fog);
    scene.fog.density = map.fogDensity;
    scene.background.setHex(map.fog);
    const u = this.sky.material.uniforms;
    u.horizonC.value.setRGB(...map.sky[0]);
    u.midC.value.setRGB(...map.sky[1]);
    u.zenithC.value.setRGB(...map.sky[2]);
    this.sunDir.set(...map.sunDir).normalize();
    u.sunDir.value.copy(this.sunDir);
    this.sun.color.setHex(map.sun);
    this.sun.intensity = map.sunI;
    this.hemi.color.setHex(map.hemi);
    this.hemi.intensity = map.hemiI;
    scene.environmentIntensity = map.env;
    this.renderer.toneMappingExposure = map.exposure;
    this.headlamp.intensity = map.headlamp ? 55 : 0;
  }

  selectMap(map) {
    this.selectedMap = map;
    try {
      localStorage.setItem('scrapfall_map', map.id);
    } catch (err) {
      // ignore
    }
  }

  // ---------- exploring the Sanctuary ----------
  enterExplore() {
    this.mode = 'explore';
    this.paused = false;
    this.preview = null;
    this.sanctuary.refresh(this.profile);
    this.sanctuary.setMapImage(this.ui.mapBaseCanvas());
    this.sanctuary.enterExplore();
    this.ui.showExplore();
    this.input.lock();
  }

  leaveExplore() {
    this.sanctuary.leaveExplore();
    this.preview = null;
    this.input.unlock();
    this.enterHub();
  }

  updateExplore(dt) {
    const input = this.input;
    const menu = this.ui.menuOpen();
    if (this.touch) this.touch.update(!menu, !!this.exploreTarget);
    if (!menu) {
      if (input.hit('Tab') || input.hit('KeyI')) this.ui.openExplorePanel('stash');
    } else if (input.hit('Escape') || (this.ui.open === 'panel' && input.hit('Tab'))) {
      this.ui.closeMenus();
    }
    this.sanctuary.updateExplore(dt, input, !menu, input.sensitivity);
    // what can we interact with?
    const it = menu ? null : this.sanctuary.findInteractable();
    this.exploreTarget = it;
    const holding = input.down('KeyE');
    if (it && it.hold) {
      this.exploreHold = holding ? (this.exploreHold || 0) + dt : 0;
      if (this.exploreHold >= it.hold) {
        this.exploreHold = 0;
        this.exploreInteract(it);
      }
    } else {
      this.exploreHold = 0;
      if (it && input.hit('KeyE')) this.exploreInteract(it);
    }
    this.ui.updateExplore(this.sanctuary.roomName(), it, it && it.hold ? this.exploreHold / it.hold : 0);
  }

  exploreInteract(it) {
    Audio.playUI();
    if (it.kind === 'stash') this.ui.openExplorePanel('stash');
    if (it.kind === 'trader') this.ui.openExplorePanel('trader', it.trader);
    if (it.kind === 'bench') this.ui.openExplorePanel('bench', it.section);
    if (it.kind === 'checkout') this.ui.openExplorePanel('checkout');
    if (it.kind === 'lift') this.ui.deploy();
  }

  // The Checkout shows a live view of the selected deployment.
  renderPreview(dt) {
    const map = this.preview;
    if (this.map !== map) this.applyMap(map);
    const town = this.world.town;
    this.previewT = (this.previewT || 0) + dt * 0.05;
    const t = this.previewT;
    const r = 95;
    this.camera.position.set(town.x + 30 + Math.cos(t) * r, 34, town.z + 10 + Math.sin(t) * r);
    this.camera.lookAt(town.x + 20, 4, town.z + 10);
    if (this.camera.fov !== 55) {
      this.camera.fov = 55;
      this.camera.updateProjectionMatrix();
    }
    this.hubFocus = new THREE.Vector3(town.x + 20, 0, town.z + 10);
    this.updateSun();
    this.renderer.render(this.scene, this.camera);
  }

  // ---------- raid lifecycle ----------
  startRaid() {
    Audio.initAudio();
    this.mode = 'raid';
    this.paused = false;
    this.preview = null;
    this.sanctuary.leaveExplore();
    this.applyMap(this.selectedMap);
    this.getHuskCtx().sightMul = this.map.sight;
    this.raidTime = RAID_SECONDS;
    this.raidStats = { kills: 0, startValue: loadoutValue(this.profile.loadout), looted: {}, xp: 0, started: performance.now() };
    this.profile.stats.raids++;
    this.profile.inRaid = true; // if the tab closes mid-raid, the loadout is lost (like a real raid)
    saveProfile(this.profile);

    this.resetContainers();
    for (const e of this.enemies) e.destroy();
    this.enemies = [];
    this.grenades = [];
    this.effects.clear();
    for (const ex of this.world.extractions) this.setLift(ex, 'idle');

    const rng = makeRng(Date.now());
    for (const s of this.world.enemySpawns) {
      const base = s.count || 1;
      const n = Math.max(base, Math.round(base * this.map.husks + (this.map.husks > 1 && rng.chance(this.map.husks - 1) ? 1 : 0)));
      for (let i = 0; i < n; i++) this.spawnEnemyAt(s.type, s.x + rng.range(-s.radius, s.radius) * 0.5, s.z + rng.range(-s.radius, s.radius) * 0.5, null, s);
    }
    this.respawnTimer = 45;

    const ins = rng.pick(this.world.insertions);
    // face towards the map centre
    const yaw = Math.atan2(-ins.x, -ins.z);
    this.player.spawn(ins.x, ins.z, yaw);
    this.yaw = yaw;
    this.pitch = -0.05;
    this.player.health = PLAYER.health;
    this.weapons.reset();
    this.player.model.visible = true;
    this.input.lock();
    Audio.setWind(true);
    this.ui.showRaidHud();
    this.ui.notify('Topside. Find loot, then reach a lift to extract.');
  }

  endRaid(extracted, reason) {
    if (this.mode !== 'raid') return;
    this.mode = 'results';
    if (this.touch) this.touch.update(false, false);
    this.using = null;
    this.input.unlock();
    Audio.setWind(false);
    const p = this.profile;
    const lostValue = loadoutValue(p.loadout);
    let summary;
    if (extracted) {
      p.stats.extracts++;
      const xp = this.raidStats.xp + 100;
      this.giveXp(xp);
      summary = { extracted: true, value: lostValue, gained: lostValue - this.raidStats.startValue, kills: this.raidStats.kills, xp, looted: this.raidStats.looted };
      Audio.playChime();
    } else {
      p.stats.deaths++;
      // everything but the safe pocket is lost
      const kept = p.loadout.safe;
      p.loadout = emptyLoadout();
      p.loadout.safe = kept;
      const xp = Math.floor(this.raidStats.xp * 0.5);
      this.giveXp(xp);
      summary = { extracted: false, reason, value: lostValue, kills: this.raidStats.kills, xp, looted: this.raidStats.looted };
    }
    p.inRaid = false;
    saveProfile(p);
    this.ui.showResults(summary);
  }

  giveXp(xp) {
    const p = this.profile;
    p.xp += xp;
    while (p.xp >= this.xpForLevel(p.level)) {
      p.xp -= this.xpForLevel(p.level);
      p.level++;
    }
  }

  xpForLevel(level) {
    return 300 + level * 150;
  }

  returnToHub() {
    for (const e of this.enemies) e.destroy();
    this.enemies = [];
    this.effects.clear();
    this.player.model.visible = false;
    this.player.alive = false;
    this.enterHub();
  }

  // Called after sign-in with that account's save.
  useProfile(profile) {
    this.profile = profile;
    if (profile.inRaid) {
      // the game was closed mid-raid: that counts as dying topside
      const kept = profile.loadout.safe;
      profile.loadout = emptyLoadout();
      profile.loadout.safe = kept;
      profile.stats.deaths++;
      profile.inRaid = false;
      saveProfile(profile);
      setTimeout(() => this.ui.notifyHub('You left mid-raid last time, so that loadout was lost topside.'), 600);
    }
    this.weapons.reset();
    this.goHome();
  }

  enterHub() {
    this.mode = 'hub';
    this.ui.showHub();
  }

  goHome() {
    this.mode = 'home';
    this.ui.showHome();
  }

  setPaused(on) {
    this.paused = on;
    if (this.touch && on) this.touch.update(false, false);
    this.ui.showPause(on);
    if (!on) this.input.lock();
  }

  // ---------- Husk ----------
  spawnEnemyAt(type, x, z, alertAt, home) {
    if (this.enemies.filter((e) => !e.dead).length >= MAX_HUSKS && !alertAt) return null;
    const y = this.col.groundHeight(x, z, 300, ENEMIES[type].radius, 400);
    const e = new Husk(type, x, y, z, home || { x, z, radius: 20 }, this.scene);
    if (alertAt) e.alert(alertAt, true);
    this.enemies.push(e);
    return e;
  }

  damageEnemy(enemy, amount, ap, mult, weak, at) {
    const dealt = enemy.damage(amount, ap, mult, weak);
    this.effects.damageNumber(at, dealt, weak ? '#ffb030' : '#ffffff', weak);
    enemy.alert(this.player.pos, true);
    Audio.playHit(weak);
    let killed = false;
    if (enemy.hp <= 0 && !enemy.dead) {
      killed = true;
      this.killEnemy(enemy);
    }
    return { dealt, killed };
  }

  killEnemy(enemy) {
    enemy.dead = true;
    this.raidStats.kills++;
    this.profile.stats.kills++;
    this.raidStats.xp += enemy.def.xp;
    this.effects.explosion(enemy.center.clone(), Math.max(1.5, enemy.def.radius * 1.4));
    Audio.playExplosion(enemy.distTo);
    Audio.playKill();
    this.ui.notify(`${enemy.def.name} destroyed  +${enemy.def.xp} XP`);
    this.spawnWreck(enemy);
  }

  explode(pos, radius, damage, source) {
    this.effects.explosion(pos, radius);
    const dist = pos.distanceTo(this.player.pos);
    Audio.playExplosion(dist);
    this.shake(Math.max(0, 0.8 - dist / 30));
    this.noise(pos, 60);
    const p = this.player;
    const pd = pos.distanceTo(p.chest());
    if (p.alive && pd < radius && this.col.lineOfSight(pos.clone().setY(pos.y + 0.3), p.chest())) {
      this.damagePlayer(damage * (1 - (pd / radius) * 0.7), pos, source);
    }
    for (const e of this.enemies) {
      if (e.dead || e === source) continue;
      const d = pos.distanceTo(e.center);
      if (d < radius + e.def.radius) {
        const res = this.damageEnemy(e, damage * (1 - Math.min(1, d / (radius + e.def.radius)) * 0.6), 0.5, 1, false, e.center.clone());
        if (res.killed && source === 'player') this.ui.hitMarker(false, true);
      }
    }
  }

  noise(pos, radius) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.pos.distanceTo(pos) < radius) e.alert(pos, false);
    }
  }

  shake(amount) {
    this.shakeAmt = Math.min(1, this.shakeAmt + amount);
  }

  damagePlayer(amount, fromPos, source) {
    const p = this.player;
    if (!p.alive || this.mode !== 'raid') return;
    if (p.roll > 0.15) amount *= 0.5; // dodging takes the edge off
    const shield = this.profile.loadout.shield;
    let toHealth = amount;
    if (shield && shield.charge > 0 && durability(shield) > 0) {
      const def = ITEMS[shield.id];
      const absorbed = Math.min(shield.charge, amount * def.absorb);
      shield.charge -= absorbed;
      const before = durability(shield);
      shield.dur = Math.max(0, before - absorbed * SHIELD_WEAR);
      if (before > 0 && shield.dur <= 0) this.ui.notify(`${def.name} broke! Repair it at the Workbench.`);
      toHealth = amount - absorbed;
      if (shield.charge <= 0) {
        shield.charge = 0;
        Audio.playShieldBreak();
        this.ui.notify('Shield depleted!');
      } else {
        Audio.playShieldHit();
      }
    }
    p.health -= toHealth;
    p.lastDamage = this.time;
    Audio.playHurt();
    this.shake(Math.min(0.4, amount / 60));
    if (fromPos) {
      const ang = Math.atan2(fromPos.x - p.pos.x, fromPos.z - p.pos.z) - this.yaw;
      this.ui.damageDir(ang);
    }
    if (this.using) this.cancelUse();
    if (p.health <= 0) {
      p.health = 0;
      p.die();
      const name = source && source.def ? source.def.name : 'the topside';
      this.ui.notify(`You were downed by ${source === 'player' ? 'your own grenade' : name}.`);
      setTimeout(() => this.endRaid(false, `Killed by ${source === 'player' ? 'your own grenade' : name}`), 2200);
    }
  }

  // ---------- items ----------
  useQuick(type) {
    const bag = this.profile.loadout.bag;
    const order = type === 'heal' ? ['med_kit', 'bandage'] : ['shield_cell'];
    const p = this.player;
    if (type === 'heal' && p.health >= PLAYER.health) return this.ui.notify('Already at full health.');
    if (type === 'recharge') {
      const s = this.profile.loadout.shield;
      if (!s) return this.ui.notify('No shield equipped.');
      if (s.charge >= ITEMS[s.id].capacity) return this.ui.notify('Shield is full.');
    }
    // prefer the smallest heal that fills you up
    let pick = null;
    for (const id of type === 'heal' && PLAYER.health - p.health <= 30 ? ['bandage', 'med_kit'] : order) {
      if (countIn(bag, id) > 0) {
        pick = id;
        break;
      }
    }
    if (!pick) return this.ui.notify(type === 'heal' ? 'No healing items in your bag.' : 'No shield cells in your bag.');
    this.startUse(pick);
  }

  startUse(id) {
    if (this.using || !this.player.alive) return;
    const def = ITEMS[id];
    this.weapons.cancelReload();
    this.using = { id, t: 0, total: def.useTime };
    Audio.playSearch();
  }

  cancelUse() {
    this.using = null;
    this.player.slow = 0;
  }

  finishUse() {
    const { id } = this.using;
    const def = ITEMS[id];
    const bag = this.profile.loadout.bag;
    this.using = null;
    this.player.slow = 0;
    if (removeFrom(bag, id, 1) < 1) return;
    if (def.type === 'heal') {
      this.player.health = Math.min(PLAYER.health, this.player.health + def.heal);
    } else if (def.type === 'recharge') {
      const s = this.profile.loadout.shield;
      if (s) s.charge = Math.min(ITEMS[s.id].capacity, s.charge + def.recharge);
    }
    Audio.playPickup();
    this.ui.refreshInventory();
  }

  throwGrenade() {
    const bag = this.profile.loadout.bag;
    if (countIn(bag, 'frag') <= 0) return this.ui.notify('No grenades.');
    if (this.grenadeCd > 0) return;
    this.grenadeCd = 1;
    removeFrom(bag, 'frag', 1);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: 0x5a6b3a }));
    const pos = this.player.eye().addScaledVector(dir, 0.6);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    this.scene.add(mesh);
    const vel = dir.clone().multiplyScalar(17).add(new THREE.Vector3(0, 4, 0)).add(this.player.vel.clone().multiplyScalar(0.5));
    this.grenades.push({ mesh, pos, vel, fuse: 2.4 });
    Audio.playReload(0);
    this.ui.refreshInventory();
  }

  updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      g.vel.y -= 20 * dt;
      const speed = g.vel.length();
      const step = speed * dt;
      if (step > 0.0001) {
        const d = g.vel.clone().normalize();
        const hit = this.col.raycast(g.pos.x, g.pos.y, g.pos.z, d.x, d.y, d.z, step + 0.12);
        if (hit) {
          const n = new THREE.Vector3(...hit.normal);
          g.pos.addScaledVector(d, Math.max(0, hit.dist - 0.12));
          g.vel.reflect(n).multiplyScalar(0.45);
          if (Math.abs(n.y) > 0.5 && Math.abs(g.vel.y) < 1.5) g.vel.y = 0;
          if (speed > 3) Audio.playMetalHit(g.pos.distanceTo(this.player.pos));
        } else {
          g.pos.addScaledVector(g.vel, dt);
        }
      }
      // never fall through the ground
      const gy = this.col.groundHeight(g.pos.x, g.pos.z, g.pos.y + 0.2, 0.1);
      if (g.pos.y < gy + 0.12) {
        g.pos.y = gy + 0.12;
        g.vel.y = Math.max(0, g.vel.y);
        g.vel.x *= 1 - Math.min(1, dt * 4);
        g.vel.z *= 1 - Math.min(1, dt * 4);
      }
      g.mesh.position.copy(g.pos);
      if (g.fuse <= 0) {
        this.scene.remove(g.mesh);
        g.mesh.geometry.dispose();
        this.grenades.splice(i, 1);
        this.explode(g.pos.clone(), ITEMS.frag.radius, ITEMS.frag.damage, 'player');
      }
    }
  }

  // ---------- interaction ----------
  findInteractable() {
    const p = this.player;
    const eye = p.eye();
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    let best = null;
    let bestScore = Infinity;
    const consider = (kind, obj, x, y, z, range, label, losY) => {
      const dx = x - p.pos.x;
      const dz = z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range || Math.abs(y - p.pos.y) > 2.2) return;
      const facing = d < 0.8 ? 1 : (dx * fwd.x + dz * fwd.z) / d;
      if (facing < 0.3) return;
      const score = d * (2 - facing);
      // aim the sight line just above the object so its own collider doesn't block it
      if (score < bestScore && this.col.lineOfSight(eye, new THREE.Vector3(x, losY, z))) {
        bestScore = score;
        best = { kind, obj, label };
      }
    };
    for (const c of this.containers) {
      if (c.searched && c.items.length === 0) continue;
      consider('container', c, c.x, c.y, c.z, 2.4, c.searched ? `Loot ${c.name}` : `Search ${c.name}`, c.y + Math.min(c.height, 1.4) + 0.15);
    }
    for (const w of this.wrecks) {
      if (w.searched && w.items.length === 0) continue;
      consider('container', w, w.x, w.y, w.z, 2.4, w.searched ? `Loot ${w.name}` : `Search ${w.name}`, w.y + 0.8);
    }
    for (const ex of this.world.extractions) {
      if (ex.state === 'idle') consider('callLift', ex, ex.panel.x, ex.panel.y - 1, ex.panel.z, 2.4, `Call ${ex.name}`, ex.panel.y + 0.3);
      if (ex.state === 'open') {
        const d = Math.hypot(ex.x - p.pos.x, ex.z - p.pos.z);
        if (d < 2.2) {
          best = { kind: 'extract', obj: ex, label: 'Extract' };
          bestScore = 0;
        }
      }
    }
    return best;
  }

  updateInteraction(dt) {
    // looking for something to interact with is cheap but not free: 10x a second
    this._interactTimer = (this._interactTimer || 0) - dt;
    if (this._interactTimer <= 0) {
      this._interactTimer = 0.1;
      this._interactCache = this.ui.menuOpen() ? null : this.findInteractable();
    }
    const target = this.ui.menuOpen() ? null : this._interactCache;
    const holding = this.input.down('KeyE');
    const it = this.interact;
    if (!target || (it.target && (it.target.obj !== target.obj || it.target.kind !== target.kind))) {
      it.progress = 0;
    }
    it.target = target;
    if (!target) {
      this.ui.setPrompt(null);
      return;
    }
    let need = 0;
    if (target.kind === 'container' && !target.obj.searched) need = SEARCH_TIME[target.obj.type] || 1;
    if (target.kind === 'callLift') need = 1.0;
    if (target.kind === 'extract') need = 1.5;
    if (holding && this.player.alive && !this.using) {
      if (need === 0) {
        if (this.input.hit('KeyE')) this.doInteract(target);
      } else {
        if (it.progress === 0 && target.kind === 'container') Audio.playSearch();
        it.progress += dt;
        if (it.progress >= need) {
          it.progress = 0;
          this.doInteract(target);
        }
      }
    } else {
      it.progress = 0;
    }
    this.ui.setPrompt(target.label, need ? it.progress / need : 0, need > 0);
  }

  doInteract(target) {
    if (target.kind === 'container') {
      const c = target.obj;
      if (!c.searched) {
        c.searched = true;
        c.searchedAt = this.time;
        this.openContainerVisual(c);
        this.noise(this.player.pos, 12);
      }
      this.ui.showLoot(c);
    } else if (target.kind === 'callLift') {
      this.setLift(target.obj, 'calling');
      this.ui.notify(`${target.obj.name} called. Hold out for ${EXTRACT_CALL_SECONDS}s!`);
      Audio.playAlarm(0);
      // the lift's noise draws Husks in
      this.noise(target.obj, 90);
      const ex = target.obj;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        const type = i === 0 ? 'buzzer' : 'skitter';
        setTimeout(() => {
          if (this.mode === 'raid') this.spawnEnemyAt(type, ex.x + Math.cos(a) * 45, ex.z + Math.sin(a) * 45, new THREE.Vector3(ex.x, ex.y + 1, ex.z));
        }, 2000 + i * 4000);
      }
    } else if (target.kind === 'extract') {
      this.extract(target.obj);
    }
  }

  setLift(ex, state) {
    ex.state = state;
    ex.timer = state === 'calling' ? EXTRACT_CALL_SECONDS : state === 'open' ? EXTRACT_OPEN_SECONDS : 0;
    const open = state === 'open';
    ex.door.position.copy(ex.doorBase);
    if (open) ex.door.position.y -= 3.85;
    // move the door's collider out of the way while open
    if (!ex.doorBoxY) ex.doorBoxY = { min: ex.doorBox.min.y, max: ex.doorBox.max.y };
    ex.doorBox.min.y = open ? -999 : ex.doorBoxY.min;
    ex.doorBox.max.y = open ? -998 : ex.doorBoxY.max;
    ex.beam.material.opacity = state === 'idle' ? 0 : open ? 0.25 : 0.1;
  }

  extract(ex) {
    if (!this.player.alive) return;
    this.player.alive = false; // stop input
    Audio.playLift();
    this.ui.fadeOut(() => this.endRaid(true));
    void ex;
  }

  updateLifts(dt) {
    for (const ex of this.world.extractions) {
      ex.lamp.material.emissiveIntensity = ex.state === 'idle' ? 1.5 : 2 + Math.sin(this.time * (ex.state === 'calling' ? 10 : 3)) * 1.5;
      if (ex.state === 'idle') continue;
      ex.timer -= dt;
      if (ex.state === 'calling') {
        ex.beam.material.opacity = 0.06 + Math.abs(Math.sin(this.time * 3)) * 0.08;
        if (ex.timer <= 0) {
          this.setLift(ex, 'open');
          this.ui.notify(`${ex.name} is open! Get inside and hold E.`);
          Audio.playChime();
        }
      } else if (ex.state === 'open' && ex.timer <= 0) {
        this.setLift(ex, 'idle');
        this.ui.notify(`${ex.name} closed.`);
      }
    }
  }

  // ---------- frame ----------
  resize() {
    this.sanctuary.resize();
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    if (this.mode === 'raid') {
      if (!this.paused) this.updateRaid(dt);
      this.effects.update(dt);
      this.updateSun();
      this.renderer.render(this.scene, this.camera);
    } else if (this.mode === 'explore') {
      if (!this.paused) this.updateExplore(dt);
      if (this.preview) this.renderPreview(dt);
      else this.renderer.render(this.sanctuary.scene, this.sanctuary.camera);
    } else {
      // menus show the Patron's Sanctuary with the raider and their gear
      this.sanctuary.refresh(this.mode === 'login' ? null : this.profile);
      this.sanctuary.update(dt, this.mode);
      this.renderer.render(this.sanctuary.scene, this.sanctuary.camera);
    }
    this.input.endFrame();
  }

  updateSun() {
    const focus = this.mode === 'raid' ? this.player.pos : this.hubFocus || new THREE.Vector3();
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 200);
    this.sun.target.position.copy(focus);
    this.sky.position.copy(this.camera.position);
  }

  getHuskCtx() {
    return this.huskCtx || (this.huskCtx = {
      player: this.player, col: this.col, effects: this.effects,
      damagePlayer: (a, from, src) => this.damagePlayer(a, from, src),
      spawnEnemy: (type, x, z, alertAt) => this.spawnEnemyAt(type, x, z, alertAt),
      explode: (pos, r, dmg, src) => this.explode(pos, r, dmg, src),
      notify: (t) => this.ui.notify(t),
      shake: (a) => this.shake(a),
    });
  }

  updateRaid(dt) {
    const input = this.input;
    const p = this.player;
    const menu = this.ui.menuOpen();
    if (this.touch) this.touch.update(!menu && p.alive, !!this.interact.target);

    // ---- keys ----
    if (input.hit('Tab') || input.hit('KeyI')) this.ui.toggleInventory();
    if (input.hit('KeyM')) this.ui.toggleMap();
    if (input.hit('Escape') && menu) this.ui.closeMenus();
    if (p.alive && !menu) {
      if (input.hit('KeyR')) this.weapons.startReload();
      if (input.hit('Digit1')) this.weapons.switchTo(0);
      if (input.hit('Digit2')) this.weapons.switchTo(1);
      if (input.mouse.wheel !== 0) this.weapons.switchTo(1 - this.weapons.active);
      if (input.hit('Digit3')) this.useQuick('heal');
      if (input.hit('Digit4')) this.useQuick('recharge');
      if (input.hit('KeyG')) this.throwGrenade();
      if (input.hit('KeyF')) this.weapons.melee();
      if (input.hit('KeyH') || input.hit('KeyX')) this.weapons.toggleHolster();
      if (input.mouse.right && this.weapons.holstered) this.weapons.draw();
      if (input.hit('KeyC')) p.crouch = !p.crouch;
      if (input.hit('KeyV') || input.hit('AltLeft')) {
        if (p.tryRoll(input.axis())) this.cancelUse();
      }
    }
    this.grenadeCd = (this.grenadeCd || 0) - dt;

    // ---- look ----
    if (!menu && p.alive) {
      const sens = input.sensitivity * (p.ads ? 0.6 / (ITEMS[this.weapons.current()?.id]?.zoom || 1) : 1);
      this.yaw -= input.mouse.dx * sens;
      this.pitch -= input.mouse.dy * sens;
    }
    // recoil recovers over time
    const rp = this.recoil.pitch * Math.min(1, dt * 10);
    const ry = this.recoil.yaw * Math.min(1, dt * 10);
    this.pitch += rp;
    this.yaw += ry;
    this.recoil.pitch -= rp;
    this.recoil.yaw -= ry;
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
    p.yaw = this.yaw;
    p.pitch = this.pitch;

    // ---- move ----
    const axis = p.alive ? input.axis() : { x: 0, y: 0 };
    p.ads = p.alive && !menu && input.mouse.right && p.roll <= 0 && p.armed;
    // carried weight and holstering change how fast you move
    const load = loadoutWeight(this.profile.loadout) / CARRY_LIMIT;
    this.loadRatio = load;
    let mul = load > 1 ? 0.7 : load > 0.75 ? 1 - (load - 0.75) * 0.6 : 1;
    if (this.weapons.holstered || !this.weapons.current()) mul *= HOLSTER_SPEED_BONUS;
    p.speedMul = mul;
    p.canSprint = load <= 1;
    if (this.using) {
      p.slow = 1;
      this.using.t += dt;
      if (this.using.t >= this.using.total) this.finishUse();
    }
    p.update(dt, { x: axis.x, y: axis.y, sprint: input.down('ShiftLeft') || input.down('ShiftRight'), jump: !menu && input.hit('Space'), firing: input.mouse.left });
    if (p.alive && p.health <= 0) {
      p.health = 0;
      p.die();
      this.ui.notify('You fell to your death.');
      setTimeout(() => this.endRaid(false, 'Fell to their death'), 2000);
    }

    // ---- shoot ----
    if (p.alive) {
      this.weapons.update(dt, { fire: !menu && input.mouse.left, firePressed: !menu && input.mouse.leftPressed });
      if (this.using && input.mouse.leftPressed) this.cancelUse();
    }

    // ---- world ----
    const ctx = this.getHuskCtx();
    for (const e of this.enemies) {
      // far-away Husks think less often (5x a second past 60 m, 2x past 120 m)
      const d = e.pos.distanceTo(p.pos);
      const every = d > 120 ? 0.5 : d > 60 && e.state !== 'alert' ? 0.2 : d > 90 ? 0.1 : 0;
      if (every) {
        e._skip = (e._skip || 0) + dt;
        if (e._skip < every) continue;
        e.update(e._skip, ctx);
        e._skip = 0;
      } else {
        e.update(dt, ctx);
      }
    }
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].dead) {
        this.enemies[i].destroy();
        this.enemies.splice(i, 1);
      }
    }
    this.updateGrenades(dt);
    this.updateLifts(dt);
    // skip drawing far-away things (fog hides them anyway); big win on phones
    const drawDist = this.quality.drawDist;
    for (const e of this.enemies) e.model.visible = e.pos.distanceTo(p.pos) < (e.small ? drawDist * 0.6 : drawDist);
    const lootDist = Math.min(70, drawDist * 0.45);
    for (const c of this.containers) {
      c.group.visible = Math.abs(c.x - p.pos.x) < lootDist && Math.abs(c.z - p.pos.z) < lootDist;
      c.marker.visible = !(c.searched && c.items.length === 0);
      c.marker.rotation.y += dt * 2;
    }
    for (const w of this.wrecks) {
      w.marker.visible = !(w.searched && w.items.length === 0);
      w.marker.rotation.y += dt * 2;
    }

    // trickle in more Husks over time
    this.respawnTimer -= dt;
    if (this.respawnTimer <= 0) {
      this.respawnTimer = 50;
      const spots = this.world.enemySpawns.filter((s) => Math.hypot(s.x - p.pos.x, s.z - p.pos.z) > 70 && s.type !== 'warden' && s.type !== 'pouncer');
      if (spots.length) {
        const s = spots[Math.floor(Math.random() * spots.length)];
        for (let i = 0; i < (s.count || 1); i++) this.spawnEnemyAt(s.type, s.x + (Math.random() - 0.5) * 10, s.z + (Math.random() - 0.5) * 10, null, s);
      }
    }

    // ---- interaction ----
    this.updateInteraction(dt);

    // ---- raid clock ----
    this.raidTime -= dt;
    if (this.raidTime <= 0 && p.alive) {
      p.alive = false;
      this.ui.notify('The surface lifts are sealed. You are lost topside.');
      setTimeout(() => this.endRaid(false, 'Stranded when the raid ended'), 1500);
    }

    this.updateCamera(dt);
    this.ui.updateHud(dt);
  }

  addRecoil(pitch, yaw) {
    this.recoil.pitch += pitch;
    this.recoil.yaw += yaw;
  }

  updateCamera(dt) {
    const p = this.player;
    const zoom = ITEMS[this.weapons.current()?.id]?.zoom || 1;
    this.adsT += ((p.ads ? 1 : 0) - this.adsT) * Math.min(1, dt * 12);
    const fov = this.baseFov - this.adsT * (this.baseFov - 50 / zoom);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const eye = p.alive || this.mode !== 'raid' ? p.eye() : p.pos.clone().add(new THREE.Vector3(0, 0.6, 0));
    const look = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const shoulder = 0.95 - this.adsT * 0.2;
    const back = 3.6 - this.adsT * 1.7;
    const up = 0.3 - this.adsT * 0.1;
    // pivot is over the shoulder; pull the camera in if a wall is in the way
    const pivot = eye.clone().addScaledVector(right, shoulder).add(new THREE.Vector3(0, up, 0));
    const toPivot = pivot.clone().sub(eye);
    const pd = toPivot.length();
    const sideHit = this.col.raycast(eye.x, eye.y, eye.z, toPivot.x / pd, toPivot.y / pd, toPivot.z / pd, pd + 0.2);
    if (sideHit) pivot.copy(eye).addScaledVector(toPivot.normalize(), Math.max(0, sideHit.dist - 0.2));
    const backDir = look.clone().multiplyScalar(-1);
    const hit = this.col.raycast(pivot.x, pivot.y, pivot.z, backDir.x, backDir.y, backDir.z, back + 0.3);
    const dist = hit ? Math.max(0.4, hit.dist - 0.3) : back;
    const camPos = pivot.clone().addScaledVector(backDir, dist);
    if (this.shakeAmt > 0) {
      camPos.x += (Math.random() - 0.5) * this.shakeAmt * 0.3;
      camPos.y += (Math.random() - 0.5) * this.shakeAmt * 0.3;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2);
    }
    this.camera.position.copy(camPos);
    this.camera.lookAt(camPos.clone().add(look));
    // hide the model when the camera is jammed into it
    p.model.visible = dist > 0.8 || !p.alive;
    if (this.headlamp.intensity > 0) {
      this.headlamp.position.copy(eye).add(new THREE.Vector3(0, 0.15, 0));
      this.headlamp.target.position.copy(eye).addScaledVector(look, 10);
    }
  }
}
