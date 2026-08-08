import type { DimensoesPacote } from '../ml/pacote.ts';

/** Item a analisar (uma linha da planilha ou um GTIN colado). */
export interface ItemAnalise {
  gtin: string;
  nome: string;
  unidade: string | null;
  /** PRECO da planilha = líquido mínimo desejado. null no modo GTIN sem preencher. */
  minimo: number | null;
  custo: number | null;
  /** Origem tributária (ADR-0055); ausência → 'nacional'. */
  origem: 'nacional' | 'importado';
  /** Dimensões e peso para cálculo de frete (quando informados na planilha). */
  dimensoes?: DimensoesPacote | null;
}

/** Comissão real do ML num preço, por tipo de anúncio (vinda de listing_prices). */
export interface ComissaoTipo {
  /** sale_fee_amount: comissão total (%+fixa) no menor preço do mercado. */
  saleFeeAmount: number;
  /** percentage_fee limpo (constante por categoria/tipo). */
  percentual: number;
  /** fixed_fee no menor preço do mercado. */
  fixa: number;
}

export interface Mercado {
  menor: number | null;
  maior: number | null;
  vendedores: number;
  freteGratis: number;
  full: number;
}

/** Resultado por item devolvido pela edge. Só dados; a avaliação é feita no front. */
export interface ItemAnalisado {
  gtin: string;
  nome: string;
  unidade: string | null;
  minimo: number | null;
  custo: number | null;
  /** Origem tributária (ADR-0055); ausência → 'nacional'. */
  origem: 'nacional' | 'importado';
  existeNoML: boolean;
  mercado?: Mercado;
  classico?: ComissaoTipo;
  premium?: ComissaoTipo;
  /** Custo de frete que o vendedor absorve (0 quando o comprador paga). */
  frete?: number;
  /** false = frete calculado com pacote genérico (16x11x6cm/300g) por falta de dimensão real. */
  dimensoesEncontradas?: boolean;
  /** short_description da ficha de catálogo; insumo p/ pré-preencher o cadastro (spike 037, V-1b). */
  descricaoCatalogo?: string | null;
  /**
   * Heurística por (org_id, gtin) em `variacoes` — usada só p/ trocar "Cadastrar" por
   * "Dar entrada" na Viabilidade. NÃO substitui o guard: o 409 de `cadastrar-produto` por
   * `codigo_pai` continua autoritativo (spike 037 §3.5).
   */
  jaCadastrado?: boolean;
  /** true quando a busca/comissão falhou para este item (os demais seguem). */
  erro?: boolean;
}

export interface RespostaAnalise {
  itens: ItemAnalisado[];
  /** linhas da planilha descartadas (sem GTIN/preço/custo válidos). */
  ignorados: number;
  /** false = conta ML da org sem Mercado Envios (me2) — frete sai 0 em todos os itens. null = não checado. */
  me2Habilitado?: boolean | null;
}
