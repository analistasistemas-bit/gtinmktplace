// Parsers puros do Sonar (ADR-0120). Fontes: /products/search, /items/{id}/visits/time_window.
// Nenhuma chamada de rede aqui — a edge function orquestra, isto só interpreta.

export interface FichaBusca { product_id: string; nome: string; domain_id: string | null }
export interface VisitasJanela { total: number; por_dia: Array<{ data: string; total: number }> }

export function parseFichasBusca(json: unknown): FichaBusca[] {
  const results = (json as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: FichaBusca[] = [];
  for (const r of results) {
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.name !== 'string') continue;
    out.push({ product_id: o.id, nome: o.name, domain_id: typeof o.domain_id === 'string' ? o.domain_id : null });
  }
  return out;
}

export function parseVisitasJanela(json: unknown): VisitasJanela | null {
  const d = json as { total_visits?: unknown; results?: unknown[] } | null;
  if (typeof d?.total_visits !== 'number') return null;
  const por_dia = (Array.isArray(d.results) ? d.results : [])
    .map((r) => {
      const o = r as Record<string, unknown>;
      if (typeof o.date !== 'string' || typeof o.total !== 'number') return null;
      return { data: o.date.slice(0, 10), total: o.total };
    })
    .filter((x): x is { data: string; total: number } => x !== null);
  return { total: d.total_visits, por_dia };
}

/**
 * Multiget `/items?ids=...&attributes=id,date_created` — sonda de Grupo C (D9/ADR-0125). Mesmos
 * envelopes `{code, body}` do multiget de status (`parseStatusAnuncios`, `parse.ts:89-108`): só
 * `code === 200` com `date_created` string entra; item 403/sem data fica de fora do mapa (não é
 * erro do parser, o call site decide o que fazer com a ausência).
 */
export function parseDateCreatedMultiget(json: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(json)) return out;
  for (const r of json) {
    const env = r as { code?: unknown; body?: unknown };
    if (env?.code !== 200) continue;
    const b = env.body as Record<string, unknown> | null;
    const id = typeof b?.id === 'string' ? b.id : null;
    const dataCreated = typeof b?.date_created === 'string' ? b.date_created : null;
    if (!id || !dataCreated) continue;
    out.set(id, dataCreated);
  }
  return out;
}

/** Resultado de UM lote da sonda: 'forbidden' = 403 no lote inteiro ou em todos os envelopes;
 *  'transitoria' = timeout/rede/5xx (não prova nada sobre a hipótese); 'ok' = respondeu (com ou
 *  sem `date_created` casando). */
export type OutcomeLoteSonda = 'ok' | 'forbidden' | 'transitoria';

/**
 * Decide se a sonda de Grupo C desliga (D9/ADR-0125): só quando TODOS os lotes voltaram 403 —
 * nenhum sucesso, nenhuma falha transitória misturada no meio. Um 403 ao lado de um timeout NÃO
 * desliga (a falha transitória não prova nada sobre a hipótese); um 403 ao lado de um lote que
 * funcionou também não (a hipótese não falhou de vez).
 */
export function sondaDeveDesligar(outcomes: OutcomeLoteSonda[]): boolean {
  return outcomes.length > 0 && outcomes.every((o) => o === 'forbidden');
}

const STOPWORDS = new Set(['de', 'do', 'da', 'para', 'com', 'em', 'e', 'o', 'a', 'un', 'kit', 'cm', 'mm']);

export function extrairPalavrasChave(nomes: string[], limite = 20): Array<{ termo: string; contagem: number }> {
  const contagem = new Map<string, number>();
  for (const nome of nomes) {
    const vistos = new Set<string>();
    for (const bruto of nome.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      const termo = bruto.trim();
      if (termo.length < 3 || STOPWORDS.has(termo) || vistos.has(termo)) continue;
      vistos.add(termo); // conta por ficha, não por repetição no mesmo nome
      contagem.set(termo, (contagem.get(termo) ?? 0) + 1);
    }
  }
  return [...contagem.entries()]
    .map(([termo, n]) => ({ termo, contagem: n }))
    .sort((a, b) => b.contagem - a.contagem || a.termo.localeCompare(b.termo))
    .slice(0, limite);
}

