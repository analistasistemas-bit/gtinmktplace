import { useQuery } from '@tanstack/react-query';
import { buscarVendas, type Venda, type OrigemVenda } from '@/lib/faturamento';
import type { Janela } from '@/lib/metricas';

export function useVendas(janela: Janela, origem: OrigemVenda) {
  return useQuery<Venda[]>({
    queryKey: ['vendas', janela.desde, janela.ate, origem],
    queryFn: () => buscarVendas(janela, origem),
    staleTime: 5 * 60_000,
  });
}
