import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QK } from '@/lib/queries';
import { migrarPrecoPorVariacao } from '@/lib/excluir';

export function useMigrarPrecoPorVariacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (familiaId: string) => migrarPrecoPorVariacao(familiaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.statusPublicados });
      qc.invalidateQueries({ queryKey: QK.publicados });
    },
  });
}
