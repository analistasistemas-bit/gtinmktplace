# E2 — Modelo de dados multicanal (`anuncios_externos`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a tabela `anuncios_externos` (1 produto → N anúncios por canal) e espelhar nela o estado de publicação do ML via dual-write, sem mudar nada que hoje fatura.

**Architecture:** Strangler dual-write. Os workers continuam gravando `ml_*`/`catalog_*` em `familias`/`variacoes` (fonte de verdade; leitura/idempotência inalteradas) **e** fazem upsert best-effort em `anuncios_externos`, ancorado em `(user_id, canal, codigo_pai)`. O estado por-variação (incl. `catalog_*`) vira um mapa JSONB `variacoes_externas`.

**Tech Stack:** Supabase Postgres (migration via MCP `apply_migration`), Edge Functions Deno/TS, vitest (testes das funções puras), supabase-js admin client.

**Refs:** [spec](../specs/2026-06-14-e2-modelo-dados-multicanal-design.md) · [ADR-0025](../../decisions/0025-modelo-de-dados-multicanal.md)

---

## File Structure

- **Create** `supabase/migrations/20260614120000_anuncios_externos.sql` — enum `canal_externo`, tabela `anuncios_externos`, RLS, índices, trigger, backfill.
- **Create** `supabase/functions/_shared/anuncios/espelhar.ts` — pura `montarAnuncioExterno` + thin `espelharAnuncioExterno` (upsert best-effort).
- **Create** `supabase/functions/_shared/anuncios/__tests__/espelhar.test.ts` — vitest da pura.
- **Modify** `supabase/functions/publish-familia-ml/index.ts` — dual-write após casar variações.
- **Modify** `supabase/functions/update-familia-ml/index.ts` — dual-write antes do Response de sucesso.
- **Modify** `supabase/functions/vincular-catalogo/index.ts` — dual-write após persistir `catalog_*`.
- **Regenerate** `src/lib/database.types.ts` — via MCP após a migration.

---

## Task 1: Migration `anuncios_externos` + backfill

**Files:**
- Create: `supabase/migrations/20260614120000_anuncios_externos.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- ADR-0025 / E2: modelo de dados multicanal. Tabela anuncios_externos (1 produto -> N anúncios
-- por canal), ancorada em (user_id, canal, codigo_pai) — familias é por-lote e várias linhas
-- compartilham o mesmo ml_item_id após UPDATE, então familia_id não é âncora estável.
-- Estratégia strangler dual-write: as colunas ml_*/catalog_* em familias/variacoes seguem como
-- fonte de verdade; esta tabela é o espelho mantido pelos workers, pronto p/ o 2º canal.

create type public.canal_externo as enum ('mercado_livre');

create table public.anuncios_externos (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  canal               public.canal_externo not null,
  codigo_pai          text not null,

  item_externo_id     text,                      -- = ml_item_id
  permalink           text,
  status              text not null default 'publicado',
  erro_mensagem       text,

  -- mapa codigo(sku) -> { variation_id, catalog_product_id, catalog_listing_id, catalog_status }
  variacoes_externas  jsonb not null default '{}'::jsonb,
  -- reservados (vazios hoje — YAGNI): metadados específicos do canal e override de preço por canal
  metadados_canal     jsonb not null default '{}'::jsonb,
  preco_override      numeric,

  publicado_em        timestamptz,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),

  unique (user_id, canal, codigo_pai)
);

create index anuncios_externos_user_canal_idx on public.anuncios_externos (user_id, canal);

create trigger anuncios_externos_set_updated_at
  before update on public.anuncios_externos
  for each row execute procedure extensions.moddatetime (atualizado_em);

alter table public.anuncios_externos enable row level security;

create policy "anuncios_externos: select own" on public.anuncios_externos
  for select using ((select auth.uid()) = user_id);
create policy "anuncios_externos: insert own" on public.anuncios_externos
  for insert with check ((select auth.uid()) = user_id);
create policy "anuncios_externos: update own" on public.anuncios_externos
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "anuncios_externos: delete own" on public.anuncios_externos
  for delete using ((select auth.uid()) = user_id);

-- Backfill: 1 linha por (user_id, codigo_pai) publicado, usando a família mais recente (último lote).
insert into public.anuncios_externos
  (user_id, canal, codigo_pai, item_externo_id, permalink, status, variacoes_externas, publicado_em)
select distinct on (f.user_id, f.codigo_pai)
  f.user_id, 'mercado_livre'::public.canal_externo, f.codigo_pai,
  f.ml_item_id, f.ml_permalink, 'publicado',
  coalesce((
    select jsonb_object_agg(v.codigo, jsonb_strip_nulls(jsonb_build_object(
      'variation_id', v.ml_variation_id,
      'catalog_product_id', v.catalog_product_id,
      'catalog_listing_id', v.catalog_listing_id,
      'catalog_status', nullif(v.catalog_status, 'pendente')
    )))
    from public.variacoes v
    where v.familia_id = f.id and v.ml_variation_id is not null
  ), '{}'::jsonb),
  f.publicado_em
from public.familias f
where f.ml_item_id is not null
order by f.user_id, f.codigo_pai, f.publicado_em desc nulls last
on conflict (user_id, canal, codigo_pai) do nothing;
```

