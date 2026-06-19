import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { agregarFinanceiro, buscarPagamentosMP, getContaId, type ResumoFinanceiro } from '../_shared/mercadopago/financeiro.ts';

interface Body { desde?: string; ate?: string }

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

  try { await requireUser(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let body: Body;
  try { body = await req.json(); }
  catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  if (!body.desde || !body.ate) {
    return new Response('desde e ate obrigatórios', { status: 400, headers: corsHeaders });
  }

  const vazio: ResumoFinanceiro = {
    bruto: 0, liquido: 0, descontos: 0, estornos: 0, pagamentos: 0,
  };

  const token = Deno.env.get('MP_ACCESS_TOKEN');
  if (!token) {
    return json({ semCredencialMP: true, ...vazio });
  }

  try {
    const contaId = await getContaId(token);
    const pagamentos = await buscarPagamentosMP(token);
    const resumo = agregarFinanceiro(pagamentos, { desde: body.desde, ate: body.ate, contaId });
    return json(resumo);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ erroFinanceiro: msg, ...vazio });
  }
});

function json(o: unknown) {
  return new Response(JSON.stringify(o), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
