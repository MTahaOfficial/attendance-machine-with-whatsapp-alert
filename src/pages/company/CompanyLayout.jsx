import { useAuth } from '../../auth.jsx';
import { CameraIcon, GearIcon, ListIcon, UsersIcon } from '../../components/Icons.jsx';
import Shell from '../../components/Shell.jsx';

export default function CompanyLayout() {
  const { user, logout } = useAuth();
  const items = [
    { to: '/c/verify', label: 'Check in', icon: <CameraIcon /> },
    { to: '/c/participants', label: 'People', icon: <UsersIcon /> },
    { to: '/c/attendance', label: 'Attendance', icon: <ListIcon /> },
    { to: '/c/settings', label: 'Settings', icon: <GearIcon /> },
  ];
  return <Shell subtitle={user.company?.name} who={user.company?.name} onLogout={logout} items={items} />;
}
