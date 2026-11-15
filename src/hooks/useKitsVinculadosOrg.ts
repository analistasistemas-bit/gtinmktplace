import { useQuery } from '@tanstack/react-query';
import { QK, fetchKitsVinculadosDaOrg, type KitVinculado } from '@/lib/queries';

const EM_TRANSITO = new Set(['pendente', 'processando', 'publicando']);

/** Kits vinculados de toda a org (badges e filtro de kits em Publicados).
 *  Reconsulta a cada 5 s enquanto algum kit estiver em trânsito: sem isso o badge congelava no
 *  spinner do instante `publicando` mesmo depois do kit virar `erro`/`publicado` (15/11). */
export function useKitsVinculadosOrg() {
  return useQuery<KitVinculado[]>({
    queryKey: QK.kitsVinculadosOrg,
    queryFn: fetchKitsVinculadosDaOrg,
    staleTime: 30_000,
    refetchInterval: (query) => ((query.state.data ?? []).some((k) => EM_TRANSITO.has(k.status)) ? 5000 : false),
  });
}
