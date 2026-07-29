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
    // inclusive para org que não usa o módulo. Falhando de primeira, o guard degrada para
    // "nenhum módulo": o menu Estoque some e o resto do sistema continua funcionando.
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('modulos_habilitados_da_org');
      if (error) throw error;
      return data ?? [];
    },
  });
}
