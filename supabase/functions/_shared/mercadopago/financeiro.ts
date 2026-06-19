// Leitura financeira da conta Mercado Pago — REALIZADO de vendas do período.
//
// IMPORTANTE (causa raiz, validada na conta real 2026-06-19): /v1/payments/search devolve TODOS
// os pagamentos ligados à conta. Dois ruídos a excluir para bater com a tela de Vendas do ML
// (fonte /orders):
//   1. compras/terceiros: pagamentos em que `collector_id` != a conta (ex.: Notebook/Sauna que a
//      empresa comprou) — inflavam o faturamento para ~R$ 29k irreal.
//   2. frete: cada venda gera um pagamento de envio à parte (`description == marketplace_shipment`)
//      que dobrava a contagem e somava frete ao bruto.
// Com os dois filtros, bruto/contagem batem exatamente com /orders (24 pedidos, R$ 606,80).
//
// Decisão anterior mantida: a projeção "A receber / Lançamentos futuros" do app do MP NÃO é
// reproduzível pela API (ver ADR-0031); aqui entregamos o realizado, que é confiável.
//
// Fonte: /v1/payments/search com o Access Token de produção da conta (secret MP_ACCESS_TOKEN).

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Recorte de um pagamento do MP usado para o resumo (demais campos são ignorados). */
export interface PagamentoMP {
  id: number | string;
  status?: string | null;
  date_approved?: string | null;
  /** Quem RECEBE o dinheiro. Venda da conta ⇔ collector_id == id da conta. */
  collector_id?: number | string | null;
  /** ML cria um pagamento de frete à parte por venda, com description "marketplace_shipment". */
  description?: string | null;
  transaction_amount?: number | null; // bruto
  transaction_amount_refunded?: number | null;
  transaction_details?: {
    net_received_amount?: number | null; // líquido que o vendedor recebe
  } | null;
}

/** Pagamento do frete (perna de envio do ML), não é uma venda de produto. */
const ehFrete = (p: PagamentoMP) => p.description === 'marketplace_shipment';

export interface ResumoFinanceiro {
  /** Faturamento bruto das vendas aprovadas no período. */
  bruto: number;
  /** Líquido que o vendedor recebe (soma de net_received_amount). */
  liquido: number;
  /** Bruto − líquido: taxas do ML/MP + frete + custos retidos. */
  descontos: number;
  /** Total estornado no período. */
  estornos: number;
  /** Quantidade de vendas (pagamentos recebidos) no período. */
  pagamentos: number;
}

const liquido = (p: PagamentoMP) => Number(p.transaction_details?.net_received_amount ?? 0);

/**
 * Agrega o realizado do período: pagamentos aprovados (date_approved em [desde, ate]) em que a
 * conta é a RECEBEDORA (`collector_id` == contaId). Pura e sem rede — o teste cobre a exclusão
 * de pagamentos de terceiros/compras, bruto/líquido/descontos/estornos e o recorte por data.
 */
export function agregarFinanceiro(
  pagamentos: PagamentoMP[],
  intervalo: { desde: string; ate: string; contaId: number },
): ResumoFinanceiro {
  const desdeMs = Date.parse(intervalo.desde);
  const ateMs = Date.parse(intervalo.ate);

  let bruto = 0;
  let liq = 0;
  let estornos = 0;
  let qtd = 0;

  for (const p of pagamentos) {
    // Só vendas da conta — exclui compras/pagamentos de terceiros (collector diferente).
    if (Number(p.collector_id) !== intervalo.contaId) continue;
    // Exclui o pagamento de frete (perna de envio) — não é venda; senão dobra a contagem e o bruto.
    if (ehFrete(p)) continue;
    if (!p.date_approved) continue;
    const t = Date.parse(p.date_approved);
    if (!(t >= desdeMs && t <= ateMs)) continue;
    bruto += Number(p.transaction_amount ?? 0);
    liq += liquido(p);
    estornos += Number(p.transaction_amount_refunded ?? 0);
    qtd += 1;
  }

  return {
    bruto: round2(bruto),
    liquido: round2(liq),
    descontos: round2(bruto - liq),
    estornos: round2(estornos),
    pagamentos: qtd,
  };
}

const MP_API = 'https://api.mercadopago.com';

/** Resolve o id da conta dona do token (collector). Usado para separar vendas de compras. */
export async function getContaId(token: string): Promise<number> {
  const resp = await fetch(`${MP_API}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`MP /users/me ${resp.status}`);
  const me = await resp.json();
  const id = Number(me?.id);
  if (!id) throw new Error('MP: id da conta ausente');
  return id;
}

/**
 * Varre /v1/payments/search da conta no período de lookback (relativo, para evitar problema de
 * fuso) e devolve os pagamentos aprovados. Resiliente: erro na 1ª página propaga; nas seguintes
 * devolve o parcial. Espelha lerVendasML.
 */
export async function buscarPagamentosMP(
  token: string,
  lookbackDias = 120,
): Promise<PagamentoMP[]> {
  const headers = { Authorization: `Bearer ${token}` };
  const signal = AbortSignal.timeout(25_000);
  const pagamentos: PagamentoMP[] = [];
  const limit = 50;
  let offset = 0;

  while (offset < 2000) {
    const params = new URLSearchParams({
      sort: 'date_created',
      criteria: 'desc',
      range: 'date_created',
      begin_date: `NOW-${lookbackDias}DAYS`,
      end_date: 'NOW',
      status: 'approved',
      offset: String(offset),
      limit: String(limit),
    });
    let resp: Response;
    try {
      resp = await fetch(`${MP_API}/v1/payments/search?${params}`, { headers, signal });
    } catch (e) {
      if (offset === 0) throw new Error(`MP /payments indisponível: ${(e as Error).message}`);
      break;
    }
    if (!resp.ok) {
      if (offset === 0) {
        const corpo = await resp.text().catch(() => '');
        throw new Error(`MP /payments ${resp.status}: ${corpo.slice(0, 200)}`);
      }
      break;
    }
    const data = await resp.json();
    const results: PagamentoMP[] = Array.isArray(data?.results) ? data.results : [];
    pagamentos.push(...results);
    const total = Number(data?.paging?.total ?? pagamentos.length);
    offset += limit;
    if (results.length === 0 || offset >= total) break;
  }

  return pagamentos;
}
