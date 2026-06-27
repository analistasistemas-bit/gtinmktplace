# Plan 015: Fonte única das primitivas de dinheiro (`round2` e formato BRL sem símbolo)

> **Executor instructions**: Follow step by step. Run every verification command. If
> anything in "STOP conditions" occurs, stop and report. When done, update the status
> row in `plans/README.md`.
>
> **Drift check (run first)**: `git grep -n "const round2" -- 'src/**' 'supabase/functions/**'`
> Confirme que as definições ainda batem com a lista de "Current state"; divergência relevante = STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (mudança behavior-preserving — mesma matemática/formato)
- **Depends on**: nenhuma dura (mudança idêntica); a rede de testes existente cobre os arquivos de dinheiro
- **Category**: tech-debt
- **Planned at**: commit `7222675`, 2026-06-26

## Why this matters

A primitiva de arredondamento monetário `round2 = (n) => Math.round(n*100)/100` está **copiada
byte-a-byte em ~8 arquivos** (4 no frontend, 4 no backend) + usos inline. E há **3 jeitos** de formatar
moeda: o canônico `fmtBRL` (`src/lib/formato.ts`) e duas reimplementações locais sem símbolo
(`familia-row.tsx`, `atacado-editor.tsx`). Sem fonte única, qualquer mudança de política (ex.: passar
para centavos inteiros, ou trocar o arredondamento) exige editar ~10 lugares no caminho de dinheiro;
um esquecido = divergência de centavos entre telas, ou entre tela e backend. Esta consolidação é
**behavior-preserving**: as funções compartilhadas têm exatamente a mesma matemática/formato das cópias.

## Current state

`round2` (idêntico em todos):
- FE nomeado: `src/lib/resumo-vendas.ts:6`, `src/lib/pedidos-faturamento.ts:10`, `src/lib/detalhe-vendas.ts:4`, `src/pages/DetalheFinanceiro.tsx:27`
- FE inline `Math.round(x*100)/100`: `src/lib/faturamento.ts:113`, `src/lib/geografia-vendas.ts` (~75/85), `src/lib/export/adapters.ts` (~497)
- BE nomeado: `supabase/functions/_shared/faturamento/venda.ts:5`, `_shared/mercadopago/financeiro.ts:18`, `_shared/mercadopago/rateio.ts:7`, `_shared/ml/pedidos.ts:7`
- BE inline: `_shared/faturamento/io.ts` (~:79)

Formato BRL sem símbolo (idêntico):
- `src/components/familia-row.tsx:28-30` — `function formatarBRL(valor) { return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }` (callers prefixam `R$ ` em `:69`, `:219`, `:352`, `:353`)
- `src/components/atacado-editor.tsx:12-14` — `function brl(v) { return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }`

Canônico já existe: `src/lib/formato.ts:1-5` (`fmtBRL` via `Intl … currency: 'BRL'` — **com** "R$ ").

**FE e BE seguem runtimes separados** (Vite vs Deno) — cada um tem sua cópia da primitiva; não há como
importar BE de FE. A consolidação é **por runtime**.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Test | `pnpm test` | todos passam (sem mudança de saída) |
| Typecheck/Lint | `pnpm exec tsc -b && pnpm lint` | exit 0 / 0 errors |
| Achar usos | `git grep -n "round2\|toLocaleString('pt-BR'" -- src supabase/functions` | lista os sites |

## Scope

**In scope**:
- `src/lib/formato.ts` (adicionar `round2` e `fmtBRLSemSimbolo`)
- `supabase/functions/_shared/dinheiro.ts` (criar — `round2` do backend)
- Os arquivos FE/BE listados em "Current state" (trocar cópias/inline pela importação)

**Out of scope**:
- **Não mudar a saída** de nenhuma função (mesmo arredondamento, mesmo formato). Se a saída mudar, é bug.
- Não tocar nos callers que prefixam `R$ ` manualmente (mantenha o prefixo; só troque o helper local).
- Não consolidar `fmtBRL` (com símbolo) — só a variante **sem** símbolo (que é a duplicada).

## Git workflow

- Worktree isolado. Commit, ex.: `refactor(dinheiro): fonte única de round2 e formato BRL sem símbolo (#015)`
- NÃO push/PR sem o operador pedir.

