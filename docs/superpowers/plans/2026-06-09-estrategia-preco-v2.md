# Estratégia de Preço v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tratar `PRECO` da planilha como líquido mínimo após comissão do ML — calcular o preço de venda por concorrência (× 0,95) ou gross-up — e exibir um semáforo verde/amarelo/vermelho de "vale a pena publicar" na Revisão.

**Architecture:** Funções puras de arredondamento e sugestão de preço em `supabase/functions/_shared/preco/` (Deno, testadas via vitest); o fetch de `listing_prices` é extraído para `_shared/ml/` e reusado por `process-familia` (server-side, persiste `preco_publicacao`) e pela edge `calcular-tarifa-ml`. O semáforo é cálculo derivado no front (`src/lib/semaforo.ts` + componente), alimentado pela mesma comissão que o card "Você recebe" (hook `useTarifaML`, deduplicado pelo react-query). Sem migration.

**Tech Stack:** TypeScript, Deno (edge functions), React 18 + TanStack Query, shadcn/ui, vitest.

**Spec:** `docs/superpowers/specs/2026-06-09-estrategia-preco-v2-design.md`

---

## File Structure

**Criar:**
- `docs/decisions/0020-estrategia-de-preco-liquido-minimo.md` — ADR que substitui o 0008
- `supabase/functions/_shared/preco/arredondar.ts` — arredondamento p/ múltiplos de R$ 0,05
- `supabase/functions/_shared/preco/__tests__/arredondar.test.ts`
- `supabase/functions/_shared/preco/sugerir.ts` — `sugerirPrecoVenda` + `grossUp`
- `supabase/functions/_shared/preco/__tests__/sugerir.test.ts`
- `supabase/functions/_shared/ml/listing-prices.ts` — fetch + `comissaoDe` (extraído da edge)
- `supabase/functions/_shared/ml/__tests__/listing-prices.test.ts`
- `src/lib/semaforo.ts` — `calcularSemaforo` + `freteSobConta`
- `tests/lib/semaforo.test.ts`
- `src/components/semaforo-preco.tsx` — pill do semáforo + badge de frete

**Modificar:**
- `supabase/functions/calcular-tarifa-ml/index.ts` — usar `buscarListingPrice` extraído
- `supabase/functions/process-familia/index.ts` — categoria antes do preço; `sugerirPrecoVenda` + comissão p/ gross-up; corrige bug do enum
- `src/components/painel-analise.tsx` — renderiza o semáforo (família = pior caso)
- `src/components/variacao-card.tsx` — semáforo por cor + rótulo "mín. líquido"
- `CLAUDE.md` — tabela de ADRs + histórico
- `docs/decisions/0008-estrategia-de-preco-condicional.md` — marcar como substituído pelo 0020

**Intocado:** `_shared/preco/calcular.ts` e seu teste ficam até o Task 4 remover o último uso; então são deletados.

---

## Task 0: ADR-0020 (decisão antes do código)

**Files:**
- Create: `docs/decisions/0020-estrategia-de-preco-liquido-minimo.md`
- Modify: `docs/decisions/0008-estrategia-de-preco-condicional.md:1-6`

- [ ] **Step 1: Escrever o ADR-0020**

Create `docs/decisions/0020-estrategia-de-preco-liquido-minimo.md`:

