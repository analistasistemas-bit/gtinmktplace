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

/** Pura: porItemExterno + títulos → lista de ItemExternoVenda ordenada por valor desc. */
export function montarExternos(
  porItemExterno: Record<string, { unidades: number; valor: number }>,
  titulos: Record<string, string>,
): ItemExternoVenda[] {
  return Object.entries(porItemExterno)
    .map(([id, v]) => ({ id, titulo: titulos[id] ?? id, unidades: v.unidades, valor: v.valor }))
    .sort((a, b) => b.valor - a.valor);
}

/** Resolve títulos de N itens via /items em lote (resiliente: bloco que falha vira id). */
async function buscarTitulos(token: string, ids: string[], signal: AbortSignal): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (ids.length === 0) return out;
  const headers = { Authorization: `Bearer ${token}` };
  for (const bloco of chunk(ids, 20)) {
    try {
      const url = `${API}/items?ids=${bloco.join(',')}&attributes=id,title`;
      const resp = await fetch(url, { headers, signal });
      if (!resp.ok) continue;
      const arr = await resp.json(); // [{ code, body:{ id, title } }]
      if (Array.isArray(arr)) {
        for (const e of arr) {
          const id = e?.body?.id;
          if (e?.code === 200 && id) out[id] = e.body.title ?? id;
        }
      }
    } catch (e) {
      // Bloco indisponível: ids ficam sem título → usa id. Loga p/ diagnóstico (igual lerStatus).
      console.warn('buscarTitulos bloco falhou:', (e as Error).message);
    }
  }
  return out;
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
  const titulos = await buscarTitulos(token, Object.keys(agg.porItemExterno), signal);
  return {
    porItem: agg.porItem,
    totais: agg.totais,
    externos: montarExternos(agg.porItemExterno, titulos),
  };
}
