import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { buscarConversas, type Conversa } from '@/lib/mensagens';

/** Conversas de pós-venda (não-lidas no topo). */
export function useListaMensagens() {
  return useQuery<Conversa[]>({
    queryKey: ['mensagens'],
    queryFn: buscarConversas,
    staleTime: 60_000,
  });
}

/** Conta mensagens recebidas não-lidas (badge do menu). Resiliente: erro → 0. */
export function useMensagensNaoLidas() {
  return useQuery<number>({
    queryKey: ['mensagensNaoLidas'],
    queryFn: async () => {
      try {
        const { count, error } = await supabase
          .from('ml_mensagens')
          .select('id', { count: 'exact', head: true })
          .eq('direcao', 'recebida')
          .eq('lida', false);
        if (error) return 0;
        return count ?? 0;
      } catch {
        return 0;
      }
    },
    staleTime: 60_000,
  });
}
