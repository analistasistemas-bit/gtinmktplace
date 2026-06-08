import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QK } from '@/lib/queries';
import { removerPublicado } from '@/lib/excluir';

export function useRemoverPublicado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (familiaId: string) => removerPublicado(familiaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.publicados });
    },
  });
}
