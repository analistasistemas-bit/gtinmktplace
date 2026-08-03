/**
 * Slots do título (ADR-0099). Dez chaves, TODAS obrigatórias, com "" para ausente.
 *
 * Chave obrigatória com "" em vez de propriedade opcional elimina a diferença entre chave
 * ausente, null e "" — diferença que, de outro modo, vira ramificação em cada guard e no
 * montador. Também estabiliza o contrato entre modelos: o json_schema strict do OpenRouter
 * trata `required` de forma mais previsível que opcionalidade.
 */
export interface TituloSlots {
  /** Único slot que nunca pode ser "". */
  produto: string;
  marca: string;
  /** Numeração, linha ou referência que o CONSUMIDOR usa (N.3, Tex 29, 4/6). */
  modelo: string;
  medida: string;
  quantidade: string;
  material: string;
  /** Cor, tamanho, espessura — o discriminador da família perante as irmãs. */
  variacao: string;
  compatibilidade: string;
  aplicacao: string;
  sinonimo: string;
}

export type SlotTitulo = keyof TituloSlots;

export const SLOTS_VAZIOS: TituloSlots = {
  produto: '', marca: '', modelo: '', medida: '', quantidade: '',
  material: '', variacao: '', compatibilidade: '', aplicacao: '', sinonimo: '',
};

/**
 * Ordem de LEITURA: posição de cada slot no texto final. É a hierarquia do padrão ML
 * (produto → marca → modelo → medida → ... → sinônimo).
 */
export const ORDEM_LEITURA = [
  'produto', 'marca', 'modelo', 'medida', 'quantidade',
  'material', 'variacao', 'compatibilidade', 'aplicacao', 'sinonimo',
] as const satisfies readonly SlotTitulo[];

/**
 * Ordem de CORTE: quem sai primeiro quando estoura 60 chars. É o espelho exato da ordem de
 * leitura — o menos prioritário sai antes.
 *
 * Ordem de leitura e ordem de corte são contratos DISTINTOS de propósito: é o que permite
 * proteger `variacao` do corte sem tirá-la do lugar no texto. Quem decide o que é incortável
 * é montarTitulo (titulo-montar.ts), não esta lista.
 */
export const ORDEM_CORTE = [...ORDEM_LEITURA].reverse() as readonly SlotTitulo[];
