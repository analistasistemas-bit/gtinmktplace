import { arredondar5Proximo, arredondar5Cima } from './arredondar.ts';
import { liquidoClassico } from './liquido.ts';

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
  reancorado: boolean;
}

/** Re-âncora no preço do MercadoLíder com mais vendas quando o preço competitivo dá prejuízo real. */
export interface ReancoraLider {
  ativa: boolean;
  precoAncoraLider: number | null;
  custo: number;
  comissao: Comissao | null;
}

const motivoCompetitivo = (pct: number) => `concorrência presente — ${pct}% abaixo do menor preço`;
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
  reancora?: ReancoraLider,
): PrecoSugerido {
  if (conc.vendedores > 0 && conc.preco_min != null) {
    let precoBase = conc.preco_min;
    let reancorado = false;
    let motivo = motivoCompetitivo(descontoConcorrenciaPct);
    const precoCompetitivo = arredondar5Proximo(precoBase * (1 - descontoConcorrenciaPct / 100));
    // Só re-ancora se houver prejuízo real no preço competitivo (nunca sobe acima do precoAncoraLider).
    if (
      reancora?.ativa &&
      reancora.precoAncoraLider != null &&
      reancora.precoAncoraLider > precoBase &&
      liquidoClassico(precoCompetitivo, reancora.comissao, frete, aliquotaPct) < reancora.custo
    ) {
      precoBase = reancora.precoAncoraLider;
      reancorado = true;
      motivo = `menor preço dava prejuízo; ancorado no preço do maior vendedor MercadoLíder (R$${reancora.precoAncoraLider.toFixed(2)})`;
    }
    return {
      preco: arredondar5Proximo(precoBase * (1 - descontoConcorrenciaPct / 100)),
      estrategia: 'competitivo',
      motivo,
      reancorado,
    };
  }
  if (comissao) {
    return { preco: grossUp(piso, comissao.percentual, comissao.fixa, frete, aliquotaPct), estrategia: 'proprio', motivo: MOTIVO_GROSSUP, reancorado: false };
  }
  // Sem comissão: ainda empurra para fora da faixa cara (acima do abismo).
  return {
    preco: Math.max(PRECO_MIN_ACIMA_ABISMO, arredondar5Cima(piso + frete)),
    estrategia: 'proprio',
    motivo: MOTIVO_FALLBACK,
    reancorado: false,
  };
}
