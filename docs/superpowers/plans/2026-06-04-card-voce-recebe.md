# Card "Você recebe por venda" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar na Revisão, por família, quanto o operador recebe por venda (preço − comissão exata do ML), comparando anúncio Clássico vs Premium, com alerta genérico de frete acima de R$19.

**Architecture:** Função pura `montarTarifa` (testável) decompõe a resposta do endpoint `/sites/MLB/listing_prices` do ML. Uma edge function `calcular-tarifa-ml` chama esse endpoint 2× (Clássico/Premium) com o token do Vault, cacheia no Redis e é resiliente a falhas. O frontend consome via hook TanStack Query (recalcula quando o preço muda) e renderiza um card no Painel de Análise.

**Tech Stack:** Deno (edge functions), TypeScript, Supabase, Upstash Redis, React, TanStack Query, vitest. Spec: `docs/superpowers/specs/2026-06-04-card-voce-recebe-revisao-design.md`.

---

## File Structure

- **Create** `supabase/functions/_shared/ml/tarifa.ts` — função pura `montarTarifa` + tipos `ListingPriceML`, `TarifaTipo`, `Tarifa`.
- **Create** `supabase/functions/_shared/ml/__tests__/tarifa.test.ts` — testes da função pura.
- **Create** `supabase/functions/calcular-tarifa-ml/index.ts` — edge (requireUser → 2× listing_prices → cache Redis → montarTarifa).
- **Create** `src/lib/tarifa.ts` — client lib `calcularTarifaML` + tipos espelhados.
- **Create** `src/hooks/useTarifaML.ts` — hook TanStack Query.
- **Create** `src/components/card-voce-recebe.tsx` — componente visual.
- **Create** `tests/components/card-voce-recebe.test.tsx` — teste do componente.
- **Modify** `src/components/painel-analise.tsx` — grid 2 colunas (Potencial | Você recebe).

Convenções seguidas: edge chamada pelo frontend usa `requireUser` (igual `publicar-familias`); client lib usa `supabase.auth.getSession()` + fetch (igual `src/lib/ai-copy.ts`); helpers Redis de `_shared/redis/client.ts`; token via `getValidAccessToken` (`_shared/ml/token.ts`).

---

### Task 1: Função pura `montarTarifa`

**Files:**
- Create: `supabase/functions/_shared/ml/tarifa.ts`
- Test: `supabase/functions/_shared/ml/__tests__/tarifa.test.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/ml/__tests__/tarifa.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { montarTarifa } from '../tarifa';

const classico = { sale_fee_amount: 7.68, sale_fee_details: { percentage_fee: 11.5, fixed_fee: 6.24 } };
const premium = { sale_fee_amount: 8.30, sale_fee_details: { percentage_fee: 16.5, fixed_fee: 6.24 } };

describe('montarTarifa', () => {
  it('decompõe comissão e calcula o líquido (recebe = preço - comissão)', () => {
    const t = montarTarifa(12.50, classico, premium);
    expect(t.classico).toEqual({ comissao: 7.68, percentual: 11.5, fixa: 6.24, recebe: 4.82 });
    expect(t.premium).toEqual({ comissao: 8.30, percentual: 16.5, fixa: 6.24, recebe: 4.20 });
  });
  it('arredonda o líquido para 2 casas', () => {
    const t = montarTarifa(10, { sale_fee_amount: 3.333, sale_fee_details: { percentage_fee: 12, fixed_fee: 2.13 } }, premium);
    expect(t.classico.recebe).toBe(6.67); // 10 - 3.333 = 6.667 -> 6.67
  });
  it('item acima de R$29 não tem tarifa fixa (fixed_fee 0)', () => {
    const semFixa = { sale_fee_amount: 3.6, sale_fee_details: { percentage_fee: 12, fixed_fee: 0 } };
    const t = montarTarifa(30, semFixa, semFixa);
    expect(t.classico.fixa).toBe(0);
    expect(t.classico.recebe).toBe(26.4);
  });
  it('tolera sale_fee_details ausente (assume 0 em % e fixa)', () => {
    const t = montarTarifa(20, { sale_fee_amount: 2.3 }, { sale_fee_amount: 2.3 });
    expect(t.classico.percentual).toBe(0);
    expect(t.classico.fixa).toBe(0);
    expect(t.classico.recebe).toBe(17.7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tarifa`
