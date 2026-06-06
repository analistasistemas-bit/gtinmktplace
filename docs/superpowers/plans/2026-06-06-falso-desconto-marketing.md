# Desconto de marketing ("de/para") — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir o selo "X% OFF" (preço cheio riscado + preço de venda) nos anúncios ML, com opt-in por família e toggle por lote, % global default 15% editável e override por família.

**Architecture:** Abordagem A do spec — `original_price` calculado **na publicação** (não persistido por variação). Fonte da verdade: `configuracoes.desconto_pct` (global) + `familias.exibir_com_desconto` / `familias.desconto_pct` (override). Os workers calculam `original_price = arredonda(preco_publicacao ÷ (1 − pct/100), 2)` por variação quando o flag está ligado; a Revisão calcula só para exibir.

**Tech Stack:** Supabase (Postgres + Edge Functions Deno/TS), Vite + React + TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-06-falso-desconto-marketing-design.md`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| migration `add_configuracoes_e_desconto` | tabela `configuracoes` + colunas em `familias` | criar |
| `supabase/functions/_shared/preco/desconto.ts` | `calcularPrecoDe`, `pctEfetivo` (worker) | criar |
| `supabase/functions/_shared/preco/__tests__/desconto.test.ts` | TDD da pura | criar |
| `supabase/functions/_shared/ml/publicar.ts` | `original_price` no payload CREATE | modificar |
| `supabase/functions/_shared/ml/atualizar.ts` | `original_price` no payload UPDATE | modificar |
| `supabase/functions/publish-familia-ml/index.ts` | carrega pct + passa ao montarPayloadItem | modificar |
| `supabase/functions/update-familia-ml/index.ts` | idem no UPDATE | modificar |
| `src/lib/desconto.ts` | `calcularPrecoDe`, `pctEfetivo` (front) | criar |
| `src/lib/__tests__/desconto.test.ts` | TDD da pura (front) | criar |
| `src/lib/queries.ts` | mutations + adapter (config + flags família) | modificar |
| `src/lib/tipos-dominio.ts` | campos `exibirComDesconto`/`descontoPct` em `Familia` | modificar |
| `src/lib/database.types.ts` | tipos gerados | regenerar |
| `src/hooks/useConfiguracoes.ts` | hook do % global | criar |
| `src/hooks/useFamiliaMutations.ts` | hooks dos flags de desconto | modificar |
| `src/pages/Configuracoes.tsx` | card do % global | modificar |
| `src/components/familia-row.tsx` | checkbox + % + prévia por família | modificar |
| `src/pages/Revisao.tsx` | botão toggle do lote | modificar |

---

## Task 1: Migration — tabela `configuracoes` + colunas em `familias`

**Files:**
- Migration via MCP `apply_migration` (nome: `add_configuracoes_e_desconto`)

- [ ] **Step 1: Aplicar a migration (MCP supabase apply_migration)**

```sql
-- Tabela de preferências do operador (1 linha por usuário).
create table if not exists public.configuracoes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  desconto_pct numeric(5,2) not null default 15,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.configuracoes enable row level security;

create policy "configuracoes_select_own" on public.configuracoes
  for select using (auth.uid() = user_id);
create policy "configuracoes_insert_own" on public.configuracoes
  for insert with check (auth.uid() = user_id);
create policy "configuracoes_update_own" on public.configuracoes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Opt-in por família + override do % (null = usa o global).
alter table public.familias
  add column if not exists exibir_com_desconto boolean not null default false,
  add column if not exists desconto_pct numeric(5,2);
