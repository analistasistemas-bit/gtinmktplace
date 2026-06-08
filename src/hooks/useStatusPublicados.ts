import { useQuery } from '@tanstack/react-query';
import { QK, fetchStatusPublicados } from '@/lib/queries';
import type { ResultadoStatusPublicados } from '@/lib/queries';

export function useStatusPublicados() {
  return useQuery<ResultadoStatusPublicados>({
    queryKey: QK.statusPublicados,
    queryFn: fetchStatusPublicados,
    staleTime: 5 * 60_000,
  });
}
