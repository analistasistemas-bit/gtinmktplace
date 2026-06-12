export type OrigemConcorrencia = 'gtin' | 'titulo' | 'nenhuma';
export type ClasseConcorrencia = 'sem' | 'moderada' | 'alta';

export interface ResultadoConcorrencia {
  vendedores: number;
  preco_min: number | null;
  origem: OrigemConcorrencia;
  classe: ClasseConcorrencia;
  product_id?: string | null;
  /** Nome do produto de catálogo do ML (de /products/search). */
  product_name?: string | null;
  ofertas?: DadosOfertas;
}

export interface DadosOfertas {
  vendedores: number;
  preco_min: number | null;
  preco_max: number | null;
  total_ofertas: number;
  frete_gratis: number;
  full: number;
  seller_ids: number[];
  /** category_id do produto, lido das ofertas (GET /products/{id} não retorna esse campo). */
  category_id: string | null;
}
