import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AuthShell } from '@/components/auth-shell';
import { sendPasswordReset } from '@/lib/auth';
import { durationMs } from '@/motion/tokens';

export default function ResetSenha() {
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [feito, setFeito] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await sendPasswordReset(email);
      setSucesso(true);
      const reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => setFeito(true), reduz ? 0 : durationMs.overlay);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao enviar e-mail');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="mb-4 text-h1">Recuperar senha</h1>
      {feito ? (
        <div className="duration-(--motion-duration-enter) ease-enter animate-in fade-in slide-in-from-bottom-2 text-sm">
          Se a conta existir, você receberá um e-mail com as instruções.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Input
            type="email"
            placeholder="email@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {erro && <div className="text-xs text-destructive">{erro}</div>}
          <Button type="submit" disabled={enviando || sucesso} className={sucesso ? 'shadow-brand' : undefined}>
            {sucesso ? (
              <Check aria-label="Sucesso" className="duration-(--motion-duration-state) ease-success animate-in zoom-in-50" />
            ) : (
              'Enviar'
            )}
          </Button>
        </form>
      )}
      <div className="mt-4 text-xs text-muted-foreground">
        <Link to="/login" className="hover:underline">Voltar ao login</Link>
      </div>
    </AuthShell>
  );
}
