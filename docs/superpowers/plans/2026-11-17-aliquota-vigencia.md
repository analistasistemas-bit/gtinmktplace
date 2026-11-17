# Alíquota com vigência — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma mudança de alíquota de imposto vale só para vendas a partir do momento do save. Vendas anteriores mantêm a alíquota da época.

**Architecture:**
- Tabela nova `aliquotas_vigencia`, alimentada por trigger em `configuracoes`.
- `montarAliquotaResolver` recebe as vigências e o resolver passa a receber a data da venda.
- `fetchAliquotas` (front) e `loadConfigState` (edges) carregam as vigências. As 9 telas que usam `useAliquotas` não mudam.
- A precificação (publicar, calculadora, kits, promoções) continua usando a alíquota atual.

**Tech Stack:** Postgres/Supabase (migration + trigger + RLS), TypeScript compartilhado front/Deno (`supabase/functions/_shared/platform-admin/`), React Query, vitest.

**Spec:** `docs/decisions/0208-aliquota-com-vigencia.md` (ler antes de começar).

**Classificação:** CRÍTICA, porque mexe em dado financeiro e cria migration.
- Revisão independente obrigatória antes do merge: subagente Opus effort high, ou `codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only … < /dev/null`, com modelo diferente do autor.
- Nunca rebaixar o modelo de quem implementa (Sonnet ou superior).

## Global Constraints

- Migration **só** via `supabase migration new aliquotas_vigencia` + `supabase db push`. Validar com `npm run db:check`. Nunca `apply_migration` nem o painel (ADR-0043).
- Imposto nunca é presumido em silêncio (ADR-0055/0086). Sem config confirmada continua `null`. A vigência não cria default.
- Data da venda para a vigência = `date_closed ?? date_created`.
  - As consultas de vendas já filtram por `date_closed` (`src/lib/faturamento.ts:25`, `metrics-repository.ts:735`), então na prática é sempre `date_closed`. O `?? date_created` é só defesa.
  - Comparação sempre por `Date.parse` (instante absoluto). UTC e `-03:00` do mesmo instante dão o mesmo resultado.
- Regra de escolha: a vigência mais recente com `vigente_desde <= data`. Se a data for anterior a todas, vale a mais antiga.
- **Histórico vazio ≠ leitura com falha** (Codex, CRÍTICO).
  - Lista vazia: org que nunca confirmou a alíquota. Valem as alíquotas atuais, como hoje.
  - Falha na leitura das vigências **nunca** cai na alíquota atual, porque isso reaplicaria 6,5% às vendas antigas:
    - no front, `fetchAliquotas` lança o erro;
    - nas edges, `configErrored = true`, o que impede materializar o mês e o envio gerencial com lucro.
- Precisão do instante: o trigger grava `date_trunc('milliseconds', clock_timestamp())`, nunca `now()`, que é o início da transação e fica fora de ordem em saves concorrentes. Isso combina com a precisão de `Date.parse`.
- ADR-0112 continua igual dentro de cada vigência: a alíquota interna só vale com `uf_empresa` e `interna_pct` preenchidos, e sobrepõe nacional e importado.
- Testes: `pnpm test` exige `.env.test`. Na worktree, copiar `.env.local` e `.env.test` do checkout principal e fazer `pnpm install` real, nunca symlink de `node_modules`.
- `pnpm test -- arquivo` roda a suíte toda. Para rodar um arquivo só, usar `pnpm vitest run <arquivo>`.
- Git na worktree: `/usr/bin/git`.

## Review Focus

1. **Venda exatamente no instante da troca** (`data === vigente_desde`): usa a vigência nova (`<=`). Teste na Task 2.
2. **Mesmo instante em fusos diferentes** (`2026-11-17T09:40:00-03:00` e `…12:40:00Z`): mesmo resultado. Teste na Task 2.
3. **Org sem nenhuma vigência** (vigências não carregaram ou lista vazia): mesmo número de hoje. Teste na Task 2.
4. **Mês fechado da Central/relatório não muda** quando a alíquota de hoje muda. Teste na Task 4, pelo `taxConfigStamp` e pelo cálculo do mês com duas vigências.
5. **Salvar sem mudar valor** não cria vigência nova. Também conta para o save que só muda `aliquotas_confirmadas_em`. Teste SQL na Task 1.

