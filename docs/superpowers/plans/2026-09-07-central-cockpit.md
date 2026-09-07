# Central de organizações — correção de dados e redesign (cockpit)

> **Para agentes:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`, uma tarefa por
> subagente, revisão em 2 estágios. O implementador NÃO decide estética nem regra de negócio: tudo o
> que precisa está aqui, no [ADR-0158](../../decisions/0158-central-carteira-agregada-e-pendencias.md)
> e nos arquivos-régua citados. Dúvida = parar e perguntar, não inventar.

**Goal:** a carteira e o detalhe de `/admin` mostram números certos (contrato, pendências, markup em
`+43%`), carregam com 1 chamada e ≤ 15 round-trips, e usam o design system do app (KpiCard,
DataTable, StatusPill, EmptyState, Pagination, Select, DropdownMenu, Tabs pill).

**Base:** auditoria técnica + auditoria de design de 2026-09-07 (resumidas no ADR-0158 e nas tarefas).
Worktree: `/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-cockpit-20260907`,
branch a partir da `main`. Prefixar shell com `rtk`. Nunca editar a `main` direto.

**Regra de ordem:** dado/contrato antes da tela que o exibe. Fase 1 (backend) fecha, deploya e prova
em produção ANTES de qualquer tarefa da Fase 3+.

## Constraints globais

- Rótulos acessíveis que são contrato de teste e NÃO mudam: heading "Organizações"; "Organização
  indisponível"; heading com o nome da org; link `/Ver organização Avil/`; checkbox "Incluir testes";
  "Mês da carteira" / "Mês da organização"; botões "Solicitar acesso", "Solicitar renovação", "Entrar
  na operação", "Cancelar solicitação", "Enviar solicitação", "Fechar demonstrativo", "Confirmar
  fechamento", "Conciliar devolução", "Salvar conciliação", "Salvar condições", "Exportar snapshot";
  labels "Motivo do acesso", "Motivo da conciliação", "Produtos devolvidos", "Infraestrutura mensal",
  "Percentual sobre receita", "Modalidade", "Início da vigência"; nomes das 5 abas; badge "Ambiente de
  teste"; "Crédito a favor da organização". Só `getAllByText('Indisponível')`
  (`src/pages/__tests__/Organizacoes.test.tsx:166`) muda.
- NÃO mudar: `AdminShell`, cabeçalho do Pulse, tokens/fontes/raio/sombra/motion (nenhum hex novo),
  internals de `src/components/ui/*`, `?mes=`/`?aba=`, `currentMonth` em `America/Fortaleza`,
  `PAGE_SIZE = 10`, `src/lib/query-client.ts`.
- A palavra "Indisponível" desaparece da UI da central. Dado ausente esperado → `—` (com `title`
  explicando); dado acionável → `StatusPill tone="warning"` + item na faixa "Precisa da sua atenção";
  falha → faixa de erro padrão `rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3
  text-sm text-destructive` + botão "Tentar novamente" (chama `refetch`).
- Loading nunca é texto no slot do valor: `KpiCard loading`, `Skeleton className="h-14 rounded-lg"`
  ×3, ou `DataTable loading skeletonRows`.
- Cores semânticas só via tokens: `text-success`/`text-destructive`/`text-warning`/`text-info`,
  `border-warning/40 bg-warning/5`. Proibido `amber-*`, `zinc-*`, `emerald-*` etc. fora do AdminShell.
- Markup sempre por `fmtMarkup` (`src/lib/formato.ts:37`) → `+43%`; `text-success` se ≥ 0,
  `text-destructive` se < 0; `—` se null.
- Dinheiro por `fmtBRL(cents / 100)`; inteiros por `fmtInt`. Sem `toLocaleString` solto novo.
- `-0`: antes de formatar valores negados (`-refund_cents`, `-credit_cents`), usar `value || 0`.
- Migrations só por `supabase migration new` + `supabase db push` (ADR-0043); validar com
  `npm run db:check`. Funções edge: `supabase functions deploy platform-admin` e conferir a versão em
  `supabase functions list`.
- Testes: `.env.test` obrigatório para `pnpm test`. Duas árvores: `src/**/__tests__/` e `tests/`.
- Roteamento de modelo por tarefa está em cada tarefa. **Não descem de modelo:** T1, T2, T3, T4
  (migration, cobrança, semântica de pendência, alíquota).

## Comando de prova SQL (read-only, produção)

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
curl -s -X POST "https://api.supabase.com/v1/projects/txvncrgkoynoxwopfkbp/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select ..."}'
```

Somente `select`. IDs: Avil `a72ea303-5559-4a35-9aff-daa12cd1de12`, DSA
`a1fcd536-bb43-4fae-9f44-1e09d19e6c8e`, super-admin `1afa4a2a-701d-48c2-9dfb-8dedbd3e4b77`. Para
chamar RPCs `SECURITY DEFINER` que exigem `service_role`:
`with s as (select set_config('request.jwt.claims','{"role":"service_role"}',true) c) select ... from s`.

---

## Fase 0 — Decisão (feita)

- [x] ADR-0158 escrito em `docs/decisions/0158-central-carteira-agregada-e-pendencias.md`.
- [ ] **T0 (haiku, mecânico):** adicionar a linha do 0158 em
  `obsidian-vault/04-Decisões/Índice de ADRs.md`, logo após a linha do 0155, copiando o formato exato
  dessa linha (mesma célula de link relativo, só trocando o nome do arquivo para
  `0158-central-carteira-agregada-e-pendencias.md`). Título do link: "Carteira agregada, pendências
  de cobrança e alíquota explícita na central". Texto após o travessão: "ação `wallet` única,
  pendência = bloqueio da prévia, catálogo de custo por RPC, alíquota nunca presumida; corrige o
  contrato de `platform_resolve_terms`." Aceite: `pnpm docs:links` verde.

