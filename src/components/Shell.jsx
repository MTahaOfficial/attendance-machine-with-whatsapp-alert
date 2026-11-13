import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LogoutIcon } from './Icons.jsx';
import { BrandMark } from './Brand.jsx';

/** Side rail on tablets/laptops, bottom bar on phones. The kiosk page shrinks the rail to icons so the camera gets the room. */
export default function Shell({ items, subtitle, who, onLogout }) {
  const { pathname } = useLocation();
  const compact = pathname.endsWith('/verify');
  return (
    <div className={`app ${compact ? 'compact' : ''}`}>
      <aside className="rail">
        <div className="rail-brand">
          <BrandMark />
          <div className="rail-name">
            <b>Meridian</b>
            <span>{subtitle}</span>
          </div>
        </div>
        <nav className="rail-nav" aria-label="Main">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end title={it.label}>
              {it.icon}
              <span>{it.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="rail-foot">
          <div className="rail-who" title={who}>
            {who}
          </div>
          <button className="rail-out" onClick={onLogout} title="Sign out" aria-label="Sign out">
            <LogoutIcon size={18} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
