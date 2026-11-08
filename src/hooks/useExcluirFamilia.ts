import { useMutation, useQueryClient } from '@tanstack/react-query';
import { excluirFamilia } from '@/lib/excluir';
import { QK } from '@/lib/queries';

export function useExcluirFamilia(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (familiaId: string) => excluirFamilia(familiaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.familias(loteId) });
      qc.invalidateQueries({ queryKey: QK.lote(loteId) });
      qc.invalidateQueries({ queryKey: ['lotes'] });
      qc.invalidateQueries({ queryKey: QK.publicados });
      qc.invalidateQueries({ queryKey: QK.familiasNaoPublicadas });
    },
  });
}
