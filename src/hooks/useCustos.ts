import { useQuery } from '@tanstack/react-query';
import { buscarCustos, type MapasCusto } from '@/lib/custos';
import { useOrgEfetivaId } from '@/hooks/useOrgEfetivaId';

/** Custos cadastrados das variações (R$), para o markup dos KPIs. Cache longo (mudam pouco). */
export function useCustos() {
  // Org no fim da chave: o prefixo ['custos'] segue casando nas invalidações.
  const orgId = useOrgEfetivaId();
  return useQuery<MapasCusto>({
    queryKey: ['custos', orgId],
    enabled: orgId != null,
    queryFn: buscarCustos,
    staleTime: 30 * 60_000,
  });
}
