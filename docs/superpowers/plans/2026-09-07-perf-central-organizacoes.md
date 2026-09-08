# Plano — Performance da Central de Organizações (super-admin)

Data: 2026-09-07 · Branch: `worktree-perf-super-admin` · **v2** (pós revisão adversarial)

Origem: análise de causa-raiz medida em produção → revisão adversarial do GPT-5.6 Sol
(veredito REVISAR) → arbitragem com evidência de produção. Este documento é a versão alinhada
entre as duas revisões; a v1 continha 4 itens que mudariam números financeiros e foram corrigidos.

## Problema

A carteira (`/admin`, ação `wallet`) leva **4,3–6,5 s com 2 organizações**, inclusive em meses sem
venda. O ADR-0158 orçou "≤ 15 round-trips e < 1,5 MB"; o real é **17 idas (9 em fila) e ~5,8 MB**.

**O banco não é o gargalo**: todas as queries quentes usam index scan (≤ 112 ms) e nenhum índice
está faltando. O custo é **latência cross-region + volume de JSON em cadeia sequencial** — a edge
executa em `sa-east-1`, o Postgres em `us-east-1` (~120–150 ms por ida).

**Por que demora sem venda**: nada do que é lido depende do mês ter venda — janela fixa de 6 meses
de `ml_vendas` (`metrics-repository.ts:112-117`), catálogo de custo na mesma janela (1,97 MB /
6 287 linhas na Avil, `:125`) e prévia que varre o histórico inteiro. Piso de ~1,2–1,8 s com zero
vendas.

**Com 30 orgs quebra a edge, não o banco**: `mapLimit(…, 4)` = 8 ondas × ~3 s ≈ 25 s de parede e
~90 MB de JSON por render estouram CPU/memória do runtime.

## Meta (gate, não promessa)

| Etapa | p95 esperado, 2 orgs |
|---|---|
| Hoje | 4,3–6,5 s |
| Fase 1 | 1,4–1,9 s |
| Fase 2 | 0,9–1,3 s |
| Fase 3 (tabela) | 0,7–1,0 s (piso ~0,5 s) |

A tabela consolidada se justifica pela **escala** (30 orgs: ~25 s → ~2–3 s), não pelo alvo de 1,5 s.

**Trava de aceite, obrigatória em todas as fases**: `diff` campo a campo do payload `wallet` e
`organization` (mês corrente **e** um mês fechado, as 2 orgs) antes e depois = vazio. Nenhum número
exibido pode mudar.

---

## Fase 1 — Latência e paralelismo (sem mudança de semântica)

Ganho: ~3–4 s. Esforço: ~2 h. Risco: baixo.

### 1.1 Runtime junto do banco → ~1,5–2 s

- `src/lib/platform-admin.ts:47` — importar `FunctionRegion` e passar `region:
  FunctionRegion.UsEast1` no `invoke`. Confirmado no pacote instalado (supabase-js 2.106.2,
  `functions-js` types: `FunctionRegion` e `region?: FunctionRegion`).
- **BLOQUEADOR, achado na revisão**: o SDK envia o header `x-region`, e
  `supabase/functions/_shared/cors.ts:1-6` só permite `authorization, x-client-info, apikey,
  content-type, upstash-signature`. Sem acrescentar `x-region` ao `Access-Control-Allow-Headers`,
  **o preflight falha e a chamada nem executa**.
- Alcance: afeta **toda** a função `platform-admin` (wallet, organization, metrics, terms, preview,
  statements, pulse, audit, save_terms, close, reconcile — `usePlatformAdmin.ts:102-226`), não só a
  Central. Perde-se o reroteamento automático em indisponibilidade regional; rollback = remover a
  opção.
- Atualizar a expectativa de invoke em `src/lib/__tests__/platform-admin.test.ts:17-24`.
- Verificação: `x_sb_edge_region` = `us-east-1` nos logs (hoje `sa-east-1`).

### 1.2 Preflight cacheado → 0,15–0,4 s por chamada (só quente)

`_shared/cors.ts` — `'Access-Control-Max-Age': '86400'` (junto com o `x-region` de 1.1).
Toca todas as funções → **redeploy de todas as que importam `_shared/cors.ts`**.

### 1.3 `Promise.all` apenas onde é comprovadamente independente → ~0,7–1 s

