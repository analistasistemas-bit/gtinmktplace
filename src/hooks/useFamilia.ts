import { useQuery } from '@tanstack/react-query';
import { QK, fetchFamiliaPublicada } from '@/lib/queries';
import type { Familia } from '@/lib/tipos-dominio';

// Carrega uma família sob demanda (lazy): só dispara quando `enabled` (ex.: linha expandida).
export function useFamilia(familiaId: string, enabled: boolean) {
  return useQuery<Familia>({
    queryKey: QK.familia(familiaId),
    queryFn: () => fetchFamiliaPublicada(familiaId),
    enabled: enabled && !!familiaId,
    staleTime: 5 * 60_000,
  });
}
