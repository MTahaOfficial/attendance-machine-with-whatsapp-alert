// Sends check-in / check-out events to an n8n webhook (or any URL that accepts JSON).
// n8n then forwards the ready-made `message` to the right WhatsApp / Telegram / e-mail group.
import { config } from './config.js';
import { pool } from './db.js';

const lastDelivery = new Map(); // companyId -> { ok, at, status, error, event }

export function lastDeliveryOf(companyId) {
  return lastDelivery.get(companyId) || null;
}

const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-US', { timeZone: config.tz, hour: 'numeric', minute: '2-digit' });
const monthShort = (ts) => new Date(ts).toLocaleString('en-US', { timeZone: config.tz, month: 'short' });
const dateKey = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: config.tz });

/** Days present / on time / late for this person in the month of `ts` (company time zone). */
export async function monthStats(participantId, ts) {
  const { rows } = await pool.query(
    `SELECT count(DISTINCT d)::int AS present_days,
            count(DISTINCT d) FILTER (WHERE status = 'late')::int AS late_days
       FROM (SELECT (a.ts AT TIME ZONE $2)::date AS d, a.status
               FROM attendance a
              WHERE a.participant_id = $1 AND a.kind = 'in'
                AND a.ts >= date_trunc('month', $3::timestamptz AT TIME ZONE $2) AT TIME ZONE $2
                AND a.ts <  (date_trunc('month', $3::timestamptz AT TIME ZONE $2) + interval '1 month') AT TIME ZONE $2) x`,
    [participantId, config.tz, new Date(ts).toISOString()],
  );
  const present = rows[0].present_days;
  const late = rows[0].late_days;
  return { present_days: present, on_time_days: present - late, late_days: late };
}

export function buildMessage(p) {
  const head = `Month (${p.month})\nName: ${p.participant.name}`;
  if (p.event === 'check_out') return `${head}\nTime Out: ${p.time_out}`;
  return (
    `${head}\nStatus: ${p.status === 'late' ? 'Late' : 'On time'}\nTime In: ${p.time_in}\n` +
    `Total days\nPresent: ${p.totals.present_days}\nIn time: ${p.totals.on_time_days}\nLate: ${p.totals.late_days}`
  );
}

export async function buildPayload({ event, participant, ts, status, dueIn }) {
  const totals = await monthStats(participant.id, ts);
  const payload = {
    event, // 'check_in' | 'check_out' | 'test'
    company: participant.company_name || undefined,
    month: monthShort(ts),
    date: dateKey(ts),
    participant: {
      id: participant.id,
      name: participant.name,
      code: participant.code || '',
      department: participant.department || '',
      group: participant.notify_group || '',
    },
    status: event === 'check_in' ? status : undefined, // 'late' | 'present'
    allocated_time_in: dueIn || '',
    allocated_time_out: participant.time_out || '',
    time_in: event === 'check_in' ? fmtTime(ts) : undefined,
    time_out: event === 'check_out' ? fmtTime(ts) : undefined,
    totals,
    timestamp: new Date(ts).toISOString(),
  };
  payload.message = buildMessage(payload);
  return payload;
}

export async function sendWebhook(companyId, settings, payload) {
  const url = settings.n8n_url;
  if (!url) return { skipped: true };
  const result = { ok: false, at: new Date().toISOString(), event: payload.event };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(settings.n8n_secret ? { 'X-Meridian-Secret': settings.n8n_secret } : {}) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    result.status = res.status;
    result.ok = res.ok;
    if (!res.ok) result.error = `Webhook answered HTTP ${res.status}`;
  } catch (e) {
    result.error = e.name === 'TimeoutError' ? 'Webhook did not answer within 8 seconds' : e.cause?.code || e.message;
  }
  lastDelivery.set(companyId, result);
  if (!result.ok) console.error(`[n8n] delivery failed for company ${companyId}: ${result.error}`);
  return result;
}
