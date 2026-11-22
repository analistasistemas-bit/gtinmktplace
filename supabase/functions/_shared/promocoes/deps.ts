// Fiação real do sync de promoções (ADR-0170). Só ligação, nenhuma decisão — a regra vive em
// sincronizar.ts / alertas.ts, testadas por vitest. Validada contra Postgres real e o ML na Task 10.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { buscarListingPriceComRetentativa, comissaoDeComProveniencia } from '../ml/listing-prices.ts';
import { buscarFreteVendedorComProveniencia } from '../ml/frete.ts';
import { redisGet, redisSet } from '../redis/client.ts';
import { paginarTudo } from '../pagina.ts';
import { qstashClient } from '../queue.ts';
import { montarCadastro, type Cadastro, type LinhaItemUp, type LinhaVariacao } from './cadastro.ts';
import {
  buscarItensML, criarGetJson, lerOfertaRelampago, lerPromocao, listarAtivosPagina, listarItensPromocao, listarPromocoes, promocoesDoAnuncio,
} from './ml.ts';
import { contar } from './projecao.ts';
import { avisarPromocoes, depsAlertas } from './alertas.ts';
import {
  mesmaRodada, type DepsDescoberta, type DepsLeitura, type DepsLista, type MsgDescoberta, type MsgLeitura, type QueryTarifa,
} from './sincronizar.ts';
import type { Comissao } from '../preco/sugerir.ts';
import type { Aliquotas, LinhaItem, Tarifa } from './tipos.ts';

const TTL_S = 8 * 60 * 60; // > período do schedule (6 h): o run agendado seguinte ainda acha o cache quente
const RESERVA_MIN = 30; // medir a duração da cadeia da 10.10 na Task 0 e ajustar (UI usa o mesmo valor em emLeitura)
const MSG_INTERROMPIDA = 'A leitura anterior dos anúncios foi interrompida; os números podem estar incompletos.';

/** Comissão ou frete que o ML não informou: nunca vira zero, nunca entra no cache. */
export class TarifaEstimada extends Error {}

export type Cx = { orgId: string; mlUserId: string; token: string };
const falhou = (onde: string, e: { message: string } | null) => { if (e) throw new Error(`${onde}: ${e.message}`); };
const urlWorker = () => `${Deno.env.get('SUPABASE_URL')}/functions/v1/sincronizar-promocoes`;
/** Entrega duplicada do QStash não bifurca a cadeia: mesma mensagem → mesmo id (QStash aceita e descarta). */
const dedupId = (m: MsgLeitura) =>
  `${m.org_id}:${m.promocao_id}:${m.rodada}:${m.cursor ?? ''}`.replace(/[^A-Za-z0-9_-]/g, '_');

const dedupIdDescoberta = (m: MsgDescoberta) =>
  `${m.org_id}:descoberta:${m.rodada}:${m.scroll_id ?? ''}`.replace(/[^A-Za-z0-9_-]/g, '_');
const publicar = (body: MsgLeitura | MsgDescoberta, deduplicationId: string) =>
  qstashClient().publishJSON({ url: urlWorker(), body, retries: 1, deduplicationId });
const listaIds = (ids: string[]) => `(${ids.map((v) => `"${v.replaceAll('"', '')}"`).join(',')})`;

export async function lerAliquotas(admin: SupabaseClient, orgId: string): Promise<Aliquotas | null> {
  const { data, error } = await admin.from('configuracoes')
    .select('aliquota_nacional_pct, aliquota_importado_pct, aliquotas_confirmadas_em')
    .eq('org_id', orgId).maybeSingle();
  falhou('lerAliquotas', error);
  if (!data?.aliquotas_confirmadas_em || data.aliquota_nacional_pct == null || data.aliquota_importado_pct == null) return null;
  return { nacional: Number(data.aliquota_nacional_pct), importado: Number(data.aliquota_importado_pct) };
}

async function emCache<T>(chave: string, calcular: () => Promise<T>, fresco = false): Promise<T> {
  if (!fresco) {
    try {
      const hit = await redisGet(chave);
      if (hit) return JSON.parse(hit) as T;
    } catch { /* cache é otimização */ }
  }
  const v = await calcular(); // lança → não grava
  try { await redisSet(chave, JSON.stringify(v), TTL_S); } catch { /* idem */ }
  return v;
}