---

### Task 1: Tabela, trigger, RLS e backfill

**Files:**
- Create: `supabase/migrations/<timestamp>_aliquotas_vigencia.sql` (via `supabase migration new aliquotas_vigencia`)
- Modify: `src/lib/database.types.ts`: adicionar `aliquotas_vigencia` (Row, Insert, Update) seguindo o formato das outras tabelas.

**Interfaces:**
- Produces: tabela `public.aliquotas_vigencia(id uuid pk default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade, vigente_desde timestamptz not null, nacional_pct numeric not null, importado_pct numeric not null, uf_empresa text null, interna_pct numeric null, criado_em timestamptz default now())`, unique `(org_id, vigente_desde)`, índice `(org_id, vigente_desde desc)`.
  - `on delete cascade` segue o padrão de `configuracoes` (`20260722085311_adr86_configuracoes_pk_org_id_e_seed.sql:37`).

- [x] **Step 1: Valores antigos da Daludi confirmados pelo Diego em 17/11.**
  - Antes da troca de 17/11, 09:40: nacional 4%, importado 0%, PE (dentro do estado) **4%**.

- [ ] **Step 2: Medir em produção (somente leitura, SQL via Management API, ver memória `reference_ops`).**
  - Rodar: `select o.id, o.name, c.aliquota_nacional_pct, c.aliquota_importado_pct, c.uf_empresa, c.aliquota_interna_pct from public.configuracoes c join public.organizations o on o.id=c.org_id where c.aliquotas_confirmadas_em is not null;`
    - Conferir o nome da coluna de nome em `20260705163656_e7_organizations.sql`.
  - Esperado: a Daludi Shop aparece com nacional 6.5, importado 0, `PE`, interna 6.5. Anotar o `org_id`.
  - Se os valores atuais forem outros, **parar e perguntar ao Diego**.
  - **Corte fixo: `2026-11-17T12:40:00Z`** (09:40 em Brasília, informado pelo Diego). Nunca usar `atualizado_em`: ele muda em qualquer save de configuração e vem do relógio do cliente (`queries.ts:820,867`).
  - Copiar as policies SELECT atuais de `configuracoes`: `select policyname, roles, qual from pg_policies where tablename='configuracoes';`. A nova tabela replica a leitura, inclusive o acesso de platform admin se houver.
  - Copiar também o padrão de função `security definer` já usado nas migrations: `search_path = ''`, nomes qualificados e `revoke execute … from public`.

