// Sessão da extensão vista pelo resto do SW (ADR-0189 D-4, emenda 2026-10-24). As credenciais são próprias
// (credenciais.ts: login, renovação, sair); o app web deixou de ser fonte de sessão.
// A identidade `usuário:org:suporte` (sem segredo) vem da ação `sessao` da edge via definirIdentidade: análises
// guardadas por aba valem só para ela — troca de identidade, saída ou refresh recusado apagam tudo
// (dado financeiro de outra org).
import { epocaAtual, limparEstadosDasAbas, novaEpoca } from './abas';
import { apagarCredenciais, lerCredenciais, naFila, regravarNaFila, tokenValido, type Perfil, type TokenValido } from './credenciais';

// usuário obrigatório; org vazia = perfil ainda carregando; suporte vazio = fora de suporte.
const IDENTIDADE = /^[\w-]{1,64}:[\w-]{0,64}:[\w-]{0,64}$/;
const CHAVE_LEGADA = 'sessao';

/** 0.3.0: `publiai:sessao`/`publiai:desconectar` do app são ignorados — o token do app nunca vira sessão
 *  própria nem é revogado (é do app). */
export async function receberMensagemExterna(
  msg: unknown,
  _sender: chrome.runtime.MessageSender,
): Promise<{ ok: false } | { ok: true; versao: string; protocolo: 2 }> {
  // Só o ping responde (o app descobre versão/protocolo); a origem já é restrita pelo externally_connectable.
  if ((msg as { tipo?: unknown } | null)?.tipo === 'publiai:ping') {
    return { ok: true, versao: chrome.runtime.getManifest().version, protocolo: 2 };
  }
  return { ok: false };
}

/** Boot do SW: apaga a sessão empurrada pelo app na 0.2.x (sem rede: o token é do app) e, se havia, as análises
 *  feitas com ela. */
export function apagarSessaoLegada(): Promise<void> {
  return naFila(async () => {
    if ((await chrome.storage.session.get(CHAVE_LEGADA))[CHAVE_LEGADA] === undefined) return;
    await chrome.storage.session.remove(CHAVE_LEGADA);
    await limparEstadosDasAbas();
  });
}

/** Roda `fn` na fila só se a identidade guardada ainda é `identidade` (null = sem sessão ou ainda desconhecida);
 *  senão devolve null. Gravar estado/responder análise aqui dentro: troca de identidade ou saída no meio não
 *  deixam passar a resposta pedida antes. `fn` não pode chamar nada enfileirado. */
export function seAindaIdentidade<T>(identidade: string | null, fn: () => Promise<T>): Promise<T | null> {
  return naFila(async () => ((await lerCredenciais())?.identidade ?? null) === identidade ? fn() : null);
}

/** limparEstadosDasAbas fora da sessão (ex.: suporte acabou), em série com o resto. */
export const limparAbasNaFila = () => naFila(limparEstadosDasAbas);

/** Access token válido (renovado se preciso) e a identidade guardada. */
export const obterSessaoValida = (): Promise<TokenValido> => tokenValido();

/** Identidade guardada agora (ou null), para descartar resposta pedida por outra. */
export async function identidadeAtual(): Promise<string | null> {
  return (await lerCredenciais())?.identidade ?? null;
}

export async function perfilAtual(): Promise<Perfil | null> {
  return (await lerCredenciais())?.perfil ?? null;
}

/** Grava identidade e perfil da ação `sessao`. Ignorada (false) sem credenciais, com identidade malformada ou de
 *  outro usuário (resposta pedida antes de sair/entrar com outra conta) ou, com `epoca`, se a época mudou desde ela.
 *  Identidade conhecida que muda limpa as abas. */
export function definirIdentidade(identidade: string, perfil: Perfil, epoca?: number): Promise<boolean> {
  return naFila(async () => {
    const valida = typeof identidade === 'string' && IDENTIDADE.test(identidade);
    let muda = false;
    // Na conferência síncrona antes do set: pedido de outra época (sair/entrar/troca desde que começou) não grava;
    // identidade conhecida que muda abre época nova antes de ficar visível (chamada em voo da antiga é descartada).
    const conferir = () => {
      if (epoca !== undefined && epoca !== epocaAtual()) return false;
      if (muda) novaEpoca();
      return true;
    };
    const antes = await regravarNaFila((g) => {
      if (!valida || identidade.split(':')[0] !== g.userId) return null;
      muda = g.identidade !== null && g.identidade !== identidade;
      return { ...g, identidade, perfil };
    }, conferir);
    if (!antes) return false;
    if (antes.identidade !== null && antes.identidade !== identidade) await limparEstadosDasAbas();
    return true;
  });
}

/** 401 da edge: deslogado. Com `seAinda`, só se as credenciais guardadas ainda são as desse access token
 *  (uma renovação ou outro login pode ter gravado outro enquanto a chamada estava em voo). */
export function limparSessao(seAinda?: string): Promise<void> {
  return naFila(async () => {
    if (seAinda !== undefined && (await lerCredenciais())?.accessToken !== seAinda) return;
    await apagarCredenciais();
  });
}
