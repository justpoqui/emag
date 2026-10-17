// Every item, weapon, Husk, container and recipe lives here.
// Edit this file to balance the game.

export const RAID_SECONDS = 20 * 60;
export const EXTRACT_CALL_SECONDS = 20; // waiting for the lift after you call it
export const EXTRACT_OPEN_SECONDS = 25; // how long the lift stays open
export const BAG_SLOTS = 16;
export const SAFE_SLOTS = 1;
export const STASH_SLOTS = 80;
export const START_CREDITS = 1200;

export const PLAYER = {
  health: 100,
  stamina: 100,
  walkSpeed: 4.6,
  sprintSpeed: 7.4,
  crouchSpeed: 2.4,
  adsSpeed: 3.0,
  jump: 6.2,
  rollCost: 28,
  sprintDrain: 16, // per second
  staminaRegen: 22,
};

export const RARITY = {
  common: { name: 'Common', color: '#b7b2a6' },
  uncommon: { name: 'Uncommon', color: '#5fc46b' },
  rare: { name: 'Rare', color: '#3fa3e8' },
  epic: { name: 'Epic', color: '#c262e8' },
  legendary: { name: 'Legendary', color: '#f2b233' },
};

export const AMMO = {
  light: 'ammo_light',
  medium: 'ammo_medium',
  heavy: 'ammo_heavy',
  shotgun: 'ammo_shotgun',
};