```markdown
# ADR-0020: PRECO da planilha como líquido mínimo + semáforo de viabilidade

**Status:** Aceito
**Data:** 2026-06-09
**Decisores:** Diego
**Substitui:** ADR-0008

## Contexto

No ADR-0008 a coluna `PRECO` da planilha era o preço de venda. Diego inverteu a
semântica: `PRECO` passa a ser o **líquido mínimo que ele aceita receber depois da
comissão do ML**. O sistema deve calcular o preço de venda que respeite esse piso e
sinalizar, de forma fácil, se vale a pena publicar cada produto.

## Decisão

Por variação, no CREATE (`process-familia`):

- **Com concorrente** (`vendedores > 0` e `preco_min ≠ null`):
  `preço_venda = arredonda5_próximo(menor_concorrente × 0,95)`, estratégia `competitivo`.
  O preço é puro mercado; não sobe para garantir o piso (o semáforo avisa).
- **Sem concorrente:** `preço_venda = gross_up(PRECO)` — menor múltiplo de R$ 0,05 cujo
  líquido (após comissão Clássico) ≥ `PRECO`. Estratégia `proprio`.

Arredondamento sempre em múltiplos de R$ 0,05 (centavos terminando em 0 ou 5):
competitivo → mais próximo; gross-up → para cima (nunca abaixo do piso).

Gross-up inverte a comissão: `P = (PRECO + tarifa_fixa) / (1 − percentual)`, com a comissão
vinda de `GET /sites/MLB/listing_prices` (tipo `gold_special`). A comissão é buscada uma vez
por família (no menor piso); a imprecisão da faixa de tarifa fixa (~R$ 29) é coberta pelo
semáforo, que recalcula o líquido real no preço final.

## Semáforo "vale a pena publicar?"

`líquido = preço_venda − comissão(preço_venda)` (Clássico), por variação; família = pior caso.

- 🟢 `líquido ≥ PRECO` — recebe o mínimo ou mais.
- 🟡 `CUSTO ≤ líquido < PRECO` — abaixo do mínimo, sem prejuízo de caixa.
- 🔴 `líquido < CUSTO` — prejuízo real.

Frete grátis acima de ~R$ 19 (custo não exposto pela API) entra como **badge separado**
("frete por sua conta"), sem alterar a cor.

## Escopo e guardas

- Só CREATE (UPDATE preserva preço — ADR-0016).
- Respeita `preco_editado_pelo_operador`.
- 5% e thresholds fixos (config futura).
- Falha do ML / categoria indefinida → preço cai para o piso + semáforo "indisponível".
- Sem migration: reusa `preco_publicacao`, `variacoes.preco`, `variacoes.custo`,
  `estrategia_preco`/`estrategia_motivo`.

## Como reverter

Restaurar `_shared/preco/calcular.ts` (ADR-0008) e reverter `process-familia` ao uso de
`calcularEstrategiaPreco`. O semáforo é aditivo (front) e pode ser removido isoladamente.
```

- [ ] **Step 2: Marcar o ADR-0008 como substituído**

Em `docs/decisions/0008-estrategia-de-preco-condicional.md`, trocar a linha de status (linha 3):

De:
```markdown
**Status:** Aceito
```
Para:
```markdown
**Status:** Substituído por [ADR-0020](0020-estrategia-de-preco-liquido-minimo.md) (2026-06-09)
```

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0020-estrategia-de-preco-liquido-minimo.md docs/decisions/0008-estrategia-de-preco-condicional.md
git commit -m "docs(preco): ADR-0020 (PRECO=liquido minimo + semaforo); marca 0008 como substituido"
```

---

## Task 1: Arredondamento para múltiplos de R$ 0,05

**Files:**
- Create: `supabase/functions/_shared/preco/arredondar.ts`
- Test: `supabase/functions/_shared/preco/__tests__/arredondar.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `supabase/functions/_shared/preco/__tests__/arredondar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { arredondar5Proximo, arredondar5Cima } from '../arredondar';

describe('arredondar5Proximo (múltiplo de R$ 0,05 mais próximo)', () => {
  it('28,56 → 28,55', () => { expect(arredondar5Proximo(28.56)).toBeCloseTo(28.55, 2); });
  it('28,58 → 28,60', () => { expect(arredondar5Proximo(28.58)).toBeCloseTo(28.6, 2); });
  it('já múltiplo permanece (28,50)', () => { expect(arredondar5Proximo(28.5)).toBeCloseTo(28.5, 2); });
  it('11,40 permanece', () => { expect(arredondar5Proximo(11.4)).toBeCloseTo(11.4, 2); });
});

describe('arredondar5Cima (menor múltiplo de R$ 0,05 ≥ valor)', () => {
  it('23,01 → 23,05', () => { expect(arredondar5Cima(23.01)).toBeCloseTo(23.05, 2); });
  it('já múltiplo permanece (23,00)', () => { expect(arredondar5Cima(23)).toBeCloseTo(23, 2); });
  it('20,001 → 20,05 (nunca abaixo do piso)', () => { expect(arredondar5Cima(20.001)).toBeCloseTo(20.05, 2); });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- arredondar`
Expected: FAIL — "Failed to resolve import '../arredondar'".

- [ ] **Step 3: Implementar**

