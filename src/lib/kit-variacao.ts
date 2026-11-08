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
  /** Clássico (padrão) ou Premium. */
  listingTypeId?: 'gold_special' | 'gold_pro';
  /** Prévia de texto da IA (`gerar-texto-kit`): o custo dos tokens entra na família do kit. */
  previaId?: string;
}

/** Peças pedidas × saldo da base por cor e tamanho. `tem` = estoque da variação publicável (0 se não existe). */
export interface SaldoPeca { cor: string; tamanho: string; precisa: number; tem: number; existe: boolean }

export function saldoDePecas(
  variacoes: Array<{ cor: string; tamanho: string | null; estoque: number; excluidaDaPublicacao?: boolean }>,
  cores: string[], tamanhos: string[], quantidades: { cores: string[]; tamanho: string; quantidade: number }[],
): SaldoPeca[] {
  return cores.flatMap((cor) => tamanhos.map((tamanho) => {
    const v = variacoes.find((x) => !x.excluidaDaPublicacao && x.cor === cor && x.tamanho === tamanho);
    const precisa = quantidades.reduce((s, q) => s + (q.tamanho === tamanho && q.cores.includes(cor) ? Math.max(0, q.quantidade) : 0), 0);
    return { cor, tamanho, precisa, tem: v ? Math.max(0, v.estoque) : 0, existe: !!v };
  }));
}
