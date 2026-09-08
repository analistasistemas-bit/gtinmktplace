// ADR-0161 — cliente da migração "preço por variação" (UPtin) do Mercado Livre.
//
// O que o ML chama de "Oferecer preço por variação" é a conversão do anúncio para o modelo User
// Products: o item original é ENCERRADO e cada variação vira um item MLB próprio. Processo
// assíncrono, irreversível, sem webhook de conclusão e sem estado de falha na API — só dá para
// saber que terminou consultando `migration_live_listing` até `activation_completed` aparecer.
//
// Doc: developers.mercadolivre.com.br/pt_br/preco-variacao (o site devolve 403 a fetch simples;
// lida via scraper). Tudo que a doc NÃO diz está marcado abaixo — nenhuma dessas lacunas pode
// virar suposição silenciosa no código que as consome.

/**
 * `FetchLike` próprio: o de `buscar-item.ts` cobre só GET (aceita apenas `headers`) e devolve um
 * objeto sem `text()`. Aqui há um POST e há resposta de erro que só existe como texto — o corpo do
 * 404 da rota, por exemplo, é o que vai dizer ao operador que o endereço pode exigir outro site.
 */
export type FetchLikeML = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

const API = 'https://api.mercadolibre.com';

/** Uma variação como estava ANTES da migração (snapshot). */
export interface VariacaoSnapshot {
  /** `variations[].id` — casa com `new_items[].variation_id` do acompanhamento. */
  id: string;
  /** SKU. Pode ser null: o ML não exige `seller_custom_field`. */
  sku: string | null;
  /** COLOR.value_name. Única chave do degrau (b) do casamento — duplicada torna o degrau ambíguo. */
  cor: string | null;
}

export interface ElegibilidadeUPtin {
  elegivel: boolean;
  /** Motivos crus do ML quando inelegível. A doc mostra `code`/`reference` como placeholders
   *  (`0000`, `item.xxx`) e não publica o catálogo real — por isso repassamos o texto do ML ao
   *  operador em vez de traduzir códigos que não conhecemos. */
  causas: string[];
}

export interface StatusUPtin {
  /** null quando o ML devolve 404 — "não há migração para este item", não é erro de rede. */
  encontrada: boolean;
  /** Timestamp ou null. Todos os filhos CRIADOS (ainda não necessariamente ativos). */
  migracaoCompleta: string | null;
  /** Timestamp ou null. Filhos ATIVADOS e pai fechado. Único sinal definitivo de conclusão. */
  ativacaoCompleta: string | null;
  /** Um por variação migrada. `variationId` casa com o snapshot; `itemId` é o anúncio novo. */
  novosItens: Array<{ itemId: string; variationId: string; status: string | null }>;
}

function erro(status: number, corpo: unknown): Error {
  const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  const e = new Error(`ML ${status}: ${texto}`) as Error & { status?: number };
  e.status = status;
  return e;
}

/**
 * `GET /items/{id}/user_product_listings/validate`.
 *
 * Pré-condições documentadas: `user_product_id` não-nulo, não ser User Product duplicado, e o item
 * ser multivariante. Não confiamos nessa lista — perguntamos ao ML, que é quem decide.
 */
export async function validarElegibilidadeUPtin(
  fetchLike: FetchLikeML,
  accessToken: string,
  itemId: string,
): Promise<ElegibilidadeUPtin> {
  const url = `${API}/items/${encodeURIComponent(itemId)}/user_product_listings/validate`;
  const resp = await fetchLike(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) throw erro(resp.status, json ?? '(sem corpo)');
  const j = (json ?? {}) as { is_valid?: boolean; cause?: Array<{ message?: string; reference?: string }> };
  // Ausência de `is_valid` NÃO vira `true`: sem resposta afirmativa do ML não se dispara nada
  // irreversível. Fail-closed com a causa declarada.
  if (j.is_valid !== true) {
    const causas = (j.cause ?? [])
      .map((c) => [c?.message, c?.reference].filter(Boolean).join(' — '))
      .filter((s) => s.length > 0);
    return { elegivel: false, causas: causas.length > 0 ? causas : ['O Mercado Livre não informou o motivo.'] };
  }
  return { elegivel: true, causas: [] };
}

/**
 * `POST /sites/MLB/items/user_product_listings` com `{ item_id }`. Um item por chamada.
 *
 * ⚠️ A doc só documenta este endpoint com `/sites/MLM/` (México). `/sites/MLB/` é inferência a
 * partir do padrão multi-site da API — nunca foi escrito. Se o ML recusar a ROTA, o erro tem que
 * dizer isso ao operador em vez de virar "erro desconhecido": é a primeira hipótese a checar no
 * primeiro uso real.
 *
 * ⚠️ A doc não documenta idempotência: chamar duas vezes o mesmo item é comportamento desconhecido.
 * Quem chama NUNCA deve repetir automaticamente — em caso de falha sem resposta clara, consulte
 * `lerStatusUPtin` para descobrir se a migração começou mesmo assim.
 */
export async function dispararUPtin(
  fetchLike: FetchLikeML,
  accessToken: string,
  itemId: string,
  site = 'MLB',
): Promise<void> {
  const url = `${API}/sites/${site}/items/user_product_listings`;
  const resp = await fetchLike(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId }),
  });
  if (resp.ok) return;
  const corpo = await resp.text().catch(() => '(sem corpo)');
  if (resp.status === 404) {
    const e = new Error(
      `O Mercado Livre não reconheceu o endereço da migração (404 em /sites/${site}/items/`
      + `user_product_listings). A documentação só publica este endpoint para o site MLM (México); `
      + `o uso com ${site} é inferência. Nenhuma migração foi iniciada. Resposta: ${corpo}`,
    ) as Error & { status?: number };
    e.status = 502;
    throw e;
  }
  throw erro(resp.status, corpo);
}

/**
 * `GET /items/{id}/migration_live_listing`.
 *
 * 404 = "não encontrada" (`encontrada: false`), não falha: logo após o disparo o recurso pode ainda
 * não existir. A doc **não documenta nenhum estado de falha** — não há `failed`, não há campo de
 * erro. Migração que trava é indistinguível de migração lenta, e por isso quem chama precisa de
 * orçamento finito.
 */
export async function lerStatusUPtin(
  fetchLike: FetchLikeML,
  accessToken: string,
  itemId: string,
): Promise<StatusUPtin> {
  const url = `${API}/items/${encodeURIComponent(itemId)}/migration_live_listing`;
  const resp = await fetchLike(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (resp.status === 404) {
    return { encontrada: false, migracaoCompleta: null, ativacaoCompleta: null, novosItens: [] };
  }
  const json = await resp.json().catch(() => null);
  if (!resp.ok) throw erro(resp.status, json ?? '(sem corpo)');
  const j = (json ?? {}) as {
    migration_completed?: string | null;
    activation_completed?: string | null;
    new_items?: Array<{ new_item_id?: string; variation_id?: string | number; migration_status?: string }>;
  };
  return {
    encontrada: true,
    migracaoCompleta: j.migration_completed ?? null,
    ativacaoCompleta: j.activation_completed ?? null,
    novosItens: (j.new_items ?? [])
      .filter((n) => n?.new_item_id != null && n?.variation_id != null)
      .map((n) => ({
        itemId: String(n.new_item_id),
        // `variation_id` vem como número no exemplo da doc; o snapshot guarda string. Normaliza aqui
        // para o casamento não falhar por tipo.
        variationId: String(n.variation_id),
        status: n.migration_status ?? null,
      })),
  };
}
