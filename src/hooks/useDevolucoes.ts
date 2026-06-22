import { useQuery } from '@tanstack/react-query';
import { buscarDevolucoes, type Devolucao } from '@/lib/devolucoes';

export function useDevolucoes() {
  return useQuery<Devolucao[]>({
    queryKey: ['devolucoes'],
    queryFn: buscarDevolucoes,
    staleTime: 60_000,
  });
}
