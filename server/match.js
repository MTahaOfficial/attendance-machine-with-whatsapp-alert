import { pool } from './db.js';

// Per-company in-memory cache of face templates. ~100 people x 3 samples is tiny, so a plain
// brute-force comparison takes well under a millisecond - no vector index needed.
const cache = new Map(); // companyId -> [{ pid, d: Float32Array }]

export function invalidate(companyId) {
  cache.delete(companyId);
}

async function load(companyId) {
  const hit = cache.get(companyId);
  if (hit) return hit;
  const { rows } = await pool.query(
    `SELECT f.participant_id AS pid, f.descriptor AS d
       FROM face_templates f JOIN participants p ON p.id = f.participant_id
      WHERE f.company_id = $1 AND p.active`,
    [companyId],
  );
  const list = rows.map((r) => ({ pid: r.pid, d: Float32Array.from(r.d) }));
  cache.set(companyId, list);
  return list;
}

export function distance(a, b) {
  let s = 0;
  for (let i = 0; i < 128; i++) {
    const x = a[i] - b[i];
    s += x * x;
  }
  return Math.sqrt(s);
}

/** Nearest participant (and runner-up) to a descriptor, using each person's closest sample. */
export async function nearest(companyId, descriptor, { excludeId } = {}) {
  const list = await load(companyId);
  const best = new Map(); // pid -> min distance
  for (const t of list) {
    if (t.pid === excludeId) continue;
    const d = distance(descriptor, t.d);
    if (!best.has(t.pid) || d < best.get(t.pid)) best.set(t.pid, d);
  }
  const ranked = [...best.entries()].map(([pid, d]) => ({ pid, distance: d })).sort((a, b) => a.distance - b.distance);
  return { best: ranked[0] || null, second: ranked[1] || null };
}

/** Human-friendly 0-100 score centred on the acceptance threshold. */
export function scoreOf(distanceValue, threshold) {
  return Math.round(100 / (1 + Math.exp(12 * (distanceValue - threshold))));
}
