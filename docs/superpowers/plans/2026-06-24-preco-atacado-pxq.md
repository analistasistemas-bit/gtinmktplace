# Preço de atacado (PxQ) na publicação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir definir preço de atacado ("a partir de X un, Y% off", até 5 faixas) por família ou lote, aplicado ao publicar e sincronizado no update, via o recurso PxQ B2B do Mercado Livre.

**Architecture:** Faixas persistem em `familias.atacado` (jsonb). Um módulo puro monta o conjunto de preços (base + faixas, % → R$ absoluto) e um cliente faz `PUT /items/{id}/prices`. Os workers `publish-familia-ml` e `update-familia-ml` aplicam o PxQ como recurso separado pós-criação (best-effort, não derruba o anúncio). A UI da Revisão edita as faixas por família e por lote.

**Tech Stack:** React 18 + TS + Vite + TanStack Query (front), Supabase Edge Functions (Deno) + ML API (back), vitest (testes).

## Global Constraints

- Preço de atacado é **B2B-only**: cada faixa leva `context_restrictions: ["channel_marketplace","user_type_business"]`. Confirmado: conta AVILBV é `business` (CNPJ).
- ML exige **valor absoluto** por faixa: `amount = round2(precoBase × (1 − desconto_pct/100))`.
- Máximo **5** faixas. `min_unidades` inteiro ≥ 2, estritamente crescente; `desconto_pct` 1–99, crescente.
- PxQ **não** vai no `POST /items` — é chamada separada após o item existir.
- Aplicação de PxQ é **best-effort**: falha registra `atacado_status='erro'` + `atacado_erro`, **nunca** derruba o anúncio (mesmo padrão de descrição/catálogo).
- `precoBase` = preço de publicação da família (uniforme entre cores hoje): `variacoes.find(v => v.preco_publicacao != null)?.preco_publicacao`.
- Edge Functions idempotentes (CLAUDE.md). Tokens nunca em código.
- Shape de `FaixaAtacado`: `{ min_unidades: number; desconto_pct: number }` (snake_case, igual ao jsonb).

---

### Task 0: Spike — confirmar o contrato de escrita do PxQ (com Diego, item real, idempotente)

**Files:** nenhum (verificação manual; registrar resultado no PR/handoff).

**Contexto:** GET `/items/{id}/prices` retorna `{ id, prices: [...] }` (envelope confirmado, com as faixas B2B). O sub-path `/prices/standard/quantity` veio vazio no GET. Antes de codar `aplicarPxQ`, confirmar que o **write** é `PUT /items/{id}/prices` com `{ prices: [...] }` (round-trip do GET).

- [ ] **Step 1: Ler o estado atual de um item que já tem PxQ**

Item `MLB4806443015` já tem base R$16,75 + faixa R$15,90@5un (setado manualmente). Com o token válido do projeto (de `ml_credentials`, vault):

Run:
```bash
curl -s "https://api.mercadolibre.com/items/MLB4806443015/prices" \
  -H "Authorization: Bearer $ML_TOKEN" -H "show-all-prices: TRUE" | python3 -m json.tool
```
Expected: objeto `{ "id": "MLB4806443015", "prices": [ {base...}, {faixa min_purchase_unit:5...} ] }`. Anotar o shape EXATO de cada elemento (`type`, `amount`, `currency_id`, `conditions`).

- [ ] **Step 2: Re-aplicar o MESMO conjunto via PUT (idempotente — não altera a oferta)**

> Confirmar com Diego antes (mexe num anúncio real, ainda que sem mudança efetiva).

Monte `BODY` com EXATAMENTE os mesmos `prices` lidos no Step 1 e:
```bash
curl -s -X PUT "https://api.mercadolibre.com/items/MLB4806443015/prices" \
  -H "Authorization: Bearer $ML_TOKEN" -H "Content-Type: application/json" \
  -d "$BODY" -w "\nHTTP %{http_code}\n"
```
Expected: HTTP 200 e o GET do Step 1 repetido devolve o mesmo conjunto (faixa @5un preservada).

- [ ] **Step 3: Registrar o veredito**

Se o PUT `/items/{id}/prices` funcionar → `aplicarPxQ` usa esse endpoint/shape (já é o assumido na Task 2). Se o ML exigir o sub-path `/prices/standard/quantity` ou outro shape → **ajustar a URL/body em `aplicarPxQ` (Task 2, Step 3)** e nada mais (o resto do plano independe do detalhe de transporte). Anotar o veredito no handoff.

---

### Task 1: Migration — formalizar as colunas `atacado` em `familias`

**Files:**
- Create: `supabase/migrations/20260624120000_familias_atacado.sql`

As colunas já existem no banco remoto (criadas fora do controle). Esta migration as torna reproduzíveis (idempotente) e documenta o shape.

- [ ] **Step 1: Criar a migration**

