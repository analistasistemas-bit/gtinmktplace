import { useQuery } from '@tanstack/react-query';
import { buscarDetalheMLDasVendas } from '@/lib/faturamento';
import { agregarDetalheML, type DetalheMLPedido } from '@/lib/detalhe-ml-pedido';

/** Pagamento/cupom/tipo de anúncio de um pedido, lidos do `raw` só quando o detalhe monta. */
export function useDetalheMLPedido(vendaIds: string[]) {
  return useQuery<DetalheMLPedido>({
    queryKey: ['detalhe-ml-venda', ...vendaIds],
    queryFn: async () => agregarDetalheML(await buscarDetalheMLDasVendas(vendaIds)),
    staleTime: 5 * 60_000,
  });
}
