// Perf FASE 3.4 (ADR-0159, plano docs/superpowers/plans/2026-09-07-perf-central-organizacoes.md).
// Pré-aquecimento de `platform_org_month_metrics`: para cada organização, materializa os últimos 6
// meses fechados que estiverem ausentes ou inválidos (mesma validação do read-through de
// `readOrgMetrics`). Disparada por QStash Schedule (diária, 03:00 BRT — schedule fica fora do
// repo, como as demais: docs/reference/edge-functions.md).
//
// Sem este job o sistema CONTINUA CORRETO: o read-through materializa na hora, sob demanda. O job
// só evita que o primeiro operador a abrir um mês recém-fechado pague o cálculo ao vivo — é por
// isso que uma falha aqui nunca derruba a resposta (cada organização segue independente das outras,
// e cada mês segue independente dos outros dentro de `materializeRecentMonths`).
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { materializeRecentMonths } from '../_shared/platform-admin/metrics-repository.ts';

// Mesmo grau de paralelismo de organizações usado na carteira (repository.ts `wallet`, ADR-0158 §3)
// — nenhuma chamada externa aqui (só Postgres), mas mantém o limite para não abrir uma conexão por
// organização de uma vez só numa carteira com muitas organizações.
const PARALELAS = 4;

async function mapLimit<T>(values: T[], limit: number, fn: (value: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= values.length) return;
      await fn(values[index]);
    }
  }));
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  const admin = adminClient();
  const now = new Date();
  const { data: organizations, error } = await admin.from('organizations').select('id');
  if (error) {
    console.error('materializar-metricas: falha ao listar organizações:', error.message);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const resumo: Record<string, { materialized: string[]; skipped: string[] }> = {};
  await mapLimit((organizations ?? []) as { id: string }[], PARALELAS, async (org) => {
    try {
      resumo[org.id] = await materializeRecentMonths(admin as never, org.id, now);
    } catch (err) {
      console.error(`materializar-metricas: falhou para org ${org.id}:`, err instanceof Error ? err.message : err);
      resumo[org.id] = { materialized: [], skipped: ['erro'] };
    }
  });

  const materializados = Object.values(resumo).reduce((total, row) => total + row.materialized.length, 0);
  return new Response(JSON.stringify({ ok: true, organizacoes: (organizations ?? []).length, materializados, resumo }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