## Fase 1 — Backend e dados (opus, sem descer de modelo)

Dependências: T1 → T2 → T3 → T4 → T5 (deploy). Nada da Fase 3+ começa antes de T5 provado.

### T1 — `platform_resolve_terms` para de mentir; `close` recusa sem contrato (opus)

Objetivo: o blocker `commercial_terms_required` volta a existir e o fechamento sem condição falha com
mensagem de negócio.

Arquivos: nova migration `supabase/migrations/<ts>_platform_terms_contract_fix.sql` (via
`supabase migration new platform_terms_contract_fix`); `supabase/tests/platform_billing.sql`.

Fazer (na migration, `create or replace` das duas funções copiando o corpo atual de
`20260906170200_platform_billing.sql:99-297` e alterando só isto):
- `platform_billing_preview`: trocar `if not found then` (l.130) por `if v_terms.id is null then`.
- `platform_billing_close`: logo após `v_preview := public.platform_billing_preview(...)` (l.275), antes
  da checagem de revision, inserir
  `if v_preview->'terms' is null or jsonb_typeof(v_preview->'terms')='null' then raise exception 'commercial terms required' using errcode='23514'; end if;`
- `handler.ts:59`: mapear `/commercial terms required/i` para 422 com `code: 'commercial_terms_required'`.
  **Corrigido na execução (2026-09-07):** tem de ser o **primeiro** da cadeia, não "antes do 500" —
  `/forbidden|required/i` captura essa mensagem antes e devolve 403 (provado no RED). E a cadeia de
  `code` na mesma linha precisa do mesmo tratamento: sem isso o retorno vira
  `{ status: 422, code: 'internal_error' }`, e nem deno lint nem deno check acusam.

Teste (RED→GREEN, Postgres real): em `supabase/tests/platform_billing.sql` adicionar bloco "mês sem
contrato": org fixture sem `platform_commercial_terms` → `preview` deve ter
`blockers @> '[{"code":"commercial_terms_required"}]'`, `total_cents = 0` (não NULL),
`terms` JSON null; `close` deve lançar `commercial terms required`. Rodar como na verificação de
2026-09-06 (contêiner Docker + `psql -v ON_ERROR_STOP=1`). Antes da correção o bloco FALHA (RED).

Aceite: SQL test verde; `npm run db:check` verde; após `db push`, prova em produção:
`select p->'blockers'->0->>'code', p->>'total_cents' from ... platform_billing_preview(super, avil, '2026-09-01') p`
→ `commercial_terms_required`, `0`.

### T2 — Catálogo de custo por RPC + leitura enxuta de vendas + alíquota explícita (opus)

Objetivo: `readOrgMetrics` faz ≤ 5 round-trips por org, não lê `raw`, e nunca presume alíquota.

Arquivos: migration `<ts>_platform_org_cost_catalog.sql`;
`supabase/functions/_shared/platform-admin/metrics-repository.ts`;
`supabase/functions/_shared/platform-admin/__tests__/metrics-repository.test.ts`;
`supabase/tests/platform_commercial.sql` (teste da RPC).

Fazer:
1. RPC `public.platform_org_cost_catalog(p_org uuid, p_since timestamptz) returns table (id uuid,
   org_id uuid, custo numeric, peso_gramas numeric, ml_variation_id text, gtin text, codigo text,
   atualizado_em timestamptz, ml_item_id text, origem text)` — `language sql stable security definer
   set search_path=''`; `revoke all ... from public, anon, authenticated; grant execute to service_role`.
   Corpo: `variacoes v join familias f on f.id=v.familia_id` filtrando `v.org_id=p_org` e
   `exists (select 1 from ml_vendas_itens i join ml_vendas s on s.id=i.venda_id where s.org_id=p_org and
   s.date_closed >= p_since and (i.variation_id::text = v.ml_variation_id or i.ml_item_id = f.ml_item_id
   or i.ean = v.gtin or i.codigo = v.codigo))`. Conferir os tipos reais das colunas com
   `information_schema.columns` antes de escrever o `returns table` (tipos errados quebram o `db push`).
   Índice: se `EXPLAIN ANALYZE` na Avil passar de 300 ms, criar
   `create index ml_vendas_itens_venda_keys_idx on ml_vendas_itens(venda_id, ml_item_id, variation_id)`
   — só se medido.
2. `metrics-repository.ts:99-101`: trocar `select('*,itens:...,custos:...')` pela lista explícita de
   colunas de `src/lib/faturamento.ts:20` (copiar literalmente, incluindo os embeds com colunas).
3. `metrics-repository.ts:106-108`: substituir a leitura paginada de `variacoes` por
   `db.rpc('platform_org_cost_catalog', { p_org: orgId, p_since: startOf(seriesMonths[0]) })`. O tipo
   `MetricsDb` ganha `rpc(name, args): Promise<Page>`. Adaptar `montarMapasCusto` sem mudar
   `sales-costs.ts`: mapear cada linha para `{ ...row, familias: { ml_item_id: row.ml_item_id, origem: row.origem } }`.
4. Alíquota (ADR-0158 §6): `configAvailable` passa a ser `!configResult.error && config != null &&
   config.aliquotas_confirmadas_em != null` (adicionar a coluna ao `select` da l.110). Sem isso:
   `markup = null` e warning `Configuração tributária não confirmada`. Remover os defaults `: 8` / `: 16`
   das l.120-121 — com config confirmada as colunas são `not null`; se vierem null, `configAvailable=false`.
5. Warnings: remover o push incondicional de `'Métricas operacionais indisponíveis'` (l.140); o array
   começa vazio.

