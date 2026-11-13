import { useQuery } from '@tanstack/react-query';
import { QK, fetchKitsVinculadosDaOrg, type KitVinculado } from '@/lib/queries';

/** Kits vinculados de toda a org (badges e filtro de kits em Publicados). */
export function useKitsVinculadosOrg() {
  return useQuery<KitVinculado[]>({
    queryKey: QK.kitsVinculadosOrg,
    queryFn: fetchKitsVinculadosDaOrg,
    staleTime: 30_000,
  });
}
