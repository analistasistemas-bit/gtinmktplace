import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { buscarPerguntas, type Pergunta } from '@/lib/perguntas';

/** Lista de perguntas (não respondidas no topo). */
export function useListaPerguntas() {
  return useQuery<Pergunta[]>({
    queryKey: ['perguntas'],
    queryFn: buscarPerguntas,
    staleTime: 60_000,
  });
}

/** Conta perguntas não respondidas (para o badge do menu). Resiliente: erro → 0. */
export function usePerguntasNaoRespondidas() {
  return useQuery<number>({
    queryKey: ['perguntasNaoRespondidas'],
    queryFn: async () => {
      try {
        const { count, error } = await (supabase as unknown as { from: (t: string) => any })
          .from('ml_perguntas')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'UNANSWERED');
        if (error) return 0;
        return count ?? 0;
      } catch {
        return 0;
      }
    },
    staleTime: 60_000,
  });
}
