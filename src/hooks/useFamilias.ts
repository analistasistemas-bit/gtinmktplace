import { useQuery } from '@tanstack/react-query';
import { QK, fetchFamilias, familiaFromRow } from '@/lib/queries';
import type { Familia } from '@/lib/tipos-dominio';

export function useFamilias(
  loteId: string | undefined,
  options?: { refetchInterval?: number }
) {
  return useQuery<Familia[]>({
    queryKey: QK.familias(loteId ?? ''),
    queryFn: async () => (await fetchFamilias(loteId!)).map(familiaFromRow),
    enabled: !!loteId,
    refetchInterval: options?.refetchInterval,
  });
}
