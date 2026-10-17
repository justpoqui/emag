// All DOM UI: the raid HUD, inventory / loot / map / pause menus, the hub
// (stash, traders, workbench) and the raid results screen.

import * as THREE from 'three';
import {
  ITEMS, RARITY, AMMO, TRADERS, BUY_MARKUP, RECIPES, PLAYER, RAID_SECONDS,
} from './config.js';
import {
  addToSlots, countIn, moveStack, freeSlots, loadoutIsEmpty, applyFreeKit, countOwned, removeOwned, saveProfile, resetProfile, makeStack,
} from './inventory.js';
import { MAP_HALF } from './collision.js';
import * as Audio from './audio.js';

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const TYPE_GLYPH = {
  weapon: '⌐', ammo: '⁝', shield: '◈', heal: '✚', recharge: '⚡', grenade: '●', material: '▣', valuable: '◆',
};

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('overlay');
    this.notes = [];
    this.open = null; // 'inventory' | 'loot' | 'map' | null
    this.lootTarget = null;
    this.hubTab = 'loadout';
    this.trader = 'gunsmith';
    this.buildHud();
    this.menus = el('div', 'menus');
    this.root.appendChild(this.menus);
    this.tooltip = el('div', 'tooltip hidden');
    this.root.appendChild(this.tooltip);
    this.fade = el('div', 'fade');
    this.root.appendChild(this.fade);
    document.addEventListener('mousemove', (e) => {
      if (!this.tooltip.classList.contains('hidden')) {
        const x = Math.min(window.innerWidth - 280, e.clientX + 16);
        const y = Math.min(window.innerHeight - 160, e.clientY + 16);
        this.tooltip.style.transform = `translate(${x}px, ${y}px)`;
      }
    });
    document.addEventListener('click', () => Audio.initAudio(), { once: false });
  }

  // ================= HUD =================
  buildHud() {
    const hud = el('div', 'hud hidden');
    hud.innerHTML = `
      <div class="crosshair"><i class="ch t"></i><i class="ch b"></i><i class="ch l"></i><i class="ch r"></i><i class="dot"></i></div>
      <div class="hitmarker"><i></i><i></i><i></i><i></i></div>
      <div class="dmg-dirs"></div>
      <div class="reload-ring hidden"><div class="fill"></div><span>RELOADING</span></div>
      <div class="compass"><div class="strip"></div><div class="needle"></div></div>
      <div class="raid-timer"><div class="label">RAID</div><div class="time">20:00</div></div>
      <div class="notes"></div>
      <div class="prompt hidden"><span class="key">E</span><span class="text"></span><div class="bar"><div class="fill"></div></div></div>
      <div class="use-bar hidden"><div class="text"></div><div class="bar"><div class="fill"></div></div></div>
      <div class="vitals">
        <div class="shield-row"><div class="bar shield"><div class="fill"></div></div><span class="num s"></span></div>
        <div class="health-row"><div class="bar health"><div class="lag"></div><div class="fill"></div></div><span class="num h"></span></div>
        <div class="bar stamina"><div class="fill"></div></div>
      </div>
      <div class="weapon-panel">
        <div class="slots"><div class="wslot" data-i="0"></div><div class="wslot" data-i="1"></div></div>
        <div class="ammo"><span class="mag">0</span><span class="reserve">/ 0</span></div>
        <div class="quick">
          <div class="q" data-q="heal"><b>3</b><span></span></div>
          <div class="q" data-q="recharge"><b>4</b><span></span></div>
          <div class="q" data-q="frag"><b>G</b><span></span></div>
        </div>
      </div>
      <div class="markers"></div>
      <div class="vignette"></div>
      <div class="help">WASD move · Shift sprint · Space jump · C crouch · V dodge roll · RMB aim · R reload · E interact · Tab inventory · M map</div>
    `;
    this.root.appendChild(hud);
    this.hud = hud;
    const $ = (s) => hud.querySelector(s);
    this.h = {
      cross: $('.crosshair'), hit: $('.hitmarker'), dirs: $('.dmg-dirs'), reload: $('.reload-ring'),
      compass: $('.compass .strip'), timer: $('.raid-timer .time'), timerBox: $('.raid-timer'), notes: $('.notes'),
      prompt: $('.prompt'), promptText: $('.prompt .text'), promptFill: $('.prompt .fill'), promptBar: $('.prompt .bar'),
      use: $('.use-bar'), useText: $('.use-bar .text'), useFill: $('.use-bar .fill'),
      shieldRow: $('.shield-row'), shield: $('.bar.shield .fill'), shieldNum: $('.num.s'),
      health: $('.bar.health .fill'), healthLag: $('.bar.health .lag'), healthNum: $('.num.h'), stamina: $('.bar.stamina .fill'),
      wslots: hud.querySelectorAll('.wslot'), mag: $('.ammo .mag'), reserve: $('.ammo .reserve'),
      quick: hud.querySelectorAll('.q'), markers: $('.markers'), vignette: $('.vignette'),
    };
    // compass ticks
    const strip = this.h.compass;
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    this.compassTicks = [];
    for (let d = 0; d < 360; d += 15) {
      const t = el('div', names[d] ? 'tick major' : 'tick', names[d] || '');
      strip.appendChild(t);
      this.compassTicks.push({ el: t, deg: d });
    }
    this.liftIcons = this.game.world.extractions.map((ex) => {
      const icon = el('div', 'lift-icon', '▲');
      strip.appendChild(icon);
      const marker = el('div', 'world-marker hidden', `<div class="m-icon">⇩</div><div class="m-name">${ex.name}</div><div class="m-dist"></div>`);
      this.h.markers.appendChild(marker);
      return { ex, icon, marker };
    });
    this.healthLag = PLAYER.health;
  }

  showRaidHud() {
    this.menus.innerHTML = '';
    this.open = null;
    this.hud.classList.remove('hidden');
    this.h.notes.innerHTML = '';
    this.refreshAmmo();
    this.refreshInventory();
  }

  notify(text) {
    const n = el('div', 'note', text);
    this.h.notes.prepend(n);
    setTimeout(() => n.classList.add('out'), 4000);
    setTimeout(() => n.remove(), 4600);
    while (this.h.notes.children.length > 6) this.h.notes.lastChild.remove();
  }

  hitMarker(weak, kill) {
    const hm = this.h.hit;
    hm.classList.remove('show', 'weak', 'kill');
    void hm.offsetWidth;
    hm.classList.add('show');
    if (weak) hm.classList.add('weak');
    if (kill) hm.classList.add('kill');
  }

  damageDir(angle) {
    const d = el('div', 'dmg-dir');
    // angle is relative to view; 0 = in front
    d.style.transform = `rotate(${-angle}rad)`;
    this.h.dirs.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  setPrompt(text, progress = 0, hold = false) {
    if (!text) {
      this.h.prompt.classList.add('hidden');
      return;
    }
    this.h.prompt.classList.remove('hidden');
    this.h.promptText.textContent = (hold ? 'Hold · ' : '') + text;
    this.h.promptBar.style.display = hold ? 'block' : 'none';
    this.h.promptFill.style.width = `${Math.min(1, progress) * 100}%`;
  }

  refreshAmmo() {
    const w = this.game.weapons;
    const lo = this.game.profile.loadout;
    this.h.wslots.forEach((s, i) => {
      const stack = lo.weapons[i];
      s.className = 'wslot' + (i === w.active ? ' active' : '') + (stack ? '' : ' empty');
      s.innerHTML = stack ? `<b>${i + 1}</b> ${ITEMS[stack.id].name}` : `<b>${i + 1}</b> —`;
      if (stack) s.style.borderColor = RARITY[ITEMS[stack.id].rarity].color;
    });
    const cur = w.current();
    if (cur) {
      this.h.mag.textContent = cur.mag;
      this.h.mag.classList.toggle('low', cur.mag <= Math.ceil(ITEMS[cur.id].mag * 0.25));
      this.h.reserve.textContent = `/ ${w.reserve()}`;
    } else {
      this.h.mag.textContent = '—';
      this.h.reserve.textContent = '';
    }
  }

  refreshInventory() {
    const bag = this.game.profile.loadout.bag;
    const counts = {
      heal: countIn(bag, 'bandage') + countIn(bag, 'med_kit'),
      recharge: countIn(bag, 'recharger'),
      frag: countIn(bag, 'frag'),
    };
    this.h.quick.forEach((q) => {
      const n = counts[q.dataset.q];
      q.querySelector('span').textContent = { heal: '✚', recharge: '⚡', frag: '●' }[q.dataset.q] + ' ' + n;
      q.classList.toggle('empty', n === 0);
    });
    this.refreshAmmo();
    if (this.open === 'inventory') this.renderInventory();
    if (this.open === 'loot') this.renderLoot();
  }

  updateHud(dt) {
    const g = this.game;
    const p = g.player;
    // vitals
    const hp = Math.max(0, p.health);
    this.healthLag += (hp - this.healthLag) * Math.min(1, dt * 2);
    if (this.healthLag < hp) this.healthLag = hp;
    this.h.health.style.width = `${(hp / PLAYER.health) * 100}%`;
    this.h.healthLag.style.width = `${(this.healthLag / PLAYER.health) * 100}%`;
    this.h.healthNum.textContent = Math.ceil(hp);
    this.h.health.classList.toggle('low', hp < 30);
    const sh = g.profile.loadout.shield;
    if (sh) {
      const cap = ITEMS[sh.id].capacity;
      this.h.shieldRow.style.display = 'flex';
      this.h.shield.style.width = `${(sh.charge / cap) * 100}%`;
      this.h.shieldNum.textContent = Math.ceil(sh.charge);
    } else {
      this.h.shieldRow.style.display = 'none';
    }
    this.h.stamina.style.width = `${(p.stamina / PLAYER.stamina) * 100}%`;
    this.h.stamina.parentElement.classList.toggle('locked', p.staminaLock > 0);
    this.h.vignette.style.opacity = hp < 35 ? (1 - hp / 35) * 0.9 : Math.max(0, 0.5 - (g.time - p.lastDamage) * 1.5);

    // crosshair
    const spread = g.weapons.spread();
    const px = 6 + spread * 7;
    this.h.cross.style.setProperty('--gap', `${px}px`);
    this.h.cross.classList.toggle('hidden', !g.weapons.current() || p.sprinting || this.menuOpen());
    this.h.cross.classList.toggle('ads', p.ads);

    // reload
    const w = g.weapons;
    if (w.reloading > 0) {
      this.h.reload.classList.remove('hidden');
      this.h.reload.querySelector('.fill').style.width = `${(1 - w.reloading / w.reloadTotal) * 100}%`;
    } else {
      this.h.reload.classList.add('hidden');
    }
    // using an item
    if (g.using) {
      this.h.use.classList.remove('hidden');
      this.h.useText.textContent = `Using ${ITEMS[g.using.id].name}…`;
      this.h.useFill.style.width = `${(g.using.t / g.using.total) * 100}%`;
    } else {
      this.h.use.classList.add('hidden');
    }
    // ammo text (cheap to keep in sync)
    const cur = w.current();
    if (cur && this.h.mag.textContent !== String(cur.mag)) this.refreshAmmo();

    // timer
    this.h.timer.textContent = fmtTime(g.raidTime);
    this.h.timerBox.classList.toggle('urgent', g.raidTime < 120);

    // compass: yaw 0 faces +Z. Call +Z "south" and -Z "north", +X east.
    const heading = ((Math.atan2(Math.sin(g.yaw), -Math.cos(g.yaw)) * 180) / Math.PI + 360) % 360;
    const width = 420;
    const place = (node, deg) => {
      let diff = deg - heading;
      diff = ((diff + 540) % 360) - 180;
      const x = width / 2 + diff * 3.2;
      node.style.display = Math.abs(diff) > 65 ? 'none' : 'block';
      node.style.transform = `translateX(${x}px)`;
    };
    for (const t of this.compassTicks) place(t.el, t.deg);
    // world markers for lifts
    const cam = g.camera;
    const v = new THREE.Vector3();
    for (const li of this.liftIcons) {
      const ex = li.ex;
      const deg = ((Math.atan2(ex.x - p.pos.x, -(ex.z - p.pos.z)) * 180) / Math.PI + 360) % 360;
      place(li.icon, deg);
      li.icon.className = `lift-icon ${ex.state}`;
      const dist = Math.hypot(ex.x - p.pos.x, ex.z - p.pos.z);
      v.set(ex.x, ex.y + 5, ex.z).project(cam);
      const onScreen = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      const show = onScreen && (ex.state !== 'idle' || dist < 90);
      li.marker.classList.toggle('hidden', !show);
      if (show) {
        li.marker.className = `world-marker ${ex.state}`;
        li.marker.style.transform = `translate(${(v.x * 0.5 + 0.5) * window.innerWidth}px, ${(-v.y * 0.5 + 0.5) * window.innerHeight}px)`;
        const status = ex.state === 'calling' ? ` · ${Math.ceil(ex.timer)}s` : ex.state === 'open' ? ` · OPEN ${Math.ceil(ex.timer)}s` : '';
        li.marker.querySelector('.m-dist').textContent = `${Math.round(dist)}m${status}`;
      }
    }
    if (this.open === 'map') this.drawMap();
    this.updateLootReveal(dt);
  }

  // ================= menus in raid =================
  menuOpen() {
    return this.open !== null || this.game.paused;
  }

  closeMenus() {
    this.open = null;
    this.lootTarget = null;
    this.menus.innerHTML = '';
    this.hideTooltip();
    if (this.game.mode === 'raid' && this.game.player.alive) this.game.input.lock();
  }

  toggleInventory() {
    if (this.open === 'inventory' || this.open === 'loot') return this.closeMenus();
    this.openMenu('inventory');
  }

  toggleMap() {
    if (this.open === 'map') return this.closeMenus();
    this.openMenu('map');
  }

  openMenu(kind) {
    this.open = kind;
    this.game.input.unlock();
    if (kind === 'inventory') this.renderInventory();
    if (kind === 'map') this.renderMap();
  }

  showLoot(container) {
    this.lootTarget = container;
    if (!container.revealed) {
      container.revealed = 0;
      container.revealTimer = 0.25;
    }
    this.openMenu('loot');
    this.renderLoot();
  }

  updateLootReveal(dt) {
    const c = this.lootTarget;
    if (this.open !== 'loot' || !c || c.revealed >= c.items.length) return;
    c.revealTimer -= dt;
    if (c.revealTimer <= 0) {
      c.revealTimer = 0.3;
      c.revealed++;
      Audio.playSearch();
      this.renderLoot();
    }
  }

  tile(stack, opts = {}) {
    const t = el('div', 'tile' + (stack ? '' : ' empty') + (opts.cls ? ` ${opts.cls}` : ''));
    if (!stack) {
      if (opts.label) t.innerHTML = `<span class="slot-label">${opts.label}</span>`;
      return t;
    }
    const def = ITEMS[stack.id];
    const r = RARITY[def.rarity];
    t.style.setProperty('--rarity', r.color);
    const extra = def.type === 'weapon' ? `<span class="sub">${stack.mag}/${def.mag}</span>` : def.type === 'shield' ? `<span class="sub">${Math.ceil(stack.charge)}/${def.capacity}</span>` : '';
    t.innerHTML = `
      <span class="glyph" style="color:#${def.color.toString(16).padStart(6, '0')}">${TYPE_GLYPH[def.type] || '?'}</span>
      <span class="name">${def.name}</span>
      ${stack.n > 1 ? `<span class="count">${stack.n}</span>` : ''}${extra}`;
    t.addEventListener('mouseenter', () => this.showTooltip(stack, opts.hint));
    t.addEventListener('mouseleave', () => this.hideTooltip());
    if (opts.onClick) t.addEventListener('click', (e) => { e.stopPropagation(); opts.onClick(e); });
    if (opts.onRight) t.addEventListener('contextmenu', (e) => { e.preventDefault(); opts.onRight(e); });
    return t;
  }

  showTooltip(stack, hint) {
    const def = ITEMS[stack.id];
    const r = RARITY[def.rarity];
    let stats = '';
    if (def.type === 'weapon') {
      stats = `<div class="stats"><span>Damage ${def.damage}${def.pellets > 1 ? ` × ${def.pellets}` : ''}</span><span>${def.rpm} RPM${def.auto ? ' · Auto' : ''}</span><span>Mag ${def.mag}</span><span>${ITEMS[AMMO[def.ammo]].name}</span></div>`;
    } else if (def.type === 'shield') {
      stats = `<div class="stats"><span>Capacity ${def.capacity}</span><span>Absorbs ${Math.round(def.absorb * 100)}%</span></div>`;
    }
    this.tooltip.innerHTML = `
      <div class="tt-name" style="color:${r.color}">${def.name}</div>
      <div class="tt-rarity">${r.name} · ${def.type}</div>
      <div class="tt-desc">${def.desc || ''}</div>${stats}
      <div class="tt-value">Value ⌬ ${def.value}${stack.n > 1 ? ` (⌬ ${def.value * stack.n} total)` : ''}</div>
      ${hint ? `<div class="tt-hint">${hint}</div>` : ''}`;
    this.tooltip.classList.remove('hidden');
  }

  hideTooltip() {
    this.tooltip.classList.add('hidden');
  }

  // equipment column used by both raid inventory and hub loadout
  equipmentColumn(lo, handlers) {
    const col = el('div', 'equip');
    col.appendChild(el('div', 'sect', 'WEAPONS'));
    lo.weapons.forEach((w, i) => col.appendChild(this.tile(w, { cls: 'wide', label: `Weapon ${i + 1}`, onClick: () => handlers.weapon(i), hint: handlers.weaponHint })));
    col.appendChild(el('div', 'sect', 'SHIELD'));
    col.appendChild(this.tile(lo.shield, { cls: 'wide', label: 'Shield', onClick: () => handlers.shield(), hint: handlers.shieldHint }));
    col.appendChild(el('div', 'sect', 'SAFE POCKET <small>(kept if you die)</small>'));
    const safe = el('div', 'grid small');
    lo.safe.forEach((s, i) => safe.appendChild(this.tile(s, { label: 'Safe', onClick: () => handlers.safe(i), hint: handlers.safeHint })));
    col.appendChild(safe);
    return col;
  }

  renderInventory() {
    const g = this.game;
    const lo = g.profile.loadout;
    this.menus.innerHTML = '';
    const panel = el('div', 'panel inventory');
    panel.appendChild(el('div', 'panel-title', 'BACKPACK <span class="close">Tab to close</span>'));
    const body = el('div', 'panel-body two');
    body.appendChild(this.equipmentColumn(lo, {
      weapon: (i) => g.weapons.switchTo(i),
      shield: () => {},
      safe: (i) => {
        const s = lo.safe[i];
        if (!s) return;
        const left = moveStack(s, lo.bag);
        lo.safe[i] = left;
        this.refreshInventory();
      },
      weaponHint: 'Click to draw', safeHint: 'Click: move to bag',
    }));
    const bagCol = el('div', 'bag');
    bagCol.appendChild(el('div', 'sect', `BAG <small>${freeSlots(lo.bag)} free</small>`));
    const grid = el('div', 'grid');
    lo.bag.forEach((s, i) => {
      grid.appendChild(this.tile(s, {
        hint: s ? this.bagHint(s) : '',
        onClick: (e) => this.bagClick(i, e.shiftKey),
        onRight: () => {
          if (!lo.bag[i]) return;
          this.notify(`Dropped ${ITEMS[lo.bag[i].id].name}.`);
          lo.bag[i] = null;
          this.hideTooltip();
          this.refreshInventory();
        },
      }));
    });
    bagCol.appendChild(grid);
    body.appendChild(bagCol);
    panel.appendChild(body);
    this.menus.appendChild(panel);
  }

  bagHint(s) {
    const t = ITEMS[s.id].type;
    if (t === 'heal' || t === 'recharge') return 'Click: use · Shift-click: safe pocket · Right-click: drop';
    if (t === 'weapon' || t === 'shield') return 'Click: equip · Shift-click: safe pocket · Right-click: drop';
    return 'Shift-click: safe pocket · Right-click: drop';
  }

  bagClick(i, shift) {
    const g = this.game;
    const lo = g.profile.loadout;
    const s = lo.bag[i];
    if (!s) return;
    const def = ITEMS[s.id];
    if (shift) {
      const idx = lo.safe.findIndex((x) => !x);
      if (idx === -1) return this.notify('Safe pocket is full.');
      lo.safe[idx] = s;
      lo.bag[i] = null;
    } else if (def.type === 'heal' || def.type === 'recharge') {
      if (def.type === 'heal' && g.player.health >= PLAYER.health) return this.notify('Already at full health.');
      g.startUse(s.id);
      this.closeMenus();
      return;
    } else if (def.type === 'weapon') {
      // swap into the active weapon slot (or an empty one)
      let slot = lo.weapons.findIndex((w) => !w);
      if (slot === -1) slot = g.weapons.active;
      const old = lo.weapons[slot];
      lo.weapons[slot] = s;
      lo.bag[i] = old;
      g.weapons.reloading = 0;
      g.weapons.active = slot;
    } else if (def.type === 'shield') {
      const old = lo.shield;
      lo.shield = s;
      lo.bag[i] = old;
    }
    Audio.playUI();
    this.refreshInventory();
  }

  renderLoot() {
    const g = this.game;
    const c = this.lootTarget;
    if (!c) return;
    const lo = g.profile.loadout;
    this.menus.innerHTML = '';
    const panel = el('div', 'panel loot');
    panel.appendChild(el('div', 'panel-title', `${c.name.toUpperCase()} <span class="close">Tab to close · F take all</span>`));
    const body = el('div', 'panel-body two');
    const left = el('div', 'container-col');
    left.appendChild(el('div', 'sect', 'CONTENTS'));
    const cg = el('div', 'grid');
    const shown = Math.min(c.revealed ?? c.items.length, c.items.length);
    c.items.forEach((s, i) => {
      if (i >= shown) {
        cg.appendChild(el('div', 'tile searching', '<span class="spinner"></span>'));
      } else {
        cg.appendChild(this.tile(s, { hint: 'Click: take', onClick: () => this.take(i) }));
      }
    });
    if (c.items.length === 0) cg.appendChild(el('div', 'empty-note', 'Empty.'));
    left.appendChild(cg);
    const takeAll = el('button', 'btn', 'Take all [F]');
    takeAll.onclick = () => this.takeAll();
    left.appendChild(takeAll);
    body.appendChild(left);
    const bagCol = el('div', 'bag');
    bagCol.appendChild(el('div', 'sect', `YOUR BAG <small>${freeSlots(lo.bag)} free</small>`));
    const grid = el('div', 'grid');
    lo.bag.forEach((s, i) => grid.appendChild(this.tile(s, {
      hint: 'Click: put in container',
      onClick: () => {
        if (!lo.bag[i]) return;
        c.items.push(lo.bag[i]);
        c.revealed = (c.revealed ?? 0) + 1;
        lo.bag[i] = null;
        this.refreshInventory();
      },
    })));
    bagCol.appendChild(grid);
    body.appendChild(bagCol);
    panel.appendChild(body);
    this.menus.appendChild(panel);
    if (!this._fHandler) {
      this._fHandler = (e) => {
        if (e.code === 'KeyF' && this.open === 'loot') this.takeAll();
      };
      window.addEventListener('keydown', this._fHandler);
    }
  }

  take(i) {
    const g = this.game;
    const c = this.lootTarget;
    const s = c.items[i];
    if (!s) return;
    const before = s.n;
    const left = moveStack(s, g.profile.loadout.bag);
    const taken = before - (left ? left.n : 0);
    if (taken > 0) {
      g.raidStats.looted[s.id] = (g.raidStats.looted[s.id] || 0) + taken;
      Audio.playPickup();
    }
    if (left) {
      c.items[i] = left;
      this.notify('Bag is full.');
      Audio.playDeny();
    } else {
      c.items.splice(i, 1);
      c.revealed = Math.max(0, (c.revealed ?? 1) - 1);
    }
    this.hideTooltip();
    this.refreshInventory();
  }

  takeAll() {
    const c = this.lootTarget;
    if (!c) return;
    const shown = Math.min(c.revealed ?? c.items.length, c.items.length);
    for (let i = shown - 1; i >= 0; i--) this.take(i);
  }

  // ================= map =================
  renderMap() {
    this.menus.innerHTML = '';
    const panel = el('div', 'panel map-panel');
    panel.appendChild(el('div', 'panel-title', 'TOPSIDE · RUST BELT <span class="close">M to close</span>'));
    const canvas = el('canvas', 'map');
    canvas.width = 640;
    canvas.height = 640;
    panel.appendChild(canvas);
    panel.appendChild(el('div', 'legend', '<span class="lg you">▲ You</span><span class="lg lift">■ Lift</span><span class="lg arc">● ARC (spotted)</span>'));
    this.menus.appendChild(panel);
    this.mapCanvas = canvas;
    if (!this.mapBase) this.mapBase = this.buildMapBase();
    this.drawMap();
  }

  buildMapBase() {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 640;
    const ctx = c.getContext('2d');
    const s = 640 / (MAP_HALF * 2);
    ctx.fillStyle = '#6b6a48';
    ctx.fillRect(0, 0, 640, 640);
    // roads
    const town = this.game.world.town;
    ctx.fillStyle = '#4a4742';
    ctx.fillRect(0, (town.z + MAP_HALF - 5) * s, 640, 10 * s);
    ctx.fillRect((town.x + MAP_HALF - 5) * s, 0, 10 * s, 640);
    // every collision box, darker the taller it is
    for (const b of this.game.col.boxes) {
      if (b.tag === 'wall') continue;
      const h = b.max.y - b.min.y;
      if (h < 0.8) continue;
      ctx.fillStyle = b.tag === 'metal' ? 'rgba(60,70,75,0.85)' : b.tag === 'wood' ? 'rgba(40,60,30,0.7)' : 'rgba(200,190,170,0.75)';
      ctx.fillRect((b.min.x + MAP_HALF) * s, (b.min.z + MAP_HALF) * s, Math.max(1, (b.max.x - b.min.x) * s), Math.max(1, (b.max.z - b.min.z) * s));
    }
    return c;
  }

  drawMap() {
    const canvas = this.mapCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const g = this.game;
    const s = 640 / (MAP_HALF * 2);
    const tx = (x) => (x + MAP_HALF) * s;
    ctx.drawImage(this.mapBase, 0, 0);
    ctx.font = 'bold 12px "Barlow Condensed", sans-serif';
    for (const ex of g.world.extractions) {
      ctx.fillStyle = ex.state === 'open' ? '#40ffd0' : ex.state === 'calling' ? '#ffd040' : '#2fbfa0';
      ctx.fillRect(tx(ex.x) - 6, tx(ex.z) - 6, 12, 12);
      ctx.fillStyle = '#f4ead8';
      ctx.fillText(ex.name.toUpperCase(), tx(ex.x) + 9, tx(ex.z) + 4);
    }
    for (const e of g.enemies) {
      if (e.dead || e.state !== 'alert') continue;
      ctx.fillStyle = '#ff5530';
      ctx.beginPath();
      ctx.arc(tx(e.pos.x), tx(e.pos.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const p = g.player;
    ctx.save();
    ctx.translate(tx(p.pos.x), tx(p.pos.z));
    ctx.rotate(-g.yaw + Math.PI);
    ctx.fillStyle = '#ffd27a';
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ================= pause =================
  showPause(on) {
    if (!on) {
      this.menus.innerHTML = '';
      this.open = null;
      return;
    }
    this.menus.innerHTML = '';
    const panel = el('div', 'panel pause');
    panel.innerHTML = `
      <div class="panel-title">PAUSED</div>
      <div class="panel-body col">
        <button class="btn big resume">Resume</button>
        <label class="setting">Mouse sensitivity <input type="range" class="sens" min="0.0006" max="0.006" step="0.0001"></label>
        <label class="setting">Volume <input type="range" class="vol" min="0" max="1" step="0.05"></label>
        <button class="btn danger abandon">Abandon raid (lose your loadout)</button>
      </div>`;
    const sens = panel.querySelector('.sens');
    sens.value = this.game.input.sensitivity;
    sens.oninput = () => {
      this.game.input.sensitivity = Number(sens.value);
      try { localStorage.setItem('scrapfall_sens', sens.value); } catch (e) { /* ignore */ }
    };
    const vol = panel.querySelector('.vol');
    vol.value = this.volume ?? 0.5;
    vol.oninput = () => {
      this.volume = Number(vol.value);
      Audio.setVolume(this.volume);
    };
    panel.querySelector('.resume').onclick = () => this.game.setPaused(false);
    panel.querySelector('.abandon').onclick = () => {
      this.game.paused = false;
      this.game.endRaid(false, 'Abandoned the raid');
    };
    this.menus.appendChild(panel);
  }

  fadeOut(done) {
    this.fade.classList.add('on');
    setTimeout(() => {
      done();
      setTimeout(() => this.fade.classList.remove('on'), 400);
    }, 1400);
  }

  // ================= results =================
  showResults(sum) {
    this.hud.classList.add('hidden');
    this.open = null;
    this.menus.innerHTML = '';
    const panel = el('div', `panel results ${sum.extracted ? 'win' : 'lose'}`);
    const loot = Object.entries(sum.looted).map(([id, n]) => {
      const d = ITEMS[id];
      return `<span class="chip" style="--rarity:${RARITY[d.rarity].color}">${d.name} ×${n}</span>`;
    }).join('') || '<span class="muted">Nothing.</span>';
    panel.innerHTML = `
      <div class="result-head">${sum.extracted ? 'EXTRACTED' : 'MISSING IN ACTION'}</div>
      <div class="result-sub">${sum.extracted ? 'You made it back to the Burrow.' : `${sum.reason}. Everything you carried is gone, except your safe pocket.`}</div>
      <div class="result-grid">
        <div><b>${sum.kills}</b><span>ARC destroyed</span></div>
        <div><b>+${sum.xp}</b><span>XP</span></div>
        <div><b>⌬ ${sum.value}</b><span>${sum.extracted ? 'Carried home' : 'Lost'}</span></div>
      </div>
      <div class="sect">LOOTED THIS RAID</div>
      <div class="chips">${loot}</div>
      <button class="btn big">Return to the Burrow</button>`;
    panel.querySelector('button').onclick = () => this.game.returnToHub();
    this.menus.appendChild(panel);
  }

  // ================= hub =================
  showHub() {
    this.hud.classList.add('hidden');
    this.open = null;
    this.renderHub();
  }

  renderHub() {
    const g = this.game;
    const p = g.profile;
    this.hideTooltip();
    this.menus.innerHTML = '';
    const hub = el('div', 'hub');
    const need = g.xpForLevel(p.level);
    hub.innerHTML = `
      <div class="hub-top">
        <div class="logo">SCRAP<span>FALL</span><small>THE BURROW · UNDERGROUND</small></div>
        <div class="tabs">
          ${['loadout', 'traders', 'workbench', 'log'].map((t) => `<button class="tab ${this.hubTab === t ? 'on' : ''}" data-t="${t}">${{ loadout: 'Loadout & Stash', traders: 'Traders', workbench: 'Workbench', log: 'Raider Log' }[t]}</button>`).join('')}
        </div>
        <div class="wallet">
          <div class="lvl">LVL ${p.level}<div class="xp"><div style="width:${(p.xp / need) * 100}%"></div></div></div>
          <div class="creds">⌬ ${p.credits.toLocaleString()}</div>
        </div>
      </div>
      <div class="hub-body"></div>
      <div class="hub-bottom">
        <div class="risk">Carrying ⌬ ${this.loadoutValueText()} into the raid · Lose it all if you die</div>
        <button class="btn deploy">DEPLOY TOPSIDE ▸</button>
      </div>`;
    hub.querySelectorAll('.tab').forEach((b) => {
      b.onclick = () => {
        this.hubTab = b.dataset.t;
        Audio.playUI();
        this.renderHub();
      };
    });
    hub.querySelector('.deploy').onclick = () => this.deploy();
    const body = hub.querySelector('.hub-body');
    if (this.hubTab === 'loadout') this.renderLoadoutTab(body);
    if (this.hubTab === 'traders') this.renderTradersTab(body);
    if (this.hubTab === 'workbench') this.renderWorkbenchTab(body);
    if (this.hubTab === 'log') this.renderLogTab(body);
    this.menus.appendChild(hub);
  }

  loadoutValueText() {
    let total = 0;
    const lo = this.game.profile.loadout;
    const add = (s) => { if (s) total += ITEMS[s.id].value * s.n; };
    lo.weapons.forEach(add);
    add(lo.shield);
    lo.bag.forEach(add);
    return total.toLocaleString();
  }

  deploy() {
    const lo = this.game.profile.loadout;
    if (!lo.weapons[0] && !lo.weapons[1]) {
      if (!confirm('You have no weapon. Deploy anyway?')) return;
    }
    const w = lo.weapons.find((x) => x);
    if (w && countIn(lo.bag, AMMO[ITEMS[w.id].ammo]) === 0 && w.mag === 0) {
      if (!confirm('You have no ammo for your weapon. Deploy anyway?')) return;
    }
    Audio.initAudio();
    Audio.playLift();
    this.menus.innerHTML = '';
    this.fade.classList.add('on');
    setTimeout(() => {
      this.game.startRaid();
      setTimeout(() => this.fade.classList.remove('on'), 300);
    }, 1200);
  }

  save() {
    saveProfile(this.game.profile);
  }

  renderLoadoutTab(body) {
    const g = this.game;
    const p = g.profile;
    const lo = p.loadout;
    body.className = 'hub-body loadout-tab';
    const left = el('div', 'hub-col');
    left.appendChild(el('div', 'col-title', 'LOADOUT'));
    const toStash = (stack) => {
      const leftover = moveStack(stack, p.stash);
      if (leftover) this.notifyHub('Stash is full.');
      return leftover;
    };
    left.appendChild(this.equipmentColumn(lo, {
      weapon: (i) => { if (lo.weapons[i]) { lo.weapons[i] = toStash(lo.weapons[i]); this.afterHubChange(); } },
      shield: () => { if (lo.shield) { lo.shield = toStash(lo.shield); this.afterHubChange(); } },
      safe: (i) => { if (lo.safe[i]) { lo.safe[i] = toStash(lo.safe[i]); this.afterHubChange(); } },
      weaponHint: 'Click: move to stash', shieldHint: 'Click: move to stash', safeHint: 'Click: move to stash',
    }));
    const bagTitle = el('div', 'sect', `BAG <small>${freeSlots(lo.bag)} free</small>`);
    left.appendChild(bagTitle);
    const bag = el('div', 'grid');
    lo.bag.forEach((s, i) => bag.appendChild(this.tile(s, {
      hint: 'Click: move to stash · Shift-click: safe pocket',
      onClick: (e) => {
        if (!lo.bag[i]) return;
        if (e.shiftKey) {
          const idx = lo.safe.findIndex((x) => !x);
          if (idx === -1) return this.notifyHub('Safe pocket is full.');
          lo.safe[idx] = lo.bag[i];
          lo.bag[i] = null;
        } else {
          lo.bag[i] = toStash(lo.bag[i]);
        }
        this.afterHubChange();
      },
    })));
    left.appendChild(bag);
    const kitRow = el('div', 'row');
    const kit = el('button', 'btn', 'Take free kit');
    kit.title = 'A Kettle, light ammo, bandages and a light shield. Free, any time your loadout is empty.';
    kit.disabled = !loadoutIsEmpty(lo);
    kit.onclick = () => {
      applyFreeKit(lo);
      this.notifyHub('Free kit equipped. Good luck topside.');
      this.afterHubChange();
    };
    const empty = el('button', 'btn ghost', 'Unload all to stash');
    empty.onclick = () => {
      lo.weapons = lo.weapons.map((w) => (w ? toStash(w) : null));
      if (lo.shield) lo.shield = toStash(lo.shield);
      lo.bag = lo.bag.map((s) => (s ? toStash(s) : null));
      this.afterHubChange();
    };
    kitRow.append(kit, empty);
    left.appendChild(kitRow);

    const right = el('div', 'hub-col wide');
    right.appendChild(el('div', 'col-title', `STASH <small>${freeSlots(p.stash)} / ${p.stash.length} free · click to load, right-click to sell</small>`));
    const stash = el('div', 'grid stash');
    p.stash.forEach((s, i) => stash.appendChild(this.tile(s, {
      hint: s ? `Click: load · Right-click: sell for ⌬ ${ITEMS[s.id].value * s.n}` : '',
      onClick: () => this.stashToLoadout(i),
      onRight: () => this.sellStash(i),
    })));
    right.appendChild(stash);
    const sortBtn = el('button', 'btn ghost', 'Sort stash');
    sortBtn.onclick = () => {
      const order = ['weapon', 'shield', 'ammo', 'heal', 'recharge', 'grenade', 'valuable', 'material'];
      const items = p.stash.filter(Boolean);
      const merged = new Array(p.stash.length).fill(null);
      items.sort((a, b) => order.indexOf(ITEMS[a.id].type) - order.indexOf(ITEMS[b.id].type) || ITEMS[b.id].value - ITEMS[a.id].value);
      for (const s of items) moveStack(s, merged);
      p.stash = merged;
      this.afterHubChange();
    };
    right.appendChild(sortBtn);
    body.append(left, right);
  }

  stashToLoadout(i) {
    const p = this.game.profile;
    const lo = p.loadout;
    const s = p.stash[i];
    if (!s) return;
    const def = ITEMS[s.id];
    if (def.type === 'weapon') {
      const slot = lo.weapons.findIndex((w) => !w);
      if (slot === -1) {
        // swap with weapon 1
        p.stash[i] = lo.weapons[0];
        lo.weapons[0] = s;
      } else {
        lo.weapons[slot] = s;
        p.stash[i] = null;
      }
    } else if (def.type === 'shield') {
      p.stash[i] = lo.shield;
      lo.shield = s;
      if (lo.shield.charge === undefined) lo.shield.charge = def.capacity;
    } else {
      const left = moveStack(s, lo.bag);
      p.stash[i] = left;
      if (left) this.notifyHub('Bag is full.');
    }
    this.afterHubChange();
  }

  sellStash(i) {
    const p = this.game.profile;
    const s = p.stash[i];
    if (!s) return;
    const value = ITEMS[s.id].value * s.n;
    p.credits += value;
    p.stash[i] = null;
    Audio.playPickup();
    this.notifyHub(`Sold ${ITEMS[s.id].name} ×${s.n} for ⌬ ${value}.`);
    this.afterHubChange();
  }

  afterHubChange() {
    Audio.playUI();
    this.save();
    this.renderHub();
  }

  notifyHub(text) {
    const n = el('div', 'hub-toast', text);
    document.body.appendChild(n);
    setTimeout(() => n.classList.add('out'), 2200);
    setTimeout(() => n.remove(), 2700);
  }

  renderTradersTab(body) {
    const p = this.game.profile;
    body.className = 'hub-body traders-tab';
    const list = el('div', 'trader-list');
    for (const [id, t] of Object.entries(TRADERS)) {
      const b = el('button', `trader ${this.trader === id ? 'on' : ''}`, `<b>${t.name}</b><span>${t.title}</span>`);
      b.onclick = () => { this.trader = id; this.renderHub(); };
      list.appendChild(b);
    }
    const sellBtn = el('button', `trader ${this.trader === 'sell' ? 'on' : ''}`, '<b>Sell</b><span>Turn loot into creds</span>');
    sellBtn.onclick = () => { this.trader = 'sell'; this.renderHub(); };
    list.appendChild(sellBtn);
    body.appendChild(list);

    const shop = el('div', 'shop');
    if (this.trader === 'sell') {
      shop.appendChild(el('div', 'col-title', 'SELL FROM STASH <small>traders pay full value</small>'));
      const rows = el('div', 'rows');
      const seen = {};
      p.stash.forEach((s) => { if (s) seen[s.id] = (seen[s.id] || 0) + s.n; });
      const ids = Object.keys(seen).sort((a, b) => ITEMS[b].value - ITEMS[a].value);
      if (!ids.length) rows.appendChild(el('div', 'muted', 'Your stash is empty.'));
      for (const id of ids) {
        const d = ITEMS[id];
        const row = el('div', 'row item-row');
        row.innerHTML = `<span class="r-name" style="color:${RARITY[d.rarity].color}">${d.name}</span><span class="r-own">×${seen[id]}</span><span class="r-price">⌬ ${d.value} ea</span>`;
        const one = el('button', 'btn small', 'Sell 1');
        one.onclick = () => this.sellId(id, 1);
        const all = el('button', 'btn small', `Sell all (⌬ ${d.value * seen[id]})`);
        all.onclick = () => this.sellId(id, seen[id]);
        row.append(one, all);
        rows.appendChild(row);
      }
      shop.appendChild(rows);
    } else {
      const t = TRADERS[this.trader];
      shop.appendChild(el('div', 'col-title', `${t.name.toUpperCase()} · ${t.title.toUpperCase()}`));
      shop.appendChild(el('div', 'quote', `“${t.lines[Math.floor(Math.random() * t.lines.length)]}”`));
      const rows = el('div', 'rows');
      for (const id of t.stock) {
        const d = ITEMS[id];
        const qty = d.type === 'ammo' ? Math.min(d.stack, 30) : 1;
        const price = Math.ceil(d.value * BUY_MARKUP * qty);
        const row = el('div', 'row item-row');
        row.innerHTML = `<span class="r-name" style="color:${RARITY[d.rarity].color}">${d.name}${qty > 1 ? ` ×${qty}` : ''}</span><span class="r-desc">${d.desc}</span><span class="r-own">own ${countOwned(p, id)}</span>`;
        const buy = el('button', 'btn small', `Buy ⌬ ${price}`);
        buy.disabled = p.credits < price;
        buy.onclick = () => {
          if (p.credits < price) return Audio.playDeny();
          const left = addToSlots(p.stash, id, qty);
          if (left === qty) return this.notifyHub('Stash is full.');
          p.credits -= price;
          this.notifyHub(`Bought ${d.name}.`);
          this.afterHubChange();
        };
        row.appendChild(buy);
        rows.appendChild(row);
      }
      shop.appendChild(rows);
    }
    body.appendChild(shop);
  }

  sellId(id, n) {
    const p = this.game.profile;
    let left = n;
    for (let i = p.stash.length - 1; i >= 0 && left > 0; i--) {
      const s = p.stash[i];
      if (s && s.id === id) {
        const take = Math.min(left, s.n);
        s.n -= take;
        left -= take;
        if (s.n <= 0) p.stash[i] = null;
      }
    }
    const sold = n - left;
    p.credits += sold * ITEMS[id].value;
    Audio.playPickup();
    this.afterHubChange();
  }

  renderWorkbenchTab(body) {
    const p = this.game.profile;
    body.className = 'hub-body workbench-tab';
    body.appendChild(el('div', 'col-title', 'WORKBENCH <small>uses materials from your stash, then your bag · output goes to the stash</small>'));
    const rows = el('div', 'rows recipes');
    for (const r of RECIPES) {
      const d = ITEMS[r.out];
      const can = Object.entries(r.cost).every(([id, n]) => countOwned(p, id) >= n);
      const row = el('div', `row recipe ${can ? 'can' : ''}`);
      const cost = Object.entries(r.cost).map(([id, n]) => {
        const have = countOwned(p, id);
        return `<span class="cost ${have >= n ? 'ok' : 'no'}">${ITEMS[id].name} ${have}/${n}</span>`;
      }).join('');
      row.innerHTML = `<span class="r-name" style="color:${RARITY[d.rarity].color}">${d.name}${r.n > 1 ? ` ×${r.n}` : ''}</span><span class="costs">${cost}</span>`;
      const btn = el('button', 'btn small', 'Craft');
      btn.disabled = !can;
      btn.onclick = () => {
        if (!Object.entries(r.cost).every(([id, n]) => countOwned(p, id) >= n)) return;
        const probe = p.stash.map((s) => (s ? { ...s } : null));
        if (addToSlots(probe, r.out, r.n) > 0) return this.notifyHub('Stash is full.');
        for (const [id, n] of Object.entries(r.cost)) removeOwned(p, id, n);
        addToSlots(p.stash, r.out, r.n);
        this.notifyHub(`Crafted ${d.name}${r.n > 1 ? ` ×${r.n}` : ''}.`);
        this.afterHubChange();
      };
      row.appendChild(btn);
      rows.appendChild(row);
    }
    body.appendChild(rows);
  }

  renderLogTab(body) {
    const p = this.game.profile;
    body.className = 'hub-body log-tab';
    const s = p.stats;
    const rate = s.raids ? Math.round((s.extracts / s.raids) * 100) : 0;
    body.innerHTML = `
      <div class="col-title">RAIDER LOG</div>
      <div class="result-grid">
        <div><b>${s.raids}</b><span>Raids</span></div>
        <div><b>${s.extracts}</b><span>Extractions</span></div>
        <div><b>${rate}%</b><span>Survival rate</span></div>
        <div><b>${s.deaths}</b><span>Deaths</span></div>
        <div><b>${s.kills}</b><span>ARC destroyed</span></div>
      </div>
      <div class="guide">
        <h3>How a raid works</h3>
        <p>Everything in your loadout comes topside with you. Search crates, lockers, cars and ARC probes for materials and valuables, destroy ARC machines and loot their wrecks, then <b>call a lift</b> at one of the four extraction points. Hold out while it arrives (the noise draws ARC in), step inside and hold <b>E</b>.</p>
        <p>Die, or still be topside when the ${Math.round(RAID_SECONDS / 60)}-minute raid clock runs out, and you lose everything you carried except your <b>safe pocket</b>.</p>
        <h3>ARC field notes</h3>
        <p><b>Tick</b>: small crawler that leaps at you. <b>Pop</b>: rolling bomb. Shoot it before it gets close. <b>Wasp</b>: armed drone that strafes; its eye is a weak spot. <b>Snitch</b>: scout drone; if it sees you for a few seconds it calls Wasps. <b>Leaper</b>: armored jumper; aim for the glowing core on top. <b>Bastion</b>: walking fortress in the plaza; its core is on its back.</p>
        <h3>Controls</h3>
        <p>WASD move · Shift sprint · Space jump · C crouch · V dodge roll · Mouse aim/fire · RMB aim down sights · R reload · 1/2 or wheel swap weapon · 3 heal · 4 recharge shield · G grenade · E interact (hold) · Tab backpack · M map · Esc pause</p>
      </div>
      <button class="btn danger reset">Wipe save and start over</button>`;
    body.querySelector('.reset').onclick = () => {
      if (!confirm('Delete your stash, credits and progress?')) return;
      this.game.profile = resetProfile();
      this.renderHub();
    };
  }
}

// Exported for tests/tools that want a fresh stack.
export { makeStack };
