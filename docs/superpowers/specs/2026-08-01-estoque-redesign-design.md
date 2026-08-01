# Redesenho da tela de Estoque — listagem, detalhe e cadastro

**Data:** 2026-08-01
**Decisor:** Diego
**Relacionado:** ADR-0094 (E6b — estoque único e cadastro manual), ADR-0096 (código de produto
automático), ADR-0081 (URL assinada com cache), ADR-0055 (origem/imposto), `docs/design-system/README.md`

## 1. Problema

A tela de Estoque entrou em produção com o Bloco B do ADR-0094 e é hoje a pior superfície do
app. Diego cadastrou o primeiro produto real da DSA em 2026-08-01 e reportou: scroll horizontal
obrigatório para ler a informação, ausência de organização visual, busca que não encontra o
produto pelo GTIN, e um cadastro desconfortável de preencher.

Os seis defeitos, com causa verificada no código:

**D1 — Scroll horizontal da página inteira.** `src/pages/Estoque.tsx:87` e
`src/components/movimentos-estoque.tsx:53` renderizam duas `<table className="w-full">` dentro
de um `<TableCell colSpan={5}>` da tabela externa. Sob `table-layout: auto`, o min-content da
tabela aninhada — inflado pelos `whitespace-nowrap` das colunas SKU, GTIN, dimensões e data —
propaga pela célula e estoura a largura da tabela externa. O `overflow-x-auto` do wrapper
(`Estoque.tsx:81`) não contém nada porque esse `div` não tem largura restringida: ele herda a
largura dirigida pelo conteúdo da célula. A linha colapsada não rola; só a expandida rola.
É a mesma classe de bug já documentada em `dialog-cadastro-produto.tsx:185-188`.

**D2 — Descrição do produto em linha única.** `Estoque.tsx:85` renderiza `descricao_pai` num
`<p>` dentro da mesma célula inflada; o parágrafo ocupa a largura toda sem quebrar.

**D3 — Busca não encontra GTIN.** `Estoque.tsx:155-158` filtra apenas `nomePai`, `codigoPai` e
`variacao.codigo`. O GTIN **já é carregado** (`produtos-saldo.ts:71`) e só não entra no
predicado. Fornecedor, unidade e origem não são carregados pela query.

**D4 — Nenhuma foto na tela.** A query não seleciona `familias.capa_storage_path` nem
`variacoes.imagem_path`. O projeto já tem `FotoCapaFamilia` (`src/components/foto-capa-familia.tsx`)
e `useImageUrl` (`src/hooks/useImageUrl.ts`, URL assinada com cache de 7 dias por ADR-0081).

**D5 — Cadastro como grade de 9 inputs.** `dialog-cadastro-produto.tsx:257-293` empilha nove
`<Input className="h-8 min-w-20">` por variação numa tabela com scroll horizontal interno. O
modal já foi alargado de `4xl` para `5xl` uma vez e o comentário no código registra que ainda
cortava colunas. O botão "Cadastrar" trava sem indicar o campo faltante (`podeSalvar`, linha 105).

**D6 — Upload de foto bloqueado por pendência (defeito funcional).**
`dialog-cadastro-produto.tsx:325` esconde todo o bloco de fotos atrás de `{!pendencias && ...}`.
Se o enfileiramento da IA falhar ou algum estoque inicial não aplicar, o operador **não
consegue enviar nenhuma foto** — nem a capa, nem as de variação. O ADR-0094 (linha 91) desenhou
a foto junto da variação, na etapa de cadastro; a implementação atual está aquém do próprio ADR.

**D7 (menor) — "Dar entrada" escolhe SKU em silêncio.** `Estoque.tsx:70` passa
`produto.variacoes[0]?.codigo` como SKU inicial. Em produto com várias variações, o diálogo
abre pré-selecionado numa variação arbitrária.

## 2. Decisão

Substituir a listagem baseada em `<table>` por uma lista de cards, mover o painel de detalhe
para fora de qualquer contexto de tabela, e reagrupar o formulário de cadastro em cards por
variação. A escolha de sair da tabela não é estética: é o que torna D1 e D2 **estruturalmente
impossíveis** em vez de remendados. Remendar com `table-fixed` + `min-w-0` seria a terceira vez
que o projeto corrige o mesmo sizing de tabela aninhada.

