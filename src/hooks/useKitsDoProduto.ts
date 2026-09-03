import { useQuery } from '@tanstack/react-query';
import { QK, fetchKitsDoProduto, type KitVinculado } from '@/lib/queries';

/** Kits vinculados já criados para um produto-base (ADR-0151). Lazy: só dispara quando `enabled`. */
export function useKitsDoProduto(codigoPai: string, enabled: boolean) {
  return useQuery<KitVinculado[]>({
    queryKey: QK.kitsDoProduto(codigoPai),
    queryFn: () => fetchKitsDoProduto(codigoPai),
    enabled: enabled && !!codigoPai,
    staleTime: 30_000,
  });
}
