// E6b (ADR-0094): leitura do ledger de estoque para a UI.
// A escrita nunca passa por aqui — toda mudança de saldo é feita por RPC via edge
// com service_role (D-15), e a escrita direta em `variacoes.estoque` é bloqueada
// por trigger (D-20). Este módulo é só leitura.
import { supabase } from './supabase';
import type { Janela } from './metricas';

/** Espelha o check-constraint `estoque_movimentos_motivo_check` da migration. */
export const MOTIVOS_MOVIMENTO = [
  'venda',
  'entrada',
  'estorno_venda',
  'venda_sku_nao_encontrado',
  'estorno_sku_nao_encontrado',
  'cancelamento_sem_baixa',
  'venda_cancelada_antes',
  // ADR-0110: redução manual de saldo (venda física, perda, fim de estoque).
  'ajuste',
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
  ajuste: 'Ajuste manual',
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

/** Recortes que a UI oferece. Os 7 motivos do ledger são detalhe de auditoria: para quem filtra,
 *  `venda_sku_nao_encontrado` e `venda_cancelada_antes` são venda. O motivo exato continua escrito
 *  em cada linha, então agrupar aqui não esconde informação — só tira ruído do filtro. */
export const GRUPOS_MOTIVO = ['entradas', 'vendas', 'estornos', 'ajustes'] as const;

export type GrupoMotivo = (typeof GRUPOS_MOTIVO)[number];

export const ROTULO_GRUPO: Record<GrupoMotivo, string> = {
  entradas: 'Entradas',
  vendas: 'Vendas',
  estornos: 'Estornos',
  ajustes: 'Ajustes',
};

const MOTIVOS_POR_GRUPO: Record<GrupoMotivo, MotivoMovimento[]> = {
  entradas: ['entrada'],
  vendas: ['venda', 'venda_sku_nao_encontrado', 'venda_cancelada_antes'],
  estornos: ['estorno_venda', 'estorno_sku_nao_encontrado', 'cancelamento_sem_baixa'],
  ajustes: ['ajuste'],
};

/** Motivos cobertos pelos grupos escolhidos. Lista vazia = "Todos", que é AUSÊNCIA de recorte, não
 *  a união dos grupos: um motivo novo no ledger aparece em Todos mesmo antes de ser classificado. */
export function motivosDosGrupos(grupos: GrupoMotivo[]): MotivoMovimento[] {
  return grupos.flatMap((g) => MOTIVOS_POR_GRUPO[g]);
}

export interface FiltroMovimentos {
  /** Vazio = sem recorte por motivo. */
  grupos?: GrupoMotivo[];
  /** null = todo o período (default da tela). */
  janela?: Janela | null;
  /** SKU da variação. null = todas. */
  codigo?: string | null;
  ordem?: 'recentes' | 'antigos';
}

export interface PaginaMovimentos {
  itens: MovimentoEstoque[];
  /** Total que casa com os filtros — não o tamanho da página. É o que a tela mostra ao operador. */
  total: number;
}

const COLUNAS =
  'id, criado_em, codigo, quantidade, quantidade_pedida, motivo, canal_origem, documento, estoque_anterior, estoque_resultante';

/**
 * Uma página do ledger do produto. A RLS por org já filtra o tenant.
 * O `count: 'exact'` vem no mesmo round-trip: o total nunca fica defasado em relação às linhas
 * exibidas, que é o que permite dizer "1–20 de 956" com honestidade.
 */
export async function fetchMovimentosEstoque(
  codigoPai: string,
  pagina = 1,
  tamanho = 20,
  filtro: FiltroMovimentos = {},
): Promise<PaginaMovimentos> {
  const de = (Math.max(1, Math.floor(pagina) || 1) - 1) * tamanho;
  let q = supabase
    .from('estoque_movimentos')
    .select(COLUNAS, { count: 'exact' })
    .eq('codigo_pai', codigoPai);

  const motivos = motivosDosGrupos(filtro.grupos ?? []);
  if (motivos.length > 0) q = q.in('motivo', motivos);
  if (filtro.janela) {
    q = q.gte('criado_em', filtro.janela.desde).lte('criado_em', filtro.janela.ate);
  }
  if (filtro.codigo) q = q.eq('codigo', filtro.codigo);

  const { data, error, count } = await q
    .order('criado_em', { ascending: filtro.ordem === 'antigos' })
    .range(de, de + tamanho - 1);

  if (error) throw error;
  return { itens: (data ?? []) as unknown as MovimentoEstoque[], total: count ?? 0 };
}
