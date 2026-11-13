// Meridian WhatsApp bridge
// Logs in to WhatsApp once (scan a QR code with your phone, like WhatsApp Web) and then lets n8n send messages:
//   POST http://127.0.0.1:3100/send   { "to": "Group name | 03001234567 | 923001234567", "text": "..." }
//   GET  /groups   lists the groups this number is in   |   GET /status   shows if it is connected
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Optional settings file next to bridge.js (KEY=value per line), or real environment variables.
try {
  for (const line of fs.readFileSync(path.join(HERE, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  /* no .env file - defaults are fine */
}

const PORT = Number(process.env.PORT) || 3100;
const HOST = process.env.HOST || '127.0.0.1'; // only this PC can call the bridge
const API_KEY = process.env.BRIDGE_KEY || ''; // optional: n8n then sends it as the x-api-key header
const DEFAULT_TO = process.env.DEFAULT_TO || ''; // used when a message has no group/number
const COUNTRY = (process.env.COUNTRY_CODE || '92').replace(/\D/g, ''); // 0300... becomes 92300...
const SEND_GAP_MS = Number(process.env.SEND_GAP_MS) || 1500; // pause between messages (gentler on WhatsApp)
const AUTH_DIR = path.resolve(HERE, process.env.AUTH_DIR || 'auth');

const state = { connected: false, me: null, qr: false, lastError: '' };
const groups = new Map(); // jid -> subject
const groupMeta = new Map(); // jid -> full metadata, handed to Baileys so sending never has to ask WhatsApp for it
let sock = null;

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

async function refreshGroups() {
  if (!sock || !state.connected) return;
  const all = await sock.groupFetchAllParticipating();
  groups.clear();
  groupMeta.clear();
  for (const g of Object.values(all)) {
    groups.set(g.id, g.subject || '');
    groupMeta.set(g.id, g);
  }
  log(`[groups] ${groups.size} groups loaded`);
}

let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer); // many group events arrive in a burst: fetch once, after they settle
  refreshTimer = setTimeout(() => refreshGroups().catch(() => {}), 5000);
}

async function start() {
  const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {
    /* offline: use the version bundled with the library */
  }
  sock = makeWASocket({
    version,
    auth,
    logger: pino({ level: 'silent' }),
    browser: Browsers.macOS('Meridian'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    cachedGroupMetadata: async (jid) => groupMeta.get(jid),
  });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('groups.upsert', () => scheduleRefresh());
  sock.ev.on('groups.update', () => scheduleRefresh());

  sock.ev.on('connection.update', async (u) => {
    if (u.qr) {
      state.qr = true;
      console.log('\nScan this QR code with WhatsApp on your phone:\n  WhatsApp > Settings > Linked devices > Link a device\n');
      qrcode.generate(u.qr, { small: true });
    }
    if (u.connection === 'open') {
      state.connected = true;
      state.qr = false;
      state.lastError = '';
      state.me = sock.user?.id?.split(':')[0] || null;
      log(`[whatsapp] connected as ${state.me}`);
      refreshGroups().catch((e) => log('[groups] failed:', e.message));
    }
    if (u.connection === 'close') {
      state.connected = false;
      const code = u.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        state.lastError = 'Logged out from the phone. Delete the "auth" folder and start the bridge again to scan a new QR code.';
        log('[whatsapp]', state.lastError);
        return;
      }
      state.lastError = `Connection closed (code ${code ?? 'unknown'}), reconnecting...`;
      log('[whatsapp]', state.lastError);
      setTimeout(() => start().catch((e) => log('[whatsapp] restart failed:', e.message)), 3000);
    }
  });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Turns "Group name", "0300 1234567", "+92 300 1234567" or a raw id into a WhatsApp id. */
async function resolveTarget(to) {
  const t = String(to || DEFAULT_TO || '').trim();
  if (!t) throw new HttpError(400, 'Missing "to" (a group name or phone number)');
  if (/@(g\.us|s\.whatsapp\.net)$/.test(t)) return t;

  const digits = t.replace(/[\s()+-]/g, '');
  if (/^\d{8,15}$/.test(digits)) {
    const num = digits.startsWith('0') ? COUNTRY + digits.slice(1) : digits;
    const jid = `${num}@s.whatsapp.net`;
    const [hit] = (await sock.onWhatsApp(jid)) || [];
    if (!hit?.exists) throw new HttpError(404, `${num} is not on WhatsApp`);
    return hit.jid;
  }

  const find = () => {
    const want = t.toLowerCase();
    const exact = [...groups].filter(([, name]) => name.trim().toLowerCase() === want);
    if (exact.length === 1) return exact[0][0];
    if (exact.length > 1) throw new HttpError(409, `More than one group is called "${t}". Rename one, or send the group id (ends in @g.us).`);
    const part = [...groups].filter(([, name]) => name.toLowerCase().includes(want));
    return part.length === 1 ? part[0][0] : null;
  };
  let jid = find();
  if (!jid) {
    await refreshGroups();
    jid = find();
  }
  if (!jid) throw new HttpError(404, `No group called "${t}". Open /groups to see the exact names.`);
  return jid;
}

let queue = Promise.resolve();
function send(jid, text) {
  const job = queue.then(async () => {
    const r = await sock.sendMessage(jid, { text });
    await new Promise((res) => setTimeout(res, SEND_GAP_MS));
    return r;
  });
  queue = job.catch(() => {});
  return job;
}

function body(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => {
      d += c;
      if (d.length > 100_000) reject(new HttpError(413, 'Body too large'));
    });
    req.on('end', () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch {
        reject(new HttpError(400, 'Body must be JSON'));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const reply = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  try {
    if (API_KEY && req.headers['x-api-key'] !== API_KEY) throw new HttpError(401, 'Wrong or missing x-api-key');
    const url = new URL(req.url, 'http://x');

    if (req.method === 'GET' && url.pathname === '/status') return reply(200, { ...state, groups: groups.size });

    if (!state.connected) throw new HttpError(503, state.qr ? 'Not linked yet: scan the QR code shown in the bridge window' : state.lastError || 'WhatsApp is not connected yet');

    if (req.method === 'GET' && url.pathname === '/groups') {
      await refreshGroups();
      return reply(200, { groups: [...groups].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) });
    }
    if (req.method === 'POST' && url.pathname === '/send') {
      const b = await body(req);
      const text = String(b.text ?? b.message ?? '').trim();
      if (!text) throw new HttpError(400, 'Missing "text"');
      const jid = await resolveTarget(b.to ?? b.group);
      const r = await send(jid, text);
      log(`[send] ${jid}  (${text.length} chars)`);
      return reply(200, { ok: true, to: jid, id: r?.key?.id });
    }
    throw new HttpError(404, 'Not found. Use GET /status, GET /groups or POST /send');
  } catch (e) {
    if (!(e instanceof HttpError)) log('[error]', e.message);
    reply(e.status || 500, { ok: false, error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  log(`[bridge] listening on http://${HOST}:${PORT}${API_KEY ? '  (x-api-key required)' : ''}`);
});
start().catch((e) => {
  console.error('Could not start WhatsApp:', e.message);
  process.exit(1);
});
