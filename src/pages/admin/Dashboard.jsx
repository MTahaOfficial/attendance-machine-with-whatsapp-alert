import { useCallback, useState } from 'react';
import { api } from '../../api.js';
import { CopyIcon, PlusIcon, RefreshIcon, TrashIcon, UsersIcon } from '../../components/Icons.jsx';
import { ConfirmModal, Modal, fmtTime, useCopy, usePolling, useToast } from '../../components/ui.jsx';

function NewCompanyModal({ onClose, onCreated }) {
  const [f, setF] = useState({ name: '', max_participants: 100, admin_name: '', admin_email: '', admin_password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/admin/companies', { method: 'POST', body: { ...f, max_participants: Number(f.max_participants) } });
      onCreated({ name: f.name, email: f.admin_email, password: f.admin_password });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="New company" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="grid2">
          <label className="field">
            <span>Company name</span>
            <input type="text" value={f.name} onChange={set('name')} required autoFocus />
          </label>
          <label className="field">
            <span>Participant limit</span>
            <input type="number" min="1" max="5000" value={f.max_participants} onChange={set('max_participants')} />
          </label>
          <label className="field">
            <span>Admin name</span>
            <input type="text" value={f.admin_name} onChange={set('admin_name')} />
          </label>
          <label className="field">
            <span>Admin email (login)</span>
            <input type="email" value={f.admin_email} onChange={set('admin_email')} required />
          </label>
        </div>
        <label className="field">
          <span>Admin password</span>
          <input type="text" value={f.admin_password} onChange={set('admin_password')} minLength={6} required placeholder="at least 6 characters" />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create company'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CredentialsModal({ cred, onClose }) {
  const copy = useCopy();
  const url = `${location.origin}/login`;
  const text = `Meridian - ${cred.name}\nSign in: ${url}\nEmail: ${cred.email}\nPassword: ${cred.password}`;
  return (
    <Modal
      title="Company created"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => copy(text)}>
            <CopyIcon size={16} /> Copy details
          </button>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }} className="muted">
        Give these sign-in details to <b style={{ color: 'var(--ink)' }}>{cred.name}</b>. Open the tablet link below on their tablet.
      </p>
      <div className="cred">
        Sign in: {url}
        <br />
        Email: {cred.email}
        <br />
        Password: {cred.password}
      </div>
    </Modal>
  );
}

