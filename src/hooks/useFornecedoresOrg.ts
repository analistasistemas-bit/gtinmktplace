import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { buscarTodasPaginas } from '@/lib/paginacao-supabase';
import { useOrgEfetivaId } from '@/hooks/useOrgEfetivaId';

/** Sem staleTime: refaz a cada abertura do cadastro, então o fornecedor recém-salvo já aparece.
 * Fornecedores já usados nas famílias da org (RLS por org), sem repetição, em ordem alfabética. */
export function useFornecedoresOrg() {
  const orgId = useOrgEfetivaId();
  return useQuery<string[]>({
    queryKey: ['fornecedores-org', orgId],
    enabled: !!orgId,
    retry: false,
    queryFn: async () => {
      const linhas = await buscarTodasPaginas<{ fornecedor: string | null }>((de, ate) => supabase
        .from('familias').select('fornecedor').not('fornecedor', 'is', null).order('id').range(de, ate));
      const unicos = new Map<string, string>();
      for (const { fornecedor } of linhas) {
        const nome = fornecedor?.trim();
        if (nome && !unicos.has(nome.toLowerCase())) unicos.set(nome.toLowerCase(), nome);
      }
      return [...unicos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    },
  });
}