Create `supabase/functions/_shared/preco/arredondar.ts`:

```ts
/** Número de incrementos de R$ 0,05, limpo de lixo de ponto-flutuante. */
function passosDe5(valor: number): number {
  return Math.round((valor / 0.05) * 1e6) / 1e6;
}

function emReais(passos: number): number {
  return Math.round((passos / 20) * 100) / 100;
}

/** Múltiplo de R$ 0,05 mais próximo. Ex.: 28,56 → 28,55; 28,58 → 28,60. */
export function arredondar5Proximo(valor: number): number {
  return emReais(Math.round(passosDe5(valor)));
}

/** Menor múltiplo de R$ 0,05 ≥ valor (arredonda pra cima). Garante o piso. */
export function arredondar5Cima(valor: number): number {
  return emReais(Math.ceil(passosDe5(valor)));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- arredondar`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/preco/arredondar.ts supabase/functions/_shared/preco/__tests__/arredondar.test.ts
git commit -m "feat(preco): arredondamento para multiplos de R\$ 0,05 (ADR-0020)"
```

---

## Task 2: Sugestão de preço (competitivo vs gross-up)

**Files:**
- Create: `supabase/functions/_shared/preco/sugerir.ts`
- Test: `supabase/functions/_shared/preco/__tests__/sugerir.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `supabase/functions/_shared/preco/__tests__/sugerir.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sugerirPrecoVenda, grossUp } from '../sugerir';

describe('grossUp (preço cujo líquido ≥ piso)', () => {
  it('piso 20, 13% + R$ 0 fixa → (20/0,87)=22,99 → arredonda cima 23,00', () => {
    expect(grossUp(20, 13, 0)).toBeCloseTo(23, 2);
  });
  it('piso 20 com tarifa fixa R$ 6 → (26/0,87)=29,88 → 29,90', () => {
    expect(grossUp(20, 13, 6)).toBeCloseTo(29.9, 2);
  });
});

describe('sugerirPrecoVenda', () => {
  it('com concorrente → competitivo (menor × 0,95, arredonda próximo)', () => {
    expect(sugerirPrecoVenda(10, { vendedores: 3, preco_min: 30 }, null)).toEqual({
      preco: 28.5,
      estrategia: 'competitivo',
      motivo: 'concorrência presente — 5% abaixo do menor preço',
    });
  });
  it('concorrente R$ 12 → 11,40 competitivo (ignora comissão no preço)', () => {
    const r = sugerirPrecoVenda(10, { vendedores: 5, preco_min: 12 }, { percentual: 30, fixa: 6 });
    expect(r.estrategia).toBe('competitivo');
    expect(r.preco).toBeCloseTo(11.4, 2);
  });
  it('sem concorrente com comissão → proprio (gross-up)', () => {
    const r = sugerirPrecoVenda(20, { vendedores: 0, preco_min: null }, { percentual: 13, fixa: 0 });
    expect(r.estrategia).toBe('proprio');
    expect(r.preco).toBeCloseTo(23, 2);
    expect(r.motivo).toBe('sem concorrência — preço cobre seu mínimo após comissão');
  });
  it('sem concorrente sem comissão → proprio fallback (usa o piso)', () => {
    const r = sugerirPrecoVenda(20.001, { vendedores: 0, preco_min: null }, null);
    expect(r.estrategia).toBe('proprio');
    expect(r.preco).toBeCloseTo(20.05, 2);
    expect(r.motivo).toBe('sem concorrência — comissão indisponível, usando o piso');
  });
  it('vendedores > 0 mas sem preco_min → trata como sem concorrente', () => {
    const r = sugerirPrecoVenda(20, { vendedores: 6, preco_min: null }, { percentual: 13, fixa: 0 });
    expect(r.estrategia).toBe('proprio');
    expect(r.preco).toBeCloseTo(23, 2);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- sugerir`
Expected: FAIL — "Failed to resolve import '../sugerir'".

- [ ] **Step 3: Implementar**

Create `supabase/functions/_shared/preco/sugerir.ts`:

