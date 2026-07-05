import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import {
  agregarFinanceiro, buscarPagamentosMP, getContaId, montarInfoPorPagamento,
  type InfoCusto, type ResumoFinanceiro,
} from '../_shared/mercadopago/financeiro.ts';
import { buscarGtinsDosItens, buscarPedidosML, mapearPagamentoParaItem } from '../_shared/ml/pedidos.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';

interface Body { desde?: string; ate?: string }

/** GTIN normalizado para casar mesmo com zero à esquerda divergente entre ML e planilha. */
const normGtin = (g: string) => g.replace(/^0+/, '');

/**
 * Custo total (R$) + código do produto por pagamento, para markup/identificação no detalhe.
 * Cruza pedido do ML (payment→item/var) com custo+código da planilha (variacoes). Cadeia:
 *   1. variação vendida (ml_variation_id)
 *   2. anúncio (ml_item_id da família) — anúncio sem variação publicado pelo PubliAI
 *   3. GTIN — anúncios FORA do PubliAI cujo produto existe no catálogo (1 /items extra)
 * max(custo) por chave é robusto a linhas duplicadas por re-importação. NÃO usar
 * familias.custo_centavos (é custo de tokens de IA). Resiliente: falha → {} e markup some.
 */
async function infoPorPagamentoDoPeriodo(
  userId: string,
  orgId: string,
  intervalo: { desde: string; ate: string },
): Promise<Record<string, InfoCusto>> {
  try {
    const conexao = await resolverConexao(adminClient(), orgId, 'mercado_livre');
    if (!conexao) throw new Error('Organização sem conexão com o Mercado Livre');
    const tokenML = await getValidAccessTokenConexao(conexao);
    const pedidos = await buscarPedidosML(tokenML, intervalo);
    const itemPorPagamento = mapearPagamentoParaItem(pedidos);

    const admin = adminClient();
    const { data: variacoes } = await admin.from('variacoes')
      .select('custo, codigo, peso_gramas, ml_variation_id, gtin, familias!inner(ml_item_id)')
      .eq('user_id', userId).not('custo', 'is', null);
    const porVariacao: Record<string, InfoCusto> = {};
    const porItem: Record<string, InfoCusto> = {};
    const porGtin: Record<string, InfoCusto> = {};
    // Mantém a entrada de maior custo por chave (e o código/peso correspondentes).
    const upsert = (m: Record<string, InfoCusto>, k: string, custo: number, codigo: string | null, peso: number) => {
      if (custo > (m[k]?.custo ?? 0)) m[k] = { custo, codigo, peso };
    };
    for (const v of variacoes ?? []) {
      const custo = Number((v as { custo: number | null }).custo ?? 0);
      if (custo <= 0) continue;
      const codigo = (v as { codigo: string | null }).codigo ?? null;
      const peso = Number((v as { peso_gramas: number | null }).peso_gramas ?? 0);
      const varId = (v as { ml_variation_id: string | null }).ml_variation_id;
      const gtin = (v as { gtin: string | null }).gtin;
      const fams = (v as { familias: { ml_item_id: string | null } | { ml_item_id: string | null }[] }).familias;
      const itemId = (Array.isArray(fams) ? fams[0]?.ml_item_id : fams?.ml_item_id) ?? null;
      if (varId != null) upsert(porVariacao, varId, custo, codigo, peso);
      if (itemId != null) upsert(porItem, itemId, custo, codigo, peso);
      if (gtin) upsert(porGtin, normGtin(gtin), custo, codigo, peso);
    }

    // Fallback GTIN: anúncios que não casaram por variação nem por item (ex.: fora do PubliAI).
    const semCusto = [...new Set(
      Object.values(itemPorPagamento)
        .filter((i) => porItem[i.mlItemId] == null
          && (i.mlVariationId == null || porVariacao[i.mlVariationId] == null))
        .map((i) => i.mlItemId),
    )];
    if (semCusto.length > 0) {
      const gtinPorItem = await buscarGtinsDosItens(tokenML, semCusto);
      for (const [itemId, gtin] of Object.entries(gtinPorItem)) {
        const info = porGtin[normGtin(gtin)];
        if (info != null) porItem[itemId] = info;
      }
    }

    return montarInfoPorPagamento(itemPorPagamento, porVariacao, porItem);
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

  let userId: string, orgId: string;
  try { ({ userId, orgId } = await requireUserOrg(req)); }
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
    // MP (vendas/líquido) e o custo+código por pagamento (markup) em paralelo — resiliente:
    // não derruba o financeiro se o ML falhar.
    const [pagamentos, infoPorPagamento] = await Promise.all([
      buscarPagamentosMP(token),
      infoPorPagamentoDoPeriodo(userId, orgId, intervalo),
    ]);
    const resumo = agregarFinanceiro(pagamentos, { ...intervalo, contaId }, infoPorPagamento);
    return json(resumo);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ erroFinanceiro: msg, ...vazio });
  }
});

function json(o: unknown) {
  return new Response(JSON.stringify(o), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
