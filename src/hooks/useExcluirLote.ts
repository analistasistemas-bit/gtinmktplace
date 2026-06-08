import { useMutation, useQueryClient } from '@tanstack/react-query';
import { excluirLote } from '@/lib/excluir';
import { QK } from '@/lib/queries';

export function useExcluirLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (loteId: string) => excluirLote(loteId),
    onSuccess: () => {
      // Prefix match invalida ['lotes', userId] sem depender de getUser() (que poderia rejeitar).
      qc.invalidateQueries({ queryKey: ['lotes'] });
      // Lote misto: famílias publicadas sobrevivem → a tela Publicados pode mudar.
      qc.invalidateQueries({ queryKey: QK.publicados });
    },
  });
}
