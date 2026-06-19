import { useQuery } from '@tanstack/react-query';
import { buscarResumoFinanceiro, type ResumoFinanceiro } from '@/lib/financeiro';
import type { PeriodoDias } from '@/lib/metricas';

export function useResumoFinanceiro(periodo: PeriodoDias) {
  return useQuery<ResumoFinanceiro>({
    queryKey: ['resumoFinanceiro', periodo],
    queryFn: () => buscarResumoFinanceiro(periodo),
    staleTime: 5 * 60_000,
  });
}
