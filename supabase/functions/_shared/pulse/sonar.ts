// Parsers puros do Sonar (ADR-0120). Fontes: /items/{id}/visits/time_window.
// Nenhuma chamada de rede aqui — a edge function orquestra, isto só interpreta.

export interface VisitasJanela { total: number; por_dia: Array<{ data: string; total: number }> }

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

/** Corpo da pulse-sonar-visitas: array de 1..20 item_ids (teto = amostra de 20, D4). Qualquer
 *  coisa fora disso → null (400 no chamador). Dedup preserva a ordem. */
export function validarItemIds(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 20) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string' || x.trim() === '') return null;
    if (!out.includes(x.trim())) out.push(x.trim());
  }
  return out;
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