### 2.1 Fora de escopo

| Item | Por quê |
|---|---|
| Ajuste manual de saldo | Cortado no ADR-0094 ("Ajuste manual de estoque pelo app"). Toda mudança de saldo é entrada, baixa ou estorno. |
| Multi-depósito, reserva de estoque | Cortados no ADR-0094. |
| Rota dedicada `/estoque/:codigoPai` | Mais navegação e mais código sem ganho para um operador que compara produtos na lista. Painel inline resolve. |
| Edição de produto pela tela de Estoque | A edição vive na Revisão. Esta entrega não abre um segundo caminho de escrita no produto. |
| Qualquer mudança em edge function, migration ou RLS | A entrega é 100% frontend. As duas queries mudam apenas a lista de colunas do `select`. |

## 3. Arquitetura da tela

```
Estoque (página)
├─ PageHeader  [Dar entrada] [Cadastrar produto]        ← inalterado
├─ Barra de controles
│   ├─ Input de busca (nome, código do produto, SKU, GTIN, cor, fornecedor)
│   ├─ Filtro rápido: Todos · Sem estoque · Não publicado
│   └─ Ordenação: Nome (A-Z) · Saldo (menor primeiro) · Mais recente
├─ Lista de ProdutoCard  (div/flex — NENHUMA <table> no caminho)
│   └─ ProdutoCard (colapsado)
│       ├─ FotoCapaFamilia tamanho="small"  (40px)
│       ├─ nome_pai (truncate) · codigo_pai (mono, text-caption)
│       ├─ saldo total (tabular-nums) + StatusPill tone="danger" "sem estoque" se 0
│       ├─ N variações · CanalBadge[] dos canais publicados
│       └─ [Dar entrada] [expandir]
│   └─ ProdutoCard (expandido) — renderizado como filho do card, não de célula
│       ├─ descricao_pai (line-clamp-3, expansível)
│       └─ Tabs
│           ├─ "Variações"  → grade de VariacaoEstoqueCard
│           └─ "Movimentos" → MovimentosEstoque (mesma lista, sem <table>)
└─ Diálogos: DialogEntrada (inalterado), DialogCadastroProduto (reagrupado)
```

### 3.1 ProdutoCard

Um card por produto, `rounded-lg border bg-card`. Colapsado ocupa uma faixa de ~64px. O clique
no card alterna a expansão; o botão "Dar entrada" usa `stopPropagation` como hoje.

Regra de largura: cada bloco de texto vive em `min-w-0` com `truncate`. Nada dentro do card
pode ter largura dirigida por conteúdo — é o invariante que impede a volta de D1.

### 3.2 VariacaoEstoqueCard

Substitui a linha de 7 colunas. Cada variação vira um card compacto:

```
┌────────────────────────────────────────────┐
│ [foto 40px]  00000005            saldo: 20 │
│              incolor                        │
│              GTIN 4005800241901             │
│              200g · 10×20×30cm              │
│              custo R$ 12,00 · preço R$ 89,90│
└────────────────────────────────────────────┘
```

Grade responsiva: `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3`. Saldo zero recebe
`StatusPill tone="danger"`. A foto usa `imagem_path` da variação; sem ela, cai no placeholder
de `FotoCapaFamilia`.

### 3.3 MovimentosEstoque

Mantém a lógica de dados (`fetchMovimentosEstoque`, `rotuloMotivo`, `movimentoInformativo`,
`Delta`) intacta. Muda apenas o layout: cada movimento vira uma linha em `flex` —
`data · SKU · motivo` à esquerda, `delta · saldo resultante · canal` à direita, com quebra em
telas estreitas. A `<table>` interna sai.

**Este componente tem dois consumidores**, e isso é um ganho, não um risco de escopo:
`Estoque.tsx:118` e `Publicados.tsx:359`. Em Publicados ele também vive dentro de um
`<TableCell colSpan={9}>` (`Publicados.tsx:341`), ou seja, **a tela de Publicados sofre do mesmo
D1** — a `whitespace-normal` da célula não neutraliza o min-content da tabela aninhada, cujos
`<td>` usam `whitespace-nowrap`. Trocar a `<table>` interna por `flex` corrige as duas telas de
uma vez, no ponto por onde ambos os chamadores passam.

