// Small seeded RNG so the map is the same every raid.

export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => Math.floor(a + (b - a + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

// Weighted roll from [id, weight, min, max] entries.
export function rollTable(table, rng = Math) {
  const rand = rng.next ? rng.next : Math.random;
  const out = [];
  const total = table.entries.reduce((sum, e) => sum + e[1], 0);
  const rolls = table.rolls[0] + Math.floor(rand() * (table.rolls[1] - table.rolls[0] + 1));
  for (let i = 0; i < rolls; i++) {
    let r = rand() * total;
    for (const [id, weight, min, max] of table.entries) {
      r -= weight;
      if (r <= 0) {
        const n = min + Math.floor(rand() * (max - min + 1));
        const existing = out.find((s) => s.id === id);
        if (existing && existing.n + n <= 999) existing.n += n;
        else out.push({ id, n });
        break;
      }
    }
  }
  return out;
}
