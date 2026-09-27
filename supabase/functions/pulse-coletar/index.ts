// Pulse (ADR-0119): coletor server-side, dual-mode (mesmo padrão de monitorar-moderados).
//  - QStash (agendado): assinatura válida → todas as conexões ML, tier do body.
//  - Usuário logado (botão "Atualizar agora"): JWT válido → só a própria org, tier completo.
// ADR-0173: atrás de FANOUT_PULSE, o agendado vira rodada por org (radar → produtos, em lotes,
// retomável pelo cursor) — cada mensagem cabe no orçamento de CPU da edge function. Sem a flag,
// o laço legado abaixo (todas as orgs numa execução só) continua rodando sem mudança nenhuma.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { mapearConexao } from '../_shared/canais/conexao.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { classificarErroML, MLApiError } from '../_shared/ml/erro-ml.ts';
import { registrarFalhaAuth } from '../_shared/ml/liveness.ts';
import {
  SemAcessoRodada, cicloDiaBrt, cicloHoraUtc, executarMensagem, rotear, statusHttp, type Job, type MsgOrg,
} from '../_shared/rodada/rodada.ts';
import { depsRodada, fanoutAtivo, publicarDisparo } from '../_shared/rodada/deps.ts';
import {
  prepararContexto, processarColetaOrg, processarLoteProdutos, notificarRodadaPulse, sincronizarRadar,
  type ProdutoColeta,
} from './processar.ts';
import { chaveNotificacaoPulse, passoPulse, precisaNotificarPulse, type DepsPulse, type ParamsPulse } from './passo.ts';

const FN = 'pulse-coletar';

