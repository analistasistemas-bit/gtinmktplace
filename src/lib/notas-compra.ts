// ADR-0181 — camada de dados da importação de NF-e de compra (RLS por org; escrita só pelas edges).
import { supabase } from '@/lib/supabase';
import { buscarTodasPaginas } from '@/lib/paginacao-supabase';
import { erroDaEdge } from '@/lib/edge-erro';
import { signedUrl } from '@/lib/storage';
import { gtinValido } from '../../supabase/functions/_shared/nfe/regras.ts';
import type { DecisaoImportacao } from '../../supabase/functions/_shared/nfe/tipos.ts';

export interface Vinculo { cprod: string; codigoPai: string; fator: number }
export interface NotaCompraResumo {
  id: string; chave: string; numero: number; emitenteNome: string; emitidaEm: string;
  valorTotal: number; status: 'importada' | 'desfeita' | 'cancelada'; assinada: boolean; xmlPath: string;
}

export async function buscarVinculos(cnpjFornecedor: string): Promise<Vinculo[]> {
  const { data, error } = await supabase.from('vinculos_fornecedor')
    .select('cprod, codigo_pai, fator_conversao').eq('cnpj_fornecedor', cnpjFornecedor);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ cprod: r.cprod, codigoPai: r.codigo_pai, fator: Number(r.fator_conversao) }));
}

/** gtin → codigo_pai[] distintos. Só GTIN válido; lotes de 200. */
export async function produtosPorGtin(gtins: string[]): Promise<Record<string, string[]>> {
  const validos = [...new Set(gtins.filter(gtinValido))];
  const out: Record<string, Set<string>> = {};
  for (let i = 0; i < validos.length; i += 200) {
    const { data, error } = await supabase.from('variacoes')
      .select('gtin, familias!inner(codigo_pai)').in('gtin', validos.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as unknown as Array<{ gtin: string | null; familias: { codigo_pai: string } | { codigo_pai: string }[] | null }>) {
      const fam = Array.isArray(r.familias) ? r.familias[0] : r.familias;
      if (r.gtin && fam?.codigo_pai) (out[r.gtin] ??= new Set()).add(fam.codigo_pai);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([g, s]) => [g, [...s]]));
}

export async function statusDaNota(chave: string): Promise<{ status: NotaCompraResumo['status']; importadaEm: string } | null> {
  const { data, error } = await supabase.from('notas_compra').select('status, importada_em').eq('chave', chave).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { status: data.status as NotaCompraResumo['status'], importadaEm: data.importada_em } : null;
}

export async function listarNotasCompra(): Promise<NotaCompraResumo[]> {
  const { data, error } = await supabase.from('notas_compra')
    .select('id, chave, numero, emitente_nome, emitida_em, valor_total, status, assinada, xml_path')
    .order('emitida_em', { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id, chave: r.chave, numero: r.numero, emitenteNome: r.emitente_nome, emitidaEm: r.emitida_em,
    valorTotal: Number(r.valor_total), status: r.status as NotaCompraResumo['status'], assinada: !!r.assinada, xmlPath: r.xml_path,
  }));
}

export async function importarNotaCompra(b: { xml: string; decisoes: DecisaoImportacao[]; aceitarDivergenciaTotal: boolean }):
  Promise<{ notaId: string; duplicada: boolean; pushOk: boolean }> {
  const { data, error } = await supabase.functions.invoke('importar-nota-compra', { body: b });
  if (error) throw await erroDaEdge(error);
  return data;
}

export async function desfazerNotaCompra(notaId: string, status: 'desfeita' | 'cancelada'): Promise<{ pushOk: boolean; jaEstava: boolean }> {
  const { data, error } = await supabase.functions.invoke('desfazer-nota-compra', { body: { notaId, status } });
  if (error) throw await erroDaEdge(error);
  return data;
}

export async function reenviarEstoqueNota(chave: string): Promise<{ pushOk: boolean }> {
  const { data, error } = await supabase.functions.invoke('importar-nota-compra', { body: { reenviarPush: { chave } } });
  if (error) throw await erroDaEdge(error);
  return data;
}

export const urlXmlNota = (xmlPath: string): Promise<string> => signedUrl('notas-compra', xmlPath, 60);

/** Entradas já lançadas com a ref desta nota (`nfe:{chave}:{nItem}:{codigo}`), para a retomada. */
export async function entradasPreviasDaNota(chave: string): Promise<Array<{ nItem: number; codigo: string; quantidade: number; custo: number | null }>> {
  const rows = await buscarTodasPaginas<{ codigo: string; quantidade: number; custo_unitario: number | null; referencia_externa: string | null }>(
    (de, ate) => supabase.from('estoque_movimentos')
      .select('codigo, quantidade, custo_unitario, referencia_externa')
      .like('referencia_externa', `nfe:${chave}:%`).order('id').range(de, ate));
  return rows.map((r) => ({
    nItem: Number((r.referencia_externa ?? '').split(':')[2]), codigo: r.codigo,
    quantidade: Number(r.quantidade), custo: r.custo_unitario === null ? null : Number(r.custo_unitario),
  }));
}
