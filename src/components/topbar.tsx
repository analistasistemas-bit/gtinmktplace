import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { signOut } from '@/lib/auth';

export function Topbar() {
  const { user } = useAuth();
  return (
    <header className="flex h-11 items-center justify-between border-b bg-background px-4 text-sm">
      <div className="text-muted-foreground">PubliAI</div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">{user?.email}</span>
        <Button size="sm" variant="ghost" onClick={() => signOut()}>
          Sair
        </Button>
      </div>
    </header>
  );
}
