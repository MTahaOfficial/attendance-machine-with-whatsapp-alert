// Creates a ready-made "Demo Company" with 100 placeholder participants (names only - no faces).
//   npm run seed
import './env.js';
import { hashPassword } from './auth.js';
import { config } from './config.js';
import { initDb, pool } from './db.js';
import { addDemoParticipants, createCompany } from './services.js';

await initDb();

const existing = await pool.query(`SELECT id FROM companies WHERE name = 'Demo Company'`);
let id = existing.rows[0]?.id;
if (!id) {
  const c = await createCompany({
    name: 'Demo Company',
    max_participants: 200,
    admin_name: 'Demo Admin',
    admin_email: 'demo@company.com',
    admin_password: 'demo123',
  });
  id = c.id;
  console.log('Created company "Demo Company"   login: demo@company.com / demo123');
} else {
  console.log('"Demo Company" already exists');
}

const { rows } = await pool.query('SELECT count(*)::int AS n FROM participants WHERE company_id = $1', [id]);
if (rows[0].n < 100) {
  const r = await addDemoParticipants(id, 100 - rows[0].n);
  console.log(`Added ${r.added} placeholder participants`);
}

const su = await pool.query(`SELECT 1 FROM users WHERE role='superadmin' LIMIT 1`);
if (!su.rowCount) {
  await pool.query(`INSERT INTO users (name,email,password_hash,role) VALUES ('Platform admin',$1,$2,'superadmin')`, [
    config.adminEmail.toLowerCase(),
    hashPassword(config.adminPassword),
  ]);
  console.log(`Created platform admin ${config.adminEmail} / ${config.adminPassword}`);
}
await pool.end();
