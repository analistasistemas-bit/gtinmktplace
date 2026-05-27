import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queries';

export function useLoteRealtime(loteId: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!loteId) return;
    const channel = supabase
      .channel(`lote-${loteId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'familias',
          filter: `lote_id=eq.${loteId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: QK.familias(loteId) });
          qc.invalidateQueries({ queryKey: QK.lote(loteId) });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'lotes',
          filter: `id=eq.${loteId}`,
        },
        () => qc.invalidateQueries({ queryKey: QK.lote(loteId) })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loteId, qc]);
}
