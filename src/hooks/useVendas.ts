import { useQuery } from '@tanstack/react-query';
import { buscarVendas, type Venda, type OrigemVenda } from '@/lib/faturamento';
import type { Janela } from '@/lib/metricas';

export function useVendas(janela: Janela, origem: OrigemVenda) {
  return useQuery<Venda[]>({
    queryKey: ['vendas', janela.desde, janela.ate, origem],
    queryFn: () => buscarVendas(janela, origem),
    staleTime: 5 * 60_000,
    // Tempo real "leve": re-busca a cada 45s enquanto a aba está aberta e ao voltar o foco,
    // para a venda incorporada pelo webhook (ADR-0037) aparecer sozinha, sem clicar Sincronizar.
    // refetchIntervalInBackground fica off (default) → não consome quando a aba não está visível.
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });
}
