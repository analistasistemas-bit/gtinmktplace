// Busca no service worker (ADR-0189 D-11, Task 22): o content script manda os cards lidos; o painel pede a análise.
// O estado fica na mesma chave da aba (geração por página e por sessão): resposta atrasada de outra busca não volta.
import { chamarExtensao } from './api';
import { lerAba, registrarEstado } from './abas';
import { eanDaUrlDeBusca } from './conteudo/ean';
import { normalizarCards, type CardBusca } from './leitura/busca';
import { identidadeAtual, seAindaIdentidade } from './sessao';
import type { ResultadoCard } from '../../supabase/functions/_shared/extensao/busca.ts';

export const MAX_POR_ANALISE = 50; // = MAX_ITENS_BUSCA da edge

export interface EstadoBusca {
  entrada: { tipoPagina: 'busca'; url: string };
  resposta: { resultados: Record<string, ResultadoCard> };
  observado: { cards: CardBusca[]; ocorrencias: number };
}

export const ehBusca = (e: unknown): e is EstadoBusca => (e as { entrada?: { tipoPagina?: unknown } } | null)?.entrada?.tipoPagina === 'busca';

async function gravar(tabId: number, geracao: string | null, sessao: number, e: EstadoBusca): Promise<void> {
  await registrarEstado(tabId, { geracao, sessao, entrada: e.entrada, resposta: e.resposta, observado: e.observado });
  chrome.runtime.sendMessage({ tipo: 'publiai:estado-atualizado', tabId }).catch(() => {}); // painel fechado
}

// Filas por aba (memória do SW): `escritas` serializa todo ler-modificar-gravar do estado da busca (cards do scroll ×
// resultado da análise); `analises` faz a 2ª análise esperar a 1ª e mandar só o que ainda falta (cota debitada uma vez).
const escritas = new Map<number, Promise<unknown>>();
const analises = new Map<number, Promise<unknown>>();
function naFila<T>(filas: Map<number, Promise<unknown>>, tabId: number, fn: () => Promise<T>): Promise<T> {
  const r = (filas.get(tabId) ?? Promise.resolve()).catch(() => {}).then(fn);
  const fim = r.catch(() => {});
  filas.set(tabId, fim);
  void fim.then(() => { if (filas.get(tabId) === fim) filas.delete(tabId); });
  return r;
}

/** Content script → cards lidos (os novos do scroll somam aos de antes, na mesma busca). Card reenviado com preço ou
 *  catálogo diferente perde o resultado (volta a pendente); outra URL de busca começa do zero. */
export function registrarCardsDaBusca(tabId: number, cardsBrutos: unknown, ocorrencias: unknown, url: unknown): Promise<{ ok: true }> {
  const cards = normalizarCards(cardsBrutos);
  if (typeof url !== 'string' || !/^https:\/\/lista\.mercadolivre\.com\.br\//.test(url)) return Promise.resolve({ ok: true });
  const semHash = url.split('#')[0];
  return naFila(escritas, tabId, async () => {
    const { geracao, sessao, estado } = await lerAba(tabId);
    const antes = ehBusca(estado) && estado.entrada.url === semHash ? estado : null;
    const porItem = new Map((antes?.observado.cards ?? []).map((c) => [c.itemId, c]));
    const resultados = { ...(antes?.resposta.resultados ?? {}) };
    let descartou = false;
    for (const c of cards) {
      const velho = porItem.get(c.itemId);
      if (velho && (velho.preco !== c.preco || velho.catalogProductId !== c.catalogProductId) && resultados[c.itemId]) {
        delete resultados[c.itemId];
        descartou = true;
      }
      porItem.set(c.itemId, c);
    }
    await gravar(tabId, geracao, sessao, {
      entrada: { tipoPagina: 'busca', url: semHash },
      resposta: { resultados },
      observado: { cards: [...porItem.values()], ocorrencias: typeof ocorrencias === 'number' && ocorrencias >= 0 ? Math.min(ocorrencias, 1000) : porItem.size },
    });
    if (descartou) chrome.tabs.sendMessage(tabId, { tipo: 'publiai:busca-resultados', resultados }).catch(() => {});
    return { ok: true as const };
  });
}

/** Painel → analisa os cards ainda sem resultado (ou que ficaram no limite), até 50, na ordem da busca.
 *  `forcar` = itens que o painel quer reanalisar mesmo com resultado (ex.: logo depois de vincular ao SKU). */
export function analisarBuscaDaAba(tabId: number, forcar: string[] = []): Promise<unknown> {
  return naFila(analises, tabId, () => analisar(tabId, forcar));
}

async function analisar(tabId: number, forcar: string[]): Promise<unknown> {
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
    // EAN da própria busca analisada (o guardado na aba pode ser de outra busca da mesma aba)
    eanDaBusca: eanDaUrlDeBusca(estado.entrada.url),
    itens: pendentes.map((c) => ({ itemId: c.itemId, catalogProductId: c.catalogProductId, preco: c.preco })),
  });
  if (!resposta.ok) return resposta;
  const enviados = new Map(pendentes.map((c) => [c.itemId, c]));
  return (await seAindaIdentidade(identidade, () => naFila(escritas, tabId, async () => {
    // Só grava se a aba ainda é a mesma busca (geração, sessão e URL): resposta atrasada de outra busca é descartada.
    const atual = await lerAba(tabId);
    if (atual.geracao !== geracao || atual.sessao !== sessao || !ehBusca(atual.estado) || atual.estado.entrada.url !== estado.entrada.url) {
      return { ok: false, erro: 'interno' };
    }
    const agora = new Map(atual.estado.observado.cards.map((c) => [c.itemId, c]));
    const resultados = { ...atual.estado.resposta.resultados };
    for (const r of resposta.dados.itens) {
      // Card que mudou preço/catálogo durante a análise fica pendente (o resultado é do card antigo).
      const e = enviados.get(r.itemId), a = agora.get(r.itemId);
      if (e && a && (a.preco !== e.preco || a.catalogProductId !== e.catalogProductId)) continue;
      resultados[r.itemId] = r;
    }
    await gravar(tabId, geracao, sessao, { ...atual.estado, resposta: { resultados } });
    chrome.tabs.sendMessage(tabId, { tipo: 'publiai:busca-resultados', resultados }).catch(() => {});
    return resposta;
  }))) ?? { ok: false, erro: 'sem_sessao' };
}

/** Painel → localiza e destaca o card na página (o DOM do ML não é reordenado). */
export function destacarCard(tabId: number, itemId: string): Promise<{ ok: true }> {
  chrome.tabs.sendMessage(tabId, { tipo: 'publiai:destacar-card', itemId }).catch(() => {});
  return Promise.resolve({ ok: true });
}