// type: weapon | ammo | shield | heal | recharge | grenade | material | valuable
export const ITEMS = {
  // ---- weapons ----
  mule: {
    name: 'Mule', type: 'weapon', rarity: 'common', value: 260, color: 0x8a7a5a,
    desc: 'Reliable semi-auto rifle. Every raider starts with one.',
    ammo: 'light', damage: 16, rpm: 450, auto: false, mag: 18, reload: 1.7,
    spreadHip: 2.4, spreadAds: 0.35, recoil: 1.1, range: 140, wear: 0.12, pellets: 1, shape: 'rifle',
  },
  sparrow: {
    name: 'Sparrow', type: 'weapon', rarity: 'uncommon', value: 650, color: 0x4f6b6a,
    desc: 'Compact SMG. Shreds small Husks up close.',
    ammo: 'light', damage: 9, rpm: 820, auto: true, mag: 32, reload: 1.9,
    spreadHip: 3.0, spreadAds: 1.0, recoil: 0.55, range: 70, wear: 0.07, pellets: 1, shape: 'smg',
  },
  badger: {
    name: 'Badger', type: 'weapon', rarity: 'uncommon', value: 900, color: 0x6c5a3d,
    desc: 'Full-auto rifle on medium rounds. A good all-rounder.',
    ammo: 'medium', damage: 15, rpm: 600, auto: true, mag: 26, reload: 2.2,
    spreadHip: 2.6, spreadAds: 0.55, recoil: 0.85, range: 150, wear: 0.09, pellets: 1, shape: 'rifle',
  },
  hammerhead: {
    name: 'Hammerhead', type: 'weapon', rarity: 'rare', value: 1300, color: 0x3d3d44,
    desc: 'Heavy hand cannon. Punches through Husk plating.',
    ammo: 'heavy', damage: 52, rpm: 140, auto: false, mag: 6, reload: 2.4,
    spreadHip: 1.6, spreadAds: 0.25, recoil: 3.4, range: 120, wear: 0.4, pellets: 1, armorPierce: 0.6, shape: 'pistol',
  },
  boar: {
    name: 'Boar', type: 'weapon', rarity: 'rare', value: 1400, color: 0x7a3b2a,
    desc: 'Pump shotgun. Devastating up close, useless far away.',
    ammo: 'shotgun', damage: 11, rpm: 75, auto: false, mag: 5, reload: 2.8,
    spreadHip: 5.5, spreadAds: 4.0, recoil: 4.5, range: 35, wear: 0.6, pellets: 9, shape: 'shotgun',
  },
  heron: {
    name: 'Heron', type: 'weapon', rarity: 'epic', value: 2400, color: 0x2f3a46,
    desc: 'Break-action marksman rifle. One shell, one hole.',
    ammo: 'heavy', damage: 95, rpm: 55, auto: false, mag: 1, reload: 1.3,
    spreadHip: 3.5, spreadAds: 0.05, recoil: 6, range: 260, wear: 1.1, pellets: 1, armorPierce: 0.9, zoom: 2.2, shape: 'long',
  },

  // ---- ammo ----
  ammo_light: { name: 'Light Ammo', type: 'ammo', rarity: 'common', value: 3, stack: 80, color: 0xd6b45a, desc: 'For Mule and Sparrow.' },
  ammo_medium: { name: 'Medium Ammo', type: 'ammo', rarity: 'common', value: 5, stack: 60, color: 0xc98a3e, desc: 'For the Badger.' },
  ammo_heavy: { name: 'Heavy Ammo', type: 'ammo', rarity: 'uncommon', value: 12, stack: 30, color: 0xa65a33, desc: 'For Hammerhead and Heron.' },
  ammo_shotgun: { name: 'Shotgun Shells', type: 'ammo', rarity: 'common', value: 9, stack: 25, color: 0xb53d2e, desc: 'For Boar.' },

  // ---- shields (equip in the shield slot) ----
  shield_light: { name: 'Light Shield', type: 'shield', rarity: 'common', value: 300, capacity: 40, absorb: 0.5, color: 0x6fb4c8, desc: 'Absorbs 50% of damage until drained.' },
  shield_medium: { name: 'Medium Shield', type: 'shield', rarity: 'rare', value: 900, capacity: 70, absorb: 0.6, color: 0x3f8fe0, desc: 'Absorbs 60% of damage until drained.' },
  shield_heavy: { name: 'Heavy Shield', type: 'shield', rarity: 'epic', value: 1800, capacity: 110, absorb: 0.7, color: 0x9b5de5, desc: 'Absorbs 70% of damage until drained.' },

  // ---- consumables ----
  bandage: { name: 'Bandage', type: 'heal', rarity: 'common', value: 40, stack: 5, heal: 25, useTime: 2.2, color: 0xe8dcc4, desc: 'Restores 25 health.' },
  med_kit: { name: 'Herbal Med Kit', type: 'heal', rarity: 'uncommon', value: 140, stack: 3, heal: 60, useTime: 3.5, color: 0x6fae5c, desc: 'Restores 60 health.' },
  shield_cell: { name: 'Shield Cell', type: 'recharge', rarity: 'uncommon', value: 120, stack: 4, recharge: 45, useTime: 2.6, color: 0x5cc8e8, desc: 'Restores 45 shield charge.' },
  frag: { name: 'Frag Grenade', type: 'grenade', rarity: 'uncommon', value: 110, stack: 3, damage: 110, radius: 7, color: 0x5a6b3a, desc: 'Cook it, throw it, cover your ears. [G]' },

  // ---- materials ----
  scrap: { name: 'Scrap Metal', type: 'material', rarity: 'common', value: 10, stack: 30, color: 0x8c8c8c, desc: 'Bent metal. Used in almost everything.' },
  rubber: { name: 'Rubber Parts', type: 'material', rarity: 'common', value: 9, stack: 30, color: 0x333333, desc: 'Hoses, tyres and seals.' },
  plastic: { name: 'Plastic Parts', type: 'material', rarity: 'common', value: 8, stack: 30, color: 0xd9d0b0, desc: 'Brittle but useful.' },
  fabric: { name: 'Fabric', type: 'material', rarity: 'common', value: 8, stack: 30, color: 0xb59a7a, desc: 'For bandages and padding.' },
  chemicals: { name: 'Chemicals', type: 'material', rarity: 'common', value: 14, stack: 20, color: 0x9fc23d, desc: 'Solvents and powders. Handle with care.' },
  wires: { name: 'Wires', type: 'material', rarity: 'uncommon', value: 22, stack: 20, color: 0xc9772c, desc: 'Copper, mostly.' },
  battery: { name: 'Battery', type: 'material', rarity: 'uncommon', value: 35, stack: 10, color: 0x4bb36a, desc: 'Still holds some charge.' },
  husk_plating: { name: 'Husk Plating', type: 'material', rarity: 'uncommon', value: 45, stack: 15, color: 0xa7b6c2, desc: 'Plating stripped from Husks.' },
  husk_circuit: { name: 'Husk Circuitry', type: 'material', rarity: 'rare', value: 110, stack: 10, color: 0x3fd0c9, desc: 'Strange, warm circuit boards.' },
  husk_heart: { name: 'Husk Heart', type: 'material', rarity: 'epic', value: 420, stack: 5, color: 0xff7a2f, desc: 'The heart of a big Husk. Worth a fortune.' },

  // ---- valuables (sell them) ----
  rusted_gear: { name: 'Rusted Gear', type: 'valuable', rarity: 'common', value: 60, stack: 10, color: 0x9a5a32, desc: 'Sells for a little.' },
  old_radio: { name: 'Old Radio', type: 'valuable', rarity: 'uncommon', value: 160, stack: 3, color: 0x6b4b2e, desc: 'From before the Husks came.' },
  pocket_watch: { name: 'Pocket Watch', type: 'valuable', rarity: 'rare', value: 380, stack: 3, color: 0xd8b04a, desc: 'Still ticks. Traders love it.' },
  film_camera: { name: 'Film Camera', type: 'valuable', rarity: 'rare', value: 450, stack: 2, color: 0x2a2a2a, desc: 'Somebody remembered something with this.' },
  music_box: { name: 'Music Box', type: 'valuable', rarity: 'epic', value: 900, stack: 1, color: 0xc77dd0, desc: 'Plays a song nobody knows anymore.' },
  golden_relay: { name: 'Gilded Relay', type: 'valuable', rarity: 'legendary', value: 2200, stack: 1, color: 0xffcc33, desc: 'A Husk component plated in gold. Why?' },
};

