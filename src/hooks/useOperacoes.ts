// ADR-0174 — hooks de operações em massa (aderir/sair de promoções DEAL/SMART do ML, pausar/reativar e reajustar preço — I5).
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/lib/database.types';
import { ehAcaoStatus, type AcaoPromocao, type AcaoStatus, type StatusItemOperacao } from '@/lib/operacoes';
import { QK } from '@/lib/queries';
import type { Ajuste, Confirmacao, ItemPreview } from '@/lib/reajuste';
import { useProfile } from '@/hooks/useProfile';
import { useSupportStore } from '@/stores/support-store';

export const QK_OPERACOES = ['operacoes'] as const;

/** `incluido`: reajuste conta no título só o que entrou (fora/sem alteração/desmarcado = false). */
export type OperacaoRow = Tables<'operacoes_massa'> & { itens: { status: StatusItemOperacao; incluido?: boolean }[] };
export type ItemOperacaoRow = Tables<'operacoes_massa_itens'>;

interface ItemPedido { ml_item_id: string; preco: number | null; confirmado_risco: boolean }
export interface PedidoOperacao { acao: AcaoPromocao; promocao_id: string; origem_id: string | null; itens: ItemPedido[] }
export interface PedidoOperacaoStatus {
  acao: AcaoStatus; origem_id: string | null; itens: { ml_item_id: string; titulo: string | null }[];
}
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

/** Lista da org, mais recente primeiro; recarrega a cada 5 s enquanto alguma operação está executando.
 *  `filtro='promocao'` filtra no servidor (senão 50 pausas empurram uma operação de promoção para fora da página).
 *  Rascunho de reajuste (preview não confirmado, expira em 30 min) não é operação: fica fora da lista, no servidor. */
export function useOperacoes(filtro?: 'promocao') {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [...QK_OPERACOES, 'lista', filtro ?? 'todas'],
    queryFn: async () => {
      let q = supabase.from('operacoes_massa').select('*, itens:operacoes_massa_itens(status, incluido)').neq('status', 'rascunho');
      if (filtro === 'promocao') q = q.in('acao', ['aderir', 'sair']);
      const { data, error } = await q.order('criado_em', { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as OperacaoRow[];
    },
    staleTime: 30_000,
    refetchInterval: (q) => ((q.state.data ?? []).some((o) => o.status === 'executando') ? 5_000 : false),
  });
  // Conclusão vista na lista (tela Operações, Reverter) também atualiza o status ao vivo do Publicados — inclusive
  // quando a 1ª leitura já chega concluída (navegou para cá logo depois de executar). Janela = staleTime do status
  // ao vivo (5 min): conclusão mais antiga que a montagem − 5 min já foi coberta pelo próprio cache expirando.
  const montadoEm = useRef(Date.now());
  const tratadas = useRef(new Set<string>());
  useEffect(() => {
    const novas = (query.data ?? []).filter((o) => (ehAcaoStatus(o.acao) || o.acao === 'reajustar') && o.status === 'concluida' && !tratadas.current.has(o.id)
      && Date.parse(o.concluido_em ?? '') > montadoEm.current - JANELA_STATUS_MS);
    if (!novas.length) return;
    for (const o of novas) tratadas.current.add(o.id);
    qc.invalidateQueries({ queryKey: QK.statusPublicados });
    // Reajuste muda preço (e fixa `preco_publicacao`), que a lista de Publicados lê do banco.
    if (novas.some((o) => o.acao === 'reajustar')) qc.invalidateQueries({ queryKey: QK.publicados });
  }, [query.data, qc]);
  return query;
}
const JANELA_STATUS_MS = 5 * 60_000; // = staleTime de useStatusPublicados

/** Emenda 2026-10-04: acompanha uma operação criada na tela Publicados; ao concluir, força o status ao vivo
 *  (`QK.statusPublicados`, cache de 5 min) e a lista de operações a recarregarem. */
export function useAcompanharOperacao(id: string | null) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: [...QK_OPERACOES, id, 'acompanhar'],
    queryFn: async () => {
      const { data, error } = await supabase.from('operacoes_massa').select('status, acao').eq('id', id!).single();
      if (error) throw error;
      return data as { status: string; acao: string };
    },
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === 'concluida' ? false : 5_000),
  });
  const concluida = data?.status === 'concluida';
  const reajuste = data?.acao === 'reajustar';
  useEffect(() => {
    if (!concluida) return;
    qc.invalidateQueries({ queryKey: QK.statusPublicados });
    qc.invalidateQueries({ queryKey: QK_OPERACOES });
    // Reajuste muda o preço (e fixa `preco_publicacao`) que a lista de Publicados lê do banco.
    if (reajuste) qc.invalidateQueries({ queryKey: QK.publicados });
  }, [concluida, reajuste, qc]);
}

/** Fix round 1 (achado 3): recarrega a cada 5 s enquanto a operação (`operacoes_massa.status`)
 *  ainda está `executando` — senão o detalhe (mensagem, `saida_solicitada`) fica parado.
 *  Fix round 2 (achado 2 da revisão): ao `executando` virar `false`, o intervalo desliga sem um
 *  fetch final — quem está com o sheet aberto ficava vendo o último status do ciclo anterior
 *  (ex.: "Na fila"/"Enviando", Reverter escondido) até fechar e abrir de novo. Um `refetch()` na
 *  borda `true → false` garante o estado final mesmo sem reabrir o sheet. */
