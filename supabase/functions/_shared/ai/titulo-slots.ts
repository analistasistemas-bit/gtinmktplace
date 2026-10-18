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
  /** ADR-0184 (só grade): gênero/público — Masculino, Feminina, Infantil, Unissex. */
  publico: string;
  /** ADR-0184 (só grade): característica decisiva da compra (Cintura Alta, Proteção UV). */
  caracteristica: string;
  caracteristica2: string;
}

export type SlotTitulo = keyof TituloSlots;

export const SLOTS_VAZIOS: TituloSlots = {
  produto: '', marca: '', modelo: '', medida: '', quantidade: '',
  material: '', variacao: '', compatibilidade: '', aplicacao: '', sinonimo: '',
  publico: '', caracteristica: '', caracteristica2: '',
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

/** Todos os slots que a IA devolve (schema/coerção/diagnóstico). Os três últimos só valem na
 *  grade (ADR-0184); fora dela são zerados antes de qualquer guard. */
export const TODOS_SLOTS = [
  ...ORDEM_LEITURA, 'publico', 'caracteristica', 'caracteristica2',
] as const satisfies readonly SlotTitulo[];

/** ADR-0184: Peça + Público + Marca + Característica + Material + (cor única) + Kit. Slot fora
 *  desta lista não é renderizado na grade. */
export const ORDEM_LEITURA_GRADE = [
  'produto', 'publico', 'marca', 'caracteristica', 'caracteristica2', 'material', 'variacao', 'quantidade',
] as const satisfies readonly SlotTitulo[];

/** Regra do Diego: acima de 60 sai a 2ª característica, depois o material. Os demais são
 *  incortáveis (titulo-montar.ts). */
export const ORDEM_CORTE_GRADE = ['caracteristica2', 'material'] as const satisfies readonly SlotTitulo[];
