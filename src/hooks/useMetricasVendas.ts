import { useQuery } from '@tanstack/react-query';
import { buscarMetricasVendas, type MetricasVendas, type Janela } from '@/lib/metricas';

export function useMetricasVendas(janela: Janela) {
  return useQuery<MetricasVendas>({
    queryKey: ['metricasVendas', janela.desde, janela.ate],
    queryFn: () => buscarMetricasVendas(janela),
    staleTime: 5 * 60_000,
  });
}
