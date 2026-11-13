import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { BrandMark } from '../components/Brand.jsx';

export default function Login() {
  const { user, ready, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (ready && user) return <Navigate to={user.role === 'superadmin' ? '/admin' : '/c/verify'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <section className="login-hero" aria-hidden="true">
        <div className="login-logo">
          <BrandMark size={40} />
          <b>Meridian</b>
        </div>
        <h2>Attendance that takes one look.</h2>
        <p>Step up to the camera, get recognised, and the register fills itself in.</p>
        <div className="demo-pass">
          <div className="demo-photo">AK</div>
          <div>
            <b>Welcome, Ayesha</b>
            <span>Checked in 8:52 AM</span>
          </div>
          <i className="stamp on">On time</i>
        </div>
      </section>
      <section className="login-form">
        <form onSubmit={submit}>
          <h1>Sign in</h1>
          <p className="sub">Use the login you were given for your company.</p>
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn primary big" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </div>
  );
}
