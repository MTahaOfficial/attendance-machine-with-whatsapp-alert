import { useAuth } from '../../auth.jsx';
import { BuildingIcon } from '../../components/Icons.jsx';
import Shell from '../../components/Shell.jsx';

export default function AdminLayout() {
  const { user, logout } = useAuth();
  return <Shell subtitle="Platform admin" who={user.name || user.email} onLogout={logout} items={[{ to: '/admin', label: 'Companies', icon: <BuildingIcon /> }]} />;
}
