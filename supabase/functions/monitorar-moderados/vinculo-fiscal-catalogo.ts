// Emenda ADR-0135 (01/11/2026) — revarredura 6/6h do vínculo fiscal nas cópias de catálogo.
// Parte das CÓPIAS (busca catalog_listing=true), não das famílias: no Legacy com variação o
// anúncio principal vem com item_relations vazio — só a cópia aponta {principal, variation_id}.
// Não reenfileira push (o C4 já cuida do push pendente); só refaz o vínculo SKU→cópia, que é
// idempotente no ML. Falha numa cópia não para as outras.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { vincularSkuAnuncio, type RelacaoItem } from '../_shared/canais/fiscal-ml.ts';
import { caminhoMultiget, comoEnvelopeAntigo } from '../_shared/ml/multiget.ts';

const API = 'https://api.mercadolibre.com';

export interface CopiaCatalogo { id: string; sku: string | null; principal: RelacaoItem | null }

export interface DepsCopias {
  moduloFiscal: (orgId: string) => Promise<boolean>;
  listarCopias: (token: string, sellerId: string) => Promise<string[]>;
  lerCopias: (token: string, ids: string[]) => Promise<CopiaCatalogo[]>;
  resolverSku: (orgId: string, principal: RelacaoItem) => Promise<string | null>;
  skusComFiscal: (orgId: string, skus: string[]) => Promise<Set<string>>;
  vincular: (token: string, v: { sku: string; item_id: string }) => Promise<void>;
}

export async function vincularCopiasCatalogo(
  orgId: string, sellerId: string, token: string, deps: DepsCopias,
): Promise<number> {
  if (!(await deps.moduloFiscal(orgId))) return 0;
  const copias = await deps.lerCopias(token, await deps.listarCopias(token, sellerId));
  const alvo: Array<{ sku: string; item_id: string }> = [];
  for (const c of copias) {
    if (!c.principal) continue;
    const sku = c.sku ?? await deps.resolverSku(orgId, c.principal);
    if (sku) alvo.push({ sku, item_id: c.id });
  }
  if (alvo.length === 0) return 0;
  const comFiscal = await deps.skusComFiscal(orgId, [...new Set(alvo.map((a) => a.sku))]);
  let n = 0;
  for (const a of alvo) {
    if (!comFiscal.has(a.sku)) continue; // o ML recusaria: SKU sem fiscal_information
    try { await deps.vincular(token, a); n++; }
    catch (e) { console.warn(`vínculo fiscal da cópia ${a.item_id} (SKU ${a.sku}) falhou:`, (e as Error).message); }
  }
  return n;
}

/** SKU de uma cópia sem seller_custom_field, pelo anúncio principal: variação da família
 *  (Legacy; sentinela ADR-0084 quando sem variação), item UP, ou partição do split. */
export async function resolverSkuPeloPrincipal(
  admin: SupabaseClient, orgId: string, principal: RelacaoItem,
): Promise<string | null> {
  const lancar = (op: string, e: { message: string } | null) => { if (e) throw new Error(`resolverSku: ${op}: ${e.message}`); };

  const { data: fams, error: e1 } = await admin.from('familias').select('id')
    .eq('org_id', orgId).eq('ml_item_id', principal.id);
  lancar('familias', e1);
  if ((fams ?? []).length > 0) {
    const { data: vars, error: e2 } = await admin.from('variacoes')
      .select('codigo, ml_variation_id, excluida_da_publicacao')
      .in('familia_id', (fams as Array<{ id: string }>).map((f) => f.id));
    lancar('variacoes', e2);
    const ativas = ((vars ?? []) as Array<{ codigo: string; ml_variation_id: string | null; excluida_da_publicacao: boolean | null }>)
      .filter((v) => !v.excluida_da_publicacao);
    const alvo = principal.variation_id ?? principal.id; // sem variação: sentinela ADR-0084
    const skus = new Set(ativas.filter((v) => v.ml_variation_id === alvo).map((v) => v.codigo));
    if (skus.size === 1) return [...skus][0];
    const unicos = new Set(ativas.map((v) => v.codigo));
    if (!principal.variation_id && unicos.size === 1) return [...unicos][0];
  }

  const { data: itens, error: e3 } = await admin.from('anuncios_externos_itens').select('sku')
    .eq('org_id', orgId).eq('item_externo_id', principal.id).eq('retirado', false);
  lancar('anuncios_externos_itens', e3);
  const skusUP = new Set(((itens ?? []) as Array<{ sku: string | null }>).map((i) => i.sku).filter((s): s is string => !!s));
  if (skusUP.size === 1) return [...skusUP][0];

  const { data: parts, error: e4 } = await admin.from('anuncios_externos').select('variacoes_externas')
    .eq('org_id', orgId).eq('canal', 'mercado_livre').eq('item_externo_id', principal.id);
  lancar('anuncios_externos', e4);
  const mapa: Record<string, { variation_id?: unknown }> = {};
  for (const p of (parts ?? []) as Array<{ variacoes_externas: Record<string, { variation_id?: unknown }> | null }>) {
    Object.assign(mapa, p.variacoes_externas ?? {});
  }
  const chaves = Object.keys(mapa);
  if (principal.variation_id) {
    const achadas = chaves.filter((k) => mapa[k]?.variation_id != null && String(mapa[k].variation_id) === principal.variation_id);
    return achadas.length === 1 ? achadas[0] : null;
  }
  return chaves.length === 1 ? chaves[0] : null;
}

