import { buildPayload, lastDeliveryOf, sendWebhook } from './notify.js';
import { Router } from 'express';
import { config } from './config.js';
import { requireAuth } from './auth.js';
import { pool } from './db.js';
import { invalidate, nearest, scoreOf } from './match.js';
import {
  HttpError,
  cleanText,
  hhmmToMinutes,
  isUniqueViolation,
  localMinutes,
  mergeSettings,
  parseDescriptor,
  parseDescriptors,
  parsePhoto,
  todayStr,
  validateSettings,
} from './util.js';

export const companyRouter = Router();
companyRouter.use(requireAuth('company'));

const cid = (req) => req.user.cid;
const DAY = (n) => `a.ts >= (${n}::date::timestamp AT TIME ZONE $2) AND a.ts < (${n}::date::timestamp AT TIME ZONE $2) + interval '1 day'`;

async function getCompany(companyId) {
  const { rows } = await pool.query('SELECT id, name, max_participants, settings FROM companies WHERE id = $1', [companyId]);
  if (!rows[0]) throw new HttpError(404, 'Company not found');
  return { ...rows[0], settings: mergeSettings(rows[0].settings) };
}

// ---------------------------------------------------------------- settings
companyRouter.get('/settings', async (req, res) => {
  const c = await getCompany(cid(req));
  res.json({ company: { id: c.id, name: c.name, max_participants: c.max_participants }, settings: c.settings });
});

companyRouter.put('/settings', async (req, res) => {
  const patch = validateSettings(req.body || {});
  const c = await getCompany(cid(req));
  const merged = { ...c.settings, ...patch };
  await pool.query('UPDATE companies SET settings = $1 WHERE id = $2', [merged, c.id]);
  res.json({ settings: merged });
});

// Sends a sample message to the n8n webhook so the admin can check the connection.
companyRouter.post('/webhook-test', async (req, res) => {
  const c = await getCompany(cid(req));
  if (!c.settings.n8n_url) throw new HttpError(400, 'Save a webhook URL first');
  const g = await pool.query(`SELECT notify_group FROM participants WHERE company_id = $1 AND notify_group <> '' ORDER BY id LIMIT 1`, [c.id]);
  const sample = { id: 0, name: 'Test Person', code: 'T-1', department: 'Demo', notify_group: g.rows[0]?.notify_group || 'Test group', time_out: null, company_name: c.name };
  const kind = req.body?.event === 'check_out' ? 'check_out' : 'check_in';
  const payload = await buildPayload({ event: kind, participant: sample, ts: new Date(), status: 'late', dueIn: c.settings.work_start });
  payload.totals = { present_days: 11, on_time_days: 5, late_days: 6 };
  payload.message = (await import('./notify.js')).buildMessage(payload);
  payload.test = true;
  res.json({ delivery: await sendWebhook(c.id, c.settings, payload), sent: payload });
});

companyRouter.get('/webhook-status', (req, res) => res.json({ last: lastDeliveryOf(cid(req)) }));

// ------------------------------------------------------------ participants
const PARTICIPANT_COLS = `p.id, p.code, p.name, p.department, p.time_in, p.time_out, p.notify_group, p.phone, p.email, p.notes, p.photo, p.active, p.consent_at, p.created_at,
  (SELECT count(*) FROM face_templates f WHERE f.participant_id = p.id)::int AS faces`;

companyRouter.get('/participants', async (req, res) => {
  const { rows } = await pool.query(`SELECT ${PARTICIPANT_COLS} FROM participants p WHERE p.company_id = $1 ORDER BY lower(p.name)`, [cid(req)]);
  res.json({ participants: rows });
});

function participantFields(b, { partial = false } = {}) {
  const f = {};
  if (!partial || b.name !== undefined) {
    f.name = cleanText(b.name, 120);
    if (!f.name) throw new HttpError(400, 'Name is required');
  }
  if (b.code !== undefined) f.code = cleanText(b.code, 60) || null;
  for (const [k, max] of [['department', 100], ['phone', 40], ['email', 160], ['notes', 500]]) {
    if (b[k] !== undefined) f[k] = cleanText(b[k], max);
  }
  for (const k of ['time_in', 'time_out']) {
    if (b[k] === undefined) continue;
    const t = String(b[k] || '').trim();
    if (t && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) throw new HttpError(400, `${k === 'time_in' ? 'Time in' : 'Time out'} must look like 09:00`);
    f[k] = t || null; // empty = not set (time in then falls back to the company default)
  }
  if (b.notify_group !== undefined) f.notify_group = cleanText(b.notify_group, 120);
  if (b.active !== undefined) f.active = !!b.active;
  return f;
}