- [ ] **Step 3: Escrever a migration**, nesta ordem:
  1. Create table, unique e índice.
  2. `enable row level security`. Só policy de SELECT, igual à de `configuracoes`.
     - Privilégios explícitos: `revoke all on public.aliquotas_vigencia from anon, authenticated;` + `grant select on public.aliquotas_vigencia to authenticated;`.
     - O revoke cobre o `TRUNCATE`, que ignora RLS (`20260927084615_vendas_sku_trafego.sql:53`). Só o trigger escreve.
  3. Função `public.registrar_vigencia_aliquota()`:
     - `security definer`, `set search_path = ''`, nomes qualificados (`public.…`).
     - `revoke execute on function … from public;`.
     - Em INSERT, ou em UPDATE onde `(aliquota_nacional_pct, aliquota_importado_pct, uf_empresa, aliquota_interna_pct)` IS DISTINCT FROM `OLD`, e com `NEW.aliquota_nacional_pct` e `NEW.aliquota_importado_pct` não nulos:
       `insert into public.aliquotas_vigencia (org_id, vigente_desde, …) values (NEW.org_id, date_trunc('milliseconds', clock_timestamp()), …) on conflict (org_id, vigente_desde) do update set …`.
     - O `do update` só acontece com dois saves no mesmo milissegundo. Nesse caso vale o último, que é o valor efetivo daquele instante.
     - Saves concorrentes da mesma org se serializam pelo lock da linha de `configuracoes`. O `clock_timestamp()`, avaliado no AFTER trigger depois do lock, segue essa ordem.
  4. Trigger `trg_configuracoes_vigencia_aliquota after insert or update on public.configuracoes for each row execute function …`.
  5. **Pré-condição** (aborta a migration se falhar): `do $$ … if not exists (select 1 from public.configuracoes where org_id='<daludi>' and aliquota_nacional_pct=6.5 and aliquota_importado_pct=0 and uf_empresa='PE' and aliquota_interna_pct=6.5) then raise exception 'ADR-0208: config da Daludi divergiu do medido'; end if; … $$;`
  6. Backfill de cada org com `aliquotas_confirmadas_em is not null`, com valores fixos (não lidos na hora):
     - Linha `vigente_desde = '1970-01-01T00:00:00Z'` com os valores atuais.
     - **Exceto a Daludi**, que recebe duas linhas:
       - `1970-01-01T00:00:00Z`: nacional 4, importado 0, uf `PE`, interna 4;
       - `2026-11-17T12:40:00Z`: nacional 6.5, importado 0, uf `PE`, interna 6.5.
     - Usar `on conflict do nothing`, para a migration ser idempotente.

- [ ] **Step 4: Teste SQL em transação desfeita** (memória `reference_teste_sql_sem_docker`): `begin;` → aplicar o corpo da migration → testar → `rollback;`.
  - **Não tocar em org real.** Criar dentro da transação uma org de teste em `public.organizations` (com as colunas obrigatórias) e a linha dela em `configuracoes`.
  - Testar contra essa org:

  ```sql
  -- org de teste: <tst> (criada no begin, some no rollback)
  insert into public.configuracoes (org_id, user_id, aliquota_nacional_pct, aliquota_importado_pct, aliquotas_confirmadas_em) values ('<tst>', '<qualquer user>', 4, 0, now());
  select count(*) from public.aliquotas_vigencia where org_id='<tst>';  -- esperado: 1 (insert)
  -- (a) update sem mudança de valor não cria linha
  update public.configuracoes set aliquotas_confirmadas_em = now() where org_id = '<tst>';
  select count(*) from public.aliquotas_vigencia where org_id='<tst>';  -- esperado: 1
  -- (b) mudança de valor cria linha nova
  update public.configuracoes set aliquota_nacional_pct = 6.5 where org_id = '<tst>';
  select count(*) from public.aliquotas_vigencia where org_id='<tst>';  -- esperado: 2
  -- (c) authenticated não escreve
  set local role authenticated; insert into public.aliquotas_vigencia (org_id, vigente_desde, nacional_pct, importado_pct) values ('<tst>', now(), 1, 1);  -- esperado: ERROR permission denied
  rollback;
  ```

- [ ] **Step 5: Aplicar.**
  - `npm run db:check` passa.
  - `supabase db push` aplica.
  - Conferir: `select org_id, vigente_desde, nacional_pct, interna_pct from aliquotas_vigencia order by org_id, vigente_desde;`. Daludi com 2 linhas, demais orgs com 1.

- [ ] **Step 6: Commit** — `feat(imposto): tabela aliquotas_vigencia + trigger + backfill (ADR-0208)`

---

### Task 2: Resolver com vigência (núcleo compartilhado)

**Files:**
- Modify: `supabase/functions/_shared/platform-admin/sales-summary.ts:29` (tipo `AliquotaResolver`) e `:126-135` (`impostoDoItem`, `impostoDaVenda`)
- Modify: `supabase/functions/_shared/platform-admin/sales-types.ts:80`
  - Ali existe uma **segunda** declaração de `AliquotaResolver`. Unificar: manter uma só e reexportar a outra, para os contratos não divergirem.
