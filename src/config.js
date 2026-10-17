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
    spreadHip: 2.4, spreadAds: 0.35, recoil: 1.1, range: 140, pellets: 1, shape: 'rifle',
  },
  sparrow: {
    name: 'Sparrow', type: 'weapon', rarity: 'uncommon', value: 650, color: 0x4f6b6a,
    desc: 'Compact SMG. Shreds small Husks up close.',
    ammo: 'light', damage: 9, rpm: 820, auto: true, mag: 32, reload: 1.9,
    spreadHip: 3.0, spreadAds: 1.0, recoil: 0.55, range: 70, pellets: 1, shape: 'smg',
  },
  badger: {
    name: 'Badger', type: 'weapon', rarity: 'uncommon', value: 900, color: 0x6c5a3d,
    desc: 'Full-auto rifle on medium rounds. A good all-rounder.',
    ammo: 'medium', damage: 15, rpm: 600, auto: true, mag: 26, reload: 2.2,
    spreadHip: 2.6, spreadAds: 0.55, recoil: 0.85, range: 150, pellets: 1, shape: 'rifle',
  },
  hammerhead: {
    name: 'Hammerhead', type: 'weapon', rarity: 'rare', value: 1300, color: 0x3d3d44,
    desc: 'Heavy hand cannon. Punches through Husk plating.',
    ammo: 'heavy', damage: 52, rpm: 140, auto: false, mag: 6, reload: 2.4,
    spreadHip: 1.6, spreadAds: 0.25, recoil: 3.4, range: 120, pellets: 1, armorPierce: 0.6, shape: 'pistol',
  },
  boar: {
    name: 'Boar', type: 'weapon', rarity: 'rare', value: 1400, color: 0x7a3b2a,
    desc: 'Pump shotgun. Devastating up close, useless far away.',
    ammo: 'shotgun', damage: 11, rpm: 75, auto: false, mag: 5, reload: 2.8,
    spreadHip: 5.5, spreadAds: 4.0, recoil: 4.5, range: 35, pellets: 9, shape: 'shotgun',
  },
  heron: {
    name: 'Heron', type: 'weapon', rarity: 'epic', value: 2400, color: 0x2f3a46,
    desc: 'Break-action marksman rifle. One shell, one hole.',
    ammo: 'heavy', damage: 95, rpm: 55, auto: false, mag: 1, reload: 1.3,
    spreadHip: 3.5, spreadAds: 0.05, recoil: 6, range: 260, pellets: 1, armorPierce: 0.9, zoom: 2.2, shape: 'long',
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
  skitter: {
    name: 'Skitter', hp: 30, armor: 0, speed: 8.5, radius: 0.5, flying: false, sight: 38,
    attack: { kind: 'leap', range: 6, damage: 14, cooldown: 1.4 },
    drops: { rolls: [1, 2], entries: [['husk_plating', 10, 1, 1], ['scrap', 20, 1, 2], ['wires', 8, 1, 1]] }, xp: 10,
  },
  buzzer: {
    name: 'Buzzer', hp: 55, armor: 0.2, speed: 7, radius: 0.7, flying: true, hover: 7, sight: 60,
    attack: { kind: 'gun', range: 55, damage: 5, burst: 5, rate: 0.09, cooldown: 2.0, spread: 2.2 },
    drops: { rolls: [1, 2], entries: [['husk_plating', 20, 1, 2], ['battery', 10, 1, 1], ['husk_circuit', 4, 1, 1]] }, xp: 20,
  },
  watcher: {
    name: 'Watcher', hp: 40, armor: 0, speed: 6, radius: 0.6, flying: true, hover: 14, sight: 70,
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
