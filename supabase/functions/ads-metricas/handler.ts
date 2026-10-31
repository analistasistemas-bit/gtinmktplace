// Métricas do Mercado Ads por período, sob demanda (plano ads-redesign §5.1–5.5). SÓ GET no ML.
// Org vem da sessão (requireUserOrg), módulo `ads` fecha o gate, conexão e anunciante são da org da sessão:
// `org_id`/`advertiser_id` do body nunca são lidos. Campanha (E3/E4) só depois de provar o pertencimento.
// Deps injetadas: o vitest carrega este arquivo sem Deno/jsr; a fiação de IO fica em index.ts.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import type { ConexaoCanal } from '../_shared/canais/conexao.ts';
import type { RespostaML } from '../_shared/trafego/sincronizar.ts';
import { HEADERS_ADS, HEADERS_ADVERTISER, urlAdvertiser } from '../_shared/ads/fiacao.ts';
import { classificarResposta, parseAdvertiser } from '../_shared/ads/parsers.ts';
import { DIAS_RELEITURA } from '../_shared/ads/janelas.ts';
import {
  parseMetricasResumo, urlCampanhaDetalhe,
  type BlocoAdsMetricas, type EscopoAdsMetricas, type JanelaAdsMetricas, type MetricaBrutaAds,
  type PedidoAdsMetricas, type RespostaAdsMetricas,
} from '../_shared/ads/metricas.ts';
import {
  criarLeituraOrcada, lerCampanhasComparadas, lerComparado, lerEscopoCampanha, lerEscopoConta, provarPertencimento,
  type DepsLeituraAds, type LeituraCampanhasAds,
} from '../_shared/ads/metricas-leitura.ts';
import {
  TTL_CACHE_ADS_S, VERSAO_CONTRATO_ADS, chaveMetricasAds, lerMetricasComCache, type DepsCacheAds,
} from '../_shared/ads/metricas-cache.ts';

export interface DepsAdsMetricas {
  /** requireUserOrg(req, { access: 'read' }); lança Response (401/403) sem sessão válida. */
  autenticar(req: Request): Promise<{ orgId: string }>;
  /** exigirModulo(..., 'ads'): falha de leitura fecha o gate. */
  moduloAds(orgId: string): Promise<boolean>;
  conexao(orgId: string): Promise<ConexaoCanal | null>;
  /** GET no ML com o token da conexão (refresh e 401 por getComReautenticacao). Nunca lança por status HTTP. */
  ml(conexao: ConexaoCanal): (path: string, headers: Record<string, string>, sinal?: AbortSignal) => Promise<RespostaML>;
  cache: DepsCacheAds;
  agora(): Date;
  esperar(ms: number): Promise<void>;
}

/** Retenção medida no spike 058 (espelha RETENCAO_ADS_DIAS de src/lib/ads-painel-dados.ts: o edge não importa src/). */
const RETENCAO_ADS_DIAS = 91;
const ESCOPOS = new Set<EscopoAdsMetricas>(['conta', 'campanhas', 'campanha', 'competitividade']);
const CAMPOS_COMPETITIVIDADE: MetricaBrutaAds[] = [
  'impression_share', 'top_impression_share', 'lost_impression_share_by_budget', 'lost_impression_share_by_ad_rank',
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const somarDias = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const diaReal = (d: unknown): d is string =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && somarDias(d, 0) === d;
const diaBRT = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);

/** Mesmo nº de dias imediatamente antes do início, sem dia compartilhado (= janelaAnteriorAds do front). */
function janelaAnterior(j: JanelaAdsMetricas): JanelaAdsMetricas {
  const dias = Math.round((Date.parse(`${j.ate}T12:00:00Z`) - Date.parse(`${j.desde}T12:00:00Z`)) / 86_400_000) + 1;
  return { desde: somarDias(j.desde, -dias), ate: somarDias(j.desde, -1) };
}

