import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buscarNotificacoes,
  contarNotificacoesNaoLidas,
  marcarNotificacoesLidas,
  type Notificacao,
} from '@/lib/notificacoes';

/** Nº de notificações não lidas (badge do sino, ADR-0085). */
export function useNotificacoesNaoLidas(): number {
  const { data } = useQuery<number>({
    queryKey: ['notificacoesNaoLidas'],
    queryFn: contarNotificacoesNaoLidas,
    staleTime: 60_000,
  });
  return data ?? 0;
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
