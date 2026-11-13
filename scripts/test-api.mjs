// End-to-end API test.  Start the server first (npm start), then:  npm run test:api
// Uses synthetic face descriptors, so it does not need a camera. It creates throw-away companies.
const BASE = process.env.BASE || 'http://localhost:4000';
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@meridian.local', password: process.env.ADMIN_PASSWORD || 'admin123' };

let passed = 0;
let failed = 0;
function ok(cond, name, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ---- synthetic descriptors: a person = random base vector, samples = base + small noise
const gauss = () => Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
const person = () => Array.from({ length: 128 }, () => gauss() * 0.09);
const sample = (base, noise = 0.012) => base.map((v) => v + gauss() * noise);
const dist = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));

const stamp = Date.now();
const alice = person();
const bob = person();
const stranger = person();
console.log(`synthetic sanity: same person ${dist(alice, sample(alice)).toFixed(2)}, different ${dist(alice, bob).toFixed(2)}`);

console.log('\nauth');
ok((await call('GET', '/health')).data.ok === true, 'health check');
ok((await call('POST', '/auth/login', { body: { email: ADMIN.email, password: 'nope' } })).status === 401, 'wrong password rejected');
const adminLogin = await call('POST', '/auth/login', { body: ADMIN });
ok(adminLogin.status === 200 && adminLogin.data.user.role === 'superadmin', 'platform admin can sign in');
const AT = adminLogin.data.token;
ok((await call('GET', '/admin/overview')).status === 401, 'admin API needs a token');

console.log('\nplatform admin: companies');
const mk = async (name, email) => call('POST', '/admin/companies', { token: AT, body: { name, max_participants: 5, admin_email: email, admin_password: 'secret1' } });
const a = await mk(`Test A ${stamp}`, `a${stamp}@test.com`);
const b = await mk(`Test B ${stamp}`, `b${stamp}@test.com`);
ok(a.status === 201 && b.status === 201, 'two companies created');
ok((await mk('Dup', `a${stamp}@test.com`)).status === 409, 'duplicate admin email rejected');
ok((await call('POST', '/admin/companies', { token: AT, body: { name: 'X', admin_email: 'bad', admin_password: 'secret1' } })).status === 400, 'invalid email rejected');
const aId = a.data.company.id;
const bId = b.data.company.id;

const loginA = await call('POST', '/auth/login', { body: { email: `a${stamp}@test.com`, password: 'secret1' } });
const loginB = await call('POST', '/auth/login', { body: { email: `b${stamp}@test.com`, password: 'secret1' } });
ok(loginA.status === 200 && loginA.data.user.company.id === aId, 'company A admin can sign in');
const TA = loginA.data.token;
const TB = loginB.data.token;
ok((await call('GET', '/admin/overview', { token: TA })).status === 403, 'company login cannot use admin API');
ok((await call('GET', '/c/settings', { token: AT })).status === 403, 'platform admin token is not a company token');

console.log('\ncompany settings');
const s0 = await call('GET', '/c/settings', { token: TA });
ok(s0.data.settings.threshold === 0.5, 'defaults loaded');
ok((await call('PUT', '/c/settings', { token: TA, body: { threshold: 5 } })).status === 400, 'out-of-range setting rejected');
ok((await call('PUT', '/c/settings', { token: TA, body: { repeat_gap_sec: 0, work_start: '00:01', grace_min: 0 } })).status === 200, 'settings saved');

console.log('\nparticipants + enrolment');
const body = (name, base, extra = {}) => ({ name, code: `${name}-${stamp}`, department: 'QA', consent: true, descriptors: [sample(base), sample(base), sample(base)], ...extra });
ok((await call('POST', '/c/participants', { token: TA, body: { ...body('NoConsent', person()), consent: false } })).status === 400, 'enrolment without consent rejected');
ok((await call('POST', '/c/participants', { token: TA, body: { name: '', descriptors: [] } })).status === 400, 'empty name rejected');
ok((await call('POST', '/c/participants', { token: TA, body: { name: 'Bad', consent: true, descriptors: [[1, 2, 3]] } })).status === 400, 'malformed descriptor rejected');
const pa = await call('POST', '/c/participants', { token: TA, body: body('Alice', alice) });
ok(pa.status === 201 && pa.data.participant.faces === 3, 'Alice enrolled with 3 samples');
const dup = await call('POST', '/c/participants', { token: TA, body: { ...body('AliceAgain', alice), code: 'X1' } });
ok(dup.status === 409 && dup.data.duplicate?.name === 'Alice', 'same face enrolled twice is blocked');
const forced = await call('POST', '/c/participants', { token: TA, body: { ...body('Alice2', alice), code: 'X2', force: true } });
ok(forced.status === 201, 'duplicate allowed with force');
await call('DELETE', `/c/participants/${forced.data.participant.id}`, { token: TA }); // keep the data clean for the next checks
ok((await call('POST', '/c/participants', { token: TA, body: { ...body('Clash', person()), code: `Alice-${stamp}` } })).status === 409, 'duplicate ID blocked');
const pb = await call('POST', '/c/participants', { token: TA, body: body('Bob', bob, { time_in: '23:59' }) });
ok(pb.status === 201 && pb.data.participant.time_in === '23:59', 'Bob enrolled with his own allocated time in (23:59)');
ok((await call('POST', '/c/participants', { token: TA, body: { name: 'BadTime', time_in: '25:99' } })).status === 400, 'invalid time in rejected');
const pNoFace = await call('POST', '/c/participants', { token: TA, body: { name: 'Carol (no face)', code: 'C1' } });
ok(pNoFace.status === 201 && pNoFace.data.participant.faces === 0, 'participant without a face can be added');
await call('PATCH', `/admin/companies/${aId}`, { token: AT, body: { max_participants: 3 } });
ok((await call('POST', '/c/participants', { token: TA, body: { name: 'Over limit' } })).status === 403, 'participant limit enforced (max 3)');

