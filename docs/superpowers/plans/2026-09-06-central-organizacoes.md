# Central de organizações — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. O roteamento explícito do usuário prevalece: Astra arquitetou este plano; Sol coordena, revisa e integra; Terra e Luna implementam. Não pedir novamente escolha de execução.

**Goal:** Entregar uma central administrativa com resultados e markup por organização, configurações negociáveis, consumo auditável do Pulse e demonstrativos mensais conferíveis.

**Architecture:** Expandir o painel `/admin` existente com backend administrativo autenticado. Compartilhar os cálculos puros de resultados com a operação; usar PostgreSQL para condições versionadas, consumo idempotente e fechamento atômico. Manter aprovação de suporte para entrar na operação.

**Tech Stack:** React 18, TypeScript, TanStack Query, componentes locais/Tailwind, Recharts, Supabase Edge Functions/Deno, PostgreSQL, Vitest/Testing Library e exportadores existentes. Sem nova dependência de produção.

**Spec:** [Desenho aprovado](../specs/2026-09-06-central-organizacoes-design.md), [descoberta](../specs/2026-09-06-central-organizacoes-discovery.md), [ADR-0155](../../decisions/0155-central-organizacoes-cobranca-auditavel.md).

## Global Constraints

- Worktree: `/Users/diego/Desktop/IA/Anuncios MktPlace/.worktrees/admin-control-20260906`; branch `codex/admin-control-20260906`. Usar `workdir` explícito e prefixar shell com `rtk`. Preservar alterações de outros agentes.
- Super-admin ativo consulta a central; acesso operacional continua exigindo suporte aprovado. Validar autorização e organização no servidor. Nenhum dado operacional de outra organização pode entrar na resposta ou no cache selecionado.
- Faturamento bruto antes das taxas, com cancelamentos/devoluções identificados na base de cobrança; markup usa a regra atual e cobertura de custos. Indisponível não é zero. Não presumir custo de fornecedor nem reconstruir uso comercial histórico a partir do cache.
- Preços negociáveis por organização; modalidade 2 admite infraestrutura. Renegociação no próximo mês; demonstrativos fechados não mudam. Uma busca Sonar bem-sucedida por termo/EAN vale uma unidade; complementos, retries, reaberturas, falhas e uso Daludi não duplicam cobrança.
- Implementar e testar localmente. Não aplicar migrations remotas, mutar dados de produção, enviar cobranças, fazer merge/push ou publicar. Scripts de teste devem recusar banco remoto. Não apagar o worktree ao finalizar.

## Decisões executáveis que completam o desenho

**Período:** mês-calendário em `America/Fortaleza`, persistido em condições, entregas e demonstrativos. Mesmo offset BRT dos testes atuais para os períodos de 2026. Intervalos SQL são `[início, próximo início)`. Comparativo do mês em andamento usa o mesmo número de dias/horário do anterior; meses fechados usam meses completos.

**Primeiro contrato:** formulário sugere próximo mês; início é explícito, nunca anterior ao mês atual nem retroativo para eventos Sonar isentos. Infraestrutura é mensal integral; não introduzir pró-rata sem requisito. Implantação tem competência explícita e ocorre uma vez. Sem contrato, resultados continuam visíveis e uso fica registrado com motivo `sem_contrato`; nenhuma taxa padrão é aplicada no backend. M1 com módulo Pulse habilitado por exceção ainda segue preço/isenção explícitos do contrato, não lógica escondida pelo nome da modalidade.

**Sucesso Sonar:** resultado principal válido e não vazio, persistido e disponibilizado de forma recuperável ao usuário autorizado. Commit precede resposta HTTP; resposta perdida é recuperada pelo mesmo request_id sem segunda cobrança. Não afirmar que isso prova visualização no navegador. Resultados parciais de complementos não cobram unidades extras.

**Reabertura:** por `resultado_id`, sem fornecedor nem dependência de Redis. Uma versão pública de resultado pode servir várias organizações, cada qual com sua primeira entrega própria. Daludi não ocupa a primeira entrega do cliente. Histórico legado sem ID fica rotulado como busca antiga e só inicia nova busca mediante ação explícita, nunca se apresenta como reabertura gratuita de uma versão recuperável.

**Apuração de devoluções:** `ml_vendas.estorno` é financeiro e não prova sozinho a parcela de produtos. Venda `refunded` ou `cancelled` tem base elegível zero; `paid` sem estorno conhecido positivo usa bruto; `partially_refunded` ou paid com estorno positivo exige conciliação de valor dos produtos vinculada à revisão da venda. Sem conciliação confiável, prévia aponta pendência e fechamento é recusado. Não bloquear meses sem indício de devolução apenas porque `estorno` é null.

**Fatos tardios:** guardar os IDs das vendas e base reconhecida em cada fechamento. Reavaliar as fontes desses IDs, inclusive se a venda sair do filtro de data. Ajuste usa percentual original e diferença acumulada já reconhecida, sem duplicar créditos. Fechamentos negativos produzem crédito transportado uma vez ao mês seguinte; fechamento cronológico impede saltar competências e perder saldo.

## Roteamento e propriedade

| Tarefa | Executor | Dependência | Escopo exclusivo |
|---|---|---|---|
| T1 Fundação/contratos/segurança | Terra | Nenhuma | Schema comercial, DTOs, auth central, condições |
| T2 Núcleo de resultados e paridade | Terra | T1 | Extração pura, leitura de métricas |
| T3 Sonar durável e metering | Terra | T1 | Sonar UI/API/cache/ledger e migration própria |
| T4 Fechamento e auditoria central | Terra | T1, T2, T3 | RPCs de cobrança, router da central, logs |
| T5 Cliente API e exportação | Luna | T1 | API/hooks e adapter demonstrativo |
| T6 Carteira/resultados/Pulse/auditoria | Terra | T2, T4, T5 | Páginas da central, shell e rotas |
| T7 Condições/cobrança/configurações | Luna | T4, T5 | Componentes de cobrança/configurações |
| T8 Integração, validação e documentação | Terra, revisão Sol | T6, T7 | Correções integradas e evidências |