```sql
-- Preço de atacado (PxQ B2B do ML) por família. Faixas em jsonb; status/erro da aplicação.
-- Colunas já existiam no remoto (criadas fora de migration em 2026-06-23); aqui formaliza-se
-- o schema de forma idempotente. Ver ADR-0041.
alter table public.familias
  add column if not exists atacado jsonb,
  add column if not exists atacado_status text,
  add column if not exists atacado_erro text;

comment on column public.familias.atacado is
  'Faixas de preço de atacado (PxQ B2B do ML): [{"min_unidades":int>=2,"desconto_pct":1..99}], máx 5, crescente. null/[] = sem atacado.';
comment on column public.familias.atacado_status is
  'Aplicação do PxQ no ML: null | pendente | aplicado | erro. Independe do status de publicação.';
comment on column public.familias.atacado_erro is
  'Mensagem do último erro ao aplicar o PxQ no ML.';
```

- [ ] **Step 2: Aplicar no banco e verificar**

Run (via Supabase MCP `apply_migration` ou CLI): aplicar o SQL acima. Depois:
```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='familias' and column_name like 'atacado%';
```
Expected: 3 linhas (`atacado`, `atacado_status`, `atacado_erro`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260624120000_familias_atacado.sql
git commit -m "feat(atacado): migration formaliza colunas atacado em familias (ADR-0041)"
```

---

### Task 2: Módulo PxQ no backend — `_shared/ml/atacado.ts` (puro + cliente)

**Files:**
- Create: `supabase/functions/_shared/ml/atacado.ts`
- Test: `supabase/functions/_shared/ml/__tests__/atacado.test.ts`

**Interfaces:**
- Produces: `FaixaAtacado { min_unidades: number; desconto_pct: number }`; `amountComDesconto(precoBase: number, pct: number): number`; `montarFaixasPxQ(precoBase: number, faixas: FaixaAtacado[]): PrecoPxQ[]`; `aplicarPxQ(token: string, itemId: string, precoBase: number, faixas: FaixaAtacado[]): Promise<void>`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// supabase/functions/_shared/ml/__tests__/atacado.test.ts
import { describe, it, expect } from 'vitest';
import { amountComDesconto, montarFaixasPxQ } from '../atacado';

describe('amountComDesconto', () => {
  it('converte % em valor absoluto arredondado a 2 casas', () => {
    expect(amountComDesconto(12.55, 5)).toBe(11.92);
    expect(amountComDesconto(100, 10)).toBe(90);
  });
});

describe('montarFaixasPxQ', () => {
  it('sem faixas → só a base (preço cheio, sem restrição)', () => {
    const r = montarFaixasPxQ(16.75, []);
    expect(r).toEqual([
      { type: 'standard', amount: 16.75, currency_id: 'BRL', conditions: { context_restrictions: [] } },
    ]);
  });

  it('com faixas → base + faixas B2B ordenadas por min_unidades', () => {
    const r = montarFaixasPxQ(100, [
      { min_unidades: 10, desconto_pct: 8 },
      { min_unidades: 5, desconto_pct: 5 },
    ]);
    expect(r[0]).toEqual({ type: 'standard', amount: 100, currency_id: 'BRL', conditions: { context_restrictions: [] } });
    expect(r[1]).toEqual({
      type: 'standard', amount: 95, currency_id: 'BRL',
      conditions: { context_restrictions: ['channel_marketplace', 'user_type_business'], min_purchase_unit: 5 },
    });
    expect(r[2]).toEqual({
      type: 'standard', amount: 92, currency_id: 'BRL',
      conditions: { context_restrictions: ['channel_marketplace', 'user_type_business'], min_purchase_unit: 10 },
    });
  });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm exec vitest run supabase/functions/_shared/ml/__tests__/atacado.test.ts`
Expected: FAIL ("Cannot find module '../atacado'").

- [ ] **Step 3: Implementar o módulo**

```ts
// supabase/functions/_shared/ml/atacado.ts
export interface FaixaAtacado {
  min_unidades: number;
  desconto_pct: number;
}

export interface PrecoPxQ {
  type: 'standard';
  amount: number;
  currency_id: 'BRL';
  conditions: {
    context_restrictions: string[];
    min_purchase_unit?: number;
  };
}

/** Valor absoluto a partir do preço-base e do % de desconto. Arredonda a 2 casas. */
export function amountComDesconto(precoBase: number, pct: number): number {
  return Math.round(precoBase * (1 - pct / 100) * 100) / 100;
}

/**
 * Conjunto completo de preços PxQ: base (preço cheio, sem restrição) + faixas B2B.
 * faixas vazio → só a base (usado para LIMPAR o PxQ no ML). Ordena por min_unidades.
 */
export function montarFaixasPxQ(precoBase: number, faixas: FaixaAtacado[]): PrecoPxQ[] {
  const base: PrecoPxQ = {
    type: 'standard', amount: precoBase, currency_id: 'BRL',
    conditions: { context_restrictions: [] },
  };
  const tiers: PrecoPxQ[] = [...faixas]
    .sort((a, b) => a.min_unidades - b.min_unidades)
    .map((f) => ({
      type: 'standard',
      amount: amountComDesconto(precoBase, f.desconto_pct),
      currency_id: 'BRL',
      conditions: {
        context_restrictions: ['channel_marketplace', 'user_type_business'],
        min_purchase_unit: f.min_unidades,
      },
    }));
  return [base, ...tiers];
}

/**
 * Aplica o conjunto de preços PxQ no item (recurso separado, pós-criação).
 * PUT /items/{id}/prices com { prices: [...] } — round-trip do GET (ver Task 0).
 * Idempotente (PUT sobrescreve o conjunto). Lança em erro HTTP.
 */
export async function aplicarPxQ(
  token: string, itemId: string, precoBase: number, faixas: FaixaAtacado[],
): Promise<void> {
  const prices = montarFaixasPxQ(precoBase, faixas);
  const resp = await fetch(`https://api.mercadolibre.com/items/${itemId}/prices`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prices }),
  });
  if (!resp.ok) throw new Error(`PxQ (${resp.status}): ${await resp.text()}`);
}
```

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm exec vitest run supabase/functions/_shared/ml/__tests__/atacado.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/atacado.ts supabase/functions/_shared/ml/__tests__/atacado.test.ts
git commit -m "feat(atacado): módulo PxQ (montarFaixasPxQ + aplicarPxQ) com testes"
```

