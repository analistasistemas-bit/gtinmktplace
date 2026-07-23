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

/**
 * Body do opt-in para um item User Products (SEM `variations[]`): o POST /items/catalog_listings
 * de um item sem variações NÃO leva `variation_id` — só `{item_id, catalog_product_id}` (validado
 * contra a doc oficial do ML). Distinto de `montarBodyOptin` (Legacy), que sempre leva variation_id.
 */
export function montarBodyOptinItem(
  itemId: string,
  catalogProductId: string,
): { item_id: string; catalog_product_id: string } {
  return { item_id: itemId, catalog_product_id: catalogProductId };
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

/**
 * Elegibilidade de um item SEM variações (User Products): `status`/`buy_box_eligible`/`reason`
 * vêm na RAIZ do JSON (o array `variations[]` vem vazio e NÃO deve ser indexado). Devolve o mesmo
 * shape `EligVar` do Legacy, com `id` = o próprio `itemId`. Sem `status` (ainda computando) →
 * undefined, tratado como `pendente` por `decidirAcaoCatalogo` (mesma semântica do Legacy).
 */
export function parseElegibilidadeItem(body: unknown, itemId: string): EligVar | undefined {
  const b = body as { status?: string | null; buy_box_eligible?: boolean | null; reason?: string | null } | null;
  if (!b || !b.status) return undefined;
  return { id: itemId, status: b.status, buy_box_eligible: b.buy_box_eligible ?? null, reason: b.reason ?? null };
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

/** Elegibilidade de UM item UP (sem variações): mesmo GET, lido da raiz (ver parseElegibilidadeItem). */
export async function buscarElegibilidadeItem(token: string, itemId: string): Promise<EligVar | undefined> {
  const json = await mlGet(`${API}/items/${itemId}/catalog_listing_eligibility`, token);
  return parseElegibilidadeItem(json, itemId);
}

export interface OptinResultado { status: number; catalogListingId?: string; erro?: string; }

/**
 * Opt-in no catálogo. 4xx → retorna erro (não lança); o chamador persiste sem derrubar o anúncio.
 * `variation_id` é opcional: item Legacy (com variações) sempre o envia via `montarBodyOptin`; item
 * User Products (sem variações) omite via `montarBodyOptinItem` — mesmo endpoint, mesmo tratamento.
 */
export async function optinCatalogo(
  token: string,
  body: { item_id: string; variation_id?: number; catalog_product_id: string },
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
  sem_variation_id: number; // estrutural: não é um novo catalog_status; a linha segue como nao_elegivel
}

/**
 * Decide se deve alertar o operador sobre variações sem ficha de catálogo equivalente (ADR-0036).
 * Só quando a elegibilidade já foi computada (`pendente === 0`, estado final) e sobrou variação
 * sem ficha ou elegibilidade esgotada — essas não competem e fazem o ML pausar o anúncio depois.
 * Esperar `pendente === 0` evita alerta prematuro/repetido durante os retries do worker.
 */
export function deveAlertarCatalogoNoMatch(resumo: ResumoCatalogo): boolean {
  return resumo.pendente === 0 && (
    resumo.ficha_divergente > 0 || resumo.sem_produto > 0 ||
    resumo.nao_elegivel > 0 || resumo.sem_variation_id > 0
  );
}

export function decidirMotivoAlertaCatalogo(
  resumo: ResumoCatalogo,
): 'elegibilidade_esgotada' | 'sem_variation_id' | undefined {
  if (resumo.ficha_divergente > 0 || resumo.sem_produto > 0) return undefined;
  if (resumo.sem_variation_id > 0 && resumo.nao_elegivel === 0) return 'sem_variation_id';
  if (resumo.nao_elegivel + resumo.sem_variation_id > 0) return 'elegibilidade_esgotada';
  return undefined;
}

// Retry limitado quando a elegibilidade volta nao_elegivel (ADR-0021 addendum, incidente
// 2026-07-15). Casos de conteúdo/estruturais não reagendam: esperar não muda o dado.
export const CATALOGO_BACKOFF_SEGUNDOS = [3600, 21600, 86400, 172800]; // 1h, 6h, 24h, 48h
export const CATALOGO_MAX_TENTATIVAS = CATALOGO_BACKOFF_SEGUNDOS.length + 1;

export function normalizarTentativaCatalogo(tentativa: number): number {
  return Number.isInteger(tentativa) && tentativa >= 1 && tentativa <= CATALOGO_MAX_TENTATIVAS
    ? tentativa
    : 1;
}

export type ResultadoRodadaCatalogo =
  | { acao: 'aguardar_elegibilidade' }
  | { acao: 'reagendar'; delaySegundos: number; proximaTentativa: number }
  | { acao: 'finalizar'; deveAlertar: boolean };

/** Decide uma única ação por rodada; pendências sempre precedem o backoff de negócio. */
export function decidirResultadoRodadaCatalogo(
  resumo: ResumoCatalogo,
  tentativaAtual: number,
): ResultadoRodadaCatalogo {
  tentativaAtual = normalizarTentativaCatalogo(tentativaAtual);
  if (resumo.pendente > 0) return { acao: 'aguardar_elegibilidade' };
  if (resumo.nao_elegivel > 0 && tentativaAtual < CATALOGO_MAX_TENTATIVAS) {
    const idx = tentativaAtual - 1;
    return { acao: 'reagendar', delaySegundos: CATALOGO_BACKOFF_SEGUNDOS[idx], proximaTentativa: tentativaAtual + 1 };
  }
  return { acao: 'finalizar', deveAlertar: deveAlertarCatalogoNoMatch(resumo) };
}

type DbLike = {
  from(table: string): {
    update(v: Record<string, unknown>): { eq(col: string, val: unknown): PromiseLike<{ error: { message: string } | null }> };
  };
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
  const resumo: ResumoCatalogo = { vinculado: 0, sem_produto: 0, family_diff: 0, nao_elegivel: 0, pendente: 0, erro: 0, pulou: 0, ficha_divergente: 0, sem_variation_id: 0 };
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
      if (!v.ml_variation_id) { resumo.sem_variation_id++; await setVar(v.id, { catalog_status: 'nao_elegivel' }); continue; }

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

// ---- orquestrador User Products (ADR-0088 Fase 2) ----

/**
 * Item técnico UP a vincular ao catálogo. Cada cor é seu PRÓPRIO item ML (não uma variação),
 * então a ancoragem é `item_externo_id` (não `ml_variation_id`). `gtin` já vem resolvido pelo
 * chamador (join com `variacoes` por variacao_id/sku); null → não há como achar a ficha.
 */
export interface ItemCatalogoRow {
  id: string;                       // anuncios_externos_itens.id (linha filha a persistir)
  item_externo_id: string | null;   // ml item id da cor; null se ainda não existe no ML
  gtin: string | null;
  catalog_product_id: string | null;
  catalog_listing_id: string | null;
}

/**
 * Vincula os ITENS filhos UP de uma família ao catálogo (best-effort, ADR-0021/0088). Mesma lógica
 * de `vincularVariacoesCatalogo`, mas iterando ITENS (não variações) e persistindo em
 * `anuncios_externos_itens`. Diferença estrutural: cada cor é um item ML separado, então há 1 GET
 * de elegibilidade POR item (não 1 GET indexado que cobre todas as variações). Reusa a decisão pura
 * (`decidirAcaoCatalogo`), a trava de equivalência (`fichaEquivalente`) e o opt-in (`optinCatalogo`).
 */
export async function vincularItensCatalogoUP(
  token: string,
  admin: DbLike,
  filhos: ItemCatalogoRow[],
): Promise<ResumoCatalogo> {
  const resumo: ResumoCatalogo = { vinculado: 0, sem_produto: 0, family_diff: 0, nao_elegivel: 0, pendente: 0, erro: 0, pulou: 0, ficha_divergente: 0, sem_variation_id: 0 };
  // Lança se o UPDATE falhar (revisão v2, achado ALTA #2): sem isso, uma falha de persistência
  // depois de um opt-in remoto bem-sucedido contava como sucesso, e a próxima rodada repetia um
  // POST não-idempotente porque catalog_listing_id nunca foi salvo. O throw cai no catch abaixo,
  // que já soma resumo.erro e tenta registrar o erro (best-effort, ignora falha dupla).
  const setItem = async (id: string, values: Record<string, unknown>) => {
    const { error } = await admin.from('anuncios_externos_itens').update(values).eq('id', id);
    if (error) throw new Error(`persistir catálogo (item ${id}): ${error.message}`);
  };

  for (const f of filhos) {
    try {
      if (f.catalog_listing_id) { resumo.pulou++; continue; }
      // Item ainda não existe no ML: transitório (a saga ainda está criando), não é "sem
      // variação" — não há variação no modelo UP. Conta como pendente (retentável); a fila
      // reagenda. Nada a persistir ainda (revisão v2, achado MÉDIA — a mensagem antiga de alerta
      // falava em "identificador de variação", que não existe nesse modelo).
      if (!f.item_externo_id) { resumo.pendente++; continue; }

      const elig = await buscarElegibilidadeItem(token, f.item_externo_id);
      const ready = elig?.status === 'READY_FOR_OPTIN' && elig?.buy_box_eligible === true;

      let cpid = f.catalog_product_id;
      let equivalencia: Equivalencia | undefined;
      if (ready) {
        const ficha = await buscarProdutoCatalogoPorGtin(token, f.gtin);
        if (ficha) {
          if (ficha.id !== cpid) { cpid = ficha.id; await setItem(f.id, { catalog_product_id: cpid }); }
          // Trava de metragem (ADR-0021 pós-incidente): lê o LENGTH do próprio item UP. Best-effort;
          // se falhar, degrada para só a trava anti-kit (esperado.lengthM = null).
          let esperado: EsperadoProduto = { lengthM: null };
          try { esperado = await buscarEsperadoDoItem(token, f.item_externo_id); }
          catch (e) { console.warn(`atributos do item ${f.item_externo_id} indisponíveis p/ trava de metragem: ${(e as Error).message}`); }
          equivalencia = fichaEquivalente(ficha, esperado);
        }
      }

      // Persiste ANTES de contar no resumo: se o UPDATE falhar, o throw cai no catch (resumo.erro),
      // em vez de o item já ter sido contado como sucesso com o banco desatualizado.
      const acao = decidirAcaoCatalogo({ catalogListingId: f.catalog_listing_id, catalogProductId: cpid }, elig, equivalencia);
      if (acao === 'optin') {
        const r = await optinCatalogo(token, montarBodyOptinItem(f.item_externo_id, cpid!));
        if (r.erro) {
          await setItem(f.id, { catalog_status: 'erro', catalog_erro: r.erro });
          resumo.erro++;
        } else {
          await setItem(f.id, { catalog_status: 'vinculado', catalog_listing_id: r.catalogListingId ?? null, catalog_erro: null });
          resumo.vinculado++;
        }
      } else if (acao === 'ficha_divergente') {
        await setItem(f.id, { catalog_status: 'ficha_divergente', catalog_erro: (equivalencia?.motivo ?? 'ficha nao equivalente').slice(0, 300) });
        resumo.ficha_divergente++;
      } else {
        await setItem(f.id, { catalog_status: acao });
        resumo[acao as 'sem_produto' | 'family_diff' | 'nao_elegivel' | 'pendente']++;
      }
    } catch (err) {
      resumo.erro++;
      try { await setItem(f.id, { catalog_status: 'erro', catalog_erro: String((err as Error).message).slice(0, 300) }); } catch { /* ignora */ }
    }
  }
  return resumo;
}
