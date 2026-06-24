export type PeriodoDias = 7 | 30 | 90;

/** Período selecionado: preset (7/30/90) ou intervalo de datas livre (YYYY-MM-DD). */
export type Periodo =
  | { tipo: 'preset'; dias: PeriodoDias }
  | { tipo: 'range'; desde: string; ate: string };

/** Janela resolvida em ISO 8601 (limites inclusive) para filtrar as vendas. */
export interface Janela { desde: string; ate: string }

/** Calcula a janela ISO a partir do período (preset → agora−dias…agora; range → dia inteiro). */
export function resolverJanela(p: Periodo): Janela {
  if (p.tipo === 'preset') {
    const ate = new Date();
    const desde = new Date(ate.getTime() - p.dias * 24 * 60 * 60 * 1000);
    return { desde: desde.toISOString(), ate: ate.toISOString() };
  }
  const desde = new Date(`${p.desde}T00:00:00`);
  const ate = new Date(`${p.ate}T23:59:59.999`);
  if (Number.isNaN(desde.getTime()) || Number.isNaN(ate.getTime())) {
    // range incompleto/inválido (ex.: "Personalizado" sem datas preenchidas): janela vazia,
    // a tela mostra zeros sem quebrar.
    const agora = new Date().toISOString();
    return { desde: agora, ate: agora };
  }
  return { desde: desde.toISOString(), ate: ate.toISOString() };
}

/** Serializa o período para query string (?dias=30 ou ?de=…&ate=…). */
export function periodoToParams(p: Periodo): Record<string, string> {
  return p.tipo === 'preset' ? { dias: String(p.dias) } : { de: p.desde, ate: p.ate };
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Lê o período de uma fonte de params (ex.: URLSearchParams.get). Default 30 dias. */
export function periodoFromParams(get: (k: string) => string | null): Periodo {
  const de = get('de');
  const ate = get('ate');
  if (de && ate && DATA_RE.test(de) && DATA_RE.test(ate) && de <= ate) {
    return { tipo: 'range', desde: de, ate };
  }
  const dias = Number(get('dias'));
  if (dias === 7 || dias === 30 || dias === 90) return { tipo: 'preset', dias };
  return { tipo: 'preset', dias: 30 };
}
