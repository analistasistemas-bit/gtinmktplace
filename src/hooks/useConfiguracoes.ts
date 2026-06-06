import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchDescontoPct, upsertDescontoPct } from '@/lib/queries';

export function useDescontoPct() {
  return useQuery({ queryKey: ['configuracoes', 'desconto_pct'], queryFn: fetchDescontoPct });
}
export function useSalvarDescontoPct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pct: number) => upsertDescontoPct(pct),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'desconto_pct'] }),
  });
}
