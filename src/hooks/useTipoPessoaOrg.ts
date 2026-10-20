import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queries';
import { useOrgEfetivaId } from '@/hooks/useOrgEfetivaId';

/** ADR-0135 D-2: `tipo_pessoa` da org efetiva ('pf' | 'pj' | null). `undefined` = ainda não sei. */
export function useTipoPessoaOrg() {
  const orgId = useOrgEfetivaId();
  return useQuery<string | null>({
    queryKey: QK.tipoPessoaOrg(orgId),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('organizations').select('tipo_pessoa').eq('id', orgId!).maybeSingle();
      if (error) throw error;
      return data?.tipo_pessoa ?? null;
    },
  });
}
