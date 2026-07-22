import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { buscarConversas, type Conversa } from '@/lib/mensagens';

/** Conversas de pós-venda (aguardando resposta no topo). */
export function useListaMensagens() {
  return useQuery<Conversa[]>({
    queryKey: ['mensagens'],
    queryFn: buscarConversas,
    staleTime: 60_000,
  });
}

/** Nº de conversas aguardando resposta (badge do menu/avatar). Server-side via RPC — não baixa a
 * tabela inteira. Lança em erro para o hook expor `isError` (badge distingue "0" de "falha"). */
export async function contarConversasAguardando(): Promise<number> {
  const { data, error } = await supabase.rpc('contar_conversas_aguardando');
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

export function useMensagensAguardando(): { count: number; isError: boolean } {
  const q = useQuery<number>({
    queryKey: ['mensagensAguardando'],
    queryFn: contarConversasAguardando,
    staleTime: 60_000,
    retry: 1,
  });
  return { count: q.data ?? 0, isError: q.isError };
}
