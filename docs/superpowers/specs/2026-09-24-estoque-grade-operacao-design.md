# Estoque para produtos de grade — exibição do tamanho e extensão de grade publicada

**Data:** 2026-09-24
**Decisor:** Diego (design aprovado em sessão, 2026-09-24)
**Relacionado:** [ADR-0166](../../decisions/0166-tipo-de-produto-por-organizacao.md) (tipo de produto / grade — amendment 2026-09-24c),
[ADR-0167](../../decisions/0167-guia-de-tamanhos-gerenciado-via-api.md) (guia de tamanhos),
[ADR-0129](../../decisions/0129-adicionar-variacao-a-familia-publicada.md) (adicionar variação pela tela Estoque),
[ADR-0160](../../decisions/0160-preco-por-variacao-sob-user-products.md)/I10 (`preservarPublicadas`),
ADR-0088 (saga User Products), ADR-0094 (cadastro manual, teto de 60 variações)

## 1. Problema

A auditoria de 2026-09-24 da tela Estoque mostrou que produto de grade (cor × tamanho) cadastra e
publica, mas **não opera** depois de publicado:

| # | Ponto | Evidência |
|---|---|---|
| 1 | "Adicionar variação" abre o dialog só de cor; a edge recusa família com tamanho (400) — o operador só descobre depois de preencher | `dialog-adicionar-variacao.tsx`, `adicionar-variacoes-familia/index.ts:131-141`, `produto-card.tsx:420` |
| 2 | Lista expandida mostra só a cor — "Preto" ×N | `variacao-estoque-linha.tsx:113`; RPC `variacoes_estoque_produto` não devolve `tamanho` |
| 3 | Entrada/Ajuste rotulam `código · cor` | `dialog-entrada.tsx:30`, `dialog-ajuste.tsx:15`; RPC `skus_estoque_org` sem `tamanho` |
| 4 | Movimentos mostra só o código | `movimentos-estoque.tsx:121` |
| 5 | Busca/filtro ignora tamanho (descartado — ver A5) | `produtos-saldo-filtro.ts:67` |

Funcionam para grade (sem mudança): push de estoque ao ML (tudo por SKU, `_shared/estoque/alvos.ts`),
Fiscal e Excluir (nível família).

**Risco latente descoberto no desenho:** no UPDATE User Products, o SKU novo nasce com a ficha do
item irmão (`atualizar-familia-up.ts` → `mesclarAtributos(…, lerFichaDoIrmao())`). `atributosDeFicha`
(`_shared/user-products/atributos-irmao.ts:20`) descarta só `COLOR`/`GTIN`/`EMPTY_GTIN_REASON`/
`SELLER_SKU` — `SIZE`, `SIZE_GRID_ID` e `SIZE_GRID_ROW_ID` do irmão passam. Remover a trava da edge
sem corrigir isto publicaria o SKU novo com o **tamanho do irmão**.

## 2. Objetivo e critério de sucesso

Operar produto de grade publicado inteiramente pela tela Estoque, sem risco de erro de tamanho.

- Toda tela do Estoque que identifica uma variação mostra `cor · tamanho` quando há tamanho.
- O operador acrescenta cores e/ou tamanhos a um anúncio de grade publicado; os SKUs novos aparecem
  no ML com `COLOR`, `SIZE`, `SIZE_GRID_ID` e `SIZE_GRID_ROW_ID` corretos, no mesmo `family_id`, e os
  SKUs existentes ficam intocados (preço, atributos). Prova: `GET /items/{id}` de um SKU novo e de um
  irmão antes/depois.
- **INV-1 (ADR-0166 Decisão 3):** org/produto sem tamanho → UI, payload e comportamento byte a byte
  iguais aos de hoje.

## 3. Fora de escopo

Mudar tamanho de SKU existente, remover SKU da grade, editar preço/atributo das irmãs, grade via
planilha, código de SKU digitado pelo operador no fluxo de grade, Kit/Catálogo/Pulse com tamanho
(continuam fora, ADR-0166).

## 4. Parte A — exibir o tamanho

**A1. Banco (migration nova, `supabase migration new`).** `variacoes_estoque_produto(text)` e
`skus_estoque_org()` (última definição: `20260903030505_estoque_rpc_exclui_kit.sql`) passam a
devolver `tamanho text`. Mudar `returns table` exige `drop function` + `create function` — não
`create or replace`. A migration refaz, na ordem: drop, create (corpo idêntico ao atual + coluna),
`grant execute … to authenticated`. `db push` não roda em transação: a janela sem a função é de
milissegundos e aceitável; o `grant` fica na mesma migration, logo após o create.