export function useItensOperacao(operacaoId: string, executando = false) {
  const query = useQuery({
    queryKey: [...QK_OPERACOES, operacaoId, 'itens'],
    queryFn: async () => {
      const { data, error } = await supabase.from('operacoes_massa_itens')
        .select('*').eq('operacao_id', operacaoId).order('ml_item_id');
      if (error) throw error;
      return (data ?? []) as ItemOperacaoRow[];
    },
    enabled: !!operacaoId,
    refetchInterval: executando ? 5_000 : false,
  });
  const refetch = query.refetch;
  const eraExecutando = useRef(executando);
  useEffect(() => {
    if (eraExecutando.current && !executando) refetch();
    eraExecutando.current = executando;
  }, [executando, refetch]);
  return query;
}

/** Fix round 2 (achado 4 da revisão): a operação original de um Reverter pode ter saído da página
 *  de 50 (`useOperacoes`) — busca-a por id só quando ela não está na lista já carregada. */
export function useOperacao(id: string | null) {
  return useQuery({
    queryKey: [...QK_OPERACOES, id],
    queryFn: async () => {
      const { data, error } = await supabase.from('operacoes_massa').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as Tables<'operacoes_massa'>;
    },
    enabled: !!id,
  });
}

/** Revisão UX (achado B): saber se uma operação já foi revertida (existe outra operação com
 *  `origem_id` = este id) para trocar o botão Reverter por um aviso. Mesmo padrão de `useOperacao`:
 *  busca só quando a reversão não está na página de 50 já carregada.
 *  Fix (revisão Grok, achado IMPORTANTE): traz `itens:operacoes_massa_itens(status)` igual à lista
 *  — quem chama precisa do status dos itens pra distinguir reversão que pegou de reversão que
 *  falhou toda (`encerrarComErro`), não só da existência da linha. */
export function useOperacaoPorOrigem(id: string | null) {
  return useQuery({
    queryKey: [...QK_OPERACOES, 'origem', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('operacoes_massa')
        .select('*, itens:operacoes_massa_itens(status, incluido)')
        // Rascunho (preview de Reverter abandonado) não é reversão.
        .eq('origem_id', id!).neq('status', 'rascunho').order('criado_em', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data as unknown as OperacaoRow | null;
    },
    enabled: !!id,
  });
}

/** Cria a operação e publica a 1ª etapa no QStash (a edge faz isso); invalida a lista e a Central. */
export function useCriarOperacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pedido: PedidoOperacao | PedidoOperacaoStatus) => {
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

/** I5 — pedido de preview do reajuste. Reverter = `origem_id` (sem `ajuste`); `precos` sobrescreve o alvo de itens editados. */
export interface PedidoPreviewReajuste {
  familias?: string[]; ml_item_ids?: string[]; ajuste?: Ajuste | null; precos?: Record<string, number>; origem_id?: string | null;
}
/** 201: rascunho gravado. 200 com `operacao_id: null`: nada a executar (tudo sem alteração/fora) — nada gravado. */
export interface RespostaPreviewReajuste { operacao_id: string | null; itens: ItemPreview[]; expira_em?: string }

/** Calcula o preview no servidor e grava o rascunho (C1). Não invalida nada: rascunho não aparece em lista. */
export function usePreviewReajuste() {
  return useMutation({
    mutationFn: async (pedido: PedidoPreviewReajuste) => {
      const { data, error } = await supabase.functions.invoke('operacoes-massa', { body: { etapa: 'preview', acao: 'reajustar', ...pedido } });
      if (error) throw await lerErroEdge(error, 'Não foi possível calcular o preview.');
      return data as RespostaPreviewReajuste;
    },
  });
}

/** Confirma o rascunho (C5) e publica a execução. 400 (risco faltando, expirado) / 409 (ocupado) → `ErroOperacao.itens`. */
export function useConfirmarReajuste() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pedido: { operacao_id: string; confirmacoes: Confirmacao[] }) => {
      const { data, error } = await supabase.functions.invoke('operacoes-massa', { body: { etapa: 'confirmar', ...pedido } });
      if (error) throw await lerErroEdge(error, 'Não foi possível executar o reajuste.');
      return data as { operacao_id: string };
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: QK_OPERACOES }); },
  });
}

/** Ajuste 10: quem pode Executar/Reverter — mesmo predicado de `configuracoes/permissoes.ts`
 *  (`podeEditarConfig`): em sessão de suporte vale só o escopo `full` (mesmo super-admin, que
 *  carrega `profiles.is_admin = true`, fica de fora em `read`); fora de suporte vale `isAdmin`.
 *  Fix round 1 (achado 2): a versão anterior liberava `isAdmin || scope === 'full'`, o que deixava
 *  o super-admin executar em sessão de suporte só-leitura — o servidor (`auth-org.ts`) recusa. */
export function usePodeExecutarOperacao(): boolean {
  const { isAdmin } = useProfile();
  const context = useSupportStore((s) => s.context);
  return context ? context.scope === 'full' : isAdmin;
}