- `metrics-repository.ts:114-128`: `Promise.all([vendas, catálogo, configuracoes])`. Verificado:
  `seriesMonths` depende só de `month` (`:112`) e os mapas de custo/alíquota só são consumidos
  depois dos awaits (`:133-193`).
- **NÃO fazer** o paralelismo de perfil/organizações/termos prometido na v1: o perfil é lido na
  autenticação, antes do dispatch (`auth.ts:4-16`), e `terms` depende da lista de orgs.
- **NÃO remover `organizationExists`** (`handler.ts:29-31`). A v1 propunha; a revisão mostrou que
  isso transforma 404 em 200/500 em 10 ações (`save_terms`, `preview`, `close`, `statement`,
  `reconcile` viram 500; `metrics`, `terms`, `statements`, `pulse_usage`, `audit` viram 200 com
  zeros) e quebra `handler.test.ts:61-87`.

### 1.4 Detalhe: parar de recalcular métricas → 2 s na tela de detalhe

`src/components/platform-admin/org-results.tsx:20-21` — passar `organization.metrics` em vez de
chamar a ação `metrics`.
**Não** eliminar a chamada de `preview` nesta fase: `OrgSummary` (`types.ts:89-127`) traz apenas
derivados, não o `BillingPreview` completo (`types.ts:42-76`) que o cabeçalho e a aba de cobrança
consomem (`OrganizacaoDetalhe.tsx:129-188`, `org-billing.tsx:45-158`). Remover exigiria contrato
`OrgDetail` novo + invalidação de `organization` nas mutações (`usePlatformAdmin.ts:174-184`).

### 1.5 react-query: `staleTime`, sem mexer em paginação

`staleTime` de 5 min para os hooks de `platform-admin` (hoje 30 s global, `query-client.ts:21`) —
sem alterar o default global. `placeholderData: keepPreviousData` para a carteira (UX na troca de
página; não reduz tempo).
**A v1 propunha ordenar/paginar no cliente tirando `sort`/`page` da queryKey — cancelado**:
`PAGE_SIZE = 10` (`Organizacoes.tsx:33`), o servidor ordena e fatia o conjunto completo
(`repository.ts:136-157`) e reutilizar cache de página errada é regressão silenciosa.
A alternativa segura vai para a Fase 2.4.

---

## Fase 2 — Volume de dados (mesmo resultado, menos bytes)

Ganho: ~0,5–1 s. Esforço: ~4 h. Risco: médio — exige a trava de aceite.

### 2.1 Enxugar `SALES_COLUMNS` (`metrics-repository.ts:28-34`) → ~40 % dos 3 MB

Lista definitiva (o que efetivamente chega a `OrgMetrics`):

```
venda : id, org_id, order_id, pack_id, status, date_closed, date_created, uf, total_amount,
        sale_fee_total, frete_vendedor, liquido, estorno, atualizado_em, shipping_id
itens : itens:ml_vendas_itens(ml_item_id, variation_id, codigo, ean, quantity, unit_price)
custos: custos:venda_item_custo(ml_item_id, variation_id, custo_unitario)
```

**Atenção — a v1 omitia dois campos e teria zerado a carteira**: sem `org_id`, `normalizeSales`
descarta todas as linhas (`metrics-repository.ts:70`, teste `metrics-repository.test.ts:93-103`);
sem `custos:venda_item_custo(...)`, o custo congelado (ADR-0109) some e o markup histórico muda
(`sales-costs.ts:102-107`).

Seguros de cortar: `status_detail, comprador_nick, comprador_nome, comprador_id, cidade,
paid_amount, sacado_por, currency, shipping_status, shipping_substatus, shipping_logistic,
tracking_number, is_publiai, tem_devolucao, kit_item_id, money_release_date, sacado_em` e, nos
itens, `id, titulo, cor, sale_fee, is_publiai`. (`titulo` alimenta `descricaoVenda`
`sales-summary.ts:128-132`, mas o resultado vai para `summary.vendas`, que `readOrgMetrics`
descarta em `:184-196` — é o corte mais valioso em bytes.)

Adicionar teste de projeção afirmando a lista exata, no molde de `metrics-repository.test.ts:105-114`.

### 2.2 Fatiar a leitura por mês em paralelo → ~0,5–1 s

