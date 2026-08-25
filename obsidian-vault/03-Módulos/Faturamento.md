---
tags: [modulo, faturamento]
atualizado: 2026-08-24
---

# Faturamento

Módulo em produção para vendas, devoluções, perguntas e mensagens do Mercado Livre.
Ver [[Financeiro]], [[Estoque]], [[Notificações]], [[Índice de ADRs]].

## Operação

- Menu Faturamento com Vendas, Devoluções, Perguntas (com IA) e Mensagens.
- Webhooks ML recebidos por `ml-webhook` para `orders_v2`, `questions`, `claims` e `shipments`.
- Reconciliação por `reconciliar-faturamento` em schedule QStash horário (inclui estornos de
  devoluções de até 30 dias).
- `upsertDevolucao` resolve `order_id` via `shipping_id` em devoluções do tipo `shipment`.
- Perguntas e Mensagens com abas de status e **busca paginada** (2026-08-08); a paginação é
  clampada e o erro tratado nas duas abas.

Fonte: `docs/decisions/0037-modulo-faturamento-webhooks-ml.md`.

## Catálogo do faturamento (quem é "nosso" numa venda)

`carregarCatalogo` (`_shared/faturamento/io.ts`) resolve código, EAN, custo e cor de cada item
vendido. Duas correções recentes definem o comportamento atual:

- **Escopo por `org_id`, não por `user_id`** (2026-08-11). Filtrava pelo `criado_por` da conexão
  do canal — resíduo pré-multi-tenancy —, então produto cadastrado por **outro membro da mesma
  org** ficava fora do catálogo, com `is_publiai = false` e código não resolvido (e portanto **sem
  baixa de estoque**). Fallback para `user_id` só quando não há conexão para resolver a org.
- **O MLB do anúncio de catálogo entra no catálogo** (2026-08-11, ADR-0021). O vínculo de catálogo
  cria um anúncio **separado** (`variacoes.catalog_listing_id`); antes só `familias.ml_item_id` era
  conhecido, e a venda do anúncio de catálogo dependia do fallback de GTIN.
- **Último recurso:** o SKU que o ML manda em `seller_custom_field` resolve o código — **sem**
  promover o item a `is_publiai` (o vendedor pode preencher esse campo em qualquer anúncio dele).
- Venda paga sem SKU resolvido não é mais descartada em silêncio: vira movimento informativo no
  ledger (`venda_sku_nao_encontrado`, `quantidade = 0`) mais notificação.

## Custo e markup

- **Custo congelado no instante da venda** (ADR-0109, 2026-08-07): o custo do item é copiado para
  a tabela satélite `venda_item_custo` no primeiro sync (insert-once) e um trigger faz qualquer
  `UPDATE` de `custo_unitario` **falhar**. Planilha nova só afeta vendas posteriores. A garantia é
  "não muda por `UPDATE`", não imutabilidade absoluta (o `DELETE` segue livre por causa do cascade).
- **Custo vigente** é resolvido pela cadeia `variação → anúncio → GTIN → código`, com desempate
  pela linha **mais recente** (`atualizado_em`, ADR-0108) — antes era pelo maior custo, o que
  escondia toda redução de custo enquanto a linha antiga existisse.
- **Comissão, frete e imposto continuam dinâmicos** — o markup histórico ainda oscila se a
  alíquota mudar.

## Imposto

- Alíquota por origem da família: 8% nacional / 16% importado (ADR-0055), org-scoped e com gate
  LOUD de confirmação (ADR-0086).
- **Alíquota interna por UF da empresa** (ADR-0112, 2026-08-11): pedido entregue na `uf_empresa`
  paga `aliquota_interna_pct`, que **sobrepõe** a origem. Derivado na leitura, sem persistência —
  ligar o parâmetro recalcula todo o histórico exibido. Ver [[Configurações]].
- O percentual do imposto aparece ao lado do valor no detalhe do pedido (só no desktop) e vem do
  **resolver**, não do imposto arredondado.

## Devoluções

- **A devolução conta no período em que o estorno saiu** (ADR-0106, 2026-08-06):
  `ml_devolucoes.fechado_em` (`claim.resolution.date_created`), não a data de abertura do claim.
  Confirmado contra o estorno no Mercado Pago em 5 devoluções reais.
- Devolução **fechada** não conta mais como aberta: o ML continua devolvendo `available_actions`
  em claim já finalizado e reembolsado.
- Critério de "concluída" inalterado: `type = 'returns'` **e** `return_status_money = 'refunded'`.

## Cor, foto e código do item vendido

Correções de 2026-08-11, todas do mesmo padrão (chave disputada por valores diferentes): a cor de
item **plano** é resolvida pelo catálogo em vez de herdada por fallback de EAN/código; a miniatura
mostra a foto da **cor vendida**; e o SKU do filho User Products vence o chute da família em
código/EAN. Ver [[Problemas Resolvidos]].
