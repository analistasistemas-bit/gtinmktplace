import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar, SidebarNav, BrandMark } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { Toaster } from '@/components/ui/sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { SupportBanner } from '@/components/support-banner';
import { useSupportStore } from '@/stores/support-store';

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const readOnlySupport = useSupportStore((state) => state.context?.scope === 'read');
  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <SupportBanner />
        <Topbar onOpenMobile={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-muted/30">
          {readOnlySupport ? (
            <fieldset disabled className="contents" aria-label="Operação em modo somente leitura">
              <legend className="sr-only">Modo de suporte somente leitura: alterações estão desativadas.</legend>
              <Outlet />
            </fieldset>
          ) : <Outlet />}
        </main>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[260px] p-0">
          <SheetHeader className="h-14 flex-row items-center border-b px-4">
            <SheetTitle className="flex items-center"><BrandMark /></SheetTitle>
          </SheetHeader>
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <Toaster />
    </div>
  );
}