// Weight in kg per unit. Ammo is per round.
const WEIGHTS = {
  mule: 3.2, sparrow: 2.6, badger: 3.8, hammerhead: 2.0, boar: 4.2, heron: 5.5,
  ammo_light: 0.02, ammo_medium: 0.03, ammo_heavy: 0.06, ammo_shotgun: 0.05,
  shield_light: 3.0, shield_medium: 4.5, shield_heavy: 6.5,
  bandage: 0.15, med_kit: 0.5, shield_cell: 0.4, frag: 0.45,
  scrap: 0.25, rubber: 0.15, plastic: 0.1, fabric: 0.08, chemicals: 0.2, wires: 0.1, battery: 0.4,
  husk_plating: 0.5, husk_circuit: 0.15, husk_heart: 1.2,
  rusted_gear: 0.6, old_radio: 1.5, pocket_watch: 0.1, film_camera: 0.8, music_box: 1.2, golden_relay: 0.5,
};
for (const [id, w] of Object.entries(WEIGHTS)) if (ITEMS[id]) ITEMS[id].weight = w;
for (const item of Object.values(ITEMS)) if (item.weight === undefined) item.weight = 0.5;

// What you can carry before slowing down. Over 75% of it you slow a little;
// over 100% you slow a lot and can't sprint.
export const CARRY_LIMIT = 35;
export const HOLSTER_SPEED_BONUS = 1.12;

// The stick: always on your back, never dropped, no slot.
export const STICK = {
  name: 'Stick', damage: 24, range: 2.4, arc: 70, cooldown: 0.65, hitAt: 0.42, swing: 0.55,
  stamina: 10, knockback: 2.2, stagger: 0.7,
};

export function stackSize(id) {
  const item = ITEMS[id];
  return item.stack || 1;
}

// What each container can roll. rolls = [min, max] stacks, entries = [itemId, weight, minCount, maxCount]
export const LOOT_TABLES = {
  crate: {
    name: 'Supply Crate', rolls: [2, 4],
    entries: [
      ['scrap', 30, 2, 6], ['rubber', 20, 1, 4], ['plastic', 20, 1, 4], ['fabric', 18, 1, 4],
      ['chemicals', 10, 1, 3], ['wires', 8, 1, 2], ['rusted_gear', 8, 1, 2], ['ammo_light', 10, 10, 25],
      ['ammo_medium', 6, 8, 20], ['bandage', 6, 1, 2],
    ],
  },
  locker: {
    name: 'Locker', rolls: [1, 3],
    entries: [
      ['fabric', 20, 1, 4], ['bandage', 14, 1, 2], ['old_radio', 5, 1, 1], ['pocket_watch', 3, 1, 1],
      ['film_camera', 2, 1, 1], ['ammo_light', 14, 10, 30], ['ammo_shotgun', 8, 4, 10], ['battery', 6, 1, 2],
      ['rusted_gear', 10, 1, 3], ['shield_cell', 5, 1, 1],
    ],
  },
  medical: {
    name: 'Med Cabinet', rolls: [2, 3],
    entries: [['bandage', 40, 1, 3], ['med_kit', 16, 1, 1], ['shield_cell', 14, 1, 2], ['chemicals', 20, 1, 3], ['fabric', 15, 1, 3]],
  },
  weapon_case: {
    name: 'Weapon Case', rolls: [2, 3],
    entries: [
      ['sparrow', 8, 1, 1], ['badger', 7, 1, 1], ['hammerhead', 4, 1, 1], ['boar', 4, 1, 1], ['heron', 1.5, 1, 1],
      ['ammo_light', 20, 20, 40], ['ammo_medium', 18, 15, 35], ['ammo_heavy', 12, 6, 14], ['ammo_shotgun', 12, 6, 12],
      ['frag', 10, 1, 2], ['shield_light', 6, 1, 1], ['shield_medium', 2, 1, 1],
    ],
  },
  husk_pod: {
    name: 'Husk Pod', rolls: [2, 4],
    entries: [
      ['husk_plating', 30, 1, 3], ['husk_circuit', 14, 1, 2], ['battery', 20, 1, 2], ['wires', 20, 1, 3],
      ['husk_heart', 2, 1, 1], ['golden_relay', 0.6, 1, 1], ['music_box', 1.5, 1, 1],
    ],
  },
  car: {
    name: 'Car Trunk', rolls: [1, 3],
    entries: [
      ['rubber', 30, 2, 5], ['scrap', 25, 2, 5], ['plastic', 15, 1, 3], ['battery', 10, 1, 1],
      ['old_radio', 6, 1, 1], ['chemicals', 10, 1, 2], ['ammo_shotgun', 6, 4, 8],
    ],
  },
};