console.log('\nverification');
const ver = (token, d, liveness = true) => call('POST', '/c/verify', { token, body: { descriptor: d, liveness } });
const v1 = await ver(TA, sample(alice));
ok(v1.data.result === 'matched' && v1.data.participant.name.startsWith('Alice') && v1.data.kind === 'in', 'Alice recognised -> check-in', JSON.stringify(v1.data).slice(0, 200));
ok(v1.data.status === 'late', 'first check-in after work start is late');
const vb = await ver(TA, sample(bob));
ok(vb.data.participant?.name === 'Bob' && vb.data.due === '23:59' && vb.data.status === 'present', 'Bob recognised; his own time in (23:59) applies, so he is on time');
ok((await ver(TA, sample(stranger))).data.result === 'unknown', 'stranger is not recognised');
const v2 = await ver(TA, sample(alice));
ok(v2.data.result === 'matched' && v2.data.kind === 'out', 'second scan toggles to check-out');
await call('PUT', '/c/settings', { token: TA, body: { repeat_gap_sec: 60 } });
const v3 = await ver(TA, sample(alice));
ok(v3.data.result === 'repeat', 'rapid re-scan is reported as repeat (no duplicate record)');
await call('PUT', '/c/settings', { token: TA, body: { repeat_gap_sec: 0 } });
ok((await ver(TA, sample(alice), false)).data.kind === 'in', 'works without liveness when the company turns the blink check off');
await call('PUT', '/c/settings', { token: TA, body: { threshold: 0.3 } });
ok((await ver(TA, sample(alice, 0.05))).data.result === 'unknown', 'stricter threshold rejects a noisy sample');
await call('PUT', '/c/settings', { token: TA, body: { threshold: 0.5 } });

console.log('\nattendance report');
const att = await call('GET', '/c/attendance', { token: TA });
ok(att.status === 200 && att.data.summary.present === 2 && att.data.summary.late === 1, 'present=2 late=1 (Alice late, Bob on time)', JSON.stringify(att.data.summary));
ok(att.data.summary.absent === att.data.summary.total - 2, 'absent list = total - present');
ok(att.data.events.length === 4, 'every scan stored (4 events)', `got ${att.data.events.length}`);
const yesterday = await call('GET', '/c/attendance?date=2000-01-01', { token: TA });
ok(yesterday.data.events.length === 0, 'other dates are empty');

console.log('\ntenant isolation');
ok((await call('GET', '/c/participants', { token: TB })).data.participants.length === 0, 'company B sees none of A\'s participants');
const vB = await ver(TB, sample(alice));
ok(vB.data.result === 'unknown', 'A\'s face is unknown to company B');
ok((await call('PUT', `/c/participants/${pa.data.participant.id}`, { token: TB, body: { name: 'Hacked' } })).status === 404, 'B cannot edit A\'s participant');
ok((await call('DELETE', `/c/participants/${pa.data.participant.id}`, { token: TB })).status === 404, 'B cannot delete A\'s participant');
ok((await call('GET', '/c/attendance', { token: TB })).data.events.length === 0, 'B sees none of A\'s attendance');

console.log('\nface deletion (privacy)');
ok((await call('DELETE', `/c/participants/${pb.data.participant.id}/face`, { token: TA })).status === 200, 'Bob\'s face data deleted');
ok((await ver(TA, sample(bob))).data.result === 'unknown', 'Bob no longer recognised after deletion');
const upd = await call('PUT', `/c/participants/${pb.data.participant.id}`, { token: TA, body: { name: 'Bob Renamed', department: 'Ops', consent: true, descriptors: [sample(bob), sample(bob)] } });
ok(upd.status === 200 && upd.data.participant.faces === 2 && upd.data.participant.name === 'Bob Renamed', 'Bob re-enrolled + edited');
ok((await ver(TA, sample(bob))).data.participant?.name === 'Bob Renamed', 'Bob recognised again');

