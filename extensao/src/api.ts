// Cliente da edge `extensao` (ADR-0189 D-17/D-18). fetch puro: sem supabase-js, sem refresh.
import type { CodigoErro } from '../../supabase/functions/_shared/extensao/erros.ts';
import { identidadeAtual, limparAbasNaFila, limparSessao, obterSessaoValida } from './sessao';

const CODIGOS: Record<CodigoErro, true> = {
  sessao_expirada: true,
  sessao_suporte_expirada: true,
  modulo_desligado: true,
  limite: true,
  payload_invalido: true,
  interno: true,
};

export type RespostaExtensao<T> = { ok: true; dados: T } | { ok: false; erro: CodigoErro | 'sem_sessao' };

export async function chamarExtensao<T>(corpo: object): Promise<RespostaExtensao<T>> {
  const sessao = await obterSessaoValida();
  if (!sessao) return { ok: false, erro: 'sem_sessao' };

  let r: Response;
  try {
    r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extensao`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessao.accessToken}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(corpo),
    });
  } catch {
    return { ok: false, erro: 'interno' };
  }

  // Qualquer 401 — inclusive o do gateway (verify_jwt), cujo corpo não segue o contrato.
  if (r.status === 401) {
    await limparSessao(sessao.accessToken);
    return { ok: false, erro: 'sessao_expirada' };
  }
  const json: unknown = await r.json().catch(() => null);
  // Resposta pedida por outra identidade (logout/troca de conta/suporte durante a chamada) não chega a ninguém.
  if ((await identidadeAtual()) !== sessao.identidade) return { ok: false, erro: 'sem_sessao' };
  if (r.ok) return { ok: true, dados: json as T };

  const codigo = (json as { erro?: unknown } | null)?.erro;
  const erro = typeof codigo === 'string' && Object.hasOwn(CODIGOS, codigo) ? (codigo as CodigoErro) : 'interno';
  if (erro === 'sessao_expirada') await limparSessao(sessao.accessToken);
  // Suporte acabou: o token segue válido, mas o que foi analisado na org do suporte sai das abas.
  if (erro === 'sessao_suporte_expirada') await limparAbasNaFila();
  return { ok: false, erro };
}
