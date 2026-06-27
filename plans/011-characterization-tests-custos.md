# Plan 011: Characterization tests do resolvedor de custo/markup (`custos.ts`)

> **Executor instructions**: Follow step by step. Run every verification command. If
> anything in "STOP conditions" occurs, stop and report. When done, update the status
> row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7222675..HEAD -- src/lib/custos.ts`
> Se `custos.ts` mudou desde `7222675`, compare o excerpt abaixo com o atual; divergência = STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (adiciona testes + um pequeno extract puro)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `7222675`, 2026-06-26

## Why this matters

`src/lib/custos.ts` resolve o **custo (R$) e o peso (g)** de cada item de venda, via a cadeia de
fallback `variação → anúncio → GTIN`. Esses valores alimentam o **markup/lucro mostrado ao operador**
e o **rateio de frete por peso** (ADR-0042/0038). Uma colisão de GTIN (a classe do incidente
catálogo-KIT) ou uma inversão da ordem de fallback resolve o produto errado e exibe markup/lucro
errado **em silêncio** — e hoje não há **nenhum** teste sobre esse módulo (`grep custos` em testes = 0).
Além disso, `buscarCustos` mantém a entrada de **maior custo por chave** (`upsertMax`, dedup de
re-importação) — heurística não-trivial sem teste que prove o tie-break.

## Current state

`src/lib/custos.ts` (resumo do que importa):

- `buscarCustos()` (`:23-53`): lê `variacoes` (filtrando `.not('custo','is',null)` e `custo<=0`), e
  monta 3 mapas (`porVariacao`, `porItem`, `porGtin`) com `upsertMax` (mantém o de **maior custo**).
- `resolverProduto(m, item)` (`:56-71`, **interno, não exportado**): tenta `variation_id` → `ml_item_id`
  → `ean` (normalizado por `normGtin`), nessa ordem; `null` se nada casar.
- `montarCustoResolver(m)` (`:74-76`, **exportado**): retorna `(item) => custo ?? null`.
- `montarPesoResolver(m)` (`:79-84`, **exportado**): retorna `(item) => peso>0 ? peso : null`.

O tie-break `upsertMax` (`:35-37`) hoje está **dentro** de `buscarCustos` (que faz query de rede), então
não é testável sem mockar o supabase. Este plano faz um **extract puro mínimo** para destravar o teste.

Exemplar estrutural de teste de lib FE puro: `tests/lib/detalhe-vendas.test.ts` (mesmo padrão de
`describe/it/expect`, importando de `@/lib/...`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Test (arquivo) | `pnpm vitest run tests/lib/custos.test.ts` | todos passam |
| Test (suíte) | `pnpm test` | todos passam |
| Typecheck | `pnpm exec tsc -b` | exit 0 |
| Lint | `pnpm lint` | 0 errors |

## Scope

**In scope**:
- `src/lib/custos.ts` (extrair função pura `montarMapasCusto(rows)` que `buscarCustos` passa a chamar)
- `tests/lib/custos.test.ts` (criar)

**Out of scope**:
- Não mudar a assinatura pública de `buscarCustos`, `montarCustoResolver`, `montarPesoResolver`.
- Não mudar o comportamento (é characterization: os testes descrevem o que o código **já faz**, inclusive
  o fato de variação sem custo ser descartada — NÃO "consertar" isso aqui; é outro finding).

## Git workflow

- Worktree isolado. Commit, ex.: `test(custos): characterization do resolvedor de custo/peso + extract puro (#011)`
- NÃO push/PR sem o operador pedir.

## Steps

### Step 1: Extrair `montarMapasCusto(rows)` puro

Em `custos.ts`, extraia a montagem dos mapas (linhas ~30-52, incluindo `upsertMax` e o loop) para uma
função pura exportada que recebe as linhas já lidas e devolve `MapasCusto`:

```ts
type LinhaVariacao = Record<string, unknown>;

/** Monta os mapas de custo/peso a partir das linhas de `variacoes` (puro, testável). */
export function montarMapasCusto(rows: LinhaVariacao[]): MapasCusto {
  const porVariacao = new Map<string, ValorProduto>();
  const porItem = new Map<string, ValorProduto>();
  const porGtin = new Map<string, ValorProduto>();
  const upsertMax = (m: Map<string, ValorProduto>, k: string, val: ValorProduto) => {
    if (val.custo > (m.get(k)?.custo ?? 0)) m.set(k, val);
  };
  for (const v of rows) {
    const custo = Number(v.custo ?? 0);
    if (custo <= 0) continue;
    const peso = Number(v.peso_gramas ?? 0);
    const val: ValorProduto = { custo, peso };
    const varId = v.ml_variation_id as string | null;
    const gtin = v.gtin as string | null;
    const fams = v.familias as { ml_item_id: string | null } | { ml_item_id: string | null }[] | null;
    const itemId = (Array.isArray(fams) ? fams[0]?.ml_item_id : fams?.ml_item_id) ?? null;
    if (varId != null) upsertMax(porVariacao, String(varId), val);
    if (itemId != null) upsertMax(porItem, String(itemId), val);
    if (gtin) upsertMax(porGtin, normGtin(gtin), val);
  }
  return { porVariacao, porItem, porGtin };
}
```

`buscarCustos` passa a ser: `return montarMapasCusto((data ?? []) as Record<string, unknown>[]);` (sem
mudar a query nem o filtro). Exporte também os tipos `ValorProduto`/`MapasCusto` se necessário para os testes.

**Verify**: `pnpm exec tsc -b` → exit 0; `pnpm lint` → 0 errors.

### Step 2: Escrever `tests/lib/custos.test.ts`

Seguindo o padrão de `tests/lib/detalhe-vendas.test.ts`, cubra:

- **Precedência** `montarCustoResolver`: dado um `MapasCusto` com a MESMA chave em mais de um mapa,
  um item com `variation_id` casado resolve por `porVariacao` mesmo havendo `porItem`/`porGtin` diferentes.
- **Fallback**: item sem match em `porVariacao` cai para `porItem`; sem `porItem`, cai para `porGtin`
  (via `ean` normalizado). Sem nenhum match → `null`.
- **Normalização de GTIN**: `porGtin` montado com um GTIN e o item com o mesmo GTIN em formato diferente
  (ex.: com zeros à esquerda) ainda casa (via `normGtin`).
- **`montarPesoResolver`**: peso `0`/ausente → `null`; peso `>0` → o valor.
- **Tie-break `montarMapasCusto`**: duas linhas com a mesma `ml_variation_id` e custos diferentes →
  o mapa mantém a de **maior custo** (e o peso acompanha esse custo). Linha com `custo` null/≤0 é ignorada.

**Verify**: `pnpm vitest run tests/lib/custos.test.ts` → todos passam (≥ 8 casos).

## Test plan

- Arquivo novo `tests/lib/custos.test.ts` cobrindo os 5 grupos acima.
- Modelo estrutural: `tests/lib/detalhe-vendas.test.ts`.
- Verificação: `pnpm test` → todos passam, incluindo os novos.

## Done criteria

- [ ] `montarMapasCusto` extraída e pura; `buscarCustos` a usa; comportamento inalterado.
- [ ] `tests/lib/custos.test.ts` existe com ≥ 8 casos, todos passando.
- [ ] `pnpm exec tsc -b` exit 0; `pnpm test` passa; `pnpm lint` 0 errors.
- [ ] Nenhum arquivo fora de `src/lib/custos.ts` + `tests/lib/custos.test.ts` modificado.
- [ ] Linha de status atualizada em `plans/README.md`.

## STOP conditions

Pare e reporte se:

- Algum teste revelar que o código **não** se comporta como descrito acima (ex.: a precedência é outra) —
  reporte a divergência; o objetivo é caracterizar a verdade, não impor a expectativa.
- O extract de `montarMapasCusto` exigir mudar a query ou o filtro de `buscarCustos` (não deveria).

## Maintenance notes

- **Follow-up destravado pelo Plan 009 (deno test)**: caracterizar também `getValidAccessToken`
  (`_shared/ml/token.ts` — lock OAuth, guarda de rotação incompleta linhas 101-103) e `io.ts`
  (`upsertVenda`/`carregarCatalogo`), que hoje não rodam sob vitest (acoplados a Deno).
- Há um finding relacionado **não** coberto aqui (de propósito): variação com peso mas **sem custo** é
  descartada de TODOS os mapas (`buscarCustos` filtra `custo IS NULL`), degradando o rateio por peso.
  Os testes documentam esse comportamento atual; corrigi-lo é decisão à parte.
- Revisor deve checar: testes são characterization (descrevem o atual), não mudam comportamento.
