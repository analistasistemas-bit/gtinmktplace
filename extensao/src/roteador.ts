// Roteamento das mensagens internas do SW (ADR-0189). Separado do sw.ts para ser testável.
// Páginas da extensão (painel) têm o conjunto completo; content scripts rodam dentro da página
// do ML e só podem pedir leitura do anúncio e registrar erro de leitura.
import { chamarExtensao } from './api';
import { dataCriacaoDoAnuncio } from './criacao';
import { identidadeAtual, obterSessaoValida, seAindaIdentidade } from './sessao';
import { eanDaAba, eanParaAnuncio, esquecerAba, esquecerAnuncioDaAba, estadoDaAba, lerAba, mesmoAnuncioNaAba, novaPaginaNaAba, registrarEanDaAba, registrarEstado } from './abas';

// ponytail: Tasks 21/23 ampliam esta lista (busca/catálogo).
const ACOES_CONTENT_SCRIPT = new Set(['analisar_anuncio', 'erro_leitura']);

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Estado do painel é melhor esforço: falha de storage não derruba a análise (nem o selo).
 *  Grava com as gerações (página e sessão) capturadas antes da chamada à edge; se mudaram, a leitura descarta. */
async function guardarEstado(tabId: number, geracao: string | null, sessao: number, entrada: object, resposta: unknown, observado?: object): Promise<void> {
  try {
    await registrarEstado(tabId, { geracao, sessao, entrada, resposta, observado });
  } catch {
    return;
  }
  chrome.runtime.sendMessage({ tipo: 'publiai:estado-atualizado', tabId }).catch(() => {}); // painel fechado
}

/** `tabs.onUpdated`: a aba foi para outro anúncio → o painel não pode seguir mostrando o anterior.
 *  `url` vem para abas do ML (host permission) e cobre o pushState; mesmo anúncio com outra URL (variação,
 *  hash, redirecionamento para /up/) mantém o painel. `loading` sem `url` (recarga ou saída do ML) limpa e
 *  esquece o anúncio da aba. */
export async function aoAtualizarAba(tabId: number, info: { status?: string; url?: string }): Promise<void> {
  if (info.url) {
    if (await mesmoAnuncioNaAba(tabId, info.url).catch(() => false)) return;
  } else if (info.status === 'loading') {
    await esquecerAnuncioDaAba(tabId).catch(() => {});
  } else return;
  await novaPaginaNaAba(tabId).catch(() => {});
  chrome.runtime.sendMessage({ tipo: 'publiai:estado-atualizado', tabId }).catch(() => {});
}

/** Data de criação (ADR-0189 emenda 2026-10-22) gravada no `observado` da aba depois da análise. */
async function completarCriacao(tabId: number, geracao: string | null, sessao: number, identidade: string | null, mlItemId: string): Promise<void> {
  const criadoEm = await dataCriacaoDoAnuncio(mlItemId);
  if (!criadoEm) return;
  await seAindaIdentidade(identidade, async () => {
    const atual = await lerAba(tabId);
    const e = atual.estado as { entrada: { mlItemId?: unknown }; resposta: unknown; observado?: object } | null;
    if (!e || atual.geracao !== geracao || atual.sessao !== sessao || e.entrada.mlItemId !== mlItemId) return;
    await guardarEstado(tabId, geracao, sessao, e.entrada, e.resposta, { ...e.observado, criadoEm });
  }).catch(() => {});
}

const SEM_SESSAO = { ok: false, erro: 'sem_sessao' } as const;

/** Resposta (e gravação) só se a identidade de quando a chamada começou ainda é a da sessão — conferido na
 *  fila da sessão, logo antes de gravar/responder. Trocou no meio → sem_sessao, nada gravado. */
async function naMesmaIdentidade(identidade: string | null, fn: () => Promise<unknown>): Promise<unknown> {
  return (await seAindaIdentidade(identidade, fn)) ?? SEM_SESSAO;
}

function ehPaginaDaExtensao(sender: chrome.runtime.MessageSender): boolean {
  return !sender.tab && !!sender.url?.startsWith(chrome.runtime.getURL(''));
}

