# ADR-0161 — Botão "Migrar para preço por variação" no PubliAI

**Status:** Aceito
**Data:** 2026-09-08
**Decisores:** Diego
**Relaciona:** **revoga a §4 do [ADR-0160](0160-preco-por-variacao-sob-user-products.md)** (tomada
horas antes, no mesmo dia); usa a adoção de [ADR-0104](0104-update-de-familia-migrada-para-user-products.md)
e o re-vínculo de [ADR-0105](0105-revinculo-de-familia-dissolvida-pelo-ml-em-user-products.md); respeita a partição comercial
de [ADR-0048](0048-split-produto-n-anuncios-ml.md)/[ADR-0078](0078-preco-por-variacao-split-por-faixa-e-controle-de-preco-no-update.md);
gate admin de [ADR-0060](0060-pausar-reativar-anuncio-ml.md); PxQ por item de
[ADR-0041](0041-preco-atacado-pxq-b2b.md); regra financeira de
[ADR-0055](0055-imposto-por-origem-nacional-importado.md).
**Plano:** `docs/superpowers/plans/2026-09-08-botao-migrar-preco-por-variacao.md`

## Contexto

O ADR-0160 §4 decidiu que a migração UPtin seria disparada pelo operador **no painel do Mercado
Livre**, e que o app apenas detectaria e adotaria o resultado. A justificativa era que a migração é
irreversível e a decisão, comercial.

Ao receber o passo a passo de validação — que exigia alternar entre o painel do ML e o PubliAI —, o
Diego recusou: *"não faz sentido estar fazendo isso em dois lugares"*.

A justificativa do ADR-0160 continua válida; o que muda é **onde a decisão consciente acontece**. Um
botão com confirmação explícita é tão deliberado quanto clicar no painel do ML, e elimina um fluxo
partido entre dois sistemas.

### O ganho técnico que só o botão tem

Quando o app controla o instante do disparo, ele pode **fotografar o item antes de migrar**:
`variations[]` com `id`, `seller_custom_field` e `COLOR`. Esse snapshot não depende do que o ML fizer
com o item encerrado nem do estado local, e é o que permite casar cor → anúncio novo usando **apenas
identificadores que o ML atribuiu a este item**.

Sem ele, o caminho disponível é a descoberta por título do ADR-0105 — que localiza por `?q=` e valida
somente que o `family_id` seja único. Uma **família irmã** do mesmo vendedor, com o mesmo título e as
mesmas cores (produto parecido já migrado, republicação antiga, variante de gramatura), passaria
nessa validação e o app adotaria **os anúncios de outro produto**, com resposta 200 e nenhum sinal.
Casar errado é pior que falhar.

## Decisão

### 1. Botão admin-only na tela Publicados, com confirmação explícita

Mesmo gate do ADR-0060 — e com razão mais forte: pausar é reversível, isto não é. O diálogo declara
que a ação não pode ser desfeita, que o anúncio atual será encerrado, que os pedidos já feitos
continuam nele, e que o selo "% OFF" deixa de aparecer.

### 2. Estado na raiz `anuncios_externos` (partição 0), não em `familias`

Há N linhas em `familias` por `codigo_pai` (uma por lote), e cada consumidor escolhe uma diferente: a
Publicados usa a **mais antiga** (`src/lib/publicados.ts:82-101`), enquanto `ingest-lote` e
`sincronizar-estoque` usam a **mais nova**. Estado gravado na família do botão seria invisível para
metade do sistema. A raiz é única por `(org_id, canal, codigo_pai, particao)`.

Colunas novas em vez de reusar `estado_desejado`, cujo CHECK e semântica pertencem ao ADR-0088:
`migracao_pxv_status`, `_erro`, `_solicitada_em`, `_tentativa`, `_snapshot`, e `ml_item_id_anterior`.

### 3. Doze recusas antes de qualquer escrita no ML

Ownership (o molde `atualizar-status-publicado` **não** checa que o item é da org — o buraco não foi
herdado); produto não publicado; **produto dividido em N anúncios**; raiz ausente; migração já em
curso; raiz ou família mais nova incoerentes; família publicando; **componente de kit virtual**;
inelegível pelo ML; snapshot vazio; **duas variações com a mesma cor**; e perda do claim atômico.

Cada recusa tem teste provando que o ML não foi tocado.

### 4. Casamento em cascata, sem busca por título

**(a)** `new_items[].variation_id` → snapshot → SKU. **(b)** COLOR dos `new_item_id` (multiget) →
cor do snapshot. **Não existe degrau (c) por título** — pelo motivo do §Contexto. Falhando os dois,
aborta tudo-ou-nada e devolve a decisão ao operador, cujo próximo UPDATE ainda tem o caminho do
ADR-0105 disponível.

Travas: snapshot sem SKU cai para o `ml_variation_id` local (ids do mesmo item); `normalizarCodigo`
no casamento; cor duplicada aborta em vez de escolher.

### 5. Claims atômicos, não check-then-set

Disparo: `update … where migracao_pxv_status is null returning`. Worker: `where tentativa = n-1`.
Sem isso, dois admins (ou um clique duplo) leriam `null` ao mesmo tempo e ambos disparariam algo
irreversível; e um 500 no worker faria o QStash retentar enquanto a rodada anterior já se
re-enfileirou, adotando e notificando em dobro. O worker responde **sempre 200** e controla a própria
repetição.

### 6. Falha no POST não limpa o estado

