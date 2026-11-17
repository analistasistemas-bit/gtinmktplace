// Foto diária + Resumo de reposição (ADR-0207 §17–§18). Consome QStash: o schedule `30 11 * * *`
// (08:30 BRT) chega sem body → publica um job por org com módulo `reposicao`; { orgId, dia } → grava a
// foto do dia (upsert idempotente) e notifica `reposicao` com chave `reposicao:<org>:<dia>`.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { qstashClient, verificarAssinatura } from '../_shared/queue.ts';
import { enfileirarEmBlocos } from '../_shared/enfileirar-em-blocos.ts';
import { paginarTudo } from '../_shared/pagina.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { diaBrt } from '../_shared/notificacoes/gerencial/janelas.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { calcularReposicao } from '../_shared/reposicao/calculo.ts';
import { lerDados } from '../_shared/reposicao/dados.ts';
import { deveProcessar, gravarFoto, lerFotoAnterior, montarResumo } from '../_shared/reposicao/resumo.ts';

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  let job: { orgId?: string; dia?: string };
  try { job = body.trim() ? JSON.parse(body) : {}; } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  if (job.orgId && !/^\d{4}-\d{2}-\d{2}$/.test(job.dia ?? '')) {
    return new Response('dia obrigatório (YYYY-MM-DD)', { status: 400, headers: corsHeaders });
  }

  try {
    const admin = adminClient();
    if (!job.orgId) {
      const dia = diaBrt(new Date());
      const orgs = (await paginarTudo<{ id: string }>((de, ate) => admin.from('organizations').select('id')
        .contains('modulos_habilitados', ['reposicao']).order('id').range(de, ate))).map((o) => o.id);
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/reposicao-diaria`;
      await enfileirarEmBlocos(orgs, (orgId) => ({
        url, body: { orgId, dia }, retries: 3, deduplicationId: `reposicao-diaria-${orgId}-${dia}`,
      }), (msgs) => qstashClient().batchJSON(msgs));
      return json({ ok: true, publicados: orgs.length });
    }

    const { orgId, dia } = job as { orgId: string; dia: string };
    if (!deveProcessar(dia, diaBrt(new Date()))) return json({ ok: true, ignorado: 'dia passado' });
    if (!(await exigirModulo(admin, orgId, 'reposicao'))) return json({ ok: true, ignorado: 'sem módulo' });
    const d = await lerDados(admin, orgId, dia);
    if ('semConfig' in d) return json({ ok: true, ignorado: 'sem configuração' });
    const resultado = calcularReposicao(d.entrada);
    const anterior = await lerFotoAnterior(admin, orgId, dia);
    await gravarFoto(admin, orgId, dia, resultado);
    const texto = montarResumo(
      resultado.skus, anterior, d.pedidos.filter((p) => p.atrasado),
      d.pedidos.filter((p) => p.status === 'rascunho').length, d,
    );
    const enviados = texto
      ? await notificarCategoria(admin, orgId, 'reposicao', texto, { chave: `reposicao:${orgId}:${dia}` })
      : 0;
    return json({ ok: true, fotos: resultado.skus.length, resumo: texto != null, enviados });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'reposicao-diaria', orgId: job.orgId, dia: job.dia, erro: (e as Error).message }));
    return json({ ok: false, erro: (e as Error).message }, 500);
  }
});