Testes (RED→GREEN): `metrics-repository.test.ts` — (a) fake db assert que `from('ml_vendas').select`
recebe string sem `*`; (b) `rpc` chamado com `platform_org_cost_catalog` e `p_since` do 1º mês da
série; (c) config ausente → `markup null` + warning; (d) config sem `aliquotas_confirmadas_em` →
idem; (e) config confirmada → markup calculado (fixture do teste de paridade: R$100/80/50/8 % →
0,44). SQL: em `platform_commercial.sql`, fixture com 2 variações (uma vendida, uma não) → RPC devolve
só a vendida; org B não vê variação de A.

Aceite: vitest + SQL verdes; em produção, `select count(*) from platform_org_cost_catalog(avil,
'2026-04-01T00:00:00-03:00')` ≪ 8 537 (esperado: centenas) e `explain analyze` < 300 ms.

### T3 — Ação `wallet`, pendência = blockers, Pulse sem contrato (opus)

Objetivo: uma chamada devolve totais + página; `pending_count` = `blockers.length`; `billable_units`
independe de contrato; `forecast` soma só quem tem condição.

Arquivos: `supabase/functions/_shared/platform-admin/repository.ts`, `handler.ts`, `types.ts`;
`__tests__/repository.test.ts`, `__tests__/handler.test.ts`.

Fazer:
- `types.ts`: `OrgSummary` ganha `blockers: number | null` (mantém `pending_count` = mesmo valor; não
  duplicar — renomear `pending_count` para o significado novo e apagar o count Sonar). Novo tipo
  `WalletTotals = { gross_cents: Cents|null; forecast_cents: Cents|null; orgs_without_terms: number;
  org_count: number; pending_count: number|null; orders: number|null; warnings: string[] }` e
  `Wallet = Page<OrgSummary> & { totals: WalletTotals }`.
- `repository.ts:69-80` `enrichOne`: remover o count `state='pending'` (l.73); `pending_count =
  preview ? preview.blockers.length : null`; `billable_units = preview?.sonar_units ?? null`;
  `forecast_cents = preview && preview.terms && preview.blockers.length === 0 ? preview.total_cents : null`;
  `modality = preview?.terms?.modality ?? null`. Manter o count `daludi`.
- Novo método `wallet(actorId, input)` = corpo de `list` + totais calculados sobre `summaries`
  (todas, antes de paginar): `gross_cents` só se todas têm `metrics`; `forecast_cents` = soma das que
  têm `forecast_cents !== null`, `orgs_without_terms` = nº com `modality === null`; `orders` = soma de
  `metrics.orders` (null se alguma sem metrics); `pending_count` = soma (null se alguma null);
  `warnings` = `['Métricas indisponíveis para parte da carteira']` quando `gross_cents` null.
  Remover `list` e `overview`.
- `handler.ts`: `ACTIONS` troca `list`/`overview` por `wallet`; validação igual à de `list`.
  `handler.test.ts:13,38-62`: atualizar os nomes (`list`→`wallet`, remover `overview`).
- `repository.test.ts:57` `preview(...)` fixture: acrescentar caso `terms: null` com blocker
  `commercial_terms_required` → `forecast_cents null`, `billable_units 2`, `pending_count 1`,
  `modality null`; totais: 1 org com contrato + 1 sem → `forecast_cents` = só a primeira,
  `orgs_without_terms 1`.

Aceite: vitest verde; `deno check` dos 3 módulos; `platform-admin` continua respondendo
`organization`, `metrics`, `terms`, `save_terms`, `preview`, `close`, `statements`, `statement`,
`reconcile_revenue`, `pulse_usage`, `audit`.

### T4 — Nome de quem agiu (Pulse/Auditoria) (opus, pois toca `profiles`; pequeno)

Objetivo: `actor_name` deixa de ser `null` fixo.

Arquivos: `repository.ts:132,150-152`; `__tests__/repository.test.ts`.

Fazer: em `pulseUsage` e `audit`, após montar `rows`, coletar `actor_id`s distintos e ler
`db.from('profiles').select('id,nome').in('id', ids)` (1 round-trip; conferir o nome real da coluna
de nome em `profiles` via `information_schema` antes — se for `display_name`/`full_name`, usar esse).
Preencher `actor_name`; falha da leitura → manter `null` (não derrubar a página).

Teste: fake db devolve 2 perfis → linhas com nome; erro → null.

### T5 — Deploy e prova (opus)

- `rtk supabase db push` (worktree precisa de `supabase link` antes) → `npm run db:check`.
- `rtk supabase functions deploy platform-admin` → `supabase functions list` mostra versão 2+.
- Prova SQL: preview Avil 2026-09 → 1 blocker `commercial_terms_required`, `total_cents 0`; Avil
  2026-08 → 7 blockers (1 contrato + 6 devoluções); DSA 2026-08 → 4.
- Prova de volume: `platform_org_cost_catalog(avil, '2026-04-01T00:00:00-03:00')` count e tempo.
- Registrar no relatório: nº de round-trips esperado por chamada `wallet` (Avil: vendas 3 + catálogo 1
  + config 1 + preview 1 + daludi 1 = 7; DSA: 5; + 1 orgs = 13).

Frontend antigo continua funcionando neste ponto? NÃO — `overview`/`list` deixam de existir. Por isso
T5 e T6 entram no **mesmo PR/merge**; não mergear T5 sozinho.

## Fase 2 — Camada de dados do frontend (sonnet)

### T6 — `usePlatformWallet`, tipos e debounce (sonnet)

Arquivos: `src/hooks/usePlatformAdmin.ts`, `src/lib/platform-admin.ts` (reexport de tipos),
`src/pages/Organizacoes.tsx` (só a troca de hook; o redesign é T8), `src/lib/__tests__/platform-admin.test.ts`.

Fazer:
- Remover `usePlatformOverview`/`usePlatformOrganizations` e `platformAdminKeys.overview/organizations`;
  criar `platformAdminKeys.wallet(userId, params)` com key `['platform-admin', userId, 'wallet', null,
  month, filters]` e `usePlatformWallet(params: { month, search?, include_test?, page?, page_size?,
  sort? })` → `useQuery<Wallet>`.
