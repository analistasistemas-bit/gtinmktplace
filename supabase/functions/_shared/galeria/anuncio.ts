// Identidade da galeria = anúncio/partição (ADR-0201, Global Constraints do plano). Reusado pelas edges da galeria.
// `admin` entra por parâmetro (só tipo importado) para os testes não carregarem `supabase.ts`.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface VariacaoGaleria {
  codigo: string;
  cor: string | null;
  imagem_path: string | null;
  peso_gramas?: number | null;
  altura_cm?: number | null;
  largura_cm?: number | null;
  comprimento_cm?: number | null;
}

export interface FamiliaPublicada {
  id: string;
  publicado_em: string;
  nome_pai?: string | null;
  descricao_pai?: string | null;
  marca?: string | null;
  origem?: string | null;
  titulo_ml?: string | null;
  descricao_ml?: string | null;
  atributos_ml?: Array<{ id?: string; name?: string; value_name?: string | null; value_id?: string }> | null;
  variacoes: VariacaoGaleria[];
}

export interface AnuncioGaleria {
  anuncioId: string;
  codigoPai: string;
  /** SKUs vivos: `variacoes_externas` da partição ou filhos UP não retirados. */
  skus: string[];
  /** MLB de cada SKU vivo (Legacy: o da partição; UP: o do filho). */
  itemPorSku: Record<string, string>;
  /** Família de maior `publicado_em` do codigo_pai com pelo menos um SKU vivo: dados de família. */
  vigente: FamiliaPublicada;
  /** Dados por SKU: variação mais nova daquele SKU entre as famílias publicadas. */
  porSku: Record<string, VariacaoGaleria & { familia_id: string }>;
}

const COLUNAS_FAMILIA = 'id, publicado_em, nome_pai, descricao_pai, marca, origem, titulo_ml, descricao_ml, atributos_ml, '
  + 'variacoes(codigo, cor, imagem_path, peso_gramas, altura_cm, largura_cm, comprimento_cm)';

/** MLB clicado → anúncio da org (partição Legacy ou pai de filho UP). Nenhum ou mais de um → anuncio_ambiguo. */
export async function resolverAnuncio(
  admin: SupabaseClient, orgId: string, mlItemId: string,
): Promise<{ anuncioId: string } | { erro: 'anuncio_ambiguo' }> {
  const [{ data: diretos, error: e1 }, { data: filhos, error: e2 }] = await Promise.all([
    admin.from('anuncios_externos').select('id').eq('org_id', orgId).eq('canal', 'mercado_livre').eq('item_externo_id', mlItemId),
    admin.from('anuncios_externos_itens').select('anuncio_externo_id').eq('org_id', orgId).eq('item_externo_id', mlItemId).eq('retirado', false),
  ]);
  if (e1 || e2) throw new Error((e1 ?? e2)!.message);
  const ids = new Set([
    ...(diretos ?? []).map((r: { id: string }) => r.id),
    ...(filhos ?? []).map((r: { anuncio_externo_id: string }) => r.anuncio_externo_id),
  ]);
  return ids.size === 1 ? { anuncioId: [...ids][0] } : { erro: 'anuncio_ambiguo' };
}

export async function carregarAnuncio(
  admin: SupabaseClient, orgId: string, anuncioId: string,
): Promise<AnuncioGaleria | { erro: 'anuncio_ambiguo' | 'sem_familia_vigente' }> {
  const { data: an, error } = await admin.from('anuncios_externos')
    .select('id, codigo_pai, item_externo_id, variacoes_externas').eq('id', anuncioId).eq('org_id', orgId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!an) return { erro: 'anuncio_ambiguo' };
  const { data: filhos, error: eF } = await admin.from('anuncios_externos_itens')
    .select('sku, item_externo_id').eq('anuncio_externo_id', anuncioId).eq('org_id', orgId).eq('retirado', false);
  if (eF) throw new Error(eF.message);

  const itemPorSku: Record<string, string> = {};
  const vivos = (filhos ?? []) as Array<{ sku: string; item_externo_id: string | null }>;
  if (vivos.length > 0) {
    for (const f of vivos) if (f.item_externo_id) itemPorSku[f.sku] = f.item_externo_id;
  } else if (an.item_externo_id) {
    const ve = an.variacoes_externas;
    for (const sku of Object.keys(ve && typeof ve === 'object' && !Array.isArray(ve) ? ve : {})) itemPorSku[sku] = an.item_externo_id;
  }
  const skus = Object.keys(itemPorSku).sort();

  const { data: fams, error: eFam } = await admin.from('familias').select(COLUNAS_FAMILIA)
    .eq('org_id', orgId).eq('codigo_pai', an.codigo_pai).not('publicado_em', 'is', null)
    .order('publicado_em', { ascending: false });
  if (eFam) throw new Error(eFam.message);
  const familias = (fams ?? []) as unknown as FamiliaPublicada[];

  const vivo = new Set(skus);
  const vigente = familias.find((f) => (f.variacoes ?? []).some((v) => vivo.has(v.codigo)));
  if (!vigente) return { erro: 'sem_familia_vigente' };

  const porSku: AnuncioGaleria['porSku'] = {};
  for (const sku of skus) {
    for (const f of familias) {
      const v = (f.variacoes ?? []).find((x) => x.codigo === sku);
      if (v) { porSku[sku] = { ...v, familia_id: f.id }; break; }
    }
  }
  return { anuncioId, codigoPai: an.codigo_pai, skus, itemPorSku, vigente, porSku };
}

/** SKUs vivos da cor (comparação pelo nome cadastrado, sem espaços nas pontas). */
export function skusDaCor(a: AnuncioGaleria, cor: string): string[] {
  return a.skus.filter((s) => (a.porSku[s]?.cor ?? '').trim() === cor.trim());
}

/** Cores do anúncio (dos SKUs vivos com variação conhecida). */
export function coresDoAnuncio(a: AnuncioGaleria): string[] {
  return [...new Set(a.skus.map((s) => (a.porSku[s]?.cor ?? '').trim()).filter((c) => c !== ''))];
}
