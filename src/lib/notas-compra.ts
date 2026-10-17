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

/** gtin → codigo_pai[] distintos. Só GTIN válido; lotes de 200, cada lote paginado (o PostgREST corta
 *  em 1000 linhas e cada família de UPDATE repete o GTIN — sem paginar, um GTIN de dois produtos
 *  podia parecer único e casar sozinho). */
export async function produtosPorGtin(gtins: string[]): Promise<Record<string, string[]>> {
  type Linha = { gtin: string | null; familias: { codigo_pai: string } | { codigo_pai: string }[] | null };
  const validos = [...new Set(gtins.filter(gtinValido))];
  const out: Record<string, Set<string>> = {};
  for (let i = 0; i < validos.length; i += 200) {
    const lote = validos.slice(i, i + 200);
    const data = await buscarTodasPaginas<Linha>((de, ate) => supabase.from('variacoes')
      .select('gtin, familias!inner(codigo_pai)').in('gtin', lote).order('id').range(de, ate) as unknown as
      PromiseLike<{ data: Linha[] | null; error: { message: string } | null }>);
    for (const r of data) {
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

export interface SugestaoDistribuicao { fator: number; linhas: Array<{ codigo: string; quantidade: number }> }

/** Jsonb vindo do banco: só aceita a forma que a edge grava; qualquer outra coisa = sem sugestão. */
function sugestaoValida(v: unknown): SugestaoDistribuicao | null {
  const s = v as { fator?: unknown; linhas?: unknown } | null;
  if (!s || !Number.isInteger(s.fator) || (s.fator as number) < 1 || !Array.isArray(s.linhas)) return null;
  const ok = s.linhas.every((l) => typeof l?.codigo === 'string' && Number.isInteger(l?.quantidade) && l.quantidade > 0);
  return ok ? { fator: s.fator as number, linhas: s.linhas.map((l) => ({ codigo: l.codigo, quantidade: l.quantidade })) } : null;
}

/** Produtos cadastrados a partir desta nota (familias.mudanca_estrutural.refNota = `nfe:{chave}:{nItem}`), por item.
 *  Emenda 2026-10-17: + a sugestão de distribuição gravada no cadastro (versões com sugestões
 *  diferentes → a da versão mais recente por `criado_em`). */
export async function produtosCadastradosDaNota(chave: string):
  Promise<Array<{ nItem: number; codigosPai: string[]; sugestao: SugestaoDistribuicao | null }>> {
  const rows = await buscarTodasPaginas<{ codigo_pai: string; ref: string | null; criado_em?: string; sugestao?: unknown }>(
    (de, ate) => supabase.from('familias')
      .select('codigo_pai, criado_em, ref:mudanca_estrutural->>refNota, sugestao:mudanca_estrutural->sugestaoDistribuicao')
      .eq('origem_cadastro', 'nota')
      .like('mudanca_estrutural->>refNota', `nfe:${chave}:%`).order('id').range(de, ate));
  const porItem = new Map<number, { codigos: Set<string>; sugestao: SugestaoDistribuicao | null; em: string }>();
  for (const r of rows) {
    if (!(r.ref ?? '').startsWith(`nfe:${chave}:`)) continue; // defesa: o filtro `like` já faz isso no servidor
    const nItem = Number((r.ref ?? '').split(':')[2]);
    if (!Number.isInteger(nItem)) continue;
    const atual = porItem.get(nItem) ?? { codigos: new Set<string>(), sugestao: null, em: '' };
    atual.codigos.add(r.codigo_pai);
    const s = sugestaoValida(r.sugestao);
    if (s && (r.criado_em ?? '') >= atual.em) { atual.sugestao = s; atual.em = r.criado_em ?? ''; }
    porItem.set(nItem, atual);
  }
  return [...porItem].map(([nItem, x]) => ({ nItem, codigosPai: [...x.codigos], sugestao: x.sugestao }));
}

/**
 * ADR-0181 D-9 (emenda 2026-10-17): prova POSITIVA de 1ª entrada do produto — só `true` se a versão
 * mais antiga do `codigo_pai` nasceu pela nota (D-4: nunca teve estoque inicial nem planilha), se
 * nenhum SKU dele (em qualquer versão) tem movimento no ledger e se o saldo é 0 em todas as versões.
 * Vazio não é prova (false). Erro de consulta LANÇA — quem chama cai no custo da nota.
 * Risco residual aceito: nota → UPDATE por planilha com estoque → lote excluído → nova nota não deixa
 * rastro; a tela mostra o selo "Custo do cadastro (1ª entrada)" para o operador conferir.
 */
export async function primeiraEntradaComprovada(codigoPai: string): Promise<boolean> {
  const fams = await buscarTodasPaginas<{ id: string; origem_cadastro: string | null; criado_em: string }>(
    (de, ate) => supabase.from('familias').select('id, origem_cadastro, criado_em')
      .eq('codigo_pai', codigoPai).order('criado_em').order('id').range(de, ate));
  if (fams.length === 0) return false;
  const original = [...fams].sort((a, b) => a.criado_em.localeCompare(b.criado_em) || a.id.localeCompare(b.id))[0];
  if (original.origem_cadastro !== 'nota') return false;
  const ids = fams.map((f) => f.id);
  const vars: Array<{ codigo: string; estoque: number | string | null }> = [];
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200);
    vars.push(...await buscarTodasPaginas<{ codigo: string; estoque: number | string | null }>(
      (de, ate) => supabase.from('variacoes').select('codigo, estoque').in('familia_id', lote).order('id').range(de, ate)));
  }
  if (vars.length === 0 || vars.some((v) => Number(v.estoque ?? 0) !== 0)) return false;
  const codigos = [...new Set(vars.map((v) => v.codigo))];
  for (let i = 0; i < codigos.length; i += 200) {
    const { data, error } = await supabase.from('estoque_movimentos').select('id').in('codigo', codigos.slice(i, i + 200)).limit(1);
    if (error) throw new Error(error.message);
    if ((data ?? []).length > 0) return false;
  }
  return true;
}
