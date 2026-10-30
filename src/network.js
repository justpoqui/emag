// The Husk Network: the machines' shared memory of this raider.
//
// Skitters, Buzzers and Watchers are neutral but cautious. Every raid they
// record what the raider does to them (first strikes, kills, where the shots
// land, how close or far the fights are, which pods get stripped) and what
// happens around them (where fighting breaks out, where they're left alone).
// Between raids that memory turns into:
//   - behaviour: how much room they want, how fast they lose patience, whether
//     they shoot first, eye shutters against crit-hunters, keeping their
//     distance from melee raiders, jinking against snipers;
//   - infrastructure: Bulwarks (barricades round a sentinel spire) where the
//     raider fights them, Cradles (pod nurseries, guarded) where they're left
//     in peace. The network builds more as raids go by.
// The memory lives in the profile, so it follows the raider's account.

import { MAP_HALF } from './collision.js';

export const ZONE = 60; // metres per memory zone
const MAX_ZONES = 100;

export function blankMemory() {
  return {
    raids: 0, seen: 0, peaceful: 0, provoked: 0, hits: 0, crits: 0,
    kills: {}, melee: 0, nades: 0, longKills: 0, closeKills: 0, pods: 0, wrecks: 0,
    zones: {}, // "zx,zz" -> [heat (fighting), calm (left in peace)]
  };
}

const num = (v, max = 1e7) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
};

// Clamp a saved memory to sane values (it comes from the player's save).
export function cleanMemory(m) {
  const out = blankMemory();
  if (!m || typeof m !== 'object') return out;
  for (const k of ['raids', 'seen', 'peaceful', 'provoked', 'hits', 'crits', 'melee', 'nades', 'longKills', 'closeKills', 'pods', 'wrecks']) out[k] = num(m[k]);
  if (m.kills && typeof m.kills === 'object') {
    for (const t of ['skitter', 'buzzer', 'watcher', 'pouncer', 'warden']) if (m.kills[t]) out.kills[t] = Math.floor(num(m.kills[t]));
  }
  if (m.zones && typeof m.zones === 'object') {
    for (const [k, v] of Object.entries(m.zones).slice(0, MAX_ZONES)) {
      if (!/^-?\d{1,2},-?\d{1,2}$/.test(k) || !Array.isArray(v)) continue;
      out.zones[k] = [num(v[0], 999), num(v[1], 999)];
    }
  }
  return out;
}

export function zoneKey(x, z) {
  return `${Math.floor(x / ZONE)},${Math.floor(z / ZONE)}`;
}

