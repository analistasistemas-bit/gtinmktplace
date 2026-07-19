import type { Lote } from '@/lib/tipos-dominio';
import type { PublicadoItem } from '@/lib/publicados';
import { STATUS_PROBLEMA } from '@/lib/publicados';
import type { StatusPublicadoItem } from '@/lib/queries';

export interface KpisDashboard {
  publicados: number;
  ativos: number;
  comProblema: number;
  erros: number;
  aRevisar: number;
  variacoesPublicadas: number;
}

export function calcularKpisDashboard(
  lotes: Lote[],
  publicados: PublicadoItem[],
  statusItens: StatusPublicadoItem[],
): KpisDashboard {
  return {
    publicados: publicados.length,
    ativos: statusItens.filter((s) => s.status === 'ativo').length,
    comProblema: statusItens.filter((s) => STATUS_PROBLEMA.has(s.status)).length,
    erros: lotes.reduce((acc, l) => acc + l.totalErros, 0),
    aRevisar: lotes.filter((l) => l.status === 'revisao').length,
    variacoesPublicadas: publicados.reduce((acc, p) => acc + (p.qtdVariacoes ?? 0), 0),
  };
}
