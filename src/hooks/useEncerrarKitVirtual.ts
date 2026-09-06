import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QK } from '@/lib/queries';
import { encerrarKitVirtualEdge } from '@/lib/kit-virtual';

/** ADR-0154 D-8: encerra o Kit Virtual no ML ("Refazer kit" — a composição é imutável, então
 *  trocar um componente é encerrar e reabrir o diálogo para criar outro). */
export function useEncerrarKitVirtual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kitId: string) => encerrarKitVirtualEdge(kitId),
    onSuccess: (r) => {
      if (!r.ok) return;
      qc.invalidateQueries({ queryKey: QK.publicados });
      qc.invalidateQueries({ queryKey: QK.statusPublicados });
    },
  });
}