Consequência obrigatória para o plano: Publicados entra na verificação visual antes do merge,
mesmo não sendo o alvo do pedido.

### 3.4 Busca e filtros

Predicado em função pura testável, `filtrarProdutos(produtos, { termo, filtro, ordem })` em
`src/lib/produtos-saldo-filtro.ts`:

- **termo** casa (case-insensitive, sem acento) contra: `nomePai`, `codigoPai`, `fornecedor`,
  e por variação `codigo`, `gtin`, `cor`, `nome`;
- **filtro**: `todos` | `sem-estoque` (saldoTotal === 0) | `nao-publicado` (sem canal no mapa);
- **ordem**: `nome` (default, `localeCompare` pt-BR como hoje) | `saldo-asc` | `recente`
  (`familias.criado_em` desc).

A busca não é debounced: a lista é filtrada em memória sobre dados já carregados.

## 4. Mudanças de dados

Duas alterações de `select`, sem mudança de contrato de edge, migration ou RLS.

`fetchProdutosComSaldo` (`src/lib/produtos-saldo.ts:69-73`) passa a selecionar também:

- de `variacoes`: `imagem_path`
- de `familias`: `capa_storage_path`, `fornecedor`, `unidade`, `origem`

Os tipos `VariacaoComSaldo` e `ProdutoComSaldo` ganham os campos correspondentes
(`imagemPath`, `capaStoragePath`, `fornecedor`, `unidade`, `origem`, `criadoEm`).

O corte "família mais recente por `codigo_pai`" de `agruparProdutosComSaldo` (linhas 33-48) e a
paginação obrigatória (`buscarTodasPaginas`) **não mudam** — são invariantes de correção de
saldo, não de layout.

`fetchCanaisPorProduto` fica inalterada.

## 5. Cadastro (DialogCadastroProduto)

### 5.1 Layout

O bloco de dados do pai (nome, descrição, unidade, fornecedor, origem) fica como está — já é
legível. A tabela de variações é substituída por uma pilha de cards, um por variação:

```
Variação 1                                    [remover]
┌──────────────────────────────────────────────────────┐
│ Identificação   Cor/nome ______   GTIN ____________  │
│ Comercial       Preço ______  Custo ______  Estoque _│
│ Logística       Peso(g) ___ Alt ___ Larg ___ Comp ___│
│ Foto            [escolher arquivo]  [preview 64px]   │
└──────────────────────────────────────────────────────┘
                                    [+ Adicionar variação]
```

Com os campos agrupados em quatro linhas rotuladas, o dialog deixa de precisar de scroll
horizontal e o comentário sobre `4xl`/`5xl` perde a razão de existir. A largura final **não é
fixada aqui**: o histórico do arquivo mostra duas medidas erradas seguidas (`4xl`, depois `5xl`,
esta última ainda cortando colunas em teste ao vivo). Ela é escolhida e confirmada
visualmente no QA. Cada input recebe `id`/`htmlFor` únicos por índice de variação.

### 5.2 Foto na etapa de cadastro

O `<input type="file">` de cada variação e os três de capa passam a existir na **etapa 1**. O
`File` selecionado fica no state e o preview é gerado com `URL.createObjectURL` (revogado no
unmount). Ao salvar com sucesso, os uploads disparam em sequência usando os ids devolvidos por
`cadastrarProduto`, com uma barra de progresso "enviando fotos (2/4)". Isso realiza o desenho
original do ADR-0094 (foto junto da variação) sem mudar a ordem física obrigatória — a foto
continua sendo gravada depois que família e variação têm id.

Falha de upload individual não desfaz o cadastro: o produto já está salvo. A etapa 2 permanece
como tela de correção, listando quais fotos faltaram com botão de reenvio por alvo.

### 5.3 Correção do gate de pendência (D6)

O bloco de fotos deixa de ser condicionado por `!pendencias`. Os avisos de pendência
(`filaOk === false`, `falhasEstoque`) continuam exibidos no topo com suas ações
("Reprocessar", "usar Dar entrada"), mas **não escondem mais o upload**. O botão "Ir para a
Revisão" continua desabilitado enquanto houver pendência — essa trava é correta e fica.

### 5.4 Validação inline (D5)

`podeSalvar` continua governando o botão, e cada campo obrigatório não preenchido ganha
mensagem própria abaixo do input, no padrão que `dialog-entrada.tsx:146-148` já usa:

- nome do produto vazio → "Informe o nome do produto.";
- origem não escolhida → mensagem já existente, mantida;
- preço ausente ou ≤ 0 na variação N → "Preço é obrigatório e deve ser maior que zero.".

A mensagem aparece após o primeiro `blur` do campo ou após a primeira tentativa de salvar, não
enquanto o operador digita pela primeira vez.

### 5.5 D7 — SKU inicial de "Dar entrada"

Produto com uma variação: comportamento atual (pré-seleciona o SKU). Produto com mais de uma:
o diálogo abre com a busca filtrada pelo `codigo_pai` e **sem** SKU pré-selecionado, forçando a
escolha explícita. Requer expor um `filtroInicial` opcional no `DialogEntrada`.

## 6. Estados

| Estado | Tratamento |
|---|---|
| Carregando lista | `Skeleton` com 3 cards, no lugar do texto "carregando produtos…" |
| Erro na lista | mensagem atual, mantida |
| Nenhum produto | `EmptyState` atual, mantido |
| Busca sem resultado | mensagem atual, dentro da área da lista |
| Produto sem foto | placeholder de `FotoCapaFamilia` (já implementado) |
| URL de imagem falhando | placeholder; o erro não derruba o card |
| Movimentos carregando/vazio/erro | mensagens atuais, mantidas |

## 7. Testes

Vitest, seguindo o que já existe em `src/components/estoque/__tests__/` e `src/lib/__tests__/`.

**Unitários (função pura, sem render):** `filtrarProdutos` — casa por GTIN; casa por fornecedor;
casa por cor; ignora acento e caixa; filtro `sem-estoque` só devolve saldo 0; filtro
`nao-publicado` exclui quem tem canal; cada ordem devolve a sequência esperada.

**Componente:** `Estoque` renderiza um card por produto e nenhum `<table>` no painel expandido
(guarda de regressão de D1); busca por GTIN encontra o produto (guarda de D3); card sem
`capa_storage_path` mostra `capa-placeholder` (D4).

**Componente:** `DialogCadastroProduto` exibe os inputs de foto **mesmo com** `filaOk: false`
(guarda de D6); com preço vazio mostra a mensagem de validação e mantém o botão travado (D5).

**Regressão em Publicados:** os testes existentes de `Publicados` devem continuar verdes sem
alteração; o painel expandido de lá passa a exibir os movimentos em `flex`.

**Regressão de layout:** o teste de "nenhum `<table>` no painel" é a guarda barata que impede a
volta do bug. Verificação visual real (screenshot em viewport estreito, com o painel expandido,
em **Estoque e Publicados**) fica na etapa de QA com Playwright, antes do merge, conforme o
protocolo do projeto — snapshot de acessibilidade não pega bug de layout CSS.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Perder o corte "família mais recente" ao mexer no agrupamento | Não tocar em `agruparProdutosComSaldo` além de copiar os campos novos; os testes existentes de `produtos-saldo` devem continuar verdes sem alteração. |
| Uma foto por variação = N requisições de URL assinada | `useImageUrl` já resolve: cache em localStorage por 7 dias (ADR-0081), `staleTime: Infinity`. Sem mudança necessária. |
| Reflow visual em telas estreitas | Cada card usa `min-w-0` + `truncate`; o teste de ausência de `<table>` e a checagem no Playwright cobrem. |
| Mudar `MovimentosEstoque` quebrar Publicados | Publicados é consumidor do mesmo componente (§3.3). Testes existentes de Publicados devem passar sem edição, e a tela entra na verificação visual antes do merge. |
| Upload em lote na etapa 1 falhar no meio | Cadastro já está salvo; a etapa 2 lista os alvos que faltaram com reenvio individual. Nunca reportar sucesso limpo com foto pendente. |

## 9. Documentação a atualizar na entrega

- `docs/TASKS.md` — registro da entrega;
- `obsidian-vault/` — só se algo arquitetural mudar; esta entrega é de UI sobre contratos
  existentes, então a expectativa é "conferido sem necessidade de alteração";
- nenhum ADR novo: a decisão não altera arquitetura, modelo de dados nem contrato de edge.
  Se a revisão do plano concluir o contrário, o ADR vem antes da implementação.