Expected: FAIL — `montarTarifa` não existe / módulo não encontrado.

- [ ] **Step 3: Write minimal implementation**

Create `supabase/functions/_shared/ml/tarifa.ts`:

```ts
export interface ListingPriceML {
  sale_fee_amount: number;
  sale_fee_details?: { percentage_fee?: number; fixed_fee?: number };
}

export interface TarifaTipo {
  comissao: number;
  percentual: number;
  fixa: number;
  recebe: number;
}

export interface Tarifa {
  classico: TarifaTipo;
  premium: TarifaTipo;
}

function arredondar2(n: number): number {
  return Math.round(n * 100) / 100;
}

function tipo(preco: number, lp: ListingPriceML): TarifaTipo {
  const comissao = lp.sale_fee_amount ?? 0;
  return {
    comissao,
    percentual: lp.sale_fee_details?.percentage_fee ?? 0,
    fixa: lp.sale_fee_details?.fixed_fee ?? 0,
    recebe: arredondar2(preco - comissao),
  };
}

/**
 * Decompõe a resposta de /sites/MLB/listing_prices (Clássico e Premium) num resumo
 * de quanto o operador recebe por venda. `recebe = preço − comissão` (ADR-0008 §card).
 */
export function montarTarifa(
  preco: number,
  classicoML: ListingPriceML,
  premiumML: ListingPriceML,
): Tarifa {
  return { classico: tipo(preco, classicoML), premium: tipo(preco, premiumML) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tarifa`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/tarifa.ts supabase/functions/_shared/ml/__tests__/tarifa.test.ts
git commit -m "feat(m4): montarTarifa decompoe comissao ML e calcula liquido (TDD)"
```

---

### Task 2: Edge function `calcular-tarifa-ml`

**Files:**
- Create: `supabase/functions/calcular-tarifa-ml/index.ts`

Esta edge não tem teste unitário (restrição do vitest com fetch/token, igual às demais edges) — validada no bug bash (Task 7).

- [ ] **Step 1: Write the edge**

Create `supabase/functions/calcular-tarifa-ml/index.ts`:

```ts
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { redisGet, redisSet } from '../_shared/redis/client.ts';
import { montarTarifa, type ListingPriceML } from '../_shared/ml/tarifa.ts';

const CACHE_TTL_S = 6 * 60 * 60; // 6h — comissões mudam raramente

