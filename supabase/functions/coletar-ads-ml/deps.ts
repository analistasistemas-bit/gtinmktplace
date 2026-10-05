// Fiação real do worker de Ads (Vendas SKU Fatia 2c). Só ligação: a regra vive em _shared/ads/*.ts
// (vitest). No ML só GET; o único POST é o refresh OAuth de _shared/ml/token.ts. Gravação só pelas RPCs
// de 20260927124602_vendas_sku_ads.sql. O token nunca é logado.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { qstashClient } from '../_shared/queue.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { paginarTudo } from '../_shared/pagina.ts';
import { diaDeHoje } from '../_shared/trafego/janelas.ts';
import { buscarML, corteRetencao, delaySegundos } from '../_shared/trafego/fiacao.ts';
import {
  HEADERS_ADS, HEADERS_ADVERTISER, ML_API, dedupContinuacaoAds, dedupFanoutAds, getComReautenticacao,
  urlAdvertiser, urlBuscaGrupos, urlMembros, urlSerieConta, urlSerieGrupo,
} from '../_shared/ads/fiacao.ts';
import { ParadaAds, type DepsAds, type GrupoConhecido } from '../_shared/ads/sincronizar.ts';

const urlWorker = () => `${Deno.env.get('SUPABASE_URL')}/functions/v1/coletar-ads-ml`;
const falhouRpc = (onde: string, e: { message: string } | null) => { if (e) throw new Error(`${onde}: ${e.message}`); };

/** Uma mensagem `primeira` por org com conexão ML (dedup org+dia BRT, prefixo ads:). */
export async function publicarFanout(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin.from('marketplace_connections')
    .select('org_id').eq('canal', 'mercado_livre').not('conta_externa_id', 'is', null);
  falhouRpc('conexões ML', error);
  const orgs = [...new Set((data ?? []).map((r) => r.org_id as string))];
  const dia = diaDeHoje(new Date(), 'brt');
  for (const org of orgs) {
    await qstashClient().publishJSON({
      url: urlWorker(), body: { org_id: org, primeira: true }, retries: 1, deduplicationId: dedupFanoutAds(org, dia),
    });
  }
  return orgs.length;
}

/** Retenção de 13 meses (um delete por tabela; ~1 dia de linhas por execução). */
export async function limparRetencao(admin: SupabaseClient): Promise<void> {
  const { error } = await admin.rpc('limpar_ads_retencao', { p_corte: corteRetencao(new Date()) });
  falhouRpc('limpar_ads_retencao', error);
}

/**
 * `tokenFixo` só para a validação local (T7), que lê o token em memória e nunca renova. Em produção o
 * token vem de getValidAccessTokenConexao (única rota de refresh).
 */
export function depsAds(admin: SupabaseClient, orgId: string, tokenFixo?: () => Promise<string>): DepsAds {
  let token: Promise<string> | null = null;
  const tokenML = tokenFixo ?? (() => token ??= (async () => {
    const cx = await resolverConexao(admin, orgId, 'mercado_livre');
    if (!cx?.contaExternaId) throw new ParadaAds('sem_acesso', 'Organização sem conexão com o Mercado Livre.');
    return getValidAccessTokenConexao(cx);
  })());
  // 401 → descarta o token em memória e pede de novo a getValidAccessTokenConexao, uma vez.
  const get = (caminho: string, headers: Record<string, string>) =>
    getComReautenticacao(tokenML, () => { token = null; }, (t) => buscarML(`${ML_API}${caminho}`, t, fetch, headers));
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    falhouRpc(fn, error);
    return data;
  };

  return {
    agora: () => Date.now(),
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),

    async reservarPosse() {
      const linhas = await rpc('reservar_ads_posse', { p_org: orgId }) as { rodada: string; cursor: string | null }[] | null;
      return linhas?.[0] ?? null;
    },
    avancarCursor: async (rodada, atual, novo) =>
      (await rpc('avancar_ads_cursor', { p_org: orgId, p_rodada: rodada, p_cursor_atual: atual, p_cursor_novo: novo })) === true,

    async lerEstadoSync() {
      const { data, error } = await admin.from('ml_ads_sync')
        .select('carga_inicial_ok, ultimo_ok_em, conta_cobertura_desde').eq('org_id', orgId).maybeSingle();
      falhouRpc('lerEstadoSync', error);
      return {
        cargaInicialOk: data?.carga_inicial_ok === true,
        ultimoOkEm: (data?.ultimo_ok_em as string | null | undefined) ?? null,
        contaCoberturaDesde: (data?.conta_cobertura_desde as string | null | undefined) ?? null,
      };
    },

    async lerGruposComGasto(desde, ate) {
      const dias = await paginarTudo<{ ad_group_id: number }>((de, fim) => admin.from('ml_ads_grupo_dia')
        .select('ad_group_id').eq('org_id', orgId).gte('dia', desde).lte('dia', ate).gt('cost', 0)
        .order('ad_group_id').order('dia').range(de, fim));
      const ids = [...new Set(dias.map((d) => d.ad_group_id))];
      if (!ids.length) return [];
      const { data, error } = await admin.from('ml_ads_grupo')
        .select('ad_group_id, tipo, external_id, campaign_id, status').eq('org_id', orgId).in('ad_group_id', ids);
      falhouRpc('lerGruposComGasto', error);
      return (data ?? []) as GrupoConhecido[];
    },

    async contarVinculos(ids) {
      // ≤ 20 grupos por lote × dezenas de MLBs: bem abaixo do teto de 1.000 linhas do PostgREST.
      const { data, error } = await admin.from('ml_ads_grupo_item').select('ad_group_id')
        .eq('org_id', orgId).in('ad_group_id', ids);
      falhouRpc('contarVinculos', error);
      const n = new Map<number, number>();
      for (const l of data ?? []) n.set(l.ad_group_id as number, (n.get(l.ad_group_id as number) ?? 0) + 1);
      return n;
    },

    buscarAdvertiser: () => get(urlAdvertiser(), HEADERS_ADVERTISER),
    buscarGrupos: (adv, j, offset) => get(urlBuscaGrupos(adv, j, offset), HEADERS_ADS),
    buscarSerieGrupo: (id, j) => get(urlSerieGrupo(id, j), HEADERS_ADS),
    buscarMembros: (id, j, offset) => get(urlMembros(id, j, offset), HEADERS_ADS),
    buscarSerieConta: (adv, j) => get(urlSerieConta(adv, j), HEADERS_ADS),
    gravarContaDias: async (rodada, coletadoEm, dias) =>
      (await rpc('gravar_ads_conta_dias', { p_org: orgId, p_rodada: rodada, p_coletado_em: coletadoEm, p_dias: dias })) === true,

    gravarLote: async (rodada, coletadoEm, grupos) =>
      (await rpc('gravar_ads_lote', { p_org: orgId, p_rodada: rodada, p_coletado_em: coletadoEm, p_grupos: grupos })) === true,

    async continuar(msg, { atrasoMs }) {
      await qstashClient().publishJSON({
        url: urlWorker(), body: msg, retries: 1, deduplicationId: dedupContinuacaoAds(msg), delay: delaySegundos(atrasoMs),
      });
    },

    concluir: async (rodada, estado, erro, extra) =>
      (await rpc('concluir_ads_rodada', {
        p_org: orgId, p_rodada: rodada, p_estado: estado, p_erro: erro, p_carga_concluida: extra.cargaConcluida,
        p_advertiser_id: extra.advertiserId, p_cobertura_desde: extra.coberturaDesde,
        p_custo_resumo: extra.custoResumo, p_custo_listado: extra.custoListado,
      })) === true,
  };
}