- Modify: `supabase/functions/_shared/platform-admin/sales-costs.ts:122-140` (`montarAliquotaResolver`)
- Test: `src/lib/__tests__/aliquota-vigencia.test.ts` (novo, no mesmo estilo de `src/lib/__tests__/aliquota-interna-uf.test.ts`, que deve continuar passando)

**Interfaces:**
- Produces:
  ```ts
  // sales-costs.ts
  export type VigenciaAliquota = { vigenteDesde: string; nacional: number; importado: number; ufEmpresa: string | null; internaPct: number | null };
  export type AliquotasComVigencia = { nacional: number; importado: number; ufEmpresa?: string | null; internaPct?: number | null; vigencias?: VigenciaAliquota[] };
  export function montarAliquotaResolver(m: MapasCusto | undefined, aliquotas: AliquotasComVigencia | null): AliquotaResolver;
  // sales-summary.ts
  export type AliquotaResolver = (item: VendaItem, uf: string | null, data: string | null) => number | null;
  export function impostoDoItem(it: VendaItem, resolver: AliquotaResolver | undefined, uf: string | null, data: string | null): number;
  ```
  - O parâmetro `data` é **obrigatório**, não opcional. Assim o `tsc` acusa todo chamador esquecido.
  - `impostoDaVenda(v)` passa `v.date_closed ?? v.date_created`.

- [ ] **Step 1: Testes que falham** (reusar `mapas` e `item` do teste de UF; MLB1 é nacional):
  ```ts
  const vig = { nacional: 6.5, importado: 0, ufEmpresa: 'PE', internaPct: 6.5, vigencias: [
    { vigenteDesde: '1970-01-01T00:00:00Z', nacional: 4, importado: 0, ufEmpresa: 'PE', internaPct: 4 },
    { vigenteDesde: '2026-11-17T12:40:00Z', nacional: 6.5, importado: 0, ufEmpresa: 'PE', internaPct: 6.5 },
  ]};
  it('venda antes da troca usa a alíquota antiga', () =>
    expect(montarAliquotaResolver(mapas, vig)(item({}), 'SP', '2026-11-16T10:00:00Z')).toBe(4));
  it('venda depois da troca usa a nova', () =>
    expect(montarAliquotaResolver(mapas, vig)(item({}), 'SP', '2026-11-17T13:00:00Z')).toBe(6.5));
  it('venda no instante exato da troca usa a nova', () =>
    expect(montarAliquotaResolver(mapas, vig)(item({}), 'SP', '2026-11-17T12:40:00Z')).toBe(6.5));
  it('interna por UF também respeita a vigência', () =>
    expect(montarAliquotaResolver(mapas, vig)(item({}), 'PE', '2026-11-16T10:00:00Z')).toBe(4));
  it('ordem da lista não importa', () =>
    expect(montarAliquotaResolver(mapas, { ...vig, vigencias: [...vig.vigencias].reverse() })(item({}), 'SP', '2026-11-16T10:00:00Z')).toBe(4));
  it('data anterior a todas as vigências usa a mais antiga', () => { /* vigências começando em 2026-01-01, data 2025 → nacional da mais antiga */ });
  it('sem vigências usa as alíquotas atuais', () =>
    expect(montarAliquotaResolver(mapas, { nacional: 8, importado: 16 })(item({}), 'SP', '2020-01-01T00:00:00Z')).toBe(8));
  it('mesmo instante em -03:00 e em UTC dá o mesmo resultado', () =>
    expect(montarAliquotaResolver(mapas, vig)(item({}), 'SP', '2026-11-17T09:40:00-03:00')).toBe(6.5));
  it('data null usa as alíquotas atuais', () =>
    expect(montarAliquotaResolver(mapas, vig)(item({}), 'SP', null)).toBe(6.5));
  it('impostoDoItem aplica a alíquota da data', () =>
    expect(impostoDoItem(item({ unit_price: 100 }), montarAliquotaResolver(mapas, vig), 'SP', '2026-11-16T10:00:00Z')).toBe(4));
  ```
  - Nos testes antigos de `aliquota-interna-uf.test.ts`, que chamam `(item, uf)`, acrescentar `null` como 3º argumento.