/** Cadastro da org (custo, piso, origem, dimensões) para resolver a cor de cada anúncio. */
export async function carregarCadastro(admin: SupabaseClient, orgId: string): Promise<Cadastro> {
  const variacoes = await paginarTudo<LinhaVariacao>((de, ate) => admin.from('variacoes')
    .select('id, custo, preco, cor, codigo, gtin, ml_variation_id, peso_gramas, altura_cm, largura_cm, comprimento_cm, atualizado_em, familias!inner(ml_item_id, origem, kit_multiplicador)')
    .eq('org_id', orgId).order('id').range(de, ate) as never);
  const itensUp = await paginarTudo<LinhaItemUp>((de, ate) => admin.from('anuncios_externos_itens')
    .select('item_externo_id, variacao_id')
    .eq('org_id', orgId).not('item_externo_id', 'is', null).not('variacao_id', 'is', null)
    .order('id').range(de, ate) as never);
  return montarCadastro(variacoes, itensUp);
}

/** Comissão + frete exatos num preço (cache `promo:` no Redis); estimado lança TarifaEstimada.
 * `fresco` (reajuste, C1): não lê o cache — mudança de tarifa do ML não passa despercebida; ainda grava. */
export function criarTarifaEm(cx: Cx, opts?: { fresco?: boolean }): (q: QueryTarifa) => Promise<Tarifa> {
  // Disjuntor: 429/5xx que resistiu às retentativas → o resto desta execução não espera de novo
  // (cores são sequenciais; esperar 4 s em cada estouraria o tempo da edge).
  let semRetentativa = false;
  return async ({ preco, categoria, listingType, dim }) => {
    const p = preco.toFixed(2);
    const dimKey = dim ? `${dim.altura_cm}x${dim.largura_cm}x${dim.comprimento_cm}x${dim.peso_gramas}` : 'padrao';
    const [comissao, frete] = await Promise.all([
      emCache<Comissao>(`promo:lp:v1:${categoria}:${listingType}:${p}`, async () => {
        const lp = await buscarListingPriceComRetentativa(cx.token, preco, categoria, listingType, semRetentativa ? [] : undefined)
          .catch((e: Error) => {
            if (/listing_prices \S+ (429|5\d\d)/.test(e.message)) semRetentativa = true;
            throw e;
          });
        const c = comissaoDeComProveniencia(lp);
        if (c.proveniencia === 'estimated') throw new TarifaEstimada(c.motivo ?? 'comissão estimada');
        return c.valor;
      }, opts?.fresco),
      emCache<number>(`promo:frete:v1:${cx.mlUserId}:${categoria}:${p}:${dimKey}`, async () => {
        const f = await buscarFreteVendedorComProveniencia(cx.token, cx.mlUserId, preco, categoria, dim);
        // 'partial' (pacote padrão por falta de dimensão) é o mesmo número que a Revisão mostra: aceito.
        if (f.proveniencia === 'estimated') throw new TarifaEstimada(f.motivo ?? 'frete estimado');
        return f.valor;
      }, opts?.fresco),
    ]);
    return { comissao, frete };
  };
}

async function reservarLeitura(admin: SupabaseClient, orgId: string, promocaoId: string, rodada: string): Promise<boolean> {
  const limite = new Date(Date.now() - RESERVA_MIN * 60_000).toISOString();
  // Reserva vencida = cadeia anterior morreu sem concluir nem falhar: registra antes de reservar de novo.
  const vencida = await admin.from('ml_promocoes').update({ erro: MSG_INTERROMPIDA })
    .eq('org_id', orgId).eq('promocao_id', promocaoId).lt('rodada_em_curso', limite);
  falhou('reservarLeitura.vencida', vencida.error);
  const { data, error } = await admin.from('ml_promocoes').update({ rodada_em_curso: rodada })
    .eq('org_id', orgId).eq('promocao_id', promocaoId)
    .or(`rodada_em_curso.is.null,rodada_em_curso.lt.${limite}`)
    .select('promocao_id');
  falhou('reservarLeitura', error);
  return (data ?? []).length === 1;
}

