# Plano — Central premium + Relatório mensal do cliente (ADR-0193)

Spec: [ADR-0193](../../decisions/0193-relatorio-mensal-do-cliente-e-fechamento-automatico.md) · glossário `CONTEXT.md` · análise [Codex](../specs/2026-11-02-central-premium-analise-codex.md).

Regras de execução (Diego, 2026-11-02): seguir sempre o recomendado; consultor = Codex `gpt-6.1-sol` high (fallback Grok 4.7 xhigh); cada fatia termina testada, validada (inclusive visualmente quando houver UI), revisada pelo Codex, CI verde, merge fast-forward na main e deploy de edge/migration. Roteamento: dinheiro/migration/RLS = Opus; UI = Sonnet com revisão.

Ordem: **1** contrato de dados → **2** PDF + recebimento/Pix → **3** fechamento automático + aviso → **4** Resultados premium → **5** demais abas + carteira.

---

## Fatia 1 — Contrato de dados `monthly_report`

Objetivo: uma ação da edge `platform-admin` que devolve tudo que o PDF e a aba Resultados mostram, para (org, mês). Fonte única; a UI nunca recalcula dinheiro.

### Contrato (TypeScript, `_shared/platform-admin/types.ts`, espelhado em `src/lib/platform-admin-types` ou equivalente já usado pelo front)

```ts
type MonthlyReport = {
  org: { id; nome; slug; modality };
  month: Month;               // competência
  previous_month: Month;
  generated_at: string;
  statement: { status: 'closed'; id; closed_at; snapshot: BillingStatementSnapshot } | { status: 'open' };
  summary: { current: PeriodKpis; previous: PeriodKpis | null };   // previous null = sem venda no mês anterior
  daily: Array<{ day: string; gross_cents; orders; profit_after_ads_cents: Cents | null; prev_gross_cents: Cents | null }>; // dia i do mês vs dia i do anterior
  series: Array<{ month; gross_cents; profit_cents: Cents | null; ads_cost_cents: Cents | null; profit_after_ads_cents: Cents | null; margin_after_ads: number | null; partial: boolean }>; // até 12, ascendente, terminando na competência; começa no 1º mês com venda
  top_families: { rows: FamilyRow[]; top_share: number; universe_gross_cents: Cents; without_code_gross_cents: Cents };
  ads: AdsKpis | null;        // null = org sem dado de Ads no mês
  traffic: { visits: number; listings: number; orders: number; conversion: number | null } | null;
  warnings: MetricsWarning[];
};
type PeriodKpis = {
  gross_cents;               // faturamento da loja (total_amount − cupom_vendedor), faturáveis
  orders; units; ticket_cents; unit_price_cents: Cents | null;
  cancelled_orders; refunds_cents;          // estornos registrados (≠ abatimento da cobrança)
  seller_coupon_cents;                      // ponte da página de cobrança (D-4)
  net_cents; tax_cents; cost_cents: Cents | null; profit_cents: Cents | null;
  covered_gross_cents;                      // faturamento dos itens com custo (cobertura = ÷ gross)
  ads_cost_cents: Cents | null;
  profit_after_ads_cents: Cents | null; margin_after_ads: number | null; markup_after_ads: number | null;
  profit_partial: boolean;                  // cobertura < 100 %
};
type FamilyRow = { key; name; units; gross_cents; share; profit_cents: Cents | null; margin: number | null; markup: number | null; partial: boolean };
type AdsKpis = { cost_cents; revenue_cents; direct_revenue_cents; roas: number | null; acos: number | null; tacos: number | null;
  prints; clicks; ctr: number | null; cpc_cents: Cents | null; attribution_open_until: string | null };
```