interface ConexaoRow {
  id: string; org_id: string; canal: string;
  conta_externa_id: string | null; expires_at: string | null;
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// ─── ADR-0173: rodada por org (radar → produtos) ────────────────────────────────────────────────

function depsPulseReal(admin: ReturnType<typeof adminClient>, orgId: string): DepsPulse {
  return {
    async conexao() {
      // Consulta própria (não resolverConexao): erro de leitura LANÇA — virar `null` fecharia a
      // rodada como sem_acesso e a org some do Pulse por causa de uma falha transitória de banco.
      const { data, error } = await admin.from('marketplace_connections')
        .select('id, org_id, canal, conta_externa_id, expires_at')
        .eq('org_id', orgId).eq('canal', 'mercado_livre').maybeSingle();
      if (error) throw new Error(`pulse: ler conexão ML da org: ${error.message}`);
      return mapearConexao((data ?? null) as ConexaoRow | null);
    },

    async contexto(cx) {
      try {
        return await prepararContexto(cx, orgId);
      } catch (e) {
        // Só token morto fecha a rodada (sem_acesso); transiente relança → 500 → retry do QStash.
        const status = e instanceof MLApiError ? e.status : null;
        const oauthError = e instanceof MLApiError ? e.oauthError : null;
        if (classificarErroML(status, oauthError) === 'permanente-auth') {
          await registrarFalhaAuth(admin, cx.id, (e as Error).message);
          throw new SemAcessoRodada((e as Error).message);
        }
        throw e;
      }
    },

    sincronizarRadar: () => sincronizarRadar(admin, orgId),

    async produtos(depoisDe, limite, tier) {
      let q = admin.from('pulse_produtos')
        .select('id, catalog_product_id, codigo_pai, origem, titulo, coleta_falhas_seguidas, coleta_tentativa_em')
        .eq('org_id', orgId).eq('status', 'ativo')
        .order('id', { ascending: true }).limit(limite);
      if (depoisDe) q = q.gt('id', depoisDe);
      if (tier === 'quente') q = q.eq('origem', 'auto');
      const { data, error } = await q;
      if (error) throw new Error(`pulse: ler produtos da org ${orgId}: ${error.message}`);
      return (data ?? []) as ProdutoColeta[];
    },

    processarLote: (ctx, produtos, tier, baseline) => processarLoteProdutos(admin, orgId, ctx, produtos, tier, baseline),

    agora: () => Date.now(),
  };
}

const JOBS_PULSE = new Set(['pulse-completo', 'pulse-quente']);

async function consumirMensagemOrg(admin: ReturnType<typeof adminClient>, msg: MsgOrg): Promise<Response> {
  const p = msg.params as Partial<ParamsPulse>;
  if (!JOBS_PULSE.has(msg.job) || (p.tier !== 'completo' && p.tier !== 'quente')) {
    console.error(`pulse: mensagem por org de job/params inválidos, descartada: job=${msg.job} org=${msg.org_id}`);
    return json({ ok: false, erro: 'job ou params inválidos para o pulse' }, 400);
  }
  const m = msg as MsgOrg<ParamsPulse>;
  try {
    const r = await executarMensagem(depsRodada(admin, FN), m, passoPulse(depsPulseReal(admin, m.org_id)), {
      precisaNotificar: precisaNotificarPulse,
      notificar: (a, ciclo) => notificarRodadaPulse(admin, m.org_id, {
        alertas: a.alertas ?? 0, acao: a.acao ?? 0, naoClassificavel: (a.naoClassificavel ?? 0) === 1,
      }, chaveNotificacaoPulse(m.job, m.org_id, ciclo)),
    });
    return json({ resultado: r }, statusHttp(r));
  } catch (e) {
    console.error(`pulse: mensagem por org falhou (job=${m.job} org=${m.org_id} ciclo=${m.ciclo}):`, e instanceof Error ? e.message : e);
    return json({ ok: false, erro: 'falha interna' }, 500);
  }
}

async function disparar(admin: ReturnType<typeof adminClient>, payload: { tier?: 'completo' | 'quente' }): Promise<Response> {
  const tier: 'completo' | 'quente' = payload.tier === 'quente' ? 'quente' : 'completo';
  const job: Job = tier === 'completo' ? 'pulse-completo' : 'pulse-quente';
  const ciclo = tier === 'completo' ? cicloDiaBrt(new Date()) : cicloHoraUtc(new Date());

  const { data: conexoesRaw, error: errConexoes } = await admin.from('marketplace_connections')
    .select('org_id').eq('canal', 'mercado_livre');
  if (errConexoes) {
    console.error(`pulse: disparo não leu as conexões: ${errConexoes.message}`);
    return json({ ok: false, erro: 'falha ao ler conexões' }, 500);
  }
  const orgsConectadas = [...new Set(((conexoesRaw ?? []) as Array<{ org_id: string }>).map((r) => r.org_id))];

  // Só orgs com o módulo Pulse habilitado entram no fan-out — as demais nem geram mensagem.
  let comModulo = new Set<string>();
  if (orgsConectadas.length > 0) {
    const { data: orgsRaw, error: errOrgs } = await admin.from('organizations')
      .select('id, modulos_habilitados').in('id', orgsConectadas);
    if (errOrgs) {
      console.error(`pulse: disparo não leu os módulos das orgs: ${errOrgs.message}`);
      return json({ ok: false, erro: 'falha ao ler módulos das orgs' }, 500);
    }
    comModulo = new Set(
      ((orgsRaw ?? []) as Array<{ id: string; modulos_habilitados: string[] | null }>)
        .filter((o) => (o.modulos_habilitados ?? []).includes('pulse'))
        .map((o) => o.id),
    );
  }
  const orgs = orgsConectadas.filter((id) => comModulo.has(id));
  const foraPorModulo = orgsConectadas.length - orgs.length;

  try {
    await publicarDisparo(FN, orgs.map((org_id) => ({ modo: 'org' as const, job, org_id, ciclo, params: { tier } })));
  } catch (e) {
    console.error(`pulse: disparo job=${job} ciclo=${ciclo} falhou ao publicar:`, e instanceof Error ? e.message : e);
    return json({ ok: false, erro: 'falha ao publicar o disparo' }, 500);
  }
  console.log(`pulse: disparo job=${job} ciclo=${ciclo} publicadas=${orgs.length} fora_por_modulo=${foraPorModulo}`);
  return json({ ok: true, job, ciclo, orgs: orgs.length });
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
    if (!(await exigirModulo(admin, scopedOrgId, 'pulse'))) {
      return new Response(JSON.stringify({ erro: 'Módulo Pulse não habilitado para esta organização.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  let payload: { tier?: 'completo' | 'quente' } = {};
  let parsed: unknown = {};
  try {
    parsed = body ? JSON.parse(body) : {};
    if (parsed && typeof parsed === 'object') payload = parsed as { tier?: 'completo' | 'quente' };
  } catch { /* body vazio/QStash */ }

  // ADR-0173: mensagem por org (sempre aceita) e disparador em fan-out (só com FANOUT_PULSE). Sem a
  // flag o schedule segue no laço legado abaixo; o manual (JWT) nunca passa por aqui (sem assinatura).
  const rota = rotear(temAssinatura, parsed, fanoutAtivo('FANOUT_PULSE'));
  if (rota === 'invalida') {
    console.error(`pulse: mensagem modo:'org' malformada, descartada: ${body.slice(0, 500)}`);
    return json({ ok: false, erro: 'mensagem por org malformada' }, 400);
  }
  if (rota === 'org') return await consumirMensagemOrg(admin, parsed as MsgOrg);
  if (rota === 'disparo') return await disparar(admin, payload);

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
