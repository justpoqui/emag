// Slot-based inventory helpers, plus the saved profile (localStorage).

import { ITEMS, BAG_SLOTS, SAFE_SLOTS, STASH_SLOTS, START_CREDITS, stackSize, FREE_KIT, MAX_DURABILITY, isDurable } from './config.js';

const SAVE_KEY = 'scrapfall_save_v1';

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
  return { credits: START_CREDITS, stash, loadout, stats: { raids: 0, extracts: 0, deaths: 0, kills: 0 }, level: 1, xp: 0 };
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

export function loadProfile() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      migrateIds(data);
      const base = template();
      for (const key of Object.keys(base)) if (data[key] === undefined) data[key] = base[key];
      fitArray(data.stash, STASH_SLOTS);
      fitArray(data.loadout.bag, BAG_SLOTS);
      fitArray(data.loadout.safe, SAFE_SLOTS);
      return data;
    }
  } catch (err) {
    console.warn('Save could not be read, starting fresh', err);
  }
  return template();
}

function fitArray(arr, size) {
  while (arr.length < size) arr.push(null);
  arr.length = size;
}

export function saveProfile(profile) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(profile));
  } catch (err) {
    console.warn('Save failed', err);
  }
}

export function resetProfile() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (err) {
    // ignore
  }
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
