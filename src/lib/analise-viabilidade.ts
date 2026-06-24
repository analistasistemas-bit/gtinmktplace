import type { Familia } from '@/lib/tipos-dominio';

export interface ResumoViabilidade {
  /** Menor preço de publicação entre as variações incluídas. */
  precoPublicacao: number;
  /** Preço efetivamente considerado (override do preço atual no ML, se houver). */
  precoExibido: number;
  /** Custo da variação representativa (a de menor preço de publicação). null sem custo. */
  custo: number | null;
  /** Markup bruto sobre o custo: (preço − custo) ÷ custo. null sem custo. */
  markup: number | null;
  concorrenciaVendedores: number;
  concorrenciaPrecoMin: number | null;
  /** Maior preço observado entre concorrentes (teto da faixa de mercado). */
  mercadoMax: number | null;
}

/**
 * Números-chave de viabilidade de uma família — fonte única usada tanto pelo
 * PainelAnalise (render) quanto pela exportação.
 */
export function resumoViabilidade(familia: Familia, precoOverride?: number): ResumoViabilidade {
  const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
  const base = incluidas.length > 0 ? incluidas : familia.variacoes;

  const precoPublicacao = base.length > 0
    ? Math.min(...base.map((v) => v.precoPublicacao ?? v.preco))
    : 0;
  const precoExibido = precoOverride ?? precoPublicacao;

  const representativa = base.length > 0
    ? base.reduce((min, v) =>
        (v.precoPublicacao ?? v.preco) < (min.precoPublicacao ?? min.preco) ? v : min,
      base[0])
    : null;
  const custo = representativa?.custo ?? null;

  const markup = custo != null && custo > 0 ? (precoExibido - custo) / custo : null;

  return {
    precoPublicacao,
    precoExibido,
    custo,
    markup,
    concorrenciaVendedores: familia.concorrenciaVendedores,
    concorrenciaPrecoMin: familia.concorrenciaPrecoMin ?? null,
    mercadoMax: familia.analiseMercado?.preco_max ?? null,
  };
}
