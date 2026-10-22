// Roteamento das mensagens internas do SW (ADR-0189). Separado do sw.ts para ser testável.
// Páginas da extensão (painel) têm o conjunto completo; content scripts rodam dentro da página
// do ML e só podem pedir leitura do anúncio e registrar erro de leitura.
import { chamarExtensao } from './api';
import { eanDaAba, esquecerAba, estadoDaAba, geracaoDaAba, novaPaginaNaAba, registrarEanDaAba, registrarEstado } from './abas';

// ponytail: Tasks 21/23 ampliam esta lista (busca/catálogo).
const ACOES_CONTENT_SCRIPT = new Set(['analisar_anuncio', 'erro_leitura']);

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Estado do painel é melhor esforço: falha de storage não derruba a análise (nem o selo).
 *  Só grava se a aba não navegou desde `geracao` (capturada antes da chamada à edge).
 *  ponytail: confere-e-grava não é atômico; janela de microssegundos entre dois awaits de storage. */
async function guardarEstado(tabId: number, geracao: string | null, entrada: object, resposta: unknown): Promise<void> {
  try {
    if ((await geracaoDaAba(tabId)) !== geracao) return;
    await registrarEstado(tabId, { entrada, resposta });
  } catch {
    return;
  }
  chrome.runtime.sendMessage({ tipo: 'publiai:estado-atualizado', tabId }).catch(() => {}); // painel fechado
}

/** `tabs.onUpdated`: a aba começou a carregar outra página → o painel não pode seguir mostrando o anúncio anterior.
 *  `status` vem sem a permissão `tabs`. */
export async function aoAtualizarAba(tabId: number, info: { status?: string }): Promise<void> {
  if (info.status !== 'loading') return;
  await novaPaginaNaAba(tabId).catch(() => {});
  chrome.runtime.sendMessage({ tipo: 'publiai:estado-atualizado', tabId }).catch(() => {});
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
    case 'publiai:estado-da-aba':
      if (!pagina || typeof msg.tabId !== 'number') return undefined;
      return estadoDaAba(msg.tabId);
    case 'publiai:reanalisar-aba': {
      // Painel refaz a análise da aba ao preço da página (após vínculo / "Tentar de novo") e atualiza o estado guardado.
      if (!pagina || typeof msg.tabId !== 'number') return undefined;
      const id = msg.tabId;
      return Promise.all([estadoDaAba(id), geracaoDaAba(id)]).then(async ([e, geracao]) => {
        const entrada = (e as { entrada?: Record<string, unknown> } | null)?.entrada;
        if (!entrada) return null;
        const resposta = await chamarExtensao({ acao: 'analisar_anuncio', tipoPagina: 'anuncio', ...entrada });
        await guardarEstado(id, geracao, entrada, resposta); // não regrava se a aba navegou durante a chamada
        return resposta;
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
        return Promise.all([eanDaAba(tabId!), geracaoDaAba(tabId!)]).then(async ([eanDaBusca, geracao]) => {
          const resposta = await chamarExtensao({ ...corpo, eanDaBusca });
          // Guarda também o erro: é por ele que o painel sabe de sem_sessao/modulo_desligado/limite.
          const { mlItemId, sellerId, catalogProductId, categoriaId, preco } = corpo;
          await guardarEstado(tabId!, geracao, { mlItemId, sellerId, catalogProductId, categoriaId, preco, eanDaBusca }, resposta);
          return resposta;
        });
      }
      return chamarExtensao(corpo);
    }
    case 'publiai:abrir-painel':
      if (tabId !== undefined) chrome.sidePanel.open({ tabId }).catch(() => {});
      return undefined;
  }
  return undefined;
}
