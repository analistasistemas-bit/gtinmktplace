import { useQuery } from '@tanstack/react-query';
import { QK, fetchFamiliaComCustoRecente, fetchFamiliaPublicada } from '@/lib/queries';
import type { Familia } from '@/lib/tipos-dominio';

// Carrega uma família sob demanda (lazy): só dispara quando `enabled` (ex.: linha expandida).
export function useFamilia(familiaId: string, enabled: boolean, custoRecente = false) {
  return useQuery<Familia>({
    queryKey: custoRecente ? [...QK.familia(familiaId), 'custo-recente'] : QK.familia(familiaId),
    queryFn: () => (custoRecente ? fetchFamiliaComCustoRecente : fetchFamiliaPublicada)(familiaId),
    enabled: enabled && !!familiaId,
    staleTime: 5 * 60_000,
  });
}