---

### Task 3: Conector — expor `aplicarAtacado` no contrato e no ML

**Files:**
- Modify: `supabase/functions/_shared/canais/contrato.ts` (Capabilities + ChannelConnector)
- Modify: `supabase/functions/_shared/canais/mercado-livre.ts`

**Interfaces:**
- Consumes: `FaixaAtacado`, `aplicarPxQ` (Task 2).
- Produces: `ChannelConnector.aplicarAtacado(ctx, itemExternoId, precoBase, faixas): Promise<void>`; `Capabilities.atacado: boolean`.

- [ ] **Step 1: Adicionar a capability e o método ao contrato**

Em `contrato.ts`, dentro de `interface Capabilities` (após `desconto: boolean;`):
```ts
  atacado: boolean;          // preço por quantidade (PxQ B2B)
```

No topo de `contrato.ts`, junto aos imports de tipo, adicionar:
```ts
import type { FaixaAtacado } from '../ml/atacado.ts';
```

Em `interface ChannelConnector`, após `garantirDescricao(...)`:
```ts
  /** Aplica preço de atacado (PxQ B2B) no item já criado. faixas vazio = limpa. Lança em falha. */
  aplicarAtacado(ctx: ContextoCanal, itemExternoId: string, precoBase: number, faixas: FaixaAtacado[]): Promise<void>;
```

- [ ] **Step 2: Implementar no conector ML**

Em `mercado-livre.ts`, adicionar ao import de `'../ml/...'`:
```ts
import { aplicarPxQ } from '../ml/atacado.ts';
```
Em `capabilities`, após `desconto: true,`:
```ts
    atacado: true,
```
Adicionar o método (após `garantirDescricao`):
```ts
  async aplicarAtacado(ctx: ContextoCanal, itemExternoId: string, precoBase: number, faixas): Promise<void> {
    const token = await ctx.getToken();
    await aplicarPxQ(token, itemExternoId, precoBase, faixas);
  },
```

- [ ] **Step 3: Verificar typecheck**

Run: `pnpm exec tsc -p tsconfig.json --noEmit` (ou o typecheck do projeto; se as edge functions usam check separado, rodar `deno check supabase/functions/_shared/canais/mercado-livre.ts`)
Expected: sem erros de tipo nos arquivos alterados.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/canais/contrato.ts supabase/functions/_shared/canais/mercado-livre.ts
git commit -m "feat(atacado): conector ML expõe aplicarAtacado + capability"
```

---

### Task 4: Worker `publish-familia-ml` — aplicar PxQ pós-criação + ramo já-publicado

**Files:**
- Modify: `supabase/functions/publish-familia-ml/index.ts`

**Interfaces:**
- Consumes: `conn.aplicarAtacado` (Task 3); `familia.atacado`, `familia.atacado_status` (Task 1).

- [ ] **Step 1: Importar o tipo**

Após os imports existentes (junto a `import { pctEfetivo } ...`):
```ts
import type { FaixaAtacado } from '../_shared/ml/atacado.ts';
```

- [ ] **Step 2: Garantir PxQ no ramo "item já publicado"**

No bloco `if (familia.ml_item_id) { ... }` (hoje só garante a descrição), antes do `return`, inserir:
```ts
    // Atacado (PxQ): garante a aplicação se há faixas e ainda não aplicado (retry/idempotência).
    const faixasJa = Array.isArray(familia.atacado) ? (familia.atacado as FaixaAtacado[]) : [];
    if (faixasJa.length > 0 && familia.atacado_status !== 'aplicado') {
      const { data: vs } = await admin.from('variacoes')
        .select('preco_publicacao').eq('familia_id', job.familia_id).eq('excluida_da_publicacao', false);
      const baseRaw = vs?.find((v) => v.preco_publicacao != null)?.preco_publicacao;
      const base = baseRaw != null ? Number(baseRaw) : null;
      if (base != null) {
        try {
          await conn.aplicarAtacado(ctx, familia.ml_item_id, base, faixasJa);
          await admin.from('familias').update({ atacado_status: 'aplicado', atacado_erro: null }).eq('id', job.familia_id);
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          console.error(`atacado (retry) falhou para ${familia.ml_item_id}:`, m);
          await admin.from('familias').update({ atacado_status: 'erro', atacado_erro: m }).eq('id', job.familia_id);
        }
      }
    }
