// All DOM UI: the raid HUD, inventory / loot / map / pause menus, the hub
// (stash, traders, workbench) and the raid results screen.

import * as THREE from 'three';
import {
  ITEMS, RARITY, AMMO, TRADERS, BUY_MARKUP, RECIPES, BENCH_SECTIONS, PLAYER, RAID_SECONDS, MAX_DURABILITY, REPAIR, isDurable,
} from './config.js';
import {
  addToSlots, durability, stackValue, countIn, moveStack, freeSlots, loadoutIsEmpty, applyFreeKit, countOwned, removeOwned, saveProfile, resetProfile, makeStack,
} from './inventory.js';
import { MAP_HALF } from './collision.js';
import * as Audio from './audio.js';
import { QUALITY, getQualityName, setQualityName } from './settings.js';
import { renderHome, renderLogin } from './home.js';
import { signOut, currentUser, isAdmin, storageKind, changePassword, passwordProblem, adminData, adminSetBans, adminSetBulletin, ADMIN_NAME } from './accounts.js';

// Fullscreen + landscape on phones (Android honours the orientation lock; on
// iPhone, add the game to the home screen for fullscreen).
export function goFullscreen() {
  const doc = document.documentElement;
  const req = doc.requestFullscreen || doc.webkitRequestFullscreen;
  if (!req || document.fullscreenElement || document.webkitFullscreenElement) return;
  try {
    const p = req.call(doc, { navigationUI: 'hide' });
    const lock = () => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {});
    if (p && p.then) p.then(lock).catch(() => {});
    else lock();
  } catch (err) {
    // not allowed here; ignore
  }
}

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
    // browsers only allow audio after a user gesture
    document.addEventListener('click', () => Audio.initAudio());
    document.addEventListener('pointerdown', () => Audio.initAudio());
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
    if (this.game.input.touch) {
      hud.querySelector('.help').textContent = 'Left thumb: move (push to the edge to sprint) · Right thumb: look · Hold FIRE and drag to aim while shooting';
      hud.querySelector('.prompt .key').textContent = 'USE';
    }
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
      s.className = 'wslot' + (i === w.active ? ' active' : '') + (stack ? '' : ' empty') + (stack && isDurable(stack.id) && durability(stack) <= 0 ? ' broken' : '');
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
      recharge: countIn(bag, 'shield_cell'),
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
    this.closeSheet();
    this.closeContextMenu();
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
    let durBar = '';
    if (isDurable(stack.id)) {
      const pct = durability(stack) / MAX_DURABILITY;
      durBar = `<span class="dur ${pct <= 0 ? 'broken' : pct < 0.25 ? 'low' : ''}"><i style="width:${pct * 100}%"></i></span>`;
      if (pct <= 0) t.classList.add('is-broken');
    }
    t.innerHTML = `
      <span class="glyph" style="color:#${def.color.toString(16).padStart(6, '0')}">${TYPE_GLYPH[def.type] || '?'}</span>
      <span class="name">${def.name}</span>
      ${stack.n > 1 ? `<span class="count">${stack.n}</span>` : ''}${extra}${durBar}`;
    if (this.game.input.touch) {
      // tap = main action, long-press = item info and every other action
      let timer = null;
      let long = false;
      t.addEventListener('pointerdown', () => {
        long = false;
        timer = setTimeout(() => {
          long = true;
          this.showSheet(stack, opts);
        }, 420);
      });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) t.addEventListener(ev, () => clearTimeout(timer));
      t.addEventListener('click', (e) => {
        e.stopPropagation();
        if (long) return;
        if (opts.onClick) opts.onClick(e);
      });
      return t;
    }
    t.addEventListener('mouseenter', () => this.showTooltip(stack, opts.hint));
    t.addEventListener('mouseleave', () => this.hideTooltip());
    if (opts.onClick) t.addEventListener('click', (e) => { e.stopPropagation(); opts.onClick(e); });
    if (opts.menu) {
      t.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.hideTooltip();
        this.showContextMenu(e.clientX, e.clientY, stack, opts.menu());
      });
    } else if (opts.onRight) {
      t.addEventListener('contextmenu', (e) => { e.preventDefault(); opts.onRight(e); });
    }
    return t;
  }

  // Right-click menu: [{ label, fn, disabled, danger, note }]
  showContextMenu(x, y, stack, items) {
    this.closeContextMenu();
    const def = ITEMS[stack.id];
    const menu = el('div', 'ctx-menu');
    const dur = isDurable(stack.id) ? ` · ${Math.ceil(durability(stack))}/${MAX_DURABILITY}` : '';
    menu.appendChild(el('div', 'ctx-head', `<b style="color:${RARITY[def.rarity].color}">${def.name}${stack.n > 1 ? ` ×${stack.n}` : ''}</b><span>${RARITY[def.rarity].name}${dur}</span>`));
    for (const it of items) {
      const b = el('button', `ctx-item${it.danger ? ' danger' : ''}`, `<span>${it.label}</span>${it.note ? `<small>${it.note}</small>` : ''}`);
      b.disabled = !!it.disabled;
      b.onclick = (e) => {
        e.stopPropagation();
        this.closeContextMenu();
        it.fn();
      };
      menu.appendChild(b);
    }
    this.root.appendChild(menu);
    // keep it on screen
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - r.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - r.height - 8))}px`;
    this.ctxMenu = menu;
    const away = (e) => {
      if (this.ctxMenu && !this.ctxMenu.contains(e.target)) this.closeContextMenu();
    };
    const esc = (e) => {
      if (e.code === 'Escape') this.closeContextMenu();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', away);
      document.addEventListener('contextmenu', away, true);
      window.addEventListener('keydown', esc);
    });
    this._ctxCleanup = () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('contextmenu', away, true);
      window.removeEventListener('keydown', esc);
    };
  }

  closeContextMenu() {
    if (this._ctxCleanup) this._ctxCleanup();
    this._ctxCleanup = null;
    if (this.ctxMenu) this.ctxMenu.remove();
    this.ctxMenu = null;
  }

  // Menu entries for an item in the hub. slot = { get, set, where } where
  // where is 'stash' | 'weapon' | 'shield' | 'bag' | 'safe'.
  hubItemMenu(slot, stashIndex) {
    const p = this.game.profile;
    const lo = p.loadout;
    const s = slot.get();
    const items = [];
    if (slot.where === 'stash') {
      items.push({ label: 'Move to loadout', fn: () => this.stashToLoadout(stashIndex) });
    } else {
      items.push({
        label: 'Move to stash',
        fn: () => {
          const left = moveStack(s, p.stash);
          if (left) this.notifyHub('Stash is full.');
          slot.set(left);
          this.afterHubChange();
        },
      });
    }
    if (slot.where === 'bag' || slot.where === 'stash') {
      const free = lo.safe.findIndex((x) => !x);
      items.push({
        label: 'Move to safe pocket',
        note: free === -1 ? 'Safe pocket is full' : 'Kept if you die',
        disabled: free === -1,
        fn: () => {
          lo.safe[free] = s;
          slot.set(null);
          this.afterHubChange();
        },
      });
    }
    if (slot.where === 'safe') {
      items.push({
        label: 'Move to bag',
        fn: () => {
          slot.set(moveStack(s, lo.bag));
          this.afterHubChange();
        },
      });
    }
    if (isDurable(s.id) && durability(s) < MAX_DURABILITY) {
      const { cost, credits } = this.repairCost(s, MAX_DURABILITY - durability(s));
      const canMats = Object.entries(cost).every(([id, n]) => countOwned(p, id) >= n);
      items.push({
        label: 'Repair with materials',
        note: Object.entries(cost).map(([id, n]) => `${ITEMS[id].name} ${countOwned(p, id)}/${n}`).join(' · '),
        disabled: !canMats,
        fn: () => this.repairItem(s, 'materials'),
      });
      items.push({ label: `Repair for ⌬ ${credits}`, disabled: p.credits < credits, fn: () => this.repairItem(s, 'credits') });
    }
    const value = stackValue(s);
    items.push({
      label: `Sell for ⌬ ${value}`,
      danger: true,
      fn: () => {
        p.credits += value;
        slot.set(null);
        Audio.playPickup();
        this.notifyHub(`Sold ${ITEMS[s.id].name}${s.n > 1 ? ` ×${s.n}` : ''} for ⌬ ${value}.`);
        this.afterHubChange();
      },
    });
    if (s.n > 1) {
      const one = stackValue({ ...s, n: 1 });
      items.push({
        label: `Sell 1 for ⌬ ${one}`,
        danger: true,
        fn: () => {
          p.credits += one;
          s.n -= 1;
          Audio.playPickup();
          this.afterHubChange();
        },
      });
    }
    return items;
  }

  repairItem(stack, mode) {
    const p = this.game.profile;
    const missing = MAX_DURABILITY - durability(stack);
    if (missing <= 0) return;
    const { cost, credits } = this.repairCost(stack, missing);
    if (mode === 'materials') {
      if (!Object.entries(cost).every(([id, n]) => countOwned(p, id) >= n)) return Audio.playDeny();
      for (const [id, n] of Object.entries(cost)) removeOwned(p, id, n);
    } else {
      if (p.credits < credits) return Audio.playDeny();
      p.credits -= credits;
    }
    stack.dur = MAX_DURABILITY;
    Audio.playPickup();
    this.notifyHub(`Repaired ${ITEMS[stack.id].name}.`);
    this.afterHubChange();
  }

  // Touch: item details plus buttons for the actions a mouse gets from
  // click / shift-click / right-click.
  showSheet(stack, opts) {
    this.closeSheet();
    const sheet = el('div', 'sheet');
    this.showTooltip(stack, '');
    sheet.innerHTML = `<div class="sheet-info">${this.tooltip.innerHTML}</div><div class="sheet-btns"></div>`;
    this.hideTooltip();
    const btns = sheet.querySelector('.sheet-btns');
    const labels = opts.labels || {};
    const add = (label, fn, disabled) => {
      const b = el('button', 'btn', label);
      b.disabled = !!disabled;
      b.onclick = (e) => {
        e.stopPropagation();
        this.closeSheet();
        fn();
      };
      btns.appendChild(b);
    };
    if (opts.menu) {
      for (const it of opts.menu()) add(it.label, it.fn, it.disabled);
    } else {
      if (opts.onClick && labels.tap) add(labels.tap, () => opts.onClick({ shiftKey: false }));
      if (opts.onClick && labels.shift) add(labels.shift, () => opts.onClick({ shiftKey: true }));
      if (opts.onRight && labels.right) add(labels.right, () => opts.onRight({}));
    }
    add('Close', () => {});
    btns.lastChild.classList.add('ghost');
    // the finger that long-pressed lifts onto the backdrop; ignore that first release
    let armed = false;
    document.addEventListener('pointerup', () => setTimeout(() => { armed = true; }, 150), { once: true });
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet && armed) this.closeSheet();
    });
    this.root.appendChild(sheet);
    this.sheet = sheet;
  }

  closeSheet() {
    if (this.sheet) this.sheet.remove();
    this.sheet = null;
  }

  // Panel header with a close button (Tab/M/Esc on keyboard).
  titleBar(text, hint) {
    const bar = el('div', 'panel-title', `<span>${text}</span><span class="close">${this.game.input.touch ? '' : hint}</span>`);
    const x = el('button', 'x', '✕');
    x.onclick = () => this.closeMenus();
    bar.querySelector('.close').appendChild(x);
    return bar;
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
      ${isDurable(stack.id) ? `<div class="tt-dur">Durability ${Math.ceil(durability(stack))} / ${MAX_DURABILITY}${durability(stack) <= 0 ? ' · BROKEN' : ''}</div>` : ''}
      <div class="tt-value">Value ⌬ ${isDurable(stack.id) ? stackValue(stack) : def.value}${stack.n > 1 ? ` (⌬ ${stackValue(stack)} total)` : ''}</div>
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
    const menu = (slot) => (handlers.menu ? () => handlers.menu(slot) : undefined);
    lo.weapons.forEach((w, i) => col.appendChild(this.tile(w, {
      cls: 'wide', label: `Weapon ${i + 1}`, onClick: () => handlers.weapon(i), hint: handlers.weaponHint,
      menu: menu({ where: 'weapon', get: () => lo.weapons[i], set: (v) => { lo.weapons[i] = v; } }),
    })));
    col.appendChild(el('div', 'sect', 'SHIELD'));
    col.appendChild(this.tile(lo.shield, {
      cls: 'wide', label: 'Shield', onClick: () => handlers.shield(), hint: handlers.shieldHint,
      menu: menu({ where: 'shield', get: () => lo.shield, set: (v) => { lo.shield = v; } }),
    }));
    col.appendChild(el('div', 'sect', 'SAFE POCKET <small>(kept if you die)</small>'));
    const safe = el('div', 'grid small');
    lo.safe.forEach((s, i) => safe.appendChild(this.tile(s, {
      label: 'Safe', onClick: () => handlers.safe(i), hint: handlers.safeHint,
      menu: menu({ where: 'safe', get: () => lo.safe[i], set: (v) => { lo.safe[i] = v; } }),
    })));
    col.appendChild(safe);
    return col;
  }

  renderInventory() {
    const g = this.game;
    const lo = g.profile.loadout;
    this.menus.innerHTML = '';
    const panel = el('div', 'panel inventory');
    panel.appendChild(this.titleBar('BACKPACK', 'Tab to close'));
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
        menu: () => {
          const st = lo.bag[i];
          const items = [];
          const tap = this.bagTapLabel(st);
          if (tap) items.push({ label: tap, fn: () => this.bagClick(i, false) });
          const free = lo.safe.findIndex((x) => !x);
          items.push({ label: 'Move to safe pocket', note: free === -1 ? 'Safe pocket is full' : 'Kept if you die', disabled: free === -1, fn: () => this.bagClick(i, true) });
          items.push({
            label: 'Drop',
            danger: true,
            fn: () => {
              this.notify(`Dropped ${ITEMS[st.id].name}.`);
              lo.bag[i] = null;
              this.refreshInventory();
            },
          });
          return items;
        },
      }));
    });
    bagCol.appendChild(grid);
    body.appendChild(bagCol);
    panel.appendChild(body);
    this.menus.appendChild(panel);
  }

  bagTapLabel(s) {
    const t = ITEMS[s.id].type;
    if (t === 'heal' || t === 'recharge') return 'Use';
    if (t === 'weapon' || t === 'shield') return 'Equip';
    return null;
  }

  bagHint(s) {
    const t = ITEMS[s.id].type;
    if (t === 'heal' || t === 'recharge') return 'Click: use · Right-click: more';
    if (t === 'weapon' || t === 'shield') return 'Click: equip · Right-click: more';
    return 'Right-click: move to safe pocket or drop';
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
    panel.appendChild(this.titleBar(c.name.toUpperCase(), 'Tab to close · F take all'));
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
    panel.appendChild(this.titleBar('TOPSIDE · DUSTLINE', 'M to close'));
    const canvas = el('canvas', 'map');
    canvas.width = 640;
    canvas.height = 640;
    panel.appendChild(canvas);
    panel.appendChild(el('div', 'legend', '<span class="lg you">▲ You</span><span class="lg lift">■ Lift</span><span class="lg husk">● Husks (spotted)</span>'));
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
        <div class="settings-slot"></div>
        <button class="btn danger abandon">Abandon raid (lose your loadout)</button>
      </div>`;
    panel.querySelector('.settings-slot').replaceWith(this.settingsBlock(true));
    panel.querySelector('.resume').onclick = () => this.game.setPaused(false);
    panel.querySelector('.abandon').onclick = () => {
      this.game.paused = false;
      this.game.endRaid(false, 'Abandoned the raid');
    };
    this.menus.appendChild(panel);
  }

  // Sensitivity, volume, graphics quality and fullscreen; used by pause and the hub.
  settingsBlock(inRaid) {
    const box = el('div', 'settings');
    const q = getQualityName();
    box.innerHTML = `
      <label class="setting">${this.game.input.touch ? 'Look' : 'Mouse'} sensitivity <input type="range" class="sens" min="0.0006" max="0.006" step="0.0001"></label>
      <label class="setting">Volume <input type="range" class="vol" min="0" max="1" step="0.05"></label>
      <div class="setting">Graphics <span class="seg">${Object.entries(QUALITY).map(([k, v]) => `<button class="seg-b ${k === q ? 'on' : ''}" data-q="${k}">${v.label}</button>`).join('')}</span></div>
      <div class="q-note hidden"></div>
      <button class="btn ghost fs">Fullscreen</button>`;
    if (!inRaid && currentUser()) box.prepend(this.accountBlock());
    const sens = box.querySelector('.sens');
    sens.value = this.game.input.sensitivity;
    sens.oninput = () => {
      this.game.input.sensitivity = Number(sens.value);
      try { localStorage.setItem('scrapfall_sens', sens.value); } catch (e) { /* ignore */ }
    };
    const vol = box.querySelector('.vol');
    vol.value = this.volume ?? 0.5;
    vol.oninput = () => {
      this.volume = Number(vol.value);
      Audio.setVolume(this.volume);
      try { localStorage.setItem('scrapfall_vol', vol.value); } catch (e) { /* ignore */ }
    };
    const note = box.querySelector('.q-note');
    for (const b of box.querySelectorAll('.seg-b')) {
      b.onclick = () => {
        setQualityName(b.dataset.q);
        box.querySelectorAll('.seg-b').forEach((x) => x.classList.toggle('on', x === b));
        note.classList.remove('hidden');
        if (inRaid) {
          note.textContent = 'Applies the next time the game starts (after this raid).';
        } else {
          note.innerHTML = 'Restart to apply. <button class="btn small reload">Restart now</button>';
          note.querySelector('.reload').onclick = () => location.reload();
        }
      };
    }
    box.querySelector('.fs').onclick = () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else goFullscreen();
    };
    return box;
  }

  // Username, where the account lives, and a change-password form.
  accountBlock() {
    const box = el('div', 'account');
    const cloud = storageKind() === 'cloud';
    box.innerHTML = `
      <div class="acct-row"><span class="acct-label">Username</span><b class="acct-name"></b>${isAdmin() ? '<i class="admin-badge">ADMIN</i>' : ''}</div>
      <div class="acct-row"><span class="acct-label">Saved</span><span>${cloud ? 'Private to your Claude login · works on all your devices' : 'In this browser only'}</span></div>
      <form class="pw-form" novalidate>
        <div class="acct-label">Change password</div>
        <input id="pw-old" type="password" placeholder="Current password" autocomplete="current-password">
        <input id="pw-new" type="password" placeholder="New password (8+ characters, a letter and a number)" autocomplete="new-password">
        <input id="pw-new2" type="password" placeholder="Confirm new password" autocomplete="new-password">
        <div class="pw-msg" role="status"></div>
        <button type="submit" class="btn small">Change password</button>
      </form>`;
    box.querySelector('.acct-name').textContent = currentUser();
    const form = box.querySelector('.pw-form');
    const msg = box.querySelector('.pw-msg');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const oldPw = form.querySelector('#pw-old').value;
      const newPw = form.querySelector('#pw-new').value;
      msg.className = 'pw-msg';
      const problem = passwordProblem(newPw);
      if (problem) return void (msg.textContent = problem);
      if (newPw !== form.querySelector('#pw-new2').value) return void (msg.textContent = 'The new passwords don’t match.');
      const btn = form.querySelector('button');
      btn.disabled = true;
      msg.textContent = 'Saving…';
      const res = await changePassword(oldPw, newPw);
      btn.disabled = false;
      if (res.error) {
        msg.textContent = res.error;
        Audio.playDeny();
        return;
      }
      form.reset();
      msg.classList.add('ok');
      msg.textContent = 'Password changed. Other devices will need the new password.';
      Audio.playChime();
    });
    return box;
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
        <div><b>${sum.kills}</b><span>Husks destroyed</span></div>
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
    this.closeSheet();
    this.closeContextMenu();
    this.menus.innerHTML = '';
    const hub = el('div', 'hub');
    const need = g.xpForLevel(p.level);
    hub.innerHTML = `
      <div class="hub-top">
        <button class="home-btn" title="Title screen">◂</button>
        <div class="logo">SCRAP<span>FALL</span><small>THE BURROW · UNDERGROUND</small></div>
        <div class="tabs">
          ${['loadout', 'traders', 'workbench', 'log', 'settings', ...(isAdmin() ? ['admin'] : [])].map((t) => `<button class="tab ${this.hubTab === t ? 'on' : ''}" data-t="${t}">${{ loadout: 'Loadout', traders: 'Traders', workbench: 'Workbench', log: 'Raider Log', settings: 'Settings', admin: 'Admin' }[t]}</button>`).join('')}
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
    hub.querySelector('.home-btn').onclick = () => this.game.goHome();
    const body = hub.querySelector('.hub-body');
    if (this.hubTab === 'loadout') this.renderLoadoutTab(body);
    if (this.hubTab === 'traders') this.renderTradersTab(body);
    if (this.hubTab === 'workbench') this.renderWorkbenchTab(body);
    if (this.hubTab === 'log') this.renderLogTab(body);
    if (this.hubTab === 'admin' && isAdmin()) this.renderAdminTab(body);
    if (this.hubTab === 'settings') {
      body.className = 'hub-body settings-tab';
      const box = el('div', 'hub-col');
      box.appendChild(el('div', 'col-title', 'SETTINGS'));
      box.appendChild(this.settingsBlock(false));
      body.appendChild(box);
    }
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

  // In-page yes/no dialog (browser confirm() is blocked in some embeds).
  ask(text, yesLabel, onYes) {
    const box = el('div', 'sheet');
    box.innerHTML = `<div class="ask"><div class="ask-text">${text}</div><div class="row"><button class="btn danger yes">${yesLabel}</button><button class="btn ghost no">Cancel</button></div></div>`;
    box.querySelector('.yes').onclick = () => {
      box.remove();
      onYes();
    };
    box.querySelector('.no').onclick = () => box.remove();
    this.root.appendChild(box);
  }

  deploy(checked = false) {
    const lo = this.game.profile.loadout;
    if (!checked) {
      const w = lo.weapons.find((x) => x);
      if (!w) return this.ask('You have no weapon. Deploy anyway?', 'Deploy', () => this.deploy(true));
      if (countIn(lo.bag, AMMO[ITEMS[w.id].ammo]) === 0 && w.mag === 0) {
        return this.ask('You have no ammo for your weapon. Deploy anyway?', 'Deploy', () => this.deploy(true));
      }
    }
    Audio.initAudio();
    if (this.game.input.touch) goFullscreen();
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
      weaponHint: 'Click: move to stash · Right-click: more', shieldHint: 'Click: move to stash · Right-click: more', safeHint: 'Click: move to stash · Right-click: more',
      menu: (slot) => this.hubItemMenu(slot),
    }));
    const bagTitle = el('div', 'sect', `BAG <small>${freeSlots(lo.bag)} free</small>`);
    left.appendChild(bagTitle);
    const bag = el('div', 'grid');
    lo.bag.forEach((s, i) => bag.appendChild(this.tile(s, {
      hint: 'Click: move to stash · Right-click: more',
      menu: () => this.hubItemMenu({ where: 'bag', get: () => lo.bag[i], set: (v) => { lo.bag[i] = v; } }),
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
    kit.title = 'A Mule, light ammo, bandages and a light shield. Free, any time your loadout is empty.';
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
    right.appendChild(el('div', 'col-title', `STASH <small>${freeSlots(p.stash)} / ${p.stash.length} free · ${g.input.touch ? 'tap to load, hold for more' : 'click to load, right-click for more'}</small>`));
    const stash = el('div', 'grid stash');
    p.stash.forEach((s, i) => stash.appendChild(this.tile(s, {
      hint: s ? 'Click: move to loadout · Right-click: sell, move, repair' : '',
      onClick: () => this.stashToLoadout(i),
      menu: () => this.hubItemMenu({ where: 'stash', get: () => p.stash[i], set: (v) => { p.stash[i] = v; } }, i),
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
      shop.appendChild(el('div', 'col-title', 'SELL FROM STASH <small>worn weapons and shields sell for less</small>'));
      const rows = el('div', 'rows');
      const seen = {};
      const worth = {};
      p.stash.forEach((s) => {
        if (!s) return;
        seen[s.id] = (seen[s.id] || 0) + s.n;
        worth[s.id] = (worth[s.id] || 0) + stackValue(s);
      });
      const ids = Object.keys(seen).sort((a, b) => ITEMS[b].value - ITEMS[a].value);
      if (!ids.length) rows.appendChild(el('div', 'muted', 'Your stash is empty.'));
      for (const id of ids) {
        const d = ITEMS[id];
        const row = el('div', 'row item-row');
        row.innerHTML = `<span class="r-name" style="color:${RARITY[d.rarity].color}">${d.name}</span><span class="r-own">×${seen[id]}</span><span class="r-price">${isDurable(id) ? `up to ⌬ ${d.value}` : `⌬ ${d.value} ea`}</span>`;
        const one = el('button', 'btn small', 'Sell 1');
        one.onclick = () => this.sellId(id, 1);
        const all = el('button', 'btn small', `Sell all (⌬ ${worth[id]})`);
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
    let credits = 0;
    for (let i = p.stash.length - 1; i >= 0 && left > 0; i--) {
      const s = p.stash[i];
      if (s && s.id === id) {
        const take = Math.min(left, s.n);
        credits += stackValue({ ...s, n: take });
        s.n -= take;
        left -= take;
        if (s.n <= 0) p.stash[i] = null;
      }
    }
    p.credits += credits;
    Audio.playPickup();
    this.afterHubChange();
  }

  // Every worn weapon/shield you own: { stack, where, missing }.
  repairList() {
    const p = this.game.profile;
    const lo = p.loadout;
    const out = [];
    const add = (s, where) => {
      if (s && isDurable(s.id) && durability(s) < MAX_DURABILITY) out.push({ stack: s, where, missing: MAX_DURABILITY - durability(s) });
    };
    lo.weapons.forEach((s) => add(s, 'Loadout'));
    add(lo.shield, 'Loadout');
    lo.bag.forEach((s) => add(s, 'Bag'));
    lo.safe.forEach((s) => add(s, 'Safe pocket'));
    p.stash.forEach((s) => add(s, 'Stash'));
    return out;
  }

  repairCost(stack, missing) {
    const def = ITEMS[stack.id];
    const steps = Math.ceil(missing / REPAIR.step);
    const cost = {};
    const per = def.type === 'shield' ? REPAIR.shield : { ...REPAIR.weapon, ...(['rare', 'epic', 'legendary'].includes(def.rarity) ? REPAIR.weaponRare : {}) };
    for (const [id, n] of Object.entries(per)) cost[id] = n * steps;
    const credits = Math.max(10, Math.ceil(def.value * REPAIR.creditRate * (missing / MAX_DURABILITY)));
    return { cost, credits };
  }

  renderRepair(shop, list) {
    const p = this.game.profile;
    shop.appendChild(el('div', 'col-title', 'REPAIR <small>restores durability to 100 · pay with materials or credits</small>'));
    const rows = el('div', 'rows recipes');
    if (!list.length) rows.appendChild(el('div', 'muted', 'Everything you own is in perfect shape.'));
    for (const { stack, where, missing } of list) {
      const d = ITEMS[stack.id];
      const { cost, credits } = this.repairCost(stack, missing);
      const canMats = Object.entries(cost).every(([id, n]) => countOwned(p, id) >= n);
      const dur = Math.ceil(durability(stack));
      const row = el('div', `row recipe repair ${canMats ? 'can' : ''}`);
      const costHtml = Object.entries(cost).map(([id, n]) => {
        const have = countOwned(p, id);
        return `<span class="cost ${have >= n ? 'ok' : 'no'}">${ITEMS[id].name} ${have}/${n}</span>`;
      }).join('');
      row.innerHTML = `
        <span class="r-name" style="color:${RARITY[d.rarity].color}">${d.name}<small>${where}</small></span>
        <span class="dur-wide ${dur <= 0 ? 'broken' : dur < 25 ? 'low' : ''}"><i style="width:${dur}%"></i><b>${dur <= 0 ? 'BROKEN' : `${dur}/${MAX_DURABILITY}`}</b></span>
        <span class="costs">${costHtml}</span>`;
      const mats = el('button', 'btn small', 'Repair');
      mats.disabled = !canMats;
      mats.onclick = () => this.repairItem(stack, 'materials');
      const pay = el('button', 'btn small ghost', `Pay ⌬ ${credits}`);
      pay.disabled = p.credits < credits;
      pay.onclick = () => this.repairItem(stack, 'credits');
      row.append(mats, pay);
      rows.appendChild(row);
    }
    shop.appendChild(rows);
  }

  renderWorkbenchTab(body) {
    const p = this.game.profile;
    body.className = 'hub-body traders-tab workbench-tab';
    const canCraft = (r) => Object.entries(r.cost).every(([id, n]) => countOwned(p, id) >= n);
    const inSection = (sec) => RECIPES.filter((r) => sec.types.includes(ITEMS[r.out].type));
    const repairable = this.repairList();
    if (!this.benchSection) this.benchSection = BENCH_SECTIONS[0].id;
    const section = BENCH_SECTIONS.find((s) => s.id === this.benchSection) || BENCH_SECTIONS[0];

    // section list, with how many recipes you can afford right now
    const list = el('div', 'trader-list');
    for (const sec of BENCH_SECTIONS) {
      const ready = sec.repair ? repairable.length : inSection(sec).filter(canCraft).length;
      const b = el('button', `trader ${sec.id === section.id ? 'on' : ''}`, `<b>${sec.name}${ready ? ` <i class="ready">${ready}</i>` : ''}</b><span>${sec.blurb}</span>`);
      b.onclick = () => {
        this.benchSection = sec.id;
        Audio.playUI();
        this.renderHub();
      };
      list.appendChild(b);
    }
    body.appendChild(list);

    const shop = el('div', 'shop');
    if (section.repair) {
      this.renderRepair(shop, repairable);
      body.appendChild(shop);
      return;
    }
    shop.appendChild(el('div', 'col-title', `${section.name.toUpperCase()} <small>uses materials from your stash, then your bag · output goes to the stash</small>`));
    const rows = el('div', 'rows recipes');
    for (const r of inSection(section)) {
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
    shop.appendChild(rows);
    body.appendChild(shop);
  }

  // How a raid works, Husk notes and controls (PC or phone).
  guideHtml() {
    const touch = this.game.input.touch;
    const controls = touch
      ? 'Left thumb: move (push to the edge to sprint) · Right thumb: look · FIRE (hold and drag to aim) · AIM · RELOAD · JUMP · CROUCH · ROLL · USE appears near loot and lifts · SWAP, HEAL, SHIELD and NADE on the left · tap an item to use it, hold it for more'
      : 'WASD move · Shift sprint · Space jump · C crouch · V dodge roll · Mouse aim/fire · RMB aim down sights · R reload · 1/2 or wheel swap weapon · 3 heal · 4 recharge shield · G grenade · E interact (hold) · Tab backpack · M map · Esc pause';
    return `
      <div class="guide">
        <h3>How a raid works</h3>
        <p>Everything in your loadout comes topside with you. Search crates, lockers, cars and Husk pods for materials and valuables, destroy Husks and loot their wrecks, then <b>call a lift</b> at one of the four extraction points. Hold out while it arrives (the noise draws Husks in), step inside and hold <b>${touch ? 'USE' : 'E'}</b>.</p>
        <p>Die, or still be topside when the ${Math.round(RAID_SECONDS / 60)}-minute raid clock runs out, and you lose everything you carried except your <b>safe pocket</b>.</p>
        <h3>Between raids</h3>
        <p>In the Burrow, move gear between your stash and loadout, buy from Tobias and Nia, sell loot, and craft at the Workbench. Broke? Take the free kit.</p>
        <h3>Husk field notes</h3>
        <p><b>Skitter</b>: small crawler that leaps at you. <b>Buzzer</b>: armed drone that strafes; its eye is a weak spot. <b>Watcher</b>: scout drone; if it sees you for a few seconds it calls Buzzers. <b>Pouncer</b>: armored jumper; aim for the glowing core on top. <b>Warden</b>: walking fortress in the plaza; its core is on its back.</p>
        <h3>Controls</h3>
        <p>${controls}</p>
      </div>`;
  }

  // ================= title screen =================
  showHome() {
    this.hud.classList.add('hidden');
    this.open = null;
    this.closeSheet();
    this.hideTooltip();
    this.menus.innerHTML = '';
    this.menus.appendChild(renderHome(this));
    if (!this._homeKeys) {
      this._homeKeys = (e) => {
        if (this.game.mode !== 'home') return;
        if (e.code === 'Escape' && this.modal) this.modal.close();
        else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !this.modal) this.leaveHome();
      };
      window.addEventListener('keydown', this._homeKeys);
    }
  }

  showLogin() {
    this.hud.classList.add('hidden');
    this.open = null;
    this.closeSheet();
    this.hideTooltip();
    this.menus.innerHTML = '';
    this.menus.appendChild(renderLogin(this));
  }

  signedIn(profile, imported) {
    this.game.useProfile(profile);
    if (imported) setTimeout(() => this.notifyHub('Your progress from this browser was moved into your new account.'), 400);
  }

  async signOut() {
    await signOut();
    this.game.profile = resetProfile();
    this.game.mode = 'login';
    this.showLogin();
  }

  leaveHome() {
    if (this.modal) this.modal.close();
    Audio.initAudio();
    if (this.game.input.touch) goFullscreen();
    this.game.enterHub();
  }

  // Only Poqui, signed in on the page owner's Claude login. The server also
  // refuses admin writes from anyone else.
  async renderAdminTab(body) {
    body.className = 'hub-body admin-tab';
    const col = el('div', 'hub-col wide');
    col.innerHTML = '<div class="col-title">ADMIN <small>only you can see this</small></div><div class="muted">Loading…</div>';
    body.appendChild(col);
    const data = await adminData();
    if (!data) {
      col.innerHTML = '<div class="col-title">ADMIN</div><p class="muted">Admin tools work on the Claude page only.</p>';
      return;
    }
    col.innerHTML = `
      <div class="col-title">ADMIN <small>only you can see this</small></div>
      <div class="admin-grid">
        <section>
          <div class="sect">PLAYERS · ${data.players.length}</div>
          <ul class="admin-list players"></ul>
        </section>
        <section>
          <div class="sect">SUSPENDED ACCOUNTS</div>
          <form class="row ban-form"><input class="admin-input" id="ban-name" placeholder="Username" maxlength="16" autocomplete="off"><button class="btn small">Suspend</button></form>
          <ul class="admin-list bans"></ul>
        </section>
        <section class="wide">
          <div class="sect">FIELD BULLETIN POSTS</div>
          <form class="bulletin-form">
            <div class="row"><select id="post-tag" class="admin-input"><option>News</option><option>New</option><option>Event</option><option>Fix</option></select><input id="post-title" class="admin-input" placeholder="Title" maxlength="40"></div>
            <textarea id="post-body" class="admin-input" placeholder="Message" maxlength="200" rows="2"></textarea>
            <button class="btn small">Post to the title screen</button>
          </form>
          <ul class="admin-list posts"></ul>
        </section>
      </div>`;
    const li = (text, btnLabel, fn) => {
      const item = el('li');
      const span = el('span');
      span.textContent = text;
      item.appendChild(span);
      if (btnLabel) {
        const b = el('button', 'btn small ghost', btnLabel);
        b.onclick = fn;
        item.appendChild(b);
      }
      return item;
    };
    const players = col.querySelector('.players');
    for (const n of data.players) players.appendChild(li(n + (n === ADMIN_NAME.toLowerCase() ? ' (admin)' : ''), null));
    if (!data.players.length) players.appendChild(li('No players yet.'));
    const renderBans = () => {
      const ul = col.querySelector('.bans');
      ul.innerHTML = '';
      for (const n of data.bans) {
        ul.appendChild(li(n, 'Restore', async () => {
          data.bans = data.bans.filter((x) => x !== n);
          await adminSetBans(data.bans);
          renderBans();
        }));
      }
      if (!data.bans.length) ul.appendChild(li('Nobody is suspended.'));
    };
    renderBans();
    col.querySelector('.ban-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = col.querySelector('#ban-name');
      const n = input.value.trim().toLowerCase();
      if (!n || n === ADMIN_NAME.toLowerCase() || data.bans.includes(n)) return;
      data.bans.push(n);
      await adminSetBans(data.bans);
      input.value = '';
      renderBans();
    });
    const renderPosts = () => {
      const ul = col.querySelector('.posts');
      ul.innerHTML = '';
      data.bulletin.forEach((p, i) => {
        ul.appendChild(li(`[${p.tag}] ${p.title}: ${p.body}`, 'Remove', async () => {
          data.bulletin.splice(i, 1);
          await adminSetBulletin(data.bulletin);
          renderPosts();
        }));
      });
      if (!data.bulletin.length) ul.appendChild(li('No posts. The built-in notes show on the title screen.'));
    };
    renderPosts();
    col.querySelector('.bulletin-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = col.querySelector('#post-title').value.trim();
      const bodyText = col.querySelector('#post-body').value.trim();
      if (!title || !bodyText) return;
      data.bulletin.unshift({ tag: col.querySelector('#post-tag').value, title, body: bodyText, at: Date.now() });
      data.bulletin = data.bulletin.slice(0, 10);
      await adminSetBulletin(data.bulletin);
      e.target.reset();
      renderPosts();
    });
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
        <div><b>${s.kills}</b><span>Husks destroyed</span></div>
      </div>
      ${this.guideHtml()}
      <button class="btn danger reset">Wipe save and start over</button>`;
    body.querySelector('.reset').onclick = () => {
      this.ask('Delete this account’s stash, credits and progress?', 'Wipe save', () => {
        this.game.profile = resetProfile();
        saveProfile(this.game.profile);
        this.renderHub();
      });
    };
  }
}

// Exported for tests/tools that want a fresh stack.
export { makeStack };
