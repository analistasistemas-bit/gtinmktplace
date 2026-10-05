import { supabase } from './supabase';
import { buscarTodasPaginas } from './paginacao-supabase';

/** Ids das vendas do dossiê do SKU (packs/envios inteiros) — RPC `vendas_sku_dossie_ids`
 *  (Fatia 2a). Valor único (uuid[]) por POST: sem paginação, sem teto de 1.000 linhas. */
export async function buscarIdsDossie(codigos: string[]): Promise<string[]> {
  const { data, error } = await supabase.rpc('vendas_sku_dossie_ids', { p_codigos: codigos });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** MLB → códigos vinculados (exato/compartilhado) — RPC `vendas_sku_mlbs` (Fatia 2a). O objeto
 *  JSON `{ mlb: [codigo, ...] }` vira Map<mlb, codigos>. */
export async function buscarMlbsDossie(codigos: string[]): Promise<Map<string, string[]>> {
  const { data, error } = await supabase.rpc('vendas_sku_mlbs', { p_codigos: codigos });
  if (error) throw new Error(error.message);
  return new Map(Object.entries((data ?? {}) as Record<string, string[]>));
}

// ---- Fontes dos eventos (Fatia 2a). Tabelas com RLS por org; colunas explícitas, ordem estável. ----

export interface Movimento {
  id: string; codigo: string; motivo: string; quantidade: number; custo_unitario: number | null;
  estoque_anterior: number | null; estoque_resultante: number | null; criado_em: string;
}
export interface Moderacao {
  id: string; ml_item_id: string; status: string; motivo: string | null; detectado_em: string; resolvido_em: string | null;
}
export interface Pergunta { id: string; item_id: string | null; criada_em: string | null }
export interface Campanha {
  promocao_id: string; nome: string | null; tipo: string; status: string;
  inicio: string | null; fim: string | null; sincronizado_em: string;
}
export interface ItemCampanha {
  promocao_id: string; ml_item_id: string; status: string; preco_promo: number | null; sincronizado_em: string;
  /** null quando a campanha não está (mais) em ml_promocoes. */
  promocao: Campanha | null;
}

const LOTE_IN = 80; // mesmo lote de buscarVendasPorIds: URL do .in() fica curta

type Pagina<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** `valores` em lotes de {@link LOTE_IN} para o `.in()`, cada lote lido por todas as páginas. */
async function emLotes<T>(valores: string[], pagina: (lote: string[], de: number, ate: number) => Pagina<T>): Promise<T[]> {
  const todas: T[] = [];
  for (let i = 0; i < valores.length; i += LOTE_IN) {
    const lote = valores.slice(i, i + LOTE_IN);
    todas.push(...await buscarTodasPaginas<T>((de, ate) => pagina(lote, de, ate)));
  }
  return todas;
}

export const buscarMovimentos = (codigos: string[]) => emLotes<Movimento>(codigos, (lote, de, ate) =>
  supabase.from('estoque_movimentos')
    .select('id, codigo, motivo, quantidade, custo_unitario, estoque_anterior, estoque_resultante, criado_em')
    .in('codigo', lote).order('criado_em').order('id').range(de, ate));

export const buscarModeracoes = (mlbs: string[]) => emLotes<Moderacao>(mlbs, (lote, de, ate) =>
  supabase.from('ml_moderacao').select('id, ml_item_id, status, motivo, detectado_em, resolvido_em')
    .in('ml_item_id', lote).order('detectado_em').order('id').range(de, ate));

export const buscarPerguntas = (mlbs: string[]) => emLotes<Pergunta>(mlbs, (lote, de, ate) =>
  supabase.from('ml_perguntas').select('id, item_id, criada_em')
    .in('item_id', lote).order('criada_em').order('id').range(de, ate));

/** Situação atual dos MLBs nas campanhas: duas leituras (a FK composta não tem relationship no
 *  typegen) e join no cliente, como em promocoes.ts. */
export async function buscarCampanhas(mlbs: string[]): Promise<ItemCampanha[]> {
  const itens = await emLotes<Omit<ItemCampanha, 'promocao'>>(mlbs, (lote, de, ate) =>
    supabase.from('ml_promocao_itens').select('promocao_id, ml_item_id, status, preco_promo, sincronizado_em')
      .in('ml_item_id', lote).order('ml_item_id').order('promocao_id').range(de, ate));
  const ids = [...new Set(itens.map((i) => i.promocao_id))];
  const promos = await emLotes<Campanha>(ids, (lote, de, ate) =>
    supabase.from('ml_promocoes').select('promocao_id, nome, tipo, status, inicio, fim, sincronizado_em')
      .in('promocao_id', lote).order('promocao_id').range(de, ate));
  const porId = new Map(promos.map((p) => [p.promocao_id, p]));
  return itens.map((i) => ({ ...i, promocao: porId.get(i.promocao_id) ?? null }));
}

// ---- Tráfego e oferta (Fatia 2b). Dia = data literal BRT (spike 052). ----

export interface VisitaDia { ml_item_id: string; dia: string; visitas: number | null; estado: 'ok' | 'pendente' | 'falha' }
export interface PrecoDia { ml_item_id: string; dia: string; preco: number; observado_em: string }
export interface TrafegoSync { estado: string; carga_inicial_concluida_em: string | null; ultimo_ok_em: string | null }

/** Visitas/dia dos MLBs em `[desde, ate]` (datas YYYY-MM-DD, inclusive). */
export const buscarVisitasDia = (mlbs: string[], desde: string, ate: string) => emLotes<VisitaDia>(mlbs, (lote, de, fim) =>
  supabase.from('ml_item_visitas_dia').select('ml_item_id, dia, visitas, estado')
    .in('ml_item_id', lote).gte('dia', desde).lte('dia', ate).order('ml_item_id').order('dia').range(de, fim) as Pagina<VisitaDia>);

/** Preço de oferta observado por dia dos MLBs em `[desde, ate]`. */
export const buscarPrecoDia = (mlbs: string[], desde: string, ate: string) => emLotes<PrecoDia>(mlbs, (lote, de, fim) =>
  supabase.from('ml_item_preco_dia').select('ml_item_id, dia, preco, observado_em')
    .in('ml_item_id', lote).gte('dia', desde).lte('dia', ate).order('ml_item_id').order('dia').range(de, fim));

/** Estado da coleta da org (RLS: só a própria org); null = a coleta nunca rodou. */
export async function buscarTrafegoSync(): Promise<TrafegoSync | null> {
  const { data, error } = await supabase.from('ml_trafego_sync').select('estado, carga_inicial_concluida_em, ultimo_ok_em').maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// ---- Ads (Fatia 2c). Tabelas org-scoped com RLS; unidade = ad_group_id. ----

export interface AdsSync {
  estado: string; erro: string | null; ultimo_ok_em: string | null; carga_inicial_ok: boolean; cobertura_desde: string | null;
  /** metrics_summary.cost × Σ dos grupos listados na última janela ok: diferença > 0 = gasto fora de grupo listado. */
  custo_resumo: number | null; custo_listado: number | null;
}
export interface AdsGrupo {
  ad_group_id: number; tipo: 'ITEM' | 'FAMILY' | 'CATALOG'; external_id: string | null; campaign_id: number | null;
  status: string; atualizado_em: string;
}
export interface AdsMembro { ad_group_id: number; ml_item_id: string }
export interface AdsDia {
  ad_group_id: number; dia: string; cost: number; clicks: number; prints: number; direct_amount: number;
  indirect_amount: number; total_amount: number; direct_units: number; units: number; coletado_em: string;
}
/** Grupos que tocam os MLBs do dossiê, TODOS os membros deles e o código de cada membro. */
export interface FonteAds {
  sync: AdsSync | null; grupos: AdsGrupo[]; membros: AdsMembro[]; dias: AdsDia[];
  codigosDosMembros: Map<string, string[]>;
}

/** Estado da coleta de Ads da org; null = nunca rodou. */
export async function buscarAdsSync(): Promise<AdsSync | null> {
  const { data, error } = await supabase.from('ml_ads_sync')
    .select('estado, erro, ultimo_ok_em, carga_inicial_ok, cobertura_desde, custo_resumo, custo_listado').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  // numeric do Postgres: Number() como em src/lib/pulse.ts (o PostgREST pode devolver string em precisão alta).
  return { ...data, custo_resumo: data.custo_resumo == null ? null : Number(data.custo_resumo),
    custo_listado: data.custo_listado == null ? null : Number(data.custo_listado) };
}

/** Só o `ultimo_ok_em` da coleta de Ads (fim do período: `fimDiasAds`). Chave de cache `['ads-sync-fim']`,
 *  compartilhada pelo painel e pelo dossiê. */
export async function buscarUltimoOkAds(): Promise<string | null> {
  const { data, error } = await supabase.from('ml_ads_sync').select('ultimo_ok_em').maybeSingle();
  if (error) throw new Error(error.message);
  return data?.ultimo_ok_em ?? null;
}

/** MLB → códigos de MLBs arbitrários — RPC `vendas_sku_codigos_mlbs` (mesma UNION de vendas_sku_mlbs).
 *  MLB sem código não vem no objeto. */
export async function buscarCodigosMlbs(mlbs: string[]): Promise<Map<string, string[]>> {
  if (!mlbs.length) return new Map();
  const { data, error } = await supabase.rpc('vendas_sku_codigos_mlbs', { p_mlbs: mlbs });
  if (error) throw new Error(error.message);
  return new Map(Object.entries((data ?? {}) as Record<string, string[]>));
}

export async function buscarFonteAds(mlbs: string[], desde: string, ate: string): Promise<FonteAds> {
  const [sync, doDossie] = await Promise.all([
    buscarAdsSync(),
    emLotes<AdsMembro>(mlbs, (lote, de, fim) => supabase.from('ml_ads_grupo_item').select('ad_group_id, ml_item_id')
      .in('ml_item_id', lote).order('ad_group_id').order('ml_item_id').range(de, fim)),
  ]);
  const ids = [...new Set(doDossie.map((m) => String(m.ad_group_id)))].sort();
  if (!ids.length) return { sync, grupos: [], membros: [], dias: [], codigosDosMembros: new Map() };
  const [grupos, membros, dias] = await Promise.all([
    emLotes<AdsGrupo>(ids, (lote, de, fim) => supabase.from('ml_ads_grupo')
      .select('ad_group_id, tipo, external_id, campaign_id, status, atualizado_em')
      .in('ad_group_id', lote.map(Number)).order('ad_group_id').range(de, fim) as Pagina<AdsGrupo>),
    emLotes<AdsMembro>(ids, (lote, de, fim) => supabase.from('ml_ads_grupo_item').select('ad_group_id, ml_item_id')
      .in('ad_group_id', lote.map(Number)).order('ad_group_id').order('ml_item_id').range(de, fim)),
    emLotes<AdsDia>(ids, (lote, de, fim) => supabase.from('ml_ads_grupo_dia')
      .select('ad_group_id, dia, cost, clicks, prints, direct_amount, indirect_amount, total_amount, direct_units, units, coletado_em')
      .in('ad_group_id', lote.map(Number)).gte('dia', desde).lte('dia', ate).order('ad_group_id').order('dia').range(de, fim)),
  ]);
  const codigosDosMembros = await buscarCodigosMlbs([...new Set(membros.map((m) => m.ml_item_id))].sort());
  // numeric → Number() (mesmo cinto de src/lib/pulse.ts).
  const diasNum = dias.map((d) => ({
    ...d, cost: Number(d.cost), direct_amount: Number(d.direct_amount), indirect_amount: Number(d.indirect_amount),
    total_amount: Number(d.total_amount),
  }));
  return { sync, grupos, membros, dias: diasNum, codigosDosMembros };
}

export interface ResumoAds { custo_conta: number; dias_conta: number; custo_grupos_com_membro: number }

/** Gasto de Ads da conta no período e quanto dele cai em grupos com membro — RPC `ads_resumo_periodo` (I2).
 *  numeric pode vir como string: Number() nos três campos. */
export async function buscarResumoAds(desde: string, ate: string): Promise<ResumoAds | null> {
  const { data, error } = await supabase.rpc('ads_resumo_periodo', { p_desde: desde, p_ate: ate });
  if (error) throw new Error(error.message);
  if (data == null) return null;
  const r = data as Record<string, unknown>;
  return { custo_conta: Number(r.custo_conta), dias_conta: Number(r.dias_conta), custo_grupos_com_membro: Number(r.custo_grupos_com_membro) };
}
