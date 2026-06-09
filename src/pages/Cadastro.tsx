import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { signUp } from '@/lib/auth';

export default function Cadastro() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState(false);
  const nav = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      await signUp(email, senha);
      setFeito(true);
      setTimeout(() => nav('/login'), 1500);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha no cadastro');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-4 text-h1">Criar conta</h1>
        {feito ? (
          <div className="text-sm">
            Cadastro feito. Verifique seu e-mail para confirmar a conta.
            Redirecionando para o login…
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
            <Input
              type="password"
              placeholder="Senha (mín. 8 caracteres)"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              minLength={8}
              required
            />
            {erro && <div className="text-xs text-destructive">{erro}</div>}
            <Button type="submit">Cadastrar</Button>
          </form>
        )}
        <div className="mt-4 text-xs text-muted-foreground">
          Já tem conta? <Link to="/login" className="hover:underline">Entrar</Link>
        </div>
      </Card>
    </div>
  );
}