function zone(m, x, z) {
  const k = zoneKey(x, z);
  if (!m.zones[k]) {
    if (Object.keys(m.zones).length >= MAX_ZONES) return [0, 0];
    m.zones[k] = [0, 0];
  }
  return m.zones[k];
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;

// What the memory means for how they act. All 0..1 unless noted.
export function traits(m) {
  const kills = Object.values(m.kills).reduce((a, b) => a + b, 0);
  const enc = m.seen + 4;
  const aggression = clamp01((m.provoked + kills * 0.4) / enc); // how often this raider starts the fight
  const trust = clamp01(m.peaceful / enc) * (1 - aggression);
  const t = {
    aggression,
    trust,
    eyeGuard: clamp01(((m.crits + 1) / (m.hits + 30)) * 2.2 - 0.1), // they've learned you go for the eye
    keepAway: clamp01(((m.closeKills + m.melee * 0.3) / (kills + 6)) * 1.6), // ... that you fight up close
    jink: clamp01((m.longKills / (kills + 6)) * 1.6), // ... that you pick them off from range
    podGuard: clamp01(m.pods / (m.raids * 1.5 + 6)), // ... that you strip their pods
    growth: clamp01(m.raids / 20), // the network builds up over time
  };
  // derived numbers the Husks use directly
  t.space = lerp(4, 9, aggression) * (1 - trust * 0.4); // metres of room they want
  t.patience = lerp(2.6, 0.7, aggression); // seconds crowded before they attack
  t.shootFirst = aggression > 0.7; // they've learned not to wait
  t.rally = lerp(30, 75, aggression); // how far word of an attack spreads
  t.calm = lerp(12, 45, aggression); // seconds without trouble before a hostile Husk stands down
  return t;
}

// ---------- recording, during a raid ----------
export function recordSeen(m) {
  m.seen++;
}
export function recordPeace(m, x, z) {
  m.peaceful++;
  zone(m, x, z)[1] += 1;
}
export function recordProvoked(m, x, z) {
  m.provoked++;
  zone(m, x, z)[0] += 2;
}
export function recordHit(m, crit) {
  m.hits++;
  if (crit) m.crits++;
}
export function recordKill(m, type, x, z, dist, how) {
  m.kills[type] = (m.kills[type] || 0) + 1;
  if (dist > 35) m.longKills++;
  else if (dist < 6) m.closeKills++;
  if (how === 'melee') m.melee++;
  if (how === 'nade') m.nades++;
  zone(m, x, z)[0] += 1;
}
export function recordLoot(m, type) {
  if (type === 'husk_pod') m.pods++;
  if (type === 'wreck') m.wrecks++;
}
// a raid starts: old grudges fade a little
export function startRaidMemory(m) {
  m.raids++;
  for (const k of Object.keys(m.zones)) {
    const z = m.zones[k];
    z[0] *= 0.85;
    z[1] *= 0.9;
    if (z[0] + z[1] < 0.2) delete m.zones[k];
  }
}

// ---------- infrastructure ----------
// sites: [{x, z}] candidate build spots from the world. Returns
// [{site index, kind: 'bulwark' | 'cradle'}] for this raid.
export function planInfrastructure(m, sites) {
  const t = traits(m);
  const count = Math.round(1 + t.growth * 9);
  const scored = sites.map((s, i) => {
    const z = m.zones[zoneKey(s.x, s.z)] || [0, 0];
    return { i, heat: z[0], calm: z[1], r: Math.random() };
  });
  const out = [];
  const used = new Set();
  // fortify where the raider fights them, nurture where they're left alone
  const bulwarks = Math.round(count * (0.35 + t.aggression * 0.5));
  for (const s of [...scored].sort((a, b) => b.heat + b.r - (a.heat + a.r))) {
    if (out.length >= bulwarks) break;
    if (s.heat < 0.5 && out.length >= 1) break;
    out.push({ site: s.i, kind: 'bulwark' });
    used.add(s.i);
  }
  for (const s of [...scored].sort((a, b) => b.calm + b.r - (a.calm + a.r))) {
    if (out.length >= count) break;
    if (used.has(s.i)) continue;
    out.push({ site: s.i, kind: 'cradle' });
    used.add(s.i);
  }
  return out;
}

// Plain-language read-out for the Sanctuary.
export function describe(m) {
  const t = traits(m);
  const lines = [];
  const mood = t.shootFirst ? 'Hostile on sight' : t.aggression > 0.4 ? 'Wary of you' : t.trust > 0.3 ? 'Tolerant of you' : 'Cautious';
  if (m.raids === 0) lines.push('No contact yet. They will watch, and remember.');
  if (t.shootFirst) lines.push('They have learned you strike first, and now shoot on sight.');
  else if (t.aggression > 0.4) lines.push(`They keep about ${Math.round(t.space)} m away and lose patience quickly.`);
  else if (t.trust > 0.3) lines.push('They let you pass close by. Your restraint has been noticed.');
  if (t.eyeGuard > 0.35) lines.push(`Eye shutters fitted: critical hits do ${Math.round(t.eyeGuard * 35)}% less.`);
  if (t.keepAway > 0.35) lines.push('They keep out of stick range.');
  if (t.jink > 0.35) lines.push('Buzzers jink and weave against your long shots.');
  if (t.podGuard > 0.3) lines.push('Skitters now guard their pods.');
  const plan = Math.round(1 + t.growth * 9);
  lines.push(`Infrastructure: ${plan} structure${plan === 1 ? '' : 's'} topside (Bulwarks where you fight, Cradles where you don't).`);
  return { mood, lines, aggression: t.aggression, trust: t.trust, growth: t.growth };
}

export function inBounds(x, z) {
  return Math.abs(x) < MAP_HALF - 15 && Math.abs(z) < MAP_HALF - 15;
}
