import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import EnrolCamera from '../../components/EnrolCamera.jsx';
import { CameraIcon, EditIcon, PlusIcon, SearchIcon, TrashIcon } from '../../components/Icons.jsx';
import { Avatar, ConfirmModal, Modal, useToast } from '../../components/ui.jsx';

const EMPTY = { name: '', code: '', department: '', time_in: '', time_out: '', notify_group: '', phone: '', email: '', notes: '' };

function ParticipantForm({ initial, onClose, onSaved }) {
  const toast = useToast();
  const editing = !!initial;
  const [f, setF] = useState(editing ? { ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, initial[k] ?? ''])) } : EMPTY);
  const [enrol, setEnrol] = useState(null); // { descriptors, photo }
  const [consent, setConsent] = useState(false);
  const [showCam, setShowCam] = useState(false);
  const [error, setError] = useState('');
  const [dup, setDup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [removeFace, setRemoveFace] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const photo = enrol?.photo ?? initial?.photo ?? null;
  const faces = enrol ? enrol.descriptors.length : initial?.faces || 0;

  const submit = async (e, force = false) => {
    e?.preventDefault();
    setError('');
    setDup(null);
    if (enrol && !consent) {
      setError('Please confirm the person agreed to face enrolment.');
      return;
    }
    setBusy(true);
    try {
      const body = { ...f, ...(enrol ? { descriptors: enrol.descriptors, photo: enrol.photo, consent: true, force } : {}) };
      const r = editing
        ? await api(`/c/participants/${initial.id}`, { method: 'PUT', body })
        : await api('/c/participants', { method: 'POST', body });
      toast(editing ? 'Participant updated' : 'Participant added', 'ok');
      onSaved(r.participant);
    } catch (err) {
      if (err.status === 409 && err.data?.duplicate) setDup(err.data.duplicate);
      else setError(err.message);
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        title={editing ? 'Edit participant' : 'Add participant'}
        onClose={onClose}
        closeOnBackdrop={false}
        footer={
          <>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" form="pform" disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add participant'}
            </button>
          </>
        }
      >
        <form id="pform" onSubmit={submit}>
          <div className="grid2">
            <label className="field">
              <span>Full name *</span>
              <input type="text" value={f.name} onChange={set('name')} required autoFocus maxLength={120} />
            </label>
            <label className="field">
              <span>ID / roll / employee no.</span>
              <input type="text" value={f.code} onChange={set('code')} maxLength={60} />
            </label>
            <label className="field">
              <span>Department / class</span>
              <input type="text" value={f.department} onChange={set('department')} maxLength={100} />
            </label>
            <label className="field">
              <span>Allocated time in</span>
              <input type="time" value={f.time_in} onChange={set('time_in')} />
              <small className="muted">Leave empty to use the company default (Settings).</small>
            </label>
            <label className="field">
              <span>Allocated time out</span>
              <input type="time" value={f.time_out} onChange={set('time_out')} />
              <small className="muted">When the person is expected to leave (optional).</small>
            </label>
            <label className="field">
              <span>Notification group</span>
              <input type="text" value={f.notify_group} onChange={set('notify_group')} maxLength={120} placeholder="e.g. Minhal parents group" />
              <small className="muted">Sent to n8n with every message so it can pick the right group.</small>
            </label>
            <label className="field">
              <span>Phone</span>
              <input type="text" value={f.phone} onChange={set('phone')} maxLength={40} />
            </label>
          </div>
          <label className="field">
            <span>Email</span>
            <input type="email" value={f.email} onChange={set('email')} maxLength={160} />
          </label>
          <label className="field">
            <span>Notes / details</span>
            <textarea value={f.notes} onChange={set('notes')} maxLength={500} />
          </label>

          <div className="face-row">
            <Avatar name={f.name} photo={photo} size="lg" />
            <div className="grow">
              <b>{faces ? `Face enrolled (${faces} samples)` : 'Face not enrolled yet'}</b>
              <div className="muted" style={{ fontSize: 13, margin: '2px 0 10px' }}>
                {enrol ? 'New photos ready - they are saved when you press the button below.' : 'Needed so the camera can recognise this person.'}
              </div>
              <div className="row">
                <button type="button" className="btn" onClick={() => setShowCam(true)} title="Open the camera to enrol this person's face">
                  <CameraIcon size={18} /> {faces ? 'Re-enrol face' : 'Enrol face'}
                </button>
                {editing && initial.faces > 0 && !enrol && (
                  <button type="button" className="btn danger" onClick={() => setRemoveFace(true)}>
                    Remove face data
                  </button>
                )}
              </div>
            </div>
          </div>

          {enrol && (
            <label className="check" style={{ marginBottom: 12 }}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>This person agreed to have their face scanned and stored for attendance. They can ask for it to be deleted at any time.</span>
            </label>
          )}

          {dup && (
            <div className="card" style={{ borderColor: 'rgba(255,176,32,.5)', marginBottom: 12 }}>
              <b style={{ color: 'var(--amber)' }}>This face already looks like “{dup.name}”.</b>
              <p className="muted" style={{ margin: '6px 0 10px' }}>
                The same person is probably enrolled twice. Enrol anyway only if these are really two different people.
              </p>
              <button type="button" className="btn small" onClick={() => submit(null, true)}>
                Enrol anyway
              </button>
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
        </form>
      </Modal>

      {showCam && (
        <EnrolCamera
          onClose={() => setShowCam(false)}
          onDone={(r) => {
            setEnrol(r);
            setConsent(false);
            setShowCam(false);
          }}
        />
      )}
      {removeFace && (
        <ConfirmModal
          title="Remove face data"
          message={`Delete the stored face data of ${initial.name}? They will no longer be recognised until re-enrolled.`}
          confirmLabel="Remove"
          danger
          onClose={() => setRemoveFace(false)}
          onConfirm={async () => {
            try {
              await api(`/c/participants/${initial.id}/face`, { method: 'DELETE' });
              toast('Face data removed', 'ok');
              setRemoveFace(false);
              onSaved();
            } catch (err) {
              toast(err.message, 'error');
            }
          }}
        />
      )}
    </>
  );
}

export default function Participants() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [max, setMax] = useState(null);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null); // {type:'form', participant?} | {type:'delete', participant}

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([api('/c/participants'), api('/c/settings')]);
      setList(p.participants);
      setMax(s.company.max_participants);
    } catch (e) {
      toast(e.message, 'error');
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !list) return list;
    return list.filter((p) => [p.name, p.code, p.department, p.phone, p.email].some((v) => (v || '').toLowerCase().includes(s)));
  }, [list, q]);

  const enrolled = list?.filter((p) => p.faces > 0).length ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Participants</h1>
          <p>
            {list ? `${list.length}${max ? ` of ${max}` : ''} participants · ${enrolled} with a face enrolled` : 'Loading…'}
          </p>
        </div>
        <div className="row">
          <div className="search">
            <SearchIcon size={17} />
            <input type="search" placeholder="Search name, ID, department…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className="btn primary" onClick={() => setModal({ type: 'form' })}>
            <PlusIcon size={18} /> Add participant
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>ID</th>
              <th>Department</th>
              <th>Time in / out</th>
              <th>Contact</th>
              <th>Face</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown?.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="person">
                    <Avatar name={p.name} photo={p.photo} />
                    <b>{p.name}</b>
                  </div>
                </td>
                <td className="mono">{p.code || '—'}</td>
                <td>{p.department || '—'}</td>
                <td className="mono">
                  {p.time_in || <span className="muted">default</span>} / {p.time_out || <span className="muted">–</span>}
                </td>
                <td>
                  {p.phone || p.email ? (
                    <>
                      {p.phone}
                      {p.phone && p.email && <br />}
                      <span className="muted">{p.email}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <span className={`badge ${p.faces ? 'green' : 'amber'}`}>{p.faces ? `Enrolled · ${p.faces}` : 'No face'}</span>
                </td>
                <td>
                  <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    <button className="btn small" onClick={() => setModal({ type: 'form', participant: p })} aria-label={`Edit ${p.name}`}>
                      <EditIcon size={15} />
                    </button>
                    <button className="btn small danger" onClick={() => setModal({ type: 'delete', participant: p })} aria-label={`Delete ${p.name}`}>
                      <TrashIcon size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {list && !shown.length && (
              <tr>
                <td colSpan="6" className="empty">
                  {list.length ? 'Nobody matches that search.' : 'No participants yet. Click “Add participant” to enrol the first person.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal?.type === 'form' && (
        <ParticipantForm
          initial={modal.participant}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      )}
      {modal?.type === 'delete' && (
        <ConfirmModal
          title="Delete participant"
          message={`Delete ${modal.participant.name}, their face data and their attendance history? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onClose={() => setModal(null)}
          onConfirm={async () => {
            try {
              await api(`/c/participants/${modal.participant.id}`, { method: 'DELETE' });
              toast('Participant deleted', 'ok');
              setModal(null);
              load();
            } catch (err) {
              toast(err.message, 'error');
            }
          }}
        />
      )}
    </div>
  );
}