- [ ] **Step 2: Aplicar a migration via MCP**

Usar `mcp__supabase-mcp-server__apply_migration` com `name: "anuncios_externos"` e o SQL acima.
Esperado: sucesso, sem erro.

- [ ] **Step 3: Verificar a contagem do backfill**

Rodar via `mcp__supabase-mcp-server__execute_sql`:

```sql
select
  (select count(*) from public.anuncios_externos) as espelho,
  (select count(*) from (
     select distinct user_id, codigo_pai from public.familias where ml_item_id is not null
   ) t) as distintos_publicados;
```
Esperado: `espelho == distintos_publicados`.

- [ ] **Step 4: Conferir um mapa de variações real**

```sql
select codigo_pai, item_externo_id, jsonb_pretty(variacoes_externas)
from public.anuncios_externos limit 3;
```
Esperado: `item_externo_id` preenchido (MLB...) e o mapa com `variation_id` por código (e `catalog_*` onde houver vínculo).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260614120000_anuncios_externos.sql
git commit -m "feat(e2): migration anuncios_externos + backfill (ADR-0025)"
```

---

## Task 2: Helper de espelhamento `montarAnuncioExterno` (puro, TDD) + upsert

**Files:**
- Create: `supabase/functions/_shared/anuncios/espelhar.ts`
- Test: `supabase/functions/_shared/anuncios/__tests__/espelhar.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { describe, it, expect } from 'vitest';
import { montarAnuncioExterno } from '../espelhar';

const FAMILIA = {
  user_id: 'u1',
  codigo_pai: '00445916',
  ml_item_id: 'MLB123',
  ml_permalink: 'https://ml/MLB123',
  publicado_em: '2026-06-14T00:00:00Z',
};

