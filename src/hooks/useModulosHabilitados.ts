import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queries';

/** Módulos pagos habilitados para a org (E6b, D-13) — ligados pelo super-admin em /admin.
 *  `retryOnMount` (default true, preserva o comportamento de todo chamador existente):
 *  Fix round 2 (Task 9) — um consumidor que monta/desmonta com frequência (ex.: um hook
 *  chamado dentro de um componente de rota, junto do MenuGuard que já observa esta mesma
 *  query) e chama isto sem `false` faz a query tentar de novo (retryOnMount, default true)
 *  a cada nova montagem enquanto ela nunca teve sucesso (RPC fora do ar/mock em teste),
 *  voltando pra "pending" — o MenuGuard esconde a rota (`modulosLoading`), o consumidor
 *  desmonta, a busca em voo assenta em erro, a rota volta, remonta, dispara de novo: loop.
 *  `false` faz esse consumidor só LER o cache compartilhado, sem reabrir a tentativa. */
export function useModulosHabilitados(options?: { retryOnMount?: boolean }) {
  return useQuery<string[]>({
    queryKey: QK.modulosHabilitados,
    staleTime: 5 * 60_000,
    // SEM retry de propósito. O MenuGuard bloqueia TODA rota enquanto isto carrega, então
    // uma falha da RPC com retry+backoff deixaria o app inteiro na tela "Carregando…" —
    // inclusive para org que não usa o módulo.
    //
    // Falhando de primeira, `data` fica `undefined`. Isso é "não sei", NÃO "a org não tem
    // módulo" (ADR-0153 D5): quem consome precisa distinguir os dois, senão uma falha de rede
    // esconde Estoque e Pulse como se não estivessem contratados. Ver menu-guard.tsx e
    // sidebar.tsx. `refetchOnReconnect` resolve o estado sozinho quando a rede volta.
    retry: false,
    retryOnMount: options?.retryOnMount ?? true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('modulos_habilitados_da_org');
      if (error) throw error;
      return data ?? [];
    },
  });
}