/** undefined = sem resposta assíncrona. Síncrono até o `sidePanel.open` (exige o gesto do usuário). */
export function rotearMensagem(msg: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> | undefined {
  if (sender.id !== chrome.runtime.id || !ehObjeto(msg)) return undefined;
  const tabId = sender.tab?.id;
  const pagina = ehPaginaDaExtensao(sender);

  switch (msg.tipo) {
    case 'publiai:ean-da-busca':
      if (tabId === undefined) return undefined;
      // null = a busca atual não é um EAN: esquece o da aba (evita casar anúncio com o SKU de outra busca).
      if (msg.ean === null) return esquecerAba(tabId).then(() => ({ ok: true }));
      if (typeof msg.ean !== 'string' || !/^\d{8,14}$/.test(msg.ean)) return undefined;
      return registrarEanDaAba(tabId, msg.ean).then(() => ({ ok: true }));
    case 'publiai:ean-da-aba':
      if (!pagina || typeof msg.tabId !== 'number') return undefined;
      return eanDaAba(msg.tabId);
    case 'publiai:estado-da-aba': {
      if (!pagina || typeof msg.tabId !== 'number') return undefined;
      const id = msg.tabId;
      // Confere a sessão antes: expirada, ela e as análises somem (o painel aberto depois não vê dado velho).
      return obterSessaoValida().then(() => estadoDaAba(id));
    }
    case 'publiai:reanalisar-aba': {
      // Painel refaz a análise da aba ao preço da página (após vínculo / "Tentar de novo") e atualiza o estado guardado.
      if (!pagina || typeof msg.tabId !== 'number') return undefined;
      const id = msg.tabId;
      return Promise.all([lerAba(id), identidadeAtual()]).then(async ([{ estado: e, geracao, sessao }, identidade]) => {
        const entrada = (e as { entrada?: Record<string, unknown> } | null)?.entrada;
        if (!entrada) return null;
        const resposta = await chamarExtensao({ acao: 'analisar_anuncio', tipoPagina: 'anuncio', ...entrada });
        return naMesmaIdentidade(identidade, async () => {
          await guardarEstado(id, geracao, sessao, entrada, resposta, e?.observado); // não regrava se a aba navegou durante a chamada
          return resposta;
        });
      });
    }
    case 'publiai:chamar': {
      const corpo = msg.corpo;
      if (!ehObjeto(corpo) || typeof corpo.acao !== 'string') return Promise.resolve({ ok: false, erro: 'payload_invalido' });
      if (!pagina && !(tabId !== undefined && ACOES_CONTENT_SCRIPT.has(corpo.acao))) {
        return Promise.resolve({ ok: false, erro: 'payload_invalido' });
      }
      // O EAN da busca é sempre o da aba do remetente: content script não escolhe (nem lê) a aba alheia.
      if (!pagina && corpo.acao === 'analisar_anuncio') {
        const ean = typeof corpo.mlItemId === 'string' ? eanParaAnuncio(tabId!, corpo.mlItemId) : Promise.resolve(null);
        return Promise.all([ean, lerAba(tabId!), identidadeAtual()]).then(async ([eanDaBusca, { geracao, sessao }, identidade]) => {
          // vendidosTexto e a data de criação ficam só no navegador (painel): a edge não recebe (ADR-0189 D-1/D-9).
          const { vendidosTexto, ...paraEdge } = corpo;
          const resposta = await chamarExtensao({ ...paraEdge, eanDaBusca });
          // Guarda também o erro: é por ele que o painel sabe de sem_sessao/modulo_desligado/limite.
          // tipoPagina vai junto: reanálise e confirmação de preço do painel espalham a entrada guardada.
          const { tipoPagina, mlItemId, sellerId, catalogProductId, categoriaId, preco } = corpo;
          const observado = { vendidosTexto: typeof vendidosTexto === 'string' ? vendidosTexto : null, criadoEm: null };
          const r = await naMesmaIdentidade(identidade, async () => {
            await guardarEstado(tabId!, geracao, sessao, { tipoPagina, mlItemId, sellerId, catalogProductId, categoriaId, preco, eanDaBusca }, resposta, observado);
            return resposta;
          });
          // A data não segura o selo: chega depois e só entra se a aba ainda é a mesma página e sessão.
          if (typeof mlItemId === 'string') void completarCriacao(tabId!, geracao, sessao, identidade, mlItemId);
          return r;
        });
      }
      return identidadeAtual().then(async (identidade) => {
        const resposta = await chamarExtensao(corpo);
        return naMesmaIdentidade(identidade, async () => resposta);
      });
    }
    case 'publiai:abrir-painel':
      if (tabId !== undefined) chrome.sidePanel.open({ tabId }).catch(() => {});
      return undefined;
  }
  return undefined;
}