- `invalidateBilling` (l.199-200): invalidar `['platform-admin', userId, 'wallet', null, month]` no
  lugar de overview+list.
- Debounce da busca: em `Organizacoes.tsx`, `const [searchInput, setSearchInput] = useState('')` +
  `useEffect` com `setTimeout(300)` que copia para `search` (o que entra na key). Sem lib nova.
- `sort` aceito: `'name' | 'slug' | 'gross_desc'` (servidor). A UI (T8) mapeia clique no cabeçalho
  para esses três; outras colunas não ordenam.

Teste: `platform-admin.test.ts` cobre `callPlatformAdmin('wallet', ...)` e erro não-2xx preservando
`code`. `pnpm exec tsc -b --force` verde.

## Fase 3 — Carteira (sonnet)

Régua visual: `src/pages/Estoque.tsx`, `src/components/estoque/{resumo-estoque,barra-filtros-estoque,produto-card}.tsx`,
`src/pages/Dashboard.tsx:58-96` (HeroVenda), `src/pages/PulseSonar.tsx:558-640` (DataTable +
stickyRight), `src/components/dashboard-pendencias.tsx` (faixa de atenção).

### T7 — Descrições de KPI (haiku, mecânico)

Arquivos: `src/lib/kpi-descriptions.ts`, `src/lib/__tests__/kpi-descriptions.test.ts` (`ALL_EXPECTED_KEYS`).

Adicionar exatamente estas 4 chaves (texto já verificado, transcrever):
- `'Faturamento bruto da carteira'`: `Soma do faturamento bruto de todas as organizações no mês selecionado (vendas pagas e reembolsadas, antes de taxas; canceladas fora). Mês-calendário em America/Fortaleza.`
- `'Previsão de cobrança'`: `Total previsto dos demonstrativos do mês, somando só organizações com condição comercial vigente e sem bloqueio. Organizações sem contrato ficam fora do total.`
- `'Pendências da carteira'`: `Bloqueios que impedem fechar o demonstrativo: condição comercial ausente, devolução sem conciliação ou venda alterada após fechamento.`
- `'Organizações da carteira'`: `Organizações ativas na plataforma. Ambientes de teste ficam ocultos por padrão e fora dos totais.`

Aceite: teste `kpi-descriptions` verde.

### T8 — `Organizacoes.tsx` reescrito (sonnet)

Objetivo: carteira no design system, sem "Indisponível", sem código morto, com 1 chamada.

> **Corrigido na execução (2026-09-07, achados da T3):**
> 1. Esta spec **não renderiza `totals.warnings` em lugar nenhum** — nem
>    `'Prévia indisponível para parte da carteira'` nem o de métricas chegariam à tela. Renderize os
>    warnings do `wallet` como itens da faixa "Precisa da sua atenção" (ou, se não forem acionáveis,
>    como `hint` sob o hero). Um aviso que não aparece é pior que não existir: a falha de prévia fica
>    indistinguível de "org sem contrato".
> 2. O tipo `Wallet` (exportado por `src/lib/platform-admin.ts`) **colide com o ícone `Wallet` do
>    lucide-react** usado no KpiCard "Previsão de cobrança". Não renomeie o tipo — importe o ícone com
>    alias (`Wallet as WalletIcon`).
> 3. `totals.forecast_cents` nunca vem `null` na prática (é soma das não-nulas, `0` quando nenhuma
>    qualifica); o branch `—` do hero/KPI por `null` é inalcançável — use `orgs_without_terms` para
>    decidir o `hint`, não o null.

Arquivos: `src/pages/Organizacoes.tsx`; `src/pages/__tests__/Organizacoes.test.tsx`.

Apagar: `ExcluirOrgDialog`, `CanaisOrgDialog`, `ModulosOrgDialog`, `callUsuarios`, estados
`delOrg/canaisOrg/modulosOrg`, `unavailable`, `coverage()`, `evolution()` como strings. Canais e
Módulos já existem na aba Configurações; exclusão está desabilitada no backend (how-to) — não criar
"Zona de risco".

Estrutura (de cima para baixo), tudo dentro de `<div className="mx-auto max-w-7xl p-4 lg:p-6">`:

1. `PageHeader title="Organizações" subtitle="Carteira financeira e operacional da plataforma."`
   `actions` = `<label htmlFor="wallet-month" className="flex items-center gap-2 text-sm"><span>Mês</span><Input id="wallet-month" type="month" aria-label="Mês da carteira" …/></label>` + `Button` "Nova empresa" (mantém `NovaOrgDialog`).
2. Faixa de KPIs `mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5`:
   - Hero **Faturamento bruto** (`col-span-2 sm:col-span-3 lg:col-span-2`): copiar a estrutura de
     `HeroVenda` (`Dashboard.tsx:58-96`) como bloco local `HeroCarteira` (não linkável: `div`, sem
     hover-translate). Rótulo `text-xs text-info` com `Receipt` + `KpiInfoButton infoKey="Faturamento bruto da carteira"`;
     valor `text-3xl font-bold tabular-nums` = `fmtBRL(totals.gross_cents/100)` ou `—`;
     delta só quando TODAS as linhas têm `metrics.previous.gross_cents > 0`: soma dos previous →
     `ArrowUp`/`ArrowDown` `text-success`/`text-destructive` + `±N,N%` + `text-xs text-muted-foreground`
     "vs. mesmo período do mês anterior"; sub `text-xs text-muted-foreground`
     `"{org_count} organizações · {fmtInt(totals.orders)} pedidos"`. Loading: `Skeleton h-9 w-40`.
   - `KpiCard label="Previsão de cobrança" icon={Wallet} infoKey="Previsão de cobrança"`
     value = `fmtBRL` ou `—`; `hint` = `orgs_without_terms > 0 ? \`${n} sem condições — fora do total\` : undefined`.
   - `KpiCard label="Pendências" icon={AlertTriangle} infoKey="Pendências da carteira"`
     value = `fmtInt` ou `—`; `tom="warning"` e `valueClassName="text-warning"` se > 0; `onClick`
     alterna o filtro "Com pendências"; `ativo` reflete o filtro.
   - `KpiCard label="Organizações" icon={Building2} infoKey="Organizações da carteira" className="col-span-2 sm:col-span-1"`
     value = `fmtInt(org_count)`; `hint` = nº de teste ocultas (`rows` com `is_test` quando
     `!includeTest` não vem do servidor — usar `totals.org_count` vs. página; se não houver dado, sem hint).
   - Todos com `loading={wallet.isLoading}`.
