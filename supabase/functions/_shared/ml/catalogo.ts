import { gtinAusente } from './publicar.ts';

// Vinculação ao Catálogo do ML (ADR-0021). Validado com token real (2026-06-10):
// aviamentos são `catalog_required` (não `catalog_only` → o anúncio de marketplace
// sobrevive ao opt-in). O opt-in é `POST /items/catalog_listings`, um POST por variação,
// e só funciona quando a variação está `READY_FOR_OPTIN`/`buy_box_eligible` na elegibilidade.
// Anúncios que agrupam cores de famílias de catálogo diferentes vêm `FAMILY_DIFF` (bloqueado).
//
// Revisão pós-incidente (2026-06-15): match por GTIN NÃO garante ficha equivalente — o catálogo
// do ML tem fichas de KIT ("Kit 5 Unidades", "10 cones") e de dimensão divergente carregando o
// GTIN da unidade avulsa. Antes do opt-in, `fichaEquivalente` confronta os atributos da ficha
// (SALE_FORMAT/UNITS_PER_PACK/LENGTH) com o nosso produto; ficha de kit/metragem divergente vira
// `ficha_divergente` (não vincula). WIDTH ficou de fora: é dado sujo nos dois lados.

const API = 'https://api.mercadolibre.com';
const TIMEOUT_MS = 15000;

export type AcaoCatalogo =
  | 'optin' | 'sem_produto' | 'family_diff' | 'nao_elegivel' | 'pendente' | 'pula' | 'ficha_divergente';

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

/** Atributos da ficha de catálogo relevantes para a trava de equivalência. */
export interface AtributosFicha {
  id: string;
  saleFormat: string | null;
  unitsPerPack: number | null;
  lengthM: number | null;
}

/** O que esperamos do NOSSO produto, para confrontar com a ficha. */
export interface EsperadoProduto {
  lengthM: number | null;
}

export interface Equivalencia {
  ok: boolean;
  motivo: string | null;
}

// Metragem só é comparável acima deste piso: fichas reais trazem LENGTH lixo ("10 cm" em vez
// de "10 m"); abaixo de 1 m tratamos como dado inválido e ignoramos (não reprova).
const PISO_METRAGEM_M = 1;
// Tolerância de ±25% na razão de metragem (mesma fita publicada por sellers difere um pouco).
const RAZAO_MIN = 0.8;
const RAZAO_MAX = 1.25;

/**
 * Decisão pura por variação a partir do estado local + elegibilidade do ML.
 * `catalogProductId` é o valor já resolvido (após o lookup por GTIN quando elegível).
 * Conservador: qualquer dúvida que não seja READY_FOR_OPTIN+buy_box → não arrisca opt-in.
 *
 * `pendente` = a elegibilidade ainda NÃO foi computada pelo ML (item recém-criado: a
 * elegibilidade de catálogo leva alguns minutos após o `POST /items`). É um estado
 * RETENTÁVEL — o job de catálogo roda com delay/retry até o ML computar. Distinguir isso de
 * `nao_elegivel` (status explícito do ML) é o que evita marcar opt-in possível como impossível.
 */
export function decidirAcaoCatalogo(
  estado: EstadoVariacaoCatalogo,
  elig: EligVar | undefined,
  equivalencia?: Equivalencia,
): AcaoCatalogo {
  if (estado.catalogListingId) return 'pula';
  if (!elig || !elig.status) return 'pendente'; // sem entrada/sem status = ainda computando
  if (elig.status === 'READY_FOR_OPTIN' && elig.buy_box_eligible === true) {
    if (!estado.catalogProductId) return 'sem_produto';
    // Trava de equivalência (ADR-0021 pós-incidente): só vincula a ficha equivalente. Quando a
    // avaliação não foi feita (undefined), preserva o comportamento anterior (optin).
    if (equivalencia && !equivalencia.ok) return 'ficha_divergente';
    return 'optin';
  }
  if (elig.status === 'FAMILY_DIFF') return 'family_diff';
  return 'nao_elegivel'; // status explícito do ML (NOT_ELIGIBLE etc.)
}

