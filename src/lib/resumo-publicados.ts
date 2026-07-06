import type { PublicadoItem } from '@/lib/publicados';

export interface ResumoPublicados {
  total: number;
  ativos: number;
  comProblema: number;
  encalhados: number;
  variacoesPublicadas: number;
  topFat: PublicadoItem[];
  topUnid: PublicadoItem[];
}

/**
 * Resumo de saúde/encalhados/rankings dos anúncios publicados.
 * Fonte única consumida pelo DashboardPublicados (cards) e pelo export (KPIs + bloco),
 * para que tela e relatório nunca divirjam.
 */
export function calcularResumoPublicados(itens: PublicadoItem[]): ResumoPublicados {
  const total = itens.length;
  const ativos = itens.filter((i) => i.status === 'ativo').length;
  const comProblema = itens.filter(
    (i) => i.status === 'moderado' || i.status === 'inativo' || i.status === 'pausado',
  ).length;
  const encalhados = itens.filter(
    (i) => i.status === 'ativo' && (i.unidadesVendidas ?? 0) === 0,
  ).length;
  const variacoesPublicadas = itens.reduce((acc, i) => acc + (i.qtdVariacoes ?? 0), 0);
  const topFat = [...itens]
    .filter((i) => (i.valorVendido ?? 0) > 0)
    .sort((a, b) => (b.valorVendido ?? 0) - (a.valorVendido ?? 0))
    .slice(0, 5);
  const topUnid = [...itens]
    .filter((i) => (i.unidadesVendidas ?? 0) > 0)
    .sort((a, b) => (b.unidadesVendidas ?? 0) - (a.unidadesVendidas ?? 0))
    .slice(0, 5);
  return { total, ativos, comProblema, encalhados, variacoesPublicadas, topFat, topUnid };
}