`readPages` (`metrics-repository.ts:54-63`) pede a página N+1 só quando a N chega.
**Não usar count + offsets paralelos** (proposta da v1): count e páginas são requests separados,
sem snapshot comum — venda inserida no meio desloca offsets e pode duplicar ou perder linha, o que
altera número financeiro.
Fazer: **6 leituras por mês-calendário em `Promise.all`**, cada uma com seu `gte/lt` (a API de
range já existe). Cada mês é uma faixa fechada e independente de offset; em produção o maior mês é
1 135 vendas, então só um mês precisa de segunda página. Risco residual menor que o do código atual.
Se for exigido risco zero, a alternativa é uma RPC `json_agg` em statement único — mais cara, não
recomendada agora.

### 2.3 `distinct on` no catálogo de custo → ~0,5 s e −1,5 MB

`platform_org_cost_catalog` devolve 6 287 de 8 537 variações porque reimportações repetem chaves.
**A v1 especificava o tie-break errado.** São **quatro** mapas (variação, item ML, EAN, código,
`sales-costs.ts:24-32,53-74`), o desempate atual mantém a primeira linha com `id ASC`
(migration `20260907103422:14-16,42-55`) e `atualizado_em` nulo inverte o resultado em SQL.
Forma correta:

```sql
DISTINCT ON (kind, key) ... ORDER BY kind, key, atualizado_em DESC NULLS LAST, id ASC
```

expandindo `(kind, key, row_id)` e unindo os IDs vencedores — uma linha pode vencer numa chave e
perder em outra. Nova migration (`supabase migration new` + `db push`, ADR-0043), com teste de
empate, nulo e vencedor diferente entre chaves. Fonte do custo continua `variacoes.custo`.

### 2.4 Carteira: devolver todas as linhas quando couber

O servidor **já enriquece todas as orgs** para calcular os totais (`repository.ts:146-155`) e só
depois fatia (`:157`) — a economia de devolver 10 linhas em vez de N é ~1 KB por org.
Fazer: quando `total <= 200`, devolver todas as linhas e ordenar/paginar no cliente; acima disso,
manter o comportamento atual. `search` e `include_test` permanecem **server-side e na queryKey**.
Sorts existentes: `name | slug | gross_desc` (`handler.ts:35`); a UI usa `name` e `gross_desc`.

---

## Fase 3 — Tabela consolidada de meses fechados (decisão do dono do produto)

Escopo mínimo correto. Substitui a leitura ao vivo dos **meses fechados**; mês corrente e anterior
seguem ao vivo. É o que faz 30 orgs funcionarem.

### 3.1 Tabela

```sql
create table platform_org_month_metrics (
  org_id                 uuid not null references organizations(id) on delete cascade,
  month                  date not null check (month = date_trunc('month', month)::date),
  gross_cents            bigint  not null,
  orders                 integer not null,
  ticket_cents           bigint  not null,
  markup                 numeric,                 -- null = sem custo OU config não confirmada
  cost_covered_orders    integer not null,
  total_orders           integer not null,
  updated_at             timestamptz,             -- max(ml_vendas.atualizado_em) do mês
  source_count           integer not null,        -- count(*) da janela lida
  source_max_updated_at  timestamptz,
  tax_config_stamp       text not null,           -- config tributária usada, ou 'unconfirmed'
  computed_at            timestamptz not null default now(),
  primary key (org_id, month)
);
alter table platform_org_month_metrics enable row level security;
revoke all on platform_org_month_metrics from anon, authenticated;
-- sem policy: só service_role (padrão de 20260906170200_platform_billing.sql:52-56)
```

Fronteira de mês em BRT (`America/Fortaleza`), idêntica a `startOf` (`metrics-repository.ts:42-44`).
Só meses **fechados** (`month < currentMonth(now)`) são gravados.

**A tabela é cache reconstituível de `OrgMetrics`, não demonstrativo de cobrança.** O que é
imutável e auditável continua sendo `platform_billing_statements` / `_sale_facts` (ADR-0155,
append-only). Não guardar markup como verdade congelada: ele é razão, recalculável dos componentes.

### 3.2 Uma função só, usada pelo job e pela leitura

`materializeMonth(db, orgId, month, now)` = `readOrgMetrics` restrita a um mês. **A mesma função**
alimenta o job e o caminho ao vivo → paridade por construção, sem protocolo de paridade separado.
Teste: `materializeMonth(m)` == campos correspondentes de `readOrgMetrics(m)` com o fake db.

### 3.3 Leitura (read-through) e invalidação — sem trigger

1. **Uma** query de validação por carteira (não por org):
   `select org_id, date_trunc('month', date_closed at time zone 'America/Fortaleza') m, count(*),
   max(atualizado_em) from ml_vendas where date_closed >= startOf(month-5) group by 1,2`
   — index scan em `ml_vendas_org_data_idx`, ~10 ms, uma ida.
