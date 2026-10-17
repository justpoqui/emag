// Slot-based inventory helpers, plus the saved profile (localStorage).

import { ITEMS, BAG_SLOTS, SAFE_SLOTS, STASH_SLOTS, START_CREDITS, stackSize, FREE_KIT, MAX_DURABILITY, isDurable, RECIPES } from './config.js';
import { cleanMemory, blankMemory } from './network.js';


export function makeStack(id, n = 1) {
  const item = ITEMS[id];
  const stack = { id, n };
  if (item.type === 'weapon') stack.mag = item.mag;
  if (item.type === 'shield') stack.charge = item.capacity;
  if (isDurable(id)) stack.dur = MAX_DURABILITY;
  return stack;
}

// Durability of a weapon/shield stack (older saves have none: treat as new).
export function durability(stack) {
  return stack.dur ?? MAX_DURABILITY;
}

// What a trader pays for a stack; worn gear sells for less.
export function stackValue(stack) {
  const base = ITEMS[stack.id].value * stack.n;
  if (!isDurable(stack.id)) return base;
  return Math.round(base * (0.4 + 0.6 * (durability(stack) / MAX_DURABILITY)));
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

export function emptyLoadout() {
  return {
    weapons: [null, null],
    shield: null,
    bag: new Array(BAG_SLOTS).fill(null),
    safe: new Array(SAFE_SLOTS).fill(null),
  };
}

function template() {
  const stash = new Array(STASH_SLOTS).fill(null);
  stash[0] = makeStack('ammo_light', 40);
  stash[1] = makeStack('bandage', 2);
  stash[2] = makeStack('scrap', 6);
  stash[3] = makeStack('fabric', 4);
  const loadout = emptyLoadout();
  applyFreeKit(loadout);
  return { credits: START_CREDITS, stash, loadout, stats: { raids: 0, extracts: 0, deaths: 0, kills: 0 }, level: 1, xp: 0, network: blankMemory(), pins: [] };
}

// Item ids from older saves, renamed since.
const RENAMED = {
  kettle: 'mule', stitcher: 'sparrow', rattler: 'badger', anvil: 'hammerhead', toro: 'boar', ferro: 'heron',
  arc_alloy: 'husk_plating', arc_circuit: 'husk_circuit', arc_core: 'husk_heart', recharger: 'shield_cell',
};

function migrateIds(data) {
  const fix = (s) => {
    if (!s) return s;
    if (RENAMED[s.id]) s.id = RENAMED[s.id];
    return ITEMS[s.id] ? s : null; // drop anything the game no longer has
  };
  data.stash = data.stash.map(fix);
  const lo = data.loadout;
  lo.weapons = lo.weapons.map(fix);
  lo.shield = fix(lo.shield);
  lo.bag = lo.bag.map(fix);
  lo.safe = lo.safe.map(fix);
}

// A fresh profile for a new account.
export function blankProfile() {
  return template();
}

// Bring a saved profile (any age) up to date: renamed items, missing fields,
// slot counts.
export function normalizeProfile(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.stash) || !data.loadout) return template();
  try {
    migrateIds(data);
    const base = template();
    for (const key of Object.keys(base)) if (data[key] === undefined) data[key] = base[key];
    fitArray(data.stash, STASH_SLOTS);
    fitArray(data.loadout.bag, BAG_SLOTS);
    fitArray(data.loadout.safe, SAFE_SLOTS);
    sanitize(data);
    return data;
  } catch (err) {
    console.warn('Save could not be read, starting fresh', err);
    return template();
  }
}

// Clamp everything to values the game can actually produce, so a hand-edited
// save can't carry impossible stacks, ammo, credits or stats.
export const MAX_PINS = 6;

function int(v, min, max, fallback = min) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function cleanStack(s) {
  if (!s || typeof s !== 'object' || !ITEMS[s.id]) return null;
  const def = ITEMS[s.id];
  const out = { id: s.id, n: int(s.n, 1, stackSize(s.id), 1) };
  if (def.type === 'weapon') out.mag = int(s.mag, 0, def.mag, def.mag);
  if (def.type === 'shield') out.charge = Math.min(def.capacity, Math.max(0, Number(s.charge) || 0));
  if (isDurable(s.id)) out.dur = s.dur === undefined ? MAX_DURABILITY : Math.min(MAX_DURABILITY, Math.max(0, Number(s.dur) || 0));
  return out;
}