```

- [ ] **Step 3: Aplicar PxQ após criar o item**

Logo após o bloco que casa `ml_variation_id` por código (o `for (const [codigo, variationId] of Object.entries(ref.variacoesExternas))`), antes do bloco de catálogo, inserir:
```ts
    // Atacado (PxQ B2B): recurso separado pós-criação. Best-effort — não derruba o anúncio.
    const faixasAtacado = Array.isArray(familia.atacado) ? (familia.atacado as FaixaAtacado[]) : [];
    if (faixasAtacado.length > 0) {
      const baseRaw = ordenadas.find((v) => v.preco_publicacao != null)?.preco_publicacao;
      const base = baseRaw != null ? Number(baseRaw) : null;
      if (base != null) {
        try {
          await conn.aplicarAtacado(ctx, ref.itemExternoId, base, faixasAtacado);
          await admin.from('familias').update({ atacado_status: 'aplicado', atacado_erro: null }).eq('id', job.familia_id);
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          console.error(`atacado falhou para ${ref.itemExternoId}:`, m);
          await admin.from('familias').update({ atacado_status: 'erro', atacado_erro: m }).eq('id', job.familia_id);
        }
      }
    }
```

- [ ] **Step 4: Typecheck**

Run: `deno check supabase/functions/publish-familia-ml/index.ts` (ou o check do projeto).
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/publish-familia-ml/index.ts
git commit -m "feat(atacado): publish-familia-ml aplica PxQ pós-criação (best-effort)"
```

---

### Task 5: Worker `update-familia-ml` — sincronizar (reaplicar/limpar) PxQ

**Files:**
- Modify: `supabase/functions/update-familia-ml/index.ts`

**Interfaces:**
- Consumes: `conn.aplicarAtacado` (Task 3); `precoFamilia` (já calculado no worker).

- [ ] **Step 1: Importar o tipo**

Junto aos imports:
```ts
import type { FaixaAtacado } from '../_shared/ml/atacado.ts';
```

- [ ] **Step 2: Reaplicar/limpar PxQ após o update bem-sucedido**

Após o `await admin.from('familias').update({ status: 'publicado', publicado_em: ... })` (≈ linha 190), antes do bloco de catálogo, inserir:
```ts
    // Atacado (PxQ): sincroniza com o preço atual. Com faixas → reaplica; sem faixas mas já
    // aplicado antes → limpa (envia só a base). Best-effort, não derruba o update.
    const faixasAtacado = Array.isArray(familia.atacado) ? (familia.atacado as FaixaAtacado[]) : [];
    if (precoFamilia != null && (faixasAtacado.length > 0 || familia.atacado_status === 'aplicado')) {
      try {
        await conn.aplicarAtacado(ctx, familia.ml_item_id, precoFamilia, faixasAtacado);
        await admin.from('familias')
          .update({ atacado_status: faixasAtacado.length > 0 ? 'aplicado' : null, atacado_erro: null })
          .eq('id', job.familia_id);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        console.error(`atacado (update) falhou para ${familia.ml_item_id}:`, m);
        await admin.from('familias').update({ atacado_status: 'erro', atacado_erro: m }).eq('id', job.familia_id);
      }
    }
```

- [ ] **Step 3: Typecheck**

