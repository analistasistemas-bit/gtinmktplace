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
  /** true quando a busca/comissão falhou para este item (os demais seguem). */
  erro?: boolean;
}

export interface RespostaAnalise {
  itens: ItemAnalisado[];
  /** linhas da planilha descartadas (sem GTIN/preço/custo válidos). */
  ignorados: number;
}