// Husks. drops are rolled into the wreck's loot.
export const ENEMIES = {
  // neutral: leaves raiders alone until provoked or crowded (see network.js).
  // bodyMult: damage taken anywhere but the critical spot (the eye).
  skitter: {
    name: 'Skitter', hp: 50, armor: 0, speed: 8.5, radius: 0.38, flying: false, sight: 38, neutral: true, bodyMult: 0.6,
    attack: { kind: 'leap', range: 6, damage: 8, cooldown: 1.6 },
    drops: { rolls: [1, 2], entries: [['husk_plating', 10, 1, 1], ['scrap', 20, 1, 2], ['wires', 8, 1, 1]] }, xp: 12,
  },
  buzzer: {
    name: 'Buzzer', hp: 60, armor: 0.2, speed: 7, radius: 0.6, flying: true, hover: 7, sight: 60, neutral: true, bodyMult: 0.6,
    attack: { kind: 'gun', range: 55, damage: 5, burst: 5, rate: 0.09, cooldown: 2.0, spread: 2.2 },
    drops: { rolls: [1, 2], entries: [['husk_plating', 20, 1, 2], ['battery', 10, 1, 1], ['husk_circuit', 4, 1, 1]] }, xp: 20,
  },
  watcher: {
    name: 'Watcher', hp: 45, armor: 0, speed: 6, radius: 0.6, flying: true, hover: 14, sight: 70, neutral: true, bodyMult: 0.6,
    attack: { kind: 'alarm', range: 70, callTime: 3.5, calls: 2 },
    drops: { rolls: [1, 2], entries: [['husk_circuit', 10, 1, 1], ['wires', 20, 1, 2], ['battery', 10, 1, 1]] }, xp: 25,
  },
  pouncer: {
    name: 'Pouncer', hp: 420, armor: 0.45, speed: 6.5, radius: 1.6, flying: false, sight: 55,
    attack: { kind: 'slam', range: 22, damage: 34, radius: 6, cooldown: 3.5 },
    drops: { rolls: [3, 4], entries: [['husk_plating', 20, 2, 4], ['husk_circuit', 14, 1, 2], ['husk_heart', 5, 1, 1], ['golden_relay', 0.8, 1, 1]] }, xp: 120,
  },
  warden: {
    name: 'Warden', hp: 1400, armor: 0.6, speed: 2.2, radius: 2.6, flying: false, sight: 80,
    attack: { kind: 'gun', range: 75, damage: 7, burst: 18, rate: 0.07, cooldown: 3.2, spread: 3.0 },
    drops: { rolls: [4, 6], entries: [['husk_plating', 20, 3, 6], ['husk_circuit', 18, 2, 3], ['husk_heart', 14, 1, 2], ['golden_relay', 3, 1, 1]] }, xp: 400,
  },
};

