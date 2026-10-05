# Painel de Ads com margem real (I2)

**Data:** 2026-10-04 · **ADR:** [0179](../../decisions/0179-painel-de-ads.md) · base: [0172](../../decisions/0172-vendas-sku-analise-por-variacao.md) (Fatia 2c: coleta de Ads e dossiê), [0109](../../decisions/0109-custo-congelado-por-venda.md) (custo congelado), [0048](../../decisions/0048-split-produto-n-anuncios-ml.md)/[0078](../../decisions/0078-preco-por-variacao-split-por-faixa-e-controle-de-preco-no-update.md) (família em N anúncios), spike [053](../../spikes/053-product-ads-ml.md)
**Origem:** grilling com o Diego em 2026-10-04, após parecer de produto do GPT-6 Astra (tese premium: quanto da margem o Ads consome, onde revisar o investimento e quão confiável é cada número).

## Problema

A Avil investe em Product Ads e decide pelo ACOS/ROAS do ML, que não conhecem o custo do produto. O PubliAI já coleta o gasto diário por grupo (Fatia 2c) e já sabe a margem real por venda, mas só mostra Ads dentro do dossiê de um SKU — e lá o "Lucro após Ads" está indisponível nas 3 orgs (gasto compartilhado entre cores e gasto fora dos grupos).

## Evidência (produção, 2026-10-04, só leitura)

| Org | Gasto 90 d | Vendas atribuídas 90 d | Gasto 30 d | ROAS 30 d |
|---|---|---|---|---|
| Avil | R$ 10.702 | R$ 110.426 | R$ 3.741 | ~11,9 |
| DSA | R$ 269 | R$ 3.014 | R$ 0 | — |
| Daludi Shop | R$ 108 | R$ 158 | R$ 108 | ~1,5 |
| Hairflay / Hairfly | sem conta de anunciante | | | |

- Atribuível por **SKU**: ~20 % do gasto da Avil; por **família**: ~95 % (spike 053: ITEM multi-cor 49 %, FAMILY multi-código 26,5 %).
- Janela fechada (dias 15–44 atrás), Avil: 15 grupos com gasto; **6 grupos = 99 %** (R$ 4.373), todos com venda; gasto sem venda R$ 30.
- Gasto fora dos grupos listados (90 d): Avil ~3,1 %, DSA ~7,4 %, Daludi Shop ~14 %.

## Decisões (Diego, 2026-10-04)

| # | Decisão |
|---|---|
| D1 | **Unidade = conta + família.** Família normalmente é um anúncio (Legacy: grupo ITEM com as cores; UP: grupo FAMILY pelo `family_id`); família dividida em N anúncios soma os grupos de todos eles, **cada grupo uma vez**. Grupo com códigos de mais de uma família = gasto compartilhado, sem rateio. SKU só com gasto exclusivo (abre o dossiê existente). |
| D2 | **Gasto de Ads não identificado** (grupo excluído ou sem nenhum MLB conhecido) entra **inteiro** no total da conta, numa linha própria; nunca é rateado. Linhas de família mostram o resultado com aviso do % da conta. A mesma regra passa a valer para o **Lucro após Ads** do dossiê SKU: `fora_dos_grupos` deixa de bloquear e vira aviso (fecha a pendência do ADR-0172). Gasto compartilhado e cobertura incompleta continuam bloqueando. |
| D3 | **Período padrão: 30 dias até ontem (BRT)**, presets 7/30/90 como nas telas vizinhas. Dias em atribuição aberta (< 15 dias) hachurados e totais com selo "provisório"; comparação de tendência só entre janelas fechadas e de mesma duração. |
| D4 | **ACOS de equilíbrio** por família = margem % antes de Ads das vendas da família no período; semáforo contra o ACOS real. Rótulo "referência pela margem observada" (o mix vindo do Ads pode diferir). Margem ≤ 0 → "sem espaço para Ads". Sem meta configurável no MVP. |
| D5 | **Menu próprio "Ads" (`/ads`)**, entre Vitrine e Faturamento, como **módulo por org** (padrão Promoções: nasce desligado). Ligado na Avil no lançamento; demais orgs a critério do Diego. Org sem anunciante mostra o estado já existente. |
| D6 | **Sem fila de revisão no MVP.** O ranking de famílias ordenado por gasto, com semáforo (D4) e **ROAS direto ao lado do total**, faz esse papel. Volta ao roadmap quando houver > ~20 grupos com gasto relevante. |
| D7 | **Aceite = piloto de 2 semanas na Avil:** total da conta bate com o painel do Mercado Ads no mesmo período (diferença ≤ 1 %), nenhum gasto contado duas vezes, toda célula indisponível com motivo, e o painel levou a ≥ 1 decisão concreta sobre uma família. Sem meta de lucro causal. |

## Escopo do MVP

**Fatia 0 — spike ✅ concluído em 2026-10-04 ([spike 054](../../spikes/054-total-de-ads-por-periodo.md)).** Resumo dos grupos, resumo das campanhas e Σ da série diária do anunciante batem ao centavo em 7/30/90 dias nas 3 orgs; a série diária é densa. Desenho resultante: **gravar o total diário da conta** (`campaigns/search?aggregation_type=DAILY&filters[status]=active,paused,deleted,error`, relido nos mesmos 15 dias) e calcular **não identificado(período) = Σ conta − Σ grupos**. O gasto não identificado é antigo (Avil: 0 % em 7 d, 0,03 % em 30 d, 2,6 % em 90 d), então o % do aviso (D2) passa a ser **do período exibido**, não fixo em 90 dias como a Ruling 2c-8.

**Fatia 1 — resultado da conta.** Cartão de topo: lucro antes de Ads (vendas do período, margem real) → despesa de Ads (identificada + não identificada) → resultado após Ads; % da margem consumida; ROAS/ACOS total e direto; selo provisório (D3). Inclui a mudança do dossiê SKU (D2).

**Fatia 2 — ranking de famílias.** Por família, ordenado por gasto: gasto, vendas atribuídas (direta / total), ROAS direto e total, ACOS real × ACOS de equilíbrio (semáforo), lucro antes de Ads, resultado após Ads, % da margem consumida, motivo quando indisponível. Linha final "Gasto não identificado".

**Fora do MVP:** fila de revisão (D6), margem mínima configurável (D4), visão por campanha (o `campaign_id` guardado é só o atual — exige spike de histórico), diagnóstico de leilão/orçamento (impression share), orgânico × pago, canibalização, Display/Brand, insights narrados por IA, qualquer escrita no ML.

## Regras de número (invioláveis)

- Somas por Σ/Σ (ROAS = Σvendas/Σgasto), nunca média de razões; denominador zero → indisponível.
- Cada grupo entra uma vez em cada agregado; nenhuma venda conta em duas famílias.
- "Resultado após Ads" é resultado após publicidade, **não lucro causado pelo Ads**; o rótulo e o tooltip dizem isso.
- Despesa é a **informada pela API de Ads** (sem fatura PADS: 403); o rótulo não diz "fatura".
- Lucro herda as marcas existentes (custo parcial/estimado, ADR-0109).

## Riscos

- Vínculo MLB → código é o atual, sem vigência histórica (como na 2c): família que trocou de anúncio no período pode perder gasto antigo → cai em "não identificado", nunca em outra família.
- Venda indireta não revela a margem do produto comprado: ROAS direto fica ao lado, nunca substitui o total.
- Atribuição muda por 14 dias: tendência só entre janelas fechadas (D3).
