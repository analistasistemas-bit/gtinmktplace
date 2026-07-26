import { Navigate, useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/auth';
import { useProfile } from '@/hooks/useProfile';

export default function SemAcesso() {
  const nav = useNavigate();
  const { profile } = useProfile();
  if (profile?.is_super_admin) return <Navigate to="/admin" replace />;

  async function sair() {
    await signOut();
    nav('/login', { replace: true });
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm p-6 text-center">
        <h1 className="mb-2 text-h1">Sem acesso</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Você ainda não tem acesso a nenhum menu. Fale com o administrador para liberar.
        </p>
        <Button variant="outline" onClick={sair}>Sair</Button>
      </Card>
    </div>
  );
}
