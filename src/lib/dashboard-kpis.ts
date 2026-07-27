import type { Lote } from '@/lib/tipos-dominio';
import type { PublicadoItem } from '@/lib/publicados';
import { STATUS_PROBLEMA } from '@/lib/publicados';
import type { StatusPublicadoItem } from '@/lib/queries';

export interface KpisDashboard {
  publicados: number;
  ativos: number;
  comProblema: number;
  pausados: number;
  erros: number;
  aRevisar: number;
  variacoesPublicadas: number;
}

export function calcularKpisDashboard(
  lotes: Lote[],
  publicados: PublicadoItem[],
  statusItens: StatusPublicadoItem[],
): KpisDashboard {
  // Quando há publicados, cruzamos pelo mlItemId (espelhando a tela Publicados) para que a contagem
  // de anúncios ativos/pausados/com problema seja 100% idêntica entre o Dashboard e a lista de Publicados.
  if (publicados.length > 0) {
    const statusMap = new Map(statusItens.map((s) => [s.ml_item_id, s]));
    const statusDosPublicados = publicados.map((p) => statusMap.get(p.mlItemId)?.status);
    return {
      publicados: publicados.length,
      ativos: statusDosPublicados.filter((s) => s === 'ativo').length,
      comProblema: statusDosPublicados.filter((s) => s && STATUS_PROBLEMA.has(s)).length,
      pausados: statusDosPublicados.filter((s) => s === 'pausado').length,
      erros: lotes.reduce((acc, l) => acc + l.totalErros, 0),
      aRevisar: lotes.filter((l) => l.status === 'revisao').length,
      variacoesPublicadas: publicados.reduce((acc, p) => acc + (p.qtdVariacoes ?? 0), 0),
    };
  }

  // Fallback quando 'publicados' está vazio (ex.: testes unitários sem mock de publicados ou conta nova)
  return {
    publicados: 0,
    ativos: statusItens.filter((s) => s.status === 'ativo').length,
    comProblema: statusItens.filter((s) => STATUS_PROBLEMA.has(s.status)).length,
    pausados: statusItens.filter((s) => s.status === 'pausado').length,
    erros: lotes.reduce((acc, l) => acc + l.totalErros, 0),
    aRevisar: lotes.filter((l) => l.status === 'revisao').length,
    variacoesPublicadas: 0,
  };
}
