import { gtinAusente } from './publicar.ts';
import { parseProdutoBusca } from '../concorrencia/parse.ts';

// Vinculação ao Catálogo do ML (ADR-0021). Validado com token real (2026-06-10):
// aviamentos são `catalog_required` (não `catalog_only` → o anúncio de marketplace
// sobrevive ao opt-in). O opt-in é `POST /items/catalog_listings`, um POST por variação,
// e só funciona quando a variação está `READY_FOR_OPTIN`/`buy_box_eligible` na elegibilidade.
// Anúncios que agrupam cores de famílias de catálogo diferentes vêm `FAMILY_DIFF` (bloqueado).

const API = 'https://api.mercadolibre.com';
const TIMEOUT_MS = 15000;

export type AcaoCatalogo = 'optin' | 'sem_produto' | 'family_diff' | 'nao_elegivel' | 'pula';

export interface EligVar {
  id: string | number;
  status?: string | null;
  buy_box_eligible?: boolean | null;
  reason?: string | null;
}

export interface EstadoVariacaoCatalogo {
  catalogListingId: string | null;
  catalogProductId: string | null;
}

/**
 * Decisão pura por variação a partir do estado local + elegibilidade do ML.
 * `catalogProductId` é o valor já resolvido (após o lookup por GTIN quando elegível).
 * Conservador: qualquer dúvida que não seja READY_FOR_OPTIN+buy_box → não arrisca opt-in.
 */
export function decidirAcaoCatalogo(
  estado: EstadoVariacaoCatalogo,
  elig: EligVar | undefined,
): AcaoCatalogo {
  if (estado.catalogListingId) return 'pula';
  if (!elig) return 'nao_elegivel';
  if (elig.status === 'FAMILY_DIFF') return 'family_diff';
  if (elig.status !== 'READY_FOR_OPTIN' || elig.buy_box_eligible !== true) return 'nao_elegivel';
  if (!estado.catalogProductId) return 'sem_produto';
  return 'optin';
}

export function montarBodyOptin(
  itemId: string,
  variationId: string | number,
  catalogProductId: string,
): { item_id: string; variation_id: number; catalog_product_id: string } {
  return { item_id: itemId, variation_id: Number(variationId), catalog_product_id: catalogProductId };
}

/** Indexa a resposta de `/catalog_listing_eligibility` por variation_id (string). */
export function indexarEligibility(body: unknown): Map<string, EligVar> {
  const vars = (body as { variations?: EligVar[] } | null)?.variations;
  const m = new Map<string, EligVar>();
  if (Array.isArray(vars)) {
    for (const v of vars) if (v?.id != null) m.set(String(v.id), v);
  }
  return m;
}

// ---- camada de rede (impura) — token/admin injetados; sem import acoplado ao Deno ----

async function mlGet(url: string, token: string): Promise<unknown | null> {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) {
    console.warn(`ML GET ${resp.status}: ${url}`);
    return null;
  }
  return resp.json();
}

/** Produto de catálogo exato por GTIN real. GTIN ausente/3000* → null (validado: 1 resultado). */
export async function buscarProdutoCatalogoPorGtin(token: string, gtin: string | null): Promise<string | null> {
  if (gtinAusente(gtin)) return null;
  const json = await mlGet(
    `${API}/products/search?status=active&site_id=MLB&product_identifier=${encodeURIComponent(gtin!)}`,
    token,
  );
  return parseProdutoBusca(json);
}

export async function buscarElegibilidadeCatalogo(token: string, itemId: string): Promise<Map<string, EligVar>> {
  const json = await mlGet(`${API}/items/${itemId}/catalog_listing_eligibility`, token);
  return indexarEligibility(json);
}

export interface OptinResultado { status: number; catalogListingId?: string; erro?: string; }

