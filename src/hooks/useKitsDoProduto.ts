import { useQuery } from '@tanstack/react-query';
import { QK, fetchKitsDoProduto, type KitVinculado } from '@/lib/queries';

/** Kits vinculados já criados para um produto-base (ADR-0151). Lazy: só dispara quando `enabled`.
 *  `poll`: reconsulta a cada 2500ms enquanto existir kit em trânsito (`status==='publicando'`).
 *  Não polla em `'pronto'`: é repouso (aguardando reenvio/base), não trânsito — ver D-2 em
 *  `KitVinculado.mlItemId` (queries.ts) — pollar isso giraria spinner pra sempre num kit parado. */
export function useKitsDoProduto(codigoPai: string, enabled: boolean, poll = false) {
  return useQuery<KitVinculado[]>({
    queryKey: QK.kitsDoProduto(codigoPai),
    queryFn: () => fetchKitsDoProduto(codigoPai),
    enabled: enabled && !!codigoPai,
    staleTime: 30_000,
    refetchInterval: poll
      ? (query) => {
          const kits = query.state.data ?? [];
          const algumEmTransito = kits.some((k) => k.status === 'publicando');
          return algumEmTransito ? 2500 : false;
        }
      : false,
  });
}
