import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { redisGet, redisSet } from '../_shared/redis/client.ts';
import { apifyConfigurado, buscarAnunciosML } from '../_shared/apify/client.ts';
import { adminClient } from '../_shared/supabase.ts';
import { normalizeSonarQuery, sonarQueryType } from '../_shared/pulse/sonar-metering.ts';
import { montarPainelVendas, parseItensApify, parseTotalAnuncios, linhasSnapshot, type ItemVendas } from '../_shared/pulse/sonar-vendas.ts';

const CACHE_TTL_S = 7 * 24 * 60 * 60;
const SCHEMA_VERSION = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function gravarSnapshots(termo: string, geradoEm: string, itens: ItemVendas[]): Promise<boolean> {
  const linhas = linhasSnapshot(termo, geradoEm, itens);
  if (linhas.length === 0) return false;
  try {
    const { error } = await adminClient().from('sonar_snapshots')
      .upsert(linhas, { onConflict: 'termo,item_id,gerado_em', ignoreDuplicates: true });
    if (error) {
      console.error(`[sonar-snapshots] insert falhou para "${termo}": ${error.message}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[sonar-snapshots] insert lançou:', error instanceof Error ? error.message : error);
    return false;
  }
}

type Context = Awaited<ReturnType<typeof requireUserOrg>>;
type Ledger = { acao: 'collect' | 'pending' | 'ready' | 'failed'; busca_id: string; resultado_id: string; lease_token?: string; payload?: Record<string, unknown>; consumo?: Record<string, unknown> };

function rpcArgs(context: Context) {
  return { p_actor: context.userId, p_org_id: context.orgId, p_support_request: context.support?.requestId ?? null };
}

async function ledgerRpc(name: string, args: Record<string, unknown>): Promise<Ledger> {
  const { data, error } = await adminClient().rpc(name, args);
  if (error || !data) throw new Error(error?.message ?? `ledger ${name} indisponível`);
  return data as Ledger;
}

function resposta(ledger: Ledger, historicoGravado = false): Response {
  return json({ ...(ledger.payload ?? {}), busca_id: ledger.busca_id, resultado_id: ledger.resultado_id,
    consumo: ledger.consumo ?? null, historico_gravado: historicoGravado });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let context: Context;
  try { context = await requireUserOrg(req, { access: 'read' }); }
  catch (response) { if (response instanceof Response) return response; throw response; }

  let body: { termo?: string; request_id?: string; resultado_id?: string };
  try { body = await req.json(); } catch { return json({ erro: 'JSON inválido' }, 400); }
  if (!UUID.test(body.request_id ?? '')) return json({ erro: 'request_id UUID obrigatório' }, 400);
  if (body.resultado_id != null && !UUID.test(body.resultado_id)) return json({ erro: 'resultado_id inválido' }, 400);
  const normalizado = normalizeSonarQuery(body.termo ?? '');
  if (!body.resultado_id && normalizado.length < 3) return json({ erro: 'termo obrigatório (mínimo 3 caracteres)' }, 400);
  const queryType = sonarQueryType(normalizado);

  let begin: Ledger;
  try {
    begin = await ledgerRpc('platform_sonar_begin', {
      ...rpcArgs(context), p_request_id: body.request_id, p_query: normalizado, p_query_type: queryType,
      p_schema_version: SCHEMA_VERSION, p_reopen_result: body.resultado_id ?? null,
    });
  } catch (error) {
    return json({ erro: error instanceof Error ? error.message : 'Ledger Sonar indisponível' }, 409);
  }

  if (begin.acao === 'pending') {
    return json({ pendente: true, busca_id: begin.busca_id, resultado_id: begin.resultado_id }, 202);
  }
  if (begin.acao === 'failed') {
    return json({ erro: 'A consulta anterior falhou. Envie uma nova busca para tentar novamente.',
      busca_id: begin.busca_id, resultado_id: begin.resultado_id }, 502);
  }
  if (begin.acao === 'ready') {
    try {
      const resolved = await ledgerRpc('platform_sonar_resolve_result', { ...rpcArgs(context), p_search_id: begin.busca_id });
      return resposta(resolved);
    } catch (error) {
      return json({ erro: error instanceof Error ? error.message : 'Falha ao registrar entrega' }, 503);
    }
  }

  const complete = async (payload: Record<string, unknown> | null, failure: string | null): Promise<Ledger> =>
    ledgerRpc('platform_sonar_complete', { ...rpcArgs(context), p_search_id: begin.busca_id,
      p_lease_token: begin.lease_token, p_payload: payload, p_failure_reason: failure });

  if (!apifyConfigurado()) {
    try { await complete(null, 'fornecedor_nao_configurado'); } catch { /* ledger already refused delivery */ }
    return json({ configurado: false, busca_id: begin.busca_id, resultado_id: begin.resultado_id });
  }

  const chave = `sonar:vendas:v4:MLB:${normalizado}`;
  const cacheado = await redisGet(chave).catch(() => null);
  if (cacheado) {
    try {
      const payload = JSON.parse(cacheado) as Record<string, unknown>;
      const itensCache = Array.isArray(payload.itens) ? payload.itens : Object.values((payload.por_anuncio as Record<string, unknown> | undefined) ?? {});
      if (itensCache.length === 0) {
        await complete(null, 'resultado_vazio');
        return json({ erro: 'A consulta não encontrou anúncios disponíveis.' }, 422);
      }
      return resposta(await complete(payload, null));
    } catch (error) {
      return json({ erro: error instanceof Error ? error.message : 'Falha ao publicar cache' }, 503);
    }
  }

  const itens = await buscarAnunciosML(normalizado);
  if (itens === null) {
    try { await complete(null, 'fornecedor_indisponivel'); } catch { /* retorno continua indisponível */ }
    return json({ erro: 'Consulta de vendas falhou ou demorou demais. Tente de novo em instantes.' }, 502);
  }

  const parseados = parseItensApify(itens);
  if (parseados.length === 0) {
    try { await complete(null, 'resultado_vazio'); } catch { /* entrega continua recusada */ }
    return json({ erro: 'A consulta não encontrou anúncios disponíveis.' }, 422);
  }
  const payload = { configurado: true as const,
    ...montarPainelVendas(normalizado, parseados, parseTotalAnuncios(itens)) };
  let completed: Ledger;
  try { completed = await complete(payload, null); }
  catch (error) { return json({ erro: error instanceof Error ? error.message : 'Falha ao publicar resultado' }, 503); }

  const historicoGravado = await gravarSnapshots(payload.termo, payload.gerado_em, parseados);
  await redisSet(chave, JSON.stringify(payload), CACHE_TTL_S).catch(() => {});
  return resposta(completed, historicoGravado);
});
