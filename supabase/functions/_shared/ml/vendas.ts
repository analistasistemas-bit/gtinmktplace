import type { MetricasVendasCanal, ItemExternoVenda } from '../canais/contrato.ts';

/** Pedido do ML, recorte usado para agregar vendas (campos além destes são ignorados). */
export interface PedidoML {
  id: number | string;
  order_items?: Array<{
    item?: { id?: string | null } | null;
    quantity?: number | null;
    unit_price?: number | null;
  }> | null;
}

/** Resultado bruto da agregação (sem títulos — `montarExternos`/`lerVendasML` resolvem). */
export interface AgregadoPedidos {
  porItem: Record<string, { unidades: number; valor: number }>;
  porItemExterno: Record<string, { unidades: number; valor: number }>;
  totais: { faturamento: number; unidades: number; pedidos: number };
}

/**
 * Agrega os pedidos pagos do período em dois recortes (ADR-0032):
 * - `totais`: TODA a conta do vendedor (faturamento/unidades/pedidos), para os KPIs do topo
 *   baterem com a tela de Métricas do ML — inclui anúncios publicados fora do PubliAI.
 * - `porItem`: restrito ao escopo (anúncios gerenciados pelo app), para a tabela por anúncio,
 *   rankings e encalhados.
 * - `porItemExterno`: itens fora do escopo que venderam no período (sem títulos ainda).
 * Pura e sem rede. `pedidos` (nº distinto) conta cada pedido com ≥1 item uma única vez.
 */
export function agregarPedidos(pedidos: PedidoML[], idsEscopo: Set<string>): AgregadoPedidos {
  const porItem: Record<string, { unidades: number; valor: number }> = {};
  const porItemExterno: Record<string, { unidades: number; valor: number }> = {};
  let faturamento = 0;
  let unidades = 0;
  let pedidosComItem = 0;

  for (const pedido of pedidos) {
    let temItem = false;
    for (const oi of pedido.order_items ?? []) {
      const qtd = Number(oi?.quantity ?? 0);
      const preco = Number(oi?.unit_price ?? 0);
      const valor = qtd * preco;
      faturamento += valor;
      unidades += qtd;
      temItem = true;
      const id = oi?.item?.id;
      if (!id) continue;
      const alvo = idsEscopo.has(id) ? porItem : porItemExterno;
      const acc = alvo[id] ?? { unidades: 0, valor: 0 };
      acc.unidades += qtd;
      acc.valor += valor;
      alvo[id] = acc;
    }
    if (temItem) pedidosComItem += 1;
  }

  return { porItem, porItemExterno, totais: { faturamento, unidades, pedidos: pedidosComItem } };
}

const API = 'https://api.mercadolibre.com';

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Atributo de item do ML (recorte: só id + value_name nos interessam). */
interface AtributoML { id?: string | null; value_name?: string | null }

/** Pura: extrai o GTIN dos atributos de um item (id `GTIN`, fallback `EAN`). undefined se ausente. */
export function extrairGtin(attrs: AtributoML[] | undefined | null): string | undefined {
  if (!Array.isArray(attrs)) return undefined;
  const acha = (id: string) => attrs.find((a) => a?.id === id)?.value_name;
  const v = acha('GTIN') ?? acha('EAN');
  return v ? String(v) : undefined;
}

/**
 * Pura: atribui vendas de catálogo (itens externos) ao anúncio do usuário por GTIN (ADR-0045).
 * Item externo cujo GTIN ∈ mapaGtin tem unidades/valor somados em porItem[ml_item_id] e some do
 * externo; os demais continuam externos. Não muta os objetos de entrada.
 * - gtinPorItem: itemExternoId → GTIN (vindo da API; ausente quando não foi possível ler)
 * - mapaGtin: GTIN do usuário → ml_item_id da família dona dele
 */
export function reclassificarPorGtin(
  porItem: Record<string, { unidades: number; valor: number }>,
  porItemExterno: Record<string, { unidades: number; valor: number }>,
  gtinPorItem: Record<string, string>,
  mapaGtin: Record<string, string>,
): {
  porItem: Record<string, { unidades: number; valor: number }>;
  porItemExterno: Record<string, { unidades: number; valor: number }>;
} {
  const novoItem: Record<string, { unidades: number; valor: number }> = {};
  for (const [id, v] of Object.entries(porItem)) novoItem[id] = { ...v };
  const novoExterno: Record<string, { unidades: number; valor: number }> = {};

  for (const [id, v] of Object.entries(porItemExterno)) {
    const gtin = gtinPorItem[id];
    const alvo = gtin ? mapaGtin[gtin] : undefined;
    if (!alvo) {
      novoExterno[id] = { ...v };
      continue;
    }
    const acc = novoItem[alvo] ?? { unidades: 0, valor: 0 };
    acc.unidades += v.unidades;
    acc.valor += v.valor;
    novoItem[alvo] = acc;
  }

  return { porItem: novoItem, porItemExterno: novoExterno };
}

