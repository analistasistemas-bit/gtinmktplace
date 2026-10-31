// Apresentação do painel de Ads (ADR-0179): formatos, textos de motivo e filtros do ranking. Não recalcula
// nada do domínio — os filtros só leem o semáforo que `montarPainelAds` já entregou.
import type { FamiliaPainel, MotivoFamilia } from '@/lib/ads-painel';
import { normalizarParaBusca } from '@/lib/texto';
import { dataBRT } from '@/components/sku-dossie/formato-dossie';

export const NADA = '—';
export const pct = (v: number | null) => (v == null ? NADA : `${(v * 100).toFixed(1).replace('.', ',')}%`);
export const razao = (v: number | null) => (v == null ? NADA : `${v.toFixed(2).replace('.', ',')}×`);

const MOTIVO: Record<Exclude<MotivoFamilia, null>, string> = {
  compartilhado: 'gasto compartilhado com outra família',
  cobertura: 'coleta de Ads incompleta no período',
  historico: 'período antes do histórico de vendas',
  fiscal: 'resultado indisponível: confirme as alíquotas em Configurações',
  sem_vendas: 'sem vendas no período',
  sem_custo: 'sem custo cadastrado',
  custo_parcial: 'custo parcial: sem semáforo',
};

export const textoMotivo = (m: Exclude<MotivoFamilia, null>, historicoDesde: string | null) =>
  m === 'historico' && historicoDesde ? `${MOTIVO.historico} (desde ${dataBRT(historicoDesde)})` : MOTIVO[m];

export type FiltroFamiliasAds =
  | 'todas'
  | 'atencao'
  | 'acima'
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
    if (filtro === 'acima') return estado === 'acima';
    if (filtro === 'atencao') return estado === 'acima' || estado === 'sem_espaco';
    if (filtro === 'dentro') return estado === 'dentro';
    return estado === null;
  });
}

/** Busca por nome ou código da família (sem acento/caixa). Só reduz a lista: as contagens vêm da lista inteira. */
export function buscarFamiliasAds(familias: readonly FamiliaPainel[], termo: string): FamiliaPainel[] {
  const t = normalizarParaBusca(termo);
  if (!t) return [...familias];
  return familias.filter(f => normalizarParaBusca(`${f.codigoPai} ${f.nome ?? ''}`).includes(t));
}

export type ColunaFamiliasAds = 'nome' | 'investimento' | 'acos_direto' | 'equilibrio' | 'resultado';
export type DirecaoAds = 'asc' | 'desc';

const VALOR_COLUNA: Record<ColunaFamiliasAds, (f: FamiliaPainel) => number | string | null> = {
  nome: f => f.nome?.trim() || null,
  investimento: f => f.custo,
  acos_direto: f => f.acosDireto,
  equilibrio: f => f.acosEquilibrio,
  resultado: f => f.resultado,
};

/** Ordenação estável (empate mantém a ordem recebida); nulo/indisponível vai sempre ao fim, em asc e desc. */
export function ordenarFamiliasAds(
  familias: readonly FamiliaPainel[],
  coluna: ColunaFamiliasAds,
  direcao: DirecaoAds,
): FamiliaPainel[] {
  const valor = VALOR_COLUNA[coluna];
  const sinal = direcao === 'asc' ? 1 : -1;
  return [...familias].sort((a, b) => {
    const va = valor(a); const vb = valor(b);
    if (va == null || vb == null) return va == null && vb == null ? 0 : va == null ? 1 : -1;
    const c = typeof va === 'string' || typeof vb === 'string'
      ? String(va).localeCompare(String(vb), 'pt-BR', { sensitivity: 'base' })
      : va - vb;
    return c * sinal;
  });
}

/** "Ver famílias acima do equilíbrio": filtro + maior investimento primeiro. */
export const ATALHO_ACIMA_EQUILIBRIO = {
  filtro: 'acima', coluna: 'investimento', direcao: 'desc',
} as const satisfies { filtro: FiltroFamiliasAds; coluna: ColunaFamiliasAds; direcao: DirecaoAds };
