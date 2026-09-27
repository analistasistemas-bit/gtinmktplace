// Janela de coleta de Ads (Fatia 2c, spike 053). Dia = data literal do ML (BRT, "10:00 GMT-3").
// Carga inicial: [hoje−90, hoje−1] — o máximo aceito (> 90 dias → 400). Dia a dia: [hoje−15, hoje−1]
// (D-1 + 14 dias de releitura, porque as vendas atribuídas mudam por 14 dias). Hoje nunca: o ML já o
// devolve parcial.
import { DAY_MS } from '../trafego/janelas.ts';

export const DIAS_CARGA = 90;
export const DIAS_RELEITURA = 15;

export interface JanelaAds { desde: string; ate: string }

const somar = (dia: string, n: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export function janelaAds(p: { hoje: string; cargaInicialOk: boolean; ultimoOkDia: string | null }): JanelaAds {
  const ate = somar(p.hoje, -1);
  const minimo = somar(p.hoje, -DIAS_CARGA);
  if (!p.cargaInicialOk) return { desde: minimo, ate };
  let desde = somar(p.hoje, -DIAS_RELEITURA);
  // Worker parado: na última leitura ok (dia U) os dias ≥ U−14 ainda estavam em aberto.
  if (p.ultimoOkDia) {
    const doUltimo = somar(p.ultimoOkDia, -(DIAS_RELEITURA - 1));
    if (doUltimo < desde) desde = doUltimo;
  }
  return { desde: desde < minimo ? minimo : desde, ate };
}
