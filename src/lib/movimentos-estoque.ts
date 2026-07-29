// E6b (ADR-0094): leitura do ledger de estoque para a UI.
// A escrita nunca passa por aqui — toda mudança de saldo é feita por RPC via edge
// com service_role (D-15), e a escrita direta em `variacoes.estoque` é bloqueada
// por trigger (D-20). Este módulo é só leitura.
import { supabase } from './supabase';

/** Espelha o check-constraint `estoque_movimentos_motivo_check` da migration. */
export const MOTIVOS_MOVIMENTO = [
  'venda',
  'entrada',
  'estorno_venda',
  'venda_sku_nao_encontrado',
  'estorno_sku_nao_encontrado',
  'cancelamento_sem_baixa',
  'venda_cancelada_antes',
] as const;

export type MotivoMovimento = (typeof MOTIVOS_MOVIMENTO)[number];

export interface MovimentoEstoque {
  id: string;
  criado_em: string;
  codigo: string;
  /** Delta REALMENTE aplicado ao saldo — não o que o pedido pediu. */
  quantidade: number;
  /** O que o pedido pediu. Difere de `quantidade` quando vendeu sem saldo. */
  quantidade_pedida: number | null;
  motivo: MotivoMovimento;
  canal_origem: string | null;
  documento: string | null;
  estoque_anterior: number | null;
  estoque_resultante: number | null;
}

const ROTULO_MOTIVO: Record<MotivoMovimento, string> = {
  venda: 'Venda',
  entrada: 'Entrada',
  estorno_venda: 'Estorno de venda',
  venda_sku_nao_encontrado: 'Venda de SKU não cadastrado',
  estorno_sku_nao_encontrado: 'Estorno de SKU não cadastrado',
  cancelamento_sem_baixa: 'Cancelamento sem baixa',
  venda_cancelada_antes: 'Venda cancelada antes da baixa',
};

/** Motivo → texto do operador. Motivo desconhecido devolve o próprio identificador
 *  em vez de `undefined`, para a tela nunca renderizar vazio. */
export function rotuloMotivo(m: MotivoMovimento): string {
  return ROTULO_MOTIVO[m] ?? m;
}

/**
 * Motivos que NÃO mexeram no saldo — são registros de diagnóstico. O operador
 * precisa vê-los (é como descobre venda de SKU fora do catálogo), mas exibi-los
 * com "+0"/"-0" confundiria.
 */
export function movimentoInformativo(m: MovimentoEstoque): boolean {
  return m.quantidade === 0;
}

/** Últimos movimentos do produto. A RLS por org já filtra o tenant. */
export async function fetchMovimentosEstoque(
  codigoPai: string, limite = 20,
): Promise<MovimentoEstoque[]> {
  const { data, error } = await supabase
    .from('estoque_movimentos')
    .select('id, criado_em, codigo, quantidade, quantidade_pedida, motivo, canal_origem, documento, estoque_anterior, estoque_resultante')
    .eq('codigo_pai', codigoPai)
    .order('criado_em', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return (data ?? []) as unknown as MovimentoEstoque[];
}