Run: `deno check supabase/functions/update-familia-ml/index.ts`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/update-familia-ml/index.ts
git commit -m "feat(atacado): update-familia-ml sincroniza PxQ (reaplica/limpa)"
```

---

### Task 6: Front — lib `src/lib/atacado.ts` + tipo no domínio + mapper

**Files:**
- Create: `src/lib/atacado.ts`
- Test: `src/lib/__tests__/atacado.test.ts` (ou ao lado, conforme convenção do projeto — ver `src/lib` para o padrão de testes)
- Modify: `src/lib/tipos-dominio.ts`
- Modify: `src/lib/queries.ts` (mapper `familiaFromRow`, ≈ linha 305)

**Interfaces:**
- Produces: `FaixaAtacado { min_unidades: number; desconto_pct: number }`; `MAX_FAIXAS = 5`; `amountComDesconto(precoBase, pct): number`; `validarFaixas(faixas): string | null`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// src/lib/__tests__/atacado.test.ts
import { describe, it, expect } from 'vitest';
import { amountComDesconto, validarFaixas } from '../atacado';

describe('amountComDesconto', () => {
  it('converte % em R$ arredondado', () => {
    expect(amountComDesconto(100, 10)).toBe(90);
    expect(amountComDesconto(12.55, 5)).toBe(11.92);
  });
});

describe('validarFaixas', () => {
  it('aceita vazio', () => expect(validarFaixas([])).toBeNull());
  it('aceita faixas crescentes válidas', () => {
    expect(validarFaixas([{ min_unidades: 5, desconto_pct: 5 }, { min_unidades: 10, desconto_pct: 8 }])).toBeNull();
  });
  it('rejeita min_unidades < 2', () => {
    expect(validarFaixas([{ min_unidades: 1, desconto_pct: 5 }])).toMatch(/≥ 2/);
  });
  it('rejeita desconto fora de 1..99', () => {
    expect(validarFaixas([{ min_unidades: 5, desconto_pct: 0 }])).toMatch(/1% e 99%/);
  });
  it('rejeita desconto não-crescente', () => {
    expect(validarFaixas([{ min_unidades: 5, desconto_pct: 8 }, { min_unidades: 10, desconto_pct: 8 }])).toMatch(/mais desconto/);
  });
  it('rejeita mais de 5 faixas', () => {
    const f = [2, 3, 4, 5, 6, 7].map((n, i) => ({ min_unidades: n, desconto_pct: i + 1 }));
    expect(validarFaixas(f)).toMatch(/Máximo de 5/);
  });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm exec vitest run src/lib/__tests__/atacado.test.ts`
Expected: FAIL ("Cannot find module '../atacado'").

- [ ] **Step 3: Implementar a lib**

```ts
// src/lib/atacado.ts
export interface FaixaAtacado {
  min_unidades: number;
  desconto_pct: number;
}

export const MAX_FAIXAS = 5;

/** Valor absoluto a partir do preço-base e do % de desconto. Arredonda a 2 casas. */
export function amountComDesconto(precoBase: number, pct: number): number {
  return Math.round(precoBase * (1 - pct / 100) * 100) / 100;
}

/** Valida o conjunto de faixas. Retorna null se ok, ou a mensagem do 1º erro. */
export function validarFaixas(faixas: FaixaAtacado[]): string | null {
  if (faixas.length === 0) return null;
  if (faixas.length > MAX_FAIXAS) return `Máximo de ${MAX_FAIXAS} faixas.`;
  const ord = [...faixas].sort((a, b) => a.min_unidades - b.min_unidades);
  for (let i = 0; i < ord.length; i++) {
    const f = ord[i];
    if (!Number.isInteger(f.min_unidades) || f.min_unidades < 2) return 'Mínimo de unidades deve ser inteiro ≥ 2.';
    if (f.desconto_pct <= 0 || f.desconto_pct >= 100) return 'Desconto deve ser entre 1% e 99%.';
    if (i > 0) {
      if (ord[i].min_unidades === ord[i - 1].min_unidades) return 'Quantidades mínimas não podem repetir.';
      if (ord[i].desconto_pct <= ord[i - 1].desconto_pct) return 'Mais unidades deve dar mais desconto.';
    }
  }
  return null;
}
```

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm exec vitest run src/lib/__tests__/atacado.test.ts`
Expected: PASS.

- [ ] **Step 5: Adicionar o campo ao domínio e ao mapper**

Em `src/lib/tipos-dominio.ts`, no topo adicionar o import:
```ts
import type { FaixaAtacado } from './atacado';
```
Na `interface Familia`, após `descontoPct: number | null;` (≈ linha 156):
```ts
  atacado: FaixaAtacado[] | null;
```

Em `src/lib/queries.ts`, importar o tipo (junto aos imports de tipo do topo):
```ts
import type { FaixaAtacado } from './atacado';
```
No mapper `familiaFromRow` (onde estão `exibirComDesconto`/`descontoPct`, ≈ linha 305), adicionar:
```ts
    atacado: Array.isArray(r.atacado) ? (r.atacado as unknown as FaixaAtacado[]) : null,
```

- [ ] **Step 6: Typecheck + testes**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run src/lib/__tests__/atacado.test.ts`
Expected: sem erros de tipo; testes PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/atacado.ts src/lib/__tests__/atacado.test.ts src/lib/tipos-dominio.ts src/lib/queries.ts
git commit -m "feat(atacado): lib de faixas (validação + cálculo) + tipo no domínio"
```

---

### Task 7: Front — data-access + hooks de mutação

**Files:**
- Modify: `src/lib/queries.ts` (novas funções `updateFamiliaAtacado`, `setAtacadoLote`)
- Modify: `src/hooks/useFamiliaMutations.ts`

**Interfaces:**
- Consumes: `FaixaAtacado` (Task 6).
- Produces: `updateFamiliaAtacado(familiaId, faixas)`, `setAtacadoLote(loteId, faixas)`; hooks `useUpdateFamiliaAtacado(loteId)`, `useSetAtacadoLote(loteId)`.

- [ ] **Step 1: Funções de data-access**

Em `src/lib/queries.ts`, perto de `updateFamiliaDescontoPct`/`toggleDescontoLote`:
```ts
export async function updateFamiliaAtacado(familiaId: string, faixas: FaixaAtacado[]): Promise<void> {
  const { error } = await supabase.from('familias')
    .update({ atacado: faixas.length > 0 ? faixas : null, atacado_status: null, atacado_erro: null })
    .eq('id', familiaId);
  if (error) throw error;
}

