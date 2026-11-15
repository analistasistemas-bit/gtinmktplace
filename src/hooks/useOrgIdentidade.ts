import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queries';
import { useOrgEfetivaId } from '@/hooks/useOrgEfetivaId';

export type OrgIdentidade = { nome: string; logo_claro_url: string | null; logo_escuro_url: string | null };

/** Nome e logos da org efetiva (vale no modo suporte). */
export function useOrgIdentidade() {
  const orgId = useOrgEfetivaId();
  return useQuery<OrgIdentidade | null>({
    queryKey: QK.orgIdentidade(orgId),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('nome, logo_claro_url, logo_escuro_url')
        .eq('id', orgId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
