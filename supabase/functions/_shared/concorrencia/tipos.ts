export type OrigemConcorrencia = 'gtin' | 'titulo' | 'nenhuma';
export type ClasseConcorrencia = 'sem' | 'moderada' | 'alta';

export interface ResultadoConcorrencia {
  vendedores: number;
  preco_min: number | null;
  origem: OrigemConcorrencia;
  classe: ClasseConcorrencia;
  product_id?: string | null;
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
}
