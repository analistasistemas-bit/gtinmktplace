import { useQuery, type Query } from '@tanstack/react-query';
import { QK, fetchFamilias, familiaFromRow } from '@/lib/queries';
import type { Familia } from '@/lib/tipos-dominio';

type RefetchInterval =
  | number
  | false
  | ((query: Query<Familia[], Error>) => number | false | undefined);

export function useFamilias(
  loteId: string | undefined,
  options?: { refetchInterval?: RefetchInterval }
) {
  return useQuery<Familia[]>({
    queryKey: QK.familias(loteId ?? ''),
    queryFn: async () => (await fetchFamilias(loteId!)).map(familiaFromRow),
    enabled: !!loteId,
    refetchInterval: options?.refetchInterval,
  });
}
