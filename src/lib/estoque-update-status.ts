// ADR-0129 D-11/D-8: status de atualização por produto na tela Estoque — badge no card
// (Task 6) e pré-check do bloqueio "família em voo" antes de abrir o dialog "Adicionar variação".
import { supabase } from '@/lib/supabase';

export interface FamiliaStatusRow {
  codigo_pai: string; status: string; operacao: string; criado_em: string; lote_id?: string | null;
  /** Cores da família que ainda NÃO existem no anúncio do canal (embed filtrado por
   *  `ml_variation_id is null`). É o que distingue a cor que falhou das que já estão lá. */
  variacoes?: Array<{ codigo: string; ml_variation_id: string | null }> | null;
}

/** PostgREST (RLS de org já filtra): famílias não publicadas + as cores delas que ainda não têm
 *  variação no canal. O `.is('variacoes.ml_variation_id', null)` filtra o EMBED (não a família:
 *  sem `!inner` o pai vem de qualquer jeito) só para não trazer as cores já vinculadas —
 *  `coresSemVinculoPorProduto` refiltra no cliente, então um embed sem filtro não vira badge
 *  errado. Ponytail: sem filtro de data até virar problema medido. */
export async function fetchFamiliasNaoPublicadas(): Promise<FamiliaStatusRow[]> {
  const { data, error } = await supabase
    .from('familias')
    .select('codigo_pai, status, operacao, criado_em, lote_id, variacoes(codigo, ml_variation_id)')
    .is('variacoes.ml_variation_id', null)
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
function updatesMaisRecentes(rows: FamiliaStatusRow[]): Map<string, FamiliaStatusRow> {
  const maisRecentePorCodigo = new Map<string, FamiliaStatusRow>();
  for (const r of rows) {
    if (r.operacao !== 'UPDATE') continue;
    const atual = maisRecentePorCodigo.get(r.codigo_pai);
    if (!atual || new Date(r.criado_em) > new Date(atual.criado_em)) {
      maisRecentePorCodigo.set(r.codigo_pai, r);
    }
  }
  return maisRecentePorCodigo;
}

export function statusUpdatePorProduto(
  rows: FamiliaStatusRow[], agora: Date = new Date(),
): Map<string, StatusUpdateProduto> {
  const maisRecentePorCodigo = updatesMaisRecentes(rows);
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

/** Lote da família UPDATE mais recente por codigo_pai — destino do botão "Revisar" do card
 *  quando o update falhou (a tela de Revisão é onde o operador corrige e reenvia). */
export function loteUpdatePorProduto(rows: FamiliaStatusRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const [codigoPai, r] of updatesMaisRecentes(rows)) {
    if (r.lote_id) out.set(codigoPai, r.lote_id);
  }
  return out;
}

/** Cores da família UPDATE mais recente que ainda não existem no anúncio — as que o card marca
 *  com a pílula "Erro" quando o update falhou. Antes isso vinha de um marcador em memória posto
 *  pelo diálogo de "Adicionar variação": sumia no primeiro F5 e o operador ficava sabendo que a
 *  família falhou, mas não QUAL cor (relato do Diego 2026-09-03). */
export function coresSemVinculoPorProduto(rows: FamiliaStatusRow[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [codigoPai, r] of updatesMaisRecentes(rows)) {
    const codigos = (r.variacoes ?? []).filter((v) => v.ml_variation_id == null).map((v) => v.codigo);
    if (codigos.length > 0) out.set(codigoPai, new Set(codigos));
  }
  return out;
}

/** Pré-check D-8 (qualquer operacao conta — é o mesmo predicado da edge): existe família
 *  não-terminal (nem publicado nem erro) para este codigo_pai. */
export function familiaEmVoo(rows: FamiliaStatusRow[], codigoPai: string): boolean {
  return rows.some((r) => r.codigo_pai === codigoPai && r.status !== 'publicado' && r.status !== 'erro');
}

/**
 * Achado 2026-08-21: o badge "Atualizando…" só SOME quando o UPDATE termina — sem distinguir
 * "terminou com sucesso" de "sumiu por algum outro motivo", o operador fica sem sinal nenhum
 * (relato do Diego: "sumiu, não atualizou nada na tela, aviso nenhum"). `erro` já tem seu próprio
 * badge persistente — só o caminho `atualizando -> ausente` (== virou `publicado`) precisa de
 * confirmação explícita. Compara dois snapshots consecutivos do poll de 15s (Estoque.tsx) e
 * devolve os `codigo_pai` que terminaram com sucesso desde o snapshot anterior.
 */
export function codigosConcluidosComSucesso(
  anterior: Map<string, StatusUpdateProduto>,
  atual: Map<string, StatusUpdateProduto>,
): string[] {
  const out: string[] = [];
  for (const [codigoPai, status] of anterior) {
    if (status === 'atualizando' && !atual.has(codigoPai)) out.push(codigoPai);
  }
  return out;
}
