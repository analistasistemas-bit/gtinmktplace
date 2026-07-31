// Leitura financeira da conta Mercado Pago — REALIZADO de pagamentos do período.
//
// Não existe "conexão do Mercado Pago": o worker chamador resolve o token e o `contaExternaId`
// da conexão `mercado_livre` da org e os repassa aqui — este módulo não resolve token próprio
// nem sabe de organização (ADR-0093). O consumidor é `carregarLiquidoMP`
// (`_shared/faturamento/enriquecimento.ts`), que usa `buscarPagamentosMP` (lote) e
// `buscarPagamentoMP` (workers de evento, por id do pedido) para alimentar
// `estorno`/`money_release_date` em `ml_vendas`; os dois filtros de ruído (pagamento de
// terceiro via `collector_id`, pagamento de frete via `description === 'marketplace_shipment'`)
// vivem em `montarMapaLiquido`, não neste arquivo.
//
// Decisão anterior mantida: a projeção "A receber / Lançamentos futuros" do app do MP NÃO é
// reproduzível pela API (ver ADR-0031); aqui entregamos o realizado, que é confiável.

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

const MP_API = 'https://api.mercadopago.com';

/**
 * Varre /v1/payments/search da conta no período de lookback (relativo, para evitar problema de
 * fuso) e devolve os pagamentos aprovados + os totalmente estornados. Duas buscas (status é
 * excludente na API do MP — não existe `status=approved,refunded`): estorno TOTAL move o
 * pagamento de 'approved' para 'refunded' (só o PARCIAL mantém 'approved' com
 * `transaction_amount_refunded>0`); sem a 2ª busca, `montarMapaLiquido` nunca vê esse pagamento e
 * `ml_vendas.estorno` fica `null` pra sempre (não é timing, é exclusão permanente na fonte).
 * Resiliente: erro na 1ª página de 'approved' propaga (é a busca que sustenta o líquido/receita);
 * erro na 1ª página de 'refunded' ou em páginas seguintes de qualquer uma devolve o parcial já
 * lido. Espelha lerVendasML/buscarClaimsSeller (duas buscas por status, mesma forma).
 */
export async function buscarPagamentosMP(
  token: string,
  lookbackDias = 120,
): Promise<PagamentoMP[]> {
  const headers = { Authorization: `Bearer ${token}` };
  const pagamentos: PagamentoMP[] = [];
  const limit = 50;

  for (const status of ['approved', 'refunded']) {
    let offset = 0;
    while (offset < 2000) {
      const params = new URLSearchParams({
        sort: 'date_created',
        criteria: 'desc',
        range: 'date_created',
        begin_date: `NOW-${lookbackDias}DAYS`,
        end_date: 'NOW',
        status,
        offset: String(offset),
        limit: String(limit),
      });
      let resp: Response;
      try {
        resp = await fetch(`${MP_API}/v1/payments/search?${params}`, { headers, signal: AbortSignal.timeout(25_000) });
      } catch (e) {
        if (offset === 0 && status === 'approved') throw new Error(`MP /payments indisponível: ${(e as Error).message}`);
        break;
      }
      if (!resp.ok) {
        if (offset === 0 && status === 'approved') {
          const corpo = await resp.text().catch(() => '');
          throw new Error(`MP /payments ${resp.status}: ${corpo.slice(0, 200)}`);
        }
        break;
      }
      const data = await resp.json();
      const results: PagamentoMP[] = Array.isArray(data?.results) ? data.results : [];
      pagamentos.push(...results);
      const total = Number(data?.paging?.total ?? results.length);
      offset += limit;
      if (results.length === 0 || offset >= total) break;
    }
  }

  return pagamentos;
}

/**
 * GET /v1/payments/{id} — um pagamento específico, para quem já sabe o id (workers de evento, que
 * atendem um pedido por vez e têm os ids em `pedido.payments`). Lança em erro, como a 1ª página de
 * `buscarPagamentosMP`: o chamador precisa distinguir leitura falha de "não achei".
 * Busca multi-id (`?id=a,b`) não existe no MP — devolve total 0 —, então é 1 requisição por id.
 */
export async function buscarPagamentoMP(token: string, id: string | number): Promise<PagamentoMP> {
  const resp = await fetch(`${MP_API}/v1/payments/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(25_000),
  });
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => '');
    throw new Error(`MP /payments/${id} ${resp.status}: ${corpo.slice(0, 200)}`);
  }
  return await resp.json() as PagamentoMP;
}
