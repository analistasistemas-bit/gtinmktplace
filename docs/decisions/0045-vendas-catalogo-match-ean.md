# ADR-0045 — Atribuição de venda por EAN (catálogo do ML)

> Renumerado de ADR-0037 → ADR-0045 em 2026-06-27 (resolução de colisão de numeração; ver `README.md`).

**Data:** 2026-06-22
**Status:** aceito
**Contexto:** detalhe de vendas / multicanal (ADR-0032, ADR-0021, ADR-0036)

## Contexto

O detalhe de vendas classifica cada venda como "do PubliAI" ou "Fora do PubliAI" comparando o
`item.id` (MLB) do pedido com `familias.ml_item_id`. Match exclusivamente por MLB.

Vendas via **catálogo do Mercado Livre** entram com o MLB do anúncio âncora do catálogo, não
com o MLB do anúncio do usuário. Logo, produtos do próprio usuário (publicados pelo PubliAI)
que vendem por catálogo aparecem como "Fora do PubliAI", inflando o balde externo e escondendo
faturamento real do produto.

## Decisão

Adicionar o **GTIN/EAN como segundo critério de atribuição**. Para os itens que não casam por
MLB, busca-se o GTIN do item na API do ML (`/items?attributes=...,attributes`) e cruza-se com o
GTIN das `variacoes` do usuário. Casando, a venda é **somada na linha do anúncio PubliAI dono
daquele GTIN** e deixa de ser "externa".

A reclassificação é **server-side**, na função pura `reclassificarPorGtin` em
`_shared/ml/vendas.ts`. O frontend não muda.

Justificativa: catálogo do ML é, por construção, o **mesmo produto** (mesmo GTIN). Cruzar por
GTIN é semanticamente correto e não gera falso positivo entre produtos diferentes.

## Consequências

- KPIs do topo (`totais`, ADR-0032) **não mudam** — só a divisão app vs. externo se ajusta.
- Itens genuinamente externos (publicados direto fora do app, sem ficha PubliAI) continuam em
  "Fora do PubliAI", pois não há GTIN correspondente no cadastro.
- Itens de catálogo sem atributo GTIN na resposta da API ficam externos (degradação segura).
- `lerMetricasVendas` ganha parâmetro opcional `mapaGtin` (retrocompatível).
- **Ambiguidade verificada em produção (2026-06-22):** 814 GTINs distintos, e **nenhum**
  mapeia para mais de um `ml_item_id` — cada GTIN aponta para exatamente um anúncio. As
  repetições de GTIN no cadastro são linhas de `familias` duplicadas (re-importação) que
  apontam para o mesmo MLB, então o mapa resolve sempre para o mesmo anúncio. Não há
  atribuição cruzada entre produtos diferentes. Códigos placeholder `3000…` (não-EAN) não
  aparecem em itens de catálogo do ML e, portanto, jamais geram falso match.

## Extensão client-side (2026-08-06)

A reclassificação acima roda no `metricas-vendas` e resolve o balde "app vs. externo". Ela **não**
alcança os agregadores que o frontend monta direto de `ml_vendas` — `topProdutos` (ranking do
Dashboard), `calcularResumo.porItem` (vendas por anúncio em Publicados) e `montarDetalheVendas`
(Faturamento › Detalhe). Esses agrupam por `ml_item_id` cru, então a venda que entra pelo anúncio
de catálogo (MLB próprio, criado pela vinculação do ADR-0021) vira uma **segunda linha, com o
título padronizado do ML** — "outro produto" no ranking — e some da linha do anúncio original em
Publicados, que lista só o MLB próprio.

`src/lib/anuncio-canonico.ts` fecha isso com o mesmo semântico, mas por **vínculo explícito** em
vez de GTIN: `variacoes.catalog_listing_id` → `familias.ml_item_id` (modelo legado) e
`anuncios_externos_itens.catalog_listing_id` → `item_externo_id` (User Products, ADR-0088). Os três
agregadores canonizam a chave antes de somar; o título exibido é sempre o do anúncio dono. Sem
mapa (carga inicial ou erro na leitura) o comportamento é o anterior — degradação segura.

