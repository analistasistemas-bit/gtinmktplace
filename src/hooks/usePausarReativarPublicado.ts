import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QK } from '@/lib/queries';
import { pausarReativarPublicado } from '@/lib/excluir';

export function usePausarReativarPublicado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mlItemId, status }: { mlItemId: string; status: 'ativo' | 'pausado' }) =>
      pausarReativarPublicado(mlItemId, status),
    onSuccess: () => {
      // Sem persistência local do status — força reconsulta real no ML (ADR-0060).
      qc.invalidateQueries({ queryKey: QK.statusPublicados });
    },
  });
}
