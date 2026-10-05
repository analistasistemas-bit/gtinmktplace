# ADR-0179 — Painel de Ads com margem real (I2)

**Status:** Proposto (2026-10-04) — Fatia 0 (spike 054) concluída; aguardando o plano
**Data:** 2026-10-04
**Relacionado:** [ADR-0172](0172-vendas-sku-analise-por-variacao.md) (Fatia 2c: coleta de Ads e dossiê SKU),
[ADR-0109](0109-custo-congelado-por-venda.md) (custo congelado por venda),
[ADR-0048](0048-split-produto-n-anuncios-ml.md) e [ADR-0078](0078-preco-por-variacao-split-por-faixa-e-controle-de-preco-no-update.md) (família em N anúncios),
[ADR-0170](0170-central-de-promocoes-ml.md) (padrão de módulo por org)
**Design:** `docs/superpowers/specs/2026-10-04-painel-de-ads-design.md`
**Decisores:** Diego (grilling 2026-10-04), com parecer de produto do GPT-6 Astra.

## Contexto

A Avil gasta ~R$ 3,7 mil/mês em Product Ads (ROAS ~11,9 em 30 dias) e decide pelo ACOS/ROAS do ML, sem custo do
produto. A Fatia 2c já coleta o gasto diário por grupo de anúncios, mas só mostra Ads no dossiê de um SKU, onde o
gasto atribuível é ~20 % (o ML soma o gasto por grupo, e a maioria dos grupos cobre várias cores) e o Lucro após Ads
está indisponível nas 3 orgs pela regra de gasto fora dos grupos.

## Decisão

1. **Unidade = conta + família.** Na Avil a família cobre ~95 % do gasto. Família em N anúncios soma os grupos de
   todos eles, cada grupo uma vez; grupo com códigos de mais de uma família é gasto compartilhado. Nunca há rateio
   de gasto entre cores, famílias ou SKUs.
2. **Gasto de Ads não identificado** entra inteiro no total da conta numa linha própria; nas famílias vira aviso
   com o % da conta. **Emenda ao ADR-0172:** no dossiê SKU, `fora_dos_grupos` deixa de bloquear o Lucro após Ads
   e passa a aviso; gasto compartilhado e cobertura incompleta continuam bloqueando.
3. **ACOS de equilíbrio** (margem % antes de Ads da família) como referência, com semáforo contra o ACOS real;
   sem meta configurável no MVP.
4. **Tela própria `/ads`**, módulo por org, nasce desligado; ligado na Avil no lançamento.
5. **Só leitura no ML.** Total da conta por período vem de uma **série diária do anunciante** gravada por org
   (`campaigns/search?aggregation_type=DAILY`, todos os status), relida nos 15 dias da atribuição em aberto;
   **não identificado(período) = Σ conta − Σ grupos** e o % do aviso é o do período exibido, não fixo em 90 dias
   (substitui a Ruling 2c-8 para este fim). Medido no [spike 054](../spikes/054-total-de-ads-por-periodo.md):
   4 fontes do ML batem ao centavo; Avil 0,03 % não identificado em 30 dias.

## Alternativas descartadas

- **Unidade SKU** (estender o dossiê): ~80 % do gasto ficaria indisponível.
- **Unidade campanha** (como ML/MT): o `campaign_id` guardado é só o atual; histórico por campanha exige spike.
- **Regra rígida para gasto não identificado:** painel nasceria vazio nas 3 orgs.
- **Ratear o gasto não identificado:** número inventado.
- **Fila de revisão no MVP:** na Avil, 6 grupos concentram 99 % do gasto e todos vendem; a fila ficaria vazia.

## Consequências

- O Lucro após Ads do dossiê passa a aparecer quando o gasto é exclusivo, com aviso do % não identificado.
- "Resultado após Ads" não é lucro causado pelo Ads; a interface diz isso. Despesa é a informada pela API, não a
  fatura PADS.
- Aceite por piloto de 2 semanas na Avil: total bate com o Mercado Ads (≤ 1 %), sem dupla contagem, toda
  indisponibilidade com motivo, ≥ 1 decisão concreta tomada pelo painel.
