export type OrigemConcorrencia = 'gtin' | 'titulo' | 'nenhuma';
export type ClasseConcorrencia = 'sem' | 'moderada' | 'alta';

export interface ResultadoConcorrencia {
  vendedores: number;
  preco_min: number | null;
  origem: OrigemConcorrencia;
  classe: ClasseConcorrencia;
}
