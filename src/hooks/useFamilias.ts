import { useQuery, type Query } from '@tanstack/react-query';
import { QK, fetchFamilias, familiaFromRow, fetchFamiliasResumo, type FamiliaResumo } from '@/lib/queries';
import type { Familia } from '@/lib/tipos-dominio';

type RefetchInterval<T> =
  | number
  | false
  | ((query: Query<T, Error>) => number | false | undefined);

export function useFamilias(
  loteId: string | undefined,
  options?: { refetchInterval?: RefetchInterval<Familia[]> }
) {
  return useQuery<Familia[]>({
    queryKey: QK.familias(loteId ?? ''),
    queryFn: async () => (await fetchFamilias(loteId!)).map(familiaFromRow),
    enabled: !!loteId,
    refetchInterval: options?.refetchInterval,
  });
}

export function useFamiliasResumo(
  loteId: string | undefined,
  options?: { refetchInterval?: RefetchInterval<FamiliaResumo[]> }
) {
  return useQuery<FamiliaResumo[]>({
    queryKey: QK.familiasResumo(loteId ?? ''),
    queryFn: () => fetchFamiliasResumo(loteId!),
    enabled: !!loteId,
    refetchInterval: options?.refetchInterval,
  });
}