3. Faixa "Precisa da sua atenção" — copiar a marcação de `dashboard-pendencias.tsx:13-27` (h2
   `mb-2 text-sm font-medium text-muted-foreground`; item `flex items-center justify-between gap-3
   rounded-xl border border-warning/40 bg-warning/5 px-4 py-3` com `AlertTriangle h-4 w-4 text-warning`).
   Itens: por org com `modality === null` → texto `"{nome} sem condições comerciais"` + `Button size="sm" variant="outline"` "Cadastrar" → `/admin/organizacoes/{id}?mes={month}&aba=cobranca`;
   por org com `pending_count > 0` (e com contrato) → `"{nome}: {n} pendência(s) de cobrança"` + "Ver" → mesma rota;
   por `request.status === 'approved'` com `canStart` → `"Acesso a {nome} aprovado — expira {hh:mm}"` + "Entrar na operação".
   Some quando vazia. Só renderiza com dados carregados.
4. Toolbar SEM Card, `mb-3 flex flex-wrap items-center gap-2`: busca `relative w-full sm:w-auto
   sm:flex-1 sm:max-w-sm` com `Search` absoluto `left-2.5 top-1/2 h-4 w-4 -translate-y-1/2
   text-muted-foreground` e `Input className="pl-8" aria-label="Buscar organizações"`; segmented
   `role="group" aria-label="Filtrar organizações" className="flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5"`
   com `Button size="sm" className="h-7" variant={ativo?'secondary':'ghost'} aria-pressed` "Todas" |
   "Com pendências" (filtro client-side sobre a página: `pending_count > 0 || modality === null`);
   `ml-auto` `label` com `Checkbox id="include-test-organizations"` "Incluir testes". Remover o
   `<select>` de ordenação. Linha `mb-2 text-xs text-muted-foreground`
   `"{total} organizações · ordenadas por {faturamento|nome|slug}"`.
5. Erro: se `wallet.isError` → faixa padrão com "Não foi possível carregar a carteira." + `Button
   variant="outline" size="sm"` "Tentar novamente" (`role="alert"` mantido).
6. `DataTable<OrgSummary>` `className="bg-card"` (a prop pública é `className`; o componente já
   aplica `rounded-lg border` — `data-table.tsx:85`), `rowKey={o=>o.id}`, `loading={wallet.isLoading}`,
   `skeletonRows={3}`, `onRowClick={o=>navigate(\`/admin/organizacoes/${o.id}?mes=${month}\`)}`,
   `defaultSort={{key:'gross',dir:'desc'}}`, `empty=` `EmptyState icon={Building2} title="Nenhuma organização encontrada"`
   (com termo de busca: `rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground`
   "Nenhuma organização para “{termo}”"). Ordenação: o `DataTable` ordena a página localmente por
   `sortValue`; além disso, ao mudar a coluna ordenada para `nome`/`gross`, chamar `setSort('name'|'gross_desc')`
   e `setPage(1)` para o servidor acompanhar (colunas sem `sortValue` não ordenam). Colunas (na ordem):

   | key | header | className | cell |
   |---|---|---|---|
   | `nome` | Organização | `min-w-[14rem]` | `Link to=… className="font-medium hover:underline" aria-label={\`Ver organização ${nome}\`}` com `onClick={e=>e.stopPropagation()}`; linha 2 `text-xs text-muted-foreground` `"{slug} · Modalidade {n}"` ou `StatusPill tone="warning"` "Sem condições"; `Badge variant="outline"` "Teste" se `is_test`; `StatusPill tone="info"` "Acesso ativo" / `neutral` "Aguardando aprovação" conforme `request.status` |
   | `gross` | Faturamento | `w-[9.5rem] text-right tabular-nums` | `font-semibold` `fmtBRL`; linha 2 `text-xs` com `ArrowUp/Down` e `%` (`text-success`/`text-destructive`) se `previous.gross_cents > 0`, senão nada; sem `metrics` → `—` `title="Métricas indisponíveis"` |
   | `markup` | Markup | `w-[6rem] text-right tabular-nums hidden md:table-cell` | `fmtMarkup` colorido; `—` `title="Sem custo ou alíquota confirmada"` |
   | `coverage` | Cobertura | `w-[7rem] text-right tabular-nums hidden lg:table-cell` | `"{pct}%"` + `text-xs text-muted-foreground` `"{total_orders} ped."`; `text-warning` 70–95, `text-destructive` < 70; `—` `title="Sem pedidos no mês"` se `total_orders === 0` |
   | `pulse` | Consultas Pulse | `w-[7rem] text-right tabular-nums hidden lg:table-cell` | `fmtInt`; `0` em `text-muted-foreground`; `—` se null |
   | `forecast` | Previsão | `w-[8.5rem] text-right tabular-nums` | `font-medium` `fmtBRL`; `—` `title="Sem condições comerciais"` (modality null) ou `title="Bloqueada por pendências"` (pending > 0) |
   | `pending` | Pendências | `w-[6rem] text-right` | `0` → `—`; `>0` → `StatusPill tone="warning"` com o número |
   | `acoes` | `<span className="sr-only">Ações</span>` | `stickyRight w-[3rem]` | quando `canStart`: `Button size="sm"` "Entrar na operação"; sempre: `DropdownMenu` em `Button variant="ghost" size="icon-sm" aria-label="Ações"` (`MoreHorizontal`) com itens: "Ver organização" (link), "Solicitar acesso"/"Solicitar renovação"/"Cancelar solicitação" (mesma lógica atual de `canStart/canRenew/pending`), separador, "Configurações" (link `?aba=configuracoes`). Todo o td com `onClick={e=>e.stopPropagation()}` |

   Sem versão em cards para mobile.