/** Converte um valor de comprimento do ML ("10 m", "10 cm", "150 mm", "1,5 m") para metros. */
export function normalizarComprimentoMetros(valueName: string | null): number | null {
  if (!valueName) return null;
  const m = valueName.trim().toLowerCase().match(/^([\d.,]+)\s*(mm|cm|m)$/);
  if (!m) return null;
  const num = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(num)) return null;
  const fator = m[2] === 'mm' ? 0.001 : m[2] === 'cm' ? 0.01 : 1;
  return num * fator;
}

/** Extrai id + atributos relevantes do 1º produto de `/products/search`. null se vazio. */
export function parseProdutoCatalogoBusca(json: unknown): AtributosFicha | null {
  const r = (json as { results?: Array<{ id?: string; attributes?: Array<{ id?: string; value_name?: string }> }> } | null)?.results?.[0];
  if (!r?.id) return null;
  const attr = (id: string): string | null =>
    r.attributes?.find((a) => a?.id === id)?.value_name ?? null;
  const unitsRaw = attr('UNITS_PER_PACK');
  const units = unitsRaw != null ? Number(unitsRaw) : null;
  return {
    id: r.id,
    saleFormat: attr('SALE_FORMAT'),
    unitsPerPack: units != null && Number.isFinite(units) ? units : null,
    lengthM: normalizarComprimentoMetros(attr('LENGTH')),
  };
}

/**
 * Decide se a ficha de catálogo é equivalente ao nosso produto (1 unidade avulsa).
 * Conservador, mas só reprova com SINAL FORTE (evita falso-positivo em dado sujo):
 *  - kit: SALE_FORMAT ≠ "Unidade" OU UNITS_PER_PACK > 1;
 *  - metragem: ambos os comprimentos plausíveis (≥ 1 m) e fora da tolerância de ±25%.
 * WIDTH não entra (largura vem suja tanto no nosso item quanto nas fichas do ML).
 */