Por que o vínculo e não o GTIN aqui: código/GTIN também são compartilhados por anúncios
legitimamente distintos — split por faixa de preço (ADR-0078/0048) e kit x unidade (ADR-0071) —
e fundi-los seria errado. O `catalog_listing_id` só existe para o anúncio de catálogo.

## Adendo 2026-08-17 — o mesmo GTIN resolve o **anúncio irmão legado**

A extensão de 2026-08-06 cobriu só o anúncio de catálogo, porque o vínculo (`catalog_listing_id`)
existia. Falta o caso sem vínculo nenhum: produto que **já vendia no ML como N anúncios — um MLB por
cor/estampa** — e entrou no app com apenas um desses MLBs em `familias.ml_item_id`. As vendas dos
irmãos não casam com nenhuma linha da tela e ficam órfãs: nem somam no produto, nem aparecem em
lugar algum.

Medido em produção (org AVIL, 90 dias, 2026-08-17): **18 MLBs órfãos, 89 unidades, R$ 5.450**. O caso
que Diego reportou — "TECIDO HELANCA LIGHT 10METROS" (`codigo_pai` 26705343, `MLB4959919693`) — são
9 anúncios, um por cor: a tela mostrava **7 un / R$ 538,30** (só a cor Amarelo Canário, o único MLB
vinculado) contra **49 un / R$ 3.757,28** reais.

**O critério continua sendo o GTIN — não é heurística nova.** O ingest já resolve esses itens por
GTIN (`_shared/faturamento/venda.ts`, cascata do fallback): os itens órfãos chegam a
`ml_vendas_itens` com `is_publiai = true` justamente porque o backend os reconheceu pelo EAN. O que
faltava era o **frontend** aplicar o mesmo critério ao escolher a chave de agregação. Este adendo só
propaga client-side a decisão que já vale server-side.

Implementação em `src/lib/anuncio-canonico.ts`: `MapaCanonico` deixa de ser um `Record` de listings e
passa a ter `listings` (vínculo de catálogo), `gtins` (GTIN → anúncio dono) e `conhecidos` (MLBs que
o app lista). `canonizarItem(mlItemId, mapa, ean?)` resolve nesta ordem:

1. vínculo explícito de catálogo (precedência — é o mais forte);
2. MLB que o app já lista → dono de si mesmo (**GTIN nunca reatribui venda entre anúncios válidos**);
3. GTIN da linha da venda → anúncio dono;
4. o próprio MLB (degradação segura, comportamento anterior).

**Guard contra o falso positivo que este ADR temia:** GTIN que aponta para mais de um anúncio é
descartado por inteiro do mapa. Kit x unidade (ADR-0071) e split por faixa de preço (ADR-0078/0048)
têm exatamente essa assinatura, então se auto-excluem — não atribuir é melhor que atribuir errado.
Ambiguidade medida no cadastro atual: **11 de 3.170 GTINs (0,35%)**.

O `ean` é **opt-in** no resolver: só quem agrega venda por anúncio o informa (`resumo-vendas.ts` →
Publicados, `cockpit.ts` → Top produtos do Dashboard, `detalhe-vendas.ts`). `fotos-produto.ts` e
`cor-produto.ts` seguem chamando sem `ean` e mantêm o comportamento anterior — a cor de uma venda sem
variação não pode ser inferida por GTIN (ver o comentário em `cor-produto.ts`).

**Resíduo declarado:** 5 dos 18 MLBs órfãos (**R$ 1.999,92** — Oxford Natal `02710170` e o item
`00000033`) têm `variacoes.gtin = null`; o produto não tem EAN, então nenhum critério de GTIN os
alcança. Continuam órfãos por decisão, não por omissão. Resolvê-los exige vincular os MLBs irmãos
como anúncios do produto (mudança de modelo, ADR próprio).

## Alternativas descartadas

- **Match por `seller_custom_field`/`seller_sku`**: nem sempre presente em venda de catálogo;
  GTIN é o identificador estável do produto.
- **Linha separada "via catálogo"**: rejeitado pelo usuário — prefere o total consolidado na
  linha do produto.
