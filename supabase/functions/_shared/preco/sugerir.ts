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

const motivoCompetitivo = (pct: number) => `concorrência presente — ${pct}% abaixo do menor preço`;
const motivoPisoAcimaConc = (precoComp: number) =>
  `concorrência a R$ ${precoComp.toFixed(2)} não cobre custo/comissão/frete — preço no piso viável (pouco competitivo)`;
const MOTIVO_GROSSUP = 'sem concorrência — preço cobre seu mínimo após comissão e frete';
const MOTIVO_FALLBACK = 'sem concorrência — comissão indisponível, usando o piso';

/**
 * Abismo da tarifa fixa do ML (ADR-0023): abaixo de R$ 12,50 o ML cobra, além do
 * percentual, uma "tarifa fixa" = 50% do preço (comissão efetiva ~62%). Acima desse
 * valor a tarifa fixa zera (só o percentual). Validado na API (listing_prices).
 */
export const ABISMO_TARIFA_FIXA = 12.5;
/** Menor múltiplo de R$ 0,05 já acima do abismo (em R$ 12,50 a fixa ainda é cobrada). */
export const PRECO_MIN_ACIMA_ABISMO = 12.55;
/** Preço de referência (> abismo) para ler a comissão percentual "limpa", sem a tarifa fixa. */
export const PRECO_REF_COMISSAO = 20;

/**
 * Preço cujo líquido (após comissão, frete que o vendedor absorve E imposto) ≥ piso, sempre acima
 * do abismo da tarifa fixa (ADR-0023). `percentual`/`fixa` devem vir da comissão lida ACIMA
 * do abismo (fixa ≈ 0). `frete` = custo de frete grátis que o vendedor paga (0 se comprador
 * paga ou indisponível). `aliquotaPct` = imposto por origem em % (ADR-0055; 0 = sem imposto).
 * P = (piso + fixa + frete)/(1 − pct − aliquota), arredonda pra cima, nunca < R$ 12,55.
 */
export function grossUp(piso: number, percentual: number, fixa: number, frete = 0, aliquotaPct = 0): number {
  const denom = 1 - percentual / 100 - aliquotaPct / 100;
  // Guard: comissão + imposto ≥ 100% tornaria o gross-up impossível (÷ ≤ 0); cai no piso acima do abismo.
  if (denom <= 0) return Math.max(PRECO_MIN_ACIMA_ABISMO, arredondar5Cima(piso + fixa + frete));
  const bruto = (piso + fixa + frete) / denom;
  return Math.max(PRECO_MIN_ACIMA_ABISMO, arredondar5Cima(bruto));
}

/**
 * Sugere o preço de venda (ADR-0020 + ADR-0023 + ADR-0059). `piso` = PRECO da planilha
 * (líquido mínimo). Com concorrente → mercado (× (1 − descontoConcorrenciaPct/100), configurável
 * em Configurações, default 5%). Sem concorrente → gross-up que cobre o piso e fica acima do
 * abismo de R$ 12,50 (onde o ML deixa de cobrar a tarifa fixa de 50%).
 */
export function sugerirPrecoVenda(
  piso: number,
  conc: ConcorrenciaPreco,
  comissao: Comissao | null,
  frete = 0,
  aliquotaPct = 0,
  descontoConcorrenciaPct = 5,
): PrecoSugerido {
  if (conc.vendedores > 0 && conc.preco_min != null) {
    const precoComp = arredondar5Proximo(conc.preco_min * (1 - descontoConcorrenciaPct / 100));
    // Nunca abaixo do piso viável (lote #27): bater o concorrente não pode dar prejuízo. Quando
    // temos comissão, calcula o gross-up (cobre custo+comissão+frete+imposto); se ele for MAIOR
    // que o preço competitivo, publica no piso e avisa (o operador decide ajustar/não publicar).
    if (comissao) {
      const pisoViavel = grossUp(piso, comissao.percentual, comissao.fixa, frete, aliquotaPct);
      if (pisoViavel > precoComp) {
        return { preco: pisoViavel, estrategia: 'competitivo', motivo: motivoPisoAcimaConc(precoComp) };
      }
    }
    return { preco: precoComp, estrategia: 'competitivo', motivo: motivoCompetitivo(descontoConcorrenciaPct) };
  }
  if (comissao) {
    return { preco: grossUp(piso, comissao.percentual, comissao.fixa, frete, aliquotaPct), estrategia: 'proprio', motivo: MOTIVO_GROSSUP };
  }
  // Sem comissão: ainda empurra para fora da faixa cara (acima do abismo).
  return {
    preco: Math.max(PRECO_MIN_ACIMA_ABISMO, arredondar5Cima(piso + frete)),
    estrategia: 'proprio',
    motivo: MOTIVO_FALLBACK,
  };
}
