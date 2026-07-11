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

  const { data: vendas, error } = await admin
    .from('ml_vendas')
    .select('id, org_id, liquido, money_release_date, status')
    .gte('money_release_date', desde)
    .lt('money_release_date', ate)
    .is('liberacao_notificada_em', null)
    .in('status', ['paid', 'partially_refunded', 'refunded']);

  if (error) {
    return json({ erro: error.message }, 500);
  }
  if (!vendas || vendas.length === 0) {
    return json({ notificados: 0, usuarios: 0 });
  }

  // Filtra em JS pelo dia BRT exato (double-check após a query de janela larga).
  // Garante que o fuso -03:00 explícito na query e a comparação JS coincidam.
  const vendasHoje = (vendas as Array<{
    id: string;
    org_id: string;
    liquido: number | null;
    money_release_date: string;
    status: string;
  }>).filter(
    (v) =>
      new Date(v.money_release_date).toLocaleDateString('en-CA', {
        timeZone: 'America/Sao_Paulo',
      }) === hoje,
  );

  if (vendasHoje.length === 0) {
    return json({ notificados: 0, usuarios: 0 });
  }

  // Agrupa por org_id (E7 — config do Telegram é por organização, não por usuário).
  const porOrg = new Map<string, { ids: string[]; total: number }>();
  for (const v of vendasHoje) {
    const acc = porOrg.get(v.org_id) ?? { ids: [], total: 0 };
    acc.ids.push(v.id);
    acc.total += v.liquido ?? 0;
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

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