- [ ] **Step 2:** `pnpm vitest run src/lib/__tests__/aliquota-vigencia.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
  - Ordenar `vigencias` uma vez, por `vigenteDesde` desc, no `montarAliquotaResolver`, e não por chamada.
  - Escolher com `Date.parse`.
  - Depois aplicar a lógica atual, UF e depois origem, sobre os valores da vigência escolhida.
- [ ] **Step 4:** os dois arquivos de teste → PASS.
- [ ] **Step 5: Commit** — `feat(imposto): resolver escolhe a alíquota vigente na data da venda`

---

### Task 3: Passar a data nos chamadores e carregar as vigências no front

**Files:**
- Modify:
  - `src/lib/pedidos-faturamento.ts:200-201` (as duas chamadas: `impostoDoItem` e `aliquotaResolver?.(it, uf)`; a data do pedido tem que chegar ao `itensFlat`)
  - `src/lib/detalhe-vendas.ts:195`
  - `supabase/functions/_shared/notificacoes/gerencial/resultado.ts:78,81`
  - `src/hooks/useVendasSku.ts:35` (`aliqR(it, v.uf)` em `origemNaoResolvida`)
- Modify: `src/lib/queries.ts` `fetchAliquotas` (≈ linha 785), para devolver também `vigencias: VigenciaAliquota[]`
- Test: os testes existentes de `pedidos-faturamento`, `detalhe-vendas` e `gerencial/__tests__/resultado.test.ts` precisam continuar verdes. Acrescentar 1 caso em `resultado.test.ts`.

**Interfaces:**
- Consumes: `impostoDoItem(it, resolver, uf, data)`, `VigenciaAliquota` (Task 2).
- Produces: `fetchAliquotas(): Promise<{ nacional; importado; confirmada; ufEmpresa; internaPct; vigencias: VigenciaAliquota[] }>`.
  - Lê `aliquotas_vigencia` filtrado por `org_id = effectiveOrgId()`.
  - Mapeia `vigente_desde → vigenteDesde`.
  - Erro na leitura das vigências → **lançar** o erro (React Query mostra o estado de erro).
  - Nunca devolver `[]` em caso de falha: isso reaplicaria a alíquota atual às vendas antigas.
  - Lista vazia de verdade (org sem confirmação) → `[]`.

- [ ] **Step 1: Teste que falha** em `resultado.test.ts`:
  - Duas vendas iguais, uma em 2026-11-16 e outra em 2026-11-18.
  - `ctx.rates` com as duas vigências do Task 2.
  - Esperado: imposto 4 na primeira e 6,5 na segunda (base 100).
- [ ] **Step 2:** `pnpm vitest run supabase/functions/_shared/notificacoes/gerencial/__tests__/resultado.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
  - Passar `v.date_closed ?? v.date_created` em todos os chamadores. Rodar `pnpm build` para o `tsc` apontar algum que faltou.
  - Atualizar `fetchAliquotas`.
  - `useAliquotas` e as 9 telas não mudam: o objeto já segue direto para `montarAliquotaResolver`.
- [ ] **Step 4:** `pnpm build` sem erro. Os arquivos de teste citados → PASS.
- [ ] **Step 5: Commit** — `feat(imposto): vendas usam a alíquota vigente na data (front + gerencial)`

---

### Task 4: Edges (Central, relatório mensal) e carimbo do cache

**Files:**
- Modify: `supabase/functions/_shared/platform-admin/metrics-repository.ts`:
  - `:167` (`Rates`): ganha `vigencias: VigenciaAliquota[]`.
  - `:189-204` (`loadConfigState`): lê `aliquotas_vigencia` da org com `readPages`, mesmo padrão.
  - `:210-213` (`taxConfigStamp`): assina `JSON.stringify(r.vigencias.map(v => [v.vigenteDesde, v.nacional, v.importado, v.ufEmpresa, v.internaPct]))` mais os valores atuais.