function TabletLinks() {
  const [links, setLinks] = useState(null);
  const copy = useCopy();
  usePolling(() => api('/admin/access').then((r) => setLinks(r.urls)).catch(() => {}), 30000);
  const good = (links || []).filter((l) => l.camera);
  return (
    <div className="card">
      <h2>Company tablet link</h2>
      <p className="muted" style={{ marginTop: -4, fontSize: 13, lineHeight: 1.5 }}>
        Open this on the tablet (same Wi-Fi / hotspot as this laptop). The browser shows a certificate warning once: tap{' '}
        <b>Advanced → Proceed</b>. HTTPS is what lets the tablet use its camera.
      </p>
      {links === null && <p className="muted">Loading…</p>}
      {links && !good.length && (
        <p className="muted">No network address found - connect this laptop to Wi-Fi or start a hotspot, then refresh.</p>
      )}
      {good.map((l) => (
        <div className="link-row" key={l.url}>
          <img className="qr" src={l.qr} alt={`QR code for ${l.url}`} />
          <div>
            <div className="mono" style={{ fontSize: 14, wordBreak: 'break-all' }}>
              {l.url}
            </div>
            <button className="btn small" style={{ marginTop: 8 }} onClick={() => copy(l.url)}>
              <CopyIcon size={14} /> Copy link
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [modal, setModal] = useState(null); // {type:'new'} | {type:'cred', cred} | {type:'confirm', ...}
  const [busyId, setBusyId] = useState(null);

  // Polled every 3 s: a failed refresh is ignored (the next one retries) instead of flooding the screen with errors.
  const load = useCallback(() => api('/admin/overview').then(setData).catch(() => {}), []);
  usePolling(load, 3000);

  const act = async (id, label, fn) => {
    setBusyId(id);
    try {
      const r = await fn();
      toast(label(r), 'ok');
      await load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const t = data?.totals;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Companies</h1>
          <p>Create the companies that use Meridian and hand each one its own login.</p>
        </div>
        <button className="btn primary" onClick={() => setModal({ type: 'new' })}>
          <PlusIcon size={18} /> New company
        </button>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="v">{t?.companies ?? '–'}</div>
          <div className="l">Companies</div>
        </div>
        <div className="kpi">
          <div className="v">{t?.participants ?? '–'}</div>
          <div className="l">Participants</div>
        </div>
        <div className="kpi green">
          <div className="v">{t?.enrolled ?? '–'}</div>
          <div className="l">Faces enrolled</div>
        </div>
        <div className="kpi amber">
          <div className="v">{t?.events_today ?? '–'}</div>
          <div className="l">Check-ins today</div>
        </div>
      </div>

      <div className="cols two">
        <div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th className="num">People</th>
                  <th className="num">Enrolled</th>
                  <th className="num">Today</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.companies.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <b>{c.name}</b>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {c.admin_email}
                      </div>
                    </td>
                    <td className="num">
                      {c.participants}
                      <span className="muted"> / {c.max_participants}</span>
                    </td>
                    <td className="num">{c.enrolled}</td>
                    <td className="num">{c.events_today}</td>
                    <td>
                      <button
                        className={`badge ${c.active ? 'green' : 'red'}`}
                        style={{ border: 0 }}
                        title="Click to enable / disable this company"
                        onClick={() => act(c.id, () => (c.active ? 'Company disabled' : 'Company enabled'), () => api(`/admin/companies/${c.id}`, { method: 'PATCH', body: { active: !c.active } }))}
                      >
                        {c.active ? 'Active' : 'Disabled'}
                      </button>
                    </td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <button
                          className="btn small"
                          disabled={busyId === c.id}
                          title="Add 100 placeholder participants (names only)"
                          onClick={() => act(c.id, (r) => `${r.added} demo participants added`, () => api(`/admin/companies/${c.id}/demo-participants`, { method: 'POST', body: { count: 100 } }))}
                        >
                          <UsersIcon size={15} /> +100
                        </button>
                        <button
                          className="btn small"
                          disabled={busyId === c.id}
                          title="Fill today's attendance with sample check-ins (marked demo)"
                          onClick={() => act(c.id, (r) => `${r.created} sample check-ins created`, () => api(`/admin/companies/${c.id}/simulate`, { method: 'POST' }))}
                        >
                          Simulate day
                        </button>
                        <button
                          className="btn small"
                          title="Clear today's and past attendance"
                          onClick={() =>
                            setModal({
                              type: 'confirm',
                              title: 'Reset attendance',
                              message: `Delete ALL attendance records of ${c.name}? Participants and faces are kept.`,
                              confirmLabel: 'Reset attendance',
                              run: () => api(`/admin/companies/${c.id}/reset-attendance`, { method: 'POST' }),
                              done: (r) => `${r.deleted} records deleted`,
                            })
                          }
                        >
                          <RefreshIcon size={15} />
                        </button>
                        <button
                          className="btn small danger"
                          title="Delete company"
                          onClick={() =>
                            setModal({
                              type: 'confirm',
                              title: 'Delete company',
                              message: `Permanently delete ${c.name}, its login, all participants, face data and attendance?`,
                              confirmLabel: 'Delete everything',
                              danger: true,
                              run: () => api(`/admin/companies/${c.id}`, { method: 'DELETE' }),
                              done: () => 'Company deleted',
                            })
                          }
                        >
                          <TrashIcon size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {data && !data.companies.length && (
                  <tr>
                    <td colSpan="6" className="empty">
                      No companies yet. Click “New company” to create the first one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <TabletLinks />
          <div className="card">
            <h2>Live check-ins</h2>
            <div className="feed">
              {data?.recent.map((e) => (
                <div className="feed-item" key={e.id}>
                  <span className={`badge ${e.kind === 'in' ? (e.status === 'late' ? 'amber' : 'green') : 'cyan'}`}>
                    {e.kind === 'in' ? (e.status === 'late' ? 'Late' : 'In') : 'Out'}
                  </span>
                  <span>
                    <b>{e.name}</b> <span className="muted">· {e.company}</span>
                  </span>
                  <span className="t">{fmtTime(e.ts)}</span>
                </div>
              ))}
              {data && !data.recent.length && <p className="muted" style={{ margin: 0 }}>Nothing yet - scans appear here instantly.</p>}
            </div>
          </div>
        </div>
      </div>

      {modal?.type === 'new' && (
        <NewCompanyModal
          onClose={() => setModal(null)}
          onCreated={(cred) => {
            setModal({ type: 'cred', cred });
            load();
          }}
        />
      )}
      {modal?.type === 'cred' && <CredentialsModal cred={modal.cred} onClose={() => setModal(null)} />}
      {modal?.type === 'confirm' && (
        <ConfirmModal
          title={modal.title}
          message={modal.message}
          confirmLabel={modal.confirmLabel}
          danger={modal.danger}
          onClose={() => setModal(null)}
          onConfirm={async () => {
            try {
              const r = await modal.run();
              toast(modal.done(r), 'ok');
              setModal(null);
              load();
            } catch (e) {
              toast(e.message, 'error');
            }
          }}
        />
      )}
    </div>
  );
}