7. Paginação: `Pagination` de `src/components/ui/pagination.tsx` com `tamanhos={[PAGE_SIZE]}`,
   `rotuloItem="organizações"`, só renderizada se `total > PAGE_SIZE`.
8. `SupportRequestDialog` e `NovaOrgDialog` mantidos como estão.

Testes (`Organizacoes.test.tsx`): mock troca `overview`+`list` por `wallet` devolvendo
`{ totals, rows, total, page, page_size }`; l.166 vira `expect(screen.queryByText('Indisponível')).toBeNull()`
e `expect(screen.getByText('+43%')).toBeInTheDocument()` para markup `0.43`; novo caso: org com
`modality null` mostra pill "Sem condições" e item "Cadastrar" na faixa; novo caso: `pending_count 2`
mostra pill "2". Os demais casos (l.102-180) permanecem e devem passar sem alteração de rótulo.
"Solicitar acesso" agora está dentro do `DropdownMenu`: no teste, abrir o menu por
`getByRole('button', { name: 'Ações' })` antes de clicar.

Aceite: `pnpm test src/pages/__tests__/Organizacoes.test.tsx` verde; `pnpm lint`; nenhum
`Indisponível`, `amber-`, `Carregando…` em `Organizacoes.tsx` (`grep` vazio).

## Fase 4 — Detalhe (sonnet)

Dependência: T3 (tipos), T4 (nomes), T6 (hooks). Uma tarefa por aba; podem rodar em paralelo após T9.

### T9 — Cabeçalho do detalhe e abas (sonnet)

Arquivos: `src/pages/OrganizacaoDetalhe.tsx`; `src/pages/__tests__/OrganizacaoDetalhe.test.tsx`.

Fazer: `PageHeader title={org.nome}` (heading mantém o nome) com `subtitle` = linha de fatos:
`"{slug} · Modalidade {n} · {humanPercent(revenue_bps)} sobre receita"` quando `preview.terms`
(usar `usePlatformPreview(orgId, month)` já existente), senão `StatusPill tone="warning"`
"Sem condições comerciais" + `Link` "Cadastrar em Cobrança" (`?aba=cobranca`). `Badge` "Ambiente de
teste" ao lado do título. `actions` = `label` "Mês" (`aria-label="Mês da organização"`) + botão de
suporte (mover de `org-settings.tsx` a lógica `canStart`/pending/renovação: "Entrar na operação" |
"Solicitar acesso" | "Cancelar solicitação"; o formulário de solicitação vem para um `Dialog` igual ao
`SupportRequestDialog` de `Organizacoes.tsx` — extrair para
`src/components/platform-admin/support-request-dialog.tsx` e usar nos dois lugares). Loading:
`Skeleton className="h-8 w-64"`; erro: heading "Organização indisponível" + faixa padrão. Remover o
banner `isStale` (l.80-84). `TabsList` sem `variant="line"` (pill, como `Faturamento.tsx:55-75`) com
ícones `BarChart3`/`Radar`/`Receipt`/`ScrollText`/`Settings2`; badge de contagem (mesma marcação de
`Faturamento.tsx:61-63`) em "Cobrança" = `preview.blockers.length` quando > 0.

Teste: heading com nome; badge; pill "Sem condições comerciais" quando `terms null`; badge "1" na aba
Cobrança com 1 blocker; nenhum texto "pode estar desatualizado".

### T10 — Aba Resultados (sonnet)

Arquivo: `src/components/platform-admin/org-results.tsx`.

Fazer: loading → 4 `KpiCard size="compact" loading`; erro → faixa padrão + "Tentar novamente".
4 `KpiCard size="compact"`: Faturamento bruto (`Receipt`, `delta` = `±N,N%` vs `previous` com
`deltaTrend`, `hint` "vs. mesmo período do mês anterior"), Pedidos (`ShoppingBag`, `fmtInt`), Ticket
médio (`Tag`), Markup (`TrendingUp`, `fmtMarkup`, `valueClassName` success/destructive, `hint`
`"{covered}/{total} pedidos com custo"`; `—` + `hint="Sem custo ou alíquota confirmada"` se null).
Gráfico: `Card` com `CardHeader` > `CardTitle` "Evolução de seis meses" + `CardDescription`
"Faturamento bruto por mês-calendário"; `Skeleton className="h-64"` no loading; série vazia →
`EmptyState`. Card "Operação": `dl` no padrão `Composition` (`org-billing.tsx:69-75`) com Período
anterior (`title` "Mesmo tempo decorrido do mês anterior"), Variação absoluta, Cobertura de custo.
Remover Pendências/Anúncios ativos/Publicações e o banner âmbar (l.96-100): esses campos ficam fora
(ver "Fora da entrega"). Remover `unavailable`. `warnings` renderizadas como faixa
`border-warning/40 bg-warning/5` só quando não vazias. Remover banner `isStale`.

Teste: `org-results` (criar `__tests__/org-results.test.tsx`): markup `0.44` → "+44%"; null → "—";
sem "Indisponível".

### T11 — Aba Pulse (sonnet)

Arquivo: `src/components/platform-admin/org-pulse.tsx`.