Sol só despacha tarefas deste plano e limita o total a quatro agentes, contando Astra raiz, Sol e dois executores. T2 e T3 podem rodar em paralelo após T1; T5 pode ocupar uma vaga enquanto outro trabalho independente termina. T6/T7 podem rodar em paralelo com props congeladas abaixo. Sol é responsável por cada revisão de especificação/qualidade e pela revisão final; não duplicar revisores ou pedir ao usuário para continuar entre tarefas. Nenhum executor cria descendentes.

## Arquivos e contratos compartilhados

`supabase/functions/_shared/platform-admin/types.ts` contém DTOs sem runtime nem imports do browser. Os nomes abaixo são o contrato entre as tarefas; alteração exige comunicação do Sol a todos os dependentes.

```ts
export type Month = string; // YYYY-MM, validado no backend
export type Cents = number; // inteiro seguro; PostgreSQL faz a aritmética autoritativa
export type CommercialTermsInput = {
  org_id: string; starts_on: string; modality: 1 | 2;
  monthly_fee_cents: Cents; revenue_bps: number;
  sonar_unit_cents: Cents; setup_fee_cents: Cents;
  setup_due_month: Month | null; reason: string;
};
export type CommercialTerms = CommercialTermsInput & {
  id: string; version: number; timezone: 'America/Fortaleza'; created_at: string; created_by: string;
};
export type RevenueReconciliationInput = {
  org_id: string; sale_id: string; source_updated_at: string;
  refunded_product_cents: Cents; reason: string;
};
export type BillingLine = {
  key: string; label: string; quantity: number | null;
  unit_cents: Cents | null; amount_cents: Cents;
  source_type: string; source_id: string | null;
};
export type BillingPreview = {
  org_id: string; org_name: string; month: Month; timezone: string;
  terms: CommercialTerms | null; gross_cents: Cents;
  refund_cents: Cents; base_cents: Cents; fee_cents: Cents;
  sonar_units: number; sonar_cents: Cents; lines: BillingLine[];
  total_cents: Cents; credit_cents: Cents; revision: string;
  blockers: Array<{ code: string; message: string; sale_id?: string }>;
};
export type BillingStatement = BillingPreview & {
  id: string; closed_at: string; closed_by: string;
};
export type OrgMetrics = {
  org_id: string; month: Month; gross_cents: Cents; orders: number;
  ticket_cents: Cents; markup: number | null;
  cost_covered_orders: number; total_orders: number;
  active_ads: number | null; publications: number | null;
  pending_operations: number | null; updated_at: string | null;
  previous: { gross_cents: Cents; orders: number; markup: number | null } | null;
  series: Array<{ month: Month; gross_cents: Cents; markup: number | null }>;
  warnings: string[];
};
export type OrgSummary = {
  id: string; nome: string; slug: string; is_test: boolean;
  modality: 1 | 2 | null; metrics: OrgMetrics | null;
  forecast_cents: Cents | null; billable_units: number;
  daludi_searches: number; pending_count: number;
};
export type Page<T> = { rows: T[]; total: number; page: number; page_size: number };
export type AuditRow = {
  id: string; org_id: string; actor_id: string | null; actor_name: string | null;
  at: string; category: 'admin' | 'billing' | 'pulse' | 'support';
  action: string; result: string; target: string | null;
  reason: string | null; details: Record<string, unknown>;
};
export type PulseUsageRow = {
  id: string; org_id: string; actor_id: string; actor_name: string | null;
  at: string; query: string; query_type: 'termo' | 'ean';
  origin: 'cliente' | 'daludi'; result: string; exempt_reason: string | null;
  units: number; total_cents: Cents; result_id: string | null;
};
export type PulseUsage = Page<PulseUsageRow> & {
  client_units: number; client_cents: Cents; daludi_searches: number;
  failures: number; reopens: number; measured_cost_cents: Cents | null;
  tracked_since: string | null;
};
```

Endpoint `platform-admin` usa POST com `{ action, ...params }`, resposta JSON do DTO correspondente e erros `{ error, code }`. `requirePlatformAdmin(req)` retorna `{ userId }` após `requireUser` e perfil ativo com `is_super_admin`. Não chamar `requireUserOrg` para a leitura da central. Ações:

```ts
// list: {month, search?, include_test?, page?, page_size?, sort?} -> Page<OrgSummary>
// overview: {month, include_test?} -> {gross_cents, forecast_cents, org_count, pending_count, warnings}
// metrics: {org_id, month} -> OrgMetrics
// terms: {org_id} -> {rows: CommercialTerms[]}
// save_terms: CommercialTermsInput -> CommercialTerms
// preview: {org_id, month} -> BillingPreview
// close: {org_id, month, expected_revision} -> BillingStatement
// statements: {org_id, page?, page_size?} -> Page<BillingStatement>
// statement: {org_id, statement_id} -> BillingStatement
// reconcile_revenue: RevenueReconciliationInput -> {id: string}
// pulse_usage: {org_id, month, page?, page_size?} -> PulseUsage
// audit: {org_id, month, category?, actor_id?, result?, page?, page_size?} -> Page<AuditRow>
```

