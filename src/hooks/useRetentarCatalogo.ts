import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QK } from '@/lib/queries';
import { retentarCatalogo } from '@/lib/retentar-catalogo';

export function useRetentarCatalogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (familiaId: string) => retentarCatalogo(familiaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.publicados });
      qc.invalidateQueries({ queryKey: QK.catalogoRisco });
    },
  });
}
