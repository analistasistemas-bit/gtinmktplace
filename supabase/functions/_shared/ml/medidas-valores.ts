// ADR-0167 — tabela de comprimento de pé do chart STANDARD do ML, extraída de `size-chart.ts`
// para um módulo FOLHA.
//
// ATENÇÃO: este arquivo NÃO pode ganhar nenhum import — nem `import type` de `jsr:`. Ele é
// importado tanto pelo Deno (`size-chart.ts`) quanto pelo Vite (`src/lib/tamanhos.ts`, para o
// aviso "não publica no ML" do cadastro em grade), e o Vite não resolve especificador `jsr:`.
// Mesmo contrato de `_shared/produto/tipos-produto-valores.ts`.
//
// ADR-0182: também guarda o contorno de quadril (corpo, piso do intervalo) das grades de roupa.
//
// Valores: dado real do chart STANDARD do próprio ML (Spike 051 §13) — nunca estimados.
export const COMPRIMENTO_PE_CM: Readonly<Record<'masculino' | 'feminino', Readonly<Record<string, number>>>> = {
  masculino: {
    33: 22.5, 34: 23, 35: 23.5, 36: 24, 37: 24.5, 38: 25, 39: 25.5, 40: 26.5,
    41: 27.5, 42: 28, 43: 29, 44: 30, 45: 30.5, 46: 31, 47: 32, 48: 33,
  },
  feminino: {
    33: 22, 34: 22.7, 35: 23.3, 36: 24, 37: 24.7, 38: 25.3, 39: 26, 40: 26.7,
    41: 27.3, 42: 28, 43: 28.6, 44: 29.3,
  },
};

/** ADR-0182: contorno de quadril do CORPO em cm (piso do intervalo), por tamanho. Adulto junta
 *  Letras + Calça numa tabela só; infantil vale para os três gêneros infantis. */
export const CONTORNO_QUADRIL_CM: Readonly<
  Record<'adulto_masculino' | 'adulto_feminino' | 'infantil', Readonly<Record<string, number>>>
> = {
  adulto_masculino: {
    P: 96, M: 100, G: 104, GG: 108,
    34: 88, 36: 92, 38: 96, 40: 100, 42: 104, 44: 108, 46: 112, 48: 116,
  },
  adulto_feminino: {
    P: 94, M: 102, G: 110, GG: 118,
    34: 90, 36: 94, 38: 98, 40: 102, 42: 106, 44: 110, 46: 114, 48: 118,
  },
  infantil: { 2: 56, 4: 62, 6: 66, 8: 71, 10: 76, 12: 81, 14: 87, 16: 92 },
};

/** Unissex reaproveita a tabela masculina (mesma regra de `COMPRIMENTO_PE_CM`); gêneros
 *  infantis usam a infantil. Gênero é `string` para manter este módulo folha (sem imports). */
export function tabelaQuadril(genero: string): Readonly<Record<string, number>> {
  if (genero === 'meninos' || genero === 'meninas' || genero === 'sem_genero_infantil') {
    return CONTORNO_QUADRIL_CM.infantil;
  }
  return genero === 'feminino' ? CONTORNO_QUADRIL_CM.adulto_feminino : CONTORNO_QUADRIL_CM.adulto_masculino;
}