Paginação default 20, máximo 50; sort por allowlist, UUIDs e meses estritamente validados. `overview` representa toda a carteira filtrada, não apenas a página corrente. Respostas não incluem dados pessoais de compradores, tokens, payloads de fornecedores ou preços de outras organizações. KPI com falha é null/aviso, não zero.

## Task 1 — Fundação comercial, DTOs e autorização (T1 · Terra)

**Arquivos:** criar `supabase/migrations/20260906170000_platform_commercial_foundation.sql`, `_shared/platform-admin/types.ts`, `_shared/platform-admin/auth.ts`, `_shared/platform-admin/validation.ts`, `_shared/platform-admin/__tests__/auth.test.ts`, `_shared/platform-admin/__tests__/validation.test.ts`, `supabase/tests/platform_commercial.sql`. Caminhos `_shared` são relativos a `supabase/functions`.

**Consome:** `requireUser` e perfil existente; `public.is_super_admin()` e `organizations`.
**Produz:** DTOs acima e `requirePlatformAdmin(req: Request): Promise<{userId:string}>`, `validateTerms(input: unknown): CommercialTermsInput`; tabelas abaixo e RPC `platform_save_terms(p_actor uuid,p_input jsonb) returns jsonb`.

- [ ] Escrever testes de perfil ativo/inativo, admin de cliente recusado, ausência de JWT, valores zero e modalidade 2 com infraestrutura.

```ts
const ORG = '90000000-0000-0000-0000-000000000001';
const valid = {org_id:ORG, starts_on:'2026-10-01', modality:2,
  monthly_fee_cents:60000, revenue_bps:700, sonar_unit_cents:0,
  setup_fee_cents:0, setup_due_month:null, reason:'Negociação outubro'};
expect(validateTerms({org_id: ORG, starts_on:'2026-10-01', modality:2,
  monthly_fee_cents:60000, revenue_bps:700, sonar_unit_cents:0,
  setup_fee_cents:0, setup_due_month:null, reason:'Negociação outubro'}))
  .toMatchObject({monthly_fee_cents:60000, sonar_unit_cents:0});
expect(() => validateTerms({...valid, revenue_bps:-1})).toThrow();
expect(() => validateTerms({...valid, starts_on:'2026-10-15'})).toThrow();
```

- [ ] Rodar `rtk pnpm exec vitest run supabase/functions/_shared/platform-admin/__tests__/auth.test.ts supabase/functions/_shared/platform-admin/__tests__/validation.test.ts`; confirmar falhas pelos comportamentos ausentes.
- [ ] Implementar schema e autorização. `platform_commercial_terms`: campos DTO, `starts_on date` no primeiro dia, preços inteiros seguros não negativos, `revenue_bps between 0 and 10000`, timezone fixo, FK organization RESTRICT, creator preservado como UUID (não cascade), `version integer` positivo e `unique(org_id,starts_on,version)`. Registro imutável. Renegociação só próximo mês; substituir proposta futura insere nova versão auditada, calculada sob lock da organização. Resolver condição por `starts_on <= data`, ordenando `starts_on desc, version desc limit 1`. Não editar condição antiga para alterar seu valor; demonstrativo referencia seu terms_id específico.

```sql
create table public.platform_audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid, occurred_at timestamptz not null default now(),
  category text not null check (category in ('admin','billing','pulse','support')),
  action text not null, result text not null, target text, reason text,
  details jsonb not null default '{}'::jsonb
);
alter table public.platform_audit_events enable row level security;
revoke all on public.platform_audit_events from anon, authenticated;
```

Condições e auditoria têm RLS ativa e nenhum DML direto do browser. RPCs `SECURITY DEFINER SET search_path=''`, execute apenas service_role; verificam o ator super-admin ativo derivado pela edge, organização e competência. RPC de condição bloqueia a linha da organização, grava condição+auditoria na mesma transação. Próxima vigência calculada por `date_trunc('month', now() at time zone 'America/Fortaleza') + interval '1 month'`. Primeiro contrato exige início explícito, default UI próximo mês. Manter setup_due_month consistente com início e implantação pontual, não reaplicar setup em renegociação.

- [ ] Validar teste SQL transacional com duas organizações, proibição de DML authenticated, RPC de ator comum negada, duas renegociações concorrentes sem versões ativas conflitantes, histórico preservado; rodar unitários novamente e `deno check` nos módulos novos via `rtk proxy deno check ...`.
- [ ] Relatar arquivos, contratos, testes e commit somente dos arquivos da tarefa. Sol revisa antes de liberar dependentes.

## Task 2 — Resultados compartilhados e paridade (T2 · Terra)

**Arquivos:** criar `_shared/platform-admin/sales-types.ts`, `sales-summary.ts`, `sales-costs.ts`, `sales-canonical.ts`, `metrics.ts`, `metrics-repository.ts`, `__tests__/metrics-parity.test.ts`, `__tests__/metrics-repository.test.ts`. Modificar apenas a extração necessária em `src/lib/resumo-vendas.ts`, `custos.ts`, `anuncio-canonico.ts`, `faturamento.ts`; preservar exports públicos existentes. Leitura adicional: `src/lib/queries.ts:682`, `src/lib/paginacao-supabase.ts` e testes existentes de resumo/custo.

**Consome:** T1 DTOs, `ml_vendas`/itens/custos congelados, `variacoes` e `configuracoes` por organização.
**Produz:** `readOrgMetrics(db,orgId,month,now): Promise<OrgMetrics>`, módulos puros que operação e central importam sem importar browser/Supabase client.

