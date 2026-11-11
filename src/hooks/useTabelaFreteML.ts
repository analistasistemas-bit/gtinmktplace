import { useQuery } from '@tanstack/react-query';
import { fetchTabelaFrete, isTabelaFrete, tabelaIncompleta, type RespostaTabelaFrete } from '@/lib/tabela-frete';
import { useOrgEfetivaId } from '@/hooks/useOrgEfetivaId';

const STALE_COMPLETA_MS = 24 * 60 * 60 * 1000;
const STALE_INCOMPLETA_MS = 5 * 60 * 1000; // alinhado ao TTL de 300 s da edge

/**
 * Tabela de frete ML (grade 7×4) para uma categoria. Só dispara após análise concluída.
 * Cache alinhado à edge: 24h se completa; 5 min se faltou faixa, erro ou sem ME2.
 */
export function useTabelaFreteML(categoriaMlId: string | null | undefined, analiseConcluida: boolean) {
  const orgId = useOrgEfetivaId();
  return useQuery<RespostaTabelaFrete>({
    queryKey: ['tabela-frete', orgId, categoriaMlId],
    queryFn: () => fetchTabelaFrete(categoriaMlId!),
    enabled: Boolean(orgId && categoriaMlId && analiseConcluida),
    staleTime: (q) => (q.state.data && isTabelaFrete(q.state.data) && !tabelaIncompleta(q.state.data)
      ? STALE_COMPLETA_MS : STALE_INCOMPLETA_MS),
  });
}

export { isTabelaFrete };