export const TRADERS = {
  gunsmith: {
    name: 'Tobias', title: 'Gunsmith',
    lines: ['Clean your barrel, raider.', 'Badger jams? That\'s a you problem.', 'Heavy rounds cost heavy creds.'],
    stock: ['mule', 'sparrow', 'badger', 'hammerhead', 'boar', 'heron', 'ammo_light', 'ammo_medium', 'ammo_heavy', 'ammo_shotgun', 'frag'],
  },
  medic: {
    name: 'Nia', title: 'Medic',
    lines: ['Bring me back in one piece.', 'Shields don\'t stop stupidity.', 'Bandages. Always more bandages.'],
    stock: ['bandage', 'med_kit', 'shield_cell', 'shield_light', 'shield_medium', 'shield_heavy'],
  },
};
export const BUY_MARKUP = 2.5; // traders sell for value * markup, buy back at value

// Durability: weapons and shields wear down and can be repaired at the
// Workbench. Weapons lose `wear` per shot (set per weapon above); shields lose
// SHIELD_WEAR per point of damage they absorb. Under 25% a weapon's spread
// gets worse; at 0 it can't fire and a shield stops absorbing.
export const MAX_DURABILITY = 100;
export const SHIELD_WEAR = 0.12;
export const REPAIR = {
  step: 25, // costs are charged per 25 points of missing durability
  weapon: { scrap: 2, rubber: 1 },
  weaponRare: { husk_plating: 1 }, // added for rare, epic and legendary weapons
  shield: { fabric: 1, husk_plating: 1 },
  creditRate: 0.35, // or pay a trader: value × rate × (missing / 100)
};

export function isDurable(id) {
  const t = ITEMS[id].type;
  return t === 'weapon' || t === 'shield';
}

// Workbench sections, by what the recipe makes.
export const BENCH_SECTIONS = [
  { id: 'weapons', name: 'Weapons', blurb: 'Gunsmithing', types: ['weapon'] },
  { id: 'ammo', name: 'Ammo', blurb: 'Reloading press', types: ['ammo'] },
  { id: 'shields', name: 'Shields', blurb: 'Energy shields', types: ['shield'] },
  { id: 'medical', name: 'Medical', blurb: 'Heals and shield cells', types: ['heal', 'recharge'] },
  { id: 'explosives', name: 'Explosives', blurb: 'Grenades', types: ['grenade'] },
  { id: 'repair', name: 'Repair', blurb: 'Fix worn weapons and shields', types: [], repair: true },
  { id: 'salvage', name: 'Salvage', blurb: 'Dismantle items for materials', types: [], salvage: true },
];

// What dismantling one of an item gives back. Weapons and shields return
// less when worn (see salvageYield). Basic materials can't be broken down.
export const SALVAGE = {
  mule: { scrap: 4, rubber: 1 },
  sparrow: { scrap: 5, rubber: 2, plastic: 2 },
  badger: { scrap: 7, rubber: 3, wires: 1 },
  hammerhead: { scrap: 6, husk_plating: 2, wires: 2 },
  boar: { scrap: 7, rubber: 3, husk_plating: 1 },
  heron: { scrap: 9, husk_plating: 4, husk_circuit: 1 },
  shield_light: { husk_plating: 1, fabric: 2 },
  shield_medium: { husk_plating: 2, husk_circuit: 1, battery: 1 },
  shield_heavy: { husk_plating: 4, husk_circuit: 2 },
  bandage: { fabric: 1 },
  med_kit: { fabric: 1, chemicals: 1 },
  shield_cell: { battery: 1 },
  frag: { chemicals: 1, scrap: 1 },
  battery: { chemicals: 1, scrap: 1 },
  wires: { scrap: 1 },
  husk_plating: { scrap: 2 },
  husk_circuit: { wires: 2, plastic: 1 },
  husk_heart: { husk_circuit: 2, husk_plating: 3, battery: 1 },
  rusted_gear: { scrap: 2 },
  old_radio: { wires: 2, plastic: 2, battery: 1 },
  pocket_watch: { scrap: 1, wires: 1 },
  film_camera: { plastic: 2, chemicals: 2, wires: 1 },
  music_box: { scrap: 2, wires: 2, rusted_gear: 1 },
  golden_relay: { husk_circuit: 3, wires: 3 },
};

// Materials from dismantling `count` of a stack (worn gear gives less, min half).
export function salvageYield(stack, count = 1) {
  const base = SALVAGE[stack.id];
  if (!base) return null;
  const wear = stack.dur === undefined ? 1 : 0.5 + 0.5 * Math.max(0, Math.min(100, stack.dur)) / 100;
  const out = {};
  for (const [id, n] of Object.entries(base)) {
    const v = Math.floor(n * count * wear);
    if (v > 0) out[id] = v;
  }
  return Object.keys(out).length ? out : null;
}

