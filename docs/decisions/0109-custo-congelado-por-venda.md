# ADR-0109 — Custo congelado no instante da venda

- **Status:** aceito
- **Data:** 2026-08-07
- **Refina:** [ADR-0108](0108-custo-duplicado-vence-o-mais-recente.md) (que deixou "custo histórico
  por data de venda" registrado como decisão **não** tomada)
- **Contexto relacionado:** ADR-0038 (fonte única `ml_vendas`), ADR-0016 (re-ingest UPDATE),
  ADR-0055 (imposto por origem — mesma cadeia de resolução)

## Contexto

O markup de uma venda é calculado com o custo **cadastrado hoje**, não com o que valia quando a
venda aconteceu. O número de ontem não é reproduzível hoje, e uma planilha de agosto reescreve o
lucro de uma venda de junho.

Medido em 2026-08-07: **307 dos 1164 itens vendidos** exibiam um custo diferente do que vigorava
na data da própria venda.

O ADR-0108 corrigiu qual das linhas duplicadas vence (a mais recente), mas manteve o custo
dinâmico — e registrou o congelamento como projeto à parte. Este ADR é esse projeto.

## Decisão

O custo do produto é **congelado no instante da venda** e não muda mais.

1. **Tabela satélite `venda_item_custo`**, chaveada por `(venda_id, ml_item_id, variation_id)` com
   `unique nulls not distinct`, e não uma coluna em `ml_vendas_itens`.

   Motivo: `_shared/faturamento/io.ts` **apaga e reinsere** todos os itens a cada sync do pedido, e
   um pedido sincroniza várias vezes (pago → enviado → entregue). Uma coluna seria destruída e
   regravada a cada notificação; preservá-la dependeria de o código lembrar de reler e reaplicar.
   A tabela satélite é imune **por construção**.

   `nulls not distinct` (PG15+) porque `variation_id` e `ml_item_id` são nulláveis, e no Postgres
   `NULL` não colide com `NULL` num índice único — sem isso, item sem variação duplicaria à
   vontade. É o mesmo padrão que `ml_vendas_itens` já usa (`20260627095025`). Índice de expressão
   (`COALESCE(...)`) foi descartado: o `ON CONFLICT` do supabase-js/PostgREST só infere o arbiter
   por lista de colunas, então o insert-once falharia na prática.

2. **Insert-once + trava:** gravação por `ON CONFLICT DO NOTHING` — o primeiro sync grava, os
   seguintes não fazem nada — e um trigger `BEFORE UPDATE` que faz qualquer alteração de
   `custo_unitario` **falhar**. Caminho financeiro não muda em silêncio; quem tentar descongelar
   recebe erro.

3. **O congelamento mora dentro de `upsertVenda`**, não nos callers. `ml_vendas_itens` tem um único
   writer, mas ele é chamado por quatro functions — `sync-venda`, `sync-devolucao`,
   `backfill-faturamento` (que é quem *descobre* vendas novas no schedule horário) e
   `reconciliar-faturamento` (dois call sites). O resolver de custo é campo **obrigatório** de
   `opts`: o TypeScript quebra a compilação de qualquer caller que esqueça — trava em build, não
   convenção.

4. **O custo vigente** é resolvido pela mesma cadeia do frontend (`variação → anúncio → GTIN →
   código`, tie-break `atualizado_em` mais recente, ADR-0108). A cópia servidor vive em
   `_shared/faturamento/custo-vigente.ts` e é amarrada à do cliente por um teste de paridade, no
   padrão de `tests/lib/paridade-preco-fe-be.test.ts`.

5. **Backfill** das vendas existentes pelo custo da variação cujo **lote é o mais recente anterior
   à data da venda**, marcado com `fonte = 'backfill'`.

   Cobertura: **todos os itens com código, menos os que não têm nenhum lote anterior à venda**.
   Medições sucessivas em 2026-08-07: 1163/1164 às 18h, 1166/1167 às 21h — a base é viva (vendas
   sincronizam o tempo todo), então o critério é a **razão**, não o número absoluto: no máximo
   1 item com código pode ficar sem custo, e ele é o mesmo desde a primeira medição (venda
   anterior ao primeiro lote do catálogo).

O item "custo vigente é o da última importação, cadastro ou recebimento" não exigiu trabalho
próprio: os três caminhos escrevem em `variacoes.custo` (`ingest-lote` direto, `registrar_entrada`
para cadastro e recebimento), então congelar esse valor no instante da venda já satisfaz a regra.

## Consequências

- O markup de uma venda passada para de mudar sozinho. Planilha nova só afeta vendas posteriores.
- **Não há como descongelar pela interface** (decisão explícita). Custo gravado errado se corrige
  no banco, e o trigger obriga um `disable trigger` explícito para isso — a correção é possível,
  mas nunca acidental.
- O backfill é **aproximação**: usa a data do lote, então não capta uma mudança de custo por
  recebimento ocorrida entre o lote e a venda. A coluna `fonte` distingue o reconstruído do
  capturado ao vivo.
- Itens sem casamento com variação continuam sem custo, caindo na resolução dinâmica de hoje.
- Comissão, frete e imposto **continuam dinâmicos**: o markup histórico ainda pode oscilar se a
  alíquota de imposto mudar. Congelar esses componentes não está no escopo.
- Entre o `db push` e o deploy das functions existe uma janela em que vendas sincronizadas não
  congelam; elas se curam no backfill horário seguinte, com o custo daquele momento. Por isso a
  ordem é obrigatória: migration primeiro, deploy depois.
