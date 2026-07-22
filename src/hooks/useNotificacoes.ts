import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buscarNotificacoes,
  contarNotificacoesNaoLidas,
  marcarNotificacoesLidas,
  type Notificacao,
} from '@/lib/notificacoes';

/** Nº de notificações não lidas (badge do sino, ADR-0085). `isError` p/ distinguir "0" de "falha". */
export function useNotificacoesNaoLidas(): { count: number; isError: boolean } {
  const q = useQuery<number>({
    queryKey: ['notificacoesNaoLidas'],
    queryFn: contarNotificacoesNaoLidas,
    staleTime: 60_000,
    retry: 1,
  });
  return { count: q.data ?? 0, isError: q.isError };
}

/** Lista das últimas notificações, para o dropdown do sino. */
export function useListaNotificacoes() {
  return useQuery<Notificacao[]>({
    queryKey: ['notificacoes'],
    queryFn: () => buscarNotificacoes(),
    staleTime: 30_000,
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