**A2. Tipos e fetch.** `LinhaVariacaoRpc`/`VariacaoComSaldo` e `SkuEstoqueOrg` (`src/lib/produtos-saldo.ts`)
ganham `tamanho: string | null`; `fetchVariacoesProduto` e `fetchSkusEstoqueOrg` mapeiam o campo.

**A3. Rótulo único.** Novo `rotuloVariacao(v: { cor, nome, tamanho? })` em `src/lib/rotulo-variacao.ts`:
`cor ?? nome`, e com tamanho `"<cor> · <tamanho>"`. Substitui as duas cópias locais de
`rotuloVariacao` (Entrada, Ajuste — que prefixam o código como hoje) e o `v.cor ?? v.nome` da linha
expandida (`variacao-estoque-linha.tsx`, `variacao-estoque-card.tsx`). Sem tamanho → string idêntica
à atual (INV-1).

**A4. Movimentos.** `estoque_movimentos` não tem cor/tamanho e não ganha join: o componente
`MovimentosEstoque` recebe o mapa `codigo → rótulo` das variações que o card já carregou
(`QK.variacoesEstoque(codigoPai)`) e mostra `código · rótulo`. Código ausente do mapa → só o código,
como hoje.

**A5. Busca — descartado.** A busca casa o termo contra o resumo por produto
(`casaTermo`, `src/lib/produtos-saldo-filtro.ts:67`), não por variação. Tamanho são termos de 1–3
caracteres ("P", "M", "42") que casariam com quase todo nome/código de produto — ruído, não filtro — e
exigiria mudar uma terceira RPC (`produtos_estoque_resumo`). Dentro do produto, A3/A6 já tornam o
tamanho visível. Reabrir só se surgir pedido concreto de filtro por tamanho.

**A6. Ordem na lista.** Variações de grade listadas por cor e, dentro da cor, na ordem canônica do
tamanho (`ordenarEixos`, `src/lib/cadastro-grade.ts`) — "G, M, P" em ordem alfabética seria errado.
Produto sem tamanho mantém a ordem atual.

## 5. Parte B — roteamento de "Adicionar variação"

`produto-card.tsx`/`Estoque.tsx`: produto com alguma variação com `tamanho` abre
`DialogEstenderGrade`; os demais abrem `DialogAdicionarVariacao` sem mudança. A regra "desabilitado
até publicar no ML" vale para os dois.

## 6. Parte C — estender grade publicada

### C1. Tela `src/components/estoque/dialog-estender-grade.tsx`

- Carrega a família canônica (mesma consulta de prefill do dialog atual, acrescida de `cor`,
  `tamanho`, `imagem_path`, `ml_picture_id`, `estoque`) e `familias.genero`.
- Eixos iniciais = cores e tamanhos existentes. O operador acrescenta **cores** (texto livre, como no
  cadastro em grade) e/ou **tamanhos** (só os de `opcoesDeTamanho(tipos da org)`, respeitando
  `numeracaoPublicavel`). Eixos passam por `ordenarEixos`.
- `MatrizGrade` ganha a prop opcional `bloqueadas: ReadonlyMap<chave, { estoque: number }>`: célula
  bloqueada é só leitura (valor em cinza, sem input, fora do preenchimento em massa e da navegação de
  edição). Sem a prop, a matriz se comporta exatamente como hoje (cadastro em grade intacto).
- Células novas = cartesiano dos eixos menos as bloqueadas menos as removidas manualmente
  (`reconciliarGrade` recebe as bloqueadas como `linhasAtuais` já existentes; nenhuma célula bloqueada
  entra em `novas` nem em `remover`).
- Cabeçalho herdável (preço mínimo, custo, 4 dimensões) pré-preenchido pelo SKU de referência (mesma
  regra do dialog atual: menor código entre os não `excluida_da_publicacao`), com a herança por campo
  de `resolverLinha`.
- **Foto:** célula nova de cor **existente** herda a foto já publicada da cor (usa `imagem_path` do
  SKU irmão da mesma cor; sem novo upload). Cor **nova** exige foto por cor (override por SKU
  permitido, como no cadastro).
- Obrigatórios por SKU novo: estoque inicial > 0 (mesmo racional D-4 do ADR-0129: SKU zumbi nunca
  publicável). GTIN opcional (EMPTY_GTIN_REASON como hoje).
- Teto: SKUs existentes + novos ≤ `LIMITE_VARIACOES_GERADAS` (60).
- Banner de "atualização em andamento" e `chave` de idempotência: mesmo padrão do dialog atual.

