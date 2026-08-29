// Vendas mensais estimadas por vendedor (ADR-0142): delta de transactions.total na janela
// móvel de 365d do ML, extrapolado para 30 dias. Função pura — sem I/O.

export type SnapshotVendedor = { seller_id: string; transactions_total: number; dia: string };

export type VendasMensais =
  | { estado: 'valor'; vendas_mes: number; dias_janela: number }
  | { estado: 'sem_estimativa_no_periodo' }
  | { estado: 'serie_insuficiente' };

/** Normaliza seller_id na fronteira (DB usa bigint; Map usa string). */
export function normalizarSellerId(id: string | number): string {
  return String(id);
}

/** Agrupa snapshots por vendedor, ordenados por dia ascendente. */
export function agruparSeriePorVendedor(
  serie: Array<{ seller_id: string | number; transactions_total: number; dia: string }>,
): Map<string, SnapshotVendedor[]> {
  const porVendedor = new Map<string, SnapshotVendedor[]>();
  for (const snap of serie) {
    const sellerId = normalizarSellerId(snap.seller_id);
    const linha: SnapshotVendedor = {
      seller_id: sellerId,
      transactions_total: snap.transactions_total,
      dia: snap.dia,
    };
    const bucket = porVendedor.get(sellerId);
    if (bucket) bucket.push(linha);
    else porVendedor.set(sellerId, [linha]);
  }
  for (const snaps of porVendedor.values()) {
    snaps.sort((a, b) => a.dia.localeCompare(b.dia));
  }
  return porVendedor;
}

/** Dias de calendário entre dois `dia` (YYYY-MM-DD ou ISO); mesmo dia → 1 (evita div/0). */
export function diasDecorridos(primeiroDia: string, ultimoDia: string): number {
  const d0 = parseDia(primeiroDia);
  const d1 = parseDia(ultimoDia);
  const diff = Math.round((d1.getTime() - d0.getTime()) / 86_400_000);
  // Coletor pode gravar dois pontos no mesmo dia; extrapolação precisa de denominador ≥ 1.
  return diff <= 0 ? 1 : diff;
}

function parseDia(dia: string): Date {
  const dateOnly = dia.slice(0, 10);
  const [y, m, d] = dateOnly.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function estimarDeSerieOrdenada(snaps: SnapshotVendedor[]): VendasMensais {
  if (snaps.length < 2) return { estado: 'serie_insuficiente' };

  const primeiro = snaps[0];
  const ultimo = snaps[snaps.length - 1];
  const delta = ultimo.transactions_total - primeiro.transactions_total;

  if (delta < 0) return { estado: 'sem_estimativa_no_periodo' };

  const diasJanela = diasDecorridos(primeiro.dia, ultimo.dia);
  const vendasMes = (delta / diasJanela) * 30;
  return { estado: 'valor', vendas_mes: vendasMes, dias_janela: diasJanela };
}

/** Estima vendas/mês por vendedor a partir da série de snapshots (D-3 a D-5). */
export function estimarVendasMensais(
  serie: Array<{ seller_id: string | number; transactions_total: number; dia: string }>,
): Map<string, VendasMensais> {
  const agrupado = agruparSeriePorVendedor(serie);
  const out = new Map<string, VendasMensais>();
  for (const [sellerId, snaps] of agrupado) {
    out.set(sellerId, estimarDeSerieOrdenada(snaps));
  }
  return out;
}

/** Agregação do universo (D-6): mediana dos valores — nunca média aritmética. */
export function medianaVendasMensaisDoUniverso(resultados: Map<string, VendasMensais>): number | null {
  const valores: number[] = [];
  for (const r of resultados.values()) {
    if (r.estado === 'valor') valores.push(r.vendas_mes);
  }
  if (valores.length === 0) return null;
  valores.sort((a, b) => a - b);
  const mid = Math.floor(valores.length / 2);
  if (valores.length % 2 === 0) return (valores[mid - 1] + valores[mid]) / 2;
  return valores[mid];
}