export const RECIPES = [
  { out: 'bandage', n: 2, cost: { fabric: 3 } },
  { out: 'med_kit', n: 1, cost: { fabric: 3, chemicals: 2 } },
  { out: 'shield_cell', n: 1, cost: { battery: 1, wires: 2 } },
  { out: 'frag', n: 1, cost: { chemicals: 3, scrap: 2 } },
  { out: 'ammo_light', n: 30, cost: { scrap: 2, chemicals: 1 } },
  { out: 'ammo_medium', n: 25, cost: { scrap: 3, chemicals: 1 } },
  { out: 'ammo_heavy', n: 10, cost: { scrap: 3, chemicals: 2, husk_plating: 1 } },
  { out: 'ammo_shotgun', n: 10, cost: { scrap: 2, plastic: 2, chemicals: 1 } },
  { out: 'shield_light', n: 1, cost: { husk_plating: 2, fabric: 4, wires: 1 } },
  { out: 'shield_medium', n: 1, cost: { husk_plating: 5, husk_circuit: 2, battery: 2 } },
  { out: 'shield_heavy', n: 1, cost: { husk_plating: 8, husk_circuit: 4, husk_heart: 1 } },
  { out: 'sparrow', n: 1, cost: { scrap: 10, rubber: 4, plastic: 4 } },
  { out: 'badger', n: 1, cost: { scrap: 14, rubber: 6, wires: 3 } },
  { out: 'hammerhead', n: 1, cost: { scrap: 12, husk_plating: 4, wires: 4 } },
  { out: 'boar', n: 1, cost: { scrap: 14, rubber: 6, husk_plating: 3 } },
  { out: 'heron', n: 1, cost: { scrap: 18, husk_plating: 8, husk_circuit: 3, husk_heart: 1 } },
];

export const FREE_KIT = {
  weapons: [{ id: 'mule', n: 1, mag: 18 }, null],
  shield: { id: 'shield_light', n: 1, charge: 40 },
  bag: [{ id: 'ammo_light', n: 60 }, { id: 'bandage', n: 3 }],
};

// Where you can deploy. All three are the Dustline under different
// conditions: lighting, how far Husks see, how many there are, and how rich
// the loot is.
export const MAPS = [
  {
    id: 'golden', name: 'The Dustline', when: 'Golden Hour', tag: 'Standard',
    desc: 'Warm, dusty light over the ruined town. Good visibility, standard Husk patrols, standard loot.',
    fog: 0xd9b48f, fogDensity: 0.0065, sky: [[0.93, 0.74, 0.55], [0.7, 0.72, 0.72], [0.33, 0.5, 0.62]],
    sun: 0xffd2a0, sunI: 2.6, sunDir: [-0.55, 0.42, 0.72], hemi: 0xffe2c0, hemiI: 0.7, env: 0.7, exposure: 1.05,
    husks: 1, loot: 1, sight: 1, headlamp: false,
  },
  {
    id: 'night', name: 'The Dustline', when: 'Night Raid', tag: 'More Husks · richer loot',
    desc: 'Moonlight and a headlamp. Husks see less in the dark, but there are more of them, and the loot runs richer.',
    fog: 0x141c2a, fogDensity: 0.012, sky: [[0.12, 0.16, 0.25], [0.06, 0.08, 0.14], [0.02, 0.03, 0.07]],
    sun: 0x9fb4ff, sunI: 0.6, sunDir: [0.35, 0.6, -0.55], hemi: 0x5a6a90, hemiI: 0.35, env: 0.22, exposure: 1.3,
    husks: 1.35, loot: 1.4, sight: 0.7, headlamp: true,
  },
  {
    id: 'storm', name: 'The Dustline', when: 'Dust Storm', tag: 'Low visibility · more loot',
    desc: 'A wall of grit cuts sight to a few dozen metres for you and the Husks alike. Fights happen up close.',
    fog: 0xb98a5a, fogDensity: 0.026, sky: [[0.75, 0.55, 0.38], [0.68, 0.52, 0.38], [0.55, 0.42, 0.32]],
    sun: 0xffc890, sunI: 1.2, sunDir: [-0.3, 0.5, 0.6], hemi: 0xffd8b0, hemiI: 0.85, env: 0.5, exposure: 1.0,
    husks: 1, loot: 1.2, sight: 0.5, headlamp: false,
  },
];