- Test: `supabase/functions/_shared/platform-admin/__tests__/` (o arquivo de teste existente de metrics-repository, ou um novo `tax-stamp-vigencia.test.ts`). `monthly-report-paridade.test.ts` continua verde.

**Interfaces:**
- Consumes: `VigenciaAliquota`, `montarAliquotaResolver` (Task 2). `monthly-report.ts:54` e `resultado.ts:39` já passam `ctx.rates`, então não mudam.

- [ ] **Step 1: Testes que falham.**
  - (a) `taxConfigStamp` muda quando entra uma vigência nova.
  - (b) `calcularMes` de out/2026 com vigências `[1970: 4%, 2026-11-17: 6,5%]` dá o mesmo imposto que com `[1970: 4%]` só.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar.**
  - Erro ao ler vigências → `configAvailable = false`, `configErrored = true`, `rates = null`, e log.
  - Com isso:
    - o mês fechado não é materializado (`metrics-repository.ts:500` já exige `!configErrored`);
    - o gerencial sai com `configOk: false` (lucro indisponível);
    - a alíquota atual nunca é aplicada em silêncio.
  - Acrescentar o teste (c) no Step 1: falha na leitura de `aliquotas_vigencia` → `configErrored === true` e `rates === null`.
- [ ] **Step 4:** `pnpm vitest run supabase/functions/_shared/platform-admin` → PASS.
- [ ] **Step 5: Commit** — `feat(imposto): Central e relatório mensal usam alíquota vigente (ADR-0208)`

---

### Task 5: Aviso na tela, docs, revisão e deploy

**Files:**
- Modify: `src/components/configuracoes/secao-fiscal.tsx`. Texto de ajuda no card "Imposto por origem", abaixo da descrição atual: **"Mudanças valem para vendas a partir do momento em que você salvar. Vendas anteriores mantêm a alíquota da época."**
- Modify:
  - `docs/TASKS.md`
  - `docs/reference/modelo-de-dados.md` (tabela nova)
  - `docs/decisions/0208-aliquota-com-vigencia.md` (Status → ACEITO, com o commit)
  - Rodar a skill `docs-update-checklist`.

- [ ] **Step 1: Texto na tela** e print real via Playwright (skill `playwright-cli`, sessão própria, nunca o Chrome do Diego).
- [ ] **Step 2: Validação completa:** `pnpm preflight`, `pnpm build` e `pnpm test`, tudo verde.
- [ ] **Step 3: Revisão crítica independente** (obrigatória).
  - Passar só o diff da branch, os arquivos relacionados e o ADR-0208.
  - Revisor: Opus effort high ou Codex `gpt-6.1-sol` high, `-s read-only`, `< /dev/null`.
  - Aplicar os achados confirmados.
- [ ] **Step 4: Prova com dado real** (somente leitura). Na Daludi Shop, aba Vendas:
  - venda de 16/11 → imposto a 4%;
  - venda depois de 17/11 12:40 UTC → 6,5%.
- [ ] **Step 5: Merge e deploy** (CLAUDE.md, seção "Git — entrega").
  1. Push da branch e CI verde.
  2. Fast-forward na `main`.
  3. Fazer `supabase functions deploy` de **todas** as edges que importam `_shared/platform-admin/` ou `_shared/notificacoes/gerencial/`. Listar com `grep -rl "platform-admin/\|notificacoes/gerencial" supabase/functions/*/index.ts` e seguir os imports indiretos.
  4. Conferir a versão nova de cada edge.
  5. Em seguida, `git pull --ff-only` no checkout principal e remover a worktree e a branch.

## Fora do escopo

- Escolher "vale a partir de" (data futura ou retroativa) na tela.
- Tela de histórico de alíquotas.
- Precificação, calculadora, kits e promoções com vigência: continuam com a alíquota atual, de propósito.
