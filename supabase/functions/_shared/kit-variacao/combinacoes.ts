// ADR-0200: combinações de cores do kit com variação. Puro, sem import: a tela (`src/lib/kit-variacao.ts`)
// reexporta daqui, e a edge recalcula o rótulo em vez de confiar no que vem do cliente.

/** Todas as combinações de `pecas` cores distintas, sem repetição, na ordem em que as cores foram marcadas. */
export function gerarCombinacoes(cores: string[], pecas: number): string[][] {
  const out: string[][] = [];
  const atual: string[] = [];
  const andar = (inicio: number) => {
    if (atual.length === pecas) { out.push([...atual]); return; }
    for (let i = inicio; i < cores.length; i++) {
      atual.push(cores[i]);
      andar(i + 1);
      atual.pop();
    }
  };
  if (Number.isInteger(pecas) && pecas > 0 && pecas <= cores.length) andar(0);
  return out;
}

/** "Preto", "Preto e Branco", "Preto, Branco e Marrom": vira o COLOR do item no ML. */
export function rotuloCombinacao(cores: string[]): string {
  if (cores.length <= 1) return cores[0] ?? '';
  return `${cores.slice(0, -1).join(', ')} e ${cores[cores.length - 1]}`;
}

/**
 * A combinação como conjunto, na ordem das cores marcadas: `['B','P']` e `['P','B']` são a mesma.
 * null se repetir cor ou usar cor fora das marcadas.
 */
export function normalizarCombinacao(marcadas: string[], combinacao: string[]): string[] | null {
  if (new Set(combinacao).size !== combinacao.length) return null;
  if (combinacao.some((c) => !marcadas.includes(c))) return null;
  return marcadas.filter((c) => combinacao.includes(c));
}

/** Medido em 07/11: o seletor do ML levou minutos para juntar os itens novos (combinações sozinhas ou "Sem estoque"). */
export const AVISO_SELETOR_ML = 'O Mercado Livre leva alguns minutos para juntar os itens no seletor de combinação. '
  + 'Até lá, algumas combinações podem aparecer sozinhas ou como "Sem estoque".';
