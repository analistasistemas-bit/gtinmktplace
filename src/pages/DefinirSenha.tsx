import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AuthShell } from '@/components/auth-shell';
import { durationMs } from '@/motion/tokens';
import type { EmailOtpType } from '@supabase/supabase-js';

export default function DefinirSenha() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [senha, setSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  useEffect(() => {
    const token_hash = params.get('token_hash');
    const type = (params.get('type') ?? 'invite') as EmailOtpType;
    if (!token_hash) {
      setErro('Link inválido ou expirado.');
      return;
    }
    supabase.auth.verifyOtp({ token_hash, type }).then(({ error }) => {
      if (error) setErro('Link inválido ou expirado.');
      else setReady(true);
    });
  }, [params]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setSalvando(false);
    if (error) {
      setErro(error.message);
      return;
    }
    setSucesso(true);
    const reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => navigate('/', { replace: true }), reduz ? 0 : durationMs.overlay);
  }

  return (
    <AuthShell subtitle="Defina sua senha de acesso" saindo={sucesso}>
      {erro && !ready ? (
        <div className="text-center text-sm">
          <p className="mb-4 text-destructive">{erro}</p>
          <Link to="/login" className="text-xs text-muted-foreground hover:underline">Voltar ao login</Link>
        </div>
      ) : !ready ? (
        <div className="text-center text-sm text-muted-foreground">Validando link…</div>
      ) : (
        <form onSubmit={salvar} className="flex flex-col gap-3">
          <Input
            type="password"
            placeholder="Nova senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
          {erro && <div className="text-xs text-destructive">{erro}</div>}
          <Button type="submit" disabled={salvando || sucesso} className={sucesso ? 'shadow-brand' : undefined}>
            {sucesso ? (
              <Check aria-label="Sucesso" className="duration-(--motion-duration-state) ease-success animate-in zoom-in-50" />
            ) : salvando ? (
              'Salvando…'
            ) : (
              'Definir senha e entrar'
            )}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
