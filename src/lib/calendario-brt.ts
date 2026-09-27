// ponytail: BRT fixo em UTC−03:00 (o Brasil não tem horário de verão desde 2019). Se voltar a ter,
// trocar por Intl.DateTimeFormat com timeZone 'America/Sao_Paulo'.
const OFFSET_MS = 3 * 3_600_000;
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export type Passo = 'semana' | 'mes';
/** Intervalo meio-aberto `[inicio, fim)` em ISO. `incompleto` = ainda não terminou em `agora`;
 *  `inicioParcial` = começa antes de `desde` (a 1ª semana/mês vai além do período escolhido). */
export interface Intervalo { inicio: string; fim: string; rotulo: string; incompleto: boolean; inicioParcial: boolean }

/** "Relógio de parede" BRT como Date UTC (getUTC* = campos BRT). */
const brt = (ms: number) => new Date(ms - OFFSET_MS);
const deBrt = (d: Date) => new Date(d.getTime() + OFFSET_MS);

function inicioDe(ms: number, passo: Passo): Date {
  const d = brt(ms);
  d.setUTCHours(0, 0, 0, 0);
  if (passo === 'mes') d.setUTCDate(1);
  else d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // segunda
  return d;
}
function proximo(d: Date, passo: Passo): Date {
  const n = new Date(d);
  if (passo === 'mes') n.setUTCMonth(n.getUTCMonth() + 1); else n.setUTCDate(n.getUTCDate() + 7);
  return n;
}
const dd = (n: number) => String(n).padStart(2, '0');

/** Semanas (segunda a domingo) ou meses civis em BRT que cobrem `[desde, ate]`. */
export function intervalosBRT(desde: string, ate: string, passo: Passo, agora: Date = new Date()): Intervalo[] {
  const out: Intervalo[] = [];
  const fimMs = Date.parse(ate);
  for (let d = inicioDe(Date.parse(desde), passo); deBrt(d).getTime() <= fimMs; d = proximo(d, passo)) {
    const inicio = deBrt(d); const fim = deBrt(proximo(d, passo));
    out.push({
      inicio: inicio.toISOString(), fim: fim.toISOString(),
      rotulo: passo === 'mes' ? `${MESES[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}` : `${dd(d.getUTCDate())}/${dd(d.getUTCMonth() + 1)}`,
      incompleto: fim.getTime() > agora.getTime(),
      inicioParcial: inicio.getTime() < Date.parse(desde),
    });
  }
  return out;
}
