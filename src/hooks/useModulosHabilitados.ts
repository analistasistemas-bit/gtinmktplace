import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queries';

/** Módulos pagos habilitados para a org (E6b, D-13) — ligados pelo super-admin em /admin. */
export function useModulosHabilitados() {
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
    queryFn: async () => {
      const { data, error } = await supabase.rpc('modulos_habilitados_da_org');
      if (error) throw error;
      return data ?? [];
    },
  });
}
