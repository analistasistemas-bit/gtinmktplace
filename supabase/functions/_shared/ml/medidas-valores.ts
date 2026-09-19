// ADR-0167 — tabela de comprimento de pé do chart STANDARD do ML, extraída de `size-chart.ts`
// para um módulo FOLHA.
//
// ATENÇÃO: este arquivo NÃO pode ganhar nenhum import — nem `import type` de `jsr:`. Ele é
// importado tanto pelo Deno (`size-chart.ts`) quanto pelo Vite (`src/lib/tamanhos.ts`, para o
// aviso "não publica no ML" do cadastro em grade), e o Vite não resolve especificador `jsr:`.
// Mesmo contrato de `_shared/produto/tipos-produto-valores.ts`.
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
