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
 * tabela inteira. Resiliente: erro/exceção → 0. */
export async function contarConversasAguardando(): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('contar_conversas_aguardando');
    if (error) return 0;
    return (data as number) ?? 0;
  } catch {
    return 0;
  }
}

export function useMensagensAguardando(): number {
  const { data } = useQuery<number>({
    queryKey: ['mensagensAguardando'],
    queryFn: contarConversasAguardando,
    staleTime: 60_000,
  });
  return data ?? 0;
}
