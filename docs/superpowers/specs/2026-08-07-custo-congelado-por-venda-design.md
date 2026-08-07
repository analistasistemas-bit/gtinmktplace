# Design — Custo congelado por venda (markup histórico fiel)

**Data:** 2026-08-07
**Status:** aguardando aprovação
**Origem:** ADR-0108 registrou "custo histórico por data de venda" como decisão não tomada.
**Refina:** ADR-0108 (tie-break de custo), ADR-0038 (fonte única `ml_vendas`)

## Problema

O markup de uma venda é calculado com o custo **cadastrado hoje**, não com o que valia quando a
venda aconteceu. Consequências:

- O markup de uma venda de junho muda sozinho quando uma planilha de agosto altera o custo.
- Não há como auditar: o número de ontem não é reproduzível hoje.
- Medido em 2026-08-07: **307 dos 1164 itens vendidos** exibem hoje um custo diferente do que
  vigorava na data da própria venda.

## Requisito (nas palavras do Diego)

1. Cada venda armazena o custo do produto **no momento da venda**.
2. Esse custo **não muda mais**, mesmo com novas planilhas.
3. Planilhas com custo novo **só afetam vendas posteriores** à importação.
4. O custo vigente é sempre o da **última importação, cadastro de produto ou recebimento**.

O item 4 já é verdade sem trabalho extra: os três caminhos escrevem em `variacoes.custo`
(`ingest-lote` direto; `registrar_entrada` para cadastro e recebimento). Congelar o valor de
`variacoes.custo` no instante da venda satisfaz os quatro itens.

## Decisões tomadas (aprovadas em 2026-08-07)

| Decisão | Escolha | Alternativas descartadas |
|---|---|---|
| Onde mora a verdade | Congelar na venda | Histórico de custo por produto; os dois |
| Vendas já existentes | Reconstruir pelo lote vigente na data | Congelar o custo de hoje; deixar em branco |
| Custo congelado errado | Sem escape — corrige-se no banco | Botão por venda; recálculo em massa |
| Onde gravar | Tabela satélite insert-once | Coluna em `ml_vendas_itens` |

### Por que tabela satélite, e não uma coluna

`_shared/faturamento/io.ts:260` **apaga e reinsere** todos os itens a cada sync do pedido — e um
pedido sincroniza várias vezes (pago → enviado → entregue). Uma coluna em `ml_vendas_itens` seria
destruída e regravada a cada notificação, descongelando o custo. Preservá-la exigiria que o código
lembrasse de reler e reaplicar antes de cada regravação: funciona hoje, quebra silenciosamente no
dia em que alguém mexer no `io.ts`.

A tabela satélite é imune **por construção** — o `DELETE` dos itens não a alcança — e permite uma
trava real: um trigger que faz o `UPDATE` do custo **falhar**, em vez de deixar passar. É a mesma
exigência que já vale para imposto por origem: caminho financeiro não defaulta nem muda em
silêncio.

## Arquitetura

### 1. Tabela `venda_item_custo`

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid pk | |
| `org_id`, `user_id` | uuid | RLS, igual às demais tabelas de domínio |
| `venda_id` | uuid fk → `ml_vendas` on delete cascade | venda apagada leva o custo junto |
| `ml_item_id` | text | |
| `variation_id` | bigint null | |
| `codigo` | text null | o SKU casado, para auditoria |
| `custo_unitario` | numeric | **o valor congelado** |
| `congelado_em` | timestamptz | quando foi gravado |
| `fonte` | text `'sync'` \| `'backfill'` | distingue capturado ao vivo de reconstruído |

**Unicidade:** `unique nulls not distinct (venda_id, ml_item_id, variation_id)`.

No Postgres, `NULL` é distinto de `NULL` num índice único, então `(venda, item, NULL)` duplicaria
à vontade — e item sem variação é o caso comum (a venda da COLA que originou tudo isto tem
`variation_id = null`). Sem tratar isso, "insert-once" não valeria justamente para eles.

> **Corrigido na revisão (2026-08-07).** A primeira versão deste design usava
> `COALESCE(variation_id, -1)` num índice de expressão. Não funcionaria: supabase-js/PostgREST só
> inferem o arbiter de `ON CONFLICT` por **lista de colunas**, então o insert-once falharia na
> prática. `nulls not distinct` (PG15+) resolve, cobre também `ml_item_id` nulo — que a primeira
> versão ignorou — e é **o mesmo padrão que `ml_vendas_itens` já usa**
> (`20260627095025_add_ml_vendas_itens_unique.sql`).

**RLS:** por `org_id`, no mesmo padrão das outras tabelas de domínio.

### 2. Trava: trigger que barra alteração

`BEFORE UPDATE` em `venda_item_custo`: se `custo_unitario` mudar, `RAISE EXCEPTION`. Congelado é
congelado — quem tentar descongelar recebe erro, não sucesso silencioso. `DELETE` continua
permitido (o cascade da venda depende dele).

### 3. Gravação (dentro de `upsertVenda`, não no `sync-venda`)

Depois de gravar os itens, no próprio `io.ts`:

