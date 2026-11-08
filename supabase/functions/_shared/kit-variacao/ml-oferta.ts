// ADR-0197: leituras do ML para a conciliação. Só GET. Tudo aqui lança em falha, nunca devolve
// vazio por erro: quem chama trata como dúvida (spec "Escrita de estoque com anúncio pausado").
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { registrarBaixaVenda, type ResultadoBaixaVenda } from '../estoque/baixa.ts';
import { carregarGtinsFallback } from '../faturamento/enriquecimento.ts';
import { buscarPedidosPeriodoEstrito, carregarCatalogo, TETO_PEDIDOS_JANELA } from '../faturamento/io.ts';
import { ehVendaDaConta, mapearPedidoParaVenda, type PedidoML } from '../faturamento/venda.ts';
import { MLApiError } from '../ml/erro-ml.ts';
import { caminhoMultiget, comoEnvelopeAntigo } from '../ml/multiget.ts';
import type { PedidoPago, PedidoPendente } from './conciliacao.ts';
import { avisarKitsZerados } from './venda.ts';
import { reservarNotificacao } from '../faturamento/notificacoes-dedupe.ts';
import { notificarCategoria } from '../notificacoes/config.ts';

const API = 'https://api.mercadolibre.com';
const LIMITE_PAGINA = 50;
const TIMEOUT_MS = 15_000;

export interface OfertaUP {
  upId: string;
  /** `x-version` do `/stock`. */
  versao: number;
  locais: Array<{ type: string; quantity: number }>;
  quantidade: number;
  itens: Array<{ id: string; status: string; subStatus: string[] }>;
  somenteSellingAddress: boolean;
}