- [ ] Escrever teste de paridade com venda de R$100, líquido R$80, custo R$50 e imposto de 8%: markup 44%, não margem 30,55%; incluir packs, custo congelado, fallback por SKU, custo ausente, reembolso e canal.

```ts
const row = makeSale({total_amount:100, liquido:80, status:'paid',
  itens:[makeItem({quantity:1, unit_price:100, custo_congelado:50})]});
const summary = calcularResumo([row], () => 50, undefined, NOW, () => 8);
expect(summary.bruto).toBe(100);
expect(summary.markup).toBeCloseTo(0.44);
expect(summary.vendasComCusto).toBe(1);
expect(calcularResumo([row]).markup).toBeNull();
```

- [ ] Rodar `rtk pnpm exec vitest run tests/lib/resumo-vendas.test.ts tests/lib/custos.test.ts tests/lib/faturamento-custo-congelado.test.ts tests/lib/paridade-custo-fe-be.test.ts supabase/functions/_shared/platform-admin/__tests__/metrics-parity.test.ts`.
- [ ] Extrair os corpos puros existentes para os módulos compartilhados com imports `.ts` válidos em Deno; browser reexporta as mesmas funções. Mover os tipos Venda/VendaItem para `sales-types.ts` e reexportar de `faturamento.ts`. Extração de `canonizarItem`/tipos evita levar `supabase` do browser para Deno; montagem/leitura dos mapas continua disponível no módulo frontend. `round2` preserva o algoritmo existente; não fazer refatoração global de formatação. As funções de série e rótulos existentes podem ficar no frontend se não usadas pela central.

```ts
// src/lib/resumo-vendas.ts, para exports extraídos:
export { calcularResumo, ehFaturavel, STATUS_FATURAVEL, impostoDoItem,
  ratearLiquidoPorFrete } from '../../supabase/functions/_shared/platform-admin/sales-summary';
// Cálculo central usa exatamente o mesmo núcleo:
const resumo = calcularResumo(vendas, montarCustoResolver(mapas),
  montarPesoResolver(mapas), now.getTime(), montarAliquotaResolver(mapas, aliquotas));
```

Implementar leituras paginadas com `.eq('org_id',orgId)` e ordenação estável, tanto venda quanto itens/custos/variações/configuração; validar também relações embutidas, sem pressupor que todo filho é do pai correto. Usar as colunas e precedências de `buscarVendas`/`comCustoCongelado`. Sem erro de config, preservar semântica atual das alíquotas; erro deve produzir aviso e markup indisponível. Série de seis meses e comparativo do período derivam das mesmas vendas, sem média simples. Contagens operacionais devem reutilizar o conceito atual de publicado/ativo/pendência; não rotular como ativo qualquer registro apenas porque existe no banco. Contagens sem fonte confiável ficam indisponíveis com aviso.

- [ ] Testar paginação acima de 1000 vendas, query de A nunca lendo B, 0 vendas, falha de custos/config, comparação de fevereiro/março e mês em andamento. Rodar teste focado e typecheck dos arquivos compartilhados em Deno.
- [ ] Entregar paridade comprovada, escopo das métricas operacionais e commit da tarefa. Não escrever router `platform-admin` (T4).

## Task 3 — Sonar durável, atribuição e consumo (T3 · Terra)

**Arquivos:** criar `supabase/migrations/20260906170100_platform_sonar_metering.sql`, `_shared/pulse/sonar-metering.ts`, `_shared/pulse/__tests__/sonar-metering.test.ts`, `supabase/tests/platform_sonar.sql`, `scripts/test-platform-sonar-concurrency.sh`; modificar `pulse-sonar-vendas/index.ts`, `pulse-sonar-visitas/index.ts`, `pulse-analise-secoes237/index.ts`, `src/lib/sonar.ts`, `src/lib/sonar-buscas-recentes.ts`, `src/pages/PulseSonar.tsx` e seus testes existentes.

**Consome:** condição vigente T1, `requireUserOrg`, Redis e `buscarAnunciosML` existentes. Termo e EAN já convergem em `pulse-sonar-vendas`; não criar segundo evento faturável no endpoint legado `pulse-sonar-ean`.
**Produz:** quatro tabelas `platform_sonar_results`, `platform_sonar_searches`, `platform_sonar_events`, `platform_sonar_deliveries`; contrato HTTP abaixo e funções de consulta paginada disponíveis para T4.

```ts
type SonarRequest = {termo:string; request_id:string} |
  {resultado_id:string; request_id:string};
type SonarConsumption = {
  classificacao:'cliente'|'reabertura'|'daludi'|'isento';
  entrega_id:string|null; unidades:0|1; total_centavos:number;
};
// Resposta principal acrescenta busca_id, resultado_id e consumo ao painel atual.
// Complementos recebem {busca_id, resultado_id}, mais seleção de itens se necessária.
```

- [ ] Testar política comercial antes da integração. Zero preço não pode virar default; Daludi nunca cria entrega_cliente; sucesso não vazio é uma unidade e complementos zero.

```ts
expect(classifyDelivery({origin:'daludi', valid:true, alreadyDelivered:false,
  terms:null})).toMatchObject({units:0, reason:'daludi'});
expect(classifyDelivery({origin:'cliente', valid:false, alreadyDelivered:false,
  terms:zeroPriceTerms})).toMatchObject({units:0, reason:'resultado_indisponivel'});
expect(classifyDelivery({origin:'cliente', valid:true, alreadyDelivered:false,
  terms:zeroPriceTerms})).toMatchObject({units:1, total_cents:0});
```

