import { useQuery } from '@tanstack/react-query';
import { fetchTabelaFrete, isTabelaFrete, type RespostaTabelaFrete } from '@/lib/tabela-frete';

/**
 * Tabela de frete ML (grade 7×4) para uma categoria. Só dispara após análise concluída.
 * Cache alinhado à edge (24h).
 */
export function useTabelaFreteML(categoriaMlId: string | null | undefined, analiseConcluida: boolean) {
  return useQuery<RespostaTabelaFrete>({
    queryKey: ['tabela-frete', categoriaMlId],
    queryFn: () => fetchTabelaFrete(categoriaMlId!),
    enabled: Boolean(categoriaMlId && analiseConcluida),
    staleTime: 24 * 60 * 60 * 1000,
  });
}

export { isTabelaFrete };