Fórmulas (ADR-0193 D-2..D-8, revisadas pelo Codex):
- **Lucro** = Σ itens calculáveis de `resultadoPorItem` (`_shared/notificacoes/gerencial/resultado.ts`; atenção: `ResultadoItem.liquido` ainda não desconta imposto — usar o mesmo caminho de `lucroDoPeriodo`, sem reimplementar). `lucroDoPeriodo` devolver 0 sem itens calculáveis → tratar como `null`.
- **Cobertura do lucro** = gross dos itens calculáveis ÷ gross; `exclusions: {sem_custo, aliquota_nao_confirmada, frete_nao_lido}` em centavos de faturamento. `excluded_items` = nº de itens faturáveis sem lucro calculável (inclui item de faturamento zero, ex.: cupom integral). `profit_partial = cobertura < 1 || excluded_items > 0`; "cobertura total" (D-3a) exige `excluded_items = 0`, condição também gravada no cache (`excluded_items` como coluna). Fixture obrigatória: venda calculável de R$ 100 + item de faturamento zero sem custo → parcial, após Ads indisponível. Margem s/ venda (parcial) = lucro ÷ `covered_gross_cents`; markup = lucro ÷ custo dos calculáveis.
- **Após Ads** (D-3a): só se cobertura = 1 **e** Ads com cobertura diária completa; lucro após Ads = lucro − Σ `cost`; margem após Ads = ÷ gross; markup após Ads = ÷ custo. Senão `null` + `unavailable_reason`.
- **Devoluções** (D-3b, ADR-0106): `refunds_cents` pela data do estorno, critérios de `_shared/notificacoes/gerencial/devolucoes.ts`; o efeito no resultado segue o que o dashboard do cliente já faz (paridade obrigatória com `src/lib/faturamento.ts`/`devolucoes.ts` — o implementador documenta a regra encontrada antes de codar).
- **Tráfego** (D-5, ADR-0176): pares MLB×dia `estado='ok'`; pedidos = orders distintas desses pares (kits por `kit_item_id`); `listings` inclui MLB com 0 visitas; `days_covered`.
- **Ads** (D-6): cobertura via `ml_ads_sync.conta_cobertura_desde` + dias presentes; `attribution: 'final' | 'open'` por `atribuicaoFinal(dia, coletado_em)`; `attribution_expected_final_on` = último dia aberto + 15.
- **ABC** (D-7): família por código via padrão `lerCatalogoEstoque` (`_shared/notificacoes/gerencial/resumo-io.ts`) — lotes paginados, `familias!inner`, `org_id` nas duas tabelas, mais recente por `criado_em desc, id desc`, com `codigo_pai`; classe A/B/C (80/95 %, acumulado anterior, como `curvaAbc`) sobre o universo com família; `without_code_gross_cents` e `unknown_family_gross_cents` separados.

Acréscimos ao contrato: `PeriodKpis.profit_coverage`, `exclusions`, `unavailable_reason`; `AdsKpis.coverage: 'complete'|'partial'|'none'`, `attribution`, `attribution_expected_final_on`; `traffic.days_covered`; `FamilyRow.class`; `top_families.unknown_family_gross_cents`; `series[i].unavailable_reason`.

### Tarefas (TDD)

1. **Migration** `platform_org_month_metrics`: `cache_version smallint not null default 1` + colunas nuláveis `units`, `net_cents`, `tax_cents`, `cost_cents`, `profit_cents`, `covered_gross_cents`, `excluded_items`, `refunds_cents`. Versão nova = 2; linha v1 = miss (recalcular), nunca zero. `supabase migration new` + `db:check` + teste SQL desfeito.
2. **`computeMonth`/`materializeMonth`/`readOrgMetrics`/`loadMetricsCache`/`materializeRecentMonths`/job `materializar-metricas`**: janela parametrizada (`months`, terminando na competência; padrão atual 6 preservado nos chamadores existentes), gravam v2 com os componentes (mesmo `resultadoPorItem`). Misses calculados com limite de trabalho; volume acima do teto → ponto `unavailable_reason='volume'`. Teste de paridade ao vivo × cache e de linha v1 tratada como miss.
3. **Módulo puro** `_shared/platform-admin/monthly-report.ts`: `kpisDoPeriodo`, `serieMensal`, `diario`, `topFamilias`, `kpisAds`, `trafego` — entradas já lidas, sem IO. Testes unitários com fixtures: cupom, pack parcialmente custeado, reembolso parcial, mês sem venda, org sem Ads, atribuição aberta, família sem código, empate.
4. **Paridade**: teste que roda `topFamilias` e `kpisDoPeriodo` contra `src/lib/vendas-sku.ts` (agregação por família) e `resultadoPorItem` nas mesmas vendas.
5. **IO** `monthly-report-io.ts`: lê vendas M e M−1 (`lerVendasJanela`, respeitando `LIMITE_VENDAS_POR_EXECUCAO`), contexto de custo (`carregarContexto`), família por código, `ml_ads_conta_dia`, `ml_item_visitas_dia` (+ pedidos por MLB), série via cache (`readOrgMetrics`/`materializeRecentMonths` com 12 meses), statement fechado do mês.
6. **Handler/repository**: ação `monthly_report` {org_id, month}; super-admin; 404 org; 400 mês inválido. Testes de handler **e segurança**: usuário comum → 403, super-admin inativo → 403, duas orgs com dados → nenhum dado da outra (toda leitura filtra `org_id` explicitamente, pois `service_role` ignora RLS).
7. **Front**: tipo + `useMonthlyReport(orgId, month)` em `src/hooks/usePlatformAdmin*.ts` (sem UI nova nesta fatia).
8. **Validação real** (script read-only): Avil 2026-10 — gross bate com Resultados (R$ 111.886,28), Ads cost bate com /ads (R$ 3.411,27), top família bate com Vendas SKU agrupado, lucro bate com a soma de Vendas SKU no período.
9. Deploy: migration → `platform-admin` + `materializar-metricas` → backfill do cache (job) → conferir versões.

