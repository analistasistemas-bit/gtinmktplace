// Roteamento publish/update × split (ADR-0048 + ADR-0078 F2). Puro e idempotente.
import { MAX_VARIACOES_ML } from '../_shared/split/particionar.ts';

export function decidirSplit(p: {
  qtdCores: number;
  precosCentavos: Array<number | null>;
  qtdParticoes: number;
  /**
   * ADR-0160 — a família já vive no modelo User Products (tem itens técnicos em
   * `anuncios_externos_itens`), onde cada cor é um item ML próprio com preço próprio.
   *
   * O split por faixa existe porque um anúncio LEGACY tem um preço só: para vender cores a preços
   * diferentes era preciso um anúncio por faixa. Sob UP essa restrição não existe — dividir ali
   * criaria N anúncios para resolver um problema que o modelo já resolve, e mover variação
   * publicada entre itens no ML custa deletar e recriar (perde vendas, perguntas, histórico).
   *
   * Sinal deliberadamente estrutural (existência dos itens), não o cache de formato por categoria:
   * o cache diz "esta categoria é UP", o que NÃO implica que ESTA família já tenha sido migrada.
   * Usar o cache aqui classificaria como UP uma família Legacy ainda não migrada, e o worker
   * Legacy então a barraria com preço divergente.
   */
  ehUP?: boolean;
  /**
   * ADR-0160 — "somente estoque": nenhum preço é enviado ao ML (ADR-0078 F2 #3), logo a divergência
   * de preço no banco é inócua e não justifica dividir o anúncio.
   *
   * Sem isto, a saída que o guard de preço uniforme ENSINA ao operador ("publique uma vez como
   * somente estoque para o app adotar a migração") era inalcançável: uma família que o ML migrou,
   * ainda não adotada e já com preços divergentes no banco, era roteada para o split ANTES de
   * qualquer um olhar `somenteEstoque` — e o split worker não adota família migrada, ele manda
   * refazer a publicação. O operador seguia uma instrução que não funcionava.
   */
  somenteEstoque?: boolean;
}): boolean {
  if (p.qtdCores > MAX_VARIACOES_ML) return true; // ADR-0048 (comportamento atual)
  if (p.qtdParticoes > 1) return true; // já dividido: só o split worker conhece as N partições
  // Os dois gatilhos acima valem para UP também: cap de cores é limite do ML, e família já dividida
  // em N partições continua sendo assunto do split worker (ADR-0105 §7).
  if (p.ehUP) return false;
  if (p.somenteEstoque) return false; // nenhum preço sai → divergência não divide nada
  const distintos = new Set(p.precosCentavos.filter((c): c is number => c != null));
  return distintos.size > 1; // ADR-0078 F2: divergência de preço (só Legacy)
}