Fazer: 5 `KpiCard size="compact"` (Unidades do cliente `Radar`; Consultas Daludi `Users`; Falhas
`XCircle` com `tom="danger"` se > 0 senão `success`; Reaberturas `RotateCcw`; Custo medido `Coins`
valor `—` `hint="Sem medição do fornecedor"`). `DataTable` única (apagar o bloco `md:hidden`):
colunas Data (`new Date(at).toLocaleString('pt-BR')`), Consulta (`font-medium` + `text-xs` tipo),
Pessoa (`actor_name ?? actor_id`), Origem (`StatusPill` `info` "Daludi" / `neutral` "Cliente"),
Resultado (`StatusPill` success `completed`/danger `failed`/neutral outros — mapear os valores reais
de `state` em `20260906170100_platform_sonar_metering.sql:21-38`), Unidades (`text-right tabular-nums`),
Isenção (`—` se null). `empty` = `EmptyState icon={Radar} title="Nenhuma consulta no período"`.
`Pagination` de `ui/pagination.tsx` só se `total > page_size`. Remover `isStale`, `unavailable`.

### T12 — Aba Cobrança + formulário de condições (sonnet)

Arquivos: `src/components/platform-admin/org-billing.tsx`, `commercial-terms-form.tsx`,
`__tests__/org-billing.test.tsx`, `__tests__/commercial-terms-form.test.tsx`.

Fazer:
- **Renderizar `CommercialTermsForm`** aqui (fecha o BLOQUEADOR 1): card "Condições comerciais"
  acima da prévia; `current` = `usePlatformTerms(orgId).data.rows` filtrado `starts_on <= hoje
  (Fortaleza)` ordenado por `starts_on desc, version desc` `[0] ?? null`; `onSaved` = `refetch` da
  prévia + toast `✓ Condições salvas`. Quando `current` existe, o card abre colapsado
  (`details`/`summary` nativo com a linha de fatos; sem lib).
- `CardDescription` da prévia com `StatusPill`: `success` "Pronta para fechar" | `warning`
  "Bloqueada · {n}" | `info` "Mês em aberto" | `warning` "Sem condições". Botão "Fechar demonstrativo"
  desabilitado ganha `title` com o motivo (mesma string da pill).
- Bloqueios: `AlertTriangle h-4 w-4 text-warning` + mensagem + `order_ref` quando houver; botão
  "Conciliar devolução" quando `candidateFrom` retorna candidato.
- `Composition`: `-0` protegido (`value || 0`); rótulo "Total do snapshot" → "Total"; `humanPercent`
  null → "—".
- `message` (l.89, 105, 111, 114, 161) vira `toast.success`/`toast.error`; remover o `<p role="status">`.
  O teste `org-billing.test.tsx` que espera "A prévia mudou…" passa a esperar o toast (mock `sonner`
  como nos outros testes do app).
- Demonstrativos: `EmptyState icon={FileText} title="Nenhum demonstrativo fechado"`; item mantém
  `BotaoExportar`.
- Loading: `Skeleton h-14 rounded-lg` ×3; erro: faixa padrão.

Testes: form renderizado com `terms rows: []` → "Salvar condições" visível; pill "Sem condições";
blocker `commercial_terms_required` listado; com `terms` e `blockers: []` e mês passado → botão
habilitado e pill "Pronta para fechar".

### T13 — Aba Auditoria (sonnet)

Arquivo: `src/components/platform-admin/org-audit.tsx`.

Fazer: toolbar sem Card (`mb-3 flex flex-wrap items-center gap-2`): `Select` shadcn
(`src/components/ui/select.tsx`) para Categoria (Todas/Administração/Cobrança/Pulse/Suporte),
`Input` Responsável (placeholder "ID do usuário"), `Input` Resultado. `DataTable` única (apagar
`md:hidden`): Data, Categoria (`StatusPill neutral`), Ação em `<code className="text-xs">`,
Responsável (`actor_name ?? actor_id ?? 'Sistema'`), Resultado (`StatusPill` success para
`success`, danger para `failed|error|denied`, neutral outros), Alvo (`—`), Detalhes = `Popover` com
`Button variant="ghost" size="sm"` "Ver" e `<pre className="max-w-sm whitespace-pre-wrap text-xs">`
`JSON.stringify(details, null, 2)`; `reason` abaixo em `text-xs text-muted-foreground`. `empty` =
`EmptyState icon={ScrollText} title="Nenhum evento encontrado"`. `Pagination` condicional. Remover
`isStale`.

### T14 — Aba Configurações (sonnet)

Arquivo: `src/components/platform-admin/org-settings.tsx`.

Fazer: `Select` shadcn no lugar dos `<select>` nativos (l.162, 262); cada card com seu próprio estado
`saving`/`saved`/`error`: sucesso = `toast.success('✓ Salvo')` + `span className="text-xs text-success"`
"✓ Salvo" inline no rodapé do card por 3 s; erro = faixa padrão dentro do card. Apagar `setError(success)`
(l.101) e o `<p>` de rodapé da grade (l.282). Card "Suporte operacional" é removido daqui (migrou para o
cabeçalho em T9). Não criar "Zona de risco" (exclusão desabilitada no backend).

Teste: `commercial-terms-form.test.tsx` não muda; criar caso simples em `OrganizacaoDetalhe.test.tsx`
de que a aba Configurações renderiza sem "Suporte operacional".

## Fase 5 — Docs, validação e entrega (sonnet; T16 haiku)

### T15 — Docs (sonnet — conteúdo factual)

- `docs/how-to/central-organizacoes.md`: remover a nota "não promovida para produção"; seção
  "Cadastrar ou renegociar condições" passa a apontar para a aba **Cobrança**; "Pendências" definida
  como bloqueios da prévia; markup exibido como percentual (`+43%`); remover "Markup fica indisponível"
  → "aparece como —". Adicionar "Limitações": contagens operacionais e custo medido do fornecedor não
  são exibidos nesta versão.
