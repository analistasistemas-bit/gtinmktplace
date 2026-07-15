import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queries';

/** Canais habilitados para a org (D5) — editados pelo super-admin em /admin. */
export function useCanaisHabilitados() {
  return useQuery<string[]>({
    queryKey: QK.canaisHabilitados,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('canais_habilitados_da_org');
      if (error) throw error;
      return data ?? ['mercado_livre'];
    },
  });
}
