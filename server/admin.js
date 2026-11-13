import os from 'node:os';
import { Router } from 'express';
import QRCode from 'qrcode';
import { config } from './config.js';
import { hashPassword, requireAuth } from './auth.js';
import { pool } from './db.js';
import { invalidate } from './match.js';
import { addDemoParticipants, createCompany, simulateDay } from './services.js';
import { HttpError, cleanText, todayStr } from './util.js';

export const adminRouter = Router();
adminRouter.use(requireAuth('superadmin'));

const TODAY_RANGE = `a.ts >= ($1::date::timestamp AT TIME ZONE $2) AND a.ts < ($1::date::timestamp AT TIME ZONE $2) + interval '1 day'`;

adminRouter.get('/overview', async (_req, res) => {
  const date = todayStr();
  const companies = await pool.query(
    `SELECT c.id, c.name, c.active, c.max_participants, c.created_at,
            (SELECT u.email FROM users u WHERE u.company_id = c.id ORDER BY u.id LIMIT 1) AS admin_email,
            (SELECT count(*) FROM participants p WHERE p.company_id = c.id)::int AS participants,
            (SELECT count(DISTINCT f.participant_id) FROM face_templates f WHERE f.company_id = c.id)::int AS enrolled,
            (SELECT count(*) FROM attendance a WHERE a.company_id = c.id AND ${TODAY_RANGE})::int AS events_today
       FROM companies c ORDER BY c.created_at DESC`,
    [date, config.tz],
  );
  const recent = await pool.query(
    `SELECT a.id, a.ts, a.kind, a.status, a.source, p.name, p.department, c.name AS company
       FROM attendance a JOIN participants p ON p.id = a.participant_id JOIN companies c ON c.id = a.company_id
      ORDER BY a.ts DESC LIMIT 20`,
  );
  const rows = companies.rows;
  res.json({
    totals: {
      companies: rows.length,
      participants: rows.reduce((s, c) => s + c.participants, 0),
      enrolled: rows.reduce((s, c) => s + c.enrolled, 0),
      events_today: rows.reduce((s, c) => s + c.events_today, 0),
    },
    companies: rows,
    recent: recent.rows,
  });
});

adminRouter.post('/companies', async (req, res) => {
  const b = req.body || {};
  const c = await createCompany(b);
  res.status(201).json({ company: c });
});

adminRouter.patch('/companies/:id', async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const sets = [];
  const vals = [];
  const add = (col, v) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };
  if (b.name !== undefined) add('name', cleanText(b.name, 120) || (() => { throw new HttpError(400, 'Name required'); })());
  if (b.active !== undefined) add('active', !!b.active);
  if (b.max_participants !== undefined) add('max_participants', Math.max(1, Math.min(5000, Number(b.max_participants) || 200)));
  if (sets.length) {
    vals.push(id);
    const r = await pool.query(`UPDATE companies SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    if (!r.rowCount) throw new HttpError(404, 'Company not found');
  }
  if (b.admin_password) {
    if (String(b.admin_password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
    await pool.query(`UPDATE users SET password_hash = $1 WHERE company_id = $2`, [hashPassword(b.admin_password), id]);
  }
  res.json({ ok: true });
});

adminRouter.delete('/companies/:id', async (req, res) => {
  const id = Number(req.params.id);
  await pool.query('DELETE FROM companies WHERE id = $1', [id]);
  invalidate(id);
  res.json({ ok: true });
});

adminRouter.post('/companies/:id/demo-participants', async (req, res) => {
  res.json(await addDemoParticipants(Number(req.params.id), req.body?.count ?? 100));
});

adminRouter.post('/companies/:id/simulate', async (req, res) => {
  res.json(await simulateDay(Number(req.params.id)));
});

adminRouter.post('/companies/:id/reset-attendance', async (req, res) => {
  const r = await pool.query('DELETE FROM attendance WHERE company_id = $1', [Number(req.params.id)]);
  res.json({ deleted: r.rowCount });
});

// Wipes every participant (and their face data) of a company but keeps the company + login.
adminRouter.post('/companies/:id/clear-participants', async (req, res) => {
  const id = Number(req.params.id);
  const r = await pool.query('DELETE FROM participants WHERE company_id = $1', [id]);
  invalidate(id);
  res.json({ deleted: r.rowCount });
});

// Addresses the company tablet can open (HTTPS is required for the camera on anything but localhost).
adminRouter.get('/access', async (_req, res) => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  }
  const urls = [];
  for (const ip of ips) {
    if (config.https) urls.push({ label: `Tablet (HTTPS, camera works) - ${ip}`, url: `https://${ip}:${config.httpsPort}`, camera: true });
    urls.push({ label: `Plain HTTP - ${ip} (no camera on tablets)`, url: `http://${ip}:${config.httpPort}`, camera: false });
  }
  for (const u of urls) {
    u.qr = u.camera ? await QRCode.toDataURL(u.url, { margin: 1, width: 220 }) : null;
  }
  res.json({ urls });
});
