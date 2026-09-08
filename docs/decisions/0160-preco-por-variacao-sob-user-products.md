# ADR-0160 — Preço por variação sob User Products

**Status:** Aceito
**Data:** 2026-09-08
**Decisores:** Diego
**Relaciona:** corrige a premissa central de
[ADR-0078](0078-preco-por-variacao-split-por-faixa-e-controle-de-preco-no-update.md) (split por faixa
de preço) sem revogá-lo; estende [ADR-0088](0088-publicacao-user-products-multi-item.md) (publicação
UP multi-item) e [ADR-0104](0104-update-de-familia-migrada-para-user-products.md) (adoção de família
migrada); preserva os invariantes de [ADR-0016](0016-publicacao-update-reposicao-estoque.md)
(reposição de estoque), [ADR-0041](0041-preco-atacado-pxq-b2b.md) (PxQ por item),
[ADR-0055](0055-imposto-por-origem-nacional-importado.md) (nada financeiro defaulta em silêncio),
[ADR-0129](0129-adicionar-variacao-a-familia-publicada.md) (adicionar variação) e
[ADR-0157](0157-update-user-products-propaga-atributos-divergentes.md) (atributos na reposição).
**Plano:** `docs/superpowers/plans/2026-09-08-preco-por-variacao-user-products.md`

## Contexto

O Mercado Livre passou a oferecer, no painel do vendedor, "Oferecer preço por variação" — no anúncio
"Tecido Oxford Liso 10m" (MLB4831319319), entre outros. Diego quer usar o recurso.

### O que o recurso é, de fato

Lido na doc oficial (`developers.mercadolivre.com.br/pt_br/preco-variacao` e `/pt_br/user-products`):

**Preço por variação não é um campo novo em `variations[]`. É a migração do anúncio para o modelo
User Products**, processo chamado **UPtin**:

- disparo por `POST /sites/MLB/items/user_product_listings`; elegibilidade em
  `GET /items/$ITEM/user_product_listings/validate`. **Assíncrono**;
- durante a migração o item original segue **ativo**, com as tags `variations_migration_pending` +
  `variations_migration_source`; cada variação vira um **item MLB novo**, criado `paused`, com
  `variations_migration_pending` + `variations_migration_uptin`;
- ao concluir, `_pending` cai dos dois lados, os novos itens são ativados e o **item original é
  encerrado (`closed`)**;
- depois de migrado, **`variations[]` deixa de existir** e enviar `variations` sob UP devolve **400**;
- `sold_quantity` é herdado pelos novos itens, mas **as ordens antigas continuam associadas ao item
  antigo**.

### A premissa que isso derruba

O ADR-0078 §Contexto item 2 registrou: *"Preço uniforme entre variações de um mesmo anúncio é
premissa assumida em produção"*, e o código repetia em comentário *"o ML exige preço único entre
variações"* (`_shared/ml/atualizar.ts`, `_shared/canais/mercado-livre.ts`). Sobre essa premissa foi
construído o **split por faixa de preço**: para vender cores a preços diferentes, o app criava N
anúncios, um por faixa.

A premissa está **certa para o modelo Legacy** (um item, N variações — o ML de fato recusa
`Found different prices in variations`) e **errada como afirmação sobre o ML inteiro**: sob User
Products cada cor já é um item próprio, com preço próprio. O PubliAI publica nesse modelo desde o
ADR-0088 — e mesmo lá colapsava o preço num escalar (`precoFamilia` = primeiro `preco_publicacao`
não-nulo da família), por herança do caminho Legacy. Não havia razão técnica: o colapso achatava em
silêncio qualquer preço diferenciado.

### O que a trava escondia

`garantirPrecoUniforme` rodava **antes** do roteamento Legacy/UP. Ao mover a trava para o ramo
Legacy, quatro caminhos que ela bloqueava por acidente ficariam expostos. Todos foram corrigidos
nesta entrega, como pré-requisito:

1. **Janela do UPtin.** `buscarItemML` não lia `tags`. Um "Atualizar tudo" durante a migração vê o
   item ainda `active` e com `variations` povoado, roteia Legacy, faz o PUT e recebe **200** — mas os
   clones já haviam sido criados a partir do estado anterior. O banco gravaria
   `preco_publicado_ml` como confirmado enquanto a vitrine sobe com o preço velho. Sem erro, sem
   badge.
