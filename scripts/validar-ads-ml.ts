// Fatia 2c, T7 — valida o worker de Ads contra o ML REAL, só com GET, gravando no Postgres LOCAL.
// Uso:
//   eval "$(supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"
//   deno run -A scripts/validar-ads-ml.ts <connection_id_ml> <org_id_local>
// - Token lido em memória via public.get_connection_tokens (Management API, SQL só leitura). NUNCA impresso,
//   NUNCA renovado: vencido → aborta sem chamar o ML.
// - API_URL tem que ser local (127.0.0.1/localhost): o script recusa gravar fora do Postgres local.
// - Valores em R$ saem SÓ neste terminal local; nunca copiar para arquivo versionado (repo público).
// - Saída 2 = ponto de PARADA (filtro de status esconde grupos ou /ads encolhe na janela curta), antes de gravar.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { depsAds } from '../supabase/functions/coletar-ads-ml/deps.ts';
import { sincronizarAdsOrg, type MsgAds } from '../supabase/functions/_shared/ads/sincronizar.ts';
import { HEADERS_ADS, HEADERS_ADVERTISER, ML_API, urlAdvertiser, urlBuscaGrupos, urlMembros, STATUS_GRUPOS } from '../supabase/functions/_shared/ads/fiacao.ts';
import { janelaAds } from '../supabase/functions/_shared/ads/janelas.ts';
import { parseAdvertiser, parseBuscaGrupos, parseMembros } from '../supabase/functions/_shared/ads/parsers.ts';
import { buscarML } from '../supabase/functions/_shared/trafego/fiacao.ts';
import { diaDeHoje } from '../supabase/functions/_shared/trafego/janelas.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const [cx, org] = Deno.args;
if (!UUID.test(cx ?? '') || !UUID.test(org ?? '')) throw new Error('uso: <connection_id_ml> <org_id_local>');
const apiUrl = Deno.env.get('API_URL') ?? '';
const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') ?? '';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(apiUrl) || !serviceKey) throw new Error('API_URL local e SERVICE_ROLE_KEY obrigatórios');

async function envLocal(nome: string): Promise<string> {
  const v = Deno.env.get(nome);
  if (v) return v;
  const linha = (await Deno.readTextFile('.env.local')).split('\n').find((l) => l.startsWith(`${nome}=`));
  if (!linha) throw new Error(`${nome} ausente`);
  return linha.slice(nome.length + 1).trim().replace(/^"|"$/g, '');
}

async function lerToken(): Promise<string> {
  const pat = await envLocal('SUPABASE_ACCESS_TOKEN');
  const r = await fetch('https://api.supabase.com/v1/projects/txvncrgkoynoxwopfkbp/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `select access_token, expires_at from public.get_connection_tokens('${cx}'::uuid)` }),
  });
  if (!r.ok) throw new Error(`Management API HTTP ${r.status}`);
  const [linha] = await r.json() as { access_token: string; expires_at: string }[];
  if (!linha || Date.parse(linha.expires_at) <= Date.now() + 5 * 60_000) throw new Error('BLOCKED: token vencido ou a vencer; não renovar fora do app');
  console.log(`token ok (expira ${linha.expires_at})`);
  return linha.access_token;
}

const token = await lerToken();
const admin = createClient(apiUrl, serviceKey, { auth: { persistSession: false } });

// Conferência do filtro de status (R4): o total com filters[status] tem que bater com o total sem filtro.
const hoje = diaDeHoje(new Date(), 'brt');
const janela = janelaAds({ hoje, cargaInicialOk: false, ultimoOkDia: null });
const adv = parseAdvertiser((await buscarML(`${ML_API}${urlAdvertiser()}`, token, fetch, HEADERS_ADVERTISER)).corpo);
if (adv == null) throw new Error('sem anunciante MLB');
const comFiltro = parseBuscaGrupos((await buscarML(`${ML_API}${urlBuscaGrupos(adv, janela, 0)}`, token, fetch, HEADERS_ADS)).corpo);
const semFiltroUrl = urlBuscaGrupos(adv, janela, 0).replace(`&filters[status]=${STATUS_GRUPOS}`, '');
const semFiltro = parseBuscaGrupos((await buscarML(`${ML_API}${semFiltroUrl}`, token, fetch, HEADERS_ADS)).corpo);
console.log('grupos listados', { comFiltro: comFiltro?.total, semFiltro: semFiltro?.total, resumoCusto: comFiltro?.custoResumo });
let parar = comFiltro?.total == null || comFiltro.total !== semFiltro?.total;

// Membros: o worker sempre lê /ads na janela de 90 dias; aqui se confere se o ML encolhe a lista na janela curta.
const familias = (comFiltro?.grupos ?? []).filter((g) => g.tipo === 'FAMILY' && g.cost > 0).slice(0, 3);
for (const g of familias) {
  const t90 = parseMembros((await buscarML(`${ML_API}${urlMembros(g.ad_group_id, janela, 0)}`, token, fetch, HEADERS_ADS)).corpo)?.total;
  const t1 = parseMembros((await buscarML(`${ML_API}${urlMembros(g.ad_group_id, { desde: janela.ate, ate: janela.ate }, 0)}`, token, fetch, HEADERS_ADS)).corpo)?.total;
  console.log('membros', { grupo: g.ad_group_id, janela90: t90, dia1: t1 });
  if (t90 == null || t1 == null || t1 < t90) parar = true;
}
if (parar) { console.error('PARADA: ponto de parada do brief (ver acima); nada gravado'); Deno.exit(2); }

