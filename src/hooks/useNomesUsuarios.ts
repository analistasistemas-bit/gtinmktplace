import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Mapa `profiles.id` → nome de exibição, para mostrar QUEM fez uma ação em vez do UUID cru.
 *
 * A RLS de `profiles` entrega os perfis da org para admin e só o próprio para os demais — o que
 * basta aqui, já que registrar saque é ação de admin (ADR-0117). Quem não enxergar o autor vê o
 * fallback do chamador, nunca um id solto.
 */
export function useNomesUsuarios() {
  return useQuery({
    queryKey: ['profiles', 'nomes'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase.from('profiles').select('id, nome, email');
      if (error) throw error;
      return new Map(
        (data ?? []).map((p) => [p.id as string, (p.nome as string | null) || (p.email as string)]),
      );
    },
  });
}
