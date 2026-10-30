// Leitura paginada de campanhas por período (E1, plano ads-redesign §5.4). `buscar` é injetado: devolve o corpo
// JSON ou null em falha. Sem cache ou orçamento (camadas acima); o escopo campanha prova o pertencimento. Nunca lança.
import {
  CAMPOS_METRICA_ADS, parseMetricasResumo, parseSerieMetricas, urlCampanhaDetalhe, urlCampanhaSerie, urlContaResumo,
  urlContaSerie,
  type BlocoAdsMetricas, type CampanhaPeriodoAds, type JanelaAdsMetricas, type MetricaBrutaAds, type ValorAds,
} from './metricas.ts';
import { classificarResposta } from './parsers.ts';
import type { RespostaML } from '../trafego/sincronizar.ts';

export interface DepsLeituraAds {
  buscar(url: string): Promise<unknown | null>;
  agora(): string;
}

export interface LinhaCampanhaAds {
  id: number;
  nome: string;
  status: string;
  resumo: Partial<Record<MetricaBrutaAds, ValorAds>>;
}

export interface LeituraCampanhasAds {
  janela: JanelaAdsMetricas;
  /** Todas as `paging.total` linhas lidas, sem página vazia, id repetido ou corpo inválido. */
  completo: boolean;
  campanhas: LinhaCampanhaAds[];
  /**
   * Regra (spike 058, "armadilha medida"): `metrics_summary` só soma a página lida. Só é usado quando UMA página
   * cobre o total, e então uma única vez; com 2+ páginas, ou leitura incompleta, é null (total da conta vem de
   * Σ E2). Nunca somado entre páginas.
   */
  resumo: Partial<Record<MetricaBrutaAds, ValorAds>> | null;
  lidoEm: string;
}

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function linhaDe(r: unknown): LinhaCampanhaAds | null {
  if (!obj(r) || typeof r.id !== 'number' || !Number.isInteger(r.id) || r.id <= 0 || typeof r.status !== 'string') return null;
  return {
    id: r.id,
    nome: typeof r.name === 'string' && r.name.trim() ? r.name : `Campanha ${r.id}`,
    status: r.status,
    resumo: parseMetricasResumo(r.metrics),
  };
}

/** Pagina E1 até cobrir `paging.total`. Parar antes do total (página vazia, falha, total mudou) = incompleto. */
export async function lerCampanhasPeriodo(
  deps: DepsLeituraAds,
  advertiserId: number,
  janela: JanelaAdsMetricas,
): Promise<LeituraCampanhasAds> {
  const campanhas = new Map<number, LinhaCampanhaAds>();
  let completo = true;
  let total: number | null = null;
  let resumo: LeituraCampanhasAds['resumo'] = null;
  let paginas = 0;
  let offset = 0;
  do {
    const corpo = await deps.buscar(urlContaResumo(advertiserId, janela, offset));
    const t = obj(corpo) && obj(corpo.paging) ? corpo.paging.total : null;
    if (!obj(corpo) || !Array.isArray(corpo.results) || typeof t !== 'number' || !Number.isInteger(t) || t < 0
      || (total !== null && t !== total)) {
      completo = false;
      break;
    }
    total = t;
    paginas++;
    if (paginas === 1 && obj(corpo.metrics_summary)) resumo = parseMetricasResumo(corpo.metrics_summary);
    for (const r of corpo.results) {
      const l = linhaDe(r);
      if (!l || campanhas.has(l.id)) { completo = false; continue; }
      campanhas.set(l.id, l);
    }
    if (corpo.results.length === 0) break; // página vazia: sem avanço
    offset += corpo.results.length;
  } while (offset < total);
  if (completo && campanhas.size !== total) completo = false;
  return {
    janela, completo, campanhas: [...campanhas.values()],
    resumo: completo && paginas === 1 ? resumo : null,
    lidoEm: deps.agora(),
  };
}

const bloco = (l: LeituraCampanhasAds, linha: LinhaCampanhaAds | undefined): BlocoAdsMetricas => ({
  janela: l.janela, resumo: linha?.resumo ?? {}, serie: [], completo: l.completo, lidoEm: l.lidoEm,
});

/**
 * Lê atual (e anterior, se houver) e une pelo ID. Campanha só em uma janela é preservada: ausente no atual →
 * bloco vazio (sem zero presumido); ausente no anterior → `anterior` null. Status/nome: o mais recente disponível.
 */