function sanitize(p) {
  p.credits = int(p.credits, 0, 1e9, 0);
  p.level = int(p.level, 1, 999, 1);
  p.xp = int(p.xp, 0, 1e9, 0);
  const st = p.stats && typeof p.stats === 'object' ? p.stats : {};
  p.stats = { raids: int(st.raids, 0, 1e7), extracts: int(st.extracts, 0, 1e7), deaths: int(st.deaths, 0, 1e7), kills: int(st.kills, 0, 1e9) };
  p.stats.extracts = Math.min(p.stats.extracts, p.stats.raids);
  p.stash = p.stash.map(cleanStack);
  const lo = p.loadout;
  lo.weapons = [0, 1].map((i) => {
    const w = cleanStack(lo.weapons[i]);
    return w && ITEMS[w.id].type === 'weapon' ? w : null;
  });
  const sh = cleanStack(lo.shield);
  lo.shield = sh && ITEMS[sh.id].type === 'shield' ? sh : null;
  lo.bag = lo.bag.map(cleanStack);
  lo.safe = lo.safe.map(cleanStack);
  p.inRaid = !!p.inRaid;
  p.network = cleanMemory(p.network);
  // pinned recipes (by what they make)
  p.pins = Array.isArray(p.pins) ? [...new Set(p.pins.filter((id) => RECIPES.some((r) => r.out === id)))].slice(0, MAX_PINS) : [];
  // drop any keys the game doesn't use
  for (const k of Object.keys(p)) if (!['credits', 'stash', 'loadout', 'stats', 'level', 'xp', 'inRaid', 'network', 'pins'].includes(k)) delete p[k];
  for (const k of Object.keys(lo)) if (!['weapons', 'shield', 'bag', 'safe'].includes(k)) delete lo[k];
}

function fitArray(arr, size) {
  while (arr.length < size) arr.push(null);
  arr.length = size;
}

// Saving goes to the signed-in account (see accounts.js), which registers
// itself here. Before sign-in nothing is saved.
let saver = null;

export function setSaver(fn) {
  saver = fn;
}

export function saveProfile(profile) {
  if (saver) saver(profile);
}

export function resetProfile() {
  return template();
}

// Add count of id into a slot array. Fills existing stacks first.
// Returns how many could NOT fit.
export function addToSlots(slots, id, n, extra) {
  const max = stackSize(id);
  if (max > 1) {
    for (const s of slots) {
      if (n <= 0) break;
      if (s && s.id === id && s.n < max) {
        const take = Math.min(max - s.n, n);
        s.n += take;
        n -= take;
      }
    }
  }
  for (let i = 0; i < slots.length && n > 0; i++) {
    if (!slots[i]) {
      const take = Math.min(max, n);
      slots[i] = makeStack(id, take);
      if (extra) Object.assign(slots[i], clone(extra));
      n -= take;
    }
  }
  return n;
}

export function countIn(slots, id) {
  let total = 0;
  for (const s of slots) if (s && s.id === id) total += s.n;
  return total;
}

// Remove up to n of id. Returns how many were removed.
export function removeFrom(slots, id, n) {
  let removed = 0;
  for (let i = slots.length - 1; i >= 0 && removed < n; i--) {
    const s = slots[i];
    if (s && s.id === id) {
      const take = Math.min(s.n, n - removed);
      s.n -= take;
      removed += take;
      if (s.n <= 0) slots[i] = null;
    }
  }
  return removed;
}

export function freeSlots(slots) {
  return slots.filter((s) => !s).length;
}

// Move a whole stack into another slot list (merging). Returns leftover stack or null.
export function moveStack(stack, slots) {
  const extra = {};
  if (stack.mag !== undefined) extra.mag = stack.mag;
  if (stack.charge !== undefined) extra.charge = stack.charge;
  if (stack.dur !== undefined) extra.dur = stack.dur;
  const left = addToSlots(slots, stack.id, stack.n, extra);
  if (left <= 0) return null;
  return { ...stack, n: left };
}

export function stackWeight(stack) {
  return stack ? ITEMS[stack.id].weight * stack.n : 0;
}

// Everything you carry: weapons, shield, bag and safe pocket.
export function loadoutWeight(loadout) {
  let total = 0;
  loadout.weapons.forEach((s) => { total += stackWeight(s); });
  total += stackWeight(loadout.shield);
  loadout.bag.forEach((s) => { total += stackWeight(s); });
  loadout.safe.forEach((s) => { total += stackWeight(s); });
  return total;
}

export function loadoutValue(loadout) {
  let total = 0;
  const add = (s) => { if (s) total += ITEMS[s.id].value * s.n; };
  loadout.weapons.forEach(add);
  add(loadout.shield);
  loadout.bag.forEach(add);
  loadout.safe.forEach(add);
  return total;
}

export function loadoutIsEmpty(loadout) {
  return !loadout.weapons[0] && !loadout.weapons[1] && !loadout.shield && loadout.bag.every((s) => !s);
}

export function applyFreeKit(loadout) {
  loadout.weapons = clone(FREE_KIT.weapons);
  loadout.shield = clone(FREE_KIT.shield);
  for (const s of FREE_KIT.bag) addToSlots(loadout.bag, s.id, s.n);
}

// Every slot list a profile owns, for crafting (stash first, then bag).
export function countOwned(profile, id) {
  return countIn(profile.stash, id) + countIn(profile.loadout.bag, id);
}

export function removeOwned(profile, id, n) {
  const fromStash = removeFrom(profile.stash, id, n);
  if (fromStash < n) removeFrom(profile.loadout.bag, id, n - fromStash);
}
