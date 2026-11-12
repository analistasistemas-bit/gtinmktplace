// ADR-0200: kit com variação na tela. As combinações vivem no módulo puro da edge, que valida o mesmo
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
  /** Ids das fotos das peças mantidos por combinação (ADR-0200, adendo 12/11). Ausente ou vazio = só a foto do kit. */
  galeria?: Record<string, string[]>;
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

/**
 * Quantos kits cabem numa célula (combinação × tamanho): o menor saldo entre as cores dela, descontado o que as outras
 * células do mesmo tamanho já usam. `faltam` = cores sem peça sobrando. Só orienta a tela: a RPC dá a palavra final.
 * ponytail: uma família só por chamada, e `variacoes` é única por (familia_id, codigo): não há cópia de SKU a desempatar.
 */
export function maximoPorCelula(
  variacoes: Parameters<typeof saldoDePecas>[0],
  celula: { cores: string[]; tamanho: string },
  quantidades: { cores: string[]; tamanho: string; quantidade: number }[],
): { maximo: number; faltam: string[] } {
  const chave = (cores: string[]) => [...cores].sort().join('|');
  const outras = quantidades.filter((q) => q.tamanho !== celula.tamanho || chave(q.cores) !== chave(celula.cores));
  const livre = saldoDePecas(variacoes, celula.cores, [celula.tamanho], outras).map((s) => ({ cor: s.cor, n: Math.max(0, s.tem - s.precisa) }));
  // `faltam` = sem peça LIVRE: zerada ou já usada por outra célula (o texto da tela não pode dizer que não existe).
  return { maximo: Math.min(...livre.map((l) => l.n)), faltam: livre.filter((l) => l.n === 0).map((l) => l.cor) };
}
