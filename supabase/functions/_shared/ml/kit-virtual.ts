// ADR-0154: primitiva de CREATE do Kit Virtual (`POST /items/kits`).
//
// Contrato verificado contra a conta de produção em 2026-09-06 (spike 036, "Contrato da API"):
// o payload sai com `automatic_price` em TODOS os componentes e SEM `price` (D-3) — os dois
// modos são mutuamente exclusivos no ML.
//
// Erro sai humanizado (`humanizarErroML`) com `.status` anexado, no mesmo formato de
// `criarItemML` — é o que `criar-kit-virtual/processar.ts` grava em `erro_mensagem`.
import { humanizarErroML } from './erro-ml.ts';

export interface ComponentePayloadML {
  type: 'user_product';
  user_product_id: string;
  quantity: number;
  /** D-3: fração 0-1, IDÊNTICA em todos os componentes (regra do ML, não escolha nossa). */
  automatic_price: { discount: number };
}

export interface PayloadKitVirtual {
  family_name: string;
  channels: string[];
  /** `secure_url` é OBRIGATÓRIO na prática (bug real 2026-09-06): a doc oficial mostra o `id`
   *  sozinho, mas o ML recusa com "thumbnail.secureUrl must not be null" sem ele — ver
   *  `buscarSecureUrlFotoML` em `_shared/ml/fotos.ts`. */
  thumbnail: { id: string; secure_url: string };
  currency_id: string;
  listing_type_id: string;
  official_store_id: number | null;
  bundle: { type: 'kit'; components: ComponentePayloadML[] };
}

export interface RespostaKitML {
  id: string;
  userProductId: string | null;
  permalink: string | null;
  /** Título já EXPANDIDO pelo ML a partir do `family_name` (D-4) — só para log/exibição. */
  titulo: string | null;
}

export async function criarKitVirtualML(
  accessToken: string,
  payload: PayloadKitVirtual,
): Promise<RespostaKitML> {
  const resp = await fetch('https://api.mercadolibre.com/items/kits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error('ML recusou POST /items/kits:', JSON.stringify(json));
    const e = new Error(humanizarErroML(resp.status, json));
    (e as { status?: number }).status = resp.status;
    (e as { mlCauses?: unknown }).mlCauses = (json as { cause?: unknown })?.cause;
    throw e;
  }
  const j = json as { id?: unknown; user_product_id?: unknown; permalink?: unknown; title?: unknown };
  if (j.id == null) {
    // 2xx sem `id` não existe no contrato; tratar como sucesso gravaria um kit sem `ml_item_id`
    // — linha inalcançável por encerrar/refazer. Falha LOUD.
    throw new Error('O Mercado Livre respondeu sem o id do kit.');
  }
  return {
    id: String(j.id),
    userProductId: j.user_product_id != null ? String(j.user_product_id) : null,
    permalink: typeof j.permalink === 'string' ? j.permalink : null,
    titulo: typeof j.title === 'string' ? j.title : null,
  };
}

// Bug real 2026-09-06: um `listing_type_id` fixo (`gold_pro`) no CREATE não bate com o listing
// type real dos componentes e o ML recusa o kit inteiro (`listing_type_mismatch`). O listing type
// tem que vir dos componentes — mesmo padrão de multiget de `buscar-componentes-kit-virtual`
// (`GET /items?ids=...&attributes=...`), só que com `listing_type_id` em vez de
// `user_product_id,price,category_id`. Lotes de 20 (limite do ML).
//
// AO CONTRÁRIO de `lerPrecoKitML`/`lerEstoqueKitML` (enriquecimento de exibição, tolerado nulo),
// esta chamada GATE o publish — `criarKitVirtual` decide publicar ou não com base no resultado.
// Por isso LANÇA em falha de rede/timeout/status ou shape inesperados (mesmo padrão de
// `subirFotoML`/`buscarSecureUrlFotoML`): se engolisse a falha e devolvesse mapa vazio, um 429/5xx
// transitório do ML viraria indistinguível de "nenhum componente tem listing type resolvido" e
// bloquearia o publish com o motivo errado. Só o item individual que o ML recusar dentro de uma
// resposta OK (`code !== 200`) fica de fora do mapa — isso é sinal incompleto, não falha de leitura.
export async function buscarListingTypeItensML(
  accessToken: string, itemIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < itemIds.length; i += 20) {
    const bloco = itemIds.slice(i, i + 20);
    const resp = await fetch(
      `https://api.mercadolibre.com/items?ids=${bloco.join(',')}&attributes=id,listing_type_id`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (!resp.ok) {
      throw new Error(`Falha ao consultar o listing type dos componentes (${resp.status}): ${await resp.text()}`);
    }
    const arr = await resp.json().catch(() => null);
    if (!Array.isArray(arr)) {
      throw new Error('O Mercado Livre devolveu uma resposta inesperada ao consultar o listing type dos componentes.');
    }
    for (const entry of arr as { code?: number; body?: { id?: string; listing_type_id?: string } }[]) {
      if (entry?.code !== 200 || !entry.body?.id || !entry.body?.listing_type_id) continue;
      out.set(entry.body.id, entry.body.listing_type_id);
    }
  }
  return out;
}