export function depsLista(admin: SupabaseClient, cx: Cx): DepsLista {
  const get = criarGetJson(cx.token);
  const { orgId } = cx;
  return {
    lerAliquotas: () => lerAliquotas(admin, orgId),
    listarPromocoes: () => listarPromocoes(get, cx.mlUserId),

    async gravarPromocoes(ps) {
      const agora = new Date().toISOString();
      const { error } = await admin.from('ml_promocoes').upsert(ps.map((p) => ({
        org_id: orgId, promocao_id: p.id, tipo: p.tipo, nome: p.nome, status: p.status,
        inicio: p.inicio, fim: p.fim, prazo_adesao: p.prazo_adesao, beneficios: p.beneficios,
        bruto: p.bruto, sincronizado_em: agora,
      })), { onConflict: 'org_id,promocao_id' });
      falhou('gravarPromocoes', error);
    },

    async encerrarAusentes(vistos) {
      let q = admin.from('ml_promocoes').update({ status: 'finished', rodada_em_curso: null })
        .eq('org_id', orgId).in('status', ['pending', 'started']);
      // Poupa as descobertas pela visão por anúncio (bruto.descoberta): quem as gere é a etapa de descoberta.
      // `not eq` puro descartaria bruto sem a chave (NULL); por isso o `or` com is.null.
      q = q.or('bruto->>descoberta.is.null,bruto->>descoberta.neq.item');
      if (vistos.length) q = q.not('promocao_id', 'in', listaIds(vistos));
      const { error } = await q;
      falhou('encerrarAusentes', error);
    },

    reservarLeitura: (promocaoId, rodada) => reservarLeitura(admin, orgId, promocaoId, rodada),

    async enfileirar(m) {
      await publicar(m, dedupId(m));
    },

    enfileirarDescoberta: (m) => publicar(m, dedupIdDescoberta(m)),

    avisar: () => avisarPromocoes(Date.now(), depsAlertas(admin, orgId)),

    async gravarEstado({ estado, erro }) {
      const agora = new Date().toISOString();
      const ok = estado === 'ok' || estado === 'sem_promocoes';
      const { error } = await admin.from('ml_promocoes_sync').upsert({
        org_id: orgId, estado, erro: erro ?? null,
        ...(ok ? { ultimo_ok_em: agora } : { ultimo_erro_em: agora }),
      }, { onConflict: 'org_id' });
      falhou('gravarEstado', error);
    },
  };
}

export function depsDescoberta(admin: SupabaseClient, cx: Cx): DepsDescoberta {
  const get = criarGetJson(cx.token);
  const { orgId } = cx;
  return {
    async rodadaDaLista() {
      const { data, error } = await admin.from('ml_promocoes_sync').select('iniciado_em').eq('org_id', orgId).maybeSingle();
      falhou('rodadaDaLista', error);
      return (data?.iniciado_em as string | null) ?? null;
    },
    listarAtivos: (scrollId) => listarAtivosPagina(get, cx.mlUserId, scrollId),
    promocoesDoAnuncio: (itemId) => promocoesDoAnuncio(get, itemId),
    lerPromocao: (id, tipo) => lerPromocao(get, id, tipo),

    async gravarDescoberta(p) {
      const { error } = await admin.from('ml_promocoes').upsert({
        org_id: orgId, promocao_id: p.id, tipo: p.tipo, nome: p.nome, status: p.status,
        inicio: p.inicio, fim: p.fim, prazo_adesao: p.prazo_adesao, beneficios: p.beneficios,
        bruto: { ...p.bruto, descoberta: 'item' }, sincronizado_em: new Date().toISOString(),
      }, { onConflict: 'org_id,promocao_id' });
      falhou('gravarDescoberta', error);
    },

    reservarLeitura: (promocaoId, rodada) => reservarLeitura(admin, orgId, promocaoId, rodada),
    enfileirarLeitura: async (m) => { await publicar(m, dedupId(m)); },
    continuar: async (m) => { await publicar(m, dedupIdDescoberta(m)); },

    async encerrarDescobertasAusentes(vistos) {
      let q = admin.from('ml_promocoes').update({ status: 'finished', rodada_em_curso: null })
        .eq('org_id', orgId).in('status', ['pending', 'started']).eq('bruto->>descoberta', 'item');
      if (vistos.length) q = q.not('promocao_id', 'in', listaIds(vistos));
      const { error } = await q;
      falhou('encerrarDescobertasAusentes', error);
    },
  };
}