/** Grupos com vínculo gravado (os sem nenhum MLB conhecido saem do custoListado — Ruling 2c-7). */
async function gruposComVinculo(): Promise<Set<number>> {
  const ids = new Set<number>();
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin.from('ml_ads_grupo_item').select('ad_group_id').eq('org_id', org)
      .order('ad_group_id').order('ml_item_id').range(de, de + 999);
    if (error) throw new Error(error.message);
    for (const l of data ?? []) ids.add(Number(l.ad_group_id));
    if ((data ?? []).length < 1000) return ids;
  }
}

/** Σ cost gravado no Postgres local em [desde, ate], opcionalmente só dos grupos em `so` (paginado; só leitura). */
async function somaCusto(desde: string, ate: string, so?: Set<number>): Promise<number> {
  let total = 0;
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin.from('ml_ads_grupo_dia').select('ad_group_id, cost').eq('org_id', org)
      .gte('dia', desde).lte('dia', ate).order('ad_group_id').order('dia').range(de, de + 999);
    if (error) throw new Error(error.message);
    for (const l of data ?? []) if (!so || so.has(Number(l.ad_group_id))) total += Number(l.cost);
    if ((data ?? []).length < 1000) return Math.round(total * 100) / 100;
  }
}

/** Cadeia inteira localmente, como o QStash faria: cada continuação (com `falhou`/`descontar`) vai para uma
 *  fila em memória e é reexecutada depois do atraso pedido. */
async function rodar(n: number): Promise<void> {
  const fila: { msg: MsgAds; atrasoMs?: number }[] = [{ msg: { org_id: org, primeira: true } }];
  const deps = {
    ...depsAds(admin, org, async () => token),
    continuar: async (msg: MsgAds, o: { atrasoMs?: number }) => { fila.push({ msg, atrasoMs: o.atrasoMs }); },
  };
  while (fila.length) {
    const { msg, atrasoMs } = fila.shift()!;
    if (atrasoMs) await new Promise((r) => setTimeout(r, atrasoMs));
    const r = await sincronizarAdsOrg(deps, msg);
    console.log(`run ${n}`, r, { cursor: msg.cursor ?? null, falhou: msg.falhou ?? false });
    if (r.resultado === 'erro' || r.resultado === 'sem_acesso') {
      const { data } = await admin.from('ml_ads_sync').select('estado, erro').eq('org_id', org).maybeSingle();
      console.error(`FALHA: run ${n} terminou em ${r.resultado}`, data);
      Deno.exit(1);
    }
  }
}

// Run 1 = carga inicial de 90 dias. Prova: Σ gravado dos grupos com vínculo = custoListado do sync.
await rodar(1);
const { data: sync, error: eSync } = await admin.from('ml_ads_sync')
  .select('estado, carga_inicial_ok, cobertura_desde, custo_resumo, custo_listado').eq('org_id', org).single();
if (eSync || !sync) throw new Error(`ml_ads_sync: ${eSync?.message ?? 'sem linha'}`);
const somaCarga = await somaCusto(janela.desde, janela.ate, await gruposComVinculo());
const somaTudo = await somaCusto(janela.desde, janela.ate);
const resumo = Number(sync.custo_resumo); const listado = Number(sync.custo_listado);
console.log('run 1 (R$ só neste terminal)', {
  estado: sync.estado, cargaInicialOk: sync.carga_inicial_ok, coberturaDesde: sync.cobertura_desde,
  custoResumo: resumo, custoListado: listado, somaCarga,
  foraDosGruposPct: resumo > 0 ? `${(((resumo - listado) / resumo) * 100).toFixed(2)} %` : 'n/a',
  semVinculoPct: somaTudo > 0 ? `${(((somaTudo - somaCarga) / somaTudo) * 100).toFixed(2)} %` : 'n/a',
});
if (Math.abs(somaCarga - listado) > 0.01) {
  console.error('FALHA: Σ gravado na carga ≠ custoListado do search', { somaCarga, custoListado: listado });
  Deno.exit(1);
}

// Run 2 = rodada diária (15 dias). Dias com mais de 15 dias (dia < hoje−15) não podem mudar.
const limiteAntigo = new Date(Date.parse(`${janelaAds({ hoje, cargaInicialOk: true, ultimoOkDia: null }).desde}T00:00:00Z`) - 86_400_000)
  .toISOString().slice(0, 10);
const antigosAntes = await somaCusto(janela.desde, limiteAntigo);
await rodar(2);
const antigosDepois = await somaCusto(janela.desde, limiteAntigo);
console.log('run 2', { diasAte: limiteAntigo, antigosAntes, antigosDepois });
if (Math.abs(antigosDepois - antigosAntes) > 0.005) {
  console.error('FALHA: o 2º run mudou dias com mais de 15 dias');
  Deno.exit(1);
}
console.log('OK: carga = custoListado; 2º run não mexeu nos dias antigos');
