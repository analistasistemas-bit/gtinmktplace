import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import {
  agregarFinanceiro, buscarPagamentosMP, getContaId, montarCustoPorPagamento,
  type ResumoFinanceiro,
} from '../_shared/mercadopago/financeiro.ts';
import { buscarPedidosML, mapearPagamentoParaItem } from '../_shared/ml/pedidos.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';

interface Body { desde?: string; ate?: string }

/**
 * Custo total (R$) por pagamento, para o markup do detalhe. Cruza pedido do ML (payment→item)
 * com o custo das famílias (custo_centavos por ml_item_id, o maior por item — só uma família
 * tem custo cadastrado). Resiliente: qualquer falha (sem credencial ML, /orders bloqueado, etc.)
 * devolve {} e o markup some — nunca quebra o financeiro.
 */
async function custoPorPagamentoDoPeriodo(
  userId: string,
  intervalo: { desde: string; ate: string },
): Promise<Record<string, number>> {
  try {
    const tokenML = await getValidAccessToken(userId);
    const pedidos = await buscarPedidosML(tokenML, intervalo);
    const itemPorPagamento = mapearPagamentoParaItem(pedidos);

    const admin = adminClient();
    const { data: familias } = await admin.from('familias')
      .select('ml_item_id, custo_centavos').eq('user_id', userId).not('ml_item_id', 'is', null);
    const custoCentavosPorItem: Record<string, number> = {};
    for (const f of familias ?? []) {
      const id = f.ml_item_id as string;
      const c = Number(f.custo_centavos ?? 0);
      // Mantém o maior custo por item (só uma família por ml_item_id tem custo > 0).
      if (c > (custoCentavosPorItem[id] ?? 0)) custoCentavosPorItem[id] = c;
    }

    return montarCustoPorPagamento(itemPorPagamento, custoCentavosPorItem);
  } catch (_e) {
    return {};
  }
}

// Resumo financeiro da conta Mercado Pago: "A receber" líquido + calendário de lançamentos
// futuros + KPIs do período (bruto/líquido/descontos/estornos), com o A receber segregado
// entre vendas (pedido ML vinculado) e outros.
//
// Fonte: /v1/payments/search com o Access Token de produção da conta (secret MP_ACCESS_TOKEN),
// que é distinto do OAuth do Mercado Livre. Single-tenant por ora (conta AVILBV) — o token é
// global; quando virar SaaS, passa a ser por org via OAuth do Mercado Pago. Sem o secret →
// semCredencialMP (não trava a tela).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let user;
  try { user = await requireUser(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let body: Body;
  try { body = await req.json(); }
  catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  if (!body.desde || !body.ate) {
    return new Response('desde e ate obrigatórios', { status: 400, headers: corsHeaders });
  }

  const vazio: ResumoFinanceiro = {
    bruto: 0, liquido: 0, descontos: 0, estornos: 0, pagamentos: 0, vendas: [],
  };

  const token = Deno.env.get('MP_ACCESS_TOKEN');
  if (!token) {
    return json({ semCredencialMP: true, ...vazio });
  }

  try {
    const intervalo = { desde: body.desde, ate: body.ate };
    const contaId = await getContaId(token);
    // MP (vendas/líquido) e o custo por pagamento (markup) em paralelo — o custo é resiliente
    // e não derruba o financeiro se o ML falhar.
    const [pagamentos, custoPorPagamento] = await Promise.all([
      buscarPagamentosMP(token),
      custoPorPagamentoDoPeriodo(user.id, intervalo),
    ]);
    const resumo = agregarFinanceiro(pagamentos, { ...intervalo, contaId }, custoPorPagamento);
    return json(resumo);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ erroFinanceiro: msg, ...vazio });
  }
});

function json(o: unknown) {
  return new Response(JSON.stringify(o), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
