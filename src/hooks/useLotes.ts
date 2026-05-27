import { useQuery } from '@tanstack/react-query';
import { QK, fetchLotes, fetchLote, loteFromRow } from '@/lib/queries';
import type { Lote } from '@/lib/tipos-dominio';
import { useAuth } from './useAuth';

export function useLotes() {
  const { user } = useAuth();
  return useQuery<Lote[]>({
    queryKey: QK.lotes(user?.id ?? 'anon'),
    queryFn: async () => (await fetchLotes()).map(loteFromRow),
    enabled: !!user,
  });
}

export function useLote(id: string | undefined) {
  return useQuery<Lote | null>({
    queryKey: QK.lote(id ?? ''),
    queryFn: async () => {
      const row = await fetchLote(id!);
      return row ? loteFromRow(row) : null;
    },
    enabled: !!id,
  });
}
