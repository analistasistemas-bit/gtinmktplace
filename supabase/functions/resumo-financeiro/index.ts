import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import {
  agregarFinanceiro, buscarPagamentosMP, getContaId, montarCustoPorPagamento,
  type ResumoFinanceiro,
} from '../_shared/mercadopago/financeiro.ts';
import { buscarGtinsDosItens, buscarPedidosML, mapearPagamentoParaItem } from '../_shared/ml/pedidos.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';

interface Body { desde?: string; ate?: string }

/** GTIN normalizado para casar mesmo com zero à esquerda divergente entre ML e planilha. */
const normGtin = (g: string) => g.replace(/^0+/, '');

/**
 * Custo total (R$) por pagamento, para o markup do detalhe. Cruza pedido do ML (payment→item/var)
 * com o custo REAL do produto da planilha (variacoes.custo, R$). Cadeia de resolução:
 *   1. custo da variação vendida (ml_variation_id)
 *   2. custo do anúncio (ml_item_id da família) — anúncio sem variação publicado pelo PubliAI
 *   3. custo por GTIN — anúncios FORA do PubliAI cujo produto existe no catálogo (1 /items extra)
 * max() por chave é robusto a linhas duplicadas por re-importação. NÃO usar familias.custo_centavos
 * (é custo de tokens de IA da copy/vision). Resiliente: qualquer falha devolve {} e o markup some.
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
    const { data: variacoes } = await admin.from('variacoes')
      .select('custo, ml_variation_id, gtin, familias!inner(ml_item_id)')
      .eq('user_id', userId).not('custo', 'is', null);
    const custoPorVariacao: Record<string, number> = {};
    const custoPorItem: Record<string, number> = {};
    const custoPorGtin: Record<string, number> = {};
    for (const v of variacoes ?? []) {
      const custo = Number((v as { custo: number | null }).custo ?? 0);
      if (custo <= 0) continue;
      const varId = (v as { ml_variation_id: string | null }).ml_variation_id;
      const gtin = (v as { gtin: string | null }).gtin;
      const fams = (v as { familias: { ml_item_id: string | null } | { ml_item_id: string | null }[] }).familias;
      const itemId = (Array.isArray(fams) ? fams[0]?.ml_item_id : fams?.ml_item_id) ?? null;
      if (varId != null && custo > (custoPorVariacao[varId] ?? 0)) custoPorVariacao[varId] = custo;
      if (itemId != null && custo > (custoPorItem[itemId] ?? 0)) custoPorItem[itemId] = custo;
      if (gtin) { const k = normGtin(gtin); if (custo > (custoPorGtin[k] ?? 0)) custoPorGtin[k] = custo; }
    }

    // Fallback GTIN: anúncios que não casaram custo por variação nem por item (ex.: publicados
    // fora do PubliAI). Busca o GTIN só desses anúncios e casa com o catálogo.
    const semCusto = [...new Set(
      Object.values(itemPorPagamento)
        .filter((i) => custoPorItem[i.mlItemId] == null
          && (i.mlVariationId == null || custoPorVariacao[i.mlVariationId] == null))
        .map((i) => i.mlItemId),
    )];
    if (semCusto.length > 0) {
      const gtinPorItem = await buscarGtinsDosItens(tokenML, semCusto);
      for (const [itemId, gtin] of Object.entries(gtinPorItem)) {
        const custo = custoPorGtin[normGtin(gtin)];
        if (custo != null && custo > 0) custoPorItem[itemId] = custo;
      }
    }

    return montarCustoPorPagamento(itemPorPagamento, custoPorVariacao, custoPorItem);
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
