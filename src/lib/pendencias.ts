import type { Lote } from '@/lib/tipos-dominio';

export interface Pendencia {
  chave: 'problema' | 'erro';
  label: string;
  destino: string;
}

/**
 * Decide as pendências pós-publicação acionáveis do Dashboard a partir de dados
 * já carregados (sem nova chamada de rede). Retorna [] quando está tudo em dia.
 */
export function montarPendencias(comProblema: number, lotes: Lote[]): Pendencia[] {
  const pendencias: Pendencia[] = [];

  if (comProblema > 0) {
    pendencias.push({
      chave: 'problema',
      label: `${comProblema} ${comProblema === 1 ? 'anúncio com problema' : 'anúncios com problema'}`,
      destino: '/publicados',
    });
  }

  const lotesComErro = lotes.filter((l) => l.totalErros > 0);
  if (lotesComErro.length > 0) {
    const totalErros = lotesComErro.reduce((acc, l) => acc + l.totalErros, 0);
    const maisRecente = [...lotesComErro].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))[0];
    pendencias.push({
      chave: 'erro',
      label: `${totalErros} ${totalErros === 1 ? 'erro de publicação' : 'erros de publicação'}`,
      destino: `/relatorio/${maisRecente.id}`,
    });
  }

  return pendencias;
}
