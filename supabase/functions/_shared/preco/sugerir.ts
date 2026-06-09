import { arredondar5Proximo, arredondar5Cima } from './arredondar.ts';

export interface ConcorrenciaPreco {
  vendedores: number;
  preco_min: number | null;
}

/** percentual em % (ex.: 13 = 13%); fixa em R$. */
export interface Comissao {
  percentual: number;
  fixa: number;
}

export interface PrecoSugerido {
  preco: number;
  estrategia: 'proprio' | 'competitivo';
  motivo: string;
}

const MOTIVO_COMPETITIVO = 'concorrência presente — 5% abaixo do menor preço';
const MOTIVO_GROSSUP = 'sem concorrência — preço cobre seu mínimo após comissão';
const MOTIVO_FALLBACK = 'sem concorrência — comissão indisponível, usando o piso';

/** Preço cujo líquido (após comissão) ≥ piso. P = (piso + fixa)/(1 − pct), arredonda pra cima. */
export function grossUp(piso: number, percentual: number, fixa: number): number {
  const bruto = (piso + fixa) / (1 - percentual / 100);
  return arredondar5Cima(bruto);
}

/**
 * Sugere o preço de venda (ADR-0020). `piso` = PRECO da planilha (líquido mínimo desejado).
 * Com concorrente → mercado (× 0,95). Sem concorrente → gross-up até cobrir o piso.
 */
export function sugerirPrecoVenda(
  piso: number,
  conc: ConcorrenciaPreco,
  comissao: Comissao | null,
): PrecoSugerido {
  if (conc.vendedores > 0 && conc.preco_min != null) {
    return {
      preco: arredondar5Proximo(conc.preco_min * 0.95),
      estrategia: 'competitivo',
      motivo: MOTIVO_COMPETITIVO,
    };
  }
  if (comissao) {
    return { preco: grossUp(piso, comissao.percentual, comissao.fixa), estrategia: 'proprio', motivo: MOTIVO_GROSSUP };
  }
  return { preco: arredondar5Cima(piso), estrategia: 'proprio', motivo: MOTIVO_FALLBACK };
}