export function fichaEquivalente(ficha: AtributosFicha, esperado: EsperadoProduto): Equivalencia {
  if (ficha.unitsPerPack != null && ficha.unitsPerPack > 1) {
    return { ok: false, motivo: `ficha_kit_${ficha.unitsPerPack}un` };
  }
  const fmt = ficha.saleFormat?.trim().toLowerCase();
  if (fmt && fmt !== 'unidade') {
    return { ok: false, motivo: `ficha_formato_${fmt}` };
  }
  const a = ficha.lengthM;
  const b = esperado.lengthM;
  if (a != null && b != null && a >= PISO_METRAGEM_M && b >= PISO_METRAGEM_M) {
    const razao = a / b;
    if (razao < RAZAO_MIN || razao > RAZAO_MAX) {
      return { ok: false, motivo: `metragem_divergente_${a}m_vs_${b}m` };
    }
  }
  return { ok: true, motivo: null };
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

/**
 * Produto de catálogo exato por GTIN real, já com os atributos da ficha (a busca retorna
 * `attributes` inline — não custa chamada extra). GTIN ausente/3000* → null (validado: 1 resultado).
 */
export async function buscarProdutoCatalogoPorGtin(token: string, gtin: string | null): Promise<AtributosFicha | null> {
  if (gtinAusente(gtin)) return null;
  const json = await mlGet(
    `${API}/products/search?status=active&site_id=MLB&product_identifier=${encodeURIComponent(gtin!)}`,
    token,
  );
  return parseProdutoCatalogoBusca(json);
}

/** Lê o comprimento (LENGTH) do NOSSO item publicado — base de comparação da trava de metragem. */
export async function buscarEsperadoDoItem(token: string, itemId: string): Promise<EsperadoProduto> {
  const json = await mlGet(`${API}/items/${itemId}?include_attributes=all`, token);
  const attrs = (json as { attributes?: Array<{ id?: string; value_name?: string }> } | null)?.attributes;
  const length = attrs?.find((a) => a?.id === 'LENGTH')?.value_name ?? null;
  return { lengthM: normalizarComprimentoMetros(length) };
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
  vinculado: number; sem_produto: number; family_diff: number; nao_elegivel: number; pendente: number; erro: number; pulou: number; ficha_divergente: number;
}

/**
 * Decide se deve alertar o operador sobre variações sem ficha de catálogo equivalente (ADR-0036).
 * Só quando a elegibilidade já foi computada (`pendente === 0`, estado final) e sobrou variação
 * sem ficha (`ficha_divergente`/`sem_produto`) — essas não competem e fazem o ML pausar o anúncio
 * depois. Esperar `pendente === 0` evita alerta prematuro/repetido durante os retries do worker.
 */
export function deveAlertarCatalogoNoMatch(resumo: ResumoCatalogo): boolean {
  return resumo.pendente === 0 && (resumo.ficha_divergente > 0 || resumo.sem_produto > 0);
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
  const resumo: ResumoCatalogo = { vinculado: 0, sem_produto: 0, family_diff: 0, nao_elegivel: 0, pendente: 0, erro: 0, pulou: 0, ficha_divergente: 0 };
  const setVar = (id: string, values: Record<string, unknown>) =>
    admin.from('variacoes').update(values).eq('id', id);

  let elig: Map<string, EligVar>;
  try {
    elig = await buscarElegibilidadeCatalogo(token, itemId);
  } catch (e) {
    console.warn(`elegibilidade de catálogo falhou (${itemId}): ${(e as Error).message}`);
    return resumo; // sem elegibilidade não dá para decidir; deixa para um retry futuro
  }

  // Base de comparação da trava de metragem (1 leitura por item). Se falhar, degrada para só
  // a trava anti-kit (esperado.lengthM = null → metragem não é avaliada).
  let esperado: EsperadoProduto = { lengthM: null };
  try { esperado = await buscarEsperadoDoItem(token, itemId); }
  catch (e) { console.warn(`atributos do item ${itemId} indisponíveis p/ trava de metragem: ${(e as Error).message}`); }

  for (const v of variacoes) {
    try {
      if (v.catalog_listing_id) { resumo.pulou++; continue; }
      if (!v.ml_variation_id) { resumo.nao_elegivel++; await setVar(v.id, { catalog_status: 'nao_elegivel' }); continue; }

      const e = elig.get(String(v.ml_variation_id));
      const ready = e?.status === 'READY_FOR_OPTIN' && e?.buy_box_eligible === true;

      // Re-busca a ficha por GTIN quando elegível para ter os atributos atuais (kit/metragem) —
      // o opt-in não pode confiar só no catalog_product_id salvo, que pode ser de uma ficha-kit.
      let cpid = v.catalog_product_id;
      let equivalencia: Equivalencia | undefined;
      if (ready) {
        const ficha = await buscarProdutoCatalogoPorGtin(token, v.gtin);
        if (ficha) {
          if (ficha.id !== cpid) { cpid = ficha.id; await setVar(v.id, { catalog_product_id: cpid }); }
          equivalencia = fichaEquivalente(ficha, esperado);
        }
      }

      const acao = decidirAcaoCatalogo({ catalogListingId: v.catalog_listing_id, catalogProductId: cpid }, e, equivalencia);
      if (acao === 'optin') {
        const r = await optinCatalogo(token, montarBodyOptin(itemId, v.ml_variation_id, cpid!));
        if (r.erro) {
          resumo.erro++;
          await setVar(v.id, { catalog_status: 'erro', catalog_erro: r.erro });
        } else {
          resumo.vinculado++;
          await setVar(v.id, { catalog_status: 'vinculado', catalog_listing_id: r.catalogListingId ?? null, catalog_erro: null });
        }
      } else if (acao === 'ficha_divergente') {
        resumo.ficha_divergente++;
        await setVar(v.id, { catalog_status: 'ficha_divergente', catalog_erro: (equivalencia?.motivo ?? 'ficha nao equivalente').slice(0, 300) });
      } else {
        // acao ∈ {sem_produto, family_diff, nao_elegivel, pendente} — todas são chaves do resumo.
        resumo[acao as 'sem_produto' | 'family_diff' | 'nao_elegivel' | 'pendente']++;
        await setVar(v.id, { catalog_status: acao });
      }
    } catch (err) {
      resumo.erro++;
      try { await setVar(v.id, { catalog_status: 'erro', catalog_erro: String((err as Error).message).slice(0, 300) }); } catch { /* ignora */ }
    }
  }
  return resumo;
}
