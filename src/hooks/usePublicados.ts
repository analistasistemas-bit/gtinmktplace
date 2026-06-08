import { useQuery } from '@tanstack/react-query';
import { QK, fetchPublicados } from '@/lib/queries';
import type { PublicadoItem } from '@/lib/publicados';

export function usePublicados() {
  return useQuery<PublicadoItem[]>({
    queryKey: QK.publicados,
    queryFn: fetchPublicados,
  });
}
