import './env.js';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import compression from 'compression';
import express from 'express';
import selfsigned from 'selfsigned';
import { adminRouter } from './admin.js';
import { authRouter, hashPassword } from './auth.js';
import { companyRouter } from './company.js';
import { DATA_DIR, config } from './config.js';
import { initDb, pool } from './db.js';

function lanIps() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  }
  return ips;
}

function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(compression());
  app.use(express.json({ limit: '3mb' }));

  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true, time: new Date().toISOString() });
  });
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/c', companyRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  if (fs.existsSync(config.distDir)) {
    app.use(express.static(config.distDir, { maxAge: '1h', index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(config.distDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) =>
      res.type('text').send('Meridian API is running. Build the web app with `npm run build` (or use `npm run dev`).'),
    );
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Server error' : err.message, ...(err.extra || {}) });
  });
  return app;
}

async function ensureCertificate(ips) {
  const file = path.join(DATA_DIR, 'cert.json');
  const key = ips.slice().sort().join(',');
  if (fs.existsSync(file)) {
    try {
      const c = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (c.key === key && c.notAfter > Date.now() + 30 * 864e5) return c;
    } catch {
      /* regenerate */
    }
  }
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...ips.map((ip) => ({ type: 7, ip })),
  ];
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Meridian' }], {
    days: 825,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
  });
  const c = { key, notAfter: Date.now() + 825 * 864e5, private: pems.private, cert: pems.cert };
  fs.writeFileSync(file, JSON.stringify(c));
  return c;
}

async function bootstrap() {
  await initDb();
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE role = 'superadmin' LIMIT 1`);
  if (!rows.length) {
    await pool.query(`INSERT INTO users (name, email, password_hash, role) VALUES ('Platform admin', $1, $2, 'superadmin')`, [
      config.adminEmail.toLowerCase(),
      hashPassword(config.adminPassword),
    ]);
    console.log(`[auth] created platform admin  ${config.adminEmail} / ${config.adminPassword}   (change it in .env: ADMIN_EMAIL / ADMIN_PASSWORD before first start)`);
  }
}

async function main() {
  await bootstrap();
  const app = buildApp();
  const ips = lanIps();

  http.createServer(app).listen(config.httpPort, () => {
    console.log(`\n  Meridian is running`);
    console.log(`  Laptop (this PC):   http://localhost:${config.httpPort}`);
  });
  if (config.https) {
    const c = await ensureCertificate(ips);
    https.createServer({ key: c.private, cert: c.cert }, app).listen(config.httpsPort, () => {
      console.log(`  Laptop (camera OK): https://localhost:${config.httpsPort}`);
      for (const ip of ips) console.log(`  Tablet on same Wi-Fi: https://${ip}:${config.httpsPort}   <- open this on the tablet`);
      console.log('  (the browser warns about the self-signed certificate once: Advanced -> Proceed)\n');
    });
  }
}

main().catch((e) => {
  console.error('\nCould not start Meridian:', e.message);
  if (/ECONNREFUSED|ENOTFOUND|password authentication|database/i.test(e.message + (e.code || ''))) {
    console.error(`\nPostgreSQL is not reachable at ${config.databaseUrl.replace(/:[^:@/]+@/, ':****@')}`);
    console.error('Start it with `npm run db:embedded` (no install needed) or point DATABASE_URL (in .env) at your own PostgreSQL.');
  }
  process.exit(1);
});
