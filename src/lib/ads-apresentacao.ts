// Apresentação do painel de Ads (ADR-0179): formatos, textos de motivo e filtros do ranking. Não recalcula
// nada do domínio — os filtros só leem o semáforo que `montarPainelAds` já entregou.
import type { FamiliaPainel, MotivoFamilia } from '@/lib/ads-painel';
import { dataBRT } from '@/components/sku-dossie/formato-dossie';

export const NADA = '—';
export const pct = (v: number | null) => (v == null ? NADA : `${(v * 100).toFixed(1).replace('.', ',')}%`);
export const razao = (v: number | null) => (v == null ? NADA : `${v.toFixed(2).replace('.', ',')}×`);

const MOTIVO: Record<Exclude<MotivoFamilia, null>, string> = {
  compartilhado: 'gasto compartilhado com outra família',
  cobertura: 'coleta de Ads incompleta no período',
  historico: 'período antes do histórico de vendas',
  sem_vendas: 'sem vendas no período',
  sem_custo: 'sem custo cadastrado',
  custo_parcial: 'custo parcial: sem semáforo',
};

export const textoMotivo = (m: Exclude<MotivoFamilia, null>, historicoDesde: string | null) =>
  m === 'historico' && historicoDesde ? `${MOTIVO.historico} (desde ${dataBRT(historicoDesde)})` : MOTIVO[m];

export type FiltroFamiliasAds =
  | 'todas'
  | 'atencao'
  | 'dentro'
  | 'sem_referencia';

export interface ContagemFamiliasAds {
  total: number;
  acima: number;
  semEspaco: number;
  dentro: number;
  semReferencia: number;
}

export function contarFamiliasAds(
  familias: readonly FamiliaPainel[],
  liberado: boolean,
): ContagemFamiliasAds {
  const contagem: ContagemFamiliasAds = {
    total: familias.length,
    acima: 0,
    semEspaco: 0,
    dentro: 0,
    semReferencia: 0,
  };

  for (const familia of familias) {
    const estado = liberado ? familia.semaforo : null;
    if (estado === 'acima') contagem.acima++;
    else if (estado === 'sem_espaco') contagem.semEspaco++;
    else if (estado === 'dentro') contagem.dentro++;
    else contagem.semReferencia++;
  }

  return contagem;
}

export function filtrarFamiliasAds(
  familias: readonly FamiliaPainel[],
  filtro: FiltroFamiliasAds,
  liberado: boolean,
): FamiliaPainel[] {
  return familias.filter(familia => {
    const estado = liberado ? familia.semaforo : null;

    if (filtro === 'todas') return true;
    if (filtro === 'atencao') return estado === 'acima' || estado === 'sem_espaco';
    if (filtro === 'dentro') return estado === 'dentro';
    return estado === null;
  });
}
