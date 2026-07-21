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
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { ratearFreteCompartilhado } from './rateio.ts';
import { round2 } from '../dinheiro.ts';

/**
 * Access token do Mercado Pago para a org: RPC get_mp_token (Vault) com fallback ao
 * MP_ACCESS_TOKEN de instância quando a org não tem secret (D-E7.7 — zero regressão p/ a Avil,
 * único tenant com MP hoje). Null quando não há nenhum dos dois. Fonte única para toda leitura
 * financeira do MP — nunca ler MP_ACCESS_TOKEN direto (isso vaza a conta global entre tenants).
 */
export async function resolverTokenMP(admin: SupabaseClient, orgId: string | null): Promise<string | null> {
  let token: string | null = null;
  if (orgId) {
    const { data: tok } = await admin.rpc('get_mp_token', { p_org_id: orgId });
    token = (tok as string | null) ?? null;
  }
  return token ?? Deno.env.get('MP_ACCESS_TOKEN') ?? null;
}

/** Recorte de um pagamento do MP usado para o resumo (demais campos são ignorados). */
export interface PagamentoMP {
  id: number | string;
  status?: string | null;
  date_approved?: string | null;
  /** Quem RECEBE o dinheiro. Venda da conta ⇔ collector_id == id da conta. */
  collector_id?: number | string | null;
  /** ML cria um pagamento de frete à parte por venda, com description "marketplace_shipment". */
  description?: string | null;
  /** Data agendada em que o saldo DESTE pagamento fica disponível para saque (ISO). Confiável
   *  por-pagamento; o que o ADR-0031 rejeitou foi SOMAR por esta data (retenção/reserva oculta). */
  money_release_date?: string | null;
  transaction_amount?: number | null; // bruto
  transaction_amount_refunded?: number | null;
  transaction_details?: {
    net_received_amount?: number | null; // líquido que o vendedor recebe
  } | null;
}

/** Pagamento do frete (perna de envio do ML), não é uma venda de produto. */
const ehFrete = (p: PagamentoMP) => p.description === 'marketplace_shipment';

/** Uma venda (pagamento aprovado) que compõe o líquido do período. */
export interface VendaFinanceira {
  /** id do pagamento no Mercado Pago. */
  id: string;
  /** date_approved (ISO) — quando o pagamento foi aprovado. */
  data: string | null;
  /** money_release_date (ISO) — quando o ML/MP libera este recebimento para saque. Passado =
   *  já liberado; futuro = a liberar. null quando o MP não informa. */
  dataLiberacao: string | null;
  /** description do pagamento — costuma ser o título do produto. */
  descricao: string | null;
  /** Bruto da venda. */
  bruto: number;
  /** Líquido recebido (net_received_amount). */
  liquido: number;
  /** Bruto − líquido: taxas do ML/MP + frete retido nesta venda. */
  retido: number;
  /** Valor estornado nesta venda. */
  estorno: number;
  /** Custo total do produto nesta venda (custo unitário × quantidade), em R$. null = sem custo
   *  cadastrado ou venda não mapeada a um item — a UI mostra markup "—". */
  custo: number | null;
  /** Código do produto (planilha) da venda, quando mapeada ao catálogo. null = não mapeada. */
  codigo: string | null;
}

/** Custo (R$) + código do produto resolvidos para um pagamento. Campos de rateio (peso,
 *  tarifa, shippingId) são opcionais e só preenchidos quando há pedido ML cruzado. */
