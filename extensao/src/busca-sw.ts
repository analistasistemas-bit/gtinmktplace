// Busca no service worker (ADR-0189 D-11, Task 22): o content script manda os cards lidos; o painel pede a análise.
// O estado fica na mesma chave da aba (geração por página e por sessão): resposta atrasada de outra busca não volta.
import { chamarExtensao } from './api';
import { eanDaAba, lerAba, registrarEstado } from './abas';
import { normalizarCards, type CardBusca } from './leitura/busca';
import { identidadeAtual, seAindaIdentidade } from './sessao';
import type { ResultadoCard } from '../../supabase/functions/_shared/extensao/busca.ts';

export const MAX_POR_ANALISE = 50; // = MAX_ITENS_BUSCA da edge

export interface EstadoBusca {
  entrada: { tipoPagina: 'busca'; url: string };
  resposta: { resultados: Record<string, ResultadoCard> };
  observado: { cards: CardBusca[]; ocorrencias: number };
}

const ehBusca = (e: unknown): e is EstadoBusca => (e as { entrada?: { tipoPagina?: unknown } } | null)?.entrada?.tipoPagina === 'busca';

async function gravar(tabId: number, geracao: string | null, sessao: number, e: EstadoBusca): Promise<void> {
  await registrarEstado(tabId, { geracao, sessao, entrada: e.entrada, resposta: e.resposta, observado: e.observado });
  chrome.runtime.sendMessage({ tipo: 'publiai:estado-atualizado', tabId }).catch(() => {}); // painel fechado
}

/** Content script → cards lidos (os novos do scroll somam aos de antes, na mesma busca). */
export async function registrarCardsDaBusca(tabId: number, cardsBrutos: unknown, ocorrencias: unknown, url: unknown): Promise<{ ok: true }> {
  const cards = normalizarCards(cardsBrutos);
  if (typeof url !== 'string' || !/^https:\/\/lista\.mercadolivre\.com\.br\//.test(url)) return { ok: true };
  const { geracao, sessao, estado } = await lerAba(tabId);
  const antes = ehBusca(estado) ? estado : null;
  const porItem = new Map((antes?.observado.cards ?? []).map((c) => [c.itemId, c]));
  for (const c of cards) porItem.set(c.itemId, c);
  await gravar(tabId, geracao, sessao, {
    entrada: { tipoPagina: 'busca', url: url.split('#')[0] },
    resposta: { resultados: antes?.resposta.resultados ?? {} },
    observado: { cards: [...porItem.values()], ocorrencias: typeof ocorrencias === 'number' && ocorrencias >= 0 ? Math.min(ocorrencias, 1000) : porItem.size },
  });
  return { ok: true };
}

/** Painel → analisa os cards ainda sem resultado (ou que ficaram no limite), até 50, na ordem da busca.
 *  `forcar` = itens que o painel quer reanalisar mesmo com resultado (ex.: logo depois de vincular ao SKU). */
export async function analisarBuscaDaAba(tabId: number, forcar: string[] = []): Promise<unknown> {
  const identidade = await identidadeAtual();
  const { geracao, sessao, estado } = await lerAba(tabId);
  if (!ehBusca(estado)) return { ok: false, erro: 'payload_invalido' };
  const refazer = new Set(forcar);
  const pendentes = estado.observado.cards
    .filter((c) => c.preco !== null && (refazer.has(c.itemId) || !estado.resposta.resultados[c.itemId] || estado.resposta.resultados[c.itemId].estado === 'limite'))
    .slice(0, MAX_POR_ANALISE);
  if (pendentes.length === 0) return { ok: true, dados: { itens: [], limiteAtingido: false } };
  const resposta = await chamarExtensao<{ itens: ResultadoCard[]; limiteAtingido: boolean }>({
    acao: 'analisar_busca',
    eanDaBusca: await eanDaAba(tabId),
    itens: pendentes.map((c) => ({ itemId: c.itemId, catalogProductId: c.catalogProductId, preco: c.preco })),
  });
  if (!resposta.ok) return resposta;
  return (await seAindaIdentidade(identidade, async () => {
    // Só grava se a aba ainda é a mesma busca (geração) e sessão: resposta atrasada de outra busca é descartada.
    const atual = await lerAba(tabId);
    if (atual.geracao !== geracao || atual.sessao !== sessao || !ehBusca(atual.estado)) return { ok: false, erro: 'interno' };
    const resultados = { ...atual.estado.resposta.resultados };
    for (const r of resposta.dados.itens) resultados[r.itemId] = r;
    await gravar(tabId, geracao, sessao, { ...atual.estado, resposta: { resultados } });
    chrome.tabs.sendMessage(tabId, { tipo: 'publiai:busca-resultados', resultados }).catch(() => {});
    return resposta;
  })) ?? { ok: false, erro: 'sem_sessao' };
}

/** Painel → localiza e destaca o card na página (o DOM do ML não é reordenado). */
export function destacarCard(tabId: number, itemId: string): Promise<{ ok: true }> {
  chrome.tabs.sendMessage(tabId, { tipo: 'publiai:destacar-card', itemId }).catch(() => {});
  return Promise.resolve({ ok: true });
}