Fora: UI, PDF.

---

## Fatia 2 — PDF mensal + dados de recebimento

1. Migration: `platform_payment_profile` (linha única; favorecido, documento, banco, agência, conta, chave Pix, cidade) com RLS habilitada e privilégios revogados de `PUBLIC`/`anon`/`authenticated` (inclusive `TRUNCATE`); `platform_commercial_terms.due_day smallint not null default 5 check 1..28` integrado a `validateTerms`, tipos, `platform_save_terms` e ao snapshot do fechamento (+ total de cupons do vendedor no snapshot, D-4). Ações `payment_profile`/`save_payment_profile` (super-admin, auditadas) + campo vencimento no formulário de condições. Nenhum dado real, seed, PDF ou screenshot de QA vai para o repo (público).
2. BR Code Pix estático (EMV, CRC16) em `src/lib/pix.ts` com testes de vetor conhecido; QR via lib já instalada ou nova leve (checar `package.json`; preferir gerar QR em canvas/SVG sem dependência pesada).
3. Renderer `src/lib/export/pdf-relatorio-mensal.ts` (jsPDF, A4 retrato, 3 páginas: resumo+cascata+evolução · desempenho+top5+Ads · cobrança+Pix), cores de marca do DS; legendas determinísticas. Testes de estrutura (páginas, ≤5 produtos, gráfico omitido com 1 mês, selo de atribuição, total ≤ 0).
4. Botão "Gerar relatório mensal" na aba Cobrança (habilitado só com statement fechado).
5. Validação visual: gerar PDF da Avil (out/2026 após fechar) e de uma org com 1 mês; converter páginas em PNG e revisar; ajustes. Skill frontend-design/ui-ux-pro-max para o layout.

## Fatia 3 — Fechamento automático + aviso

1. Edge `fechar-mes-plataforma` (QStash schedule `0 9 1 * *` UTC = 06h BRT, `verify_jwt=false`, assinatura QStash) com fan-out por org (ADR-0173): para cada org com condições vigentes, `preview` → sem blockers → `close` (idempotente). Resultado por org em `platform_audit_events` (fechada / já fechada / pendência / mês anterior aberto / conflito / erro); conflito de revisão → 1 retry. Ator de sistema auditado.
2. Categoria `fechamento_mensal` de plataforma: bot/config **da plataforma** (nunca o de org cliente), destinatários revalidados `is_super_admin and is_active` no envio, chave de deduplicação por competência; mensagem com resultado por org e link.
3. Testes de handler + teste SQL desfeito; dry-run manual de outubro.

## Fatia 4 — Resultados premium

Reescrever `org-results.tsx` sobre `useMonthlyReport`: cabeçalho com mês por extenso ‹ › (`Select`), KPIs estilo ML (8 + "mostrar mais") com variação vs mês anterior, diário atual × anterior (recharts, tooltip, "ver dados"), evolução 12 meses, cascata, top 5, Ads, estados (vazio/erro/parcial). Validação visual desktop/mobile, claro/escuro (Playwright, screenshot real).

## Fatia 5 — Demais abas + carteira

Diagnóstico Codex por aba → redesenho visual (mesmo conteúdo) de Pulse, Extensão, Cobrança (+ ponte do cupom, estado do fechamento), Auditoria, Configurações; carteira: variação agregada no universo total (bug `Organizacoes.tsx:107/205/522`), mês por extenso, coluna de estado do fechamento. Validação visual.
