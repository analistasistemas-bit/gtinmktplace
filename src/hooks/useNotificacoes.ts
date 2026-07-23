import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buscarNotificacoes,
  contarNotificacoesNaoLidas,
  marcarNotificacoesLidas,
  type Notificacao,
} from '@/lib/notificacoes';

/** Nº de notificações não lidas (badge do sino, ADR-0085). `isError` p/ distinguir "0" de "falha".
 *  O sino mora só no Topbar (persistente, nunca remonta durante a navegação) e nenhuma outra tela
 *  compartilha esta queryKey pra "carona" de refetch — diferente do badge de perguntas, que também
 *  monta em Dashboard/Faturamento e por isso refresca a cada troca de página. Sem refetchInterval
 *  aqui, a contagem ficava congelada no valor do carregamento inicial da aba pelo resto da sessão
 *  (o refetchOnWindowFocus global está off, ver query-client.ts). */
export function useNotificacoesNaoLidas(): { count: number; isError: boolean } {
  const q = useQuery<number>({
    queryKey: ['notificacoesNaoLidas'],
    queryFn: contarNotificacoesNaoLidas,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  return { count: q.data ?? 0, isError: q.isError };
}

/** Lista das últimas notificações, para o dropdown do sino. Mesmo motivo do polling acima. */
export function useListaNotificacoes() {
  return useQuery<Notificacao[]>({
    queryKey: ['notificacoes'],
    queryFn: () => buscarNotificacoes(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Marca notificações como lidas e invalida o badge/lista. */
export function useMarcarNotificacoesLidas() {
  const queryClient = useQueryClient();
  return async (ids?: string[]) => {
    await marcarNotificacoesLidas(ids);
    queryClient.invalidateQueries({ queryKey: ['notificacoesNaoLidas'] });
    queryClient.invalidateQueries({ queryKey: ['notificacoes'] });
  };
}