2. **Atacado UP não reaplicava em reprice puro.** `efeitosPosComposicao` só rodava com
   `houveMudanca`; um update que mudasse apenas o preço saía antes, e o PxQ continuava calculado
   sobre o preço antigo.
3. **Config por cor ignorada no UP.** A Revisão grava `variacoes.exibir_com_desconto`/`atacado` por
   variação (ADR-0078 F2); o caminho UP lê só `familia.atacado`. O operador configuraria por faixa e
   o app publicaria o valor família-level, com 200.
4. **"Adicionar variação" repreçava as irmãs.** `preservarPublicadas` era calculado depois do
   `return rodarUP` e nunca chegava ao caminho UP.

## Decisão

### 1. Preço por SKU no caminho User Products

`EntradaComposicao.precoFamilia` (escalar) é **substituído** por
`precoPorSku: Record<string, number | null>`, simétrico ao `estoquePorSku` que já existia. Três
formas, deliberadamente distintas:

- **número** → empurra este preço neste item;
- **`null`** → preserva o preço vivo do item. É o que o fluxo "adicionar variação" usa nas cores já
  publicadas, e o que uma variação sem `preco_publicacao` produz;
- **chave ausente** em "atualizar tudo" → lacuna de dado, **falha alto**, checada para todos os
  alvos **antes do primeiro PUT** (validar dentro do laço deixaria metade da família num preço e
  metade noutro, sem transação que desfaça). Na prática o adapter cria chave para toda variação, com
  `null` quando não há preço; a trava protege o caminho de `skusDesejadosOverride`, em que o
  conjunto de alvos não vem de `variacoes`.

O **reconciliador de convergência** (`reconciliar-convergencia-up`) chama `atualizarFamiliaUP` com
`somenteEstoque: false` e sem `preservarPublicadas`: ele empurra o `preco_publicacao` do banco para
todas as cores. É o preço desejado, não um preço de outra cor — mas, se o episódio travado nasceu de
"adicionar variação", a convergência repreça as irmãs, que é o B4 que I10 fecha no caminho normal.
Registrado como dívida (abaixo), não resolvido aqui.

`Number()` explícito ao montar o mapa: `numeric` do Postgres chega como string pelo supabase-js, e o
PUT sairia com `"price":"29.90"`.

### 2. O contrato canônico multicanal NÃO muda

`AtualizacaoCanonica.precoFamilia` fica intocado, com o comentário corrigido para "preço único do
item Legacy/partição". O caminho UP **não passa pelo contrato** — `atualizarFamiliaUP` chama
`atualizarItemPlanoML` direto. Adicionar preço por SKU ali criaria um campo que nenhum consumidor lê
e que um canal futuro poderia preencher esperando comportamento por variação, além de quebrar
`_shared/canais/fake.ts`.

### 3. Split por faixa continua — só para Legacy

`decidirSplit` ganha o sinal `ehUP`. Divergência de preço força split **apenas** quando a família não
é User Products. Os outros dois gatilhos (mais de 100 cores; família já particionada) valem nos dois
modelos.

O sinal é **estrutural** — existência de linha em `anuncios_externos_itens` para o pai —, nunca o
cache de formato por categoria. O cache diz "esta categoria é UP", o que **não** implica que esta
família já tenha sido migrada; usá-lo classificaria como UP uma família Legacy ainda Legacy, e o
worker Legacy então a barraria com preço divergente, contradizendo o que a UI prometeu.

### 4. A migração é disparada pelo operador, no painel do ML

> **REVOGADA no mesmo dia pelo [ADR-0161](0161-botao-migrar-preco-por-variacao.md).** Ao ver o
> roteiro de validação, que exigia alternar entre o painel do ML e o app, Diego recusou o fluxo
> partido em dois sistemas. O app passou a ter o botão, com confirmação explícita — tão deliberada
> quanto o clique no painel. Além disso, disparar pelo app permite **fotografar `variations[]` antes
> da migração**, e é esse snapshot que impede o casamento errado com uma família irmã de mesmo título
> e mesmas cores. O texto abaixo fica como registro da decisão original.