- [ ] Rodar `rtk pnpm exec vitest run supabase/functions/_shared/pulse/__tests__/sonar-metering.test.ts src/lib/__tests__/sonar-buscas-recentes.test.ts src/pages/__tests__/PulseSonar.test.ts`.
- [ ] Implementar schema de resultado público durável com query normalizada/tipo, schema_version, payload, estado, valid_until e lease_token/lease_until. Busca registra org, ator, suporte, intenção, request UUID e estado; `UNIQUE(org_id,actor_id,request_id)`, recusar reaproveitamento da chave com intenção/consulta diferente. Eventos append-only guardam etapa/desfecho. Entrega guarda org/resultado/ator/condição/competência/fuso/preço/unidades/valor/motivo; `UNIQUE(org_id,result_id)` e nenhuma entrega de cliente para Daludi. Sem condição, gravar isento e impedir cobrança retroativa desse resultado.

```sql
-- Na RPC comercial, com identidade/contexto derivados no servidor:
insert into public.platform_sonar_deliveries
  (org_id, result_id, search_id, actor_id, terms_id, month, unit_cents, units, total_cents)
values (v_org, v_result, v_search, v_actor, v_terms, v_month, v_price, 1, v_price)
on conflict (org_id, result_id) do nothing;
-- Ler e devolver a entrega que venceu, sem reaplicar a tarifa.
```

RPCs `platform_sonar_begin`, `platform_sonar_resolve_result`, `platform_sonar_complete` executam apenas no service_role e validam contexto. Claim por query/schema usa lock transacional; fornecedor roda fora da transação; fencing rejeita worker com lease antigo. Outro pedido aguarda por resposta 202 recuperável, sem cobrar e sem abrir coleta duplicada. Completion publica payload+resultado e registra evento comercial atomicamente, retornando o mesmo resultado no retry. Persistir falhas e motivos; falha de ledger recusa entrega principal até recuperação. Validar módulo Pulse, perfil e suporte no início e antes da conclusão longa. Contexto não pode mudar de org durante execução.

Normalizar termo como hoje; classificar EAN pelo input da UI sem alterar semântica existente da busca. Reaproveitar resultado público válido independentemente de Redis; adotar cache legado com identidade única persistida de modo concorrente. Reabertura por ID verifica entrega/busca anterior da organização e nunca coleta fornecedor. Duas organizações podem ter entregas distintas da mesma versão pública. IDs adivinhados não dão acesso a histórico de outra organização.

No frontend, gerar request_id uma vez por submit e reutilizar em retry; histórico por org/ator/contexto contém resultado_id e é atualizado só após sucesso. Incluir escopo em todas as query keys do Sonar. Reabertura explícita chama backend mesmo se React Query tiver cache; complementos usam a amostra persistida e sua correlação, não payload livre do cliente. Exibir informação de consulta cobrável/preço quando disponível e tratar pendência/202 sem nova intenção automática. Não cobrar cotação DRE ou consulta auxiliar.

- [ ] Executar testes SQL reais com duas conexões para requests concorrentes, cache-miss, lease vencido, entrega única, preço por org, reabertura pós-TTL e suporte revogado. Script aceita apenas PostgreSQL local/contêiner de testes e dados fictícios. Testar falha de gravação, resposta perdida e replay de IDs no frontend/serviço.
- [ ] Entregar migration, contrato e testes sem alterar arquivos de T2/T4. Documentar que se prova disponibilização recuperável, não visualização pelo navegador.

## Task 4 — Backend da central e fechamento atômico (T4 · Terra)

**Arquivos:** criar `supabase/migrations/20260906170200_platform_billing.sql`, `supabase/functions/platform-admin/index.ts`, `_shared/platform-admin/handler.ts`, `billing.ts`, `repository.ts`, `__tests__/handler.test.ts`, `__tests__/billing.test.ts`, `supabase/tests/platform_billing.sql`, `scripts/test-platform-billing-concurrency.sh`. Modificar `supabase/config.toml` e `supabase/functions/usuarios/index.ts` somente para auditoria/proteção de exclusão do contexto da central.

**Consome:** DTOs/auth T1, métricas T2, entregas/eventos T3.
**Produz:** todas as ações `platform-admin` listadas acima; `createPlatformAdminHandler(deps): (req:Request)=>Promise<Response>` com dependências injetáveis para testes.

- [ ] Escrever fixtures numéricas: bruto R$10.000, devolução elegível R$1.000, base R$9.000, 5%=R$450, infraestrutura R$600, dez consultas a R$1,20=R$12, total R$1.062. Modalidade 2 negociada pode ter os mesmos fixos. Incluir devolução parcial sem conciliação recusada.

```ts
expect(preview).toMatchObject({gross_cents:1000000, refund_cents:100000,
  base_cents:900000, fee_cents:45000, sonar_units:10,
  sonar_cents:1200, total_cents:106200, blockers:[]});
expect(partialWithoutEvidence.blockers).toContainEqual(expect.objectContaining({
  code:'refund_reconciliation_required', sale_id:SALE,
}));
```

- [ ] Rodar `rtk pnpm exec vitest run supabase/functions/_shared/platform-admin/__tests__/billing.test.ts supabase/functions/_shared/platform-admin/__tests__/handler.test.ts`.
- [ ] Implementar `platform_billing_statements` (org/month unique, snapshot imutável, autor, fechado_em, revision), `platform_billing_sale_facts` (vendas/revisões/base reconhecida por demonstrativo) e `platform_revenue_reconciliations` (valor devolvido de produto, revisão da fonte, ator/motivo, append-only). FKs de histórico comercial RESTRICT; nenhum cascade destrutivo. Tabelas com RLS e browser sem DML.

