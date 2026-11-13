import { config } from './config.js';
import { hashPassword } from './auth.js';
import { pool } from './db.js';
import { invalidate } from './match.js';
import { HttpError, cleanText, hhmmToMinutes, isUniqueViolation, mergeSettings, todayStr } from './util.js';

const FIRST = [
  'Ali', 'Ayesha', 'Ahmed', 'Fatima', 'Hassan', 'Zainab', 'Usman', 'Maryam', 'Bilal', 'Hira', 'Omar', 'Sana',
  'Hamza', 'Noor', 'Saad', 'Iqra', 'Faisal', 'Amna', 'Daniyal', 'Mahnoor', 'Talha', 'Rabia', 'Kamran', 'Laiba',
  'Asad', 'Khadija', 'Imran', 'Areeba', 'Shahid', 'Zara', 'Waqas', 'Anum', 'Junaid', 'Sidra', 'Arslan', 'Mehwish',
];
const LAST = [
  'Khan', 'Ahmed', 'Malik', 'Sheikh', 'Siddiqui', 'Qureshi', 'Hussain', 'Raza', 'Butt', 'Mirza', 'Ansari', 'Chaudhry',
  'Farooqui', 'Baig', 'Iqbal', 'Memon', 'Shah', 'Javed', 'Rehman', 'Haider',
];
const DEPARTMENTS = ['Sales', 'Finance', 'Engineering', 'HR', 'Operations', 'Marketing', 'Support', 'Logistics'];

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];

export async function createCompany({ name, max_participants = 200, admin_name = '', admin_email, admin_password }) {
  name = cleanText(name, 120);
  admin_email = cleanText(admin_email, 200).toLowerCase();
  if (!name) throw new HttpError(400, 'Company name is required');
  if (!/^\S+@\S+\.\S+$/.test(admin_email)) throw new HttpError(400, 'A valid admin email is required');
  if (String(admin_password || '').length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  const max = Math.max(1, Math.min(5000, Number(max_participants) || 200));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query('INSERT INTO companies (name, max_participants) VALUES ($1,$2) RETURNING *', [name, max]);
    await client.query(
      `INSERT INTO users (company_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,'company')`,
      [c.rows[0].id, cleanText(admin_name, 120) || `${name} admin`, admin_email, hashPassword(admin_password)],
    );
    await client.query('COMMIT');
    return c.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(e)) throw new HttpError(409, 'That admin email is already in use');
    throw e;
  } finally {
    client.release();
  }
}

/** Adds fake participants (names only, no faces) so a demo company looks populated. */
export async function addDemoParticipants(companyId, count = 100) {
  const { rows } = await pool.query(
    `SELECT c.max_participants, (SELECT count(*) FROM participants WHERE company_id = c.id)::int AS n
       FROM companies c WHERE c.id = $1`,
    [companyId],
  );
  if (!rows[0]) throw new HttpError(404, 'Company not found');
  const room = rows[0].max_participants - rows[0].n;
  const todo = Math.max(0, Math.min(Number(count) || 0, room, 500));
  const used = new Set((await pool.query('SELECT lower(name) AS n FROM participants WHERE company_id=$1', [companyId])).rows.map((r) => r.n));
  let seq = rows[0].n;
  let added = 0;
  for (let i = 0; i < todo * 4 && added < todo; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    if (used.has(name.toLowerCase())) continue;
    used.add(name.toLowerCase());
    seq++;
    const code = `EMP-${String(seq).padStart(3, '0')}`;
    try {
      await pool.query(
        `INSERT INTO participants (company_id, code, name, department, email) VALUES ($1,$2,$3,$4,$5)`,
        [companyId, code, name, pick(DEPARTMENTS), `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`],
      );
      added++;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  return { added };
}

/** Fills today's attendance with plausible check-ins (flagged source='demo') for people who have none yet. */
export async function simulateDay(companyId) {
  const co = (await pool.query('SELECT settings FROM companies WHERE id=$1', [companyId])).rows[0];
  if (!co) throw new HttpError(404, 'Company not found');
  const s = mergeSettings(co.settings);
  const date = todayStr();
  const { rows: people } = await pool.query(
    `SELECT p.id, p.time_in FROM participants p
      WHERE p.company_id = $1 AND p.active
        AND NOT EXISTS (
          SELECT 1 FROM attendance a WHERE a.participant_id = p.id
            AND a.ts >= ($2::date::timestamp AT TIME ZONE $3) AND a.ts < ($2::date::timestamp AT TIME ZONE $3) + interval '1 day')`,
    [companyId, date, config.tz],
  );
  let made = 0;
  for (const p of people) {
    const due = hhmmToMinutes(p.time_in || s.work_start);
    const lateAfter = due + s.grace_min;
    const startMin = due - 35;
    if (Math.random() > 0.82) continue; // ~18% absent
    const minute = startMin + Math.round(Math.abs((Math.random() + Math.random() + Math.random()) / 3 - 0.35) * 150);
    const late = minute > lateAfter;
    await pool.query(
      `INSERT INTO attendance (company_id, participant_id, kind, status, distance, liveness, source, ts)
       VALUES ($1,$2,'in',$3,$4,true,'demo',
         LEAST(($5::date::timestamp + ($6 || ' minutes')::interval) AT TIME ZONE $7, now() - ($8 || ' seconds')::interval))`,
      [companyId, p.id, late ? 'late' : 'present', 0.25 + Math.random() * 0.1, date, String(minute), config.tz, String(rnd(600))],
    );
    made++;
  }
  invalidate(companyId);
  return { created: made };
}