// Refuse to enrol a face that already belongs to someone else (unless the operator confirms with force).
async function assertNoDuplicateFace(companyId, descriptors, { excludeId, force }) {
  if (force) return;
  for (const d of descriptors) {
    const { best } = await nearest(companyId, d, { excludeId });
    if (best && best.distance < 0.42) {
      const { rows } = await pool.query('SELECT id, name FROM participants WHERE id = $1', [best.pid]);
      throw new HttpError(409, `This face already looks like "${rows[0]?.name}"`, { duplicate: rows[0] });
    }
  }
}

async function replaceTemplates(client, companyId, participantId, descriptors) {
  await client.query('DELETE FROM face_templates WHERE participant_id = $1', [participantId]);
  for (const d of descriptors) {
    await client.query('INSERT INTO face_templates (company_id, participant_id, descriptor) VALUES ($1,$2,$3)', [companyId, participantId, d]);
  }
}

companyRouter.post('/participants', async (req, res) => {
  const companyId = cid(req);
  const b = req.body || {};
  const f = participantFields(b);
  const photo = parsePhoto(b.photo);
  const descriptors = b.descriptors?.length ? parseDescriptors(b.descriptors, { min: 1, max: 8 }) : [];
  if (descriptors.length && !b.consent) throw new HttpError(400, 'Consent to face enrolment is required');

  const company = await getCompany(companyId);
  const count = (await pool.query('SELECT count(*)::int AS n FROM participants WHERE company_id = $1', [companyId])).rows[0].n;
  if (count >= company.max_participants) throw new HttpError(403, `Participant limit reached (${company.max_participants})`);
  await assertNoDuplicateFace(companyId, descriptors, { force: b.force });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO participants (company_id, code, name, department, time_in, time_out, notify_group, phone, email, notes, photo, consent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [companyId, f.code ?? null, f.name, f.department ?? '', f.time_in ?? null, f.time_out ?? null, f.notify_group ?? '', f.phone ?? '', f.email ?? '', f.notes ?? '', photo, descriptors.length ? new Date() : null],
    );
    await replaceTemplates(client, companyId, r.rows[0].id, descriptors);
    await client.query('COMMIT');
    invalidate(companyId);
    const row = (await pool.query(`SELECT ${PARTICIPANT_COLS} FROM participants p WHERE p.id = $1`, [r.rows[0].id])).rows[0];
    res.status(201).json({ participant: row });
  } catch (e) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(e)) throw new HttpError(409, 'That ID is already used by another participant');
    throw e;
  } finally {
    client.release();
  }
});