O app **não** chama `POST /sites/MLB/items/user_product_listings` e **não** ganha botão de migração.
Ele detecta e adota, pelo caminho do ADR-0104. Motivo: a migração é irreversível (o item original é
encerrado e as ordens antigas ficam nele) e a decisão é comercial, não técnica.

### 5. Escrita bloqueada durante a janela de migração

`buscarItemML` e `buscarItemBackfill` passam a ler `tags`. `atualizarAnuncio` e `atualizarEstoque`
recusam item com `variations_migration_pending`, com o código novo `MIGRACAO_EM_ANDAMENTO`
(**retentável**, 409 — a migração termina sozinha). `adotarFamiliaMigrada` adia a adoção de clone em
criação, com mensagem de espera.

**Só `_pending` conta.** `_uptin` identifica o clone e `_source` marca o original encerrado; nenhuma
das duas tem queda documentada, e barrar por elas tornaria item já migrado (ou dissolvido, ADR-0105)
permanentemente inatualizável — um bug pior que o evitado. Adotar um clone `paused` seria igualmente
grave: `listar()` lê o banco e nunca mais o ML, então o filho ficaria `pausado` para sempre e a
família presa em `filho_em_estado_terminal`, destravável só editando `anuncios_externos_itens` à mão.

### 6. Desconto e atacado seguem família-level nesta entrega

O PxQ é por item na API do ML e o valor é **absoluto** (ADR-0041). Com preços divergentes não existe
base única legítima: aplicar o preço da primeira cor daria a todos os itens um valor B2B calculado
sobre outra cor. Enquanto o atacado não for por variação:

- **atacado ativo + preços divergentes** → não aplica, grava `atacado_status='erro'` com a causa;
- **qualquer `variacoes.atacado`/`exibir_com_desconto` não-nulo em família UP** → mesma recusa;
- a UI não renderiza o editor de config por faixa sob UP.

Nada financeiro defaulta em silêncio (ADR-0055).

### 7. `preco_publicado_ml` passa a ser gravado no UPDATE UP

Por item, **logo após o PUT daquele item**. A coluna nunca era escrita nesse caminho (o worker
retorna em `rodarUP` antes do bloco que a grava no Legacy), então o badge "preço alterado" de família
UP ficava aceso para sempre depois do primeiro reprice. Gravar por item, e não em bloco no fim, faz
um retry esgotado deixar o banco refletindo exatamente os PUTs que subiram. Em `somenteEstoque` nada
é gravado — o valor anterior continua verdadeiro.

## Invariantes

| # | Invariante |
|---|---|
| I1 | Legacy divergente continua roteando para split; a trava lança 400 nesse ramo |
| I2 | Família UP divergente publica sem split, cada item com o seu preço |
| I3 | `somenteEstoque` nunca envia preço, nos dois caminhos |
| I4 | `preco_publicado_ml` de um SKU reflete o preço daquele SKU, gravado após o PUT dele |
| I5 | Atacado ativo + preços divergentes → LOUD, nada enviado |
| I6 | SKU alvo **ausente** do mapa em "atualizar tudo" → LOUD antes de qualquer PUT (preço `null` preserva, não bloqueia) |
| I7 | Config por cor não-nula em família UP → LOUD, nunca ignorada |
| I8 | Em `somenteEstoque`, `preco_publicado_ml` não muda |
| I9 | Item com `variations_migration_pending` não recebe PUT; clone em migração não é adotado |
| I10 | `preservarPublicadas` no UP: cores existentes só recebem `available_quantity` |

## Consequências

- **Positivas:** preço por variação funciona onde o ML o oferece, sem criar N anúncios nem perder
  histórico; o badge "preço alterado" volta a funcionar em família UP; quatro caminhos de preço/PxQ
  errado com resposta 200 fecham; o caminho Legacy fica intocado.
- **A migração custa o histórico de pedidos.** As ordens antigas permanecem no item encerrado. As
  métricas do PubliAI que casam por `ml_item_id` referenciam o item antigo para vendas anteriores à
  migração. Não há contorno de código — é como o ML implementou.