### C2. Edge `adicionar-variacoes-familia`

- Entrada: cada variação ganha `tamanho?: string` e o `codigo` passa a ser **opcional** quando há
  tamanho — ausente → reservado por `proximo_codigo_produto` (mesma rotina e ordem do
  `cadastrar-produto`). Variação sem tamanho continua exigindo código digitado (fluxo atual intacto).
- Trava `familiaTemTamanho` passa a ser: família com tamanho **e sem** linhas em
  `anuncios_externos_itens` (não-UP) → 400 como hoje. Família UP com tamanho → segue.
- Validações novas (400 com mensagem clara, antes de gravar):
  - família com tamanho ⇒ toda variação nova tem `tamanho`, e vice-versa (sem misturar);
  - `tamanho` ∈ `tamanhosValidosParaTipos(tipos da org)` (mesma whitelist do `cadastrar-produto`);
  - par `(cor, tamanho)` não existe entre as vivas nem se repete na submissão;
  - `familias.genero` preenchido.
- `processar.ts`: o clone deixa de forçar `tamanho: null` para as variações novas — grava o
  `tamanho` recebido; clones das vivas mantêm o seu. Conferir que o clone da família leva `genero`.
- Foto herdada (cor existente): a variação nova grava o `imagem_path` recebido do front (o do irmão)
  e `ml_picture_id` do irmão da mesma cor, para não re-subir a mesma foto.

### C3. Publicação UP

- `VariacaoUP` ganha `tamanho: string | null`; os dois callers (`update-familia-ml/processar.ts` e
  `reconciliar-convergencia-up/processar.ts`) passam a selecionar `tamanho`, e `familia` passa
  `genero`.
- `criarPlano` (`atualizar-familia-up.ts`): se a variação tem tamanho, resolve o chart com
  `garantirChart(admin, token, conexao.id, categoria_ml_id, genero, tamanhosDaFamilia)` — uma vez por
  execução, não por SKU — e passa `tamanho`, `sizeLabel`, `sizeGridId`, `sizeGridRowId` ao
  `montarPayloadItem`, igual a `publicar-familia-up.ts:150-159`. Tamanho sem linha resolvida → erro
  alto (o guard de `montarPayloadItem` já faz).
- `atributos-irmao.ts`: `SIZE`, `SIZE_GRID_ID` e `SIZE_GRID_ROW_ID` entram em `POR_SKU` — nunca
  herdados do irmão. (`GENDER` continua herdado: é da família.) Efeito para família sem tamanho: nenhum
  (a ficha do irmão não tem esses atributos).
- `preservarPublicadas` continua valendo: só os SKUs novos vão ao ML.

## 7. Erros e recuperação

Mesmo contrato do ADR-0129: erro de validação volta 400 ao dialog; falha de publicação deixa a família
em `erro` visível em Lotes; retry com a mesma `chave` é idempotente (`jaExistia`). Chart ausente no
cache → `garantirChart` cria (ADR-0167 D4/D5).

## 8. Testes

- **Unit (vitest):** `rotuloVariacao` (com/sem tamanho = INV-1); ordenação canônica da lista;
  `reconciliarGrade` com bloqueadas; `MatrizGrade` com célula bloqueada não editável e fora do massa;
  gate de salvar do `DialogEstenderGrade`; roteamento B.
- **Edge (deno test):** validações de C2 (mistura, whitelist, par duplicado, sem gênero, não-UP ainda
  recusado); `atributosDeFicha` descarta SIZE*; `criarPlano` com tamanho monta SIZE/SIZE_GRID_ROW_ID
  da linha certa e **não** o do irmão; família sem tamanho → payload idêntico ao snapshot atual.
- **SQL real (suíte psql):** as duas RPCs devolvem `tamanho` e mantêm o grant para `authenticated`.
- **ML dry-run:** `POST /items/validate` com o payload real de um SKU novo de uma família de grade
  publicada (sem criar anúncio).
- **UI:** validação em runtime real (Playwright próprio, conta de validação) — lista, Entrada,
  Ajuste, Movimentos com tamanho; dialog de extensão com células bloqueadas.

## 9. Entrega

Uma branch, ordem A → B → C. Mudanças em `supabase/functions/**` (incl. `_shared/`) exigem deploy das
funções afetadas (`adicionar-variacoes-familia`, `update-familia-ml`, `reconciliar-convergencia-up`,
`publicar-familias` e quem mais importar `atributos-irmao.ts`/`atualizar-familia-up.ts`) e `db push`
antes do merge, conferindo a versão ativa. Revisão do Fable no plano e no diff final.
