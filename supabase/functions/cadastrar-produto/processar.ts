// Miolo testável do guard de retry idempotente de `cadastrar-produto` (D-9). O formulário mudou
// entre as tentativas (a chave só é trocada quando o diálogo fecha)? Casar por índice aplicaria
// estoque na variação errada — valor financeiro não se assume, falha alto. Contagem NÃO basta:
// reordenar duas linhas, ou excluir uma e adicionar outra, mantém a contagem.
import { centavosExatos } from '../_shared/dinheiro.ts';
import type { VariacaoEntrada, ProdutoEntrada, ErroValidacao } from '../_shared/produto/validar.ts';
import { camposFiscaisFaltantes } from '../_shared/fiscal/validar.ts';
import { tamanhosValidosParaTipos } from '../_shared/produto/tipos-produto-valores.ts';

/** Org sem módulo fiscal nunca deve gravar fiscal — `montarLinhasProduto` grava a coluna pela
 *  mera PRESENÇA de `fiscal`, então um payload com o campo (engano, ou chamada HTTP direta) tem
 *  que ser descartado ANTES de chegar lá, senão a org sem módulo grava NCM/CST não validados. */
export function fiscalEfetivo(
  p: ProdutoEntrada, moduloFiscalAtivo: boolean,
): ProdutoEntrada['fiscal'] {
  return moduloFiscalAtivo ? p.fiscal : undefined;
}

/** Checkpoint Fable fim da Fase 3, ressalva 1: o front atual NUNCA manda `genero`/`tamanho`
 *  para uma org sem tipo de produto habilitado — quem manda é um front que acreditava ter o
 *  tipo (cache de alguns minutos depois do super-admin desligar) ou uma chamada forjada. Nos
 *  dois casos, sanear em silêncio (`entradaTamanhoEfetiva`) é o lado errado: colapsa
 *  "Azul/P, Azul/M, Azul/G" em três SKUs "Azul" idênticos, com estoque inicial aplicado e toast
 *  de sucesso — um produto errado gravado é pior que um 400. Roda ANTES de
 *  `entradaTamanhoEfetiva`, sobre a entrada crua (não a já saneada). */
export function tamanhoNaoHabilitadoNaEntrada(
  p: ProdutoEntrada, tipos: readonly string[],
): boolean {
  if (tipos.length > 0) return false;
  if (p.genero != null) return true;
  return (p.variacoes ?? []).some((v) => !!v.tamanho?.trim());
}

/** ADR-0166. Mesmo motivo de `fiscalEfetivo`: `montarLinhasProduto` grava as colunas pela mera
 *  PRESENÇA do campo, então um payload com `genero`/`tamanho` vindo de uma org SEM tipo de
 *  produto habilitado (engano do front, ou chamada HTTP direta) tem que ser descartado ANTES de
 *  chegar lá. Sem isto a org grava um eixo de variação que não contratou, e esse eixo chega ao
 *  payload do Mercado Livre.
 *
 *  `tamanhoNaoHabilitadoNaEntrada` já recusou com 400 o caso em que o payload TRAZ o campo —
 *  esta função é o saneamento residual para o campo ausente/vazio, que é o cadastro normal de
 *  toda org hoje (INV-1).
 *
 *  Não muta a entrada — devolve cópia rasa com as variações também copiadas. */
export function entradaTamanhoEfetiva(
  p: ProdutoEntrada, tipos: readonly string[],
): ProdutoEntrada {
  if (tipos.length > 0) return p;
  return {
    ...p,
    genero: undefined,
    // Achado do code-quality review: payload sem `variacoes` (o próprio caso que este
    // comentário cita — "chamada HTTP direta") derrubava esta função com TypeError ANTES de
    // `validarProdutoNovo` (index.ts) ter a chance de devolver o 400 de sempre ("Cadastre ao
    // menos uma variação."). `?? []` restaura esse 400 limpo (o próprio check de
    // `validarProdutoNovo` trata array vazio igual a ausente) — este ramo roda para TODA org
    // sem tipo de produto, ou seja, toda org em produção hoje.
    variacoes: p.variacoes?.map((v) => ({ ...v, tamanho: undefined })) ?? [],
  };
}

/** R7 (revisão do Fable): o valor de `tamanho` tem que pertencer à lista do TIPO da org. Antes
 *  disto só a UI restringia — uma chamada HTTP direta gravava 'XG' numa org de roupa, e esse
 *  valor viraria uma linha da tabela de medidas no ML (dado de marketplace inventado, proibido
 *  pelo CLAUDE.md).
 *
 *  Roda DEPOIS de `entradaTamanhoEfetiva`: para org sem tipo habilitado o campo já chegou aqui
 *  zerado, então esta função é um no-op para ela (INV-1). A lista vem da fonte única
 *  (`_shared/produto/tipos-produto-valores.ts`), a mesma que o frontend usa — não há segunda
 *  cópia para divergir. */
export function validarTamanhosDaEntrada(
  p: ProdutoEntrada, tipos: readonly string[],
): ErroValidacao[] {
  const validos = tamanhosValidosParaTipos(tipos);
  const erros: ErroValidacao[] = [];
  p.variacoes?.forEach((v, i) => {
    const t = v.tamanho?.trim();
    if (!t) return;
    if (!validos.includes(t)) {
      erros.push({
        campo: `variacoes[${i}].tamanho`,
        mensagem: `Tamanho "${t}" não pertence à lista do tipo de produto desta organização.`,
      });
    }
  });
  return erros;
}

/** Org com módulo fiscal exige entrada fiscal completa; sem módulo, ignora (spec §5). */
export function validarFiscalDaEntrada(
  p: ProdutoEntrada, moduloFiscalAtivo: boolean, regimeOrg: 'simples' | 'normal',
): string[] {
  if (!moduloFiscalAtivo) return [];
  return camposFiscaisFaltantes({
    ncm: p.fiscal?.ncm ?? null,
    cest: p.fiscal?.cest ?? null,
    origem_nfe: p.fiscal?.origemNfe ?? null,
    fci: p.fiscal?.fci ?? null,
    ex_tipi: p.fiscal?.exTipi ?? null,
    tributacao_icms: p.fiscal?.tributacaoIcms ?? null,
    tributacao_icms_regime: regimeOrg,
    unidade: p.unidade ?? null,
    origem: p.origem,
  }, regimeOrg);
}

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
  /** ADR-0166. Coluna `text` nullable — vem crua do PostgREST. */
  tamanho?: string | null;
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
 * `nome, gtin, tamanho, preco, custo, peso_gramas, altura_cm, largura_cm, comprimento_cm`. Uma lista
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
  enviadas: Pick<VariacaoEntrada, 'nome' | 'gtin' | 'preco' | 'custo' | 'pesoGramas' | 'alturaCm' | 'larguraCm' | 'comprimentoCm' | 'tamanho'>[],
  gravadas: VariacaoGravada[],
): boolean {
  if (enviadas.length !== gravadas.length) return true;
  return enviadas.some((v, i) => {
    const g = gravadas[i];
    return (v.nome?.trim() || null) !== (g.nome ?? null)
      || (v.gtin?.trim() || null) !== (g.gtin ?? null)
      // ADR-0166: MESMA normalização da gravação (`trim() || null`, montarLinhasProduto). Sem
      // esta linha, trocar só o tamanho entre duas tentativas com a mesma chave passaria pelo
      // guard, e `estoqueInicialDiverge` (que casa por índice) conferiria o estoque contra um SKU
      // cujo tamanho já não é o do formulário — silencioso, e alimenta markup e preço.
      || (v.tamanho?.trim() || null) !== (g.tamanho ?? null)
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