## Steps

### Step 1: Adicionar `round2` e `fmtBRLSemSimbolo` ao `formato.ts` (FE)

Em `src/lib/formato.ts`:
```ts
/** Arredonda a 2 casas (centavos). Fonte única do arredondamento monetário no frontend. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** BRL sem símbolo (ex.: 1234.5 → "1.234,50"). Quem precisa de "R$ " prefixa. */
export function fmtBRLSemSimbolo(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
```

**Verify**: `pnpm exec tsc -b` → exit 0.

### Step 2: Trocar as cópias FE de `round2` e os inline

Em cada arquivo FE da lista, remova a definição local `const round2 = ...` (ou troque o inline
`Math.round(x*100)/100`) e importe `round2` de `@/lib/formato` (ou caminho relativo equivalente). Não
mude as chamadas a `round2(...)`.

**Verify**: `git grep -n "const round2" -- src` → vazio; `pnpm exec tsc -b && pnpm lint` ok.

### Step 3: Trocar os formatadores BRL locais

Em `familia-row.tsx`: remova `formatarBRL` (`:28-30`), importe `fmtBRLSemSimbolo` de `@/lib/formato`, e
troque cada `formatarBRL(x)` por `fmtBRLSemSimbolo(x)` (mantendo o `R$ ` que os callers já colam).
Em `atacado-editor.tsx`: idem, remova `brl` e use `fmtBRLSemSimbolo`.

**Verify**: `git grep -n "function formatarBRL\|function brl(" -- src` → vazio.

### Step 4: Criar `_shared/dinheiro.ts` (BE) e trocar as cópias

`supabase/functions/_shared/dinheiro.ts`:
```ts
/** Arredonda a 2 casas (centavos). Fonte única do arredondamento monetário no backend (Deno). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```
Em cada arquivo BE da lista, remova `const round2 = ...` (ou o inline) e importe `round2` de
`../dinheiro.ts` / `../../_shared/dinheiro.ts` (confira a profundidade relativa de cada um).

**Verify**: `git grep -n "const round2" -- supabase/functions` → vazio.

### Step 5: Sanidade total

**Verify**: `pnpm test && pnpm exec tsc -b && pnpm lint` → testes passam (saída idêntica), tsc 0, lint 0 errors.
Se o Plan 009 estiver aplicado: `pnpm lint:functions` ok no `_shared`.

## Test plan

- **Nenhum teste novo necessário** (mudança behavior-preserving). A rede existente cobre o caminho de
  dinheiro: BE `venda.test.ts`, `mercadopago/rateio.test.ts`, `mercadopago/financeiro.test.ts`,
  `ml/pedidos.test.ts`; FE `detalhe-vendas.test.ts`, `familia-row.test.ts`, `atacado.test.ts`. Todos
  devem permanecer verdes — é a prova de que a saída não mudou.
- Verificação: `pnpm test`.

## Done criteria

- [ ] `round2` e `fmtBRLSemSimbolo` exportados de `src/lib/formato.ts`; `round2` em `_shared/dinheiro.ts`.
- [ ] `git grep "const round2" -- src supabase/functions` → vazio; `git grep "function formatarBRL\|function brl(" -- src` → vazio.
- [ ] `pnpm test` passa **sem alterar nenhuma assertion** (saída inalterada); `pnpm exec tsc -b` 0; `pnpm lint` 0 errors.
- [ ] Nenhum arquivo fora do escopo modificado.
- [ ] Linha de status atualizada em `plans/README.md`.

## STOP conditions

Pare e reporte se:

- Qualquer teste existente exigir mudança de assertion (sinal de que a saída mudou — NÃO é behavior-preserving;
  investigue antes de prosseguir).
- Um arquivo da lista tiver um `round2`/formatador **diferente** do esperado (não trocar às cegas).

## Maintenance notes

- A partir daqui, dinheiro arredonda só via `round2` (FE: `@/lib/formato`; BE: `_shared/dinheiro`).
- O Plan 016 (paridade FE↔BE) é complementar: cobre as **fórmulas** duplicadas (preço/desconto), não as primitivas.
- Revisor deve checar: nenhuma assertion de teste mudou (garantia de behavior-preserving).