export async function setAtacadoLote(loteId: string, faixas: FaixaAtacado[]): Promise<void> {
  const { error } = await supabase.from('familias')
    .update({ atacado: faixas.length > 0 ? faixas : null, atacado_status: null, atacado_erro: null })
    .eq('lote_id', loteId);
  if (error) throw error;
}
```
(Resetar `atacado_status`/`atacado_erro` ao editar força a reaplicação no próximo publish/update.)

- [ ] **Step 2: Hooks**

Em `src/hooks/useFamiliaMutations.ts`, adicionar ao import de `'@/lib/queries'`: `updateFamiliaAtacado, setAtacadoLote`. Adicionar ao import de tipos: `import type { FaixaAtacado } from '@/lib/atacado';`. Adicionar:
```ts
export function useUpdateFamiliaAtacado(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ familiaId, faixas }: { familiaId: string; faixas: FaixaAtacado[] }) =>
      updateFamiliaAtacado(familiaId, faixas),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}

export function useSetAtacadoLote(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (faixas: FaixaAtacado[]) => setAtacadoLote(loteId, faixas),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries.ts src/hooks/useFamiliaMutations.ts
git commit -m "feat(atacado): data-access + hooks de mutação (família + lote)"
```

---

### Task 8: Front — editor de faixas reutilizável + controle por família

**Files:**
- Create: `src/components/atacado-editor.tsx`
- Modify: `src/components/familia-row.tsx`

**Interfaces:**
- Consumes: `FaixaAtacado`, `validarFaixas`, `amountComDesconto`, `MAX_FAIXAS` (Task 6); `useUpdateFamiliaAtacado` (Task 7).
- Produces: `<AtacadoEditor faixas precoBase onChange />` (controlado); `AtacadoControle` interno de `familia-row`.

- [ ] **Step 1: Editor reutilizável**

```tsx
// src/components/atacado-editor.tsx
import { Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { amountComDesconto, validarFaixas, MAX_FAIXAS, type FaixaAtacado } from '@/lib/atacado';

interface Props {
  faixas: FaixaAtacado[];
  precoBase: number;
  onChange: (faixas: FaixaAtacado[]) => void;
}

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Editor controlado de até 5 faixas de atacado (min unidades + % off) com preview. */
export function AtacadoEditor({ faixas, precoBase, onChange }: Props) {
  const erro = validarFaixas(faixas);

  function set(i: number, campo: keyof FaixaAtacado, valor: number) {
    onChange(faixas.map((f, idx) => (idx === i ? { ...f, [campo]: valor } : f)));
  }
  function remover(i: number) {
    onChange(faixas.filter((_, idx) => idx !== i));
  }
  function adicionar() {
    const ultimo = faixas[faixas.length - 1];
    onChange([...faixas, {
      min_unidades: ultimo ? ultimo.min_unidades + 5 : 5,
      desconto_pct: ultimo ? Math.min(ultimo.desconto_pct + 2, 99) : 5,
    }]);
  }

  return (
    <div className="space-y-1.5">
      {faixas.map((f, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span>a partir de</span>
          <Input type="number" min={2} className="w-16"
            value={f.min_unidades}
            onChange={(e) => set(i, 'min_unidades', Math.trunc(Number(e.target.value)))} />
          <span>un ·</span>
          <Input type="number" min={1} max={99} className="w-14"
            value={f.desconto_pct}
            onChange={(e) => set(i, 'desconto_pct', Number(e.target.value))} />
          <span>% off</span>
          {precoBase > 0 && f.desconto_pct > 0 && f.desconto_pct < 100 && (
            <span className="text-muted-foreground">→ R$ {brl(amountComDesconto(precoBase, f.desconto_pct))}</span>
          )}
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
            aria-label="Remover faixa" onClick={() => remover(i)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      {faixas.length < MAX_FAIXAS && (
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={adicionar}>
          <Plus className="mr-1 h-3 w-3" /> Adicionar faixa
        </Button>
      )}
      {erro && <p className="text-xs text-destructive">{erro}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Controle por família em `familia-row.tsx`**

Adicionar imports no topo:
```ts
import { useState } from 'react';
import { useUpdateFamiliaAtacado } from '@/hooks/useFamiliaMutations';
import { validarFaixas, type FaixaAtacado } from '@/lib/atacado';
import { AtacadoEditor } from '@/components/atacado-editor';
```
Adicionar o componente `AtacadoControle` (perto de `DescontoControle`):
```tsx
function AtacadoControle({ familia }: { familia: Familia }) {
  const upd = useUpdateFamiliaAtacado(familia.loteId);
  const [faixas, setFaixas] = useState<FaixaAtacado[]>(familia.atacado ?? []);
  const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
  const base = incluidas.length > 0 ? incluidas : familia.variacoes;
  const precoBase = base.length > 0 ? Math.min(...base.map((v) => v.precoPublicacao ?? v.preco)) : 0;
  const ativo = faixas.length > 0;
  const erro = validarFaixas(faixas);
  const dirty = JSON.stringify(faixas) !== JSON.stringify(familia.atacado ?? []);

  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center gap-2">
        <Checkbox
          aria-label="Preço de atacado"
          checked={ativo}
          onCheckedChange={(v) => {
            if (v) setFaixas(faixas.length ? faixas : [{ min_unidades: 5, desconto_pct: 5 }]);
            else { setFaixas([]); upd.mutate({ familiaId: familia.id, faixas: [] }); }
          }}
        />
        <span>Preço de atacado</span>
        {familia.atacado && familia.atacado.length > 0 && (
          <span className="text-muted-foreground">({familia.atacado.length} faixa(s) salva(s))</span>
        )}
      </div>
      {ativo && (
        <div className="pl-6">
          <AtacadoEditor faixas={faixas} precoBase={precoBase} onChange={setFaixas} />
          <Button
            type="button" size="sm" className="mt-1 h-7 text-xs"
            disabled={!!erro || !dirty || upd.isPending}
            onClick={() => upd.mutate({ familiaId: familia.id, faixas })}
          >
            {upd.isPending ? 'Salvando…' : dirty ? 'Salvar atacado' : '✓ Salvo'}
          </Button>
        </div>
      )}
    </div>
  );
}
```
Renderizar `AtacadoControle` logo abaixo do `<DescontoControle familia={familia} />` (no bloco `px-4 pb-2 pl-[100px]`):
```tsx
        <DescontoControle familia={familia} />
        <AtacadoControle familia={familia} />
```

- [ ] **Step 3: Typecheck + build do front**

Run: `pnpm exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/atacado-editor.tsx src/components/familia-row.tsx
git commit -m "feat(atacado): editor de faixas + controle por família na Revisão"
```

---

### Task 9: Front — ação de lote + status na Revisão

**Files:**
- Modify: `src/pages/Revisao.tsx`

**Interfaces:**
- Consumes: `useSetAtacadoLote` (Task 7); `AtacadoEditor`, `validarFaixas`, `FaixaAtacado` (Tasks 6/8).

- [ ] **Step 1: Estado + hook + dialog de lote**

Adicionar imports:
```ts
import { useSetAtacadoLote } from '@/hooks/useFamiliaMutations';
import { AtacadoEditor } from '@/components/atacado-editor';
import { validarFaixas, type FaixaAtacado } from '@/lib/atacado';
```
Dentro do componente `Revisao`, junto aos outros `useState`/hooks:
```ts
  const setAtacadoLote = useSetAtacadoLote(loteId ?? '');
  const [atacadoAberto, setAtacadoAberto] = useState(false);
  const [faixasLote, setFaixasLote] = useState<FaixaAtacado[]>([{ min_unidades: 5, desconto_pct: 5 }]);
  const erroFaixasLote = validarFaixas(faixasLote);
```

- [ ] **Step 2: Botão no header (ao lado de "Ativar desconto no lote")**

No bloco `actions`, após o `<Button>` de desconto do lote:
```tsx
                <Button variant="outline" size="sm" onClick={() => setAtacadoAberto(true)}>
                  Atacado no lote
                </Button>
```

- [ ] **Step 3: Dialog do lote (perto do Dialog de publicação, antes do fechamento do componente)**

```tsx
      <Dialog open={atacadoAberto} onOpenChange={setAtacadoAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Preço de atacado no lote inteiro</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Aplica estas faixas a <strong>todas</strong> as {familias.length} famílias do lote
            (sobrescreve o atacado individual). O preço de cada família é o dela.
          </p>
          <AtacadoEditor faixas={faixasLote} precoBase={0} onChange={setFaixasLote} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFaixasLote([]); setAtacadoLote.mutate([], {
              onSuccess: () => { toast.success('Atacado removido de todas as famílias'); setAtacadoAberto(false); },
            }); }}>
              Remover de todas
            </Button>
            <Button disabled={!!erroFaixasLote || setAtacadoLote.isPending}
              onClick={() => setAtacadoLote.mutate(faixasLote, {
                onSuccess: () => { toast.success('Atacado aplicado a todas as famílias do lote'); setAtacadoAberto(false); },
                onError: (e) => toast.error('Falha ao aplicar atacado', { description: e instanceof Error ? e.message : String(e) }),
              })}>
              {setAtacadoLote.isPending ? 'Aplicando…' : 'Aplicar a todas'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 4: Status do atacado na linha publicada (em `familia-row.tsx`)**

> Pequeno acréscimo visual: na fileira de pills (bloco `{publicado && (...)}`), adicionar após o pill de publicado, dentro de `familia-row.tsx`:
```tsx
          {publicado && familia.atacado && familia.atacado.length > 0 && (
            <StatusPill
              tone={familia.atacadoStatus === 'erro' ? 'danger' : 'success'}
              title={familia.atacadoStatus === 'erro' ? (familia.atacadoErro ?? 'Falha no atacado') : 'Preço de atacado aplicado'}
            >
              {familia.atacadoStatus === 'erro' ? 'atacado ⚠' : 'atacado ✓'}
            </StatusPill>
          )}
```
Isso exige expor `atacadoStatus`/`atacadoErro` no domínio: em `tipos-dominio.ts` adicionar à `Familia`:
```ts
  atacadoStatus: string | null;
  atacadoErro: string | null;
```
E no mapper `familiaFromRow` (`queries.ts`):
```ts
    atacadoStatus: r.atacado_status ?? null,
    atacadoErro: r.atacado_erro ?? null,
```

- [ ] **Step 5: Typecheck + build**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: sem erros; build OK.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Revisao.tsx src/components/familia-row.tsx src/lib/tipos-dominio.ts src/lib/queries.ts
git commit -m "feat(atacado): ação de lote + status do atacado na Revisão"
```

---

### Task 10: Deploy + verificação end-to-end

**Files:** nenhum (deploy/verify).

> Regra do projeto: deploy de edge functions via CLI completa, nunca arquivo-a-arquivo; mudou `_shared` → redeployar todas as funções afetadas. Confirmar com Diego antes do deploy (publicação real).

- [ ] **Step 1: Rodar a suíte completa**

Run: `pnpm test`
Expected: todos os testes PASS (incl. `atacado` back e front).

- [ ] **Step 2: Regenerar os tipos do Supabase (se necessário)**

Run: gerar `src/lib/database.types.ts` (MCP `generate_typescript_types` ou CLI) e conferir que `familias.atacado*` estão presentes. Commit se mudou.

- [ ] **Step 3: Deploy das functions afetadas**

Functions que importam `_shared/ml/atacado.ts` ou `_shared/canais/*`: `publish-familia-ml`, `update-familia-ml` (e quaisquer outras que importem o conector). Deploy via CLI:
```bash
supabase functions deploy publish-familia-ml update-familia-ml --project-ref txvncrgkoynoxwopfkbp
```
(Com `SUPABASE_ACCESS_TOKEN` do `.env.local`; manter `verify_jwt=false` onde já era — workers do QStash.) Verificar a versão pós-deploy.

- [ ] **Step 4: Verificação E2E (com Diego, lote de teste)**

1. Na Revisão de um lote, ativar atacado numa família (ex.: 5 un = 5%, 10 un = 8%), Salvar.
2. Publicar a família.
3. Conferir no ML: `GET /items/{novo_id}/prices` deve trazer base + faixas B2B com `min_purchase_unit` e `context_restrictions`.
4. `familias.atacado_status` = `'aplicado'`.
5. Editar o preço da família e disparar UPDATE → conferir que os `amount` das faixas recalcularam.
6. Desativar o atacado e dar UPDATE → conferir que as faixas sumiram (só a base).

Expected: faixas aplicadas/recalculadas/limpas conforme acima; pill "atacado ✓" na linha.

---

## Self-Review (preenchido)

**Spec coverage:**
- Modelo de dados (familias.atacado*) → Task 1, 6, 7. ✓
- %→R$ absoluto → Task 2 (`amountComDesconto`), Task 6 (front). ✓
- Cliente PxQ / endpoint → Task 0 (contrato) + Task 2 (`aplicarPxQ`). ✓
- Conector `aplicarAtacado` + capability → Task 3. ✓
- Aplicar ao publicar + ramo já-publicado → Task 4. ✓
- Sincronizar no update (reaplica/limpa) → Task 5. ✓
- UI por família → Task 8. UI por lote → Task 9. Status inline → Task 9. ✓
- Validação de faixas → Task 6 (`validarFaixas`), usada em 8 e 9. ✓
- Migration formaliza colunas → Task 1. ✓
- Deploy CLI das functions afetadas → Task 10. ✓

**Placeholders:** nenhum `TODO`/`TBD`; `<ts>` da migration resolvido para `20260624120000`. ✓

**Type consistency:** `FaixaAtacado { min_unidades; desconto_pct }` idêntico em back (`_shared/ml/atacado.ts`) e front (`src/lib/atacado.ts`); `aplicarAtacado(ctx, itemExternoId, precoBase, faixas)` consistente entre contrato/conector/workers; `montarFaixasPxQ`/`amountComDesconto` com mesma assinatura nos testes e na implementação. ✓

## Fora de escopo (reafirmado)
Padrão salvo global (`configuracoes.atacado_default`); faixa por-variação; campanhas VOLUME (`/seller-promotions`); atacado em outros canais.
