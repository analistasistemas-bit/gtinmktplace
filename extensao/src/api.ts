// Cliente da edge `extensao` (ADR-0189 D-17/D-18, emenda 2026-10-24: protocolo 2). fetch puro: sem supabase-js;
// a renovação é de credenciais.ts. Toda chamada leva a identidade esperada; resposta de outra identidade ou de
// outra geração da sessão nunca chega a quem pediu (dado financeiro de outra org).
import type { CodigoErro } from '../../supabase/functions/_shared/extensao/erros.ts';
import { epocaAtual } from './abas';
import { sair, type Perfil, type TokenValido } from './credenciais';
import { definirIdentidade, limparAbasNaFila, limparSessao, obterSessaoValida } from './sessao';

const CODIGOS: Record<CodigoErro, true> = {
  sessao_expirada: true,
  sessao_suporte_expirada: true,
  modulo_desligado: true,
  limite: true,
  payload_invalido: true,
  identidade_mudou: true,
  sem_acesso: true,
  interno: true,
};

type Falha = { ok: false; erro: CodigoErro | 'sem_sessao' };
export type RespostaExtensao<T> = { ok: true; dados: T } | Falha;
type Sessao = { accessToken: string; identidade: string | null };
/** Token e identidade da época em que o pedido começou (abas.ts: epocaAtual). */
type Contexto = Sessao & { epoca: number };

const falha = (erro: Falha['erro']): Falha => ({ ok: false, erro });
const texto = (v: unknown) => (typeof v === 'string' ? v : null);

/** Época capturada (síncrona) antes do token e conferida depois: o token é da sessão dessa época. */
async function contexto(): Promise<Contexto | Falha> {
  const epoca = epocaAtual();
  const s: TokenValido = await obterSessaoValida();
  // transitorio = falha de rede/429/5xx ao renovar: credenciais mantidas, a próxima chamada tenta de novo.
  if ('erro' in s) return falha(s.erro === 'transitorio' ? 'interno' : 'sem_sessao');
  if (epoca !== epocaAtual()) return falha('sem_sessao');
  return { ...s, epoca };
}

/** Conferência SÍNCRONA, usada sem nenhum await até o uso (fetch disparado / resposta aceita no mesmo passo). */
const vale = (c: Contexto) => c.epoca === epocaAtual();

/** POST na edge no protocolo 2. Sucesso devolve o envelope ainda não conferido contra a identidade. */
async function postar(c: Contexto, corpo: object, identidadeEsperada: string | null): Promise<{ ok: true; identidade: string; dados: unknown } | Falha> {
  if (!vale(c)) return falha('sem_sessao'); // nada sai com o token de uma sessão que já acabou
  let r: Response;
  try {
    r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extensao`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.accessToken}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...corpo, protocolo: 2, ...(identidadeEsperada === null ? {} : { identidadeEsperada }) }),
    });
  } catch {
    return falha('interno');
  }

  // Qualquer 401 — inclusive o do gateway (verify_jwt), sem identidade. Saída só local (o token já foi recusado)
  // e só se as credenciais guardadas ainda são as desse token (renovação/outro login durante a chamada).
  if (r.status === 401) {
    await limparSessao(c.accessToken);
    return falha('sessao_expirada');
  }
  const json = (await r.json().catch(() => null)) as { identidade?: unknown; dados?: unknown; erro?: unknown } | null;
  // Pedida em outra sessão (sair/entrar, troca de identidade, fim de suporte): não chega a ninguém.
  // ponytail: 'sem_sessao' em vez de um código novo — quem pediu já está numa geração que descarta o resultado.
  if (!vale(c)) return falha('sem_sessao');
  if (r.ok) {
    return json && typeof json.identidade === 'string' && 'dados' in json
      ? { ok: true, identidade: json.identidade, dados: json.dados }
      : falha('interno'); // 200 fora do envelope: sem identidade não há como saber de quem é o dado
  }

  const codigo = json?.erro;
  const erro = typeof codigo === 'string' && Object.hasOwn(CODIGOS, codigo) ? (codigo as CodigoErro) : 'interno';
  if (erro === 'sessao_expirada') await limparSessao(c.accessToken);
  // Suporte acabou: o token segue válido, mas o que foi analisado na org do suporte sai das abas.
  // ponytail: limpeza sem conferir a época — limpar a mais só invalida estado (seguro); nunca grava dado.
  if (erro === 'sessao_suporte_expirada') await limparAbasNaFila();
  return falha(erro);
}

/** Ação `sessao` (sem identidade esperada: é ela que descobre a identidade) → definirIdentidade com a época do
 *  pedido (sair/entrar desde então → não grava), que limpa as abas se uma identidade conhecida mudou.
 *  Perfil inativo/sem org (`sem_acesso`) → sai. */
async function consultarSessao(c: Contexto): Promise<{ ok: true } | Falha> {
  const r = await postar(c, { acao: 'sessao' }, null);
  if (!r.ok) {
    if (r.erro === 'sem_acesso') await sair();
    return r;
  }
  const d = r.dados as Record<string, unknown> | null;
  const perfil: Perfil = { nome: texto(d?.nome), email: texto(d?.email), orgNome: texto(d?.orgNome) };
  return (await definirIdentidade(r.identidade, perfil, c.epoca)) ? { ok: true } : falha('sem_sessao');
}

/** Busca identidade e perfil na edge e grava. true = logado com identidade conhecida. */
export async function atualizarSessao(): Promise<boolean> {
  const c = await contexto();
  return !('erro' in c) && (await consultarSessao(c)).ok;
}

export async function chamarExtensao<T>(corpo: object): Promise<RespostaExtensao<T>> {
  let c = await contexto();
  if ('erro' in c) return c;
  if (c.identidade === null) {
    // Recém-logado: descobre a identidade antes, para a ação sair já com a esperada.
    const r = await consultarSessao(c);
    if (!r.ok) return r;
    c = await contexto();
    if ('erro' in c) return c;
    if (c.identidade === null) return falha('sem_sessao');
  }

  const r = await postar(c, corpo, c.identidade);
  if (r.ok && r.identidade === c.identidade) return { ok: true, dados: r.dados as T };
  if (r.ok || r.erro === 'identidade_mudou') {
    // Org/suporte mudou: o dado nunca é entregue e a ação não é refeita. Abas limpas antes (mesmo se a sessao
    // falhar), depois uma consulta à sessao para mostrar a identidade nova.
    await limparAbasNaFila();
    await atualizarSessao();
    return falha('identidade_mudou');
  }
  return r;
}
