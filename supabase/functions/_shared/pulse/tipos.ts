// Pulse (ADR-0119): tipos puros do coletor. Sem I/O.
export interface OfertaColetada {
  item_id: string;
  seller_id: number;
  preco: number;
  tier: string | null;
  frete_gratis: boolean;
  loja_oficial: boolean;
  /**
   * URL do anúncio no ML, quando a ficha a expõe. É a ÚNICA fonte possível para anúncio de
   * concorrente: `/items/{id}` de terceiro devolve 403 sempre (ADR-0119), e a URL não pode ser
   * derivada do `item_id`. `null` = a resposta não trouxe — a tela simplesmente não linka.
   */
  permalink: string | null;
}
export interface OfertaAnterior extends OfertaColetada { ativo: boolean; }
export type TipoAlerta = 'preco_caiu' | 'novo_concorrente' | 'concorrente_saiu';
export interface AlertaNovo { tipo: TipoAlerta; payload: Record<string, unknown>; }
export interface DiffOfertas {
  gravar: OfertaColetada[];          // linhas novas do dia (novas ou com preço/atributo mudado)
  desativar: OfertaColetada[];       // ofertas que sumiram (gravadas com ativo=false)
  alertas: AlertaNovo[];
}
export interface PriceToWin {
  status: string | null;
  preco_sugerido: number | null;
  custos: { comissao: number | null; frete: number | null } | null;
}
