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

/** Conta perguntas não respondidas. Lança em erro (o hook expõe `isError`). */
export async function contarPerguntasNaoRespondidas(): Promise<number> {
  const { count, error } = await supabase
    .from('ml_perguntas')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'UNANSWERED');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Conta perguntas não respondidas (badge do menu). Devolve `isError` para o badge distinguir
 * "0 pendentes" de "falha ao verificar" (ML penaliza resposta lenta — não esconder a fila). */
export function usePerguntasNaoRespondidas(): { count: number; isError: boolean } {
  const q = useQuery<number>({
    queryKey: ['perguntasNaoRespondidas'],
    queryFn: contarPerguntasNaoRespondidas,
    staleTime: 60_000,
    retry: 1,
  });
  return { count: q.data ?? 0, isError: q.isError };
}
