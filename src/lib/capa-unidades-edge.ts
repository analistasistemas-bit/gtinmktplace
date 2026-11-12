// ADR-0205: capa do kit vinculado com N unidades por IA (edge `gerar-capa-kit-unidades`). Mesmo contrato e mesmo
// tratamento de erro do `gerar-foto-kit` (corpo da falha via `corpoDoErroDaEdge`). A foto de origem é lida no servidor.
import { invocar, type RespostaFotoKit } from '@/lib/kit-variacao-edge';

export function gerarCapaUnidadesEdge(p: { requestId: string; familiaBaseId: string; n: number }) {
  return invocar<RespostaFotoKit>('gerar-capa-kit-unidades', {
    request_id: p.requestId, familia_base_id: p.familiaBaseId, n: p.n,
  });
}