export async function lerCampanhasComparadas(
  deps: DepsLeituraAds,
  advertiserId: number,
  atual: JanelaAdsMetricas,
  anterior: JanelaAdsMetricas | null,
): Promise<{ atual: LeituraCampanhasAds; anterior: LeituraCampanhasAds | null; campanhas: CampanhaPeriodoAds[] }> {
  const a = await lerCampanhasPeriodo(deps, advertiserId, atual);
  const p = anterior ? await lerCampanhasPeriodo(deps, advertiserId, anterior) : null;
  const ids = new Set([...a.campanhas.map((c) => c.id), ...(p?.campanhas.map((c) => c.id) ?? [])]);
  const campanhas: CampanhaPeriodoAds[] = [...ids].sort((x, y) => x - y).map((id) => {
    const la = a.campanhas.find((c) => c.id === id);
    const lp = p?.campanhas.find((c) => c.id === id);
    const base = (la ?? lp)!;
    return {
      id, nome: base.nome, statusAtual: base.status,
      atual: bloco(a, la),
      anterior: p && lp ? bloco(p, lp) : null,
    };
  });
  return { atual: a, anterior: p, campanhas };
}

// --- Escopos `conta` (E1+E2) e `campanha` (E3+E4), plano §5.4. ---

export interface LeituraEscopoAds {
  atual: BlocoAdsMetricas;
  anterior: BlocoAdsMetricas | null;
  comparacao: { estado: 'disponivel' | 'indisponivel' | 'desligada'; motivo: string | null };
}

// Razões nativas do ML (cvr/sov/participação): não somam entre dias.
const NAO_ADITIVAS = new Set<MetricaBrutaAds>([
  'cvr', 'sov', 'impression_share', 'top_impression_share',
  'lost_impression_share_by_budget', 'lost_impression_share_by_ad_rank',
]);

/** Soma só as aditivas da série; dia com valor ausente/inválido torna a métrica indisponível, nunca zero. */
function somarSerie(serie: BlocoAdsMetricas['serie']): Partial<Record<MetricaBrutaAds, ValorAds>> {
  const saida: Partial<Record<MetricaBrutaAds, ValorAds>> = {};
  for (const c of CAMPOS_METRICA_ADS) {
    if (NAO_ADITIVAS.has(c)) { saida[c] = { valor: null, motivo: 'sem_denominador' }; continue; }
    let soma = 0;
    let falha: ValorAds | null = null;
    for (const d of serie) {
      const v = d.metricas[c];
      if (!v || v.valor === null) { falha = { valor: null, motivo: v?.motivo ?? 'nao_retornada' }; break; }
      soma += v.valor;
    }
    saida[c] = falha ?? { valor: Math.round(soma * 1e6) / 1e6, motivo: null };
  }
  return saida;
}

async function lerBlocoConta(deps: DepsLeituraAds, adv: number, j: JanelaAdsMetricas): Promise<BlocoAdsMetricas> {
  const e1 = await lerCampanhasPeriodo(deps, adv, j); // as linhas por campanha ficam de fora: aqui só interessa o resumo
  const { serie, completo } = parseSerieMetricas(await deps.buscar(urlContaSerie(adv, j)), j);
  // Sem resumo válido do E1 (2+ páginas ou falha), o total da conta é Σ E2, e só com a série inteira.
  const resumo = e1.resumo?.cost?.motivo === null ? e1.resumo : (completo ? somarSerie(serie) : {});
  return { janela: j, resumo, serie, completo, lidoEm: deps.agora() };
}

async function lerBlocoCampanha(deps: DepsLeituraAds, id: number, j: JanelaAdsMetricas): Promise<BlocoAdsMetricas> {
  const e3 = await deps.buscar(urlCampanhaDetalhe(id, j));
  const metrics = obj(e3) ? e3.metrics : null;
  const { serie, completo } = parseSerieMetricas(await deps.buscar(urlCampanhaSerie(id, j)), j);
  const resumo = obj(metrics) ? parseMetricasResumo(metrics) : {};
  return {
    janela: j, resumo, serie,
    completo: resumo.cost?.motivo === null && completo, lidoEm: deps.agora(),
  };
}

