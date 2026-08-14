import { useCallback } from 'react';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { queryClient } from '@/lib/query-client';
import { QK } from '@/lib/queries';
import { fetchProdutosEstoqueResumo, fetchCanaisPorProduto } from '@/lib/produtos-saldo';

export function usePrefetchEstoque() {
  const { data: modulos } = useModulosHabilitados();

  const prefetchEstoque = useCallback(() => {
    if (!modulos?.includes('estoque')) return;
    void Promise.all([
      queryClient.prefetchQuery({
        queryKey: QK.produtosEstoqueResumo,
        queryFn: fetchProdutosEstoqueResumo,
        staleTime: 180_000,
      }),
      queryClient.prefetchQuery({
        queryKey: QK.canaisPorProduto,
        queryFn: fetchCanaisPorProduto,
        staleTime: 120_000,
      }),
    ]);
  }, [modulos]);

  return { prefetchEstoque };
}