console.log('\ndemo tools + overview');
await call('PATCH', `/admin/companies/${bId}`, { token: AT, body: { max_participants: 50 } });
const demo = await call('POST', `/admin/companies/${bId}/demo-participants`, { token: AT, body: { count: 30 } });
ok(demo.data.added === 30, '30 demo participants added', JSON.stringify(demo.data));
const sim = await call('POST', `/admin/companies/${bId}/simulate`, { token: AT });
ok(sim.data.created > 15 && sim.data.created <= 30, 'simulated day created check-ins', JSON.stringify(sim.data));
const attB = await call('GET', '/c/attendance', { token: TB });
ok(attB.data.summary.present === sim.data.created && attB.data.events.every((e) => e.source === 'demo'), 'simulated events are flagged as demo');
const ov = await call('GET', '/admin/overview', { token: AT });
ok(ov.status === 200 && ov.data.companies.some((c) => c.id === bId && c.participants === 30), 'overview lists companies with counts');
ok(Array.isArray(ov.data.recent) && ov.data.recent.length > 0, 'overview has a live feed');
const access = await call('GET', '/admin/access', { token: AT });
ok(access.status === 200 && Array.isArray(access.data.urls), 'tablet access links available');

console.log('\nn8n webhook');
{
  const http = await import('node:http');
  const got = [];
  const srv = http.createServer((req, res) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      got.push({ secret: req.headers['x-meridian-secret'], body: JSON.parse(d) });
      res.end('ok');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/hook`;
  const wait = async (n) => { for (let i = 0; i < 40 && got.length < n; i++) await new Promise((r) => setTimeout(r, 100)); };
  ok((await call('PUT', '/c/settings', { token: TA, body: { n8n_url: 'ftp://bad' } })).status === 400, 'webhook URL must be http(s)');
  ok((await call('PUT', '/c/settings', { token: TA, body: { n8n_url: url, n8n_secret: 's3cret', repeat_gap_sec: 0 } })).status === 200, 'webhook URL saved');
  const t = await call('POST', '/c/webhook-test', { token: TA, body: { event: 'check_in' } });
  ok(t.data.delivery?.ok === true && got.length === 1, 'test message delivered');
  ok(got[0].secret === 's3cret', 'secret header sent');
  ok(/Total days\nPresent: 11\nIn time: 5\nLate: 6/.test(got[0].body.message) && /Status: Late/.test(got[0].body.message), 'check-in message has status + month totals', got[0].body.message);

  // real check-out for Alice (her last scan today was an "in")
  await ver(TA, sample(alice));
  await wait(2);
  const out = got[1]?.body;
  ok(out?.event === 'check_out' && /^Month \(\w{3}\)\nName: Alice\nTime Out: \d{1,2}:\d{2} [AP]M$/.test(out.message), 'check-out message sent after Alice leaves', JSON.stringify(out?.message));

  // fresh day: first check-in carries status and totals
  await call('POST', `/admin/companies/${aId}/reset-attendance`, { token: AT });
  await ver(TA, sample(alice));
  await wait(3);
  const inn = got[2]?.body;
  ok(inn?.event === 'check_in' && inn.status === 'late' && inn.totals.present_days === 1 && inn.totals.late_days === 1 && inn.totals.on_time_days === 0, 'first check-in sends status + totals (1 present, 1 late)', JSON.stringify(inn?.totals));
  ok(/Time In: \d{1,2}:\d{2} [AP]M/.test(inn?.message || ''), 'check-in message has Time In');
  await ver(TA, sample(alice)); // out
  await ver(TA, sample(alice)); // in again - must NOT send a second "check-in" message
  await wait(4);
  await new Promise((r) => setTimeout(r, 600));
  ok(got.length === 4 && got[3].body.event === 'check_out', 'second check-in of the day is not announced again', `got ${got.length}`);
  srv.close();
  await call('PUT', '/c/settings', { token: TA, body: { n8n_url: '' } });
  const dead = await call('PUT', '/c/settings', { token: TA, body: { n8n_url: 'http://127.0.0.1:9/x' } });
  const vd = await ver(TA, sample(alice));
  ok(vd.status === 200 && vd.data.result === 'matched', 'a dead webhook never blocks the kiosk');
  await call('PUT', '/c/settings', { token: TA, body: { n8n_url: '' } });
}

console.log('\nenable / disable');
await call('PATCH', `/admin/companies/${aId}`, { token: AT, body: { active: false } });
ok((await call('GET', '/c/settings', { token: TA })).status === 403, 'disabled company token stops working immediately');
ok((await call('POST', '/auth/login', { body: { email: `a${stamp}@test.com`, password: 'secret1' } })).status === 403, 'disabled company cannot sign in');
await call('PATCH', `/admin/companies/${aId}`, { token: AT, body: { active: true, admin_password: 'newpass1' } });
ok((await call('POST', '/auth/login', { body: { email: `a${stamp}@test.com`, password: 'newpass1' } })).status === 200, 're-enabled + password reset works');

console.log('\ncleanup');
await call('DELETE', `/admin/companies/${aId}`, { token: AT });
await call('DELETE', `/admin/companies/${bId}`, { token: AT });
ok((await call('GET', '/c/settings', { token: TB })).status === 401, 'deleted company token is rejected');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
