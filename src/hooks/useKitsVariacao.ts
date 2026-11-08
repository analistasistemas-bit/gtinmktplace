import { useQuery } from '@tanstack/react-query';
import { fetchDetalheKitVariacao, fetchKitsVariacao } from '@/lib/kit-variacao-edge';

export const QK_KITS_VARIACAO = ['kits-variacao'] as const;

/** Kits com variação da org (ADR-0200). Só com o módulo ligado: sem ele as tabelas podem nem existir. Repete a
 *  leitura enquanto algum kit está sendo montado ou encerrado, para a linha mudar de estado sozinha. */
export function useKitsVariacao(enabled: boolean) {
  return useQuery({
    queryKey: QK_KITS_VARIACAO,
    queryFn: fetchKitsVariacao,
    enabled,
    staleTime: 30_000,
    refetchInterval: (q) => ((q.state.data ?? []).some((k) => k.status === 'publicando' || k.status === 'encerrando') ? 10_000 : false),
  });
}

/** Saldo por combinação × tamanho e transferências abertas. Repete enquanto houver transferência em andamento. */
export function useDetalheKitVariacao(kitId: string | null, codigoPaiBase: string) {
  return useQuery({
    queryKey: [...QK_KITS_VARIACAO, 'detalhe', kitId],
    queryFn: () => fetchDetalheKitVariacao(kitId as string, codigoPaiBase),
    enabled: !!kitId,
    refetchInterval: (q) => ((q.state.data?.abertas.length ?? 0) > 0 ? 10_000 : false),
  });
}
