import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { sendPasswordReset } from '@/lib/auth';

export default function ResetSenha() {
  const [email, setEmail] = useState('');
  const [feito, setFeito] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      await sendPasswordReset(email);
      setFeito(true);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao enviar e-mail');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-4 text-h1">Recuperar senha</h1>
        {feito ? (
          <div className="text-sm">
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
            <Button type="submit">Enviar</Button>
          </form>
        )}
        <div className="mt-4 text-xs text-muted-foreground">
          <Link to="/login" className="hover:underline">Voltar ao login</Link>
        </div>
      </Card>
    </div>
  );
}
