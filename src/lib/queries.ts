import { supabase } from './supabase';
import type { Database } from './database.types';
import type {
  Lote,
  Familia,
  FamiliaStatus,
  Variacao,
  LoteStatus,
  OperacaoML,
  EstrategiaPreco,
} from './tipos-dominio';

export const QK = {
  lotes: (userId: string) => ['lotes', userId] as const,
  lote: (loteId: string) => ['lote', loteId] as const,
  familias: (loteId: string) => ['familias', loteId] as const,
};

export type LoteRow = Database['public']['Tables']['lotes']['Row'];
export type FamiliaRow = Database['public']['Tables']['familias']['Row'];
export type VariacaoRow = Database['public']['Tables']['variacoes']['Row'];

export async function fetchLotes(): Promise<LoteRow[]> {
  const { data, error } = await supabase
    .from('lotes')
    .select('*')
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchLote(id: string): Promise<LoteRow | null> {
  const { data, error } = await supabase
    .from('lotes')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchFamilias(
  loteId: string
): Promise<(FamiliaRow & { variacoes: VariacaoRow[] })[]> {
  const { data, error } = await supabase
    .from('familias')
    .select('*, variacoes(*)')
    .eq('lote_id', loteId)
    .order('codigo_pai');
  if (error) throw error;
  return (data ?? []) as (FamiliaRow & { variacoes: VariacaoRow[] })[];
}

// ============================================================================
// Adapters DB -> tipos do M1 (camelCase)
// ============================================================================

// O DB usa enums em lowercase (proprio, competitivo) e o M1 usa UPPERCASE
// (PROPRIO, COMPETITIVO). Mapeamento isolado abaixo.
function mapEstrategiaPreco(
  v: Database['public']['Enums']['estrategia_preco'] | null
): EstrategiaPreco {
  if (v === 'competitivo') return 'COMPETITIVO';
  // 'proprio' e 'manual' caem em PROPRIO como default seguro do M2
  return 'PROPRIO';
}

export function loteFromRow(r: LoteRow): Lote {
  return {
    id: r.id,
    numero: r.numero,
    criadoEm: r.criado_em,
    status: r.status as LoteStatus,
    totalFamilias: r.total_familias,
    totalPublicadas: r.total_publicadas,
    totalErros: r.total_erros,
  };
}

export function variacaoFromRow(r: VariacaoRow): Variacao {
  return {
    codigo: r.codigo,
    cor: r.cor ?? '',
    corHex: r.cor_hex ?? '#cccccc',
    preco: Number(r.preco),
    estoque: r.estoque,
    editadoPeloOperador: r.preco_editado_pelo_operador,
  };
}

export function familiaFromRow(
  r: FamiliaRow & { variacoes: VariacaoRow[] }
): Familia {
  const variacoes = r.variacoes.map(variacaoFromRow);
  const precos = variacoes.map((v) => v.preco);
  const precoMin = precos.length > 0 ? Math.min(...precos) : 0;
  const precoMax = precos.length > 0 ? Math.max(...precos) : 0;

  return {
    id: r.id,
    loteId: r.lote_id,
    codigoPai: r.codigo_pai,
    titulo: r.titulo_ml ?? r.nome_pai,
    descricao: r.descricao_ml ?? r.descricao_pai ?? '',
    operacao: r.operacao as OperacaoML,
    estrategiaPreco: mapEstrategiaPreco(r.estrategia_preco),
    estrategiaMotivo: r.estrategia_motivo ?? '',
    concorrencia: 'sem', // M4 preencherá a partir da pesquisa de concorrência
    precoMin,
    precoMax,
    precoAbaixo20pc: false, // M4 detectará comparando com preço da planilha
    variacoes,
    editadoPeloOperador:
      r.titulo_editado_pelo_operador || r.descricao_editada_pelo_operador,
    status: r.status as FamiliaStatus,
  };
}
