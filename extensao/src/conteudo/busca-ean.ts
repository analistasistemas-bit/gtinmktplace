// Content script da busca (lista.mercadolivre.com.br): registra o EAN digitado, por aba.
// Sempre envia o resultado, inclusive null, para o SW esquecer um EAN de busca anterior.
import { eanDaUrlDeBusca } from './ean';

try {
  chrome.runtime.sendMessage({ tipo: 'publiai:ean-da-busca', ean: eanDaUrlDeBusca(location.href) }).catch(() => {});
} catch {
  // Extension context invalidated (extensão recarregada): silencioso.
}
