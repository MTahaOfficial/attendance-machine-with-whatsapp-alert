import { config, DEFAULT_SETTINGS } from './config.js';

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** YYYY-MM-DD for "now" in the configured time zone. */
export function todayStr(tz = config.tz) {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

/** Minutes since local midnight for a Date in the configured time zone. */
export function localMinutes(date = new Date(), tz = config.tz) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(date)
    .reduce((a, p) => ((a[p.type] = p.value), a), {});
  return (Number(parts.hour) % 24) * 60 + Number(parts.minute);
}

export function hhmmToMinutes(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60;
}

export function mergeSettings(stored) {
  return { ...DEFAULT_SETTINGS, ...(stored || {}) };
}

export function validateSettings(input) {
  const out = {};
  const num = (k, lo, hi) => {
    if (input[k] === undefined) return;
    const v = Number(input[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) throw new HttpError(400, `${k} must be between ${lo} and ${hi}`);
    out[k] = v;
  };
  num('threshold', 0.3, 0.7);
  num('repeat_gap_sec', 0, 600);
  num('grace_min', 0, 180);
  for (const k of ['blink_required', 'voice']) if (input[k] !== undefined) out[k] = !!input[k];
  if (input.work_start !== undefined) {
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(input.work_start)) throw new HttpError(400, 'work_start must be HH:MM');
    out.work_start = input.work_start;
  }
  if (input.n8n_url !== undefined) {
    const u = String(input.n8n_url || '').trim();
    if (u && !/^https?:\/\/[^\s]+$/i.test(u)) throw new HttpError(400, 'Webhook URL must start with http:// or https://');
    out.n8n_url = u.slice(0, 500);
  }
  if (input.n8n_secret !== undefined) out.n8n_secret = String(input.n8n_secret || '').trim().slice(0, 200);
  return out;
}

export function cleanText(v, max = 200) {
  return String(v ?? '').trim().slice(0, max);
}

/** Validates face descriptors: an array of arrays of 128 finite numbers. */
export function parseDescriptors(list, { min = 1, max = 8 } = {}) {
  if (!Array.isArray(list) || list.length < min || list.length > max) {
    throw new HttpError(400, `Provide ${min}-${max} face samples`);
  }
  return list.map((d) => parseDescriptor(d));
}

export function parseDescriptor(d) {
  if (!Array.isArray(d) || d.length !== 128 || !d.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    throw new HttpError(400, 'Invalid face descriptor');
  }
  return d;
}

export function parsePhoto(photo) {
  if (photo == null || photo === '') return null;
  if (typeof photo !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(photo) || photo.length > 200_000) {
    throw new HttpError(400, 'Invalid photo');
  }
  return photo;
}

export const isUniqueViolation = (e) => e && e.code === '23505';
