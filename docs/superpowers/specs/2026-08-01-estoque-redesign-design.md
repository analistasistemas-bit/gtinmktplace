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

**D2 — Descrição do produto ocupando uma linha larguíssima.** `Estoque.tsx:85` renderiza
`descricao_pai` num `<p>` sem `truncate` nem `line-clamp`. O parágrafo quebraria normalmente —
o que o estica é a célula inflada por D1: ele herda a largura dirigida pelo conteúdo e não
encontra motivo para quebrar. Não é um defeito próprio, é sintoma de D1; o `line-clamp` que a
§3 propõe é decisão de UX, não correção do bug.

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
| Qualquer mudança em edge function, migration ou RLS | A entrega é 100% frontend. Uma única query muda, e só na lista de colunas do `select`. |
| Empate de `criado_em` no corte da família canônica | Defeito pré-existente (§8), em caminho de saldo. Registrado como dívida, não corrigido numa entrega de UI. |
| Validação de estoque fracionário na edge | A validação inline da §5.4 cobre o operador. Endurecer a edge é caminho de estoque e sai em entrega própria (§8). |

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
│       ├─ saldo total (tabular-nums) + StatusPill de alerta se <= 0 (ver §3.5)
│       ├─ N variações · CanalBadge[] dos canais publicados
│       └─ [Dar entrada] [expandir]
│   └─ ProdutoCard (expandido) — renderizado como filho do card, não de célula
│       ├─ descricao_pai (line-clamp-3, expansível)
│       └─ Tabs
│           ├─ "Variações"  → grade de VariacaoEstoqueCard
│           └─ "Movimentos" → MovimentosEstoque (mesma lista, sem <table>)
└─ Diálogos: DialogEntrada (+ `filtroInicial`, §5.5), DialogCadastroProduto (reagrupado)
```

### 3.1 ProdutoCard

Um card por produto, `rounded-lg border bg-card`. Colapsado ocupa uma faixa de ~64px.

A expansão é acionada por um `<button>` real que envolve a área de identificação do produto,
com `aria-expanded` e `aria-controls` apontando para o id do painel. O card inteiro **não** vira
um pseudo-botão com `onClick` num `div` — hoje `Estoque.tsx:42` faz isso e a expansão é
inalcançável por teclado. O botão "Dar entrada" fica fora do botão de expansão (irmão, não
filho), o que dispensa o `stopPropagation` atual.

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

Grade responsiva: `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3`. A foto usa `imagem_path` da
variação; sem ela, cai no placeholder de `FotoCapaFamilia`. O pill de saldo segue a §3.5.

### 3.5 Saldo zero vs. saldo negativo

Não existe constraint de não-negativo no banco (`variacoes.estoque` é inteiro puro), e todo
movimento passa por RPC — mas um saldo negativo, se aparecer, é sintoma de bug de ledger, não
de "acabou o estoque". Tratá-los igual esconderia o caso grave dentro do caso rotineiro:

| Saldo | Pill | Rótulo |
|---|---|---|
| `> 0` | nenhum | — |
| `== 0` | `warning` | "sem estoque" |
| `< 0` | `danger` | "saldo inconsistente" |

Vale para o produto e para a variação, e os dois entram no filtro `sem-estoque` (`<= 0`) —
o operador precisa **encontrar** o negativo, não perdê-lo por ele não ser exatamente zero.

### 3.3 MovimentosEstoque

Mantém a lógica de dados (`fetchMovimentosEstoque`, `rotuloMotivo`, `movimentoInformativo`,
`Delta`) intacta. Muda apenas o layout: cada movimento vira uma linha em `flex` —
`data · SKU · motivo` à esquerda, `delta · saldo resultante · canal` à direita, com quebra em
telas estreitas. A `<table>` interna sai.

**Nenhum campo pode sumir na tradução.** Além dos seis óbvios, o componente atual exibe dois
dados de auditoria fáceis de perder ao reescrever o layout, e ambos são obrigatórios:

- **quantidade pedida** quando a baixa foi parcial (`movimentos-estoque.tsx:73-77`) — é o que
  revela que se vendeu mais do que havia e o saldo parou em zero;
- **documento** do movimento (`:79`) — a NF ou pedido que originou a entrada.

Este é um painel de auditoria: perder campo aqui é perder rastro, não perder estética.

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
- **filtro**: `todos` | `sem-estoque` (`saldoTotal <= 0` — não existe constraint de não-negativo
  no banco, então saldo negativo por bug tem que aparecer no filtro, não sumir dele) |
  `nao-publicado`;
- **ordem**: `nome` (default, `localeCompare` pt-BR como hoje) | `saldo-asc` | `recente`
  (`familias.criado_em` desc).

A busca não é debounced: a lista é filtrada em memória sobre dados já carregados.

**Trava obrigatória no `nao-publicado`.** Hoje `Estoque.tsx:140-145` ignora `isLoading`/`isError`
de `fetchCanaisPorProduto`, e `:215` colapsa mapa ausente em `[]`. Um filtro ingênuo por
"lista de canais vazia" classificaria **todo o catálogo como não publicado** quando a query
falha por rede ou RLS — uma tela que mente sobre o que está publicado. Por isso
`filtrarProdutos` recebe `canaisPorProduto: Map<string, string[]> | undefined`, e com
`undefined` a opção `nao-publicado` fica **desabilitada** (não silenciosamente ineficaz), com o
erro da query visível ao lado. `undefined` (não carregado) e `[]` (carregado, sem canal) nunca
podem ser tratados como a mesma coisa.

**E a trava acima não basta, porque a fonte está errada.** Distinguir `undefined` de `Map`
vazio só cobre a query que *falha*. O caso pior é a query que **tem sucesso e devolve dado
incompleto**:

- `fetchCanaisPorProduto` lê `anuncios_externos` (`produtos-saldo.ts:164-169`), que é um
  **espelho best-effort**: o upsert que o alimenta falha apenas com `console.error` e não
  desfaz a publicação (`_shared/anuncios/espelhar.ts:117-119`);
- Publicados usa a fonte **canônica**, `familias.ml_item_id IS NOT NULL`
  (`queries.ts:810-814`).

Resultado: um produto publicado de verdade no ML, visível na tela Publicados, aparece no
Estoque como "não publicado" — sem nenhum erro, com tudo verde. A tela afirma um fato falso
sobre o catálogo, que é pior que não ter o filtro.

Correção: para o Mercado Livre, derivar publicação de `familias.ml_item_id`, que vem no
**mesmo select** que a §4 já amplia — custo zero de query. O mapa de `anuncios_externos`
continua servindo os demais canais e os badges de canal. Teste obrigatório: família com
`ml_item_id` preenchido e **sem** linha no espelho não pode cair em `nao-publicado`.

Máquina de estados completa, porque "desabilita o filtro" sozinho deixa buracos:

| Estado da query | `canaisPorProduto` | Opção `nao-publicado` | Se já estava selecionada |
|---|---|---|---|
| `isLoading` | `undefined` | desabilitada | cai para `todos`, sem avisar (é transitório) |
| `isError` | `undefined` | desabilitada, com o erro visível ao lado | cai para `todos` **e avisa** que o filtro saiu por falha ao carregar canais |
| sucesso | o `Map` | habilitada | mantida |

A página passa a extrair `isLoading`/`isError` da query (hoje `Estoque.tsx:140` desestrutura só
`data`) e converter para `undefined` explicitamente — `data` já é `undefined` durante loading,
mas depender disso confunde "carregando" com "falhou". `fetchCanaisPorProduto` de fato falha
alto: a paginação lança (`paginacao-supabase.ts:9`), então `isError` é confiável.

## 4. Mudanças de dados

Uma alteração de `select`, sem mudança de contrato de edge, migration ou RLS.

`fetchProdutosComSaldo` (`src/lib/produtos-saldo.ts:69-73`) passa a selecionar também:

- de `variacoes`: `imagem_path`
- de `familias`: `capa_storage_path`, `fornecedor`, `unidade`, `origem`, `ml_item_id`

`ml_item_id` é o que torna o filtro "não publicado" confiável (§3.4) — sem ele a tela depende
de um espelho que pode estar furado.

Os tipos `VariacaoComSaldo` e `ProdutoComSaldo` ganham os campos correspondentes
(`imagemPath`, `capaStoragePath`, `fornecedor`, `unidade`, `origem`, `criadoEm`). `criadoEm`
não existe hoje em `ProdutoComSaldo` (`produtos-saldo.ts:21-27`) — `familias.criado_em` já é
lido para o corte da família canônica, mas é descartado no agrupamento; passa a ser copiado
para o produto, porque a ordenação "mais recente" depende dele.

O corte "família mais recente por `codigo_pai`" de `agruparProdutosComSaldo` (linhas 33-48) e a
paginação obrigatória (`buscarTodasPaginas`) **não mudam** — são invariantes de correção de
saldo, não de layout. A fragilidade conhecida desse corte (empate de `criado_em`) está
registrada como dívida em §8, fora do escopo desta entrega.

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

**Cada linha ganha um `clientId` estável** (`crypto.randomUUID()` ao criar a variação), usado
como `key` do card e como chave do `File` escolhido, que passa a viver **dentro do objeto da
linha** — nunca em array paralelo. Hoje as linhas usam `key={i}` e são removidas por índice
(`dialog-cadastro-produto.tsx:267-284`), o que já é frágil e vira defeito real com upload:
`<input type="file">` é DOM não-controlável, então remover a variação 2 de três faz React
reaproveitar a posição e o arquivo pode acabar exibido — ou enviado — na variação errada. Como
o casamento final com o id do banco é posicional (§5.2), um deslocamento aqui grava a foto no
SKU errado sem nenhum sinal.

Com os campos agrupados em quatro linhas rotuladas, o dialog deixa de precisar de scroll
horizontal e o comentário sobre `4xl`/`5xl` perde a razão de existir. A largura final **não é
fixada aqui**: o histórico do arquivo mostra duas medidas erradas seguidas (`4xl`, depois `5xl`,
esta última ainda cortando colunas em teste ao vivo). Ela é escolhida e confirmada
visualmente no QA. Cada input recebe `id`/`htmlFor` únicos por índice de variação.

### 5.2 Foto na etapa de cadastro

O `<input type="file">` de cada variação e os três de capa passam a existir na **etapa 1**. O
`File` selecionado fica no state e o preview é gerado com `URL.createObjectURL` (revogado no
unmount e ao trocar o arquivo). Ao salvar com sucesso, os uploads disparam em sequência usando
os ids devolvidos por `cadastrarProduto`, com progresso "enviando fotos (2/4)".

**O que isso resolve e o que NÃO resolve.** Resolve a ergonomia: o operador escolhe a foto no
mesmo lugar em que descreve a variação, em vez de numa segunda tela. **Não** faz a foto chegar
a tempo do enriquecimento por IA, e a spec não pode fingir que faz:

- `cadastrar-produto/index.ts:303` chama `enfileirarFamilia` **antes** de responder ao browser;
- `process-familia` lê `imagem_path` ao carregar as variações (`index.ts:109-111`) e a camada
  Vision aborta com `if (!v.imagem_path) return v` (`index.ts:157`);
- logo, qualquer upload disparado após a resposta pode chegar depois de o worker já ter lido
  `imagem_path` vazio — e a cor resolvida por Vision, que alimenta a geração de copy
  (`index.ts:198`), simplesmente não acontece.

Isso **já é verdade hoje** (a etapa 2 também sobe foto depois do enfileiramento), então não é
regressão introduzida por esta entrega. Mas invalida a leitura de que mover o seletor para a
etapa 1 "realiza o desenho do ADR-0094": o ADR desenhou a foto participando do cadastro, e o
que muda aqui é só onde o operador clica.

Fechar a lacuna de verdade exige deferir o `enfileirarFamilia` para depois do lote de fotos —
mudança na edge, portanto **fora do "100% frontend" declarado na §2.1**. `reprocessar-familia`
não é saída: só aceita família em `erro` (`reprocessar-familia/index.ts:45`).

**Decidido (§8.2): esta entrega segue frontend-only e declara a limitação.** A tela não promete
ao operador que a foto será usada pela IA; quem depende da cor por Vision resolve na Revisão,
como já acontece hoje.

**Como cada `File` acha sua variação.** O formulário não conhece os códigos: eles são gerados
na edge (ADR-0096). O casamento é **por índice** — `linhas[i]` ↔ `resultado.variacoes[i]` — e
isso é correto por dois invariantes encadeados, ambos verificados:

1. `derivarCodigos` (`_shared/produto/codigos.ts:38`) atribui `primeiro + 1 + i` à variação de
   índice `i`, ou seja, códigos sequenciais **na ordem do array enviado**;
2. `montarLinhasProduto` (`_shared/produto/validar.ts:102-106`) casa `p.variacoes[i]` com
   `ctx.codigos[i]` — a atribuição é posicional, e é esse elo que liga o formulário ao código;
3. a edge ordena o retorno por `codigo` (`cadastrar-produto/index.ts:256-259`, deliberadamente,
   porque o `RETURNING` do Postgres não garante ordem), e como todo código tem exatamente 8
   dígitos com zero à esquerda, a ordem lexicográfica é igual à numérica;
4. o retry idempotente usa `.order('codigo')` (`:98-104`) e a resposta preserva a ordem em
   ambos os caminhos (`:316-319`).

Logo, o retorno chega na mesma ordem do formulário. **Isso é uma coincidência de quatro
invariantes, não uma garantia de contrato**: se a geração de código deixar de ser sequencial,
ou o zero-padding mudar, a foto passa a ser gravada na variação errada em silêncio — sem erro,
sem log. O código leva um comentário apontando para os dois arquivos acima.

**A guarda tem que ficar do lado da edge, não do frontend.** Um teste de componente que mocka
a resposta já ordenada prova apenas que o frontend usa o índice — ele passaria igual se
`derivarCodigos` ou o `.sort()` quebrassem, porque o mock não executa nenhum dos dois.
`codigos.test.ts` já cobre sequencialidade e padding; o que **não** existe hoje é teste de que
a resposta da edge sai na ordem do payload. É esse que a §7 exige, nos dois caminhos (criação
e retry).

**Ciclo de vida do lote de upload.** A trava de fechamento vale para `salvando || enviandoFotos`
— **não só durante os uploads**. Fechar durante o `cadastrarProduto` (`:109-130`) é igualmente
destrutivo: a edge segue criando o produto, e o reset já descartou todos os `File` que o
operador escolheu. `onOpenChange` (`dialog-cadastro-produto.tsx:167`) e o botão "Fechar"
(`:377`) ficam inertes nesses dois estados, porque o `useEffect` de reset (`:97-103`) descarta
todo o state ao fechar — e os `File` só existem em memória. Perdê-los significa que a etapa 2 não consegue reconstruir a
lista de pendências, já que o banco não registra "foto que deveria existir". Após o lote:

- **todas enviadas** → segue para a etapa 2 já sem pendência de foto;
- **algumas falharam** → a etapa 2 lista os alvos que faltaram, mantendo os `File` em memória
  para reenvio individual. Enquanto restar **qualquer** `File` pendente, fechar exige
  confirmação destrutiva explícita — um aviso em texto não basta, porque `Escape` e clique no
  backdrop disparam `onOpenChange` (`:167`) direto, e o reset (`:97-103`) apaga os arquivos sem
  nenhuma chance de recuperá-los;
- **nenhuma foto escolhida** → caminho válido e silencioso; a foto pode ser enviada depois pela
  Revisão, que é o fluxo que já existe.

**Invalidar de novo ao fim do lote.** Hoje `invalidateQueries(['produtos-saldo'])` roda logo
após o cadastro (`dialog-cadastro-produto.tsx:118`), enquanto `imagem_path` e
`capa_storage_path` só são gravados depois, dentro de `uploadFotoProduto`
(`produtos-saldo.ts:150,159`). Sem uma segunda invalidação ao fim do lote, a lista fica em cache
sem os paths e **o card mostra o placeholder mesmo com a foto já enviada** — exatamente a queixa
que originou esta entrega. A invalidação final é obrigatória, não otimização.

Falha de upload individual não desfaz o cadastro: o produto já está salvo. Nunca reportar
sucesso limpo com foto pendente.

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
- preço ausente ou ≤ 0 na variação N → "Preço é obrigatório e deve ser maior que zero.";
- campo numérico com texto não numérico → "Valor inválido." Hoje `num()`
  (`dialog-cadastro-produto.tsx:37-41`) devolve `null` para `"abc"`, e `null` significa "campo
  não informado" — digitar lixo apaga o campo em silêncio em vez de recusar;
- estoque inicial fracionário → "Estoque inicial deve ser um número inteiro." A RPC de estoque
  trabalha com inteiro e `validar.ts:66-72` só recusa negativo, então `2,5` chega lá e vira
  cadastro parcial (o produto entra, o estoque não). Recusar antes é mais barato que explicar
  a falha depois.

A mensagem aparece após o primeiro `blur` do campo ou após a primeira tentativa de salvar, não
enquanto o operador digita pela primeira vez.

### 5.5 D7 — SKU inicial de "Dar entrada"

Produto com uma variação: comportamento atual (pré-seleciona o SKU). Produto com mais de uma:
o diálogo abre com a busca filtrada pelo `codigo_pai` e **sem** SKU pré-selecionado, forçando a
escolha explícita.

Isso muda o contrato do `DialogEntrada`, que hoje aceita só `produtos`, `aberto`, `onFechar` e
`skuInicial` (`dialog-entrada.tsx:21-26`): entra um `filtroInicial?: string`, aplicado ao state
`busca` no mesmo `useEffect` de reset (`:37-45`) e limpo junto com os demais campos ao fechar.
O `ref` de idempotência (`:35`) e a mutation não são tocados.

**Só isso não funciona.** Passar o `codigo_pai` para `busca` filtraria zero SKUs: o predicado
atual casa apenas contra `o.rotulo` (`dialog-entrada.tsx:56`), e o rótulo é montado com SKU,
nome do produto e cor (`:50`) — o `codigoPai` existe no objeto (`:51`) mas está fora da string
pesquisada. O diálogo abriria com a lista vazia e o operador sem entender por quê. O predicado
passa a incluir `o.codigoPai.toLowerCase().includes(termo)`, com teste cobrindo abrir pelo card
de um produto multivariação.

## 6. Estados

| Estado | Tratamento |
|---|---|
| Carregando lista | `Skeleton` com 3 cards, no lugar do texto "carregando produtos…" |
| Erro na lista | mensagem atual, mantida |
| Nenhum produto | `EmptyState` atual, mantido |
| Busca sem resultado | mensagem atual, dentro da área da lista |
| Produto sem foto | placeholder de `FotoCapaFamilia` (já implementado) |
| URL assinada falhando | placeholder — **exige código novo** (ver abaixo) |
| Arquivo apagado do bucket (404 no `<img>`) | placeholder — **exige código novo** (ver abaixo) |
| Canais carregando | badges em `Skeleton`; filtro `nao-publicado` desabilitado |
| Canais com erro | badges omitidos com aviso discreto; filtro `nao-publicado` desabilitado (§3.4) |
| Movimentos carregando/vazio/erro | mensagens atuais, mantidas |

Os dois estados de imagem **não vêm de graça** ao reusar os componentes existentes:
`useImageUrl` (`useImageUrl.ts:77-84`) propaga o erro sem fallback, e `FotoCapaFamilia`
(`foto-capa-familia.tsx:13-28`) só cai no placeholder quando `capaUrl` é vazio — seu `<img>`
não tem `onError`. Então o plano precisa, explicitamente:

1. tratar `isError` do hook como "sem URL" no ponto de uso;
2. acrescentar `onError` ao `<img>` de `FotoCapaFamilia`, trocando para o placeholder.

O item 2 mexe num componente compartilhado — verificar os outros consumidores antes de alterar,
como foi feito com `MovimentosEstoque`.

## 7. Testes

Vitest, seguindo o que já existe em `src/components/estoque/__tests__/` e `src/lib/__tests__/`.

**Unitários (função pura, sem render):** `filtrarProdutos` — casa por GTIN; casa por fornecedor;
casa por cor; ignora acento e caixa; filtro `sem-estoque` devolve saldo 0 **e negativo**; cada
ordem devolve a sequência esperada. O filtro `nao-publicado` é testado nos **três** estados:
mapa carregado com canal (exclui), mapa carregado vazio (inclui), mapa `undefined` (filtro
indisponível — nunca "tudo não publicado").

**Componente, não função pura, para a trava da §3.4:** o teste unitário acima prova o
predicado, mas não prova que a *opção* ficou desabilitada nem que o erro apareceu na tela — e é
isso que impede a UI de mentir. Teste de `Estoque` com a query de canais em erro: opção
`nao-publicado` com `disabled`, erro visível, e seleção prévia caindo para `todos`.

**Componente:** `Estoque` renderiza um card por produto e nenhum `<table>` no painel expandido
(guarda de regressão de D1); busca por GTIN encontra o produto (guarda de D3); card sem
`capa_storage_path` mostra `capa-placeholder` (D4); a expansão responde a teclado via o botão
com `aria-expanded`.

**Componente:** `DialogCadastroProduto` exibe os inputs de foto **mesmo com** `filaOk: false`
(guarda de D6); com preço vazio mostra a mensagem de validação e mantém o botão travado (D5);
estoque `2,5` e preço `"abc"` são recusados inline (§5.4); fechar durante o lote de upload é
bloqueado (§5.2).

**Casamento foto↔variação (§5.2), em dois níveis:**

1. *frontend* — com três variações preenchidas em ordem e a edge devolvendo
   `[00000002, 00000003, 00000004]`, cada `File` sobe para o id correspondente. Prova que o
   frontend usa o índice corretamente, **e nada além disso**;
2. *edge (o que realmente trava)* — `cadastrar-produto` devolve `variacoes` na ordem do payload,
   nos dois caminhos: criação (que ordena via `.sort()`) e retry idempotente (que usa
   `.order('codigo')`). Sem este, o teste 1 continuaria verde com a ordenação quebrada, porque
   o mock entrega a resposta já ordenada.

**Publicado sem espelho (§3.4):** família com `ml_item_id` preenchido e sem linha em
`anuncios_externos` **não** aparece no filtro `nao-publicado`. É a guarda do único defeito da
spec que produzia dado factualmente errado com todas as queries verdes.

**Identidade da variação (§5.1):** preencher três variações com fotos distintas, remover a do
meio e confirmar que as duas restantes mantêm seus próprios arquivos e previews.

**Saldo negativo no card (§3.5):** produto e variação com saldo `-3` mostram pill `danger` com
"saldo inconsistente" — não basta testar a função de filtro, o pill é render.

**Entrada por produto multivariação (§5.5):** abrir "Dar entrada" pelo card de um produto com
duas variações filtra a lista pelas duas e não pré-seleciona nenhuma. Falha hoje, porque o
predicado não olha `codigoPai`.

**Foto aparece sem recarregar (§5.2):** após o lote de upload, a lista é invalidada de novo e o
card passa a exibir a foto — guarda contra o placeholder persistente.

**Testes existentes que vão quebrar ou não protegem:**

- `dialog-cadastro-produto.test.tsx:44` localiza o preço via `table tbody`. Sem `table`, o
  seletor passa a ser o label único por variação (§5.1). Atualização obrigatória.
- `Publicados.test.tsx` **não** protege a regressão de `MovimentosEstoque`: `useFamilia` está
  mockado com `data: undefined` (`:54`), e `Publicados.tsx:342` só monta os movimentos depois de
  a família carregar — ou seja, o componente nunca é renderizado nesses testes. "Os testes de
  Publicados continuam verdes" não prova nada aqui. É preciso um teste novo, com família
  carregada e movimentos mockados, verificando data, SKU, motivo, delta, saldo e canal.

**Regressão em Publicados:** os testes existentes devem continuar verdes, mas isso é condição
necessária e **não suficiente** — eles não renderizam `MovimentosEstoque` (ver acima). A guarda
real é o teste novo com família carregada.

**Regressão de layout:** o teste de "nenhum `<table>` no painel" é a guarda barata que impede a
volta do bug. Verificação visual real (screenshot em viewport estreito, com o painel expandido,
em **Estoque e Publicados**) fica na etapa de QA com Playwright, antes do merge, conforme o
protocolo do projeto — snapshot de acessibilidade não pega bug de layout CSS.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Perder o corte "família mais recente" ao mexer no agrupamento | Não tocar em `agruparProdutosComSaldo` além de copiar os campos novos; os testes existentes de `produtos-saldo` devem continuar verdes sem alteração. |
| Uma foto por variação = N requisições de URL assinada | O cache do `useImageUrl` (ADR-0081) só ajuda **depois** da primeira resolução — a URL é assinada por 7 dias mas a entrada local expira 1 dia antes (`RENOVAR_ANTES_MS`), então o reaproveitamento efetivo é ~6 dias. Na primeira visita ainda é uma requisição por foto inédita. Mitigação barata: as fotos de variação só são montadas quando a aba "Variações" está ativa, e a lista colapsada carrega apenas a capa da família (1 por produto). |
| Suporte somente leitura preenche o cadastro inteiro para levar 403 | `canWrite()` só é consultado no upload (`dialog-cadastro-produto.tsx:149-155`), enquanto a edge exige escrita (`cadastrar-produto/index.ts:59-67`) e os botões aparecem sempre (`Estoque.tsx:167-174`). "Dar entrada" e "Cadastrar produto" passam a ser desabilitados sob `canWrite() === false`, com `title` explicando. |
| Reflow visual em telas estreitas | Cada card usa `min-w-0` + `truncate`; o teste de ausência de `<table>` e a checagem no Playwright cobrem. |
| Mudar `MovimentosEstoque` quebrar Publicados | Publicados é consumidor do mesmo componente (§3.3), e a suíte atual **não** o cobre (§7). Mitigação: teste novo com família carregada + verificação visual da tela antes do merge. |
| Upload em lote na etapa 1 falhar no meio | Cadastro já está salvo; a etapa 2 lista os alvos que faltaram com reenvio individual. Nunca reportar sucesso limpo com foto pendente. |

## 8.1 Dívida registrada, não corrigida aqui

**Empate de `criado_em` no corte da família canônica.** `agruparProdutosComSaldo`
(`produtos-saldo.ts:33-48`) guarda apenas o maior `criado_em` por `codigo_pai` e depois aceita
**toda** linha cujo timestamp seja igual a ele. Duas famílias do mesmo `codigo_pai` criadas no
mesmo instante seriam ambas tratadas como canônicas, somando variações e saldo — exatamente o
que o comentário das linhas 29-32 diz estar evitando.

Não é corrigido nesta entrega por três motivos: é pré-existente e não introduzido pelo
redesenho; é caminho de saldo, onde a regra do projeto proíbe mudança sem cuidado equivalente
ao do backend; e o desempate correto tem que ser **idêntico** ao que as RPCs de estoque usam
(âncora ADR-0025), o que exige ler o SQL das RPCs, não só o cliente. Corrigir só o frontend
faria a tela discordar do que o sistema realmente debita.

Entrega própria, com: `familias.id` no `select`, desempate igual ao do backend, e teste de
timestamps iguais em `src/lib/__tests__/produtos-saldo.test.ts`.

## 8.2 Decidido — a foto NÃO participa do enriquecimento por IA nesta entrega

**Decisão do Diego em 2026-08-01: opção A.** A entrega segue frontend-only e declara a
limitação. A opção B (deferir o enfileiramento) vira trabalho próprio, se for pedida.

Levantada na segunda revisão adversarial. Registrada aqui porque muda o escopo da §2.1 e
porque a §5.2 depende dela.

O problema (detalhado na §5.2): `cadastrar-produto` enfileira `process-familia` antes de
responder, e o worker pula a resolução de cor por Vision quando `imagem_path` está vazio. Como
o upload só pode acontecer depois da resposta, a foto tende a chegar tarde demais para a IA.
Vale para o fluxo atual e continua valendo com a foto movida para a etapa 1.

| Opção | Custo | Consequência |
|---|---|---|
| **A — Frontend-only, limitação declarada** | zero | Entrega sai como planejada. A cor por Vision continua não acontecendo no cadastro manual; o operador ajusta na Revisão, como hoje. |
| **B — Deferir o enfileiramento para depois do lote de fotos** | mexe em `cadastrar-produto` e no contrato da tela | A foto passa a participar da IA. Toca caminho de publicação, exige cuidado de edge (idempotência, o que fazer se o operador nunca subir foto, timeout) e provavelmente ADR. |

**Recomendação: A nesta entrega, B como trabalho próprio.** O pedido do Diego foi de usabilidade
da tela; B é uma mudança de pipeline com risco desproporcional para embutir num redesenho de UI,
e a limitação já existe hoje — não estaríamos entregando uma regressão, apenas deixando de
consertar algo que não foi pedido. Se a resposta for B, ela vira spec própria e esta entrega não
espera por ela.

## 9. Documentação a atualizar na entrega

- `docs/TASKS.md` — registro da entrega;
- `obsidian-vault/` — só se algo arquitetural mudar; esta entrega é de UI sobre contratos
  existentes, então a expectativa é "conferido sem necessidade de alteração";
- nenhum ADR novo: a decisão não altera arquitetura, modelo de dados nem contrato de edge.
  Se a revisão do plano concluir o contrário, o ADR vem antes da implementação.
