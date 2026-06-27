# Plan 016: Teste de paridade das fórmulas de preço/desconto duplicadas FE↔BE

> **Executor instructions**: Follow step by step. Run every verification command. If
> anything in "STOP conditions" occurs, stop and report. When done, update the status
> row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 7222675..HEAD -- src/lib/desconto.ts src/lib/atacado.ts supabase/functions/_shared/preco/desconto.ts supabase/functions/_shared/ml/atacado.ts`
> Se algum mudou desde `7222675`, compare os excerpts; divergência = STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW (só adiciona teste; sem mudar código de produção)
- **Depends on**: none
- **Category**: tech-debt / tests
- **Planned at**: commit `7222675`, 2026-06-26

## Why this matters

A lógica de preço "de" (selo de % off) e de valor de atacado está **duplicada byte-a-byte** entre o
frontend (preview do selo/faixas mostrado ao operador) e o backend (o valor REAL enviado ao Mercado
Livre). As cópias são idênticas hoje, mas **nada impede drift**: mudar a inflação do preço "de" ou o
cálculo do desconto só num lado faz a tela mostrar um selo/faixa diferente do que é publicado — **erro
de preço silencioso**. Como a barreira Vite/Deno torna caro um módulo único compartilhado, o caminho
pragmático é um **teste de paridade** que falha assim que as cópias divergirem.

## Current state

Cópias idênticas confirmadas:
- `src/lib/desconto.ts` ↔ `supabase/functions/_shared/preco/desconto.ts` — ambos exportam:
  - `calcularPrecoDe(preco, pct)`: `if (preco<=0||pct<=0||pct>=100) return null; return Math.round((preco/(1-pct/100))*100)/100;`
  - `pctEfetivo(familiaPct, globalPct)`: `return familiaPct ?? globalPct;`
- `src/lib/atacado.ts:9` ↔ `supabase/functions/_shared/ml/atacado.ts:17` — ambos exportam:
  - `amountComDesconto(precoBase, pct)`: `return Math.round(precoBase*(1-pct/100)*100)/100;`

Os dois lados já têm testes próprios (`tests/lib/desconto.test.ts`, `_shared/preco/__tests__/desconto.test.ts`,
`tests/lib/atacado.test.ts`, `_shared/ml/__tests__/atacado.test.ts`) — mas nenhum **compara** os lados.

Os arquivos BE relevantes são puros no carregamento (sem `Deno.env`/`Deno.serve` no topo): `preco/desconto.ts`
não importa nada; `ml/atacado.ts` define `amountComDesconto`/`montarFaixasPxQ` puras e `aplicarPxQ` (usa
`fetch`, mas não é chamada na importação). Logo **um teste vitest consegue importar os dois lados**.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Test (arquivo) | `pnpm vitest run tests/lib/paridade-preco-fe-be.test.ts` | passa |
| Test (suíte) | `pnpm test` | todos passam |

## Scope

**In scope**:
- `tests/lib/paridade-preco-fe-be.test.ts` (criar)

**Out of scope**:
- **Não** alterar nenhum dos 4 módulos de produção (o teste é a guarda; unificar de fato seria outro plano maior).
- Não mover/excluir nenhuma das cópias.

## Git workflow

- Worktree isolado. Commit, ex.: `test(preco): paridade FE↔BE das fórmulas de preço/desconto/atacado (#016)`
- NÃO push/PR sem o operador pedir.

## Steps

### Step 1: Criar o teste de paridade

`tests/lib/paridade-preco-fe-be.test.ts` — importa os dois lados e compara sobre uma grade de entradas:

```ts
import { describe, it, expect } from 'vitest';
import * as feDesconto from '@/lib/desconto';
import * as feAtacado from '@/lib/atacado';
import * as beDesconto from '../../supabase/functions/_shared/preco/desconto';
import * as beAtacado from '../../supabase/functions/_shared/ml/atacado';

const precos = [0, 1, 9.9, 10, 19.99, 100, 1234.56, 9999.99];
const pcts = [-5, 0, 1, 10, 15, 33.33, 50, 99, 100, 120];

describe('paridade FE↔BE: preço/desconto/atacado', () => {
  it('calcularPrecoDe idêntico', () => {
    for (const p of precos) for (const pct of pcts)
      expect(feDesconto.calcularPrecoDe(p, pct)).toBe(beDesconto.calcularPrecoDe(p, pct));
  });
  it('pctEfetivo idêntico', () => {
    for (const fam of [null, 0, 7, 20]) for (const g of [10, 15, 30])
      expect(feDesconto.pctEfetivo(fam, g)).toBe(beDesconto.pctEfetivo(fam, g));
  });
  it('amountComDesconto idêntico', () => {
    for (const p of precos) for (const pct of pcts)
      expect(feAtacado.amountComDesconto(p, pct)).toBe(beAtacado.amountComDesconto(p, pct));
  });
});
```

**Verify**: `pnpm vitest run tests/lib/paridade-preco-fe-be.test.ts` → passa (as cópias são idênticas hoje).

### Step 2: Sanidade

**Verify**: `pnpm test` → todos passam.

## Test plan

- Arquivo novo de paridade (Step 1). Se algum dia as cópias divergirem, este teste falha apontando o par.
- Verificação: `pnpm test`.

## Done criteria

- [ ] `tests/lib/paridade-preco-fe-be.test.ts` existe e passa, comparando `calcularPrecoDe`, `pctEfetivo`, `amountComDesconto`.
- [ ] `pnpm test` passa.
- [ ] Nenhum arquivo de produção modificado (`git status` mostra só o teste novo).
- [ ] Linha de status atualizada em `plans/README.md`.

## STOP conditions

Pare e reporte se:

- O import dos módulos BE (`../../supabase/functions/_shared/...`) falhar sob vitest (ex.: surgir um
  import Deno-only no carregamento) — reporte o erro; pode ser necessário importar só os símbolos puros.
- O teste **falhar de cara** (as cópias já divergiram entre si) — isso é um achado real: reporte qual
  função difere e em quê, **não** ajuste o teste para passar.

## Maintenance notes

- Se um dia valer unificar de fato (módulo compartilhado FE/BE), este teste vira redundante e pode sair.
- Ao adicionar nova fórmula duplicada FE/BE, acrescentar o par a este teste.
- Revisor deve checar: o teste compara saídas reais dos dois lados (não um lado contra constantes).
