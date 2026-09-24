import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { emLeitura, fetchEstadoSyncPromocoes, fetchItensPromocao, fetchPromocoes } from '@/lib/promocoes';

const QK_PROMO = ['promocoes'] as const;

/** Enquanto alguma campanha está em leitura, recarrega a cada 10 s para a tela acompanhar. */
export function usePromocoes() {
  return useQuery({
    queryKey: [...QK_PROMO, 'lista'], queryFn: fetchPromocoes, staleTime: 60_000,
    refetchInterval: (q) => ((q.state.data ?? []).some((p) => emLeitura(p, Date.now())) ? 10_000 : false),
  });
}
export function useItensPromocao(promocaoId: string, lendo = false) {
  return useQuery({
    queryKey: [...QK_PROMO, 'itens', promocaoId], queryFn: () => fetchItensPromocao(promocaoId), staleTime: 60_000,
    refetchInterval: lendo ? 15_000 : false,
  });
}
export function useEstadoSyncPromocoes() {
  return useQuery({ queryKey: [...QK_PROMO, 'estado'], queryFn: fetchEstadoSyncPromocoes, staleTime: 30_000 });
}

/** "Atualizar agora": o worker responde ao fim da etapa de lista (segundos); a leitura das campanhas
 *  segue em segundo plano e a lista acompanha por `rodada_em_curso`. 429 = atualizado há < 2 min. */
export function useAtualizarPromocoes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('sincronizar-promocoes', { body: {} });
      if (error) {
        const corpo = await (error as { context?: Response }).context?.json().catch(() => null);
        throw new Error((corpo as { erro?: string } | null)?.erro ?? 'Não foi possível atualizar as promoções.');
      }
      return data;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QK_PROMO }),
  });
}
