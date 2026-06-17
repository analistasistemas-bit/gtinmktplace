import { useQuery } from '@tanstack/react-query';
import { buscarMetricasVendas, type MetricasVendas, type PeriodoDias } from '@/lib/metricas';

export function useMetricasVendas(periodo: PeriodoDias) {
  return useQuery<MetricasVendas>({
    queryKey: ['metricasVendas', periodo],
    queryFn: () => buscarMetricasVendas(periodo),
    staleTime: 5 * 60_000,
  });
}
