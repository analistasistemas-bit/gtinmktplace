import { useQuery } from '@tanstack/react-query';
import { buscarResumoFinanceiro, type ResumoFinanceiro } from '@/lib/financeiro';
import type { Janela } from '@/lib/metricas';

export function useResumoFinanceiro(janela: Janela) {
  return useQuery<ResumoFinanceiro>({
    queryKey: ['resumoFinanceiro', janela.desde, janela.ate],
    queryFn: () => buscarResumoFinanceiro(janela),
    staleTime: 5 * 60_000,
  });
}
