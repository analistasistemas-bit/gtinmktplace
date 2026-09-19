import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queries';

/** ADR-0166: tipos de produto (roupa/calcado) habilitados para a org — ligados pelo super-admin.
 *
 *  SEM retry, mesmo padrão de useModulosHabilitados: `data === undefined` é "não sei", NÃO
 *  "a org não tem tipo". Quem consome precisa distinguir os dois — tratar falha de rede como
 *  "org padrão" esconderia o eixo Tamanho de uma org de roupa e gravaria o produto sem ele,
 *  em silêncio. */
export function useTiposProdutoHabilitados() {
  return useQuery<string[]>({
    queryKey: QK.tiposProdutoHabilitados,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('tipos_produto_da_org');
      if (error) throw error;
      return data ?? [];
    },
  });
}
