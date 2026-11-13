import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useToast } from '../../components/ui.jsx';

export default function Settings() {
  const toast = useToast();
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);
  const [testing, setTesting] = useState('');

  useEffect(() => {
    api('/c/settings')
      .then((r) => setS(r.settings))
      .catch((e) => toast(e.message, 'error'));
  }, [toast]);

  const refreshLast = useCallback(() => api('/c/webhook-status').then((r) => setLast(r.last)).catch(() => {}), []);
  useEffect(() => {
    refreshLast();
  }, [refreshLast]);

  if (!s) return <div className="page muted">Loading…</div>;
  const set = (k, v) => setS((x) => ({ ...x, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/c/settings', { method: 'PUT', body: s });
      setS(r.settings);
      toast('Settings saved', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>How strict the camera is and when someone counts as late.</p>
        </div>
      </div>
      <form onSubmit={save} className="card">
        <div className="field">
          <span>Match strictness - {s.threshold.toFixed(2)}</span>
          <input type="range" min="0.35" max="0.65" step="0.01" value={s.threshold} onChange={(e) => set('threshold', Number(e.target.value))} />
          <div className="row muted" style={{ justifyContent: 'space-between', fontSize: 12 }}>
            <span>Stricter (fewer wrong matches)</span>
            <span>More lenient (fewer misses)</span>
          </div>
        </div>

        <div className="grid2">
          <label className="field">
            <span>Default time in (for people without their own)</span>
            <input type="time" value={s.work_start} onChange={(e) => set('work_start', e.target.value)} required />
          </label>
          <label className="field">
            <span>Grace period (minutes)</span>
            <input type="number" min="0" max="180" value={s.grace_min} onChange={(e) => set('grace_min', Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Ignore repeat scans within (seconds)</span>
            <input type="number" min="0" max="600" value={s.repeat_gap_sec} onChange={(e) => set('repeat_gap_sec', Number(e.target.value))} />
          </label>
        </div>

        <label className="check" style={{ marginBottom: 20 }}>
          <input type="checkbox" checked={s.voice} onChange={(e) => set('voice', e.target.checked)} />
          <span>
            <b>Spoken greeting on the kiosk</b>
            <br />
            <span className="muted">The tablet says “Welcome, name” after a successful scan (needs sound on).</span>
          </span>
        </label>

        <h2 style={{ marginTop: 8 }}>n8n connection</h2>
        <p className="muted" style={{ marginTop: -4, fontSize: 13, lineHeight: 1.5 }}>
          Every first check-in of the day and every check-out is posted to this webhook as JSON, including a ready-made <b>message</b> text. In n8n, add a
          Webhook node (method POST), paste its Production URL here, then forward the message to the group.
        </p>
        <div className="grid2">
          <label className="field">
            <span>Webhook URL</span>
            <input type="text" value={s.n8n_url || ''} onChange={(e) => set('n8n_url', e.target.value)} placeholder="https://your-n8n/webhook/attendance" />
          </label>
          <label className="field">
            <span>Secret (optional)</span>
            <input type="text" value={s.n8n_secret || ''} onChange={(e) => set('n8n_secret', e.target.value)} placeholder="sent as X-Meridian-Secret" />
          </label>
        </div>

        <div className="row" style={{ marginBottom: 20 }}>
          {['check_in', 'check_out'].map((ev) => (
            <button
              type="button"
              key={ev}
              className="btn small"
              disabled={!!testing || !s.n8n_url}
              onClick={async () => {
                setTesting(ev);
                try {
                  await api('/c/settings', { method: 'PUT', body: s });
                  const r = await api('/c/webhook-test', { method: 'POST', body: { event: ev } });
                  toast(r.delivery.ok ? 'Test message delivered to n8n' : `Not delivered: ${r.delivery.error}`, r.delivery.ok ? 'ok' : 'error');
                } catch (err) {
                  toast(err.message, 'error');
                } finally {
                  setTesting('');
                  refreshLast();
                }
              }}
            >
              {testing === ev ? 'Sending…' : ev === 'check_in' ? 'Send test check-in' : 'Send test check-out'}
            </button>
          ))}
          {last && (
            <span className="muted" style={{ fontSize: 13 }}>
              Last delivery: {last.ok ? 'OK' : `failed - ${last.error}`} · {new Date(last.at).toLocaleTimeString()}
            </span>
          )}
        </div>

        <button className="btn primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </form>
    </div>
  );
}
