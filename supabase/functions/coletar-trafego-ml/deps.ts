// Fiação real do worker de tráfego (Vendas SKU Fatia 2b). Só ligação: a regra vive em
// _shared/trafego/{sincronizar,fiacao,inventario,janelas,parsers}.ts (vitest). No ML só GET; o único
// POST é o refresh OAuth de token.ts. Gravação só pelas RPCs de 20260927084615_vendas_sku_trafego.sql.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { qstashClient } from '../_shared/queue.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { paginarTudo } from '../_shared/pagina.ts';
import { diaDeHoje } from '../_shared/trafego/janelas.ts';
import {
  buscarML, classificarItensTrafego, corteRetencao, corteVendidos, dedupContinuacao, dedupFanout,
  delaySegundos, parseMultigetStatus, preservarStatus, type LinhaTrafegoItem,
} from '../_shared/trafego/fiacao.ts';
import { SemAcessoTrafego, STATUS_DESCONHECIDO, type DepsTrafego } from '../_shared/trafego/sincronizar.ts';

const ML = 'https://api.mercadolibre.com';
const urlWorker = () => `${Deno.env.get('SUPABASE_URL')}/functions/v1/coletar-trafego-ml`;
const falhou = (onde: string, e: { message: string } | null) => { if (e) throw new Error(`${onde}: ${e.message}`); };

/** Uma mensagem `primeira` por org com conexão ML (dedup org+dia BRT). */
export async function publicarFanout(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin.from('marketplace_connections')
    .select('org_id').eq('canal', 'mercado_livre').not('conta_externa_id', 'is', null);
  falhou('conexões ML', error);
  const orgs = [...new Set((data ?? []).map((r) => r.org_id as string))];
  const dia = diaDeHoje(new Date(), 'brt');
  for (const org of orgs) {
    await qstashClient().publishJSON({
      url: urlWorker(), body: { org_id: org, primeira: true }, retries: 1, deduplicationId: dedupFanout(org, dia),
    });
  }
  return orgs.length;
}

/**
 * Retenção de 13 meses, em lotes por org e tabela. Cada lote que falha só loga e segue.
 * ponytail: um delete por org/tabela; roda todo dia, então cada lote é ~1 dia de linhas.
 * Fatiar por faixa de dias se um backlog grande (schedule parado meses) estourar o statement timeout.
 */
export async function limparRetencao(admin: SupabaseClient): Promise<void> {
  const corte = corteRetencao(new Date());
  const { data, error } = await admin.from('ml_trafego_sync').select('org_id');
  falhou('ml_trafego_sync', error);
  for (const { org_id } of data ?? []) {
    for (const tabela of ['ml_item_visitas_dia', 'ml_item_preco_dia'] as const) {
      const { error: e } = await admin.from(tabela).delete().eq('org_id', org_id).lt('dia', corte);
      if (e) console.error('[coletar-trafego-ml] retenção', { org_id, tabela, erro: e.message });
    }
  }
}

