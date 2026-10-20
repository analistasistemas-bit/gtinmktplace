import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queries';

export type MarcaOrg = { marca_propria: boolean; marca_padrao: string | null };

/** ADR-0188: a org usa marca própria no ML? `marca_padrao` é o nome pré-preenchido no cadastro. */
export function useMarcaOrg() {
  return useQuery<MarcaOrg>({
    queryKey: QK.marcaOrg,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('marca_da_org');
      if (error) throw error;
      const d = data as Partial<MarcaOrg> | null;
      return { marca_propria: !!d?.marca_propria, marca_padrao: d?.marca_padrao ?? null };
    },
  });
}
