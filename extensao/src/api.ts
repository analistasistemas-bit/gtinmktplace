// Cliente da edge `extensao` (ADR-0189 D-17/D-18, emenda 2026-10-24: protocolo 2). fetch puro: sem supabase-js;
// a renovação é de credenciais.ts. Toda chamada leva a identidade esperada; resposta de outra identidade ou de
// outra geração da sessão nunca chega a quem pediu (dado financeiro de outra org).
import type { CodigoErro } from '../../supabase/functions/_shared/extensao/erros.ts';
import { geracaoAtual } from './abas';
import { sair, type Perfil, type TokenValido } from './credenciais';
import { definirIdentidade, identidadeAtual, limparAbasNaFila, limparSessao, obterSessaoValida } from './sessao';

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

const falha = (erro: Falha['erro']): Falha => ({ ok: false, erro });
// transitorio = falha de rede/429/5xx ao renovar: credenciais mantidas, a próxima chamada tenta de novo.
const semToken = (s: Exclude<TokenValido, Sessao>) => falha(s.erro === 'transitorio' ? 'interno' : 'sem_sessao');
const texto = (v: unknown) => (typeof v === 'string' ? v : null);

/** POST na edge no protocolo 2. Sucesso devolve o envelope ainda não conferido contra a identidade. */
async function postar(s: Sessao, corpo: object, identidadeEsperada: string | null): Promise<{ ok: true; identidade: string; dados: unknown } | Falha> {
  const geracao = await geracaoAtual();
  let r: Response;
  try {
    r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extensao`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${s.accessToken}`,
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
    await limparSessao(s.accessToken);
    return falha('sessao_expirada');
  }
  const json = (await r.json().catch(() => null)) as { identidade?: unknown; dados?: unknown; erro?: unknown } | null;
  // Pedida em outra sessão (sair/entrar, troca de identidade, fim de suporte): não chega a ninguém.
  // ponytail: 'sem_sessao' em vez de um código novo — quem pediu já está numa geração que descarta o resultado.
  if ((await geracaoAtual()) !== geracao || (await identidadeAtual()) !== s.identidade) return falha('sem_sessao');
  if (r.ok) {
    return json && typeof json.identidade === 'string' && 'dados' in json
      ? { ok: true, identidade: json.identidade, dados: json.dados }
      : falha('interno'); // 200 fora do envelope: sem identidade não há como saber de quem é o dado
  }

  const codigo = json?.erro;
  const erro = typeof codigo === 'string' && Object.hasOwn(CODIGOS, codigo) ? (codigo as CodigoErro) : 'interno';
  if (erro === 'sessao_expirada') await limparSessao(s.accessToken);
  // Suporte acabou: o token segue válido, mas o que foi analisado na org do suporte sai das abas.
  if (erro === 'sessao_suporte_expirada') await limparAbasNaFila();
  return falha(erro);
}

/** Ação `sessao` (sem identidade esperada: é ela que descobre a identidade) → definirIdentidade, que limpa as
 *  abas se uma identidade conhecida mudou. Perfil inativo/sem org (`sem_acesso`) → sai. */
async function consultarSessao(s: Sessao): Promise<{ ok: true } | Falha> {
  const r = await postar(s, { acao: 'sessao' }, null);
  if (!r.ok) {
    if (r.erro === 'sem_acesso') await sair();
    return r;
  }
  const d = r.dados as Record<string, unknown> | null;
  const perfil: Perfil = { nome: texto(d?.nome), email: texto(d?.email), orgNome: texto(d?.orgNome) };
  return (await definirIdentidade(r.identidade, perfil)) ? { ok: true } : falha('sem_sessao');
}

/** Busca identidade e perfil na edge e grava. true = logado com identidade conhecida. */
export async function atualizarSessao(): Promise<boolean> {
  const s = await obterSessaoValida();
  return !('erro' in s) && (await consultarSessao(s)).ok;
}

export async function chamarExtensao<T>(corpo: object): Promise<RespostaExtensao<T>> {
  let s = await obterSessaoValida();
  if ('erro' in s) return semToken(s);
  if (s.identidade === null) {
    // Recém-logado: descobre a identidade antes, para a ação sair já com a esperada.
    const r = await consultarSessao(s);
    if (!r.ok) return r;
    s = await obterSessaoValida();
    if ('erro' in s) return semToken(s);
    if (s.identidade === null) return falha('sem_sessao');
  }

  const r = await postar(s, corpo, s.identidade);
  if (r.ok && r.identidade === s.identidade) return { ok: true, dados: r.dados as T };
  if (r.ok || r.erro === 'identidade_mudou') {
    // Org/suporte mudou: o dado nunca é entregue e a ação não é refeita. Abas limpas antes (mesmo se a sessao
    // falhar), depois uma consulta à sessao para mostrar a identidade nova.
    await limparAbasNaFila();
    await atualizarSessao();
    return falha('identidade_mudou');
  }
  return r;
}