1. Para cada item, resolver o **custo vigente** em `variacoes`.
2. `INSERT ... ON CONFLICT DO NOTHING`.

O `ON CONFLICT DO NOTHING` é o coração do insert-once: o primeiro sync grava, todos os seguintes
não fazem nada. Combinado com o trigger, não existe caminho que altere o valor.

> **Corrigido na revisão (2026-08-07).** A primeira versão mandava congelar "no `sync-venda`", e
> isso deixaria **três caminhos sem congelamento**: `ml_vendas_itens` é escrito por um único
> writer (`upsertVenda`), mas ele é chamado por **quatro** functions — `sync-venda`,
> `sync-devolucao`, `backfill-faturamento` (que é quem *descobre* vendas novas no schedule
> horário) e `reconciliar-faturamento` (dois call sites). Verificado por grep no repositório.
>
> O congelamento vai para dentro de `upsertVenda`, e o resolver de custo entra como campo
> **obrigatório** de `opts`: o TypeScript quebra a compilação de qualquer caller que esqueça. É
> trava em tempo de build, não convenção — no mesmo espírito de "caminho financeiro falha, não
> passa em silêncio".
>
> Verificado também que `ml-webhook` apenas enfileira (não escreve itens) e que
> `usuarios/index.ts` só deleta, o que o trigger permite via cascade.

**Resolução do custo vigente** — nova função `_shared/faturamento/custo-vigente.ts`, espelhando a
cadeia que o frontend já usa (`src/lib/custos.ts`): `variation_id → ml_item_id → gtin → codigo`,
e dentro de cada chave, a variação **mais recente** por `atualizado_em` (ADR-0108). Item que não
casa com nenhuma variação não gera linha — a venda simplesmente fica sem custo congelado, como
hoje.

### 4. Leitura (frontend)

`buscarVendas` passa a trazer o custo congelado junto dos itens. O resolver de custo prefere o
congelado; **sem congelado, cai no comportamento atual** (resolução dinâmica). Nenhuma tela muda
de layout — só a origem do número.

### 5. Backfill

Migration de dados, idempotente (`ON CONFLICT DO NOTHING`), com `fonte = 'backfill'`: para cada
item, o custo da variação cujo **lote é o mais recente anterior à data da venda**.

Cobertura medida: **1163 dos 1164 itens (99,9%)**; 1 item sem lote anterior fica sem custo. Em
**307 itens** o valor difere do custo de hoje — são exatamente os markups hoje errados.

O casamento normaliza o código (`ltrim(codigo, '0')`) dos dois lados, para acompanhar o
`normGtin` que o frontend já usa. Medido: com e sem normalização a cobertura é a mesma (1163) —
os códigos atuais já estão padronizados em 8 dígitos —, então a normalização não muda o resultado
hoje e protege contra divergência de zeros à esquerda depois.

É aproximação assumida: usa a data do lote, então não capta uma mudança de custo por recebimento
entre o lote e a venda. A coluna `fonte` deixa isso explícito no dado.

## Bordas e erros

| Situação | Comportamento |
|---|---|
| Item não casa com nenhuma variação | Não grava. UI segue como hoje (sem custo) |
| Re-sync do mesmo pedido | `ON CONFLICT DO NOTHING` — não toca no valor |
| Pedido ganha um item novo num sync posterior | O item novo congela com o custo daquele momento |
| Venda excluída | Cascade apaga o custo junto |
| Alguém tenta `UPDATE` no custo | Erro do trigger |
| Venda anterior ao backfill sem lote anterior | Fica sem custo congelado; resolução dinâmica |

## Testes

- `custo-vigente`: a cadeia resolve por variação, item, gtin e código, com tie-break do mais recente
- Item sem casamento não gera linha
- Re-sync não altera o custo já gravado (o caso que a coluna simples não garantiria)
- Backfill é idempotente: rodar duas vezes não duplica nem altera
- Trigger rejeita `UPDATE` do custo — verificado por SQL contra o banco, não só por unidade
- Frontend: com custo congelado usa ele; sem custo congelado mantém o comportamento atual

## Critérios de sucesso (verificáveis)

1. `pnpm test` verde, incluindo os testes acima.
2. `UPDATE venda_item_custo SET custo_unitario = 1` **falha** com o erro do trigger.
3. Backfill: **no máximo 1 item com código fica sem custo** (o único sem lote anterior); segunda
   execução insere 0. Número absoluto não serve de critério — a base é viva: 1163/1164 às 18h e
   1166/1167 às 21h do mesmo dia.
4. Na venda `2000017810823298` (COLA, 07/08), o custo congelado é `15,8558`.
5. Numa venda de junho do mesmo produto, o custo congelado é `17,1224` — valores diferentes para
   o mesmo SKU, provando que o histórico é fiel.
6. Depois de subir uma planilha com custo novo, o markup de uma venda anterior **não muda**;
   uma venda posterior sai com o custo novo.

## Fora de escopo

- Corrigir/descongelar custo pela interface (decisão: sem escape)
- Deduplicar as famílias do re-ingest (raiz registrada no ADR-0108, projeto à parte)
- Congelar comissão, frete ou imposto — só o custo
- Qualquer mudança visual nas telas
