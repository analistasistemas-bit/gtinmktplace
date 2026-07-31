// Miolo testável do guard de retry idempotente de `cadastrar-produto` (D-9). O formulário mudou
// entre as tentativas (a chave só é trocada quando o diálogo fecha)? Casar por índice aplicaria
// estoque na variação errada — valor financeiro não se assume, falha alto. Contagem NÃO basta:
// reordenar duas linhas, ou excluir uma e adicionar outra, mantém a contagem.
import { centavosExatos } from '../_shared/dinheiro.ts';
import type { VariacaoEntrada } from '../_shared/produto/validar.ts';

/** Uma linha de `variacoes` já gravada, como o `select` do handler devolve (colunas snake_case,
 *  `preco`/`custo` podendo chegar como string — a coluna é `numeric`). */
export interface VariacaoGravada {
  nome: string | null;
  gtin: string | null;
  preco: number | string;
  custo?: number | string | null;
  peso_gramas?: number | null;
  altura_cm?: number | null;
  largura_cm?: number | null;
  comprimento_cm?: number | null;
}

/**
 * Compara o payload reenviado contra o que já foi gravado. `true` = diverge, o retry não pode
 * ser aplicado em silêncio.
 *
 * A comparação é posicional de propósito — é isso que faz uma reordenação divergir. Não
 * tentamos casar payload↔linha salva (o payload não carrega o código gerado); basta DETECTAR
 * que mudou e recusar.
 *
 * Normalização de `nome`/`gtin` IDÊNTICA à gravação em `montarLinhasProduto`
 * (`_shared/produto/validar.ts`): `?.trim() || null`. Divergir aqui barraria o retry legítimo,
 * que é a razão de existir da feature.
 *
 * Compara TODAS as colunas que `montarLinhasProduto` grava e têm contrapartida armazenada —
 * `nome, gtin, preco, custo, peso_gramas, altura_cm, largura_cm, comprimento_cm`. Uma lista
 * curada (só nome/gtin/preço) deixaria passar a troca de posição entre duas linhas que diferem
 * apenas em peso ou custo, e aí o estoque inicial de uma entraria no SKU da outra.
 * `estoqueInicial` fica de fora: não tem contrapartida gravada (`estoque` nasce 0).
 *
 * As quatro colunas de dimensão são `numeric(10,2)` (mesma migração de `preco`/`custo`) — vêm
 * do PostgREST como string. Comparar com `!==` puro compararia `10` (payload) contra `"10.00"`
 * (gravado) como diferentes e barraria todo retry de um produto com dimensões preenchidas; por
 * isso passam pelo mesmo `centavosExatos` do preço, não por identidade estrita.
 */
export function variacoesDivergem(
  enviadas: Pick<VariacaoEntrada, 'nome' | 'gtin' | 'preco' | 'custo' | 'pesoGramas' | 'alturaCm' | 'larguraCm' | 'comprimentoCm'>[],
  gravadas: VariacaoGravada[],
): boolean {
  if (enviadas.length !== gravadas.length) return true;
  return enviadas.some((v, i) => {
    const g = gravadas[i];
    return (v.nome?.trim() || null) !== (g.nome ?? null)
      || (v.gtin?.trim() || null) !== (g.gtin ?? null)
      || centavosExatos(v.preco) !== centavosExatos(g.preco ?? null)
      || centavosExatos(v.custo ?? null) !== centavosExatos(g.custo ?? null)
      || centavosExatos(v.pesoGramas ?? null) !== centavosExatos(g.peso_gramas ?? null)
      || centavosExatos(v.alturaCm ?? null) !== centavosExatos(g.altura_cm ?? null)
      || centavosExatos(v.larguraCm ?? null) !== centavosExatos(g.largura_cm ?? null)
      || centavosExatos(v.comprimentoCm ?? null) !== centavosExatos(g.comprimento_cm ?? null);
  });
}