async function getML(f: typeof fetch, token: string, caminho: string): Promise<Response> {
  const resp = await f(`${API}${caminho}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new MLApiError(resp.status, `ML ${caminho} ${resp.status}`);
  return resp;
}

/** Total de uma busca paginada. Sem ele não há como provar que a lista veio inteira. */
function totalDaPagina(json: { paging?: { total?: unknown } }, caminho: string): number {
  const total = json.paging?.total;
  if (typeof total !== 'number') throw new Error(`ML ${caminho}: sem paging.total`);
  return total;
}

async function listarItensDoUp(f: typeof fetch, token: string, upId: string): Promise<string[]> {
  const seller = (await (await getML(f, token, '/users/me')).json())?.id;
  if (!seller) throw new Error('ML /users/me: sem id');
  const ids = new Set<string>();
  for (let offset = 0; ; offset += LIMITE_PAGINA) {
    const caminho = `/users/${seller}/items/search?user_product_id=${encodeURIComponent(upId)}`
      + `&limit=${LIMITE_PAGINA}&offset=${offset}`;
    const json = await (await getML(f, token, caminho)).json();
    const total = totalDaPagina(json, caminho);
    const pagina: string[] = json.results ?? [];
    pagina.forEach((id) => ids.add(id));
    if (ids.size === total && total > 0) return [...ids];
    // Sem item, "todos os itens pausados" passaria por vacuidade na saga.
    if (pagina.length === 0) throw new Error(`UP ${upId}: ${ids.size} de ${total} itens lidos`);
    if (offset + LIMITE_PAGINA >= total) throw new Error(`UP ${upId}: busca truncada, ${ids.size} de ${total}`);
  }
}

async function lerStatusItens(f: typeof fetch, token: string, upId: string, ids: string[]): Promise<OfertaUP['itens']> {
  const itens: OfertaUP['itens'] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const bloco = ids.slice(i, i + 20);
    const resp = await getML(f, token, caminhoMultiget(bloco, 'id,user_product_id,status,sub_status'));
    const entradas = comoEnvelopeAntigo(await resp.json(), bloco);
    if (!Array.isArray(entradas) || entradas.length !== bloco.length) throw new Error('ML /items/bulk: resposta inesperada');
    for (const { code, body } of entradas) {
      if (code !== 200 || !body?.id || !body.status) throw new Error(`ML /items/bulk: item não lido (${code})`);
      // A busca ignora em silêncio filtro que não conhece (ADR-0105): sem isto, a saga pausaria a conta.
      if (body.user_product_id !== upId) throw new Error(`UP ${upId}: busca trouxe ${body.id} de outro UP`);
      itens.push({ id: body.id, status: body.status, subStatus: body.sub_status ?? [] });
    }
  }
  return itens;
}

/**
 * `esperados`: itens que o PubliAI conhece neste UP. Busca filtrada que devolve só parte do UP passa
 * pelo `paging.total`, e item que faltasse ficaria ativo durante a escrita. Item a mais é aceito.
 * Item `closed` vem na oferta: quem chama não tem como pausá-lo (medido em 07/11).
 */
export async function lerOferta(
  token: string, upId: string, esperados: string[], f: typeof fetch = fetch,
): Promise<OfertaUP> {
  if (esperados.length === 0) throw new Error(`UP ${upId}: sem itens esperados`);
  const resp = await getML(f, token, `/user-products/${encodeURIComponent(upId)}/stock`);
  const versao = Number(resp.headers.get('x-version') ?? NaN);
  if (!Number.isFinite(versao)) throw new Error(`UP ${upId}: sem x-version`);
  const locais = (await resp.json())?.locations;
  if (!Array.isArray(locais) || locais.some((l) => typeof l?.quantity !== 'number')) {
    throw new Error(`UP ${upId}: locations inválido`);
  }
  const itens = await lerStatusItens(f, token, upId, await listarItensDoUp(f, token, upId));
  const faltando = esperados.filter((id) => !itens.some((i) => i.id === id));
  if (faltando.length > 0) throw new Error(`UP ${upId}: busca sem ${faltando.join(', ')}`);
  return {
    upId, versao, locais, itens,
    quantidade: locais.reduce((soma, l) => soma + l.quantity, 0),
    somenteSellingAddress: locais.length > 0 && locais.every((l) => l.type === 'selling_address'),
  };
}

/**
 * Pedidos não pagos da conta, inteiros: só `/orders/search/pending` os enxerga. Devolve também os
 * abandonados, que `calcularReserva` descarta pelo pagamento. Medido em 07/11: 14 na Daludi e 4 na
 * DSA. Acima do teto lança, e a saga fica em dúvida.
 */
export async function listarPendentes(token: string, seller: string, f: typeof fetch = fetch): Promise<PedidoPendente[]> {
  const pedidos = new Map<string, PedidoPendente>();
  let totalInicial: number | null = null;
  for (let offset = 0; ; offset += LIMITE_PAGINA) {
    const caminho = `/orders/search/pending?seller=${encodeURIComponent(seller)}&limit=${LIMITE_PAGINA}&offset=${offset}`;
    const json = await (await getML(f, token, caminho)).json();
    if (!Array.isArray(json.results)) throw new Error(`ML ${caminho}: sem results`);
    const total = totalDaPagina(json, caminho);
    if (total > TETO_PEDIDOS_JANELA) throw new Error(`ML pendentes: ${total} acima do teto de ${TETO_PEDIDOS_JANELA}`);
    totalInicial ??= total;
    if (total !== totalInicial) throw new Error(`ML pendentes: total mudou durante a varredura (${totalInicial} → ${total})`);
    for (const p of json.results as PedidoPendente[]) pedidos.set(String(p.id), p);
    if (json.results.length === 0 || offset + LIMITE_PAGINA >= total) break;
  }
  if (pedidos.size !== totalInicial) throw new Error(`ML pendentes: ${pedidos.size} de ${totalInicial} lidos`);
  return [...pedidos.values()];
}

/**
 * Baixa cada pedido pago do item, sem esperar o webhook. A idempotência vem da referência de
 * `registrarBaixaVenda`, por isso os `itens` saem do mesmo mapeamento do sync-venda, com catálogo e
 * GTIN estritos: outro código de SKU viraria outra referência e baixaria duas vezes.
 *
 * Duas coberturas. `desde` limita a varredura por data de criação e é obrigatório: pedido anterior
 * ao ledger não tem referência, e baixá-lo agora tiraria saldo que já saiu. `idsPasso1` (de
 * `idsDoItem`) é relido um a um por `GET /orders/{id}`, porque pedido criado antes de `desde` e pago
 * na quarentena não está na varredura; qualquer falha nessa leitura lança.
 *
 * Quem chama passa `pagos` por `pagosDesde` e soma `naoPagos` à lista de `listarPendentes` antes de
 * `calcularReserva`. `falhas` não vazio é dúvida, mesmo em item fora do UP. `baixas` traz os alertas
 * de saldo, que o sync-venda não repete, porque para ele a referência já estará aplicada.
 *
 * Não despacha push: o movimento fica no outbox, como quando o sync-venda cai depois da baixa.
 */
export async function importarPedidosDoItem(
  admin: SupabaseClient,
  orgId: string,
  itemIds: string[],
  deps: {
    token: string; seller: string; desde: string; idsPasso1: string[]; fetch?: typeof fetch;
    /** Prazo de quem chama: aborta também os GETs de GTIN. */
    signal?: AbortSignal;
    /** Chamado logo antes de cada baixa; lança para parar sem novo efeito (prazo da saga vencido). */
    antesDeBaixar?: () => void;
  },
): Promise<{
  pagos: PedidoPago[];
  naoPagos: PedidoPendente[];
  falhas: string[];
  baixas: Array<{ orderId: string; resultado: ResultadoBaixaVenda }>;
}> {
  const f = deps.fetch ?? fetch;
  const doUp = new Set(itemIds);
  // Filtra aqui: `item=` em /orders/search não está medido.
  const janela = await buscarPedidosPeriodoEstrito(deps.token, { desde: deps.desde, ate: new Date().toISOString() }, f);
  const porId = new Map(janela.map((o) => [String(o.id), o]));
  const naoPagos: PedidoPendente[] = [];
  for (const id of deps.idsPasso1) {
    const o = await (await getML(f, deps.token, `/orders/${encodeURIComponent(id)}`)).json() as PedidoML;
    if (String(o?.id) !== id || !o.status || !ehVendaDaConta(o, deps.seller)) throw new Error(`ML /orders/${id}: resposta inesperada`);
    porId.set(id, o);
    if (o.status !== 'paid') naoPagos.push(o);
  }
  const pagos = [...porId.values()].filter((o) => o.status === 'paid' && ehVendaDaConta(o, deps.seller)
    && (o.order_items ?? []).some((oi) => doUp.has(oi?.item?.id ?? '')));
  if (pagos.length === 0) return { pagos: [], naoPagos, falhas: [], baixas: [] };

  // `userId` só serve quando falta a org.
  const { idsPubliai, codigoResolver, eanResolver, infoPorGtin } = await carregarCatalogo(admin, '', orgId, { estrito: true });
  const gtinPorItem = await carregarGtinsFallback(deps.token, pagos, idsPubliai, { estrito: true, signal: deps.signal });

  const falhas: string[] = [];
  const baixas: Array<{ orderId: string; resultado: ResultadoBaixaVenda }> = [];
  for (const pedido of pagos) {
    const { itens } = mapearPedidoParaVenda(pedido, { idsPubliai, codigoResolver, eanResolver, infoPorGtin, gtinPorItem });
    deps.antesDeBaixar?.();
    // ADR-0197: mesma identidade por item que o sync-venda; leitura estrita, então nada é incerto por catálogo.
    const resultado = await registrarBaixaVenda(
      admin, { orgId, canal: 'mercado_livre', orderId: pedido.id, itens }, { kit: { incerto: false } },
    );
    baixas.push({ orderId: String(pedido.id), resultado });
    falhas.push(
      ...resultado.adiados.map((x) => `pedido ${pedido.id}: identidade do item incerta: ${x.ml_item_id ?? x.codigo}`),
      ...resultado.falhas.map((x) => `pedido ${pedido.id}: ${x.codigo}: ${x.mensagem}`),
      ...resultado.semSku.map((x) => `pedido ${pedido.id}: sem SKU: ${x.mlItemId ?? x.titulo}`),
      ...resultado.skuDesconhecido.map((x) => `pedido ${pedido.id}: SKU fora do catálogo: ${x.codigo}`),
    );
  }
  // ADR-0197: a baixa daqui pode ser a que zerou um kit em modo manual; o sync-venda depois só vê duplicata.
  try {
    await avisarKitsZerados(admin, { reservar: reservarNotificacao, notificar: notificarCategoria }, orgId, null);
  } catch (e) {
    console.error('kit_aviso_zerado_falhou', orgId, String(e));
  }
  return { pagos, naoPagos, falhas, baixas };
}
