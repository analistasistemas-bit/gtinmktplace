# Plan 013: Paginar as queries de dinheiro (evitar truncamento silencioso em ~1000 linhas)

> **Executor instructions**: Follow step by step. Run every verification command. If
> anything in "STOP conditions" occurs, stop and report. When done, update the status
> row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7222675..HEAD -- src/lib/faturamento.ts src/lib/custos.ts`
> Se algum mudou desde `7222675`, compare os excerpts com o atual; divergência = STOP.
> (Coordena com **Plan 006** — `select` de `buscarVendas` — e **Plan 011** — extract `montarMapasCusto`.
> Se já aplicados, rebase sobre eles.)

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: coordena com 006 e 011 (mesmos arquivos)
- **Category**: bug
- **Planned at**: commit `7222675`, 2026-06-26

## Why this matters

As queries de dinheiro não têm `.range()`/`.limit()` (confirmado: `grep` por `.range(`/`.limit(` em
todo `src` = 0). O Supabase/PostgREST aplica um **teto padrão de ~1000 linhas** por resposta. Quando um
tenant passar de ~1000 pedidos no período (ou ~1000 variações com custo), o resultado é **cortado em
silêncio**: faturamento/líquido/markup/unidades ficam subnotificados e o custo de parte dos produtos
some. `buscarVendas` ordena `date_closed desc`, então o corte derruba o **início** da janela. Hoje é
single-tenant (52 vendas), não bate — mas o roadmap é SaaS multi-tenant (E5+), e um número de dinheiro
errado exibido como definitivo é o pior tipo de bug silencioso.

## Current state

- `src/lib/faturamento.ts:58-71` (`buscarVendas`) — `select(...).gte(...).lte(...).order(...)`, **sem range**.
- `src/lib/custos.ts:23-28` (`buscarCustos`) — `select(...).not('custo','is',null)`, **sem range**.
- Não existe helper de paginação no projeto.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Test (helper) | `pnpm vitest run tests/lib/paginacao-supabase.test.ts` | passa |
| Test (suíte) | `pnpm test` | todos passam |
| Typecheck | `pnpm exec tsc -b` | exit 0 |
| Lint | `pnpm lint` | 0 errors |

## Scope

**In scope**:
- `src/lib/paginacao-supabase.ts` (criar — helper genérico)
- `tests/lib/paginacao-supabase.test.ts` (criar)
- `src/lib/faturamento.ts` (`buscarVendas` usa o helper)
- `src/lib/custos.ts` (`buscarCustos` usa o helper)

**Out of scope**:
- `src/lib/fotos-produto.ts` (também sem limite, mas não é caminho de dinheiro — deixar para outro passe).
- Não mudar filtros/ordenação/colunas das queries.

## Git workflow

- Worktree isolado. Commit, ex.: `fix(faturamento): pagina queries de dinheiro p/ não truncar em 1000 (#013)`
- NÃO push/PR sem o operador pedir.

## Steps

### Step 1: Criar o helper `buscarTodasPaginas`

`src/lib/paginacao-supabase.ts`:

```ts
/** Lê todas as páginas de uma query Supabase, evitando o teto padrão (~1000) do PostgREST.
 *  `pagina(de, ate)` deve aplicar `.range(de, ate)` e ser thenable resolvendo { data, error }. */
export async function buscarTodasPaginas<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  tamanho = 1000,
): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += tamanho) {
    const { data, error } = await pagina(de, de + tamanho - 1);
    if (error) throw new Error(error.message);
    const lote = data ?? [];
    todas.push(...lote);
    if (lote.length < tamanho) break;
  }
  return todas;
}
```

**Verify**: `pnpm exec tsc -b` → exit 0.

### Step 2: Testar o helper

`tests/lib/paginacao-supabase.test.ts` (modelo: `tests/hooks/usePaginacao.test.ts` ou qualquer `tests/lib/*`):
- 1 página curta (< tamanho) → retorna tudo, 1 chamada.
- 2 páginas cheias + 1 curta → concatena na ordem, para na curta.
- página exatamente cheia seguida de vazia → para na vazia (sem loop infinito).
- `error` numa página → lança.
Use `tamanho` pequeno (ex.: 2) e um fake `pagina` com arrays fixos.

**Verify**: `pnpm vitest run tests/lib/paginacao-supabase.test.ts` → passa.

### Step 3: Aplicar em `buscarVendas`

Reescreva o corpo para construir a query por página e delegar ao helper (preservando filtros/ordem e a
lista de colunas — se o Plan 006 já entrou, mantenha a lista explícita; senão o `select` atual):

```ts
export async function buscarVendas(janela: Janela, origem: OrigemVenda = 'todos'): Promise<Venda[]> {
  return buscarTodasPaginas<Venda>((de, ate) => {
    let q = supabase
      .from('ml_vendas')
      .select(/* mesma string de colunas atual */)
      .gte('date_closed', janela.desde)
      .lte('date_closed', janela.ate)
      .order('date_closed', { ascending: false })
      .range(de, ate);
    if (origem === 'publiai') q = q.eq('is_publiai', true);
    if (origem === 'fora') q = q.eq('is_publiai', false);
    return q as unknown as PromiseLike<{ data: Venda[] | null; error: { message: string } | null }>;
  });
}
```

**Verify**: `grep -n "range(" src/lib/faturamento.ts` → mostra o `.range`; `pnpm exec tsc -b` exit 0.

### Step 4: Aplicar em `buscarCustos`

Pagine a leitura de `variacoes` da mesma forma (preservando `.not('custo','is',null)`), e passe o
resultado a `montarMapasCusto` (se o Plan 011 entrou) ou ao loop atual:

```ts
const rows = await buscarTodasPaginas<Record<string, unknown>>((de, ate) =>
  supabase.from('variacoes')
    .select('custo, peso_gramas, ml_variation_id, gtin, familias!inner(ml_item_id)')
    .not('custo', 'is', null)
    .range(de, ate) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
);
// segue com montarMapasCusto(rows) ou o loop existente sobre `rows`.
```

**Verify**: `grep -n "range(" src/lib/custos.ts` → mostra o `.range`; `pnpm exec tsc -b` exit 0.

### Step 5: Sanidade final

**Verify**: `pnpm exec tsc -b && pnpm test && pnpm lint` → tsc 0, testes passam, lint 0 errors.

## Test plan

- Novo `tests/lib/paginacao-supabase.test.ts` (4 casos do Step 2).
- Os testes existentes que consomem `buscarVendas`/`buscarCustos` (ex.: `tests/lib/detalhe-vendas.test.ts`)
  continuam verdes (comportamento idêntico para conjuntos < 1000).
- Verificação: `pnpm test`.

## Done criteria

- [ ] `buscarTodasPaginas` existe e está testado (≥ 4 casos).
- [ ] `buscarVendas` e `buscarCustos` usam `.range()` via o helper.
- [ ] `pnpm exec tsc -b` exit 0; `pnpm test` passa; `pnpm lint` 0 errors.
- [ ] Nenhum arquivo fora do escopo modificado.
- [ ] Linha de status atualizada em `plans/README.md`.

## STOP conditions

Pare e reporte se:

- O cast `as unknown as PromiseLike<...>` não satisfizer o tsc (a API do supabase-js mudou) — reporte o tipo real.
- Algum teste existente de vendas/custos quebrar (sinal de mudança de comportamento não-intencional).

## Maintenance notes

- O mesmo helper serve para `fotos-produto.ts` e qualquer query futura sem limite — reusar.
- Revisor deve checar: o `tamanho` (1000) bate com o teto real do projeto; se o teto do PostgREST for
  configurado diferente, ajustar a constante.