```

- [ ] **Step 2: Verificar**

Rodar (MCP `execute_sql`):
```sql
select column_name, data_type, column_default from information_schema.columns
where table_name='familias' and column_name in ('exibir_com_desconto','desconto_pct');
select count(*) from public.configuracoes;
```
Esperado: 2 colunas novas em `familias`; tabela `configuracoes` existe (0 linhas).

- [ ] **Step 3: Regenerar tipos**

MCP `generate_typescript_types` → colar o resultado em `src/lib/database.types.ts` (substituir o arquivo). Confirmar que `Database['public']['Tables']['configuracoes']` e os campos novos de `familias` existem.

- [ ] **Step 4: Commit**

```bash
git add src/lib/database.types.ts
git commit -m "feat(m4): migration configuracoes + flags de desconto na familia (ADR novo)"
```

---

## Task 2: Pura `desconto.ts` (worker) — TDD

**Files:**
- Create: `supabase/functions/_shared/preco/desconto.ts`
- Test: `supabase/functions/_shared/preco/__tests__/desconto.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```typescript
import { describe, it, expect } from 'vitest';
import { calcularPrecoDe, pctEfetivo } from '../desconto';

describe('calcularPrecoDe', () => {
  it('infla o preço a partir do pct: 12.29 @ 15% → 14.46', () => {
    expect(calcularPrecoDe(12.29, 15)).toBe(14.46);
  });
  it('arredonda para 2 casas: 4.00 @ 15% → 4.71', () => {
    expect(calcularPrecoDe(4, 15)).toBe(4.71);
  });
  it('pct 0 → null (sem selo)', () => {
    expect(calcularPrecoDe(12.29, 0)).toBeNull();
  });
  it('pct >= 100 → null', () => {
    expect(calcularPrecoDe(12.29, 100)).toBeNull();
  });
  it('preço <= 0 → null', () => {
    expect(calcularPrecoDe(0, 15)).toBeNull();
  });
});

describe('pctEfetivo', () => {
  it('usa o override da família quando presente', () => {
    expect(pctEfetivo(20, 15)).toBe(20);
  });
  it('cai no global quando o override é null', () => {
    expect(pctEfetivo(null, 15)).toBe(15);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run supabase/functions/_shared/preco/__tests__/desconto.test.ts`
Esperado: FAIL ("Cannot find module '../desconto'").

- [ ] **Step 3: Implementar**

```typescript
// supabase/functions/_shared/preco/desconto.ts

/** Preço "de" (riscado) inflado a partir do preço de venda. Null = sem selo. */
export function calcularPrecoDe(preco: number, pct: number): number | null {
  if (preco <= 0 || pct <= 0 || pct >= 100) return null;
  return Math.round((preco / (1 - pct / 100)) * 100) / 100;
}

/** % efetivo: override da família quando presente, senão o global. */
export function pctEfetivo(familiaPct: number | null, globalPct: number): number {
  return familiaPct ?? globalPct;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run supabase/functions/_shared/preco/__tests__/desconto.test.ts`
Esperado: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/preco/desconto.ts supabase/functions/_shared/preco/__tests__/desconto.test.ts
git commit -m "feat(m4): pura calcularPrecoDe + pctEfetivo (TDD)"
```

---

## Task 3: `montarPayloadItem` — `original_price` por variação (CREATE)

**Files:**
- Modify: `supabase/functions/_shared/ml/publicar.ts`
- Test: `supabase/functions/_shared/ml/__tests__/publicar.test.ts` (adicionar casos)

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao describe de `montarPayloadItem` (criar o arquivo de teste se não existir, importando `montarPayloadItem`):
```typescript
it('com desconto: adiciona original_price inflado por variação', () => {
  const fam = { titulo_ml: 'T', descricao_ml: null, categoria_ml_id: 'MLB255054', atributos_ml: [] };
  const vars = [{ codigo: '1', cor: 'Azul', estoque: 5, preco_publicacao: 12.29, gtin: null, ml_picture_id: null }];
  const payload = montarPayloadItem(fam, vars, null, null, 'gold_special', { pct: 15 });
  expect(payload.variations[0].price).toBe(12.29);
  expect(payload.variations[0].original_price).toBe(14.46);
});

