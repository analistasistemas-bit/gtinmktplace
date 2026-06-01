export interface ConcorrenciaPreco {
  vendedores: number;
  preco_min: number | null;
}

export interface ResultadoPreco {
  estrategia: 'proprio' | 'competitivo';
  preco_sugerido: number;
  motivo: string;
}

const MOTIVO_SEM = 'sem concorrência detectada';
const MOTIVO_BATER = 'concorrência presente — bater menor preço';
const MOTIVO_JA_MENOR = 'nosso preço já é mais competitivo que o mercado';

function arredondar2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Estratégia de preço condicional (ADR-0008). `precoPlanilha` é o preço da unidade
 * (variação ou família); `conc` é a concorrência da família.
 *
 * - vendedores 0 ou sem preço_min → PRÓPRIO (mantém planilha)
 * - preço_min <= planilha          → COMPETITIVO (preço_min − R$ 0,01)
 * - preço_min > planilha           → PRÓPRIO (nosso já é mais barato)
 */
export function calcularEstrategiaPreco(
  precoPlanilha: number,
  conc: ConcorrenciaPreco,
): ResultadoPreco {
  if (conc.vendedores <= 0 || conc.preco_min == null) {
    return { estrategia: 'proprio', preco_sugerido: precoPlanilha, motivo: MOTIVO_SEM };
  }
  if (conc.preco_min <= precoPlanilha) {
    return {
      estrategia: 'competitivo',
      preco_sugerido: arredondar2(conc.preco_min - 0.01),
      motivo: MOTIVO_BATER,
    };
  }
  return { estrategia: 'proprio', preco_sugerido: precoPlanilha, motivo: MOTIVO_JA_MENOR };
}