// D-14 (status-publicados): preço e estoque de um kit NÃO vêm do `GET /items` em lote que a
// tela já faz para todo anúncio — só destas duas chamadas extras, por kit. Nenhuma das duas
// lança: falha individual vira `null` e quem chama tolera (o kit some do preço/estoque, não da
// resposta inteira — mesmo padrão de `lerStatus` em mercado-livre.ts).

export interface RateioComponenteKitML {
  userProductId: string | null;
  /** Preço de venda individual do componente, SEM o desconto do kit. */
  componentPrice: number | null;
  quantidade: number | null;
  /** Parcela do preço do kit atribuída a 1 unidade deste componente. */
  unitAmount: number | null;
  /** `unitAmount × quantidade`. */
  totalAmount: number | null;
}

export interface PrecoKitML {
  /** Preço vigente do kit (`amount`), calculado pelo ML a partir do desconto automático. */
  preco: number;
  /** Soma dos componentes SEM desconto — base do rateio proporcional (D-7). */
  totalComponentesAmount: number | null;
  /** Rateio por componente — "número fiel para a margem ao vivo" (D-14). */
  componentes: RateioComponenteKitML[];
}

/** `GET /items/{id}/sale_price?context=channel_marketplace`. Nunca lança. */
export async function lerPrecoKitML(accessToken: string, itemId: string): Promise<PrecoKitML | null> {
  try {
    const resp = await fetch(
      `https://api.mercadolibre.com/items/${itemId}/sale_price?context=channel_marketplace`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!resp.ok) { console.warn(`lerPrecoKitML ML ${resp.status} (${itemId})`); return null; }
    const json = await resp.json().catch(() => null) as Record<string, unknown> | null;
    const preco = typeof json?.amount === 'number'
      ? json.amount
      : (typeof json?.price === 'number' ? json.price : null);
    if (preco == null) { console.warn(`lerPrecoKitML sem amount (${itemId})`); return null; }
    // O rateio vive em `bundle.components`, e `total_components_amount` em `bundle` — NÃO na
    // raiz. `component_price` é campo de CADA componente, não uma lista de nível superior; ler
    // `json.component_price` devolve rateio vazio em toda resposta real (shape conferido contra
    // a doc oficial de Kits Virtuais, §"Consultar preço de venda do kit").
    const bundle = (json?.bundle ?? null) as Record<string, unknown> | null;
    const componentesRaw = Array.isArray(bundle?.components) ? bundle.components : [];
    const componentes: RateioComponenteKitML[] = componentesRaw.map((c) => {
      const r = c as Record<string, unknown>;
      return {
        userProductId: typeof r.user_product_id === 'string' ? r.user_product_id : null,
        componentPrice: typeof r.component_price === 'number' ? r.component_price : null,
        quantidade: typeof r.quantity === 'number' ? r.quantity : null,
        unitAmount: typeof r.unit_amount === 'number' ? r.unit_amount : null,
        totalAmount: typeof r.total_amount === 'number' ? r.total_amount : null,
      };
    });
    return {
      preco,
      totalComponentesAmount: typeof bundle?.total_components_amount === 'number'
        ? bundle.total_components_amount
        : null,
      componentes,
    };
  } catch (e) {
    console.warn('lerPrecoKitML falhou:', (e as Error).message);
    return null;
  }
}

/** `GET /user-products/{id}/stock`, somado por `locations[].quantity`. Nunca lança. */
export async function lerEstoqueKitML(accessToken: string, userProductId: string): Promise<number | null> {
  try {
    const resp = await fetch(
      `https://api.mercadolibre.com/user-products/${userProductId}/stock`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!resp.ok) { console.warn(`lerEstoqueKitML ML ${resp.status} (${userProductId})`); return null; }
    const json = await resp.json().catch(() => null) as Record<string, unknown> | null;
    const locations = Array.isArray(json?.locations) ? json.locations : [];
    return locations.reduce((acc: number, l) => {
      const q = (l as Record<string, unknown>).quantity;
      return acc + (typeof q === 'number' ? q : 0);
    }, 0);
  } catch (e) {
    console.warn('lerEstoqueKitML falhou:', (e as Error).message);
    return null;
  }
}
