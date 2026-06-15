// Tipos canal-neutros do contrato de canais (ADR-0024). Vivem aqui para o
// `contrato.ts` não depender de `_shared/ml/*` (E5 / review: evitar leakage do ML
// no contrato canônico). Os módulos ML re-exportam estes tipos por back-compat.

/** Atributo de item no formato comum (id + valor por nome ou id). */
export interface AtributoItem {
  id: string;
  value_name?: string;
  value_id?: string;
}

/** Dimensões/peso da embalagem (cm + gramas), canal-neutro. */
export interface DimensoesPacote {
  altura_cm: number | null;
  largura_cm: number | null;
  comprimento_cm: number | null;
  peso_gramas: number | null;
}
