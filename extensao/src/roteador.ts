// Roteamento das mensagens internas do SW (ADR-0189). Separado do sw.ts para ser testável.
// Páginas da extensão (painel) têm o conjunto completo; content scripts rodam dentro da página
// do ML e só podem pedir leitura do anúncio e registrar erro de leitura.
import { chamarExtensao } from './api';
import { eanDaAba, esquecerAba, estadoDaAba, registrarEanDaAba, registrarEstado } from './abas';

// ponytail: Tasks 21/23 ampliam esta lista (busca/catálogo).
const ACOES_CONTENT_SCRIPT = new Set(['analisar_anuncio', 'erro_leitura']);

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

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
    case 'publiai:chamar': {
      const corpo = msg.corpo;
      if (!ehObjeto(corpo) || typeof corpo.acao !== 'string') return Promise.resolve({ ok: false, erro: 'payload_invalido' });
      if (!pagina && !(tabId !== undefined && ACOES_CONTENT_SCRIPT.has(corpo.acao))) {
        return Promise.resolve({ ok: false, erro: 'payload_invalido' });
      }
      // O EAN da busca é sempre o da aba do remetente: content script não escolhe (nem lê) a aba alheia.
      if (!pagina && corpo.acao === 'analisar_anuncio') {
        return eanDaAba(tabId!).then(async (eanDaBusca) => {
          const resposta = await chamarExtensao({ ...corpo, eanDaBusca });
          // Guarda também o erro: é por ele que o painel sabe de sem_sessao/modulo_desligado/limite.
          const { mlItemId, sellerId, catalogProductId, categoriaId, preco } = corpo;
          await registrarEstado(tabId!, { entrada: { mlItemId, sellerId, catalogProductId, categoriaId, preco, eanDaBusca }, resposta });
          chrome.runtime.sendMessage({ tipo: 'publiai:estado-atualizado', tabId }).catch(() => {}); // painel fechado
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
