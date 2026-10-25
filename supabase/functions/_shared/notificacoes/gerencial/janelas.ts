// Janelas de tempo em America/Sao_Paulo (offset fixo -03:00, ADR-0190 D-3). Aritmética em UTC, sem Intl.
// Intervalos são [desde, ate). Paridade com `resolverJanela`/`janelaAnterior` de src/lib/metricas.ts.
export interface JanelaIso { desde: string; ate: string }
export interface JanelasMes { mes: JanelaIso; anterior: JanelaIso; rotuloMes: string; rotuloAnterior: string }

const BRT_MS = 3 * 3600_000;
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const p2 = (n: number) => String(n).padStart(2, '0');
const inicioDia = (dia: string) => `${dia}T00:00:00-03:00`;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const utc = (a: number, m: number, d: number) => new Date(Date.UTC(a, m, d));

/** Dia `YYYY-MM-DD` do instante em BRT. */
export function diaBrt(instante: Date): string {
  return ymd(new Date(instante.getTime() - BRT_MS));
}

/** `HH:MM` do instante em BRT. */
export function horaBrt(instante: Date): string {
  return new Date(instante.getTime() - BRT_MS).toISOString().slice(11, 16);
}

export function janelaDia(dia: string): JanelaIso {
  const [a, m, d] = dia.split('-').map(Number);
  return { desde: inicioDia(dia), ate: inicioDia(ymd(utc(a, m - 1, d + 1))) };
}

// Mês anterior de `dia`: dia 1 até o fim do dia correspondente (clamp no último dia do mês anterior).
function janelaMesAnterior(a: number, m: number, d: number): { janela: JanelaIso; rotulo: string } {
  const ultimo = utc(a, m, 0).getUTCDate(); // último dia do mês anterior (m é 0-based do mês corrente)
  const dc = Math.min(d, ultimo);
  const ant = utc(a, m - 1, 1);
  return {
    janela: { desde: inicioDia(ymd(ant)), ate: inicioDia(ymd(utc(a, m - 1, dc + 1))) },
    rotulo: `1–${dc}/${ABREV[ant.getUTCMonth()]}`,
  };
}

function montar(dia: string, ate: string): JanelasMes {
  const [a, m, d] = dia.split('-').map(Number);
  const ant = janelaMesAnterior(a, m - 1, d);
  return {
    mes: { desde: inicioDia(`${a}-${p2(m)}-01`), ate },
    anterior: ant.janela,
    rotuloMes: MESES[m - 1],
    rotuloAnterior: ant.rotulo,
  };
}

/** Mês corrente: dia 1 00:00 BRT até `agora`. */
export function janelasMesCorrente(agora: Date): JanelasMes {
  return montar(diaBrt(agora), agora.toISOString());
}

/** Mês de `dia`, do dia 1 até o fim de `dia`. */
export function janelasMesFechado(dia: string): JanelasMes {
  return montar(dia, janelaDia(dia).ate);
}
