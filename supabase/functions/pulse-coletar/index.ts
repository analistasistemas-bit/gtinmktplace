// Pulse (ADR-0119): coletor server-side, dual-mode (mesmo padrão de monitorar-moderados).
//  - QStash (agendado): assinatura válida → todas as conexões ML, tier do body.
//  - Usuário logado (botão "Atualizar agora"): JWT válido → só a própria org, tier completo.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { mapearConexao } from '../_shared/canais/conexao.ts';
import { processarColetaOrg } from './processar.ts';

interface ConexaoRow {
  id: string; org_id: string; canal: string;
  conta_externa_id: string | null; expires_at: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  const admin = adminClient();

  const temAssinatura = !!req.headers.get('upstash-signature');
  let scopedOrgId: string | null = null;
  if (temAssinatura) {
    if (!(await verificarAssinatura(req, body))) {
      return new Response('Invalid signature', { status: 401, headers: corsHeaders });
    }
  } else {
    try { ({ orgId: scopedOrgId } = await requireUserOrg(req, { access: 'write' })); }
    catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  }

  let payload: { tier?: 'completo' | 'quente' } = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { /* body vazio/QStash */ }

  const tier: 'completo' | 'quente' = scopedOrgId ? 'completo' : (payload.tier === 'quente' ? 'quente' : 'completo');
  const maxProdutos = scopedOrgId ? 50 : (tier === 'quente' ? 100 : 200);

  let query = admin.from('marketplace_connections')
    .select('id, org_id, canal, conta_externa_id, expires_at').eq('canal', 'mercado_livre');
  if (scopedOrgId) query = query.eq('org_id', scopedOrgId);
  const { data: conexoesRaw } = await query;

  // Teto de tempo: o worker morre com WORKER_RESOURCE_LIMIT/IDLE_TIMEOUT perto dos 150s (já
  // aconteceu com reconciliar-faturamento). As orgs que não couberem entram no próximo ciclo —
  // a seleção ordena por `ultimo_snapshot_em asc`, então a rotação é justa por construção.
  const LIMITE_MS = 100_000;
  const inicio = Date.now();

  let produtos = 0, gravadas = 0, alertas = 0;
  for (const row of (conexoesRaw ?? []) as ConexaoRow[]) {
    if (Date.now() - inicio > LIMITE_MS) {
      console.warn('pulse-coletar: teto de tempo atingido, orgs restantes ficam para o próximo ciclo');
      break;
    }
    const conexao = mapearConexao(row);
    if (!conexao) continue;
    try {
      // baseline = varredura agendada completa (a da madrugada). `tier === 'completo'` sozinho não
      // basta: o botão "Atualizar agora" do operador também roda completo, e os passos de janela
      // longa (visitas 30d) não podem disparar a cada clique.
      const baseline = !scopedOrgId && tier === 'completo';
      const r = await processarColetaOrg(admin, conexao, row.org_id, tier, maxProdutos, baseline);
      produtos += r.produtos; gravadas += r.gravadas; alertas += r.alertas;
    } catch (e) {
      // Uma org falhar (sem credencial, ML fora do ar) nunca derruba as outras.
      console.warn(`pulse-coletar: falhou para org ${row.org_id}:`, e instanceof Error ? e.message : e);
    }
  }

  return new Response(JSON.stringify({ ok: true, produtos, gravadas, alertas }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
