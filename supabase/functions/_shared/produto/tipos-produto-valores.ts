// ADR-0166: FONTE ÚNICA dos valores canônicos de tipo de produto e de tamanho/numeração.
//
// ATENÇÃO: este arquivo NÃO pode ganhar nenhum import — nem `import type` de `jsr:`. Ele é
// importado tanto pelo Deno (edges) quanto pelo Vite (`src/lib/tipos-produto.ts`,
// `src/lib/tamanhos.ts`), e o Vite não resolve especificador `jsr:`. Mesmo contrato de
// `_shared/platform-admin/sales-costs.ts`, que `src/lib/custos.ts` já importa.
//
// Antes desta consolidação a whitelist estava redigitada em três arquivos e as listas de
// tamanho só existiam no frontend — o que deixava a edge sem como validar o valor recebido.

export type TipoProduto = 'roupa' | 'calcado';

/** Ordem canônica: toda saída saneada respeita esta ordem, não a do payload. */
export const TIPOS_PRODUTO_VALIDOS = ['roupa', 'calcado'] as const;

/** Conjunto fechado decidido no grilling de 2026-09-18. */
export const TAMANHOS_ROUPA = ['P', 'M', 'G', 'GG', 'Tamanho Único'] as const;

/** Numeração adulta brasileira + os pares de meio-número que o ML usa. A seção 10 do spike 051
 *  confirma a lista contra a categoria real; ajustar é editar UMA linha, aqui. */
export const NUMERACOES_CALCADO = [
  '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46',
  '33/34', '35/36', '37/38', '39/40', '41/42', '43/44', '45/46',
] as const;

/** Todos os valores de tamanho aceitáveis para uma org, dados os tipos habilitados.
 *  Org sem tipo → lista vazia → nenhum tamanho é aceitável (INV-1). */
export function tamanhosValidosParaTipos(tipos: readonly string[]): string[] {
  const valores: string[] = [];
  if (tipos.includes('roupa')) valores.push(...TAMANHOS_ROUPA);
  if (tipos.includes('calcado')) valores.push(...NUMERACOES_CALCADO);
  return valores;
}