/** Lê atual e, se pedida, a anterior. Falha/incompletude da anterior só desliga a comparação. */
async function lerComparado(
  ler: (j: JanelaAdsMetricas) => Promise<BlocoAdsMetricas>,
  atual: JanelaAdsMetricas,
  anterior: JanelaAdsMetricas | null,
): Promise<LeituraEscopoAds> {
  const a = await ler(atual);
  if (!anterior) return { atual: a, anterior: null, comparacao: { estado: 'desligada', motivo: null } };
  let p: BlocoAdsMetricas | null = null;
  try { p = await ler(anterior); } catch { p = null; }
  if (!a.completo || !p || !p.completo) {
    const motivo = !a.completo ? 'Leitura da janela atual incompleta.' : 'Leitura da janela anterior incompleta ou indisponível.';
    return { atual: a, anterior: null, comparacao: { estado: 'indisponivel', motivo } };
  }
  return { atual: a, anterior: p, comparacao: { estado: 'disponivel', motivo: null } };
}

/** Escopo conta: E1 (resumo, se válido) + E2 (série diária da conta; não identifica campanha). */
export const lerEscopoConta = (
  deps: DepsLeituraAds, advertiserId: number, atual: JanelaAdsMetricas, anterior: JanelaAdsMetricas | null,
) => lerComparado((j) => lerBlocoConta(deps, advertiserId, j), atual, anterior);

/**
 * Recusa do escopo campanha (plano §5.2): nenhuma chamada E3/E4 foi feita. Usa o estado `sem_acesso` do contrato
 * (RespostaAdsMetricas) tanto para campanha alheia quanto para pertencimento não provado (falha fechada).
 */
export interface RecusaCampanhaAds {
  recusa: { estado: 'sem_acesso'; motivo: string };
}

/**
 * Prova de pertencimento: o ID precisa constar numa listagem E1 COMPLETA do próprio anunciante (status históricos,
 * todas as páginas) numa das janelas pedidas. Listagem incompleta nunca autoriza, mesmo com o ID na página lida.
 */
async function provarPertencimento(
  deps: DepsLeituraAds, adv: number, id: number, janelas: JanelaAdsMetricas[],
): Promise<string | null> {
  let incompleta = false;
  for (const j of janelas) {
    const l = await lerCampanhasPeriodo(deps, adv, j);
    if (!l.completo) { incompleta = true; continue; }
    if (l.campanhas.some((c) => c.id === id)) return null;
  }
  return incompleta
    ? 'Listagem de campanhas do anunciante incompleta; pertencimento não comprovado.'
    : 'Campanha não pertence ao anunciante.';
}

/**
 * Escopo campanha: E3 (resumo + competitividade) + E4 (série diária), só depois de provar que `campanhaId`
 * pertence ao anunciante resolvido (o ID na URL não é autorização, plano §5.2).
 */
export async function lerEscopoCampanha(
  deps: DepsLeituraAds, advertiserId: number, campanhaId: number,
  atual: JanelaAdsMetricas, anterior: JanelaAdsMetricas | null,
): Promise<LeituraEscopoAds | RecusaCampanhaAds> {
  if (typeof campanhaId !== 'number' || !Number.isInteger(campanhaId) || campanhaId <= 0) {
    return { recusa: { estado: 'sem_acesso', motivo: 'Identificador de campanha inválido.' } };
  }
  // ponytail: E1 relido aqui; aceitar a listagem já feita pelo chamador quando a rota tiver uma em mãos.
  const motivo = await provarPertencimento(deps, advertiserId, campanhaId, anterior ? [atual, anterior] : [atual]);
  if (motivo) return { recusa: { estado: 'sem_acesso', motivo } };
  return lerComparado((j) => lerBlocoCampanha(deps, campanhaId, j), atual, anterior);
}

// --- Orçamento da leitura (plano §5.5): tetos da aplicação, não limites alegados da API. ---

export const ORCAMENTO_LEITURA_ADS = { concorrencia: 4, paginas: 20, chamadas: 32, prazoMs: 20_000 } as const;
const FALLBACK_RETRY_MS = 1_500;

export interface EstadoLeituraOrcada {
  /** `limite_de_leitura` (teto atingido), `sem_permissao` (403) ou `sem_acesso` (401: reautenticação do chamador). */
  motivo: 'limite_de_leitura' | 'sem_permissao' | 'sem_acesso' | null;
  limite: 'paginas' | 'chamadas' | 'prazo' | null;
}