/** Validação no servidor, independente do front: datas reais, ordem, até ≤ ontem BRT, desde ≥ hoje − 91. */
export function validarPedido(corpo: unknown, hoje: string): { pedido: PedidoAdsMetricas } | { motivo: string } {
  if (!obj(corpo)) return { motivo: 'corpo_invalido' };
  const { desde, ate, comparar, escopo, campanhaId, fresco } = corpo;
  if (!diaReal(desde) || !diaReal(ate)) return { motivo: 'data_invalida' };
  if (desde > ate) return { motivo: 'ordem' };
  if (ate > somarDias(hoje, -1)) return { motivo: 'futuro' };
  if (desde < somarDias(hoje, -RETENCAO_ADS_DIAS)) return { motivo: 'fora_da_retencao' };
  if (typeof escopo !== 'string' || !ESCOPOS.has(escopo as EscopoAdsMetricas)) return { motivo: 'escopo_invalido' };
  if (comparar !== 'anterior' && comparar !== 'nenhum') return { motivo: 'comparar_invalido' };
  if (fresco !== undefined && typeof fresco !== 'boolean') return { motivo: 'fresco_invalido' };
  const porCampanha = escopo === 'campanha' || escopo === 'competitividade';
  if (porCampanha && !(typeof campanhaId === 'number' && Number.isSafeInteger(campanhaId) && campanhaId > 0)) {
    return { motivo: 'campanha_invalida' };
  }
  return {
    pedido: {
      desde, ate, comparar, escopo: escopo as EscopoAdsMetricas,
      // ID solto em conta/campanhas não fragmenta o cache nem vira parâmetro.
      ...(porCampanha ? { campanhaId: campanhaId as number } : {}),
      fresco: fresco === true,
    },
  };
}

type Estado = RespostaAdsMetricas['estado'];

