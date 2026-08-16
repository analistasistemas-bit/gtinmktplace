import { useQuery } from '@tanstack/react-query';
import { QK, fetchStatusPublicados } from '@/lib/queries';
import type { ResultadoStatusPublicados } from '@/lib/queries';

/** `enabled` existe para a tela Estoque: lá o status ao vivo só interessa com um card aberto,
 *  e a chamada varre TODOS os anúncios da org (133 na Avil) — cara demais em repouso. */
export function useStatusPublicados(opts: { enabled?: boolean } = {}) {
  return useQuery<ResultadoStatusPublicados>({
    queryKey: QK.statusPublicados,
    queryFn: fetchStatusPublicados,
    staleTime: 5 * 60_000,
    enabled: opts.enabled ?? true,
  });
}
