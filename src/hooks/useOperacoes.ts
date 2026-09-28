// ADR-0174 — hooks de operações em massa (aderir/sair de promoções DEAL/SMART do ML).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/lib/database.types';
import type { AcaoOperacao, StatusItemOperacao } from '@/lib/operacoes';
import { useProfile } from '@/hooks/useProfile';
import { useSupportStore } from '@/stores/support-store';

export const QK_OPERACOES = ['operacoes'] as const;

export type OperacaoRow = Tables<'operacoes_massa'> & { itens: { status: StatusItemOperacao }[] };
export type ItemOperacaoRow = Tables<'operacoes_massa_itens'>;

interface ItemPedido { ml_item_id: string; preco: number | null; confirmado_risco: boolean }
export interface PedidoOperacao { acao: AcaoOperacao; promocao_id: string; origem_id: string | null; itens: ItemPedido[] }
export interface RecusaItem { ml_item_id: string; motivo: string; semaforo?: string }

/** Erro da edge `operacoes-massa`: `erro` sempre vem; `itens` só em recusa de validação (400). */
export class ErroOperacao extends Error {
  itens?: RecusaItem[];
  constructor(mensagem: string, itens?: RecusaItem[]) {
    super(mensagem);
    this.itens = itens;
  }
}

async function lerErroEdge(error: unknown, fallback: string): Promise<ErroOperacao> {
  const corpo = await (error as { context?: Response }).context?.json().catch(() => null);
  const c = corpo as { erro?: string; itens?: RecusaItem[] } | null;
  return new ErroOperacao(c?.erro ?? fallback, c?.itens);
}

/** Lista da org, mais recente primeiro; recarrega a cada 5 s enquanto alguma operação está executando. */
export function useOperacoes() {
  return useQuery({
    queryKey: [...QK_OPERACOES, 'lista'],
    queryFn: async () => {
      const { data, error } = await supabase.from('operacoes_massa')
        .select('*, itens:operacoes_massa_itens(status)').order('criado_em', { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as OperacaoRow[];
    },
    staleTime: 30_000,
    refetchInterval: (q) => ((q.state.data ?? []).some((o) => o.status === 'executando') ? 5_000 : false),
  });
}

export function useItensOperacao(operacaoId: string) {
  return useQuery({
    queryKey: [...QK_OPERACOES, operacaoId, 'itens'],
    queryFn: async () => {
      const { data, error } = await supabase.from('operacoes_massa_itens')
        .select('*').eq('operacao_id', operacaoId).order('ml_item_id');
      if (error) throw error;
      return (data ?? []) as ItemOperacaoRow[];
    },
    enabled: !!operacaoId,
  });
}

/** Cria a operação e publica a 1ª etapa no QStash (a edge faz isso); invalida a lista e a Central. */
export function useCriarOperacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pedido: PedidoOperacao) => {
      const { data, error } = await supabase.functions.invoke('operacoes-massa', { body: pedido });
      if (error) throw await lerErroEdge(error, 'Não foi possível criar a operação.');
      return data as { operacao_id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK_OPERACOES });
      qc.invalidateQueries({ queryKey: ['promocoes'] });
    },
  });
}

/** Ajuste 10: quem pode Executar/Reverter — mesmo predicado de `configuracoes` (admin ou suporte
 *  com escopo `full`), não só `isAdmin`. */
export function usePodeExecutarOperacao(): boolean {
  const { isAdmin } = useProfile();
  const support = useSupportStore((s) => s.context);
  return isAdmin || support?.scope === 'full';
}