export async function tratar(req: Request, deps: DepsAdsMetricas): Promise<Response> {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    let orgId: string;
    try {
      ({ orgId } = await deps.autenticar(req));
    } catch (r) {
      if (r instanceof Response) return r;
      throw r;
    }
    let corpo: unknown = null;
    try { corpo = await req.json(); } catch { /* body vazio ou não JSON → corpo_invalido */ }
    const hoje = diaBRT(deps.agora());
    const v = validarPedido(corpo, hoje);
    if ('motivo' in v) return json({ ok: false, erro: 'pedido inválido', motivo: v.motivo }, 400);
    const pedido = v.pedido;

    if (!(await deps.moduloAds(orgId))) return json({ ok: false, erro: 'módulo ads desligado' }, 403);

    const disponibilidade = {
      desde: somarDias(hoje, -RETENCAO_ADS_DIAS), ate: somarDias(hoje, -1), fuso: 'America/Sao_Paulo' as const,
    };
    const vazia = (estado: Estado, avisos: string[] = []): RespostaAdsMetricas => ({
      ok: true, estado, escopo: pedido.escopo, atual: null, anterior: null, campanhas: [],
      comparacao: { estado: pedido.comparar === 'anterior' ? 'indisponivel' : 'desligada', motivo: null },
      disponibilidade, avisos,
    });

    const conexao = await deps.conexao(orgId);
    if (!conexao?.contaExternaId) return json(vazia('sem_conexao'));
    const get = deps.ml(conexao);

    // Anunciante em cache próprio (por org + conexão + conta ML): o cache hit das métricas não toca o ML.
    // ponytail: `fresco` não renova o anunciante; o id do Product Ads não muda na vida da conta.
    const e = encodeURIComponent;
    const chaveAdv = `ads:metricas:${VERSAO_CONTRATO_ADS}:adv:${e(orgId)}:${e(conexao.id)}:${e(conexao.contaExternaId)}`;
    let advertiserId: number | null = null;
    try {
      const hit = await deps.cache.get(chaveAdv);
      const n = hit ? Number(hit) : NaN;
      if (Number.isSafeInteger(n) && n > 0) advertiserId = n;
    } catch (err) { console.warn('[ads-metricas] cache indisponível (anunciante)', err); }
    if (advertiserId == null) {
      const a = await get(urlAdvertiser(), HEADERS_ADVERTISER);
      const classe = classificarResposta(a);
      if (classe === 'sem_acesso' || classe === 'sem_permissao') return json(vazia(classe));
      if (classe === 'nao_encontrado') return json(vazia('sem_advertiser'));
      if (classe !== 'ok') throw new Error(`ML ${a.status} em advertisers`);
      advertiserId = parseAdvertiser(a.corpo);
      if (advertiserId == null) return json(vazia('sem_advertiser'));
      try { await deps.cache.set(chaveAdv, String(advertiserId), TTL_CACHE_ADS_S); } catch (err) {
        console.warn('[ads-metricas] cache indisponível (anunciante, escrita)', err);
      }
    }
    const adv = advertiserId;

    const atual: JanelaAdsMetricas = { desde: pedido.desde, ate: pedido.ate };
    let anterior: JanelaAdsMetricas | null = null;
    let foraDaRetencao = false;
    if (pedido.comparar === 'anterior') {
      anterior = janelaAnterior(atual);
      if (anterior.desde < disponibilidade.desde) { anterior = null; foraDaRetencao = true; }
    }

    const chave = chaveMetricasAds({
      orgId, conexaoId: conexao.id, advertiserId: adv, escopo: pedido.escopo,
      campanhaId: pedido.campanhaId ?? null, atual, anterior,
    });

    const r = await lerMetricasComCache<RespostaAdsMetricas>(deps.cache, chave, orgId, pedido.fresco === true, async () => {
      const agoraMs = () => deps.agora().getTime();
      const orcada = criarLeituraOrcada({
        buscar: (url, sinal) => get(url, HEADERS_ADS, sinal), agoraMs, esperar: deps.esperar,
      });
      const leitura: DepsLeituraAds = {
        buscar: orcada.buscar, agora: () => deps.agora().toISOString(), restante: orcada.restante,
      };
      const resposta = await lerEscopo(leitura, adv, pedido, atual, anterior);
      const motivo = orcada.estado().motivo;
      const avisos = [...resposta.avisos];
      if (motivo === 'sem_permissao' || motivo === 'sem_acesso') {
        return { valor: vazia(motivo, avisos), completo: false };
      }
      if (motivo === 'limite_de_leitura') avisos.push('Limite de leitura atingido; dados incompletos.');
      // Escopo campanha: E5 lido por último; um teto estourado nele vira o motivo da lista (não "resposta inválida").
      const anuncios = resposta.anuncios === undefined ? {} : {
        anuncios: resposta.anuncios,
        anunciosMotivo: resposta.anunciosMotivo && motivo === 'limite_de_leitura' ? motivo : resposta.anunciosMotivo ?? null,
      };
      const valor: RespostaAdsMetricas = {
        // Estado olha só a janela atual (anterior incompleta só desliga a comparação); o cache exige as duas.
        ok: true, estado: resposta.recusa ?? (resposta.atual?.completo && !motivo ? 'ok' : 'parcial'),
        escopo: pedido.escopo, atual: resposta.atual, anterior: resposta.anterior, campanhas: resposta.campanhas,
        ...anuncios, comparacao: resposta.comparacao, disponibilidade, avisos,
      };
      // Lista de anúncios indisponível ou sem a anterior também não é cacheada como completa.
      return { valor, completo: valor.estado === 'ok' && resposta.completo && !valor.anunciosMotivo };
    });
    if (r.estado === 'recusado') return json({ ok: false, erro: r.motivo }, 429);
    // Depois do cache: anterior fora da retenção gera a mesma chave que `comparar: 'nenhum'` (anterior null), e
    // "provisória" depende de hoje. O cache guarda só a leitura; o estado da comparação sai do pedido.
    return json({ ...r.valor, comparacao: comparacaoDoPedido(r.valor.comparacao, pedido, foraDaRetencao, hoje, atual) });
  } catch (err) {
    // Detalhe só no log: a mensagem pode carregar corpo do ML; token nunca sai na resposta.
    console.error('[ads-metricas]', err);
    return json({ ok: false, erro: 'falha ao ler métricas de Ads' }, 500);
  }
}

const difDias = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);

/**
 * Atribuição final (ADR-0179; `atribuicaoFinal` do front): o dia é final se hoje BRT − dia ≥ DIAS_RELEITURA.
 * A anterior termina antes da atual, então basta o último dia da atual para saber se alguma das duas está aberta.
 */
function comparacaoDoPedido(
  c: RespostaAdsMetricas['comparacao'], pedido: PedidoAdsMetricas, foraDaRetencao: boolean,
  hoje: string, atual: JanelaAdsMetricas,
): RespostaAdsMetricas['comparacao'] {
  if (pedido.comparar === 'nenhum') return { estado: 'desligada', motivo: null };
  if (foraDaRetencao) return { estado: 'indisponivel', motivo: 'Janela anterior fora da retenção do Mercado Ads.' };
  if (c.estado === 'disponivel' && difDias(hoje, atual.ate) < DIAS_RELEITURA) {
    return { estado: 'provisoria', motivo: 'O ML ainda pode revisar a atribuição de vendas destes dias.' };
  }
  return c;
}

