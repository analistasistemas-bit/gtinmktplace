// Sessão da extensão vista pelo resto do SW (ADR-0189 D-4, emenda 2026-10-24). As credenciais são próprias
// (credenciais.ts: login, renovação, sair); o app web deixou de ser fonte de sessão.
// A identidade `usuário:org:suporte` (sem segredo) vem da ação `sessao` da edge via definirIdentidade: análises
// guardadas por aba valem só para ela — troca de identidade, saída ou refresh recusado apagam tudo
// (dado financeiro de outra org).
import { geracaoAtual, limparEstadosDasAbas } from './abas';
import { apagarCredenciais, geracaoCredenciais, lerCredenciais, naFila, regravarNaFila, tokenValido, type Perfil, type TokenValido } from './credenciais';

/** Contexto de um pedido: geração das credenciais (sobe em login/saída, síncrona) + geração da sessão
 *  (GERACAO_SESSAO: login, saída, troca de identidade, fim de suporte). Lida ANTES do token. */
export interface Marca { credenciais: number; sessao: number }
export async function marcaAtual(): Promise<Marca> {
  const credenciais = geracaoCredenciais();
  return { credenciais, sessao: await geracaoAtual() };
}
export const mesmaMarca = (a: Marca, b: Marca) => a.credenciais === b.credenciais && a.sessao === b.sessao;

// usuário obrigatório; org vazia = perfil ainda carregando; suporte vazio = fora de suporte.
const IDENTIDADE = /^[\w-]{1,64}:[\w-]{0,64}:[\w-]{0,64}$/;
const CHAVE_LEGADA = 'sessao';

/** 0.3.0: `publiai:sessao`/`publiai:desconectar` do app são ignorados — o token do app nunca vira sessão
 *  própria nem é revogado (é do app). */
export async function receberMensagemExterna(_msg: unknown, _sender: chrome.runtime.MessageSender): Promise<{ ok: false }> {
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
 *  outro usuário (resposta pedida antes de sair/entrar com outra conta). Identidade conhecida que muda limpa as abas. */
export function definirIdentidade(identidade: string, perfil: Perfil, marca?: Marca): Promise<boolean> {
  return naFila(async () => {
    // Pedido de outra geração (sair/entrar, troca, fim de suporte desde a marca): não grava. Na fila, a geração da
    // sessão só muda junto com a das credenciais (sair), que regravarNaFila confere sem await até o set.
    if (marca && (await geracaoAtual()) !== marca.sessao) return false;
    const valida = typeof identidade === 'string' && IDENTIDADE.test(identidade);
    // Identidade nova primeiro: chamada em voo da antiga já se vê descartada.
    const antes = await regravarNaFila((g) => valida && identidade.split(':')[0] === g.userId ? { ...g, identidade, perfil } : null, marca?.credenciais);
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
