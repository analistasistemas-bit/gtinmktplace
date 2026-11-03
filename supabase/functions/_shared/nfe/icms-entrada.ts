// Pré-preenchimento fiscal da nota — classifica o ICMS da ENTRADA (fornecedor) e sugere o CSOSN de
// saída. Puro (front e edge). Regras do contador da Daludi (2026-11-03), ADR-0181 D-10.
import type { ItemNotaLido } from './tipos.ts';
import { CSOSN_VALIDOS } from '../fiscal/validar.ts';

export type ClasseIcmsEntrada = 'st' | 'sem_st' | 'excecao';

const CSOSN_ST = ['201', '202', '203', '500'];
const CSOSN_SEM_ST = ['101', '102'];
const CST_ST = ['10', '30', '60', '70'];
const CST_SEM_ST = ['00', '20'];

export function classificarIcmsEntrada(i: Pick<ItemNotaLido, 'icmsGrupo' | 'csosn' | 'cstIcms'>): ClasseIcmsEntrada {
  if (i.icmsGrupo === 'ICMSST') return 'st';
  if (i.csosn !== null) return CSOSN_ST.includes(i.csosn) ? 'st' : CSOSN_SEM_ST.includes(i.csosn) ? 'sem_st' : 'excecao';
  if (i.cstIcms !== null) return CST_ST.includes(i.cstIcms) ? 'st' : CST_SEM_ST.includes(i.cstIcms) ? 'sem_st' : 'excecao';
  return 'excecao';
}

/** CSOSN de saída sugerido; exceção nunca tem sugestão (analisar caso a caso). */
export function csosnSaidaSugerido(classe: ClasseIcmsEntrada, padrao: string | null): string | null {
  if (classe === 'st') return '500';
  if (classe === 'sem_st' && padrao !== null && (CSOSN_VALIDOS as readonly string[]).includes(padrao)) return padrao;
  return null;
}