interface LeituraEscopo {
  atual: BlocoAdsMetricas | null;
  anterior: BlocoAdsMetricas | null;
  campanhas: RespostaAdsMetricas['campanhas'];
  comparacao: RespostaAdsMetricas['comparacao'];
  completo: boolean;
  recusa: 'sem_acesso' | null;
  avisos: string[];
  /** Só no escopo campanha (E5). */
  anuncios?: RespostaAdsMetricas['anuncios'];
  anunciosMotivo?: RespostaAdsMetricas['anunciosMotivo'];
}

const blocoDaLista = (l: LeituraCampanhasAds): BlocoAdsMetricas => ({
  janela: l.janela, resumo: l.resumo ?? {}, serie: [], completo: l.completo, lidoEm: l.lidoEm,
});

/** Tabela §5.4: conta = E1+E2; campanhas = E1 paginado unido pelo ID; campanha = E3+E4+E5; competitividade = só E3. */
async function lerEscopo(
  leitura: DepsLeituraAds, adv: number, pedido: PedidoAdsMetricas,
  atual: JanelaAdsMetricas, anterior: JanelaAdsMetricas | null,
): Promise<LeituraEscopo> {
  const base = { campanhas: [], recusa: null, avisos: [] as string[] };
  // `completo` exige a anterior inteira quando pedida; a anterior fora da retenção já veio null (determinístico).
  const fechado = (a: BlocoAdsMetricas, estado: string) => a.completo && (anterior === null || estado === 'disponivel');

  if (pedido.escopo === 'campanhas') {
    const r = await lerCampanhasComparadas(leitura, adv, atual, anterior);
    const comparacao: RespostaAdsMetricas['comparacao'] = !r.anterior
      ? { estado: 'desligada', motivo: null }
      : r.atual.completo && r.anterior.completo
        ? { estado: 'disponivel', motivo: null }
        : { estado: 'indisponivel', motivo: 'Leitura das campanhas incompleta.' };
    const a = blocoDaLista(r.atual);
    return {
      ...base, atual: a, anterior: comparacao.estado === 'disponivel' && r.anterior ? blocoDaLista(r.anterior) : null,
      campanhas: r.campanhas, comparacao, completo: fechado(a, comparacao.estado),
    };
  }

  if (pedido.escopo === 'conta') {
    const r = await lerEscopoConta(leitura, adv, atual, anterior);
    return { ...base, ...r, completo: fechado(r.atual, r.comparacao.estado) };
  }

  const id = pedido.campanhaId!;
  if (pedido.escopo === 'campanha') {
    const r = await lerEscopoCampanha(leitura, adv, id, atual, anterior);
    if ('recusa' in r) return recusado(r.recusa.motivo);
    return { ...base, ...r, completo: fechado(r.atual, r.comparacao.estado) };
  }

  // competitividade: leitura separada (falha aqui não derruba os KPIs), só E3 e só os campos de participação.
  const motivo = await provarPertencimento(leitura, adv, id, anterior ? [atual, anterior] : [atual]);
  if (motivo) return recusado(motivo);
  const r = await lerComparado(async (j) => {
    const e3 = await leitura.buscar(urlCampanhaDetalhe(id, j));
    const todas = obj(e3) && obj(e3.metrics) ? parseMetricasResumo(e3.metrics) : null;
    const resumo: BlocoAdsMetricas['resumo'] = {};
    if (todas) for (const c of CAMPOS_COMPETITIVIDADE) resumo[c] = todas[c];
    return { janela: j, resumo, serie: [], completo: todas !== null, lidoEm: leitura.agora() };
  }, atual, anterior);
  return { ...base, ...r, completo: fechado(r.atual, r.comparacao.estado) };
}

const recusado = (motivo: string): LeituraEscopo => ({
  atual: null, anterior: null, campanhas: [], comparacao: { estado: 'indisponivel', motivo },
  completo: false, recusa: 'sem_acesso', avisos: [motivo],
});