```ts
import { arredondar5Proximo, arredondar5Cima } from './arredondar.ts';

export interface ConcorrenciaPreco {
  vendedores: number;
  preco_min: number | null;
}

/** percentual em % (ex.: 13 = 13%); fixa em R$. */
export interface Comissao {
  percentual: number;
  fixa: number;
}

export interface PrecoSugerido {
  preco: number;
  estrategia: 'proprio' | 'competitivo';
  motivo: string;
}

const MOTIVO_COMPETITIVO = 'concorrência presente — 5% abaixo do menor preço';
const MOTIVO_GROSSUP = 'sem concorrência — preço cobre seu mínimo após comissão';
const MOTIVO_FALLBACK = 'sem concorrência — comissão indisponível, usando o piso';

/** Preço cujo líquido (após comissão) ≥ piso. P = (piso + fixa)/(1 − pct), arredonda pra cima. */
export function grossUp(piso: number, percentual: number, fixa: number): number {
  const bruto = (piso + fixa) / (1 - percentual / 100);
  return arredondar5Cima(bruto);
}

/**
 * Sugere o preço de venda (ADR-0020). `piso` = PRECO da planilha (líquido mínimo desejado).
 * Com concorrente → mercado (× 0,95). Sem concorrente → gross-up até cobrir o piso.
 */
export function sugerirPrecoVenda(
  piso: number,
  conc: ConcorrenciaPreco,
  comissao: Comissao | null,
): PrecoSugerido {
  if (conc.vendedores > 0 && conc.preco_min != null) {
    return {
      preco: arredondar5Proximo(conc.preco_min * 0.95),
      estrategia: 'competitivo',
      motivo: MOTIVO_COMPETITIVO,
    };
  }
  if (comissao) {
    return { preco: grossUp(piso, comissao.percentual, comissao.fixa), estrategia: 'proprio', motivo: MOTIVO_GROSSUP };
  }
  return { preco: arredondar5Cima(piso), estrategia: 'proprio', motivo: MOTIVO_FALLBACK };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- sugerir`
