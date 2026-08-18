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
