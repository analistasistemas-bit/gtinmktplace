// Janela de coleta e calendário do tráfego. Decisões do spike 052: `calendario_trafego = 'brt'`
// (UTC−03:00 fixo, mesma conta de `src/lib/calendario-brt.ts`); `ending` inclusivo e `last=N`
// devolve N+1 dias, então uma janela de 150 dias corridos usa `last=149`.
export const DAY_MS = 86_400_000;
/** BRT é UTC−03:00 fixo (Brasil não tem horário de verão desde 2019). */
export const OFFSET_BRT_MS = 3 * 3_600_000;

const addDays = (dia: string, n: number): string =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** O dia (BRT ou UTC) em que `agora` cai — usado para gravar o preço observado. */
export function diaDeHoje(agora: Date, calendario: 'utc' | 'brt'): string {
  const ms = calendario === 'brt' ? agora.getTime() - OFFSET_BRT_MS : agora.getTime();
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Janela `{desde, ate}` a coletar. Carga inicial: 150 dias corridos terminando hoje. Depois:
 * janela móvel de 7 dias, estendida para trás até o dia seguinte ao último `ok` (sem passar dos
 * 150 dias) para não deixar buraco se a execução ficou parada por mais de uma semana — 1 GET
 * cobre a janela inteira no mesmo custo (spike 052 §4), então estender não tem preço.
 */
export function diasAColetar(p: {
  hoje: string;
  cargaInicialConcluida: boolean;
  ultimoDiaOk: string | null;
}): { desde: string; ate: string } {
  const minimo = addDays(p.hoje, -149);
  if (!p.cargaInicialConcluida) return { desde: minimo, ate: p.hoje };

  let desde = addDays(p.hoje, -6);
  if (p.ultimoDiaOk) {
    const gapDesde = addDays(p.ultimoDiaOk, 1);
    if (gapDesde < desde) desde = gapDesde;
  }
  if (desde < minimo) desde = minimo;
  return { desde, ate: p.hoje };
}

/** `last`/`ending` para `GET /items/{id}/visits/time_window` a partir da janela `{desde, ate}`. */
export function parametrosJanela(p: { desde: string; ate: string }): { last: number; ending: string } {
  const dias = Math.round((Date.parse(`${p.ate}T00:00:00Z`) - Date.parse(`${p.desde}T00:00:00Z`)) / DAY_MS) + 1;
  return { last: dias - 1, ending: p.ate };
}
