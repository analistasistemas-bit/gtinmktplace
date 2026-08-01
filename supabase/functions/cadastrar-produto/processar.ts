// Miolo testável do guard de retry idempotente de `cadastrar-produto` (D-9). O formulário mudou
// entre as tentativas (a chave só é trocada quando o diálogo fecha)? Casar por índice aplicaria
// estoque na variação errada — valor financeiro não se assume, falha alto. Contagem NÃO basta:
// reordenar duas linhas, ou excluir uma e adicionar outra, mantém a contagem.
import { centavosExatos } from '../_shared/dinheiro.ts';
import type { VariacaoEntrada } from '../_shared/produto/validar.ts';

/** Uma linha de `variacoes` já gravada, como o `select` do handler devolve (colunas snake_case,
 *  todas podendo chegar como string — as colunas são `numeric`). */
export interface VariacaoGravada {
  nome: string | null;
  gtin: string | null;
  preco: number | string;
  custo?: number | string | null;
  peso_gramas?: number | string | null;
  altura_cm?: number | string | null;
  largura_cm?: number | string | null;
  comprimento_cm?: number | string | null;
}

/**
 * `custo` é `numeric` SEM escala fixa (arbitrária) — ao contrário de `preco`/dimensões, que são
 * `numeric(_,2)` e o Postgres arredonda na escrita. `custo` não é arredondado: uma diferença
 * sub-centavo (4.251 vs 4.252) fica gravada exatamente assim e alimenta markup (ADR-0055).
 * Comparar via `centavosExatos` (que trunca a 2 casas) esconderia essa diferença. Aqui não há
 * multiplicação por 100, então nenhum lado corre o risco de x.xx5 que `preco` tem — os dois
 * lados representam o MESMO texto decimal (nenhum é arredondado por uma coluna de escala fixa),
 * então `Number()` (mesmo parser determinístico texto→double dos dois lados) é exato para
 * decidir igualdade, mesmo com um lado number e o outro string.
 */
function custosDivergem(a: number | string | null | undefined, b: number | string | null | undefined): boolean {
  if (a == null || b == null) return a != b; // ambos null/undefined → não diverge
  return Number(a) !== Number(b);
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
 * `estoqueInicial` fica de fora DESTA função — sua contrapartida não é `variacoes.estoque` (que
 * nasce 0 e continua 0 se a primeira tentativa morreu antes do laço), e sim o ledger
 * `estoque_movimentos`. Ver `estoqueInicialDiverge` abaixo.
 *
 * As quatro colunas de dimensão são `numeric(10,2)`, mesma escala fixa de `preco` (`custo` é
 * diferente — ver `custosDivergem` acima). Vêm do PostgREST como string. Comparar com `!==`
 * puro compararia `10` (payload) contra `"10.00"` (gravado) como diferentes e barraria todo
 * retry de um produto com dimensões preenchidas; por isso passam pelo mesmo `centavosExatos`
 * do preço, não por identidade estrita.
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
      || custosDivergem(v.custo, g.custo)
      || centavosExatos(v.pesoGramas ?? null) !== centavosExatos(g.peso_gramas ?? null)
      || centavosExatos(v.alturaCm ?? null) !== centavosExatos(g.altura_cm ?? null)
      || centavosExatos(v.larguraCm ?? null) !== centavosExatos(g.largura_cm ?? null)
      || centavosExatos(v.comprimentoCm ?? null) !== centavosExatos(g.comprimento_cm ?? null);
  });
}

/** Movimento de `estoque_movimentos` deste cadastro (filtrado por `referencia_externa`).
 *  `quantidade` é a coluna que a RPC `registrar_entrada` grava com o `p_qtd` APLICADO —
 *  `quantidade_pedida` é de outro fluxo e não é escrita aqui. Vem `integer`, mas o PostgREST
 *  pode devolver como string. */
export interface MovimentoCadastro {
  codigo: string;
  quantidade: number | string;
}

/**
 * Estoque inicial do retry idempotente contra o LEDGER. `true` = diverge.
 *
 * Comparar contra `variacoes.estoque` estaria errado: quando a primeira tentativa morreu ANTES
 * do laço de estoque, `estoque` é 0 e o payload traz 10 — um retry legítimo viraria 409 falso.
 * O que distingue "ainda não aplicou" de "aplicou outro número" é o movimento com a referência
 * `cadastro:{familiaId}:{codigo}`.
 *
 * Sem esta checagem, alterar o Estoque entre as tentativas era descartado em SILÊNCIO: o laço
 * chama `registrar_entrada` com a mesma referência, a RPC faz `return null` no
 * `unique_violation`, `falhasEstoque` fica vazio e a tela mostra "cadastrado" com o número novo
 * enquanto o banco guarda o antigo — número que alimenta a quantidade empurrada ao marketplace.
 *
 * A decisão é por PRESENÇA do movimento, nunca por `estoqueInicial` estar vazio:
 * - sem movimento → não diverge (o laço vai aplicar; é o caso primário da feature);
 * - com movimento de quantidade igual → não diverge (no-op normal);
 * - com movimento de quantidade diferente → diverge, INCLUSIVE quando o operador zerou/limpou
 *   o campo (10 gravado, 0 enviado). Um early-out em `estoqueInicial` falsy deixaria passar
 *   exatamente esse espelho do defeito: ledger 10, tela 0, resposta 200.
 *
 * Casamento por índice: só é confiável DEPOIS de `variacoesDivergem` devolver `false` (é ela que
 * descarta reordenação). Chamar sempre nessa ordem.
 */
export function estoqueInicialDiverge(
  enviadas: Pick<VariacaoEntrada, 'estoqueInicial'>[],
  codigos: string[],
  movimentos: MovimentoCadastro[],
): boolean {
  if (enviadas.length !== codigos.length) return true;
  const aplicado = new Map(movimentos.map((m) => [m.codigo, Number(m.quantidade)]));
  return enviadas.some((v, i) => {
    const qtd = aplicado.get(codigos[i]);
    if (qtd === undefined) return false;
    return qtd !== (v.estoqueInicial ?? 0);
  });
}
