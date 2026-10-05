// PÚBLICA (verify_jwt=false) — chamada pelo schedule do QStash.
// Deployar com: supabase functions deploy notificar-liberacao --no-verify-jwt
//
// Notifica no Telegram quando recebimentos de vendas são liberados HOJE no saldo Mercado Pago.
// Idempotente: só processa vendas com money_release_date = hoje (BRT) e liberacao_notificada_em NULL,
// marcando-as após o processamento independente de o Telegram estar ativo.
// NÃO é o "A receber" do MP — é a liberação por-venda (ADR-0031).

import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { montarMensagemLiberacao } from '../_shared/notificacoes/telegram.ts';
import { filtroNotIn, listarOrgsArquivadas } from '../_shared/orgs-arquivadas.ts';
import { liquidoDasLiberadas, type VendaLiberacao } from '../_shared/faturamento/liberacao.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return json({ erro: 'Method not allowed' }, 405);
  // Função pública (verify_jwt=false): autentica pela assinatura do QStash, como os demais workers.
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) return json({ erro: 'Invalid signature' }, 401);

  const admin = adminClient();

  // Dia corrente em America/Sao_Paulo.
  // money_release_date é timestamptz (UTC no banco). Usamos uma janela BRT explícita
  // (-03:00) para não misturar fuso: filtramos gte início-do-dia e lt início-do-dia-seguinte.
  // Um filtro JS adicional garante exatamente o dia BRT antes de somar/marcar.
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD

  // Amanhã em BRT: avança 1 dia a partir de hoje para definir o limite superior.
  const hojeDate = new Date(`${hoje}T00:00:00-03:00`);
  const amanhaDate = new Date(hojeDate.getTime() + 24 * 60 * 60 * 1000);
  const amanha = amanhaDate.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

  const desde = `${hoje}T00:00:00-03:00`;
  const ate = `${amanha}T00:00:00-03:00`;

  // ADR-0175: org arquivada não notifica (excluída na consulta, antes de marcar/enviar).
  const arquivadas = filtroNotIn(await listarOrgsArquivadas(admin));
  let q = admin
    .from('ml_vendas')
    .select(`id, org_id, money_release_date, ${COLUNAS_RATEIO}`)
    .gte('money_release_date', desde)
    .lt('money_release_date', ate)
    .is('liberacao_notificada_em', null)
    .in('status', ['paid', 'partially_refunded', 'refunded']);
  if (arquivadas) q = q.not('org_id', 'in', arquivadas);
  const { data: vendas, error } = await q;

  if (error) {
    return json({ erro: error.message }, 500);
  }
  if (!vendas || vendas.length === 0) {
    return json({ notificados: 0, usuarios: 0 });
  }

  // Filtra em JS pelo dia BRT exato (double-check após a query de janela larga).
  // Garante que o fuso -03:00 explícito na query e a comparação JS coincidam.
  const vendasHoje = (vendas as Array<VendaLiberacao & { org_id: string; money_release_date: string }>).filter(
    (v) =>
      new Date(v.money_release_date).toLocaleDateString('en-CA', {
        timeZone: 'America/Sao_Paulo',
      }) === hoje,
  );

  if (vendasHoje.length === 0) {
    return json({ notificados: 0, usuarios: 0 });
  }

  // Demais orders dos mesmos envios/packs (inclusive as que liberam em outro dia): o frete do envio
  // é gravado inteiro em cada order e precisa ser rateado entre todas — ver liquidoDasLiberadas.
  // Rateio por org: dois envios de orgs diferentes nunca dividem frete (revisão Grok).
  const liquidoPorVenda = new Map<string, number>();
  for (const orgId of new Set(vendasHoje.map((v) => v.org_id))) {
    const daOrg = vendasHoje.filter((v) => v.org_id === orgId);
    const membros = await carregarMembrosDosEnvios(admin, orgId, daOrg);
    if (membros === null) return json({ erro: 'falha ao carregar membros dos envios' }, 500);
    for (const [id, liq] of liquidoDasLiberadas(daOrg, membros)) liquidoPorVenda.set(id, liq);
  }

  // Agrupa por org_id (E7 — config do Telegram é por organização, não por usuário).
  const porOrg = new Map<string, { ids: string[]; total: number }>();
  for (const v of vendasHoje) {
    const acc = porOrg.get(v.org_id) ?? { ids: [], total: 0 };
    acc.ids.push(v.id);
    acc.total += liquidoPorVenda.get(v.id) ?? 0;
    porOrg.set(v.org_id, acc);
  }

  let usuarios = 0;
  let notificados = 0;

  for (const [orgId, { ids, total }] of porOrg) {
    if (total > 0) {
      const totalArredondado = Math.round(total * 100) / 100;
      const enviados = await notificarCategoria(
        admin,
        orgId,
        'financeiro',
        montarMensagemLiberacao(totalArredondado, ids.length, 'BRL'),
      );
      if (enviados > 0) usuarios += 1;
    }

    // Marca SEMPRE (mesmo sem Telegram ativo) para não reprocessar.
    const { error: errMarca } = await admin
      .from('ml_vendas')
      .update({ liberacao_notificada_em: hoje })
      .in('id', ids);
    if (errMarca) console.error(`Falha ao marcar ${ids.length} vendas (org ${orgId}):`, errMarca.message);
    notificados += ids.length;
  }

  return json({ notificados, usuarios });
});

const COLUNAS_RATEIO = 'status, shipping_id, pack_id, frete_vendedor, sale_fee_total, total_amount, cupom_vendedor, liquido';

/** Orders da org que compartilham envio ou pack com as liberadas. null = erro. Em lotes de 80
 *  liberadas: cada lote traz poucas centenas de linhas, longe do corte silencioso de 1000 do PostgREST. */
async function carregarMembrosDosEnvios(
  admin: ReturnType<typeof adminClient>,
  orgId: string,
  vendas: VendaLiberacao[],
): Promise<VendaLiberacao[] | null> {
  const membros: VendaLiberacao[] = [];
  for (let i = 0; i < vendas.length; i += 80) {
    const lote = vendas.slice(i, i + 80);
    const envios = [...new Set(lote.map((v) => v.shipping_id).filter((x) => x != null))];
    const packs = [...new Set(lote.map((v) => v.pack_id).filter((x) => x != null))];
    const filtros = [
      envios.length ? `shipping_id.in.(${envios.join(',')})` : null,
      packs.length ? `pack_id.in.(${packs.join(',')})` : null,
    ].filter(Boolean).join(',');
    if (!filtros) continue;
    const { data, error } = await admin.from('ml_vendas').select(`id, ${COLUNAS_RATEIO}`)
      .eq('org_id', orgId).or(filtros);
    if (error) { console.error(`membros dos envios (org ${orgId}):`, error.message); return null; }
    if ((data ?? []).length >= 1000) { console.error(`membros dos envios (org ${orgId}): corte de 1000 linhas`); return null; }
    membros.push(...(data as VendaLiberacao[]));
  }
  return membros;
}

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
