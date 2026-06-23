import { useQuery } from '@tanstack/react-query';
import { buscarCustos, type MapasCusto } from '@/lib/custos';

/** Custos cadastrados das variações (R$), para o markup dos KPIs. Cache longo (mudam pouco). */
export function useCustos() {
  return useQuery<MapasCusto>({
    queryKey: ['custos'],
    queryFn: buscarCustos,
    staleTime: 30 * 60_000,
  });
}
