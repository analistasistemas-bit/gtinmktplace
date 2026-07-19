import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AuthShell } from '@/components/auth-shell';
import { signIn } from '@/lib/auth';
import { durationMs } from '@/motion/tokens';

export default function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const dest = (loc.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      await signIn(email, senha);
      setSucesso(true);
      const reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => nav(dest, { replace: true }), reduz ? 0 : durationMs.overlay);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha no login');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <AuthShell subtitle="Publicação de anúncios para Marketplaces" saindo={sucesso}>
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
        <Button type="submit" disabled={carregando || sucesso} className={sucesso ? 'shadow-brand' : undefined}>
          {sucesso ? (
            <Check aria-label="Sucesso" className="duration-(--motion-duration-state) ease-success animate-in zoom-in-50" />
          ) : carregando ? (
            'Entrando…'
          ) : (
            'Entrar'
          )}
        </Button>
      </form>
      <div className="mt-4 flex justify-end text-xs text-muted-foreground">
        <Link to="/reset-senha" className="hover:underline">Esqueci a senha</Link>
      </div>
    </AuthShell>
  );
}