/** Opt-in de uma variação. 4xx → retorna erro (não lança); o chamador persiste sem derrubar o anúncio. */
export async function optinCatalogo(
  token: string,
  body: { item_id: string; variation_id: number; catalog_product_id: string },
): Promise<OptinResultado> {
  const resp = await fetch(`${API}/items/catalog_listings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const detalhe = (json as { message?: string })?.message ?? JSON.stringify(json);
    return { status: resp.status, erro: `(${resp.status}) ${detalhe}`.slice(0, 300) };
  }
  const id = (json as { id?: unknown })?.id;
  return { status: resp.status, catalogListingId: typeof id === 'string' ? id : undefined };
}

// ---- orquestrador (impuro) ----

export interface VarCatalogoRow {
  id: string;
  codigo: string;
  gtin: string | null;
  ml_variation_id: string | null;
  catalog_product_id: string | null;
  catalog_listing_id: string | null;
}

export interface ResumoCatalogo {
  vinculado: number; sem_produto: number; family_diff: number; nao_elegivel: number; erro: number; pulou: number;
}

type DbLike = {
  from(table: string): { update(v: Record<string, unknown>): { eq(col: string, val: unknown): PromiseLike<unknown> } };
};

/**
 * Vincula as variações de um anúncio já publicado ao catálogo (best-effort, ADR-0021).
 * Idempotente: variações com `catalog_listing_id` são puladas; relê a elegibilidade a cada
 * execução. Erros por variação não lançam — o chamador roda isto após o item já estar
 * persistido, então um retry posterior reentra só no que falta. Não busca produto por GTIN
 * para variações não elegíveis (evita chamadas inúteis em anúncios FAMILY_DIFF inteiros).
 */
export async function vincularVariacoesCatalogo(
  token: string,
  admin: DbLike,
  itemId: string,
  variacoes: VarCatalogoRow[],
): Promise<ResumoCatalogo> {
  const resumo: ResumoCatalogo = { vinculado: 0, sem_produto: 0, family_diff: 0, nao_elegivel: 0, erro: 0, pulou: 0 };
  const setVar = (id: string, values: Record<string, unknown>) =>
    admin.from('variacoes').update(values).eq('id', id);

  let elig: Map<string, EligVar>;
  try {
    elig = await buscarElegibilidadeCatalogo(token, itemId);
  } catch (e) {
    console.warn(`elegibilidade de catálogo falhou (${itemId}): ${(e as Error).message}`);
    return resumo; // sem elegibilidade não dá para decidir; deixa para um retry futuro
  }

  for (const v of variacoes) {
    try {
      if (v.catalog_listing_id) { resumo.pulou++; continue; }
      if (!v.ml_variation_id) { resumo.nao_elegivel++; await setVar(v.id, { catalog_status: 'nao_elegivel' }); continue; }

      const e = elig.get(String(v.ml_variation_id));
      const ready = e?.status === 'READY_FOR_OPTIN' && e?.buy_box_eligible === true;

      let cpid = v.catalog_product_id;
      if (ready && !cpid) {
        cpid = await buscarProdutoCatalogoPorGtin(token, v.gtin);
        if (cpid) await setVar(v.id, { catalog_product_id: cpid });
      }

      const acao = decidirAcaoCatalogo({ catalogListingId: v.catalog_listing_id, catalogProductId: cpid }, e);
      if (acao === 'optin') {
        const r = await optinCatalogo(token, montarBodyOptin(itemId, v.ml_variation_id, cpid!));
        if (r.erro) {
          resumo.erro++;
          await setVar(v.id, { catalog_status: 'erro', catalog_erro: r.erro });
        } else {
          resumo.vinculado++;
          await setVar(v.id, { catalog_status: 'vinculado', catalog_listing_id: r.catalogListingId ?? null, catalog_erro: null });
        }
      } else {
        resumo[acao === 'sem_produto' ? 'sem_produto' : acao === 'family_diff' ? 'family_diff' : 'nao_elegivel']++;
        await setVar(v.id, { catalog_status: acao });
      }
    } catch (err) {
      resumo.erro++;
      try { await setVar(v.id, { catalog_status: 'erro', catalog_erro: String((err as Error).message).slice(0, 300) }); } catch { /* ignora */ }
    }
  }
  return resumo;
}