export function depsCopiasReais(admin: SupabaseClient): DepsCopias {
  const get = async (token: string, caminho: string): Promise<unknown> => {
    const r = await fetch(`${API}${caminho}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`GET ${caminho.split('?')[0]} → ${r.status}`);
    return r.json();
  };
  return {
    async moduloFiscal(orgId) {
      const { data, error } = await admin.from('organizations').select('modulos_habilitados').eq('id', orgId).maybeSingle();
      if (error) throw new Error(`vincularCopiasCatalogo: organizations: ${error.message}`);
      return ((data?.modulos_habilitados ?? []) as string[]).includes('fiscal');
    },
    async listarCopias(token, sellerId) {
      const ids: string[] = [];
      for (const status of ['active', 'paused']) {
        // ponytail: offset do search vai até 1000 por status; acima disso exigiria search_type=scan.
        for (let off = 0; off < 1000; off += 100) {
          const d = await get(token, `/users/${sellerId}/items/search?catalog_listing=true&status=${status}&limit=100&offset=${off}`) as
            { results?: string[]; paging?: { total?: number } };
          ids.push(...(d.results ?? []));
          if (off + 100 >= (d.paging?.total ?? 0)) break;
        }
      }
      return [...new Set(ids)];
    },
    async lerCopias(token, ids) {
      const out: CopiaCatalogo[] = [];
      for (let i = 0; i < ids.length; i += 20) {
        const bloco = ids.slice(i, i + 20);
        const arr = comoEnvelopeAntigo(await get(token, caminhoMultiget(bloco, 'id,seller_custom_field,item_relations')), bloco);
        for (const e of Array.isArray(arr) ? arr : []) {
          const { code, body } = (e ?? {}) as { code?: number; body?: { id?: string; seller_custom_field?: string | null; item_relations?: Array<{ id?: unknown; variation_id?: unknown }> } };
          if (code !== 200 || typeof body?.id !== 'string') continue; // cópia que sumiu: ignora só ela
          const r = (body.item_relations ?? []).find((x) => typeof x.id === 'string');
          out.push({
            id: body.id,
            sku: body.seller_custom_field?.trim() || null,
            principal: r ? { id: r.id as string, variation_id: r.variation_id == null ? null : String(r.variation_id) } : null,
          });
        }
      }
      return out;
    },
    resolverSku: (orgId, principal) => resolverSkuPeloPrincipal(admin, orgId, principal),
    async skusComFiscal(orgId, skus) {
      const { data, error } = await admin.from('variacoes').select('codigo, familias!inner(org_id, ncm)')
        .in('codigo', skus).eq('familias.org_id', orgId).not('familias.ncm', 'is', null);
      if (error) throw new Error(`vincularCopiasCatalogo: variacoes: ${error.message}`);
      return new Set(((data ?? []) as Array<{ codigo: string }>).map((v) => v.codigo));
    },
    vincular: (token, v) => vincularSkuAnuncio(token, v),
  };
}
