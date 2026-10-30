// Leitura paginada de campanhas por período (E1, plano ads-redesign §5.4). `buscar` é injetado: devolve o corpo
// JSON ou null em falha. Sem cache, orçamento ou autorização (camadas acima). Nunca lança.
import {
  parseMetricasResumo, urlContaResumo,
  type BlocoAdsMetricas, type CampanhaPeriodoAds, type JanelaAdsMetricas, type MetricaBrutaAds, type ValorAds,
} from './metricas.ts';

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
