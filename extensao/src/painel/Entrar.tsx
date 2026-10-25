// Tela de login do painel (ADR-0189): mesmo e-mail e senha do app. A senha só viaja em `publiai:entrar`
// e é apagada do campo assim que o SW responde.
import { useState, type FormEvent } from 'react';
import { mensagemDeErro, type EstadoExt, type RespostaEstado } from './formato';

const ERROS_DE_LOGIN = ['credenciais_invalidas', 'rede', 'sem_acesso', 'modulo_desligado'];

export function Entrar({ onEstado }: { onEstado: (e: EstadoExt) => void }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const enviar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    let r: RespostaEstado | undefined;
    try {
      r = (await chrome.runtime.sendMessage({ tipo: 'publiai:entrar', email: email.trim(), senha })) as RespostaEstado | undefined;
    } catch {
      r = undefined;
    }
    setSenha('');
    setEnviando(false);
    if (r?.ok && typeof r.geracao === 'number') onEstado(r as EstadoExt);
    else setErro(r?.erro && ERROS_DE_LOGIN.includes(r.erro) ? mensagemDeErro(r.erro) : 'Não foi possível entrar. Tente de novo.');
  };

  return (
    <form className="cartao chamada entrar" onSubmit={enviar}>
      <div>
        <h2>Entrar no PubliAI</h2>
        <p>Use o mesmo e-mail e senha do app</p>
      </div>
      <div className="campos">
        <label className="campo">
          E-mail
          <span className="entrada">
            <input type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
          </span>
        </label>
        <label className="campo">
          Senha
          <span className="entrada">
            <input type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
          </span>
        </label>
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      <button type="submit" disabled={enviando}>Entrar</button>
    </form>
  );
}