companyRouter.put('/participants/:id', async (req, res) => {
  const companyId = cid(req);
  const id = Number(req.params.id);
  const b = req.body || {};
  const own = await pool.query('SELECT id FROM participants WHERE id = $1 AND company_id = $2', [id, companyId]);
  if (!own.rowCount) throw new HttpError(404, 'Participant not found');

  const f = participantFields(b, { partial: true });
  const descriptors = b.descriptors?.length ? parseDescriptors(b.descriptors, { min: 1, max: 8 }) : null;
  if (descriptors && !b.consent) throw new HttpError(400, 'Consent to face enrolment is required');
  await assertNoDuplicateFace(companyId, descriptors || [], { excludeId: id, force: b.force });

  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(f)) {
    vals.push(v);
    sets.push(`${k} = $${vals.length}`);
  }
  if (b.photo !== undefined) {
    vals.push(parsePhoto(b.photo));
    sets.push(`photo = $${vals.length}`);
  }
  if (descriptors) sets.push('consent_at = now()');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (sets.length) {
      vals.push(id);
      await client.query(`UPDATE participants SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    }
    if (descriptors) await replaceTemplates(client, companyId, id, descriptors);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(e)) throw new HttpError(409, 'That ID is already used by another participant');
    throw e;
  } finally {
    client.release();
  }
  invalidate(companyId);
  const row = (await pool.query(`SELECT ${PARTICIPANT_COLS} FROM participants p WHERE p.id = $1`, [id])).rows[0];
  res.json({ participant: row });
});

companyRouter.delete('/participants/:id', async (req, res) => {
  const r = await pool.query('DELETE FROM participants WHERE id = $1 AND company_id = $2', [Number(req.params.id), cid(req)]);
  if (!r.rowCount) throw new HttpError(404, 'Participant not found');
  invalidate(cid(req));
  res.json({ ok: true });
});

// Removes only the face data of a person (privacy: "forget my face"), keeping the record.
companyRouter.delete('/participants/:id/face', async (req, res) => {
  const id = Number(req.params.id);
  const own = await pool.query('SELECT id FROM participants WHERE id = $1 AND company_id = $2', [id, cid(req)]);
  if (!own.rowCount) throw new HttpError(404, 'Participant not found');
  await pool.query('DELETE FROM face_templates WHERE participant_id = $1', [id]);
  await pool.query('UPDATE participants SET photo = NULL, consent_at = NULL WHERE id = $1', [id]);
  invalidate(cid(req));
  res.json({ ok: true });
});

// ------------------------------------------------------------------ verify
companyRouter.post('/verify', async (req, res) => {
  const companyId = cid(req);
  const descriptor = parseDescriptor(req.body?.descriptor);
  const liveness = !!req.body?.liveness;
  const company = await getCompany(companyId);
  const s = company.settings;

  const { best, second } = await nearest(companyId, descriptor);
  const unknown = () => res.json({ result: 'unknown', distance: best?.distance ?? null });
  if (!best || best.distance > s.threshold) return unknown();
  // Two different people almost equally close = refuse rather than guess.
  if (second && second.distance - best.distance < 0.03 && best.distance > s.threshold * 0.85) {
    return res.json({ result: 'unknown', ambiguous: true, distance: best.distance });
  }

  const p = (await pool.query('SELECT id, name, code, department, photo, time_in, time_out, notify_group FROM participants WHERE id = $1', [best.pid])).rows[0];
  const date = todayStr();
  const last = (
    await pool.query(
      `SELECT a.id, a.kind, a.ts, extract(epoch from (now() - a.ts)) AS age
         FROM attendance a WHERE a.participant_id = $1 AND ${DAY('$3')} ORDER BY a.ts DESC LIMIT 1`,
      [p.id, config.tz, date],
    )
  ).rows[0];

  const score = scoreOf(best.distance, s.threshold);
  if (last && last.age < s.repeat_gap_sec) {
    return res.json({ result: 'repeat', participant: p, kind: last.kind, ts: last.ts, score, ago: Math.round(last.age) });
  }

  const kind = !last || last.kind === 'out' ? 'in' : 'out';
  let status = 'present';
  if (kind === 'in' && !last) {
    // First check-in of the day: late if after this person's allocated time in (or the company default) + grace.
    status = localMinutes() > hhmmToMinutes(p.time_in || s.work_start) + s.grace_min ? 'late' : 'present';
  }
  const ins = await pool.query(
    `INSERT INTO attendance (company_id, participant_id, kind, status, distance, liveness) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, ts`,
    [companyId, p.id, kind, status, best.distance, liveness],
  );
  res.json({ result: 'matched', due: p.time_in || s.work_start, grace: s.grace_min, participant: p, kind, status, ts: ins.rows[0].ts, score, first_today: !last });

  // Tell n8n (after answering the kiosk, so a slow webhook never delays the tablet).
  // Message 1: the first check-in of the day.  Message 2: every check-out.
  if (s.n8n_url && (kind === 'out' || !last)) {
    buildPayload({ event: kind === 'in' ? 'check_in' : 'check_out', participant: { ...p, company_name: company.name }, ts: ins.rows[0].ts, status, dueIn: p.time_in || s.work_start })
      .then((payload) => sendWebhook(companyId, s, payload))
      .catch((e) => console.error('[n8n]', e.message));
  }
});

// -------------------------------------------------------------- attendance
function dateParam(q) {
  const d = String(q || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayStr();
}

companyRouter.get('/attendance', async (req, res) => {
  const companyId = cid(req);
  const date = dateParam(req.query.date);
  const events = (
    await pool.query(
      `SELECT a.id, a.ts, a.kind, a.status, a.distance, a.liveness, a.source, p.id AS participant_id, p.name, p.code, p.department, p.time_in
         FROM attendance a JOIN participants p ON p.id = a.participant_id
        WHERE a.company_id = $1 AND ${DAY('$3')} ORDER BY a.ts DESC`,
      [companyId, config.tz, date],
    )
  ).rows;
  const people = (await pool.query('SELECT id, name, code, department FROM participants WHERE company_id = $1 AND active ORDER BY lower(name)', [companyId])).rows;

  const first = new Map(); // participant -> earliest event
  const lastKind = new Map();
  for (const e of [...events].reverse()) {
    if (!first.has(e.participant_id)) first.set(e.participant_id, e);
    lastKind.set(e.participant_id, e.kind);
  }
  const present = people.filter((p) => first.has(p.id));
  const absent = people.filter((p) => !first.has(p.id));
  const late = present.filter((p) => first.get(p.id).status === 'late');
  const stillIn = present.filter((p) => lastKind.get(p.id) === 'in');
  const cfg = (await getCompany(companyId)).settings;
  res.json({
    date,
    config: { default_in: cfg.work_start, grace_min: cfg.grace_min },
    summary: { total: people.length, present: present.length, late: late.length, absent: absent.length, still_in: stillIn.length },
    events,
    absent,
  });
});

companyRouter.get('/summary', async (req, res) => {
  const companyId = cid(req);
  const r = await pool.query(
    `SELECT (SELECT count(*) FROM participants WHERE company_id=$1 AND active)::int AS total,
            (SELECT count(DISTINCT a.participant_id) FROM attendance a WHERE a.company_id=$1 AND ${DAY('$3')})::int AS present`,
    [companyId, config.tz, todayStr()],
  );
  res.json(r.rows[0]);
});