- **Categoria nunca publicada + preços divergentes = bloqueio.** O formato só se revela quando um
  POST Legacy falha com a assinatura UP, e sondar exigiria criar um anúncio real (o ML não tem
  sandbox). A mensagem do guard ensina a saída: publicar uniforme uma vez semeia o cache.
- **Família já dividida em N partições que migre para UP continua beco sem saída** (ADR-0105 §7).
  Não piora com esta entrega; não é resolvido por ela.
- **`precoAtual` em Publicados é o preço de um filho.** Vem do ML por `familias.ml_item_id`, que sob
  UP aponta para um item (ADR-0088 §5). A tela passa a rotular `(1ª cor)` em vez de apresentá-lo como
  preço da família. Ler todos os filhos ao vivo fica pendente.

## Dívidas declaradas (fora do escopo, não esquecidas)

1. **Automatização de Preços.** Desde 18/03/2026 o ML rejeita PUT de preço em item com *dynamic
   pricing* ativo (`item.price.not_modifiable`), ou ignora o `price` com 200 + warning quando ele vem
   junto de outros campos. Vale só para itens com automação ativa — não é o caso hoje —, mas o app
   nunca consulta `/pricing-automation/items/{id}/automation` antes de um PUT de preço.
2. **Atacado e desconto por variação.** Tecnicamente possíveis sob UP (cada cor é um item); hoje
   recusados com LOUD.
3. **`precoAtual` por filho** em Publicados e no Estoque.
4. **`dialog-reprecificar`** ainda recusa família com preços divergentes; sob UP o fluxo funciona via
   edição por variação + "Atualizar tudo", então basta corrigir a mensagem.
5. **Reconciliador de convergência** não recebe `preservarPublicadas` nem preço `null` por SKU: uma
   convergência de episódio nascido em "adicionar variação" repreça as irmãs.
6. **Cor nova sem `preco_publicacao`** vai ao POST com `price: 0` (`_shared/ml/publicar.ts`),
   dependendo de o ML recusar. Pré-existente, compartilhado com o Legacy.
7. **Orçamento de retry na janela do UPtin.** O QStash dá ~10×30s ao UPDATE e ~3×10s ao push de
   estoque; a migração é assíncrona e pode passar disso. Se passar, a família fica em erro (o
   operador republica) e um push de estoque daquele instante é perdido — o saldo volta na próxima
   movimentação ou na reconciliação horária. A mensagem do guard pede para aguardar e publicar de
   novo, em vez de prometer que o app resolve sozinho.
8. **Desconto ligado depois do CREATE é ignorado em silêncio no UP.** O CREATE recusa desconto em
   User Products (`DESCONTO_INCOMPATIVEL`), mas a Revisão permite ligar `familias.exibir_com_desconto`
   depois, e o UPDATE UP não lê esse campo — não monta `original_price`. O preço de venda continua
   certo; o que não acontece é o selo "% OFF". Pré-existente, não introduzido aqui.
9. **CREATE não consulta o cache de formato** para decidir split: `ehUP` é estrutural (itens já
   existem), e família **nova** não tem itens. Uma família nova com preços divergentes em categoria
   já conhecida como User Products vai para o split e falha com `FORMATO_INCOMPATIVEL`. Mesmo
   comportamento de antes desta entrega; não regride, mas I2 vale só para famílias já publicadas.

## Alternativas consideradas

- **Aposentar o split.** Rejeitada: o ML só oferece preço por variação sob UP, e famílias Legacy
  continuam existindo.
- **Manter o split como único caminho** (dividir o anúncio migrado em N). Rejeitada: mover variação
  publicada entre itens no ML exige deletar e recriar, perdendo vendas, perguntas e histórico — num
  anúncio com 1145 unidades vendidas, custo alto para resolver o que o modelo UP já resolve.
- **Adicionar `precoPorSku` ao contrato canônico** mantendo `precoFamilia`. Rejeitada: dois caminhos
  de preço convivendo, nenhum consumidor no UP, e quebra do conector fake.
- **Sondar o formato com `POST /items/validate`** antes de barrar CREATE divergente em categoria
  desconhecida. Adiada: a doc não traz exemplo de validação com payload UP.