export function resumoPrecos(precos: number[]): { min: number; mediana: number; max: number } | null {
  if (precos.length === 0) return null;
  const s = [...precos].sort((a, b) => a - b);
  const meio = Math.floor(s.length / 2);
  const mediana = s.length % 2 === 1 ? s[meio] : (s[meio - 1] + s[meio]) / 2;
  return { min: s[0], mediana, max: s[s.length - 1] };
}

// Painel Sonar (ADR-0120): tudo que a edge coleta por ficha, exceto product_id/nome/domain_id
// (já vêm de parseFichasBusca). montarPainelSonar zipa os dois pela ordem — a edge processa
// as fichas na mesma ordem em que parseFichasBusca as devolve.
export interface ResultadoFicha {
  category_id: string | null;
  ofertas: number;
  preco: { min: number; mediana: number; max: number } | null;
  frete_gratis_pct: number;
  visitas_30d: number | null;
  visitas_por_dia: Array<{ data: string; total: number }>;
  vendedores: Array<{ seller_id: number; uf: string | null; transacoes_total: number | null; loja_oficial: boolean }>;
  /** item_id (= idPublicacao no dataset Apify) de cada oferta da ficha, na ordem do ML — chave
   *  primária do cruzamento ficha↔anúncio no front (D4/ADR-0125). Ficha sem oferta → []. */
  item_ids: string[];
  /** Grupo C (D9/ADR-0125): `date_created` do mesmo item mais barato cujas visitas já medimos,
   *  via sonda multiget best-effort. `null` = sonda desligada (flag 403), falhou, ou ficha sem
   *  oferta — nunca derruba a tela, a coluna só some (D9). */
  criado_em: string | null;
}

export interface PainelSonar {
  termo: string;
  gerado_em: string;
  total_catalogo: number;
  fichas: Array<{ product_id: string; nome: string } & ResultadoFicha>;
  agregado: {
    visitas_30d_total: number;
    visitas_por_dia: Array<{ data: string; total: number }>;
    ofertas_total: number;
    vendedores_distintos: number;
    frete_gratis_pct: number;
  };
  palavras_chave: Array<{ termo: string; contagem: number }>;
}

/**
 * Agregador puro: nenhuma chamada de rede. Recebe a busca crua (para total_catalogo) e um
 * resultado por ficha, na mesma ordem de parseFichasBusca(busca).
 *
 * visitas_30d null = endpoint falhou para aquele item — NUNCA soma como zero (some(v!=null)),
 * senão um garimpo com falhas parciais mostraria um total mais baixo do que o real.
 */
export function montarPainelSonar(termo: string, busca: unknown, resultados: ResultadoFicha[]): PainelSonar {
  const totalCatalogo = (busca as { paging?: { total?: unknown } } | null)?.paging?.total;
  const fichas = parseFichasBusca(busca).map((f, i) => {
    const r = resultados[i];
    return { product_id: f.product_id, nome: f.nome, ...r };
  });

  const visitasPorData = new Map<string, number>();
  const vendedoresDistintos = new Set<number>();
  let visitas30dTotal = 0;
  let ofertasTotal = 0;
  let freteSomaPonderada = 0;

  for (const ficha of fichas) {
    if (ficha.visitas_30d != null) visitas30dTotal += ficha.visitas_30d;
    for (const dia of ficha.visitas_por_dia) {
      visitasPorData.set(dia.data, (visitasPorData.get(dia.data) ?? 0) + dia.total);
    }
    ofertasTotal += ficha.ofertas;
    freteSomaPonderada += (ficha.frete_gratis_pct / 100) * ficha.ofertas;
    for (const v of ficha.vendedores) vendedoresDistintos.add(v.seller_id);
  }

  return {
    termo,
    gerado_em: new Date().toISOString(),
    total_catalogo: typeof totalCatalogo === 'number' ? totalCatalogo : 0,
    fichas,
    agregado: {
      visitas_30d_total: visitas30dTotal,
      visitas_por_dia: [...visitasPorData.entries()]
        .map(([data, total]) => ({ data, total }))
        .sort((a, b) => a.data.localeCompare(b.data)),
      ofertas_total: ofertasTotal,
      vendedores_distintos: vendedoresDistintos.size,
      frete_gratis_pct: ofertasTotal > 0 ? Math.round((freteSomaPonderada / ofertasTotal) * 100) : 0,
    },
    palavras_chave: extrairPalavrasChave(fichas.map((f) => f.nome)),
  };
}