export interface InfoCusto {
  custo: number;
  codigo: string | null;
  /** Peso do produto (g) — base do rateio de frete em pedido pack. */
  peso?: number;
  /** Tarifa de venda do ML do pagamento (sale_fee). */
  tarifa?: number;
  /** Id do envio do pedido — pagamentos com o mesmo id compartilham o frete. */
  shippingId?: string | null;
}

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
  /** Detalhe por venda (compõe o líquido), da mais recente para a mais antiga. */
  vendas: VendaFinanceira[];
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
  infoPorPagamento: Record<string, InfoCusto> = {},
): ResumoFinanceiro {
  const desdeMs = Date.parse(intervalo.desde);
  const ateMs = Date.parse(intervalo.ate);

  let bruto = 0;
  let liq = 0;
  let estornos = 0;
  let qtd = 0;
  const vendas: VendaFinanceira[] = [];

  for (const p of pagamentos) {
    // Só vendas da conta — exclui compras/pagamentos de terceiros (collector diferente).
    if (Number(p.collector_id) !== intervalo.contaId) continue;
    // Exclui o pagamento de frete (perna de envio) — não é venda; senão dobra a contagem e o bruto.
    if (ehFrete(p)) continue;
    if (!p.date_approved) continue;
    const t = Date.parse(p.date_approved);
    if (!(t >= desdeMs && t <= ateMs)) continue;
    const vBruto = Number(p.transaction_amount ?? 0);
    const vLiq = liquido(p);
    const vEstorno = Number(p.transaction_amount_refunded ?? 0);
    bruto += vBruto;
    liq += vLiq;
    estornos += vEstorno;
    qtd += 1;
    const info = infoPorPagamento[String(p.id)];
    vendas.push({
      id: String(p.id),
      data: p.date_approved,
      dataLiberacao: p.money_release_date ?? null,
      descricao: p.description ?? null,
      custo: info?.custo ?? null,
      codigo: info?.codigo ?? null,
      bruto: round2(vBruto),
      liquido: round2(vLiq),
      retido: round2(vBruto - vLiq),
      estorno: round2(vEstorno),
    });
  }

  // Rateia o frete de envios compartilhados (packs) por peso entre suas linhas. Zero-soma:
  // não altera os totais (bruto/liq) já acumulados acima — só a atribuição por linha.
  const vendasRateadas = ratearFreteCompartilhado(vendas, infoPorPagamento);

  // Mais recente primeiro (espelha a ordem do extrato).
  vendasRateadas.sort((a, b) => Date.parse(b.data ?? '') - Date.parse(a.data ?? ''));

  return {
    bruto: round2(bruto),
    liquido: round2(liq),
    descontos: round2(bruto - liq),
    estornos: round2(estornos),
    pagamentos: qtd,
    vendas: vendasRateadas,
  };
}

/**
 * Custo total (R$) + código do produto por pagamento, para o markup/identificação no detalhe.
 * Junta o mapa pagamento→item (do ML) com o custo unitário + código do produto (da planilha):
 * prioriza a variação vendida (ml_variation_id) e, sem variação, cai no anúncio (ml_item_id).
 * custo = custoUnitário × quantidade. Só entra quando há custo positivo; pagamentos sem item
 * mapeado ou sem custo ficam de fora (markup "—"). Pura.
 */
export function montarInfoPorPagamento(
  itemPorPagamento: Record<string, {
    mlItemId: string; mlVariationId: string | null; quantidade: number;
    tarifaItem?: number; shippingId?: string | null;
  }>,
  infoPorVariacao: Record<string, InfoCusto>,
  infoPorItem: Record<string, InfoCusto>,
): Record<string, InfoCusto> {
  const out: Record<string, InfoCusto> = {};
  for (const [pagamentoId, it] of Object.entries(itemPorPagamento)) {
    const { mlItemId, mlVariationId, quantidade, tarifaItem, shippingId } = it;
    const info = (mlVariationId != null ? infoPorVariacao[mlVariationId] : undefined) ?? infoPorItem[mlItemId];
    if (!info || info.custo <= 0 || quantidade <= 0) continue;
    const entry: InfoCusto = { custo: round2(info.custo * quantidade), codigo: info.codigo };
    // Campos de rateio: só anexa quando há dado (mantém saída enxuta p/ pagamento single).
    if (info.peso != null) entry.peso = round2(info.peso * quantidade);
    if (tarifaItem != null) entry.tarifa = tarifaItem;
    if (shippingId != null) entry.shippingId = shippingId;
    out[pagamentoId] = entry;
  }
  return out;
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
