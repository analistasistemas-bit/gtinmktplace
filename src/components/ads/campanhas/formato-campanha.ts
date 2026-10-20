import { ROTULO_MOTIVO, type CampanhaVista } from '@/lib/ads-campanhas';

/** Percentual já em pontos (32,5 = 32,5%), no máximo 1 casa, vírgula pt-BR. */
export const fmtPontos = (v: number) => `${Number(v.toFixed(1)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

export const motivoLegivel = (m: string | null) => (m ? ROTULO_MOTIVO[m] ?? m : 'Sem referência');

const ESTRATEGIA: Record<string, string> = { PROFITABILITY: 'Rentabilidade' };
export const rotuloEstrategia = (e: string | null) => (e == null ? null : ESTRATEGIA[e] ?? e);

/** Famílias (em qualquer campanha) com ao menos um alerta: o número do selo da aba e do filtro. */
export const contarFamiliasEmAlerta = (campanhas: CampanhaVista[] | null) =>
  (campanhas ?? []).reduce((s, c) => s + c.familias.filter(f => f.alertas.length > 0).length, 0);

