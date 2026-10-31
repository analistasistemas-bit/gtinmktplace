import { useQuery } from '@tanstack/react-query';
import { buscarDevolucoes, type Devolucao } from '@/lib/devolucoes';
import { useOrgEfetivaId } from '@/hooks/useOrgEfetivaId';

export function useDevolucoes() {
  // Org no fim da chave: invalidateQueries(['devolucoes']) do pós-venda segue casando pelo prefixo.
  const orgId = useOrgEfetivaId();
  return useQuery<Devolucao[]>({
    queryKey: ['devolucoes', orgId],
    enabled: orgId != null,
    queryFn: buscarDevolucoes,
    staleTime: 60_000,
  });
}
