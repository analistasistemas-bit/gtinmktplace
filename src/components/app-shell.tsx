import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/sidebar';

export function AppShell() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-muted/30">
        <Outlet />
      </main>
    </div>
  );
}
