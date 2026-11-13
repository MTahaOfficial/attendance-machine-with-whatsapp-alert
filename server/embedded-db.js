// Zero-install PostgreSQL for the exhibition laptop:  npm run db:embedded
// Runs a real PostgreSQL server (from the `embedded-postgres` package) on localhost:5432
// with user/password postgres/postgres and stores its data in server/data/pg.
// Leave this window open while the app is running. (Or use your own PostgreSQL via DATABASE_URL.)
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import './env.js';
import { DATA_DIR } from './config.js';

let EmbeddedPostgres;
try {
  ({ default: EmbeddedPostgres } = await import('embedded-postgres'));
} catch (e) {
  console.error('embedded-postgres is not installed for this platform:', e.message);
  console.error('Install PostgreSQL yourself (or run `docker compose up -d`) and set DATABASE_URL in .env');
  process.exit(1);
}

function portFree(p) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(p, '127.0.0.1');
  });
}
let port = Number(process.env.PGPORT) || 5432;
if (!(await portFree(port))) {
  const old = port;
  for (port = old + 1; port < old + 40 && !(await portFree(port)); port++);
  console.log(`[db] port ${old} is already used (another PostgreSQL?) - using ${port} instead`);
}
const dir = process.env.EMBEDDED_PG_DIR || path.join(DATA_DIR, 'pg');
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  onLog: (m) => keep(m),
  onError: (m) => keep(m),
});
const tail = [];
function keep(m) {
  for (const l of String(m).split(/\r?\n/)) if (l.trim()) tail.push(l.trim());
  if (tail.length > 40) tail.splice(0, tail.length - 40);
}
async function fail(e) {
  console.error('\n[db] PostgreSQL could not start.', e?.message || '');
  if (tail.length) console.error('[db] last messages from PostgreSQL:\n  ' + tail.slice(-15).join('\n  '));
  console.error('\nFix options: (1) if the messages mention a missing DLL, install the "Microsoft Visual C++ Redistributable 2015-2022 (x64)";');
  console.error('(2) install PostgreSQL normally (or run `docker compose up -d`) and put DATABASE_URL=postgres://user:pass@localhost:5432/meridian in .env;');
  console.error('(3) delete the folder server\\data\\pg and try again.');
  process.exit(1);
}
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);

if (!fs.existsSync(path.join(dir, 'PG_VERSION'))) {
  console.log('[db] first run: initialising database cluster...');
  await pg.initialise().catch(fail);
}
await pg.start().catch(fail);
try {
  await pg.createDatabase('meridian');
} catch {
  /* already exists */
}
fs.writeFileSync(path.join(DATA_DIR, 'embedded-url.txt'), `postgres://postgres:postgres@localhost:${port}/meridian`);
console.log(`[db] PostgreSQL is running on localhost:${port}  (postgres://postgres:postgres@localhost:${port}/meridian)`);
console.log('[db] keep this window open. Press Ctrl+C to stop.');

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  console.log('\n[db] stopping...');
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30); // keep the process alive