export function depsLeitura(admin: SupabaseClient, cx: Cx, msg: MsgLeitura): DepsLeitura {
  const get = criarGetJson(cx.token);
  const { orgId } = cx;
  const lerRodada = async (): Promise<string | null> => {
    const { data, error } = await admin.from('ml_promocoes').select('rodada_em_curso')
      .eq('org_id', orgId).eq('promocao_id', msg.promocao_id).maybeSingle();
    falhou('rodadaEmCurso', error);
    return (data?.rodada_em_curso as string | null) ?? null;
  };
  return {
    agora: () => Date.now(),
    rodadaEmCurso: lerRodada,

    lerAliquotas: () => lerAliquotas(admin, orgId),
    listarItens: () => listarItensPromocao(get, { id: msg.promocao_id, tipo: msg.tipo } as never),
    buscarItensML: (ids) => buscarItensML(get, ids),

    carregarCadastro: () => carregarCadastro(admin, orgId),
    tarifaEm: criarTarifaEm(cx),
    ofertaRelampago: (itemId) => lerOfertaRelampago(get, msg.promocao_id, itemId),

    async gravarLote(linhas: LinhaItem[]) {
      const { error } = await admin.from('ml_promocao_itens').upsert(linhas.map((l) => ({
        org_id: orgId, promocao_id: msg.promocao_id, ml_item_id: l.ml_item_id, status: l.status,
        preco_original: l.preco_original, preco_promo: l.preco_promo, preco_min: l.preco_min, preco_max: l.preco_max,
        preco_sugerido: l.preco_sugerido, preco_avaliado: l.preco_avaliado, ml_pct: l.ml_pct, vendedor_pct: l.vendedor_pct,
        estoque_min: l.estoque_min, estoque_max: l.estoque_max, titulo: l.titulo, thumbnail: l.thumbnail,
        permalink: l.permalink, listing_type_id: l.listing_type_id, projecao: l.projecao,
        pior_semaforo: l.pior_semaforo, anuncio_normal_id: l.anuncio_normal_id, sincronizado_em: msg.rodada,
        anuncio_criado_em: l.anuncio_criado_em, convite_aberto: l.convite_aberto ?? false,
      })), { onConflict: 'org_id,promocao_id,ml_item_id' });
      falhou('gravarLote', error);
    },

    async removerItens(mlItemIds) {
      const { error } = await admin.from('ml_promocao_itens').delete()
        .eq('org_id', orgId).eq('promocao_id', msg.promocao_id).in('ml_item_id', mlItemIds);
      falhou('removerItens', error);
    },

    async continuar(cursor) {
      const m = { ...msg, cursor };
      await publicar(m, dedupId(m));
    },

    async concluir() {
      if (!mesmaRodada(await lerRodada(), msg.rodada)) return false;
      const del = await admin.from('ml_promocao_itens').delete()
        .eq('org_id', orgId).eq('promocao_id', msg.promocao_id).lt('sincronizado_em', msg.rodada);
      falhou('concluir.delete', del.error);
      const linhas = await paginarTudo<Pick<LinhaItem, 'status' | 'pior_semaforo' | 'ml_pct' | 'preco_avaliado'>>((de, ate) => admin.from('ml_promocao_itens')
        .select('ml_item_id, status, pior_semaforo, ml_pct, preco_avaliado').eq('org_id', orgId).eq('promocao_id', msg.promocao_id)
        .order('ml_item_id').range(de, ate) as never);
      // PostgREST compara timestamptz pelo instante: `eq` com o texto da mensagem funciona.
      const upd = await admin.from('ml_promocoes')
        .update({ contagem: contar(linhas), erro: null, itens_sincronizados_em: msg.rodada, rodada_em_curso: null })
        .eq('org_id', orgId).eq('promocao_id', msg.promocao_id).eq('rodada_em_curso', msg.rodada)
        .select('promocao_id');
      falhou('concluir.contagem', upd.error);
      return (upd.data ?? []).length === 1;
    },

    async falhar(erro) {
      const { error } = await admin.from('ml_promocoes').update({ erro, rodada_em_curso: null })
        .eq('org_id', orgId).eq('promocao_id', msg.promocao_id).eq('rodada_em_curso', msg.rodada);
      falhou('falhar', error);
    },
  };
}
