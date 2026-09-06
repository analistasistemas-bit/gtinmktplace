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
  thumbnail: { id: string };
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
