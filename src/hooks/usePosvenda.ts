import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { buscarFilaPosvenda, buscarProdutosPedidos, buscarTentativasAtivas } from '@/lib/posvenda';
import { classificar, resumirPedido, type ProdutoPedido, type ItemPedido } from '@/lib/posvenda-fila';
import { montarFotoResolver } from '@/lib/fotos-produto';
import type { VendaItem } from '@/lib/faturamento';
import { useResumoMensagens } from '@/hooks/useMensagens';
import { useFotosProduto } from '@/hooks/useFotosProduto';
import { useAnuncioCanonico } from '@/hooks/useAnuncioCanonico';

export const QK_POSVENDA = ['posvenda'] as const;

export function useFilaPosvenda() {
  return useQuery({ queryKey: [...QK_POSVENDA, 'fila'], queryFn: buscarFilaPosvenda, staleTime: 60_000 });
}

export function useTentativasAtivas() {
  return useQuery({ queryKey: [...QK_POSVENDA, 'acoes'], queryFn: buscarTentativasAtivas, staleTime: 15_000 });
}

/** Produto/quantidade/valor/foto por order_id (vínculo ml_vendas → ml_vendas_itens + resolvedor de fotos). */
export function useProdutosPedidos(orderIds: Array<number | null | undefined>): Map<number, ProdutoPedido> {
  const ids = [...new Set(orderIds.filter((o): o is number => o != null))].sort((a, b) => a - b);
  const q = useQuery({
    queryKey: [...QK_POSVENDA, 'produtos', ids], enabled: ids.length > 0, staleTime: 5 * 60_000,
    queryFn: () => buscarProdutosPedidos(ids),
  });
  const { data: fotos } = useFotosProduto();
  const { data: canonico } = useAnuncioCanonico();
  return useMemo(() => {
    const resolver = montarFotoResolver(fotos, canonico);
    const out = new Map<number, ProdutoPedido>();
    for (const [id, v] of q.data ?? []) {
      // Falha na foto nunca derruba o card: sem foto → ícone.
      const r = resumirPedido(v.itens, (i: ItemPedido) => resolver(i as VendaItem));
      if (r) out.set(id, r);
    }
    return out;
  }, [q.data, fotos, canonico]);
}

/** Badge da aba Pós-venda: urgentes + mensagens não lidas. */
export function usePosvendaBadge(): number {
  const fila = useFilaPosvenda().data;
  const naoLidas = useResumoMensagens().data?.naoLidas.total ?? 0;
  return (fila ?? []).filter((d) => classificar(d) === 'urgente').length + naoLidas;
}
