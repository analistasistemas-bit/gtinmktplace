// ADR-0197: kit com variação na tela. As combinações vivem no módulo puro da edge, que valida o mesmo
// pedido no servidor; aqui só se reexporta, para tela e edge nunca divergirem.
export {
  gerarCombinacoes, rotuloCombinacao, normalizarCombinacao, AVISO_SELETOR_ML,
} from '../../supabase/functions/_shared/kit-variacao/combinacoes';

/** Corpo de `criar-kit-variacao`. Só `quantidade > 0` vira SKU. `fotos` é por rótulo da combinação. */
export interface CriarKitVariacaoInput {
  familiaBaseId: string;
  cores: string[];
  pecasPorKit: number;
  preco: number;
  quantidades: { cores: string[]; tamanho: string; quantidade: number }[];
  titulo: string;
  descricao: string;
  fotos: Record<string, string>;
  soEmKit: boolean;
  meta: number;
  /** Idempotência: o mesmo clique repetido devolve o kit já criado. */
  chaveCadastro: string;
}
