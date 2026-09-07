# ADR-0158: Carteira agregada, pendências de cobrança e alíquota explícita na central

**Status:** Aceito, 2026-09-07. Complementa o [ADR-0155](0155-central-organizacoes-cobranca-auditavel.md); implementação no [plano](../superpowers/plans/2026-09-07-central-cockpit.md).

## Contexto

A auditoria de 2026-09-07 da central `/admin` (2 organizações em produção) provou:

- `platform_resolve_terms` é função SQL escalar que devolve **uma linha toda NULL** quando a organização
  não tem condição comercial; `platform_billing_preview` testa `FOUND`, que é verdadeiro, e o blocker
  `commercial_terms_required` nunca entra. A prévia sai com `blockers: []` e `total_cents: null`.
- "Pendências" na carteira conta `platform_sonar_searches.state = 'pending'` (buscas em voo), não os
  bloqueios do demonstrativo que o ADR-0155 define como pendência. Agosto/2026 tinha 9 devoluções sem
  conciliação e a tela mostrava 0.
- Cada render da carteira dispara duas ações (`overview` e `list`) que enriquecem todas as organizações
  em dobro: 46 round-trips ao PostgREST e ~11 MB de JSON, dos quais 4 MB são `ml_vendas.raw`, que
  ninguém lê. `variacoes` da Avil (8 537 linhas) é lida inteira em 9 páginas sequenciais só para
  resolver custo/peso/origem dos itens vendidos.
- Sem linha em `configuracoes`, o markup da central presume 8 %/16 % em silêncio, o que o how-to e a
  regra do projeto (ADR-0055, ADR-0086) proíbem.

## Decisão

1. **Contrato de `platform_resolve_terms`**: a ausência de condição é detectada por `v_terms.id is null`,
   nunca por `FOUND`. `platform_billing_close` recusa fechar sem condição com erro de negócio
   (`commercial terms required`, errcode `23514`), antes de qualquer `INSERT`. Bug, não mudança de
   regra — o ADR-0155 já previa o blocker.
2. **Pendência da carteira = bloqueio da prévia.** `pending_count` de uma organização é
   `blockers.length` de `platform_billing_preview` no mês selecionado (condição ausente, devolução sem
   conciliação, fonte alterada/ausente). O total da carteira é a soma. Buscas Sonar em voo não são
   pendência.
3. **Uma ação `wallet`** substitui `overview` + `list`: enriquece cada organização **uma vez** e devolve
   `{ totals, rows, total, page, page_size }`. `totals.forecast_cents` soma apenas organizações com
   condição vigente e informa `orgs_without_terms`; `billable_units` vem de `preview.sonar_units`
   independentemente de blockers (consumo é contável sem contrato). `gross_cents` total continua
   exigindo métricas de todas as organizações (indisponível parcial não vira número).
4. **Leitura enxuta de vendas**: a central lê `ml_vendas` com a mesma lista de colunas de
   `buscarVendas` (`src/lib/faturamento.ts`), nunca `select *`. `raw` não sai do banco.
5. **Catálogo de custo por RPC**: `platform_org_cost_catalog(p_org uuid, p_since timestamptz)`
   (`SECURITY DEFINER`, `search_path=''`, execute só `service_role`) devolve as linhas de `variacoes`
   (+ `familias.ml_item_id`, `familias.origem`) cujas chaves — `ml_variation_id`, `familias.ml_item_id`,
   `gtin`, `codigo` — casam com itens de `ml_vendas_itens` da organização fechados desde `p_since`. A
   cadeia de resolução (variação → anúncio → GTIN → código) e `montarMapasCusto` não mudam; muda só o
   conjunto lido.
6. **Alíquota nunca presumida na central**: sem linha em `configuracoes` para a organização, ou sem
   `aliquotas_confirmadas_em`, o markup é `null` com aviso `Configuração tributária não confirmada`.
   O agregador compartilhado (`calcularResumo`) não muda; a decisão vive em `metrics-repository.ts`.
   O comportamento do app do cliente (Dashboard/Faturamento) fica como está.

## Alternativas rejeitadas

- **Mover o markup para SQL (1 RPC agregada)**: quebraria o agregador único do ADR-0038 e exigiria
  reimplementar pack, rateio de frete, custo congelado e alíquota interna em PL/pgSQL. Custo-benefício
  ruim com o ganho já obtido por (3)–(5).
- **Cache de métricas no edge**: não resolve o primeiro carregamento e adiciona invalidação. Reavaliar
  se, após (3)–(5), a carteira passar de 3 s com 10 organizações.
- **Manter `pending` do Sonar como pendência**: contradiz o ADR-0155 e nunca representa dinheiro parado.

## Consequências

- Orçamento por render da carteira: 1 chamada edge, ≤ 15 round-trips e < 1,5 MB para as 2
  organizações atuais (era 2 chamadas, 46 round-trips, ~11 MB).
- Após (1), organizações sem contrato passam a exibir bloqueio e pendência = 1 até o cadastro; a
  prévia deixa de mostrar "Remuneração (0%)" e total nulo.
- `overview` e `list` são removidas do handler; o frontend usa apenas `wallet`.
- Nova migration com `platform_org_cost_catalog` e a correção de `platform_billing_preview`/`close`;
  teste SQL passa a cobrir mês sem contrato.
