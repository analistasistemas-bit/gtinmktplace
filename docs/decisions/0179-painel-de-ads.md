# ADR-0179 — Painel de Ads com margem real (I2)

**Status:** Aceito (2026-10-05) — em piloto (aceite D7 pendente: Task 8, Diego)
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
3. **ACOS de equilíbrio** (margem % antes de Ads da família) como referência, com semáforo contra o ACOS direto (gasto ÷ venda direta);
   sem meta configurável no MVP.
4. **Tela própria `/ads`**, módulo por org, nasce desligado; ligado na Avil no lançamento.
5. **Só leitura no ML.** Total da conta por período vem de uma **série diária do anunciante** gravada por org
   (`campaigns/search?aggregation_type=DAILY`, todos os status), relida nos 15 dias da atribuição em aberto;
   **não identificado(período) = Σ conta − Σ grupos com membro** e o % do aviso é o do período exibido, não fixo em 90 dias
   (substitui a Ruling 2c-8 para este fim). Medido no [spike 054](../spikes/054-total-de-ads-por-periodo.md):
   4 fontes do ML batem ao centavo; Avil 0,03 % não identificado em 30 dias.

## Alternativas descartadas

- **Unidade SKU** (estender o dossiê): ~80 % do gasto ficaria indisponível.
- **Unidade campanha** (como ML/MT): o `campaign_id` guardado é só o atual; histórico por campanha exige spike.
- **Regra rígida para gasto não identificado:** painel nasceria vazio nas 3 orgs.
- **Ratear o gasto não identificado:** número inventado.
- **Fila de revisão no MVP:** na Avil, 6 grupos concentram 99 % do gasto e todos vendem; a fila ficaria vazia.

## Consequências

- **Premissa herdada (vendas):** não há marcador de cobertura das vendas no backend (webhook `sync-venda` +
  `reconciliar-faturamento`); como Faturamento, Vendas SKU e Financeiro, o painel assume histórico completo a partir
  da primeira venda registrada e mostra essa data. Antes dela, lucro indisponível (`historico`).
- **Semáforo:** nasceu desligado; o spike 055 mostrou a mesma base de preço (100 % dos dias comparáveis) e o Diego o
  **ligou em 2026-10-05** (`BASE_ACOS_VALIDADA = true`). Ressalva aceita: o ML conta vendas depois canceladas, então
  o ACOS do Ads sai 1,5–7 % otimista (família no limite pode aparecer "dentro"); kits não foram testados (Avil sem
  kit). Custo parcial, gasto compartilhado, cobertura incompleta e histórico seguem sem semáforo.

- O Lucro após Ads do dossiê passa a aparecer quando o gasto é exclusivo, com aviso do % não identificado.
- "Resultado após Ads" não é lucro causado pelo Ads; a interface diz isso. Despesa é a informada pela API, não a
  fatura PADS.
- Aceite por piloto de 2 semanas na Avil: total bate com o Mercado Ads (≤ 1 %), sem dupla contagem, toda
  indisponibilidade com motivo, ≥ 1 decisão concreta tomada pelo painel.

## Produção (2026-10-04/05)

- **Em produção:** migration `20261005013741_ads_painel` (tabela `ml_ads_conta_dia`, coluna
  `ml_ads_sync.conta_cobertura_desde`, RPCs `gravar_ads_conta_dias`, `ads_painel`, `ads_resumo_periodo`; teste SQL
  em transação desfeita); edge `coletar-ads-ml` v12 (grava a série diária do anunciante; carga de 90 dias nas 3
  orgs, Σ igual ao spike 054 ao centavo); edge `usuarios` v45 (aceita menu/módulo `ads`).
- **Medições:** `EXPLAIN` na Avil (135 grupos, 12.161 linhas em `ml_ads_grupo_dia`): `ads_painel` 164 ms,
  `ads_resumo_periodo` 9 ms (orçamento 300 ms; remedir quando a Avil passar de ~300 grupos). CPU do worker v12: máx.
  123 ms por mensagem (teto 2 s), cada org fecha em 1 mensagem.
- **Front** (`/ads`, módulo `ads`, dossiê D2) entra com o merge da branch `worktree-i2-painel-ads`. O módulo `ads`
  nasce **desligado** em todas as orgs; o backfill de `allowed_menus` com `'ads'` vai numa migration depois do deploy
  do front (plano, Task 7 Step 5).
- **Regras fixadas na validação visual:** o período termina no último dia coletado (recuo máx. de 1 dia; antes, das
  00h às ~11h17 BRT o painel ficava indisponível); o dossiê usa lucro e Ads nos mesmos dias e aplica a trava de
  histórico da org (mínimo da primeira venda do catálogo), em paridade com o painel.
- **Semáforo do ACOS de equilíbrio ligado em 2026-10-05** por decisão do Diego (`BASE_ACOS_VALIDADA = true`), com
  base no spike 055 (`docs/spikes/055-base-acos-equilibrio.md`).
- **Redesenho da tela (2026-10-05, plano `docs/superpowers/plans/2026-10-05-ads-ui-premium.md`):** a interface passa
  a oferecer o preset **Mês atual** (padrão, por decisão do Diego), do primeiro dia do mês BRT até `fimDiasAds`; sem
  dia elegível, mostra "aguardando mês" com acesso aos últimos 30 dias. Despesa e resultado em destaque, ressalvas
  sempre visíveis, filtros por contagem e ranking compacto com detalhe expansível.
- **Emenda ao ADR-0172:** `fora_dos_grupos` deixa de bloquear o Lucro após Ads (vira aviso do % do período).
- **Pendente (Task 8, Diego):** ligar o módulo na Avil, conferir o total com o Mercado Ads (≤ 1 %), 2 semanas de
  piloto e ≥ 1 decisão registrada. Só então o épico fecha; até lá o status é "em piloto".
