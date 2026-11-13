import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { config } from './config.js';
import { pool } from './db.js';
import { HttpError } from './util.js';

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10);

function sign(u) {
  return jwt.sign({ uid: u.id, role: u.role, cid: u.company_id || null }, config.jwtSecret, { expiresIn: '12h' });
}

/** Requires a valid login of the given role ('superadmin' | 'company'). */
export function requireAuth(role) {
  return async (req, _res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new HttpError(401, 'Not signed in');
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw new HttpError(401, 'Session expired, please sign in again');
    }
    if (role && payload.role !== role) throw new HttpError(403, 'Not allowed');
    if (payload.role === 'company') {
      const { rows } = await pool.query('SELECT active FROM companies WHERE id = $1', [payload.cid]);
      if (!rows[0]) throw new HttpError(401, 'Company no longer exists');
      if (!rows[0].active) throw new HttpError(403, 'This company account is disabled');
    }
    req.user = payload;
    next();
  };
}

// Very small brute-force guard: after 10 FAILED sign-ins in a minute, an IP must wait.
const failures = new Map();
const recentFailures = (ip) => (failures.get(ip) || []).filter((t) => Date.now() - t < 60_000);
const limited = (ip) => recentFailures(ip).length >= 10;
function recordFailure(ip) {
  failures.set(ip, [...recentFailures(ip), Date.now()]);
}

async function profile(userId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.company_id, c.name AS company_name, c.active
       FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = $1`,
    [userId],
  );
  const u = rows[0];
  if (!u) throw new HttpError(401, 'Account not found');
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    company: u.company_id ? { id: u.company_id, name: u.company_name } : null,
  };
}

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  if (limited(req.ip)) throw new HttpError(429, 'Too many attempts, wait a minute');
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  const { rows } = await pool.query(
    `SELECT u.*, c.active AS company_active FROM users u LEFT JOIN companies c ON c.id = u.company_id
      WHERE lower(u.email) = lower($1)`,
    [email],
  );
  const u = rows[0];
  if (!u || !bcrypt.compareSync(password, u.password_hash)) {
    recordFailure(req.ip);
    throw new HttpError(401, 'Wrong email or password');
  }
  if (u.role === 'company' && !u.company_active) throw new HttpError(403, 'This company account is disabled');
  res.json({ token: sign(u), user: await profile(u.id) });
});

authRouter.get('/me', requireAuth(), async (req, res) => {
  res.json({ user: await profile(req.user.uid) });
});
