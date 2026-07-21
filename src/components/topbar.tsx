import { Link } from 'react-router-dom';
import { Menu, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import { NotificacoesBell } from '@/components/notificacoes-bell';
import { BrandMark } from '@/components/sidebar';
import { useProfile } from '@/hooks/useProfile';

export function Topbar({ onOpenMobile }: { onOpenMobile: () => void }) {
  const { profile } = useProfile();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b bg-background/80 px-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onOpenMobile}
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="lg:hidden">
          <BrandMark />
        </div>
      </div>
      <div className="flex items-center gap-1">
        {profile?.is_super_admin && (
          <Button asChild variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
            <Link to="/admin" aria-label="Admin da plataforma">
              <Building2 className="h-4 w-4" />
              <span className="hidden sm:inline">Admin da plataforma</span>
            </Link>
          </Button>
        )}
        <NotificacoesBell />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
