import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { excluirLote } from '@/lib/excluir';
import { QK } from '@/lib/queries';

export function useExcluirLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (loteId: string) => excluirLote(loteId),
    onSuccess: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) qc.invalidateQueries({ queryKey: QK.lotes(user.id) });
    },
  });
}