/**
 * Envolve o fetch do ML num orçamento POR REQUISIÇÃO (somando as janelas atual e anterior, não por janela):
 * máx. 4 simultâneas, 20 páginas (URLs com `offset=`), 32 chamadas incluindo retries, 20 s. `buscar` devolve o corpo
 * ou null, como `DepsLeituraAds.buscar`; o motivo do null fica em `estado()`. Teto atingido é definitivo na
 * requisição, então as leituras ficam `completo: false` e o chamador devolve indisponibilidade (nunca listagem
 * truncada como completa). 429/5xx: 1 repetição, respeitando Retry-After se couber no prazo; 403/401 não repetem.
 * ponytail: E5 (anúncios da campanha, ~13 páginas/janela na Avil) cabe no teto só numa janela; atual+anterior
 * (~26) estoura e a comparação fica indisponível por `limite_de_leitura`, sem truncar.
 */
export function criarLeituraOrcada(cfg: {
  buscar(url: string, sinal?: AbortSignal): Promise<RespostaML>;
  agoraMs(): number;
  esperar(ms: number): Promise<void>;
  /** Agenda `fn` daqui a `ms` e devolve o cancelamento (padrão: setTimeout). */
  agendar?(ms: number, fn: () => void): () => void;
}) {
  const agendar = cfg.agendar ?? ((ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
  const fim = cfg.agoraMs() + ORCAMENTO_LEITURA_ADS.prazoMs;
  let paginas = 0;
  let chamadas = 0;
  let ativas = 0;
  let estado: EstadoLeituraOrcada = { motivo: null, limite: null };
  const fila: (() => void)[] = [];
  const parar = (motivo: EstadoLeituraOrcada['motivo'], limite: EstadoLeituraOrcada['limite'] = null) => {
    estado = estado.motivo ? estado : { motivo, limite }; // o primeiro motivo vale
    return null;
  };
  const vaga = async () => {
    if (ativas < ORCAMENTO_LEITURA_ADS.concorrencia) { ativas++; return; }
    await new Promise<void>((ok) => fila.push(ok)); // a vaga é herdada de quem liberou (ativas não muda)
  };
  const liberar = () => { const prox = fila.shift(); if (prox) prox(); else ativas--; };

  async function uma(url: string): Promise<unknown | null> {
    for (let tentativa = 0; ; tentativa++) {
      if (cfg.agoraMs() >= fim) return parar('limite_de_leitura', 'prazo');
      if (tentativa === 0 && url.includes('offset=')) {
        if (paginas >= ORCAMENTO_LEITURA_ADS.paginas) return parar('limite_de_leitura', 'paginas');
        paginas++;
      }
      if (chamadas >= ORCAMENTO_LEITURA_ADS.chamadas) return parar('limite_de_leitura', 'chamadas');
      chamadas++;
      // O prazo corta a chamada em andamento: aborta o fetch e descarta qualquer corpo que chegue depois.
      const ctl = new AbortController();
      let cancelar = () => {};
      const estouro = new Promise<null>((ok) => {
        cancelar = agendar(Math.max(0, fim - cfg.agoraMs()), () => { ctl.abort(); ok(null); });
      });
      let rr: RespostaML | null;
      try { rr = await Promise.race([cfg.buscar(url, ctl.signal), estouro]); } catch { rr = null; } finally { cancelar(); }
      if (ctl.signal.aborted || cfg.agoraMs() > fim) return parar('limite_de_leitura', 'prazo');
      if (!rr) return null;
      const r = rr;
      const c = classificarResposta(r);
      if (c === 'ok') return r.corpo;
      if (c === 'sem_permissao') return parar('sem_permissao');
      if (c === 'sem_acesso') return parar('sem_acesso');
      if (c !== 'transitorio' || tentativa >= 1) return null;
      const espera = r.retryAfterMs ?? FALLBACK_RETRY_MS;
      if (cfg.agoraMs() + espera >= fim) return parar('limite_de_leitura', 'prazo');
      await cfg.esperar(espera);
    }
  }

  return {
    async buscar(url: string): Promise<unknown | null> {
      if (estado.motivo) return null;
      await vaga();
      try { return estado.motivo ? null : await uma(url); } finally { liberar(); }
    },
    estado: () => estado,
  };
}