Expected: PASS (8 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/preco/sugerir.ts supabase/functions/_shared/preco/__tests__/sugerir.test.ts
git commit -m "feat(preco): sugerirPrecoVenda competitivo vs gross-up (ADR-0020)"
```

---

## Task 3: Extrair fetch de listing_prices para `_shared/ml`

**Files:**
- Create: `supabase/functions/_shared/ml/listing-prices.ts`
- Test: `supabase/functions/_shared/ml/__tests__/listing-prices.test.ts`
- Modify: `supabase/functions/calcular-tarifa-ml/index.ts:1-19,43-48`

- [ ] **Step 1: Escrever o teste que falha (parte pura `comissaoDe`)**

Create `supabase/functions/_shared/ml/__tests__/listing-prices.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { comissaoDe } from '../listing-prices';

describe('comissaoDe', () => {
  it('extrai percentual e fixa do listing_prices', () => {
    expect(comissaoDe({
      sale_fee_amount: 8.5,
      sale_fee_details: { percentage_fee: 13, fixed_fee: 6 },
    })).toEqual({ percentual: 13, fixa: 6 });
  });
  it('sem detalhes → zeros', () => {
    expect(comissaoDe({ sale_fee_amount: 0 })).toEqual({ percentual: 0, fixa: 0 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- listing-prices`
Expected: FAIL — "Failed to resolve import '../listing-prices'".

- [ ] **Step 3: Implementar o módulo compartilhado**

Create `supabase/functions/_shared/ml/listing-prices.ts`:

```ts
import type { ListingPriceML } from './tarifa.ts';

/** GET /sites/MLB/listing_prices para um preço/categoria/tipo de anúncio. Lança em erro HTTP. */
export async function buscarListingPrice(
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

/** Comissão (%/fixa em R$) a partir da resposta de listing_prices. */
export function comissaoDe(lp: ListingPriceML): { percentual: number; fixa: number } {
  return {
    percentual: lp.sale_fee_details?.percentage_fee ?? 0,
    fixa: lp.sale_fee_details?.fixed_fee ?? 0,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- listing-prices`
Expected: PASS (2 testes).

- [ ] **Step 5: Refatorar `calcular-tarifa-ml` para usar o módulo**

Em `supabase/functions/calcular-tarifa-ml/index.ts`:

Trocar o import (linha 5) por:
```ts
import { montarTarifa } from '../_shared/ml/tarifa.ts';
import { buscarListingPrice } from '../_shared/ml/listing-prices.ts';
```

Remover a função local `listingPrice` (linhas 9-19).

Trocar as duas chamadas (linhas 45-46) por:
```ts
      buscarListingPrice(token, preco, categoria_ml_id, 'gold_special'),
      buscarListingPrice(token, preco, categoria_ml_id, 'gold_pro'),
```

- [ ] **Step 6: Rodar a suíte completa (nada quebrou)**

Run: `pnpm test`
Expected: PASS (suíte anterior + novos testes).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/ml/listing-prices.ts supabase/functions/_shared/ml/__tests__/listing-prices.test.ts supabase/functions/calcular-tarifa-ml/index.ts
git commit -m "refactor(ml): extrai buscarListingPrice/comissaoDe para _shared (ADR-0020)"
```

---

## Task 4: Integrar a sugestão v2 no `process-familia`

**Files:**
- Modify: `supabase/functions/process-familia/index.ts` (imports; bloco de preço 153-169; persistência 196-197; reordenar categoria)
- Delete: `supabase/functions/_shared/preco/calcular.ts` e `supabase/functions/_shared/preco/__tests__/calcular.test.ts`

> Sem teste unitário: `process-familia` é edge (usa `Deno.serve`/globais). Verificação = suíte verde + revisão do diff + deploy/bug-bash com token real (pendente, registrar no fim).

- [ ] **Step 1: Trocar imports**

Em `supabase/functions/process-familia/index.ts`, remover a linha 11:
```ts
import { calcularEstrategiaPreco } from '../_shared/preco/calcular.ts';
```
E adicionar (junto aos imports do topo):
```ts
import { sugerirPrecoVenda } from '../_shared/preco/sugerir.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { buscarListingPrice, comissaoDe } from '../_shared/ml/listing-prices.ts';
```

- [ ] **Step 2: Reordenar — computar categoria ANTES do preço**

Mover o bloco `5d` (categoria, hoje linhas 171-175: `detectarTipoAviamento` → `categoriaMlId` → `atributosMl`) para ANTES do bloco `5c` (preço, linhas 153-169). O bloco de categoria não depende do preço; o gross-up depende de `categoriaMlId`.

- [ ] **Step 3: Substituir o bloco de preço (5c) pela lógica v2**

Trocar o bloco `5c` inteiro (o `const conc`, `updatesPreco`, `precoMinFamilia`, `estrategiaFamilia`) por:

```ts
    // 5c. Estratégia de preço v2 (ADR-0020). PRECO = líquido mínimo desejado.
    // Com concorrente → mercado (× 0,95). Sem concorrente → gross-up (busca comissão 1x).
    const conc = { vendedores: concorrencia.vendedores, preco_min: concorrencia.preco_min };
    const precoMinFamilia = resolvidas.length
      ? Math.min(...resolvidas.map((v) => Number(v.preco)))
      : 0;
    const competitivo = conc.vendedores > 0 && conc.preco_min != null;

    let comissao: { percentual: number; fixa: number } | null = null;
    if (!competitivo && categoriaMlId) {
      try {
        const token = await getValidAccessToken(userId);
        const lp = await buscarListingPrice(token, precoMinFamilia, categoriaMlId, 'gold_special');
        comissao = comissaoDe(lp);
      } catch (e) {
        // Resiliente: sem comissão o gross-up cai no piso; o semáforo mostra "indisponível".
        console.error('comissão p/ gross-up falhou:', e);
      }
    }

    const updatesPreco = resolvidas
      .filter((v) => !v.preco_editado_pelo_operador)
      .map((v) => {
        const { preco } = sugerirPrecoVenda(Number(v.preco), conc, comissao);
        return admin.from('variacoes')
          .update({ preco_publicacao: preco })
          .eq('id', v.id);
      });
    await Promise.all(updatesPreco);

    const estrategiaFamilia = sugerirPrecoVenda(precoMinFamilia, conc, comissao);
```

- [ ] **Step 4: Corrigir a persistência da estratégia (bug do enum maiúsculo)**

Nas linhas que persistem `estrategia_preco`/`estrategia_motivo` (hoje 196-197), trocar:
```ts
      estrategia_preco: estrategiaFamilia.estrategia === 'COMPETITIVO' ? 'competitivo' : 'proprio',
      estrategia_motivo: estrategiaFamilia.motivo,
```
Por (a estratégia já vem minúscula, batendo com o enum):
```ts
      estrategia_preco: estrategiaFamilia.estrategia,
      estrategia_motivo: estrategiaFamilia.motivo,
```

- [ ] **Step 5: Deletar o módulo antigo (ADR-0008) e seu teste**

```bash
git rm supabase/functions/_shared/preco/calcular.ts supabase/functions/_shared/preco/__tests__/calcular.test.ts
```

- [ ] **Step 6: Garantir que nada mais importa o módulo deletado**

Run: `grep -rn "preco/calcular\|calcularEstrategiaPreco" supabase/ src/`
Expected: nenhum resultado.

- [ ] **Step 7: Rodar a suíte completa**

Run: `pnpm test`
Expected: PASS (sem os 6 testes do `calcular.test.ts` removido; demais verdes).

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/process-familia/index.ts
git commit -m "feat(preco): process-familia usa sugestao v2 + corrige enum estrategia (ADR-0020)"
```

---

## Task 5: Semáforo (função pura, front)

**Files:**
- Create: `src/lib/semaforo.ts`
- Test: `tests/lib/semaforo.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `tests/lib/semaforo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { calcularSemaforo, freteSobConta } from '@/lib/semaforo';

describe('calcularSemaforo', () => {
  it('líquido ≥ piso → verde', () => {
    expect(calcularSemaforo(21, 20, 10)).toBe('verde');
    expect(calcularSemaforo(20, 20, 10)).toBe('verde');
  });
  it('custo ≤ líquido < piso → amarelo', () => {
    expect(calcularSemaforo(15, 20, 10)).toBe('amarelo');
  });
  it('líquido < custo → vermelho', () => {
    expect(calcularSemaforo(8, 20, 10)).toBe('vermelho');
  });
  it('sem custo: abaixo do piso vira amarelo (não dá pra saber prejuízo)', () => {
    expect(calcularSemaforo(8, 20, null)).toBe('amarelo');
  });
  it('líquido null → indisponível', () => {
    expect(calcularSemaforo(null, 20, 10)).toBe('indisponivel');
  });
});

describe('freteSobConta', () => {
  it('acima de R$ 19 → true', () => { expect(freteSobConta(19.05)).toBe(true); });
  it('19 ou menos → false', () => { expect(freteSobConta(19)).toBe(false); });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- semaforo`
Expected: FAIL — "Failed to resolve import '@/lib/semaforo'".

- [ ] **Step 3: Implementar**

Create `src/lib/semaforo.ts`:

```ts
export type Semaforo = 'verde' | 'amarelo' | 'vermelho' | 'indisponivel';

/**
 * Semáforo "vale a pena publicar?" (ADR-0020). `liquido` = preço − comissão ML;
 * `piso` = PRECO (líquido mínimo desejado); `custo` = CUSTO (null = sem dado).
 */
export function calcularSemaforo(
  liquido: number | null,
  piso: number,
  custo: number | null,
): Semaforo {
  if (liquido == null) return 'indisponivel';
  if (liquido >= piso) return 'verde';
  if (custo != null && custo > 0 && liquido < custo) return 'vermelho';
  return 'amarelo';
}

/** Acima de ~R$ 19 o ML dá frete grátis por conta do vendedor (custo não exposto pela API). */
export function freteSobConta(preco: number): boolean {
  return preco > 19;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- semaforo`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/semaforo.ts tests/lib/semaforo.test.ts
git commit -m "feat(preco): semaforo de viabilidade (verde/amarelo/vermelho) (ADR-0020)"
```

---

## Task 6: Componente SemaforoPreco + integração no PainelAnalise

**Files:**
- Create: `src/components/semaforo-preco.tsx`
- Modify: `src/components/painel-analise.tsx:36-41` (renderiza o semáforo no topo)

- [ ] **Step 1: Criar o componente**

Create `src/components/semaforo-preco.tsx`:

```tsx
import { CircleCheck, CircleAlert, CircleX, CircleHelp, Truck } from 'lucide-react';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { useTarifaML } from '@/hooks/useTarifaML';
import { calcularSemaforo, freteSobConta, type Semaforo } from '@/lib/semaforo';

const CFG: Record<Semaforo, { tone: StatusTone; label: string; Icon: typeof CircleCheck }> = {
  verde: { tone: 'success', label: 'Vale a pena', Icon: CircleCheck },
  amarelo: { tone: 'warning', label: 'Abaixo do mínimo', Icon: CircleAlert },
  vermelho: { tone: 'danger', label: 'Prejuízo', Icon: CircleX },
  indisponivel: { tone: 'neutral', label: 'Viabilidade indisponível', Icon: CircleHelp },
};

/**
 * Semáforo "vale a pena publicar?" (ADR-0020). Usa a comissão Clássico do mesmo
 * `useTarifaML` do card "Você recebe" (react-query deduplica a chamada).
 */
export function SemaforoPreco({
  preco,
  piso,
  custo,
  categoriaMlId,
}: {
  preco: number;
  piso: number;
  custo: number | null;
  categoriaMlId: string | null;
}) {
  const { data, isLoading } = useTarifaML(preco, categoriaMlId);
  const liquido = data ? data.classico.recebe : null;
  const sem: Semaforo = isLoading ? 'indisponivel' : calcularSemaforo(liquido, piso, custo);
  const cfg = CFG[sem];
  const Icon = cfg.Icon;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusPill tone={cfg.tone}>
        <Icon className="mr-1 h-3 w-3" />
        {cfg.label}
      </StatusPill>
      {freteSobConta(preco) && (
        <StatusPill tone="neutral" title="Acima de R$ 19 o Mercado Livre dá frete grátis ao comprador por sua conta">
          <Truck className="mr-1 h-3 w-3" />
          frete por sua conta
        </StatusPill>
      )}
    </div>
  );
}
```

> Confirme que `StatusTone` é exportado por `@/components/ui/status-pill` (é usado assim em `painel-analise.tsx:4`). Os ícones (`CircleCheck`, `CircleAlert`, `CircleX`, `CircleHelp`, `Truck`) existem em `lucide-react`.

- [ ] **Step 2: Renderizar no PainelAnalise (família = pior caso = variação representativa)**

Em `src/components/painel-analise.tsx`:

Adicionar o import no topo:
```tsx
import { SemaforoPreco } from '@/components/semaforo-preco';
```

Logo após o cabeçalho "Análise para publicação" (depois da linha 40, antes do alerta `precoAbaixo20pc`), inserir:
```tsx
      <SemaforoPreco
        preco={precoPublicacao}
        piso={variacaoRepresentativa?.preco ?? precoPublicacao}
        custo={custoRepresentativo}
        categoriaMlId={familia.categoriaMlId}
      />
```

> `precoPublicacao` (menor preço de publicação) e `variacaoRepresentativa` já existem nas linhas 18-29. Como o menor preço → menor líquido, a variação representativa é o pior caso quando os pisos/custos são uniformes entre as cores.

- [ ] **Step 3: Verificar tipos e build**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: sem erros.

- [ ] **Step 4: Rodar a suíte**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/semaforo-preco.tsx src/components/painel-analise.tsx
git commit -m "feat(preco): semaforo de viabilidade no Painel de Analise (ADR-0020)"
```

---

## Task 7: Semáforo por cor + rótulo "mín. líquido" no VariacaoCard

**Files:**
- Modify: `src/components/variacao-card.tsx` (imports; bloco de preço 103-125)

- [ ] **Step 1: Trocar o rótulo "planilha:" por "mín. líquido:" e adicionar o semáforo por cor**

Em `src/components/variacao-card.tsx`:

Adicionar imports no topo:
```tsx
import { SemaforoPreco } from '@/components/semaforo-preco';
```

E receber `categoriaMlId` via prop (adicionar à interface `VariacaoCardProps` e à desestruturação):
```tsx
  categoriaMlId: string | null;
```

No bloco do preço (linhas 117-125), trocar:
```tsx
        {variacao.precoPublicacao != null &&
          variacao.precoPublicacao !== variacao.preco && (
            <span className="pl-0.5 text-[11px] text-muted-foreground">
              planilha: <span className="font-semibold text-foreground">
                {fmtBRL(variacao.preco)}
              </span>
            </span>
          )}
```
Por:
```tsx
        <span className="pl-0.5 text-[11px] text-muted-foreground">
          mín. líquido: <span className="font-semibold text-foreground">{fmtBRL(variacao.preco)}</span>
        </span>
        <SemaforoPreco
          preco={variacao.precoPublicacao ?? variacao.preco}
          piso={variacao.preco}
          custo={variacao.custo}
          categoriaMlId={categoriaMlId}
        />
```

- [ ] **Step 2: Passar `categoriaMlId` do FamiliaExpanded para o VariacaoCard**

Em `src/components/familia-expanded.tsx`, na chamada `<VariacaoCard ... />` (linhas 443-455), adicionar a prop:
```tsx
                      categoriaMlId={familia.categoriaMlId}
```

> `familia.categoriaMlId` já é usado pelo `PainelAnalise` (mesma fonte).

- [ ] **Step 3: Verificar tipos e build**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: sem erros (a prop nova é obrigatória — confirme que todas as chamadas de `VariacaoCard` a passam; só há a do `familia-expanded.tsx`).

- [ ] **Step 4: Rodar a suíte**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/variacao-card.tsx src/components/familia-expanded.tsx
git commit -m "feat(preco): semaforo por cor + rotulo min. liquido no VariacaoCard (ADR-0020)"
```

---

## Task 8: Documentação (CLAUDE.md)

**Files:**
- Modify: `CLAUDE.md` (tabela de ADRs + linha de histórico)

- [ ] **Step 1: Adicionar o ADR-0020 à tabela de ADRs**

Em `CLAUDE.md`, na tabela "Decisões arquiteturais já tomadas", adicionar a linha:
```markdown
| [0020](docs/decisions/0020-estrategia-de-preco-liquido-minimo.md) | PRECO = líquido mínimo após comissão ML; com concorrente preço = menor × 0,95, sem concorrente gross-up até cobrir o piso; arredonda múltiplos de R$ 0,05; semáforo verde/amarelo/vermelho de viabilidade (substitui ADR-0008) |
```

- [ ] **Step 2: Adicionar a linha de histórico**

No fim da tabela "Histórico deste CLAUDE.md", adicionar:
```markdown
| 2026-06-09 | **Estratégia de preço v2 (ADR-0020, substitui 0008).** PRECO da planilha passa a ser o líquido mínimo após comissão do ML. `process-familia`: com concorrente → `arredonda5(menor × 0,95)`; sem concorrente → gross-up `(piso+fixa)/(1−pct)` arredondado pra cima (comissão Clássico via `listing_prices`, 1× por família). Arredondamento sempre em múltiplos de R$ 0,05 (`_shared/preco/arredondar.ts`, TDD). `_shared/preco/sugerir.ts` substitui `calcular.ts`; corrigido bug do enum `estrategia_preco` (comparava `'COMPETITIVO'` maiúsculo → sempre gravava `proprio`). `buscarListingPrice`/`comissaoDe` extraídos p/ `_shared/ml/listing-prices.ts` (reuso com `calcular-tarifa-ml`). **Semáforo** "vale a pena publicar?" no front (`src/lib/semaforo.ts` + `SemaforoPreco`): 🟢 líquido ≥ PRECO, 🟡 custo ≤ líquido < PRECO, 🔴 líquido < custo; família = pior caso (variação de menor preço); badge 🚚 acima de R$ 19. Sem migration. Spec/plano em `docs/superpowers/{specs,plans}/2026-06-09-estrategia-preco-v2*`. **Pendente:** deploy de `process-familia`/`calcular-tarifa-ml` via CLI + bug bash com token real. |
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(preco): registra ADR-0020 no CLAUDE.md (tabela + historico)"
```

---

## Notas de execução (pós-plano)

- **Deploy:** ao final, `process-familia` e `calcular-tarifa-ml` precisam ser **redeployados via CLI completa** (regra do projeto: `_shared` mudou → redeploy de todas as funções afetadas; verificar versão pós-deploy). Não há como acionar `process-familia` por MCP (signing keys divergentes) — reprocessar exige subir um lote novo pela UI.
- **Bug bash pendente:** validar com token real (AVILBV) — comissão do gross-up, arredondamento 0,05, e as três cores do semáforo num lote com e sem concorrência.
- **Limitação conhecida (documentada no ADR):** a comissão do gross-up é buscada no menor piso da família; se o preço final cruzar a faixa da tarifa fixa (~R$ 29) a estimativa erra um pouco — o semáforo, que recalcula o líquido real no preço final, expõe isso (cairia em 🟡).
```
