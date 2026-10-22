// Content script da busca (lista.mercadolivre.com.br): só registra o EAN digitado, por aba.
import { eanDaUrlDeBusca } from './ean';

const ean = eanDaUrlDeBusca(location.href);
if (ean) chrome.runtime.sendMessage({ tipo: 'publiai:ean-da-busca', ean }).catch(() => {});