async function listingPrice(
  token: string,
  preco: number,
  categoria: string,
  listingType: string,
): Promise<ListingPriceML> {
  const url = `https://api.mercadolibre.com/sites/MLB/listing_prices?price=${preco}&category_id=${categoria}&listing_type_id=${listingType}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`listing_prices ${listingType} ${resp.status}: ${await resp.text()}`);
  return resp.json() as Promise<ListingPriceML>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let user;
  try { user = await requireUser(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const { preco, categoria_ml_id } = await req.json().catch(() => ({}));
  if (typeof preco !== 'number' || preco <= 0 || typeof categoria_ml_id !== 'string' || !categoria_ml_id) {
    return new Response('preco (>0) e categoria_ml_id obrigatórios', { status: 400, headers: corsHeaders });
  }

  const precoKey = preco.toFixed(2);
  const cacheKey = `tarifa:${categoria_ml_id}:${precoKey}`;
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const cached = await redisGet(cacheKey);
    if (cached) return json(JSON.parse(cached));

    const token = await getValidAccessToken(user.id);
    const [classicoML, premiumML] = await Promise.all([
      listingPrice(token, preco, categoria_ml_id, 'gold_special'),
      listingPrice(token, preco, categoria_ml_id, 'gold_pro'),
    ]);
    const tarifa = montarTarifa(preco, classicoML, premiumML);

    await redisSet(cacheKey, JSON.stringify(tarifa), CACHE_TTL_S);
    return json(tarifa);
  } catch (err) {
    // Resiliente: não quebra a Revisão; o card mostra "indisponível".
    console.error('calcular-tarifa-ml falhou:', err);
    return json({ erro: true });
  }
});
```

- [ ] **Step 2: Deploy via MCP**

Deploy com `mcp__supabase-mcp-server__deploy_edge_function` (project_id `txvncrgkoynoxwopfkbp`, `verify_jwt: false`, entrypoint `index.ts`). Incluir os arquivos: `index.ts` + `_shared/cors.ts`, `_shared/auth.ts`, `_shared/supabase.ts`, `_shared/redis/client.ts`, `_shared/ml/token.ts`, `_shared/ml/refresh-decisao.ts`, `_shared/ml/tarifa.ts` (com imports reescritos de `../_shared/` → `./_shared/` no index, preservando os imports relativos internos dos `_shared`).
Expected: resposta com `"status":"ACTIVE"`, version nova.

- [ ] **Step 3: Smoke test da edge (sem corpo válido → 400)**

Verificar que responde (não precisa de JWT real aqui; só confirmar que subiu):
Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/calcular-tarifa-ml"`
Expected: `401` (sem bearer) — confirma que a edge está no ar e exige auth.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/calcular-tarifa-ml/index.ts
git commit -m "feat(m4): edge calcular-tarifa-ml (listing_prices Classico/Premium + cache + resiliente)"
```

---

### Task 3: Client lib `calcularTarifaML`

**Files:**
- Create: `src/lib/tarifa.ts`

- [ ] **Step 1: Write the client lib**

Create `src/lib/tarifa.ts`:

```ts
import { supabase } from './supabase';

export interface TarifaTipo {
  comissao: number;
  percentual: number;
  fixa: number;
  recebe: number;
}

export interface Tarifa {
  classico: TarifaTipo;
  premium: TarifaTipo;
}

/** Calcula a comissão ML (Clássico/Premium) para preço+categoria. null em falha/indisponível. */
export async function calcularTarifaML(
  preco: number,
  categoriaMlId: string,
): Promise<Tarifa | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');

  const r = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calcular-tarifa-ml`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ preco, categoria_ml_id: categoriaMlId }),
    },
  );
  if (!r.ok) return null;
  const data = await r.json();
  if (data?.erro) return null;
  return data as Tarifa;
}
```

- [ ] **Step 2: Verify build/types**

Run: `pnpm build`
Expected: build OK (sem erros de tipo).

- [ ] **Step 3: Commit**

```bash
git add src/lib/tarifa.ts
git commit -m "feat(m4): client lib calcularTarifaML"
```

---

### Task 4: Hook `useTarifaML`

**Files:**
- Create: `src/hooks/useTarifaML.ts`

- [ ] **Step 1: Write the hook**

Create `src/hooks/useTarifaML.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { calcularTarifaML, type Tarifa } from '@/lib/tarifa';

/**
 * Comissão ML (Clássico/Premium) para preço+categoria. Recalcula quando o preço muda
 * (faz parte da queryKey). `enabled` evita chamar sem categoria ou preço válido.
 */
export function useTarifaML(preco: number, categoriaMlId: string | null) {
  return useQuery<Tarifa | null>({
    queryKey: ['tarifa', categoriaMlId, preco],
    queryFn: () => calcularTarifaML(preco, categoriaMlId as string),
    enabled: !!categoriaMlId && preco > 0,
    staleTime: 6 * 60 * 60 * 1000, // 6h, alinhado ao cache da edge
  });
}
```

- [ ] **Step 2: Verify build/types**

Run: `pnpm build`
Expected: build OK.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useTarifaML.ts
git commit -m "feat(m4): hook useTarifaML (recalcula ao mudar o preco)"
```

---

### Task 5: Componente `CardVoceRecebe`

**Files:**
- Create: `src/components/card-voce-recebe.tsx`
- Test: `tests/components/card-voce-recebe.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/card-voce-recebe.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CardVoceRecebe } from '@/components/card-voce-recebe';

vi.mock('@/hooks/useTarifaML', () => ({
  useTarifaML: () => ({
    data: {
      classico: { comissao: 7.68, percentual: 11.5, fixa: 6.24, recebe: 4.82 },
      premium: { comissao: 8.30, percentual: 16.5, fixa: 6.24, recebe: 4.20 },
    },
    isLoading: false,
    isError: false,
  }),
}));