describe('montarAnuncioExterno', () => {
  it('monta a row canônica do canal mercado_livre', () => {
    const row = montarAnuncioExterno(FAMILIA, []);
    expect(row.canal).toBe('mercado_livre');
    expect(row.user_id).toBe('u1');
    expect(row.codigo_pai).toBe('00445916');
    expect(row.item_externo_id).toBe('MLB123');
    expect(row.permalink).toBe('https://ml/MLB123');
    expect(row.status).toBe('publicado');
    expect(row.publicado_em).toBe('2026-06-14T00:00:00Z');
    expect(row.variacoes_externas).toEqual({});
  });

  it('inclui no mapa só variações casadas (com ml_variation_id)', () => {
    const row = montarAnuncioExterno(FAMILIA, [
      { codigo: 'A', ml_variation_id: 'v-a' },
      { codigo: 'B', ml_variation_id: null },
    ]);
    expect(row.variacoes_externas).toEqual({ A: { variation_id: 'v-a' } });
  });

  it('inclui catalog_* só quando presente e ≠ pendente', () => {
    const row = montarAnuncioExterno(FAMILIA, [
      { codigo: 'A', ml_variation_id: 'v-a', catalog_listing_id: 'MLB9', catalog_product_id: 'MLB1', catalog_status: 'vinculado' },
      { codigo: 'B', ml_variation_id: 'v-b', catalog_status: 'pendente' },
    ]);
    expect(row.variacoes_externas).toEqual({
      A: { variation_id: 'v-a', catalog_product_id: 'MLB1', catalog_listing_id: 'MLB9', catalog_status: 'vinculado' },
      B: { variation_id: 'v-b' },
    });
  });

  it('item_externo_id null quando família ainda sem ml_item_id', () => {
    const row = montarAnuncioExterno({ ...FAMILIA, ml_item_id: null, ml_permalink: null }, []);
    expect(row.item_externo_id).toBeNull();
    expect(row.permalink).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar os testes p/ confirmar que falham**

Run: `pnpm test -- espelhar`
Expected: FAIL ("Cannot find module '../espelhar'").

- [ ] **Step 3: Implementar `espelhar.ts`**

```ts
// ADR-0025 / E2: espelha o estado de publicação do ML em anuncios_externos (dual-write).
// montarAnuncioExterno é pura (testável); espelharAnuncioExterno é best-effort (não derruba a
// publicação — o ml_* em familias/variacoes é a fonte de verdade).

export type VariacaoEspelho = {
  codigo: string;
  ml_variation_id: string | null;
  catalog_product_id?: string | null;
  catalog_listing_id?: string | null;
  catalog_status?: string | null;
};

export type FamiliaEspelho = {
  user_id: string;
  codigo_pai: string;
  ml_item_id: string | null;
  ml_permalink: string | null;
  status?: string;
  publicado_em?: string | null;
};

export type VariacaoExterna = {
  variation_id: string;
  catalog_product_id?: string;
  catalog_listing_id?: string;
  catalog_status?: string;
};

export type AnuncioExternoRow = {
  user_id: string;
  canal: 'mercado_livre';
  codigo_pai: string;
  item_externo_id: string | null;
  permalink: string | null;
  status: string;
  variacoes_externas: Record<string, VariacaoExterna>;
  publicado_em: string | null;
};

export function montarAnuncioExterno(
  familia: FamiliaEspelho,
  variacoes: VariacaoEspelho[],
): AnuncioExternoRow {
  const variacoes_externas: Record<string, VariacaoExterna> = {};
  for (const v of variacoes) {
    if (!v.ml_variation_id) continue;
    const entry: VariacaoExterna = { variation_id: v.ml_variation_id };
    if (v.catalog_product_id) entry.catalog_product_id = v.catalog_product_id;
    if (v.catalog_listing_id) entry.catalog_listing_id = v.catalog_listing_id;
    if (v.catalog_status && v.catalog_status !== 'pendente') entry.catalog_status = v.catalog_status;
    variacoes_externas[v.codigo] = entry;
  }
  return {
    user_id: familia.user_id,
    canal: 'mercado_livre',
    codigo_pai: familia.codigo_pai,
    item_externo_id: familia.ml_item_id,
    permalink: familia.ml_permalink,
    status: familia.status ?? 'publicado',
    variacoes_externas,
    publicado_em: familia.publicado_em ?? null,
  };
}

// deno-lint-ignore no-explicit-any
export async function espelharAnuncioExterno(
  admin: any,
  familia: FamiliaEspelho,
  variacoes: VariacaoEspelho[],
): Promise<void> {
  try {
    const row = montarAnuncioExterno(familia, variacoes);
    const { error } = await admin
      .from('anuncios_externos')
      .upsert(row, { onConflict: 'user_id,canal,codigo_pai' });
    if (error) console.error('espelhar anuncios_externos falhou:', error.message);
  } catch (e) {
    console.error('espelhar anuncios_externos exceção:', (e as Error).message);
  }
}
```

- [ ] **Step 4: Rodar os testes p/ confirmar que passam**

Run: `pnpm test -- espelhar`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/anuncios/espelhar.ts supabase/functions/_shared/anuncios/__tests__/espelhar.test.ts
git commit -m "feat(e2): helper montarAnuncioExterno + espelharAnuncioExterno (TDD)"
```

---

## Task 3: Dual-write em `publish-familia-ml`

**Files:**
- Modify: `supabase/functions/publish-familia-ml/index.ts`

Contexto: hoje, em ~L156 persiste `familias.update({ ml_item_id, ml_permalink, publicado_em, status })` e em ~L177-179 casa `variacoes.update({ ml_variation_id })` por código. O espelho entra **depois** desse casamento, antes do `Response` de sucesso (~L194). Recarregar as variações para pegar os `ml_variation_id`/`catalog_*` atuais.

- [ ] **Step 1: Importar o helper**

No topo do arquivo, junto aos imports de `_shared`:

```ts
import { espelharAnuncioExterno } from '../_shared/anuncios/espelhar.ts';
```

- [ ] **Step 2: Inserir o dual-write antes do Response de sucesso**

Logo após o loop que casa `ml_variation_id` (após ~L190) e antes de `return new Response(JSON.stringify({ ml_item_id: ref.itemExternoId ...`:

```ts
    // E2 (ADR-0025): espelha o estado em anuncios_externos (best-effort, não derruba a publicação).
    const { data: varsEspelho } = await admin.from('variacoes')
      .select('codigo, ml_variation_id, catalog_product_id, catalog_listing_id, catalog_status')
      .eq('familia_id', job.familia_id);
    await espelharAnuncioExterno(admin, {
      user_id: familia.user_id,
      codigo_pai: familia.codigo_pai,
      ml_item_id: ref.itemExternoId,
      ml_permalink: ref.permalink ?? null,
      publicado_em: new Date().toISOString(),
    }, varsEspelho ?? []);
```

> Nota p/ o implementador: confira o nome exato do campo permalink no `ref` (`RefAnuncio`) — pode ser `ref.permalink`. Se o objeto `familia` em memória já tiver `ml_permalink` setado após o update, use o mesmo valor que foi gravado em `familias`. O importante: `item_externo_id` e `permalink` iguais ao que foi persistido em `familias`.

- [ ] **Step 3: Rodar testes e typecheck**

Run: `pnpm test` → Expected: tudo verde (nenhum teste deve quebrar; o helper já é coberto).
Run (se `deno` disponível): `deno check supabase/functions/publish-familia-ml/index.ts` → Expected: 0 erros. Se `deno` não estiver no PATH, registrar e seguir (o review faz `npx tsc --noEmit`).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/publish-familia-ml/index.ts
git commit -m "feat(e2): dual-write de anuncios_externos no publish-familia-ml"
```

---

## Task 4: Dual-write em `update-familia-ml`

**Files:**
- Modify: `supabase/functions/update-familia-ml/index.ts`

Contexto: hoje casa `ml_variation_id` das cores novas (~L163), sincroniza descrição (~L180) e persiste `familias.update({ status, publicado_em })` (~L186). O espelho entra antes do `Response` de sucesso (~L201). `familia.ml_item_id` já existe (UPDATE herda).

- [ ] **Step 1: Importar o helper**

```ts
import { espelharAnuncioExterno } from '../_shared/anuncios/espelhar.ts';
```

- [ ] **Step 2: Inserir o dual-write antes do Response de sucesso**

Antes de `return new Response(JSON.stringify({ ml_item_id: familia.ml_item_id, atualizado: true ...`:

```ts
    // E2 (ADR-0025): espelha o estado atualizado em anuncios_externos (best-effort).
    const { data: varsEspelho } = await admin.from('variacoes')
      .select('codigo, ml_variation_id, catalog_product_id, catalog_listing_id, catalog_status')
      .eq('familia_id', job.familia_id);
    await espelharAnuncioExterno(admin, {
      user_id: familia.user_id,
      codigo_pai: familia.codigo_pai,
      ml_item_id: familia.ml_item_id,
      ml_permalink: familia.ml_permalink ?? null,
      publicado_em: new Date().toISOString(),
    }, varsEspelho ?? []);
```

- [ ] **Step 3: Rodar testes e typecheck**

Run: `pnpm test` → Expected: tudo verde.
Run (se disponível): `deno check supabase/functions/update-familia-ml/index.ts` → Expected: 0 erros.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/update-familia-ml/index.ts
git commit -m "feat(e2): dual-write de anuncios_externos no update-familia-ml"
```

---

## Task 5: Dual-write em `vincular-catalogo`

**Files:**
- Modify: `supabase/functions/vincular-catalogo/index.ts`

Contexto: este worker persiste o estado de catálogo (`catalog_product_id`/`catalog_listing_id`/`catalog_status`) nas variações (via `vincularVariacoesCatalogo`). Após persistir, atualiza o mapa `variacoes_externas` do anúncio espelhado. Precisa do `codigo_pai` da família (já carregada em ~L26) e das variações atualizadas.

- [ ] **Step 1: Importar o helper**

```ts
import { espelharAnuncioExterno } from '../_shared/anuncios/espelhar.ts';
```

- [ ] **Step 2: Inserir o dual-write após persistir os catalog_***

Após o passo que grava o resultado do opt-in nas variações (e somente quando o worker considera o job concluído, não no retorno 500 de retry), recarregar e espelhar:

```ts
    // E2 (ADR-0025): reflete o estado de catálogo no mapa variacoes_externas (best-effort).
    const { data: varsEspelho } = await admin.from('variacoes')
      .select('codigo, ml_variation_id, catalog_product_id, catalog_listing_id, catalog_status')
      .eq('familia_id', familia.id);
    await espelharAnuncioExterno(admin, {
      user_id: familia.user_id,
      codigo_pai: familia.codigo_pai,
      ml_item_id: familia.ml_item_id,
      ml_permalink: familia.ml_permalink ?? null,
      publicado_em: familia.publicado_em ?? null,
    }, varsEspelho ?? []);
```

> Nota p/ o implementador: posicionar **apenas no caminho de conclusão** do worker (quando não há mais variação `pendente` a retentar). Se o worker devolve 500 para o QStash retentar, **não** espelhar ainda — espelhe quando o opt-in assenta. Conferir o fluxo de retorno do `index.ts` e inserir no ramo certo. O upsert é idempotente, então espelhar a cada conclusão é seguro.

- [ ] **Step 3: Rodar testes e typecheck**

Run: `pnpm test` → Expected: tudo verde.
Run (se disponível): `deno check supabase/functions/vincular-catalogo/index.ts` → Expected: 0 erros.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/vincular-catalogo/index.ts
git commit -m "feat(e2): dual-write de catalog state em anuncios_externos no vincular-catalogo"
```

---

## Task 6: Regenerar tipos + verificação final

**Files:**
- Modify: `src/lib/database.types.ts`

- [ ] **Step 1: Regenerar os tipos**

Usar `mcp__supabase-mcp-server__generate_typescript_types` e gravar o resultado em `src/lib/database.types.ts`. Esperado: aparece o tipo `anuncios_externos` (Row/Insert/Update) + enum `canal_externo`.

- [ ] **Step 2: Typecheck + lint + testes**

Run: `pnpm test` → Expected: tudo verde (incl. os 4 testes novos do helper).
Run: `npx tsc --noEmit` → Expected: 0 erros.
Run: `pnpm lint` → Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/database.types.ts
git commit -m "chore(e2): regenera database.types com anuncios_externos"
```

---

## Pós-execução (controlador, fora do subagent-driven)

1. **Deploy via CLI** (regra "deploy nunca defasado"): `publish-familia-ml`, `update-familia-ml`, `vincular-catalogo` (mudança em `_shared/anuncios` → redeployar as 3 funções afetadas). Conferir versão pós-deploy.
2. **Code review independente** (opus, lane separada) do diff completo do E2.
3. **Bug bash real (browser-use):** família de teste CREATE → conferir 1 linha em `anuncios_externos` (item_externo_id + mapa); UPDATE (reposição + cor nova) → mapa atualizado; opt-in catálogo → `catalog_status` no mapa. Limpar tudo (anúncio encerrado no ML + linhas de teste removidas).
4. **Atualizar** `docs/TASKS.md` (E2 ✅), `CLAUDE.md` (entrada de histórico), memória `project_evolucao_saas.md`.
5. **Merge → main + push** (após verde) e deploy confirmado.
