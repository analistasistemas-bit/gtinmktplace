# Plan 006: Parar de baixar a coluna `raw` (payload ML inteiro) na listagem de vendas

> **Executor instructions**: Follow step by step. Run every verification command and
> confirm the expected result before moving on. If anything in "STOP conditions"
> occurs, stop and report. When done, update the status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7222675..HEAD -- src/lib/faturamento.ts`
> Se `faturamento.ts` mudou desde `7222675`, compare o excerpt abaixo com o código atual
> antes de prosseguir; divergência = STOP. (Nota: o **Plan 013** também edita `buscarVendas`;
> se 013 já tiver sido aplicado, rebase este sobre ele.)

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (coordenar com Plan 013 — ambos tocam `buscarVendas`)
- **Category**: perf
- **Planned at**: commit `7222675`, 2026-06-26

## Why this matters

`buscarVendas` faz `select('*, itens:ml_vendas_itens(*)')` em `ml_vendas`. A tabela tem uma coluna
`raw jsonb` que guarda o **payload inteiro do pedido do ML** (vários KB por linha) — e a UI nunca
lê esse campo (`grep` por `.raw` no frontend = 0 usos; a interface `Venda` não tem `raw`). Pior: o
hook `useVendas` refaz a query a cada 45 s (`refetchInterval: 45_000`) em 3 telas (Faturamento,
Financeiro, Publicados via `useResumoVendas`). Resultado: baixa e faz parse de centenas de KB de
JSON morto continuamente. O índice `(user_id, date_closed desc)` já existe, então o gargalo é só
payload — trocar `*` por colunas explícitas é remoção pura de peso, sem mudar nenhum resultado.

## Current state

`src/lib/faturamento.ts:58-71`:

```ts
/** Lê as vendas do período direto da tabela (RLS por user). Inclui os itens. */
export async function buscarVendas(janela: Janela, origem: OrigemVenda = 'todos'): Promise<Venda[]> {
  let q = supabase
    .from('ml_vendas')
    .select('*, itens:ml_vendas_itens(*)')
    .gte('date_closed', janela.desde)
    .lte('date_closed', janela.ate)
    .order('date_closed', { ascending: false });
  if (origem === 'publiai') q = q.eq('is_publiai', true);
  if (origem === 'fora') q = q.eq('is_publiai', false);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Venda[];
}
```

A interface `Venda` (`src/lib/faturamento.ts:22-56`) define **exatamente** os campos que o código
lê (o `as Venda[]` garante que só esses são usados). Os campos da interface `Venda` e da
sub-interface `VendaItem` (`:8-20`) são os nomes das colunas — listá-los explicitamente é seguro.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `pnpm exec tsc -b` | exit 0 |
| Test | `pnpm test` | todos passam |
| Lint | `pnpm lint` | 0 errors |

## Scope

**In scope**:
- `src/lib/faturamento.ts` (só a string do `.select(...)` em `buscarVendas`)

**Out of scope**:
- Não mudar a assinatura nem o tipo de retorno de `buscarVendas`.
- Não tocar nas interfaces `Venda`/`VendaItem` (a menos que o STOP de drift mande).
- Não mexer em `useVendas`/`useResumoVendas` nem no `refetchInterval`.

## Git workflow

- Worktree isolado. Commit, ex.: `perf(faturamento): seleciona colunas explícitas (sem raw) em buscarVendas (#006)`
- NÃO push/PR sem o operador pedir.

## Steps

### Step 1: Trocar `select('*')` por lista explícita de colunas

Substitua a linha do `.select(...)` por (lista derivada das interfaces `Venda` e `VendaItem`):

```ts
    .select('id, order_id, pack_id, status, status_detail, date_closed, date_created, comprador_nick, comprador_nome, comprador_id, uf, cidade, total_amount, paid_amount, sale_fee_total, frete_vendedor, liquido, estorno, money_release_date, currency, shipping_id, shipping_status, shipping_substatus, shipping_logistic, tracking_number, is_publiai, tem_devolucao, itens:ml_vendas_itens(id, ml_item_id, variation_id, titulo, codigo, cor, ean, quantity, unit_price, sale_fee, is_publiai)')
```

**Verify**: `grep -n "select(" src/lib/faturamento.ts` → a linha de `buscarVendas` não contém mais `*`.

### Step 2: Confirmar que nada quebrou

**Verify**: `pnpm exec tsc -b && pnpm test && pnpm lint` → tsc exit 0, testes passam, lint 0 errors.

## Test plan

- Não há novo teste unitário simples (é uma query de rede; mockar o supabase aqui seria testar o
  mock). A garantia vem do typecheck (`as Venda[]` continua válido) + os testes existentes que
  consomem `Venda` (ex.: `tests/lib/detalhe-vendas.test.ts`, `tests/components/aba-vendas-pedido.test.tsx`)
  continuarem verdes.
- **Validação de runtime** (gate do operador, fora deste plano): abrir Faturamento no app real e
  confirmar que as colunas (faturamento, líquido, unidades, comprador, UF, status de envio)
  continuam batendo 1:1 com antes.

## Done criteria

Todos devem valer:

- [ ] `buscarVendas` usa lista explícita de colunas; sem `*` (Step 1).
- [ ] A lista inclui **todos** os campos das interfaces `Venda` e `VendaItem` e **não** inclui `raw`.
- [ ] `pnpm exec tsc -b` exit 0; `pnpm test` passa; `pnpm lint` 0 errors.
- [ ] Nenhum arquivo fora de `src/lib/faturamento.ts` modificado (`git status`).
- [ ] Linha de status atualizada em `plans/README.md`.

## STOP conditions

Pare e reporte se:

- A interface `Venda` ou `VendaItem` na cópia atual tiver campos diferentes dos listados no Step 1
  (a lista explícita precisa cobrir 100% dos campos lidos, senão vira `undefined` em runtime).
- O `tsc` acusar que algum campo lido não está na lista (campo faltando no select).
- Algum teste existente que consome `Venda` quebrar (sinal de campo omitido por engano).

## Maintenance notes

- **Acoplamento a vigiar**: a partir daqui, **adicionar campo à interface `Venda`/`VendaItem` exige
  adicionar a coluna nesta lista de `.select`** — senão o campo vem `undefined` silenciosamente.
  Vale um comentário curto no código apontando isso.
- Se o Plan 013 (paginação) for aplicado depois, ele edita o mesmo `buscarVendas`: manter a lista
  explícita ao adicionar `.range()`.
- Revisor deve checar: nenhuma coluna lida ficou de fora da lista.
