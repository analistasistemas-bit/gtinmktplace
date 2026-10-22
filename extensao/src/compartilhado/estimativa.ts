// Estimativa de vendas acumuladas (ADR-0189 D-9), modelo do Avant (index.js@1232824, módulo 98069): centro da faixa
// pública, avaliações × 15, ajuste por idade, Premium × 1,15, sempre recortado na faixa. Única mudança: os patamares
// são os do ML medidos em 22/10/2026 (o Avant usa 10/20/200/20mil, que a página não mostra, e não tem 25/750mil).
// Só é exibida se a validação contra vendas reais (Task 13, scripts/validar-estimativa-vendas.ts) passar no gate.

const PATAMARES = [1, 5, 25, 50, 100, 500, 1000, 5000, 10000, 50000, 100000, 250000, 500000, 750000];
const EXATO_ATE = 4;
const VENDAS_POR_AVALIACAO = 15;

const recortar = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Faixa pública de um total exato: 1–4 exato, senão o maior patamar ≤ total. Zero → null. */
export function faixaDoTotal(total: number): number | null {
  if (!Number.isFinite(total) || total < 1) return null;
  if (total <= EXATO_ATE) return Math.floor(total);
  return PATAMARES.filter((p) => p <= total).at(-1) ?? null;
}

export function estimarVendas(
  { piso, avaliacoes, criadoEm, premium }: { piso: number | null; avaliacoes: number; criadoEm: string | null; premium: boolean },
  agora = new Date(),
): number | null {
  if (piso === null) return null;
  if (Number.isInteger(piso) && piso >= 1 && piso <= EXATO_ATE) return piso;
  const i = PATAMARES.indexOf(piso);
  if (i < 0) return null;
  const min = piso;
  const max = i === PATAMARES.length - 1 ? min : PATAMARES[i + 1] - 1; // último patamar sem teto: fica no piso

  const centro = Math.round((min + max) / 2);
  const t = criadoEm ? new Date(criadoEm).getTime() : NaN;
  const meses = Number.isFinite(t) ? Math.max(0, Math.floor((agora.getTime() - t) / 86_400_000)) / 30.44 : null;
  const ajuste = meses === null ? 0 : meses < 6 ? 0.15 : meses <= 12 ? 0 : -0.25;

  const porFaixa = recortar(centro * (1 + ajuste), min, max);
  const porAvaliacoes = avaliacoes > 0 ? recortar(recortar(avaliacoes * VENDAS_POR_AVALIACAO, min, max) * (1 + ajuste), min, max) : null;
  const k = Math.round(porAvaliacoes !== null ? 0.6 * porAvaliacoes + 0.4 * porFaixa : porFaixa);
  return Math.round(recortar(premium ? Math.round(1.15 * k) : k, min, max));
}
