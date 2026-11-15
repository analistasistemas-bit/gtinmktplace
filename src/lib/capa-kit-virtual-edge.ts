// Capa do kit virtual por IA (edge `gerar-capa-kit-virtual`). Mesmo contrato e tratamento de erro do `gerar-foto-kit`:
// o corpo da falha (inclui a mensagem com o nome do componente nos 409) vem de `corpoDoErroDaEdge` em `invocar`.
import { invocar, type RespostaFotoKit } from '@/lib/kit-variacao-edge';

export type ComponenteCapaKitVirtual = { userProductId: string; itemId: string; quantidade: number; rotulo: string };

export function gerarCapaKitVirtualEdge(p: { requestId: string; componentes: ComponenteCapaKitVirtual[] }) {
  return invocar<RespostaFotoKit>('gerar-capa-kit-virtual', {
    request_id: p.requestId,
    componentes: p.componentes.map((c) => ({
      user_product_id: c.userProductId, item_id: c.itemId, quantidade: c.quantidade, rotulo: c.rotulo,
    })),
  });
}
