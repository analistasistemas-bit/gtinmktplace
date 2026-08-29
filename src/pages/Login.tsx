import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
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
  // Preserva `search` além do `pathname` (ADR-0091): o retorno do OAuth do ML carrega o id de
  // confirmação na query, e descartá-lo aqui fazia a conexão sumir em silêncio quando a sessão
  // expirava durante a autorização. Segue best-effort — `loc.state` vive em memória, então
  // recarregar o login ou abri-lo em outra aba perde o `from` inteiro, com ou sem search.
  const from = (loc.state as { from?: { pathname?: string; search?: string } } | null)?.from;
  const dest = from?.pathname ? `${from.pathname}${from.search ?? ''}` : '/';

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
      setCarregando(false);
    }
  }

  return (
    <AuthShell
      subtitle="Publicação de anúncios para Marketplaces"
      saindo={sucesso}
      carregando={carregando}
      sucesso={sucesso}
    >
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
        <Button type="submit" disabled={carregando || sucesso}>
          Entrar
        </Button>
      </form>
      <div className="mt-4 flex justify-end text-xs text-muted-foreground">
        <Link to="/reset-senha" className="hover:underline">Esqueci a senha</Link>
      </div>
    </AuthShell>
  );
}
