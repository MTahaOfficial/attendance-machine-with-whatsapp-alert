import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import AdminLayout from './pages/admin/AdminLayout.jsx';
import Dashboard from './pages/admin/Dashboard.jsx';
import CompanyLayout from './pages/company/CompanyLayout.jsx';
import Verify from './pages/company/Verify.jsx';
import Participants from './pages/company/Participants.jsx';
import Attendance from './pages/company/Attendance.jsx';
import Settings from './pages/company/Settings.jsx';

const homeFor = (user) => (user.role === 'superadmin' ? '/admin' : '/c/verify');

function Guard({ role, children }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;
  return children;
}

function Home() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  return <Navigate to={user ? homeFor(user) : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />

      {/* Portal 1 - the platform owner */}
      <Route
        path="/admin"
        element={
          <Guard role="superadmin">
            <AdminLayout />
          </Guard>
        }
      >
        <Route index element={<Dashboard />} />
      </Route>

      {/* Portal 2 - the company */}
      <Route
        path="/c"
        element={
          <Guard role="company">
            <CompanyLayout />
          </Guard>
        }
      >
        <Route index element={<Navigate to="verify" replace />} />
        <Route path="verify" element={<Verify />} />
        <Route path="participants" element={<Participants />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Home />} />
    </Routes>
  );
}