- `docs/reference/edge-functions.md:97-103`: ações de `platform-admin` (`wallet` no lugar de
  `overview`/`list`).
- `docs/reference/modelo-de-dados.md:71-80`: novas migrations (`platform_terms_contract_fix`,
  `platform_org_cost_catalog`).
- `docs/project-status.md` e `docs/TASKS.md`: registrar a entrega.
- `obsidian-vault/06-Roadmap/Sprint Atual.md`: uma linha.

### T16 — Validação visual (haiku só para rodar o roteiro; leitura do resultado é do revisor)

Roteiro com a skill `playwright-cli`, conta `VALIDATION_*`, dados injetados por `route` (memória:
`reference_validacao_dados_injetados.md`), viewports 390×844 e 1440×900, screenshots reais (não só
snapshot de acessibilidade) de: carteira com 2 orgs (uma sem contrato, uma com 2 pendências); detalhe
aba Resultados; aba Cobrança sem contrato (form aberto) e com contrato (colapsado). Checar: sem scroll
horizontal do body em 390; coluna Ações fixa; nenhum "Indisponível"/"Carregando…"; tabulação chega
ao link do nome e ao botão "Ações".

### T17 — Entrega (sonnet)

`pnpm lint` → `pnpm test` → `pnpm exec tsc -b --force` → `pnpm build` → `pnpm docs:links` (os 4
passos do pré-push) → push → CI verde (`frontend`, `backend-lint`) → merge fast-forward na `main` →
deletar branch, remover worktree, `git pull` na main local. Edge já deployada em T5 — conferir de novo
`supabase functions list` (versão) depois do merge. Prova final em produção: preview Avil 2026-09
com blocker; `wallet` medido no navegador (Network: 1 chamada `platform-admin` por render).

## Validação por fase

| Fase | Comandos | Prova externa |
|---|---|---|
| 1 | vitest dos `__tests__/platform-admin`, SQL tests no Docker, `deno check`, `npm run db:check`, `db push`, `functions deploy` | SQL de prova (T5) |
| 2 | `pnpm test src/lib/__tests__/platform-admin.test.ts`, `tsc -b --force` | — |
| 3 | `pnpm test src/pages/__tests__/Organizacoes.test.tsx src/lib/__tests__/kpi-descriptions.test.ts`, `pnpm lint` | screenshots 390/1440 |
| 4 | `pnpm test src/components/platform-admin src/pages/__tests__/OrganizacaoDetalhe.test.tsx` | screenshots das abas |
| 5 | pré-push completo + `pnpm docs:links` | CI verde, `supabase functions list` |

## Riscos e o que pode quebrar

- **`platform_billing_close`** passa a recusar sem contrato (T1). Não há demonstrativo fechado em
  produção (0 linhas), então nenhum histórico é afetado. O teste SQL de fechamento existente usa
  fixtures com contrato — deve continuar verde.
- **Contrato de testes do frontend**: `Organizacoes.test.tsx:166` ("Indisponível") e o mock de
  `overview`/`list` mudam de propósito; os rótulos listados em "Constraints" não podem mudar. "Solicitar
  acesso" sai de botão visível para item de `DropdownMenu` — o teste precisa abrir o menu primeiro.
- **`readOrgMetrics` alíquota (T2)**: conferido em 2026-09-07 — as duas orgs têm
  `aliquotas_confirmadas_em` preenchido (Avil 2026-07-21, DSA 2026-08-27), então o markup atual não
  muda. Uma 3ª org sem confirmação verá `—` até salvar Configurações no app — comportamento decidido
  (ADR-0158 §6). Reconferir antes do deploy: `select org_id, aliquotas_confirmadas_em from configuracoes`.
- **Coluna de nome em `profiles` (T4)**: é `nome` (conferido em produção); usar essa.
- **RPC de catálogo (T2)**: cobre só chaves que casam com itens vendidos; item sem nenhuma chave
  continua sem custo (igual a hoje). Diferença possível de markup em relação ao app só se o app
  resolver custo por uma variação NÃO vendida — impossível por construção.
- **React-query**: key nova `wallet`; invalidações em `useSavePlatformTerms`/`useClosePlatformStatement`
  precisam apontar para ela, senão a carteira fica velha após salvar condições (staleTime 30 s cobre,
  mas o teste deve cobrir a invalidação).
- **ADR-0038**: não tocado (markup continua no agregador compartilhado). Se alguém propuser SQL,
  parar e abrir ADR.
- **`DataTable` ordenação local × servidor**: a página é paginada no servidor; ordenar localmente só a
  página é inconsistente com "Maior faturamento". Por isso T8 sincroniza a coluna com `sort` do
  servidor e reseta a página; com ≤ 10 orgs o efeito é invisível, mas o contrato fica certo.
- **Edge sem `raw`**: `normalizeSales` filtra `row.org_id === orgId` — `org_id` precisa continuar no
  `select` explícito (a lista de `buscarVendas` não o inclui: acrescentar `org_id`).

## Fora desta entrega (e por quê)

- **Contagens operacionais** (anúncios ativos, publicações, pendências de operação) e **custo medido
  do fornecedor**: nunca foram implementados; são feature nova que exige definir a fonte (registro
  ADR-0077) e medição do fornecedor. A UI deixa de prometê-los (T10/T11 mostram `—`/removem).
- **Busca Sonar por EAN fora do ledger** (`pulse-sonar-ean` não chama `platform_sonar_begin`): decisão
  comercial (ADR-0155 diz que EAN vale 1 unidade). Abrir issue `ready-for-human` para Diego decidir.
- **Cache de métricas no edge**: rejeitado no ADR-0158; reavaliar com medição após T5.
- **Exclusão de organização** (`delete_org` desabilitado): fora, conforme how-to.
- **Gateway/Pix/envio de cobrança**: fora (ADR-0155).