RPCs `platform_billing_preview(p_actor,p_org,p_month)`, `platform_billing_close(p_actor,p_org,p_month,p_expected_revision)` e `platform_reconcile_revenue(p_actor,p_input)` usam aritmética PostgreSQL `numeric` e centavos inteiros. `preview` é a única composição autoritativa, não aceitar total/percentual do frontend. Reconciliar é por venda/org com `source_updated_at` correspondente e valor entre zero e bruto; uma alteração posterior da fonte invalida a conciliação anterior.

```sql
v_fee_cents := round(v_base_cents::numeric * v_revenue_bps / 10000)::bigint;
-- close bloqueia a organização, recalcula pela mesma função e confere revisão:
perform 1 from public.organizations where id=p_org for update;
-- Se já existe demonstrativo, devolver o mesmo registro.
-- Se revisão mudou, lançar conflito; não fechar automaticamente números não conferidos.
```

Revisão é hash de representação determinística de fontes+condição+entregas+conciliações+saldo anterior (sem relógio volátil). Close revalida dentro da transação, recusa mês em andamento, lacuna de fechamento desde início do contrato e pendências. Snapshot inclui valores, linhas, nome da organização, condições e fontes mínimas necessárias para explicar cada componente. Fechamento não muda com custo/preço/nome atuais.

Para ajustes tardios, usar IDs dos fatos originais e condição original. Por demonstrativo de origem, recalcular remuneração sobre a base remanescente e comparar com remuneração acumulada já reconhecida; isso mantém arredondamento agregado e evita somar arredondamentos por venda. Registrar a diferença e referências, aplicar uma vez. Saldo negativo anterior transportado uma vez; crédito remanescente preservado. Implantação é única no setup_due_month, sem repetição em novas versões.

Router valida `requirePlatformAdmin`, input, org existente, paginação e período. `overview` calcula toda a carteira com concorrência limitada no backend; não confundir totais paginados. `pulse_usage` devolve contagens agregadas e páginas de eventos; custo financeiro null se não medido. `audit` combina fontes autorizadas e sanitizadas de admin/comercial/Pulse/suporte com ordenação estável e filtros. Dados desconhecidos não são zero.

Registrar alterações administrativas já expostas por `usuarios` (criação, canais, módulos, tipo) com ator/org/alvo/resultado. Não depender de log em console. Para ações não transacionais existentes, registrar intenção durável antes e resultado depois, retornando erro explícito se resultado não puder ser auditado; nunca afirmar rollback de uma ação já aplicada. Proteger `delete_org` ANTES de qualquer limpeza para organizações com histórico comercial/auditoria. Garantir proteção concorrente de histórico; se o fluxo sequencial atual não comportar garantia atômica, desabilitar essa exclusão na central com motivo explícito, em vez de apagar parte da organização e falhar ao final.

- [ ] Testar SQL real de fechamento concorrente, revisão divergente, fontes atualizadas, crédito posterior a nova taxa, duas organizações, ator inativo e vedação de update/delete do histórico. Registrar resultados de checks SQL, unitários e Deno. Não usar mocks como única prova de atomicidade.
- [ ] Entregar backend completo para T5/T6/T7 e commit específico. Config `verify_jwt` segue padrão da plataforma com autenticação obrigatória explícita na função; testar JWT inválido independentemente do gateway.

## Task 5 — API cliente, hooks e demonstrativo exportável (T5 · Luna)

**Arquivos:** criar `src/lib/platform-admin.ts`, `src/hooks/usePlatformAdmin.ts`, `src/lib/export/platform-billing.ts`, `src/lib/__tests__/platform-admin.test.ts`, `src/lib/export/__tests__/platform-billing.test.ts`. Não editar router/backend ou páginas.

**Consome:** DTOs T1 e ações HTTP congeladas. Exportadores `ReportData`, `BotaoExportar`, PDF/Excel/CSV já existentes.
**Produz:** `callPlatformAdmin<T>(action:string,params:Record<string,unknown>):Promise<T>`, `usePlatformOverview(month,includeTest)`, `usePlatformOrganizations(params)`, `usePlatformMetrics(orgId,month)`, `usePlatformTerms(orgId)`, `usePlatformPreview(orgId,month)`, `usePlatformStatements(orgId)`, `usePlatformPulseUsage(params)`, `usePlatformAudit(params)`, `buildBillingReport(statement:BillingStatement):ReportData`.

- [ ] Escrever testes de erro HTTP/invoke, exportação com ajustes e cache separado por org/período. Export não calcula nem arredonda o total novamente.

```ts
const report = buildBillingReport(statement);
expect(report.titulo).toContain(statement.org_name);
expect(report.kpis).toContainEqual({label:'Total', valor:'R$ 1.062,00'});
expect(report.linhas.map(x => x.celulas.descricao)).toContain('Infraestrutura');
```

- [ ] Rodar `rtk pnpm exec vitest run src/lib/__tests__/platform-admin.test.ts src/lib/export/__tests__/platform-billing.test.ts`.
- [ ] Implementar invoke como `usuarios` trata respostas não-2xx, preservando `code` e mensagem. Keys começam por `['platform-admin', userId, action, orgId, month, filters]`; não reutilizar `['vendas']` ou `['custos']`. Mutations usam payload/retorno do backend, invalidam só org/período atingidos e listas da central quando pertinente. Erros não viram arrays vazios ou sucesso.

```ts
export function buildBillingReport(s: BillingStatement): ReportData {
  return {titulo:`Demonstrativo Daludi · ${s.org_name}`, periodo:s.month,
    filtros:[`Fuso: ${s.timezone}`, `Fechado em: ${s.closed_at}`],
    kpis:[{label:'Total', valor:fmtBRL(s.total_cents/100)}],
    colunas:[{chave:'descricao',titulo:'Componente'},
      {chave:'valor',titulo:'Valor',alinhamento:'right'}],
    linhas:s.lines.map(line=>({celulas:{descricao:line.label,valor:line.amount_cents/100}}))};
}
```

