import pg from 'pg';
import { config } from './config.js';

// BIGINT / COUNT come back as numbers instead of strings.
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

export let pool;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  active           BOOLEAN NOT NULL DEFAULT true,
  max_participants INT NOT NULL DEFAULT 200,
  settings         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  company_id    INT REFERENCES companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('superadmin','company')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));

CREATE TABLE IF NOT EXISTS participants (
  id         SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code       TEXT,
  name       TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  photo      TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  consent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE participants ADD COLUMN IF NOT EXISTS time_in TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS time_out TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS notify_group TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS participants_company_idx ON participants (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS participants_code_uq ON participants (company_id, lower(code)) WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS face_templates (
  id             SERIAL PRIMARY KEY,
  company_id     INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  participant_id INT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  descriptor     REAL[] NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS face_templates_company_idx ON face_templates (company_id);
CREATE INDEX IF NOT EXISTS face_templates_participant_idx ON face_templates (participant_id);

CREATE TABLE IF NOT EXISTS attendance (
  id             BIGSERIAL PRIMARY KEY,
  company_id     INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  participant_id INT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('in','out')),
  status         TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present','late')),
  distance       REAL,
  liveness       BOOLEAN NOT NULL DEFAULT false,
  source         TEXT NOT NULL DEFAULT 'face',
  ts             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_company_ts_idx ON attendance (company_id, ts DESC);
CREATE INDEX IF NOT EXISTS attendance_participant_ts_idx ON attendance (participant_id, ts DESC);
`;

function dbNameOf(url) {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/** Connects, creating the database itself if it does not exist yet, then creates the tables. */
export async function initDb() {
  const url = config.databaseUrl;
  pool = new pg.Pool({ connectionString: url, max: 10 });
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    await pool.end().catch(() => {});
    if (err.code !== '3D000') throw err;
    // Database missing: create it through the maintenance database.
    const name = dbNameOf(url);
    const admin = new pg.Client({ connectionString: url.replace(/\/[^/?]*(\?|$)/, '/postgres$1') });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
    await admin.end();
    pool = new pg.Pool({ connectionString: url, max: 10 });
    await pool.query('SELECT 1');
  }
  await pool.query(SCHEMA);
  return pool;
}
