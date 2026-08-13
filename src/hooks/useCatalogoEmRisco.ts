import { useQuery } from '@tanstack/react-query';
import { QK, fetchCatalogoEmRisco } from '@/lib/queries';
import type { FamiliaRiscoRow } from '@/lib/catalogo-risco';

export function useCatalogoEmRisco() {
  return useQuery<FamiliaRiscoRow[]>({
    queryKey: QK.catalogoRisco,
    queryFn: fetchCatalogoEmRisco,
  });
}