Expandir o adapter com base, percentual, consultas/preço e fontes, conforme spec; exportar snapshot fechado, não consultar condições atuais. CSV/Excel preservam números e segurança de células tratada pelos exportadores existentes.

- [ ] Validar que o mesmo snapshot gera o mesmo demonstrativo após mudança de condições e que total/linhas conciliam. Usar testes focados; fazer commit e informar props/API prontas aos executores de UI.

## Task 6 — Carteira, resultados, Pulse e auditoria (T6 · Terra)

**Arquivos:** modificar `src/App.tsx`, `src/components/admin-shell.tsx`, `src/pages/Organizacoes.tsx`; criar `src/pages/OrganizacaoDetalhe.tsx`, `src/components/platform-admin/org-results.tsx`, `org-pulse.tsx`, `org-audit.tsx`, `src/pages/__tests__/OrganizacaoDetalhe.test.tsx`; ampliar `src/pages/__tests__/Organizacoes.test.tsx`. Ler/aplicar skill impeccable para o design quando disponível, sem mudar identidade visual da plataforma.

**Consome:** hooks T5, componentes T7 pelas props abaixo; guards existentes `SuperAdminRoute`/`AdminShell`.
**Produz:** `/admin` carteira e `/admin/organizacoes/:orgId` detalhe dentro do guard; rotas de cinco seções preservam org/período. `OrgBilling` e `OrgSettings` são importados dos arquivos de T7, não reimplementados.

- [ ] Escrever testes de carteira com empresas de teste filtradas, seleção de empresa, markup indisponível/cobertura, erro de backend e navegação mantendo suporte.

```tsx
expect(screen.getByRole('heading',{name:'Organizações'})).toBeInTheDocument();
expect(screen.getByText('Markup')).toBeInTheDocument();
await user.click(screen.getByRole('link',{name:/Ver organização Avil/i}));
expect(location.pathname).toBe('/admin/organizacoes/'+ORG);
```

- [ ] Rodar `rtk pnpm exec vitest run src/pages/__tests__/Organizacoes.test.tsx src/pages/__tests__/OrganizacaoDetalhe.test.tsx`.
- [ ] Implementar carteira com hierarquia visual clara: KPIs compactos da carteira, pesquisa/filtros/ordenação, linha por empresa com modalidade, faturamento/evolução, markup/cobertura, consumo, previsão e pendências. Cards em viewport pequeno; evitar scroll horizontal obrigatório. Cabeçalho sticky mantém contexto plataforma; usar paleta/tipografia/raios/componentes existentes. Não inventar score de saúde nem simular dados ausentes.

```tsx
<Route element={<SuperAdminRoute />}>
  <Route element={<AdminShell />}>
    <Route path="/admin" element={<Organizacoes />} />
    <Route path="/admin/organizacoes/:orgId" element={<OrganizacaoDetalhe />} />
  </Route>
</Route>
```

Detalhe usa tabs Resultados/Pulse/Cobrança/Auditoria/Configurações, URL/query de período, nome/slug/modo teste sempre visíveis. Resultados reutilizam Recharts/KPI e exibem seis meses, comparação equivalente e pendências; Pulse discrimina cliente/Daludi/falhas/reaberturas, consulta, pessoa e motivo; auditoria tem filtros com paginação e detalhes sanitizados. Ação de suporte reutiliza fluxo e store atual, sem chamar startSupport ao apenas abrir organização. Estado de conexão/dado stale visível quando fonte informar.

- [ ] Verificar testes de navegação e regressão de suporte; inspecionar navegador em 390px e 1440px com fixtures locais ou ambiente local autorizado. Console antes de qualquer correção de tela vazia; `.env.local` necessário antes de Vite, valores nunca impressos.
- [ ] Entregar UI integrada com T7; reportar evidência visual e testes. Não editar os componentes de T7 em paralelo sem acordo do Sol.

## Task 7 — Condições, configurações e cobrança (T7 · Luna)

**Arquivos:** criar `src/components/platform-admin/org-billing.tsx`, `org-settings.tsx`, `commercial-terms-form.tsx`, `revenue-reconciliation.tsx`, `__tests__/org-billing.test.tsx`, `__tests__/commercial-terms-form.test.tsx`; extrair de `src/pages/Organizacoes.tsx` somente após T6 liberar a propriedade do arquivo, ou manter os diálogos existentes via export temporário coordenado.

**Consome:** T5 API/hooks; DTOs T1, `callUsuarios`/diálogos existentes via extração coordenada.
**Produz:** `OrgBilling({orgId,month}:{orgId:string;month:Month})`, `OrgSettings({orgId}:{orgId:string})`; `CommercialTermsForm({orgId,current,onSaved}:{orgId:string;current:CommercialTerms|null;onSaved:()=>void})`.

- [ ] Testar infraestrutura na modalidade 2, preço zero, percentuais editáveis, próximo mês, histórico e fechamento conflitante.

```tsx
await user.selectOptions(screen.getByLabelText('Modalidade'),'2');
await user.clear(screen.getByLabelText('Infraestrutura mensal'));
await user.type(screen.getByLabelText('Infraestrutura mensal'),'600,00');
await user.click(screen.getByRole('button',{name:'Salvar condições'}));
expect(save).toHaveBeenCalledWith(expect.objectContaining({modality:2,
  monthly_fee_cents:60000, starts_on:'2026-10-01'}));
```