2. Linha é válida se `source_count` + `source_max_updated_at` batem com a validação **e**
   `tax_config_stamp` bate com a config atual. Válida → usa. Ausente ou inválida →
   `materializeMonth` inline + upsert. **Nunca zero silencioso**: falha → cálculo ao vivo → se
   falhar, `metrics: null` como hoje.
3. Mês corrente e anterior sempre ao vivo (`previous` do corrente é parcial, `:157-159`).
4. `warnings` continuam sendo do leitor, não da linha materializada.

Por que dispensa trigger: `ml_vendas.atualizado_em` já é o watermark — `upsertVenda` grava
`atualizado_em = now()` e reescreve os itens no mesmo fluxo (`io.ts:327,345-351`); devolução toca
(`devolucoes-io.ts:99`); saque toca (migration `20260720013021`). O único UPDATE que não toca é
`reconciliarLiberacoes` (`io.ts:438`), que mexe só em `money_release_date` — campo que `OrgMetrics`
não expõe. `count(*)` cobre INSERT/DELETE. Config entra pelo `tax_config_stamp`.

**Medido em produção**: 486 vendas de meses fechados foram tocadas em setembro (devoluções e
estornos alteram bruto retroativamente) — a invalidação é obrigatória, "mês fechado é imutável" é
falso.

Deriva aceita e documentada: alterar `variacoes` depois da materialização só afeta itens **sem**
custo congelado — 3 itens em 2 855 nos últimos 6 meses (0,1 %). Não justifica trigger em
`variacoes`; uma ação "recalcular mês" no admin cobre o caso raro.

### 3.4 Job (opcional para correção, útil para o operador)

Edge `materializar-metricas` (`verify_jwt=false` + validação de assinatura QStash, idempotente),
diária às 03:00 BRT: para cada org × últimos 6 meses fechados, roda a validação e materializa o que
estiver ausente ou inválido. **Sem o job o sistema continua correto** (read-through); ele só evita
que o operador pague o primeiro render após a virada de mês. QStash é o menor acréscimo: o projeto
já opera esse padrão em `reconciliar-faturamento` (`config.toml:126`). Schedule fica fora do repo,
como os demais (`docs/reference/edge-functions.md:118-145`).

### 3.5 Backfill

Não é projeto: o primeiro run computa 2 orgs × 5 meses = 10 linhas (30 orgs → 150).

### 3.6 ADR

ADR novo, curto, complementar a 0155/0158: (a) a tabela é cache reconstituível, não demonstrativo;
(b) chave `closed_month` em BRT; (c) validação por `(count, max atualizado_em, tax_config_stamp)`;
(d) deriva de catálogo aceita e medida; (e) mês corrente e anterior sempre ao vivo; (f) registra
que o gatilho do ADR-0158 ("reavaliar cache se passar de 3 s com 10 orgs") foi acionado com 2 orgs.
Numeração: `git fetch` antes de escolher o número.

---

## Ordem de execução

1. Fase 1 (com `x-region` no CORS — sem isso 1.1 não funciona).
2. Fase 2.
3. Medir p50/p95 e registrar.
4. Fase 3 (tabela + read-through + ADR); job QStash por último.

## Verificação (todas as fases)

1. `diff` campo a campo de `wallet` e `organization` (2 orgs, mês corrente e um fechado)
   antes/depois = vazio.
2. `pnpm lint`, `pnpm test`, `pnpm build` — build é exigido pelo CI e testes sozinhos não bastam.
3. `npm run db:check` + `supabase db push` quando houver migration.
4. `supabase functions deploy` das funções afetadas — merge na main **não** deploya
   `supabase/functions/**`.
5. Pós-deploy: `x_sb_edge_region=us-east-1`, ausência de `OPTIONS` repetido, p95 de `wallet` nos
   logs.
6. Docs: `docs/TASKS.md`, `docs/reference/edge-functions.md` e o ADR novo.

## Fora de escopo

- Qualquer escrita em anúncio publicado no ML.
- Reimplementar markup/rateio/custo/imposto em SQL (ADR-0158 §5 proíbe; o agregador TypeScript
  continua único).
- Trocar a chave do mês para `money_release_date`; fluxo de caixa por liberação seria projeção
  separada, e a carteira não exibe esses campos.