it('sem desconto (param ausente): não inclui original_price', () => {
  const fam = { titulo_ml: 'T', descricao_ml: null, categoria_ml_id: 'MLB255054', atributos_ml: [] };
  const vars = [{ codigo: '1', cor: 'Azul', estoque: 5, preco_publicacao: 12.29, gtin: null, ml_picture_id: null }];
  const payload = montarPayloadItem(fam, vars, null, null, 'gold_special');
  expect(payload.variations[0].original_price).toBeUndefined();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run supabase/functions/_shared/ml/__tests__/publicar.test.ts`
Esperado: FAIL (assinatura não aceita 6º arg / `original_price` undefined).

- [ ] **Step 3: Implementar**

Em `publicar.ts`:
1. Adicionar `original_price?: number;` à interface `VariacaoItem` (após `price: number;`).
2. Importar a pura no topo: `import { calcularPrecoDe } from '../preco/desconto.ts';`
3. Mudar a assinatura de `montarPayloadItem` para receber o 6º parâmetro opcional:
```typescript
export function montarPayloadItem(
  familia: FamiliaInput,
  variacoes: VariacaoInput[],
  capaPictureId: string | null,
  capa2PictureId: string | null,
  listingTypeId: string = LISTING_TYPE_PADRAO,
  desconto?: { pct: number } | null,
): PayloadItem {
```
4. Dentro do `.map((v) => { ... })`, após montar `const variation: VariacaoItem = { ... }` e antes do tratamento de GTIN, inserir:
```typescript
    if (desconto) {
      const de = calcularPrecoDe(variation.price, desconto.pct);
      if (de !== null) variation.original_price = de;
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run supabase/functions/_shared/ml/__tests__/publicar.test.ts`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/publicar.ts supabase/functions/_shared/ml/__tests__/publicar.test.ts
git commit -m "feat(m4): montarPayloadItem aceita desconto -> original_price por variacao (CREATE)"
```

---

## Task 4: `publish-familia-ml` — carregar pct e passar o desconto (CREATE)

**Files:**
- Modify: `supabase/functions/publish-familia-ml/index.ts`

- [ ] **Step 1: Implementar (sem teste unitário — é orquestração; validação real na Task 9)**

1. No topo, importar a pura: `import { pctEfetivo } from '../_shared/preco/desconto.ts';`
2. Logo após obter `familia` (linha ~45) e antes de montar o payload (linha ~101), carregar o % global e calcular o desconto:
```typescript
    let desconto: { pct: number } | null = null;
    if (familia.exibir_com_desconto) {
      const { data: cfg } = await admin.from('configuracoes')
        .select('desconto_pct').eq('user_id', familia.user_id).maybeSingle();
      const global = cfg?.desconto_pct != null ? Number(cfg.desconto_pct) : 15;
      const fam = familia.desconto_pct != null ? Number(familia.desconto_pct) : null;
      desconto = { pct: pctEfetivo(fam, global) };
    }
```
   (Colocar esse bloco dentro do `try`, logo após carregar/validar variações.)
3. Passar `desconto` como 6º arg do `montarPayloadItem`:
```typescript
    const payload = montarPayloadItem(
      { titulo_ml: familia.titulo_ml, descricao_ml: familia.descricao_ml, categoria_ml_id: familia.categoria_ml_id, atributos_ml: familia.atributos_ml ?? [] },
      ordenadas.map((v) => ({ codigo: v.codigo, cor: v.cor, estoque: v.estoque, preco_publicacao: v.preco_publicacao, gtin: v.gtin, ml_picture_id: v.ml_picture_id })),
      capaPictureId,
      capa2PictureId,
      job.listing_type_id,
      desconto,
    );
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json` (ou o check do projeto) — confirmar sem erros novos no arquivo.
> Nota: o deploy real acontece na Task 9 (junto com a validação), redeployando do conjunto em produção.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/publish-familia-ml/index.ts
git commit -m "feat(m4): publish-familia-ml calcula pct e envia original_price quando flag on"
```

---

## Task 5: `atualizar.ts` — `original_price` no UPDATE (variações existentes e novas)

**Files:**
- Modify: `supabase/functions/_shared/ml/atualizar.ts`
- Test: `supabase/functions/_shared/ml/__tests__/atualizar.test.ts` (adicionar casos)

**Contexto:** hoje `montarVariacoesUpdate` envia só `available_quantity` (preserva o preço publicado). Para mostrar o selo, quando o desconto está ligado, a variação existente passa a enviar `price` (= preco_publicacao) **e** `original_price`. `montarVariacaoNova` ganha `original_price` igual ao CREATE.

- [ ] **Step 1: Escrever os testes que falham**

```typescript
import { montarVariacoesUpdate, montarVariacaoNova } from '../atualizar';

it('UPDATE com desconto: variação existente recebe price + original_price', () => {
  const atuais = [{ id: 'A', seller_custom_field: '1', available_quantity: 3 }];
  const desejados = [{ codigo: '1', estoque: 9 }];
  const precos = { '1': 12.29 };
  const out = montarVariacoesUpdate(atuais, desejados, undefined, { pct: 15, precoPorCodigo: precos });
  expect(out[0]).toMatchObject({ id: 'A', available_quantity: 9, price: 12.29, original_price: 14.46 });
});

it('UPDATE sem desconto: variação existente NÃO recebe price/original_price', () => {
  const atuais = [{ id: 'A', seller_custom_field: '1', available_quantity: 3 }];
  const out = montarVariacoesUpdate(atuais, [{ codigo: '1', estoque: 9 }]);
  expect(out[0]).toEqual({ id: 'A', available_quantity: 9 });
});

it('montarVariacaoNova com desconto adiciona original_price', () => {
  const v = { codigo: '2', cor: 'Rosa', estoque: 4, preco_publicacao: 12.29, gtin: null, ml_picture_id: null };
  const out = montarVariacaoNova(v, null, null, 'MLB255054', { pct: 15 });
  expect(out.price).toBe(12.29);
  expect(out.original_price).toBe(14.46);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run supabase/functions/_shared/ml/__tests__/atualizar.test.ts`
Esperado: FAIL (assinaturas não aceitam o param de desconto).

- [ ] **Step 3: Implementar**

Em `atualizar.ts`:
1. Importar a pura: `import { calcularPrecoDe } from '../preco/desconto.ts';`
2. `VariacaoNovaPut`: adicionar `original_price?: number;` após `price: number;`.
3. `VariacaoUpdate`: adicionar `price?: number; original_price?: number;`.
4. `montarVariacaoNova`: novo 5º param `desconto?: { pct: number } | null`; após montar `variation`, antes do GTIN:
```typescript
  if (desconto) {
    const de = calcularPrecoDe(variation.price, desconto.pct);
    if (de !== null) variation.original_price = de;
  }
```
5. `montarVariacoesUpdate`: novo 4º param `desconto?: { pct: number; precoPorCodigo: Record<string, number | null> } | null`; dentro do `.map`, após montar `base`:
```typescript
    if (desconto) {
      const preco = desconto.precoPorCodigo[codigo];
      if (preco != null) {
        const de = calcularPrecoDe(preco, desconto.pct);
        if (de !== null) { base.price = preco; base.original_price = de; }
      }
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run supabase/functions/_shared/ml/__tests__/atualizar.test.ts`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/atualizar.ts supabase/functions/_shared/ml/__tests__/atualizar.test.ts
git commit -m "feat(m4): UPDATE envia original_price (existentes e novas) quando flag on (adendo ADR-0016)"
```

---

## Task 6: `update-familia-ml` — passar o desconto no UPDATE

**Files:**
- Modify: `supabase/functions/update-familia-ml/index.ts`

- [ ] **Step 1: Implementar**

1. Importar: `import { pctEfetivo } from '../_shared/preco/desconto.ts';`
2. Dentro do `try`, após carregar `variacoes` (linha ~56), calcular o desconto:
```typescript
    let desconto: { pct: number; precoPorCodigo: Record<string, number | null> } | null = null;
    if (familia.exibir_com_desconto) {
      const { data: cfg } = await admin.from('configuracoes')
        .select('desconto_pct').eq('user_id', familia.user_id).maybeSingle();
      const global = cfg?.desconto_pct != null ? Number(cfg.desconto_pct) : 15;
      const fam = familia.desconto_pct != null ? Number(familia.desconto_pct) : null;
      const precoPorCodigo: Record<string, number | null> = {};
      for (const v of variacoes) precoPorCodigo[v.codigo] = v.preco_publicacao != null ? Number(v.preco_publicacao) : null;
      desconto = { pct: pctEfetivo(fam, global), precoPorCodigo };
    }
```
3. Passar para `montarVariacoesUpdate` (4º arg, mantendo o 3º como está):
```typescript
    const existentes = montarVariacoesUpdate(atual.variations, desejados, capa2Pic ? picsPorCodigo : undefined, desconto ?? undefined);
```
4. Passar para `montarVariacaoNova` (5º arg) no `.map` das novas:
```typescript
    const novasPut = novasComFoto.map((v) => montarVariacaoNova(
      { codigo: v.codigo, cor: v.cor, estoque: v.estoque, preco_publicacao: v.preco_publicacao, gtin: v.gtin, ml_picture_id: v.ml_picture_id },
      capaPic, capa2Pic, familia.categoria_ml_id as string | null,
      desconto ? { pct: desconto.pct } : null,
    ));
```

- [ ] **Step 2: Type-check** — `npx tsc --noEmit`, sem erros novos. (Deploy na Task 9.)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/update-familia-ml/index.ts
git commit -m "feat(m4): update-familia-ml envia original_price quando flag on"
```

---

## Task 7: Front — pura `desconto.ts` + data-layer (config + flags)

**Files:**
- Create: `src/lib/desconto.ts`, `src/lib/__tests__/desconto.test.ts`
- Modify: `src/lib/queries.ts`, `src/lib/tipos-dominio.ts`, `src/hooks/useFamiliaMutations.ts`
- Create: `src/hooks/useConfiguracoes.ts`

- [ ] **Step 1: Teste da pura (front) que falha**

```typescript
// src/lib/__tests__/desconto.test.ts
import { describe, it, expect } from 'vitest';
import { calcularPrecoDe, pctEfetivo } from '../desconto';

describe('calcularPrecoDe (front)', () => {
  it('12.29 @ 15% → 14.46', () => expect(calcularPrecoDe(12.29, 15)).toBe(14.46));
  it('pct 0 → null', () => expect(calcularPrecoDe(12.29, 0)).toBeNull());
  it('pct 100 → null', () => expect(calcularPrecoDe(1, 100)).toBeNull());
});
describe('pctEfetivo (front)', () => {
  it('override', () => expect(pctEfetivo(20, 15)).toBe(20));
  it('global', () => expect(pctEfetivo(null, 15)).toBe(15));
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/lib/__tests__/desconto.test.ts` → FAIL.

- [ ] **Step 3: Implementar a pura (front)**

```typescript
// src/lib/desconto.ts
export function calcularPrecoDe(preco: number, pct: number): number | null {
  if (preco <= 0 || pct <= 0 || pct >= 100) return null;
  return Math.round((preco / (1 - pct / 100)) * 100) / 100;
}
export function pctEfetivo(familiaPct: number | null, globalPct: number): number {
  return familiaPct ?? globalPct;
}
```

- [ ] **Step 4: Rodar e ver passar** — PASS.

- [ ] **Step 5: Adapter + tipos + mutations**

5a. `src/lib/tipos-dominio.ts` — na interface `Familia`, adicionar:
```typescript
  exibirComDesconto: boolean;
  descontoPct: number | null;
```
5b. `src/lib/queries.ts` — em `familiaFromRow`, no objeto retornado, adicionar:
```typescript
    exibirComDesconto: r.exibir_com_desconto,
    descontoPct: r.desconto_pct != null ? Number(r.desconto_pct) : null,
```
5c. `src/lib/queries.ts` — adicionar mutations e leitura de config (no fim do arquivo):
```typescript
export async function fetchDescontoPct(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 15;
  const { data } = await supabase.from('configuracoes')
    .select('desconto_pct').eq('user_id', user.id).maybeSingle();
  return data?.desconto_pct != null ? Number(data.desconto_pct) : 15;
}

export async function upsertDescontoPct(pct: number): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('sem sessão');
  const { error } = await supabase.from('configuracoes')
    .upsert({ user_id: user.id, desconto_pct: pct, atualizado_em: new Date().toISOString() });
  if (error) throw error;
}

export async function updateFamiliaExibirDesconto(familiaId: string, exibir: boolean): Promise<void> {
  const { error } = await supabase.from('familias')
    .update({ exibir_com_desconto: exibir }).eq('id', familiaId);
  if (error) throw error;
}

export async function updateFamiliaDescontoPct(familiaId: string, pct: number | null): Promise<void> {
  const { error } = await supabase.from('familias')
    .update({ desconto_pct: pct }).eq('id', familiaId);
  if (error) throw error;
}

export async function toggleDescontoLote(loteId: string, exibir: boolean): Promise<void> {
  const { error } = await supabase.from('familias')
    .update({ exibir_com_desconto: exibir }).eq('lote_id', loteId);
  if (error) throw error;
}
```

5d. `src/hooks/useConfiguracoes.ts` (novo):
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchDescontoPct, upsertDescontoPct } from '@/lib/queries';

export function useDescontoPct() {
  return useQuery({ queryKey: ['configuracoes', 'desconto_pct'], queryFn: fetchDescontoPct });
}
export function useSalvarDescontoPct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pct: number) => upsertDescontoPct(pct),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'desconto_pct'] }),
  });
}
```

5e. `src/hooks/useFamiliaMutations.ts` — adicionar:
```typescript
import { updateFamiliaExibirDesconto, updateFamiliaDescontoPct, toggleDescontoLote } from '@/lib/queries';

export function useUpdateExibirDesconto(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ familiaId, exibir }: { familiaId: string; exibir: boolean }) =>
      updateFamiliaExibirDesconto(familiaId, exibir),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}
export function useUpdateDescontoPctFamilia(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ familiaId, pct }: { familiaId: string; pct: number | null }) =>
      updateFamiliaDescontoPct(familiaId, pct),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}
export function useToggleDescontoLote(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (exibir: boolean) => toggleDescontoLote(loteId, exibir),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}
```

- [ ] **Step 6: Rodar testes + type-check**

Run: `npx vitest run src/lib/__tests__/desconto.test.ts && npx tsc --noEmit`
Esperado: PASS, sem erros de tipo.

- [ ] **Step 7: Commit**

```bash
git add src/lib/desconto.ts src/lib/__tests__/desconto.test.ts src/lib/queries.ts src/lib/tipos-dominio.ts src/hooks/useConfiguracoes.ts src/hooks/useFamiliaMutations.ts
git commit -m "feat(m4): front data-layer do desconto (pura + adapter + mutations + hooks)"
```

---

## Task 8: Front — UI (Configurações, FamiliaRow, toggle do lote)

**Files:**
- Modify: `src/pages/Configuracoes.tsx`, `src/components/familia-row.tsx`, `src/pages/Revisao.tsx`

- [ ] **Step 1: Configurações — card do % global**

Em `Configuracoes.tsx`, importar `useDescontoPct`, `useSalvarDescontoPct` e `useState`/`useEffect`; adicionar um `<Card>` após o de "Estratégia de preço":
```tsx
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Desconto de marketing</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Preço cheio riscado (selo "% OFF"). Sugestão 15%. O liga/desliga é por produto, na Revisão.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number" min={0} max={99} step={1}
              className="w-20 rounded border px-2 py-1 text-sm"
              value={pctInput}
              onChange={(e) => setPctInput(e.target.value)}
              onBlur={() => { const n = Number(pctInput); if (n >= 0 && n < 100) salvar.mutate(n); }}
            />
            <span className="text-sm">%</span>
            {salvar.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
            {salvar.isSuccess && !salvar.isPending && <span className="text-xs text-green-700">✓ Salvo</span>}
          </div>
        </Card>
```
Com estado: `const { data: pct } = useDescontoPct(); const salvar = useSalvarDescontoPct(); const [pctInput, setPctInput] = useState('15');` e `useEffect(() => { if (pct != null) setPctInput(String(pct)); }, [pct]);`

- [ ] **Step 2: FamiliaRow — checkbox "Exibir com desconto" + % + prévia**

Em `familia-row.tsx`, importar `calcularPrecoDe, pctEfetivo` de `@/lib/desconto`, `useDescontoPct` de `@/hooks/useConfiguracoes`, e `useUpdateExibirDesconto, useUpdateDescontoPctFamilia` de `@/hooks/useFamiliaMutations`. Adicionar, perto do bloco de preço (~linha 120), um controle:
```tsx
{(() => {
  const { data: globalPct } = useDescontoPct();
  const pct = pctEfetivo(familia.descontoPct, globalPct ?? 15);
  const de = calcularPrecoDe(familia.precoMin, pct);
  return (
    <div className="flex items-center gap-2 text-xs">
      <Checkbox
        checked={familia.exibirComDesconto}
        onCheckedChange={(v) => updExibir.mutate({ familiaId: familia.id, exibir: !!v })}
      />
      <span>Exibir com desconto</span>
      {familia.exibirComDesconto && (
        <>
          <input type="number" min={0} max={99} className="w-14 rounded border px-1"
            defaultValue={familia.descontoPct ?? globalPct ?? 15}
            onBlur={(e) => { const n = Number(e.target.value); updPct.mutate({ familiaId: familia.id, pct: Number.isFinite(n) ? n : null }); }} />
          <span>%</span>
          {de != null && (
            <span className="text-muted-foreground">
              <s>R$ {formatarBRL(de)}</s> · R$ {formatarBRL(familia.precoMin)} · {pct}% OFF
            </span>
          )}
        </>
      )}
    </div>
  );
})()}
```
Com os hooks no corpo do componente: `const updExibir = useUpdateExibirDesconto(familia.loteId); const updPct = useUpdateDescontoPctFamilia(familia.loteId);`

> Se chamar hooks dentro de IIFE quebrar as regras de hooks, extrair para um subcomponente `<DescontoControle familia={familia} />` no mesmo arquivo. Preferir o subcomponente.

- [ ] **Step 3: Revisao — botão toggle do lote**

Em `Revisao.tsx`, importar `useToggleDescontoLote`. No cabeçalho de ações da Revisão, adicionar:
```tsx
const toggleLote = useToggleDescontoLote(loteId);
const todasComDesconto = familias.length > 0 && familias.every((f) => f.exibirComDesconto);
// ...
<Button variant="outline" size="sm" onClick={() => toggleLote.mutate(!todasComDesconto)}>
  {todasComDesconto ? 'Desativar desconto no lote' : 'Ativar desconto no lote'}
</Button>
```
(Usar a lista `familias` já carregada na página; se o nome da variável diferir, ajustar.)

- [ ] **Step 4: Verificar build + type-check + lint**

Run: `npx tsc --noEmit && pnpm build && pnpm lint`
Esperado: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Configuracoes.tsx src/components/familia-row.tsx src/pages/Revisao.tsx
git commit -m "feat(m4): UI do desconto (config global, checkbox+% por familia, toggle por lote)"
```

---

## Task 9: Deploy + validação real (risco ML do original_price)

**Files:** nenhum (deploy + bug bash)

- [ ] **Step 1: Suíte completa verde** — `npx vitest run` → todos passam.

- [ ] **Step 2: Redeploy dos 2 workers via MCP**

Redeployar `publish-familia-ml` e `update-familia-ml` via `deploy_edge_function`, usando como base os arquivos **em produção** (capturados por `get_edge_function`) + os arquivos novos/alterados desta entrega (`_shared/preco/desconto.ts`, `_shared/ml/publicar.ts`, `_shared/ml/atualizar.ts`, `index.ts` de cada worker). `verify_jwt:false` em ambos.

- [ ] **Step 3: Publicar 1 anúncio real CREATE com o flag ligado**

Na Revisão de um lote real (token AVILBV): marcar "Exibir com desconto" numa família, publicar. Confirmar:
- o anúncio sobe sem erro 4xx;
- na página do ML aparece o **preço riscado + selo "% OFF"**.

Se o ML **ignorar** o `original_price` por variação → testar `original_price` no **nível do item** (ajustar `montarPayloadItem` para também setar `payload.price`/`payload.original_price` quando todas as variações têm o mesmo preço) e redeployar. Documentar o resultado.

- [ ] **Step 4: Validar UPDATE**

Numa família já publicada, ligar o flag e rodar o fluxo UPDATE; confirmar que o selo aparece sem quebrar o anúncio.

- [ ] **Step 5: Registrar o resultado**

Anotar no CLAUDE.md (histórico) o que o ML aceitou (item vs variação) e quaisquer ajustes. Se houve ajuste de payload, commitar.

---

## Task 10: Documentação — ADR novo + adendos

**Files:**
- Create: `docs/decisions/0017-tabela-configuracoes-e-desconto-marketing.md`
- Modify: `docs/decisions/0016-publicacao-update-reposicao-estoque.md` (adendo), `CLAUDE.md` (tabela de ADRs + histórico), `docs/TASKS.md`

- [ ] **Step 1: Escrever ADR-0017** (decisão: tabela `configuracoes` + estratégia de/para de marketing; contexto, decisão, consequências, e o achado da validação ML da Task 9).

- [ ] **Step 2: Adendo ao ADR-0016** — UPDATE passa a enviar `original_price`/`price` nas variações quando `exibir_com_desconto`; demais campos seguem preservados.

- [ ] **Step 3: Atualizar `CLAUDE.md`** — linha na tabela de ADRs (0017) + entrada no histórico. Atualizar `docs/TASKS.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/0017-tabela-configuracoes-e-desconto-marketing.md docs/decisions/0016-publicacao-update-reposicao-estoque.md CLAUDE.md docs/TASKS.md
git commit -m "docs(m4): ADR-0017 (configuracoes + desconto) + adendo ADR-0016"
```

---

## Self-review (cobertura do spec)

- §2.1 % global default 15 editável → Task 1 (coluna default 15) + Task 8 Step 1 (UI). ✓
- §2.2 override por família → Task 1 (`familias.desconto_pct`) + Task 7/8. ✓
- §2.3 opt-in por produto default off → Task 1 (`exibir_com_desconto default false`) + Task 8 Step 2. ✓
- §2.4 toggle por lote → Task 7 (`toggleDescontoLote`) + Task 8 Step 3. ✓
- §2.5 CREATE + UPDATE → Tasks 3-6. ✓
- §2.6 cálculo do "de" → Task 2 (pura) usada em CREATE/UPDATE/front. ✓
- §5 função pura TDD → Tasks 2 e 7. ✓
- §6 UI (config, revisão, lote) → Task 8. ✓
- §7 publicação → Tasks 3-6. ✓
- §8 risco ML validado com 1 publicação real → Task 9. ✓
- §12 ADRs → Task 10. ✓

Sem placeholders; assinaturas consistentes (`{ pct }` no CREATE; `{ pct, precoPorCodigo }` no UPDATE existente; `{ pct }` na variação nova).