- [ ] Rodar `rtk pnpm exec vitest run src/components/platform-admin/__tests__/org-billing.test.tsx src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`.
- [ ] Implementar formulário com defaults da apresentação apenas para contrato novo, preservando valores digitados na troca de modalidade. Preço e percentual aceitam formato pt-BR; validar escala/safe integer antes de enviar. Não usar `valor || default`, que apaga zero. Salvar exige motivo e mostra vigência; histórico mostra condições vigentes/futuras/anterior. Configurações preservam cadastro/canais/módulos/tipo/suporte existentes em seção apropriada.

```tsx
const canClose = preview.terms !== null && preview.blockers.length === 0;
<Button disabled={!canClose || closing} onClick={() => close({
  org_id:orgId, month, expected_revision:preview.revision,
})}>Fechar demonstrativo</Button>
```

Antes de fechar, mostrar composição completa e confirmação concreta do demonstrativo. Se revisão mudou, atualizar prévia e pedir nova conferência, sem autoaceitar valores novos. Não fechar mês atual. Pendência de devolução oferece conciliação por venda com bruto/valor devolvido/revisão/motivo; valor total não é editável. Usar demonstrativos fechados para exportação. Separar bruto, ajustes da base, percentual, infraestrutura, consultas, implantação e créditos; total negativo deve dizer crédito, não pagamento a cobrar.

- [ ] Testar inputs zero/negativo/decimal, modal2 com infraestrutura, mudança de mês, bloqueio por conciliação, conflito, exportação de snapshot e erro de gravação. Ações afetam somente org selecionada.
- [ ] Entregar componentes/props e commit; Sol integra com T6 e revisa os casos reais negociados.

## Task 8 — Integração, verificação e entrega (T8 · Terra + revisão Sol)

**Arquivos:** testes/arquivos afetados pelas correções; criar `docs/how-to/central-organizacoes.md` e `docs/superpowers/plans/2026-09-06-central-organizacoes-verificacao.md`; atualizar este checklist conforme evidências. Não ampliar escopo.

- [x] Sol revisa diff completo contra spec/ADR e todas as integrações. Encaminhar achados a Terra/Luna com arquivos e testes afetados; não aceitar claims de atomicidade baseados só em mock. Verificar que código de produção usa as funções testadas.
- [x] Preparar ambiente local: reutilizar dependências disponíveis ou instalar via pnpm; `.env.local` no worktree antes de Vite, sem imprimir valores. Banco de teste dedicado com fixtures A/B, cliente, equipe Daludi, admin inativo e contratos negociados. Nunca `db reset` ou comandos contra banco existente/produção sem autorização apropriada.
- [x] Rodar conjunto focado de todos os testes novos e regressões do resumo/custo/Sonar/Organizacoes/suporte; executar `rtk pnpm exec tsc -b --pretty false`, lint dos arquivos alterados e `rtk proxy deno check` das edges alteradas. Executar testes SQL e concorrência local, registrando o comando, ambiente e resultado. Se runtime local faltar, tentar o mecanismo autorizado; declarar precisamente qualquer validação que não foi possível, sem marcar como passou.
- [ ] Exercitar fluxo completo: selecionar A, conferir bruto/markup, salvar modal2 com infraestrutura, cliente faz consulta/reabertura, Daludi faz consulta auditada, verificar B intacta, conferir e fechar mês elegível, repetir fechamento, renegociar e comprovar snapshot/export antigo igual. Inspecionar 390px/1440px, teclado e console. Documentar regras e limitações de histórico/custos.
- [x] Sol consolida resultado, verificações e pendências reais. Manter worktree e arquivos entregues; não fazer merge/push/deploy nem aplicar migrations de produção por inferência. Se apenas promoção a produção faltar, entregar implementação local validada e informar essa etapa explicitamente.

## Registro de execução

Estado inicial: desenho aprovado; plano elaborado por Astra. Nenhuma tarefa de implementação foi iniciada na criação deste documento.

Sol atualiza por tarefa: estado, executor, arquivos, commits, comandos/testes e resultado de revisão. Toda decisão que alterar contrato ou critério de aceite deve constar neste registro com motivo e impacto. Não apagar evidências ao encerrar.

| Tarefa | Estado na branch | Commit(s) |
|---|---|---|
| T1 — fundação, contratos e segurança | concluída e validada localmente | `7fa6d44..f6d88f1` |
| T2 — resultados compartilhados | concluída e validada localmente | `ea280d67` |
| T3 — Sonar durável e consumo | concluída e validada localmente | `d5ddbe44` |
| T4 — fechamento e backend central | concluída e validada em PostgreSQL local | `ab115b86` |
| T5 — cliente, hooks e exportação | concluída e validada localmente | `fdd14f42` |
| T6 — carteira e detalhe | concluída; visual autenticado ainda pendente | `50cb696e` |
| T7 — condições, cobrança e configurações | concluída e validada localmente | `7d608f36` |
| T8 — integração, evidências e documentação | concluída com blockers registrados | este commit de documentação |

Registro T8: 17 suites/125 testes, Deno, trio SQL real, concorrência e ESLint passaram.
`tsc -b`/build seguem vermelhos na baseline Sonar/faturamento; `db:check` não encontrou projeto
linkado. O Vite iniciou, mas o navegador isolado foi redirecionado para login em 390/1440, portanto
o fluxo visual autenticado e teclado não foram marcados como aprovados. Evidência completa em
[2026-09-06-central-organizacoes-verificacao.md](2026-09-06-central-organizacoes-verificacao.md).
Não houve merge, push, deploy ou migration de produção.
