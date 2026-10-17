// Static world collision: a heightfield terrain plus axis-aligned boxes in a
// spatial grid. Used for movement, line of sight and bullets.

const CELL = 8;

// Smooth value noise for the terrain.
function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function smooth(t) {
  return t * t * (3 - 2 * t);
}
function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export const MAP_HALF = 230;

export function terrainHeight(x, z) {
  let h = valueNoise(x / 60, z / 60) * 6 + valueNoise(x / 22, z / 22) * 1.6 + valueNoise(x / 7, z / 7) * 0.25;
  h -= 3.5;
  // flatten the town and the roads so buildings sit nicely
  const town = Math.max(0, 1 - Math.hypot(x + 20, z + 10) / 95);
  h *= 1 - Math.min(1, town * 1.8) * 0.85;
  // rise into hills at the edges so the map feels enclosed
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (edge > MAP_HALF - 40) {
    const t = (edge - (MAP_HALF - 40)) / 40;
    h += t * t * 30;
  }
  return h;
}

export class Collision {
  constructor() {
    this.boxes = [];
    this.grid = new Map();
    this.stamp = 0;
  }

  // min/max: {x,y,z}. Returns the box. tag lets bullets react (e.g. 'metal').
  addBox(min, max, tag) {
    const box = { min: { ...min }, max: { ...max }, tag, mark: 0 };
    this.boxes.push(box);
    const x0 = Math.floor(min.x / CELL);
    const x1 = Math.floor(max.x / CELL);
    const z0 = Math.floor(min.z / CELL);
    const z1 = Math.floor(max.z / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const key = ix * 100000 + iz;
        let cell = this.grid.get(key);
        if (!cell) {
          cell = [];
          this.grid.set(key, cell);
        }
        cell.push(box);
      }
    }
    return box;
  }

  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    this.stamp++;
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const cell = this.grid.get(ix * 100000 + iz);
        if (!cell) continue;
        for (const box of cell) {
          if (box.mark !== this.stamp) {
            box.mark = this.stamp;
            out.push(box);
          }
        }
      }
    }
    return out;
  }

  // Highest walkable surface under (x,z) that is at most `step` above feetY.
  groundHeight(x, z, feetY, radius = 0.3, step = 0.55) {
    let ground = terrainHeight(x, z);
    const r = radius * 0.6;
    const boxes = this.query(x - r, z - r, x + r, z + r, this._tmp || (this._tmp = []));
    for (const b of boxes) {
      if (x + r < b.min.x || x - r > b.max.x || z + r < b.min.z || z - r > b.max.z) continue;
      if (b.max.y <= feetY + step && b.max.y > ground) ground = b.max.y;
    }
    return ground;
  }

  // Push a vertical cylinder (feet position) out of boxes. Mutates pos.
  // Returns true if it collided with anything.
  resolveCylinder(pos, radius, height, step = 0.55) {
    let hit = false;
    const boxes = this.query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, this._tmp2 || (this._tmp2 = []));
    for (const b of boxes) {
      if (b.max.y <= pos.y + step || b.min.y >= pos.y + height) continue;
      const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
      let dx = pos.x - cx;
      let dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x += (dx / d) * (radius - d);
        pos.z += (dz / d) * (radius - d);
      } else {
        // centre is inside the box: push out along the smallest axis
        const left = pos.x - b.min.x;
        const right = b.max.x - pos.x;
        const back = pos.z - b.min.z;
        const front = b.max.z - pos.z;
        const m = Math.min(left, right, back, front);
        if (m === left) pos.x = b.min.x - radius;
        else if (m === right) pos.x = b.max.x + radius;
        else if (m === back) pos.z = b.min.z - radius;
        else pos.z = b.max.z + radius;
      }
    }
    return hit;
  }

  // Is there a ceiling above? Returns the lowest box bottom above y within radius, or Infinity.
  ceiling(x, z, y, radius) {
    let best = Infinity;
    const boxes = this.query(x - radius, z - radius, x + radius, z + radius, this._tmp3 || (this._tmp3 = []));
    for (const b of boxes) {
      if (x + radius * 0.6 < b.min.x || x - radius * 0.6 > b.max.x || z + radius * 0.6 < b.min.z || z - radius * 0.6 > b.max.z) continue;
      if (b.min.y >= y && b.min.y < best) best = b.min.y;
    }
    return best;
  }

  // Ray vs world. dir must be normalized. Returns { dist, normal, tag } or null.
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    let normal = null;
    let tag = null;
    const ex = ox + dx * maxDist;
    const ez = oz + dz * maxDist;
    const boxes = this.queryRay(ox, oz, ex, ez);
    for (const b of boxes) {
      const t = rayBox(ox, oy, oz, dx, dy, dz, b, best);
      if (t !== null && t < best) {
        best = t;
        normal = lastNormal.slice();
        tag = b.tag;
      }
    }
    // terrain: march then refine
    const step = 1.0;
    let prevT = 0;
    for (let t = step; t <= best + step; t += step) {
      const tt = Math.min(t, best);
      const y = oy + dy * tt;
      if (y < terrainHeight(ox + dx * tt, oz + dz * tt)) {
        let lo = prevT;
        let hi = tt;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          if (oy + dy * mid < terrainHeight(ox + dx * mid, oz + dz * mid)) hi = mid;
          else lo = mid;
        }
        if (hi < best) {
          best = hi;
          normal = [0, 1, 0];
          tag = 'ground';
        }
        break;
      }
      prevT = tt;
      if (tt >= best) break;
    }
    if (!normal) return null;
    return { dist: best, normal, tag };
  }

  // Boxes in the grid cells a 2D segment passes through.
  queryRay(x0, z0, x1, z1) {
    const out = this._rayOut || (this._rayOut = []);
    out.length = 0;
    this.stamp++;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.5)));
    let lastKey = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = Math.floor((x0 + (x1 - x0) * t) / CELL);
      const cz = Math.floor((z0 + (z1 - z0) * t) / CELL);
      // check a 3x3 neighbourhood the first time we enter a cell, so diagonal moves don't skip cells
      const key = cx * 100000 + cz;
      if (key === lastKey) continue;
      lastKey = key;
      for (let ax = -1; ax <= 1; ax++) {
        for (let az = -1; az <= 1; az++) {
          const cell = this.grid.get((cx + ax) * 100000 + (cz + az));
          if (!cell) continue;
          for (const box of cell) {
            if (box.mark !== this.stamp) {
              box.mark = this.stamp;
              out.push(box);
            }
          }
        }
      }
    }
    return out;
  }

  lineOfSight(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const hit = this.raycast(a.x, a.y, a.z, dx / d, dy / d, dz / d, d);
    return !hit || hit.dist >= d - 0.3;
  }
}

const lastNormal = [0, 0, 0];

function rayBox(ox, oy, oz, dx, dy, dz, b, maxT) {
  let tmin = 0;
  let tmax = maxT;
  let axis = -1;
  let sign = 0;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const mn = [b.min.x, b.min.y, b.min.z];
  const mx = [b.max.x, b.max.y, b.max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
    } else {
      const inv = 1 / d[i];
      let t1 = (mn[i] - o[i]) * inv;
      let t2 = (mx[i] - o[i]) * inv;
      let s = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        s = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        axis = i;
        sign = s;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  if (axis === -1) return null; // origin inside the box
  lastNormal[0] = 0;
  lastNormal[1] = 0;
  lastNormal[2] = 0;
  lastNormal[axis] = sign;
  return tmin;
}
