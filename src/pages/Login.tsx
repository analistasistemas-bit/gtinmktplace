import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Logo } from '@/components/ui/logo';
import { signIn } from '@/lib/auth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const dest = (loc.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      await signIn(email, senha);
      nav(dest, { replace: true });
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha no login');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="mb-2" symbolClassName="h-9 w-9" />
          <p className="text-caption">Publicação de anúncios no Mercado Livre</p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Input
            type="email"
            placeholder="email@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <Input
            type="password"
            placeholder="Senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
            autoComplete="current-password"
          />
          {erro && <div className="text-xs text-destructive">{erro}</div>}
          <Button type="submit" disabled={carregando}>
            {carregando ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
        <div className="mt-4 flex justify-between text-xs text-muted-foreground">
          <Link to="/cadastro" className="hover:underline">Criar conta</Link>
          <Link to="/reset-senha" className="hover:underline">Esqueci a senha</Link>
        </div>
      </Card>
    </div>
  );
}