A idempotência do endpoint **não é documentada**: "a chamada falhou" não prova "a migração não
começou". Limpar convidaria o operador a clicar de novo. O app registra a falha, **enfileira o
acompanhamento assim mesmo** — se o ML iniciou, o worker descobre e adota — e responde 502 dizendo
para não repetir.

### 7. Orçamento finito, porque a API não tem estado de falha

Não há `failed`, não há campo de erro, não há webhook de conclusão. Migração travada é
indistinguível de lenta. Backoff de 15 min enquanto o ML cria os filhos e de 1 min depois de
`migration_completed` (encurtar essa janela reduz o tempo em que um clone está no ar e o app ainda
não o reconhece), com teto de ~6 h. Esgotado: `erro` + notificação.

### 8. Push de estoque com trava anti-oversell

Empurrar o saldo local logo após a adoção é perigoso: se houve venda no clone antes de o app
reconhecê-lo, o webhook chegou com um item fora de `idsPubliai`, a baixa não aconteceu, o saldo local
ficou **alto demais**, e o push **restauraria unidades vendidas**. Regra: por SKU, empurra só se
`saldo_local ≤ vivo`; no desvio, não escreve e notifica nominalmente. Falha ao ler o saldo vivo conta
como suspeita — silêncio não vira permissão.

### 9. Vendas antigas continuam sendo do PubliAI

`fundirAnunciosMigrados` soma `ml_item_id_anterior` a `idsPubliai` e usa o snapshot para popular
`codPorVar`/`eanPorVar` com `"{anterior}:{variation_id}" → sku`. Sem isso, um pedido antigo
reprocessado viraria venda de fora, sem código e sem custo — a mesma classe de falha do incidente de
2026-08-11 (12 unidades vendidas sem baixar estoque). O snapshot **nunca é limpo**: vira histórico.

## Invariantes

| # | Invariante |
|---|---|
| J1 | Disparo só com `is_valid: true`; corpo inesperado do ML **não** vira "pode migrar" |
| J2 | Admin-only **e** família da org do chamador |
| J3 | Um disparo por pai, garantido por claim atômico |
| J4 | Snapshot e estado gravados antes do POST |
| J5 | Adoção só com `activation_completed`; `migration_completed` sozinho não basta |
| J6 | Casamento sem busca por título; falhando, aborta tudo-ou-nada |
| J7 | Orçamento finito → `erro` + notificação |
| J8 | Família em migração não publica, não pausa, não é removida |
| J9 | Pós-adoção: catálogo reenfileirado, `atacado_status` resetado, estoque só onde `local ≤ vivo` |
| J10 | Família dividida nunca migra pelo botão |
| J11 | Componente de kit virtual nunca migra pelo botão |
| J12 | `emMigracao` na adoção é retry, não erro |
| J13 | Snapshot e `ml_item_id_anterior` sobrevivem à conclusão |

## Consequências

- **Positivas:** o operador não toca no painel do ML; o casamento fica mais confiável que na migração
  manual; três bugs de estado (ownership, kit virtual, produto dividido) ficam barrados por
  construção.
- **Irreversível, por natureza do ML.** Não há endpoint de cancelamento.
- **Pedidos antigos ficam no anúncio encerrado**, e a métrica de vendas da Publicados recomeça do
  zero para o produto (`metricas-vendas` monta escopo por `ml_item_id`; o ML herda `sold_quantity`, o
  app não). O histórico antigo continua no banco.
- **O selo "% OFF" some** após migrar (dívida 8 do ADR-0160).
- **Famílias divididas e produtos em kit virtual ficam de fora** — aceito explicitamente pelo Diego
  em 2026-09-08.
- **`/sites/MLB/` é inferência.** A doc só publica o endpoint com `/sites/MLM/`. Se estiver errado, o
  primeiro clique falha com mensagem que diz exatamente isso.

## Dívidas declaradas (revisão final, 2026-09-08)

1. **Pontos de escrita sem guard de migração.** `sincronizar-estoque`, atacado, catálogo e
   `adicionar-variacoes-familia` podem escrever durante a janela. Consequências limitadas: um PUT de
   saldo rejeitado ou descartado é corrigido pelo push pós-adoção (`local ≤ vivo` cobre o caso
   legítimo), e uma variação criada no meio fica fora do snapshot, não é adotada, e o próximo UPDATE
   a cria como item novo.
2. **Criar Kit Virtual com componente em migração** é o único desses que deixaria artefato com
   dinheiro no ar — um kit ativo apontando para um `user_product_id` que vai morrer. O disparo já
   recusa produto que **é** componente de kit existente; falta a recíproca:
   `criar-kit-virtual` chamar `motivoMigracaoPxvPorItem` por componente. **Follow-up.**
3. **Timeout da edge entre o claim e o reenfileiramento** mata a cadeia (o retry do QStash perde o
   claim). A rodada de adoção faz N GETs + multiget + RPC e deve ficar bem abaixo do limite;
   residual aceito, sem sweeper.
4. **A UI não exibe o estado `erro`** da migração. O clique devolve a mensagem certa (recusa
   explicando que a saída é publicar uma atualização), mas a linha não mostra o estado.

## Alternativas consideradas

- **Manter a §4 do ADR-0160** (migrar no painel). Rejeitada pelo operador: fluxo partido em dois
  sistemas, e sem o snapshot a adoção depende da descoberta por título.
- **Estado em `familias`.** Rejeitada: a linha escolhida pelo botão não é a mesma que o resto do
  sistema lê.
- **Degrau de casamento por título como fallback.** Rejeitada: casa errado com família irmã.
- **Migração em lote.** Fora de escopo — o endpoint do ML também é um item por chamada, e o risco
  por clique se multiplicaria.
