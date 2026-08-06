export type PeriodoDias = 7 | 30 | 90;

/** Período selecionado: hoje, mês atual, preset (7/30/90) ou intervalo de datas livre. */
export type Periodo =
  | { tipo: 'hoje' }
  | { tipo: 'mes_atual' }
  | { tipo: 'preset'; dias: PeriodoDias }
  | { tipo: 'range'; desde: string; ate: string };

/** Janela resolvida em ISO 8601 (limites inclusive) para filtrar as vendas. */
export interface Janela { desde: string; ate: string }

/** Data YYYY-MM-DD do instante no fuso LOCAL. `iso.slice(0, 10)` responde em UTC e, em fuso
 *  negativo (BRT = -03), o fim de um dia local (23:59:59.999) já caiu no dia seguinte em UTC —
 *  o que fazia um range terminando ONTEM parecer terminar HOJE. */
export function diaLocal(instante: string | Date): string {
  const d = typeof instante === 'string' ? new Date(instante) : instante;
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Calcula a janela ISO a partir do período (hoje → meia-noite local…agora; preset →
 *  agora−dias…agora; range → dia inteiro). */
export function resolverJanela(p: Periodo): Janela {
  if (p.tipo === 'hoje') {
    const ate = new Date();
    const desde = new Date(ate);
    desde.setHours(0, 0, 0, 0);
    return { desde: desde.toISOString(), ate: ate.toISOString() };
  }
  if (p.tipo === 'mes_atual') {
    const ate = new Date();
    const desde = new Date(ate.getFullYear(), ate.getMonth(), 1);
    return { desde: desde.toISOString(), ate: ate.toISOString() };
  }
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

/** Janela imediatamente anterior. Presets/range: mesma duração, encostada no início da atual
 *  ([desde - dur, desde]). 'hoje': a janela cresce o dia todo, então deslocar pela duração
 *  decorrida não dá "ontem" — dá um pedaço colado à meia-noite. Usa o dia anterior no mesmo ponto
 *  do relógio. 'mes_atual': dias INTEIROS do mês anterior (não a mesma hora) — decisão do Diego
 *  pra bater com o card "Personalizado" e não oscilar por causa de 1 pedido de madrugada; o dia
 *  corrente do mês atual, ainda incompleto, segue sendo comparado contra o mês anterior inteiro
 *  até o dia correspondente (subestima o crescimento enquanto o dia não fecha, aceito). */
export function janelaAnterior(j: Janela, p?: Periodo): Janela {
  if (p?.tipo === 'hoje') {
    const DIA_MS = 24 * 60 * 60 * 1000;
    return {
      desde: new Date(Date.parse(j.desde) - DIA_MS).toISOString(),
      ate: new Date(Date.parse(j.ate) - DIA_MS).toISOString(),
    };
  }
  if (p?.tipo === 'mes_atual') {
    const agora = new Date(j.ate);
    const ano = agora.getFullYear();
    const mes = agora.getMonth();
    const ultimoDiaMesAnterior = new Date(ano, mes, 0).getDate();
    const dia = Math.min(agora.getDate(), ultimoDiaMesAnterior); // clampa 31/mar → 28/fev
    return {
      desde: new Date(ano, mes - 1, 1, 0, 0, 0, 0).toISOString(),
      ate: new Date(ano, mes - 1, dia, 23, 59, 59, 999).toISOString(),
    };
  }
  const desdeMs = Date.parse(j.desde);
  const dur = Date.parse(j.ate) - desdeMs;
  return { desde: new Date(desdeMs - dur).toISOString(), ate: new Date(desdeMs).toISOString() };
}

/** Texto do comparativo dos KPIs. Em 'hoje' a janela anterior é ONTEM ATÉ A MESMA HORA do
 *  relógio (ver `janelaAnterior`), e o rótulo genérico "vs. anterior" era lido como "ontem
 *  fechado": às 11h, +27% sobre as vendas de ontem até as 11h parecia erro de cálculo diante de
 *  um ontem que fechou 3x maior. Os demais períodos comparam blocos equivalentes e seguem
 *  genéricos. */
export function rotuloAnterior(p?: Periodo): string {
  return p?.tipo === 'hoje' ? 'vs. ontem até agora' : 'vs. anterior';
}

/** Serializa o período para query string (?periodo=hoje, ?dias=30 ou ?de=…&ate=…). */
export function periodoToParams(p: Periodo): Record<string, string> {
  if (p.tipo === 'hoje') return { periodo: 'hoje' };
  if (p.tipo === 'mes_atual') return { periodo: 'mes_atual' };
  return p.tipo === 'preset' ? { dias: String(p.dias) } : { de: p.desde, ate: p.ate };
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Lê o período de uma fonte de params (ex.: URLSearchParams.get). Default 30 dias. */
export function periodoFromParams(get: (k: string) => string | null): Periodo {
  if (get('periodo') === 'hoje') return { tipo: 'hoje' };
  if (get('periodo') === 'mes_atual') return { tipo: 'mes_atual' };
  const de = get('de');
  const ate = get('ate');
  if (de && ate && DATA_RE.test(de) && DATA_RE.test(ate) && de <= ate) {
    return { tipo: 'range', desde: de, ate };
  }
  const dias = Number(get('dias'));
  if (dias === 7 || dias === 30 || dias === 90) return { tipo: 'preset', dias };
  return { tipo: 'preset', dias: 30 };
}
