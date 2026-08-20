// ADR-0128 D-11/D-8: status de atualização por produto na tela Estoque — badge no card
// (Task 6) e pré-check do bloqueio "família em voo" antes de abrir o dialog "Adicionar variação".
import { supabase } from '@/lib/supabase';

export interface FamiliaStatusRow {
  codigo_pai: string; status: string; operacao: string; criado_em: string;
}

/** PostgREST (RLS de org já filtra): familias.select('codigo_pai, status, operacao, criado_em')
 *  .neq('status', 'publicado') — ponytail: sem filtro de data até virar problema medido. */
export async function fetchFamiliasNaoPublicadas(): Promise<FamiliaStatusRow[]> {
  const { data, error } = await supabase
    .from('familias')
    .select('codigo_pai, status, operacao, criado_em')
    .neq('status', 'publicado');
  if (error) throw error;
  return (data ?? []) as FamiliaStatusRow[];
}

export type StatusUpdateProduto = 'atualizando' | 'erro';

const STATUS_ATUALIZANDO = new Set(['pendente', 'processando', 'pronto', 'publicando']);
const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

/** Família UPDATE mais recente por codigo_pai:
 *  pendente|processando|pronto|publicando -> 'atualizando'
 *  erro com criado_em < 7 dias -> 'erro'; senão ausente do mapa. Ignora operacao='CREATE'. */
export function statusUpdatePorProduto(
  rows: FamiliaStatusRow[], agora: Date = new Date(),
): Map<string, StatusUpdateProduto> {
  const maisRecentePorCodigo = new Map<string, FamiliaStatusRow>();
  for (const r of rows) {
    if (r.operacao !== 'UPDATE') continue;
    const atual = maisRecentePorCodigo.get(r.codigo_pai);
    if (!atual || new Date(r.criado_em) > new Date(atual.criado_em)) {
      maisRecentePorCodigo.set(r.codigo_pai, r);
    }
  }
  const out = new Map<string, StatusUpdateProduto>();
  for (const [codigoPai, r] of maisRecentePorCodigo) {
    if (STATUS_ATUALIZANDO.has(r.status)) {
      out.set(codigoPai, 'atualizando');
    } else if (r.status === 'erro' && agora.getTime() - new Date(r.criado_em).getTime() < SETE_DIAS_MS) {
      out.set(codigoPai, 'erro');
    }
  }
  return out;
}

/** Pré-check D-8 (qualquer operacao conta — é o mesmo predicado da edge): existe família
 *  não-terminal (nem publicado nem erro) para este codigo_pai. */
export function familiaEmVoo(rows: FamiliaStatusRow[], codigoPai: string): boolean {
  return rows.some((r) => r.codigo_pai === codigoPai && r.status !== 'publicado' && r.status !== 'erro');
}
