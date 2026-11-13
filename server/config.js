import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.js';

// `npm run db:embedded` writes the URL it ended up using (it moves to another port if 5432 is taken).
function embeddedUrl() {
  try {
    return fs.readFileSync(path.join(DATA_DIR, 'embedded-url.txt'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export const DATA_DIR = path.join(ROOT, 'server', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// A stable signing secret so logins survive a restart (unless JWT_SECRET is provided).
function jwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const f = path.join(DATA_DIR, 'jwt.secret');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s);
  return s;
}

export const config = {
  httpPort: Number(process.env.PORT) || 4000,
  httpsPort: Number(process.env.HTTPS_PORT) || 4443,
  https: process.env.HTTPS !== '0',
  databaseUrl: process.env.DATABASE_URL || embeddedUrl() || 'postgres://postgres:postgres@localhost:5432/meridian',
  jwtSecret: jwtSecret(),
  adminEmail: process.env.ADMIN_EMAIL || 'admin@meridian.local',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  tz: process.env.APP_TZ || 'Asia/Karachi',
  distDir: path.join(ROOT, 'dist'),
};

export const DEFAULT_SETTINGS = {
  threshold: 0.5, // max face distance to accept a match (lower = stricter)
  repeat_gap_sec: 20, // ignore a second scan of the same person within this window
  work_start: '09:00', // first check-in after start + grace is "late"
  grace_min: 10,
  voice: false, // spoken greeting on the kiosk
  n8n_url: '', // webhook that receives every check-in / check-out (empty = off)
  n8n_secret: '', // optional, sent as the X-Meridian-Secret header
};
