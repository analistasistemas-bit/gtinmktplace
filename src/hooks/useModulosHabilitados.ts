import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queries';

/** Módulos pagos habilitados para a org (E6b, D-13) — ligados pelo super-admin em /admin. */
export function useModulosHabilitados() {
  return useQuery<string[]>({
    queryKey: QK.modulosHabilitados,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('modulos_habilitados_da_org');
      if (error) throw error;
      return data ?? [];
    },
  });
}