/** Pura: porItemExterno + títulos → lista de ItemExternoVenda ordenada por valor desc. */
export function montarExternos(
  porItemExterno: Record<string, { unidades: number; valor: number }>,
  titulos: Record<string, string>,
): ItemExternoVenda[] {
  return Object.entries(porItemExterno)
    .map(([id, v]) => ({ id, titulo: titulos[id] ?? id, unidades: v.unidades, valor: v.valor }))
    .sort((a, b) => b.valor - a.valor);
}

/**
 * Resolve título e GTIN de N itens via /items em lote (resiliente: bloco que falha é ignorado).
 * O GTIN serve para reclassificar venda de catálogo no produto do usuário (ADR-0045).
 */
async function buscarTitulosEGtins(
  token: string,
  ids: string[],
  signal: AbortSignal,
): Promise<{ titulos: Record<string, string>; gtins: Record<string, string> }> {
  const titulos: Record<string, string> = {};
  const gtins: Record<string, string> = {};
  if (ids.length === 0) return { titulos, gtins };
  const headers = { Authorization: `Bearer ${token}` };
  for (const bloco of chunk(ids, 20)) {
    try {
      const url = `${API}/items?ids=${bloco.join(',')}&attributes=id,title,attributes`;
      const resp = await fetch(url, { headers, signal });
      if (!resp.ok) continue;
      const arr = await resp.json(); // [{ code, body:{ id, title, attributes } }]
      if (Array.isArray(arr)) {
        for (const e of arr) {
          const id = e?.body?.id;
          if (e?.code === 200 && id) {
            titulos[id] = e.body.title ?? id;
            const gtin = extrairGtin(e.body.attributes);
            if (gtin) gtins[id] = gtin;
          }
        }
      }
    } catch (e) {
      // Bloco indisponível: ids ficam sem título/GTIN → usa id e segue externo. Loga p/ diagnóstico.
      console.warn('buscarTitulosEGtins bloco falhou:', (e as Error).message);
    }
  }
  return { titulos, gtins };
}

/**
 * Varre /orders/search do vendedor no período (pedidos pagos) e agrega por item.
 * Resiliente: rate-limit (429) ou erro de página interrompe a varredura e devolve o
 * agregado parcial — a tela nunca quebra por causa de vendas. Lança só se o token falhar
 * (sem credencial), igual lerStatus.
 */
export async function lerVendasML(
  token: string,
  intervalo: { desde: string; ate: string },
  idsEscopo: string[],
  mapaGtin: Record<string, string> = {},
): Promise<MetricasVendasCanal> {
  const headers = { Authorization: `Bearer ${token}` };
  const signal = AbortSignal.timeout(25_000);
  const escopo = new Set(idsEscopo);

  // Seller id (o /orders/search exige seller=). /users/me resolve a partir do token.
  const meResp = await fetch(`${API}/users/me`, { headers, signal });
  if (!meResp.ok) throw new Error(`ML /users/me ${meResp.status}`);
  const me = await meResp.json();
  const seller = me?.id;
  if (!seller) throw new Error('ML: seller id ausente');

  const pedidos: PedidoML[] = [];
  const limit = 50;
  let offset = 0;
  // Teto de segurança: até 40 páginas (2000 pedidos). Períodos muito grandes ficam parciais
  // — preferível a varrer indefinidamente e estourar o tempo da edge function.
  while (offset < 2000) {
    const params = new URLSearchParams({
      seller: String(seller),
      'order.status': 'paid',
      'order.date_created.from': intervalo.desde,
      'order.date_created.to': intervalo.ate,
      sort: 'date_desc',
      offset: String(offset),
      limit: String(limit),
    });
    let resp: Response;
    try {
      resp = await fetch(`${API}/orders/search?${params}`, { headers, signal });
    } catch (e) {
      // Falha logo na 1ª página → propaga (não mascara como "0 vendas"); nas seguintes,
      // já temos dados parciais e paramos.
      if (offset === 0) throw new Error(`ML /orders indisponível: ${(e as Error).message}`);
      break;
    }
    if (!resp.ok) {
      if (offset === 0) {
        const corpo = await resp.text().catch(() => '');
        throw new Error(`ML /orders ${resp.status}: ${corpo.slice(0, 200)}`);
      }
      break; // erro em página posterior → devolve o que já agregou
    }
    const data = await resp.json();
    const results: PedidoML[] = Array.isArray(data?.results) ? data.results : [];
    pedidos.push(...results);
    const total = Number(data?.paging?.total ?? pedidos.length);
    offset += limit;
    if (results.length === 0 || offset >= total) break;
  }

  const agg = agregarPedidos(pedidos, escopo);
  // Enriquece os externos com título + GTIN; o GTIN reclassifica vendas de catálogo no produto
  // do usuário (ADR-0045). Mesma chamada /items, sem custo extra de rede.
  const { titulos, gtins } = await buscarTitulosEGtins(token, Object.keys(agg.porItemExterno), signal);
  const { porItem, porItemExterno } = reclassificarPorGtin(agg.porItem, agg.porItemExterno, gtins, mapaGtin);
  return {
    porItem,
    totais: agg.totais,
    externos: montarExternos(porItemExterno, titulos),
  };
}