describe('CardVoceRecebe', () => {
  it('mostra o líquido de Clássico e Premium e destaca o maior', () => {
    render(<CardVoceRecebe preco={12.5} categoriaMlId="MLB270273" />);
    expect(screen.getByText(/R\$\s*4,82/)).toBeInTheDocument(); // Clássico (maior)
    expect(screen.getByText(/R\$\s*4,20/)).toBeInTheDocument(); // Premium
    expect(screen.getByText(/frete grátis acima de r\$\s*19/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- card-voce-recebe`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Write the component**

Create `src/components/card-voce-recebe.tsx`:

```tsx
import { Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL } from '@/lib/formato';
import { useTarifaML } from '@/hooks/useTarifaML';
import type { TarifaTipo } from '@/lib/tarifa';

function Coluna({ titulo, t, melhor }: { titulo: string; t: TarifaTipo; melhor: boolean }) {
  return (
    <div className={cn('rounded-md border p-2', melhor && 'border-blue-200 bg-blue-50')}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{titulo}</span>
        {melhor && <span className="text-[10px] font-semibold text-blue-700">melhor</span>}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-foreground">{fmtBRL(t.recebe)}</div>
      <div className="text-[11px] text-muted-foreground">
        comissão −{fmtBRL(t.comissao)} ({t.percentual}%)
      </div>
    </div>
  );
}

export function CardVoceRecebe({ preco, categoriaMlId }: { preco: number; categoriaMlId: string | null }) {
  const { data, isLoading, isError } = useTarifaML(preco, categoriaMlId);

  return (
    <div className="rounded-md border p-2">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Wallet className="h-3.5 w-3.5" /> Você recebe por venda
      </div>

      {!categoriaMlId ? (
        <p className="text-xs text-muted-foreground">defina a categoria para calcular</p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground">calculando…</p>
      ) : isError || !data ? (
        <p className="text-xs text-muted-foreground">tarifa indisponível</p>
      ) : (
        <>
          <p className="mb-1 text-xs text-muted-foreground">
            preço de publicação <span className="font-medium text-foreground">{fmtBRL(preco)}</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Coluna titulo="Clássico" t={data.classico} melhor={data.classico.recebe >= data.premium.recebe} />
            <Coluna titulo="Premium" t={data.premium} melhor={data.premium.recebe > data.classico.recebe} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            ℹ️ Acima de R$19, o Mercado Livre dá frete grátis ao comprador por sua conta (varia por região).
          </p>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- card-voce-recebe`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/card-voce-recebe.tsx tests/components/card-voce-recebe.test.tsx
git commit -m "feat(m4): CardVoceRecebe (Classico vs Premium + alerta de frete)"
```

---

### Task 6: Integrar no Painel de Análise

**Files:**
- Modify: `src/components/painel-analise.tsx`

A seção final (hoje só "Potencial de venda", largura total) vira um grid de 2 colunas: Potencial à esquerda, "Você recebe" à direita.

- [ ] **Step 1: Importar o componente**

Em `src/components/painel-analise.tsx`, adicionar após os imports existentes (junto dos outros `@/components`):

```ts
import { CardVoceRecebe } from '@/components/card-voce-recebe';
```

- [ ] **Step 2: Envolver Potencial + Você recebe num grid**

Substituir o bloco que começa em `{familia.analiseMercado && (` (a seção "Potencial de venda", linhas ~100-134) por uma faixa em grid. O conteúdo interno do "Potencial de venda" permanece idêntico; só muda o wrapper para grid e adiciona a 2ª coluna:

```tsx
      <div className="grid grid-cols-2 gap-2">
        {familia.analiseMercado ? (
          <div className="rounded-md border p-2">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" /> Potencial de venda
            </div>
            <div className="flex flex-col gap-1 text-xs">
              {familia.concorrenciaPrecoMin != null && familia.analiseMercado.preco_max != null && (
                <span>
                  💲 Preço concorrentes:{' '}
                  <span className="font-medium text-foreground">
                    {fmtBRL(familia.concorrenciaPrecoMin)} – {fmtBRL(familia.analiseMercado.preco_max)}
                  </span>
                </span>
              )}
              <span>
                📈 {familia.analiseMercado.lideres}/{familia.concorrenciaVendedores} MercadoLíder
                {familia.analiseMercado.maior_vendas > 0 && (
                  <> · maior <span className="font-medium text-foreground">{fmtMilhar(familia.analiseMercado.maior_vendas)} vendas</span></>
                )}
              </span>
              <span>
                🚚 Frete grátis: {familia.analiseMercado.frete_gratis}/{familia.analiseMercado.total_ofertas}
                {' · '}⚡ FULL: {familia.analiseMercado.full}/{familia.analiseMercado.total_ofertas}
              </span>
              <span>
                🏆 {familia.analiseMercado.ranking_categoria != null
                  ? `#${familia.analiseMercado.ranking_categoria} mais vendido na categoria`
                  : 'fora do top de mais vendidos da categoria'}
              </span>
              {familia.analiseMercado.produto_desde && (
                <span className="text-muted-foreground">📅 no catálogo desde {familia.analiseMercado.produto_desde}</span>
              )}
            </div>
          </div>
        ) : (
          <div />
        )}
        <CardVoceRecebe preco={familia.precoMin} categoriaMlId={familia.categoriaMlId} />
      </div>
```

Nota sobre o preço: `familia.precoMin` reflete o preço de publicação da família (uniforme por produto). Se em revisão futura houver divergência entre `precoMin`/`precoMax`, manter `precoMin` (cenário conservador). O grid mantém o "Você recebe" alinhado mesmo quando não há `analiseMercado` (placeholder `<div />`).

- [ ] **Step 3: Verify build + lint + tests**

Run: `pnpm build && pnpm lint && pnpm test`
Expected: build OK, lint 0 erros (warnings pré-existentes ok), todos os testes verdes.

- [ ] **Step 4: Commit**

```bash
git add src/components/painel-analise.tsx
git commit -m "feat(m4): card Voce recebe ao lado do Potencial de venda no painel"
```

---

### Task 7: Bug bash (validação manual com token real)

**Files:** nenhum (validação).

- [ ] **Step 1: Garantir edge no ar**

Confirmar via `mcp__supabase-mcp-server__list_edge_functions` que `calcular-tarifa-ml` está `ACTIVE`.

- [ ] **Step 2: Push para o Render (frontend)**

Pedir OK ao Diego e `git push origin main`. Aguardar rebuild do Render (~1-2 min).

- [ ] **Step 3: Validar na UI**

- Abrir a Revisão (hard refresh), expandir uma família com categoria definida.
- Conferir que o card "Você recebe" aparece ao lado do "Potencial de venda", com Clássico e Premium e o líquido coerente.
- Editar o preço de uma cor → o card recalcula (novo líquido).
- Família sem categoria → card mostra "defina a categoria".

- [ ] **Step 4: Conferência cruzada**

Comparar o "recebe" exibido com o "Você recebe" do anúncio real no ML (deve bater ~centavos; diferença é desconto de reputação que a API não reflete).

- [ ] **Step 5: Atualizar CLAUDE.md**

Registrar na tabela de histórico do `CLAUDE.md` a entrega do card "Você recebe" (comissão exata Clássico/Premium + alerta de frete; edge `calcular-tarifa-ml`). Commit:

```bash
git add CLAUDE.md docs/superpowers/plans/2026-06-04-card-voce-recebe.md
git commit -m "docs(m4): card Voce recebe entregue (plano + historico)"
```

---

## Notas de implementação

- **Deploy de edges via MCP:** o projeto não usa Supabase CLI (binário quebrado). Toda edge sobe via `mcp__supabase-mcp-server__deploy_edge_function`, reescrevendo no `index.ts` os imports de `../_shared/` para `./_shared/` e enviando os arquivos `_shared` que a edge importa (preservando os imports relativos internos entre eles).
- **Sem coluna nova no banco** — cálculo on-demand (o preço é editável na Revisão).
- **Resiliência** segue o padrão do projeto (ADR-0014): falha externa nunca quebra a tela; o card degrada para "indisponível".
- **Confirmar antes de commit/push** (preferência do Diego) — embora o plano liste commits por tarefa, aguardar o OK do operador antes de cada `git commit`/`push`.
