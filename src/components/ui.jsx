import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { XIcon } from './Icons.jsx';

// ---------------------------------------------------------------- toasts
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const id = useRef(0);
  const push = useCallback((message, kind = 'info') => {
    const n = ++id.current;
    setItems((l) => [...l, { n, message, kind }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.n !== n)), 3800);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.n} className={`toast ${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ----------------------------------------------------------------- modal
export function Modal({ title, onClose, children, footer, wide = false, closeOnBackdrop = true }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => closeOnBackdrop && e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn icon" onClick={onClose} aria-label="Close">
            <XIcon size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** In-page replacement for window.confirm (browser dialogs are awkward on kiosks). */
export function ConfirmModal({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? 'danger' : 'primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, lineHeight: 1.55 }}>{message}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------- avatar
const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

// Each person gets a stable soft colour so lists are easy to scan.
const hue = (name = '') => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function Avatar({ name, photo, size }) {
  if (photo) return <img className={`avatar ${size || ''}`} src={photo} alt="" />;
  const h = hue(name);
  return (
    <div className={`avatar ${size || ''}`} style={{ background: `hsl(${h} 70% 92%)`, color: `hsl(${h} 55% 28%)` }}>
      {initials(name) || '?'}
    </div>
  );
}

// --------------------------------------------------------------- helpers
export const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
export const fmtDateTime = (ts) =>
  new Date(ts).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });

/** Same confidence curve as the server (centred on the default threshold). */
export const scoreOf = (distance, threshold = 0.5) => Math.round(100 / (1 + Math.exp(12 * (distance - threshold))));

export function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** Re-runs `fn` every `ms` while mounted (also once immediately). */
export function usePolling(fn, ms, deps = []) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let alive = true;
    const run = () => alive && ref.current();
    run();
    const t = setInterval(run, ms);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);
}

export function useCopy() {
  const toast = useToast();
  return async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied', 'ok');
    } catch {
      toast('Could not copy - select the text and copy it manually', 'error');
    }
  };
}