export function depsTrafego(admin: SupabaseClient, orgId: string): DepsTrafego {
  // Token preguiçoso e memoizado: sem conexão → SemAcessoTrafego dentro da rodada (conclui sem_acesso).
  // Falha no refresh (429/rede) é Error comum → rodada 'erro' → 500 → 1 retry do QStash (ADR-0171).
  let token: Promise<string> | null = null;
  const tokenML = () => token ??= (async () => {
    const cx = await resolverConexao(admin, orgId, 'mercado_livre');
    if (!cx?.contaExternaId) throw new SemAcessoTrafego('Organização sem conexão com o Mercado Livre.');
    return getValidAccessTokenConexao(cx);
  })();
  const get = async (caminho: string) => buscarML(`${ML}${caminho}`, await tokenML());
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    falhou(fn, error);
    return data;
  };

  return {
    agora: () => Date.now(),
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),

    async reservarPosse() {
      const linhas = await rpc('reservar_trafego_posse', { p_org: orgId }) as { rodada: string; cursor: string | null }[] | null;
      return linhas?.[0] ?? null; // rodada volta exatamente como o PostgREST devolveu (CAS em timestamptz)
    },
    avancarCursor: async (rodada, atual, novo) =>
      (await rpc('avancar_trafego_cursor', { p_org: orgId, p_rodada: rodada, p_cursor_atual: atual, p_cursor_novo: novo })) === true,

    async lerEstadoSync() {
      const [sync, ultimo] = await Promise.all([
        admin.from('ml_trafego_sync').select('carga_inicial_concluida_em').eq('org_id', orgId).maybeSingle(),
        admin.from('ml_item_visitas_dia').select('dia').eq('org_id', orgId).eq('estado', 'ok')
          .order('dia', { ascending: false }).limit(1).maybeSingle(),
      ]);
      falhou('lerEstadoSync.sync', sync.error);
      falhou('lerEstadoSync.ultimo', ultimo.error);
      return {
        cargaInicialConcluida: sync.data?.carga_inicial_concluida_em != null,
        ultimoDiaOk: (ultimo.data?.dia as string | undefined) ?? null,
      };
    },

    async lerInventario() {
      // As 7 fontes de varrer-anuncios-orfaos/index.ts (idsConhecidos), ordenadas para paginar estável.
      const col = <T>(linhas: T[], k: keyof T) => linhas.map((l) => l[k] as unknown as string);
      const [familias, externos, itensUp, kits, catalogoVar, catalogoUp, anteriores, vendidos, itens] = await Promise.all([
        paginarTudo<{ ml_item_id: string }>((de, ate) => admin.from('familias').select('ml_item_id')
          .eq('org_id', orgId).not('ml_item_id', 'is', null).order('id').range(de, ate)),
        paginarTudo<{ item_externo_id: string }>((de, ate) => admin.from('anuncios_externos').select('item_externo_id')
          .eq('org_id', orgId).not('item_externo_id', 'is', null).order('id').range(de, ate)),
        paginarTudo<{ item_externo_id: string }>((de, ate) => admin.from('anuncios_externos_itens').select('item_externo_id')
          .eq('org_id', orgId).not('item_externo_id', 'is', null).order('id').range(de, ate)),
        paginarTudo<{ ml_item_id: string }>((de, ate) => admin.from('kits_virtuais').select('ml_item_id')
          .eq('org_id', orgId).not('ml_item_id', 'is', null).order('id').range(de, ate)),
        paginarTudo<{ catalog_listing_id: string }>((de, ate) => admin.from('variacoes')
          .select('catalog_listing_id, familias!inner(org_id)').eq('familias.org_id', orgId)
          .not('catalog_listing_id', 'is', null).order('id').range(de, ate) as never),
        paginarTudo<{ catalog_listing_id: string }>((de, ate) => admin.from('anuncios_externos_itens').select('catalog_listing_id')
          .eq('org_id', orgId).not('catalog_listing_id', 'is', null).order('id').range(de, ate)),
        paginarTudo<{ ml_item_id_anterior: string }>((de, ate) => admin.from('anuncios_externos').select('ml_item_id_anterior')
          .eq('org_id', orgId).not('ml_item_id_anterior', 'is', null).order('id').range(de, ate)),
        // ml_vendas_itens não tem data: join em ml_vendas.date_closed (180 dias). Distinct em montarInventario.
        paginarTudo<{ ml_item_id: string }>((de, ate) => admin.from('ml_vendas_itens')
          .select('ml_item_id, ml_vendas!inner(date_closed)').eq('org_id', orgId).not('ml_item_id', 'is', null)
          .gte('ml_vendas.date_closed', corteVendidos(Date.now())).order('id').range(de, ate) as never),
        paginarTudo<LinhaTrafegoItem>((de, ate) => admin.from('ml_trafego_item')
          .select('ml_item_id, status, status_desde, ultimo_ok_em').eq('org_id', orgId).order('ml_item_id').range(de, ate)),
      ]);
      return {
        fontes: {
          familias: col(familias, 'ml_item_id'),
          anunciosExternos: col(externos, 'item_externo_id'),
          itensUp: col(itensUp, 'item_externo_id'),
          kitsVirtuais: col(kits, 'ml_item_id'),
          catalogoVariacoes: col(catalogoVar, 'catalog_listing_id'),
          catalogoItensUp: col(catalogoUp, 'catalog_listing_id'),
          pxvAnteriores: col(anteriores, 'ml_item_id_anterior'),
          vendidos: col(vendidos, 'ml_item_id'),
        },
        ...classificarItensTrafego(itens, Date.now()),
      };
    },

    async lerStatusItens(ids) {
      const r = await get(`/items?ids=${ids.map(encodeURIComponent).join(',')}&attributes=id,status`);
      if (r.status !== 200) throw new Error(`multiget de status: HTTP ${r.status}`);
      return parseMultigetStatus(r.corpo);
    },
    buscarVisitas: (id, p) =>
      get(`/items/${encodeURIComponent(id)}/visits/time_window?last=${p.last}&unit=day&ending=${p.ending}`),
    buscarPreco: (id) => get(`/items/${encodeURIComponent(id)}/sale_price?context=channel_marketplace`),

    async precoJaGravadoHoje(ids, dia) {
      const { data, error } = await admin.from('ml_item_preco_dia').select('ml_item_id')
        .eq('org_id', orgId).eq('dia', dia).in('ml_item_id', ids);
      falhou('precoJaGravadoHoje', error);
      return new Set((data ?? []).map((l) => l.ml_item_id as string));
    },

    gravarVisitas: async (rodada, pontos) => { await rpc('gravar_visitas_dia', { p_org: orgId, p_rodada: rodada, p_pontos: pontos }); },
    gravarPreco: async (pontos) => { await rpc('gravar_preco_dia', { p_org: orgId, p_pontos: pontos }); },

    async gravarStatusItens(itens) {
      const sem = itens.filter((i) => i.status === STATUS_DESCONHECIDO).map((i) => i.ml_item_id);
      let atuais = new Map<string, string>();
      if (sem.length) {
        const { data, error } = await admin.from('ml_trafego_item').select('ml_item_id, status')
          .eq('org_id', orgId).in('ml_item_id', sem);
        falhou('gravarStatusItens.atuais', error);
        atuais = new Map((data ?? []).map((l) => [l.ml_item_id as string, l.status as string]));
      }
      await rpc('gravar_trafego_item', { p_org: orgId, p_itens: preservarStatus(itens, atuais) });
    },

    async continuar(msg, { atrasoMs }) {
      await qstashClient().publishJSON({
        url: urlWorker(), body: msg, retries: 1, deduplicationId: dedupContinuacao(msg), delay: delaySegundos(atrasoMs),
      });
    },

    concluir: async (rodada, estado, erro, cargaConcluida) =>
      (await rpc('concluir_trafego_rodada', {
        p_org: orgId, p_rodada: rodada, p_estado: estado, p_erro: erro, p_carga_concluida: cargaConcluida,
      })) === true,
  };
}
