# Plan 012: Eliminar a corrida que duplica `ml_vendas_itens` (unique key + upsert idempotente)

> **Executor instructions**: Follow step by step. Run every verification command. If
> anything in "STOP conditions" occurs, stop and report. When done, update the status
> row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7222675..HEAD -- supabase/functions/_shared/faturamento/io.ts`
> Se `io.ts` mudou desde `7222675`, compare o excerpt abaixo com o atual; divergência = STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (toca schema de produção e caminho de dinheiro)
- **Depends on**: idealmente após 011 (rede de testes) e 009 (deno check para validar `io.ts`)
- **Category**: bug / migration
- **Planned at**: commit `7222675`, 2026-06-26

## Why this matters

`upsertVenda` grava o cabeçalho da venda com `upsert(onConflict:'user_id,order_id')` (protegido por
unique), mas substitui os **itens** com um `delete` seguido de `insert` em **dois statements
separados, sem transação nem unique key** (`ml_vendas_itens` só tem PK `id` + índice **não-único** em
`venda_id`). Quando dois syncs do **mesmo** `order_id` rodam concorrentes — webhook `orders_v2` +
`shipments`, ou um webhook enquanto o `reconciliar-faturamento` horário roda — o delete-then-insert
**duplica as linhas de item**. A tela de Faturamento soma `quantity`/`unit_price`/custo desses itens →
**unidades dobradas e markup errado** para o operador. A fila serial do projeto (`_shared/queue.ts:42`,
ADR-0034) é só do **publish ML** e **não** cobre o caminho de sync; logo a janela de corrida está aberta.

## Current state

`supabase/functions/_shared/faturamento/io.ts:188-199` (dentro de `upsertVenda`):

```ts
  const { data: up, error } = await admin.from('ml_vendas')
    .upsert(row, { onConflict: 'user_id,order_id' }).select('id').single();
  if (error) throw new Error(`upsert ml_vendas: ${error.message}`);
  const vendaId = up!.id as string;

  // Substitui os itens (idempotente).
  await admin.from('ml_vendas_itens').delete().eq('venda_id', vendaId);
  if (itens.length > 0) {
    await admin.from('ml_vendas_itens').insert(
      itens.map((i: VendaItemRow) => ({ user_id: userId, venda_id: vendaId, ...i })),
    );
  }
```

Schema atual (`supabase/migrations/20260622193345_faturamento_vendas.sql:38-52`): `ml_vendas_itens`
tem PK `id`, FK `venda_id → ml_vendas(id) on delete cascade`, e `create index ml_vendas_itens_venda_idx
on ... (venda_id)` (**não-único**). RLS habilitada, policy só de SELECT (escrita por service role).

**Estado do dado em produção (verificado 2026-06-26 via `execute_sql`)**: 52 itens; `ml_item_id`
**nunca null**; `variation_id` null em 16 linhas; **0 grupos duplicados** sob a chave proposta
`(venda_id, ml_item_id, variation_id)` com nulos tratados como iguais. Ou seja, a unique key pode ser
criada **sem perda** hoje — mas o Step 1 re-checa antes de aplicar.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Nova migration | `supabase migration new add_ml_vendas_itens_unique` | cria arquivo timestampado vazio |
| Validar SQL | `node -e "..."` (leitura do arquivo) | arquivo contém o índice esperado |
| Alinhamento | `npm run db:check` | "Migrations alinhadas" (após push pelo operador) |
| Typecheck FE | `pnpm exec tsc -b` | exit 0 |

**Regra do projeto (ADR-0043)**: schema só muda via `supabase migration new` + `supabase db push`.
**Proibido** `apply_migration` por MCP/painel ou timestamp inventado à mão.

## Scope

**In scope**:
- Uma nova migration em `supabase/migrations/` (criada pelo CLI) — adiciona a unique key.
- `supabase/functions/_shared/faturamento/io.ts` (trocar `insert` por `upsert` idempotente).

**Out of scope**:
- **NÃO rodar `supabase db push` contra produção** — aplicar é passo do operador (ver Maintenance).
- Não mudar a lógica de mapeamento (`mapearPedidoParaVenda`) nem o cabeçalho `ml_vendas`.
- Não alterar RLS nem as policies.

## Git workflow

- Worktree isolado. Commits, ex.: `fix(faturamento): unique key + upsert idempotente em ml_vendas_itens (#012)`
- NÃO push/PR/deploy sem o operador pedir.

## Steps

### Step 1: Re-checar o dado antes de desenhar a chave (STOP se mudou)

Rode (read-only) e confirme que ainda vale o que o plano assume:
```sql
select count(*) filter (where ml_item_id is null) as ml_item_id_null,
  (select count(*) from (select venda_id, coalesce(ml_item_id,'') mi, coalesce(variation_id,0) vi
     from public.ml_vendas_itens group by 1,2,3 having count(*)>1) d) as dups
from public.ml_vendas_itens;
```
- Se `ml_item_id_null > 0` → **STOP**: a chave `(venda_id, ml_item_id, variation_id) nulls not distinct`
  pode colapsar itens distintos não-identificados; a chave precisa ser repensada antes de prosseguir.
- Se `dups > 0` → o Step 2 inclui dedup; confirme que os duplicados são realmente o mesmo item (re-sync),
  não vendas distintas. Em dúvida, **STOP**.

### Step 2: Criar a migration da unique key

`supabase migration new add_ml_vendas_itens_unique`. No arquivo gerado, escreva:

```sql
-- Idempotência dos itens de venda: impede linhas duplicadas quando dois syncs do mesmo
-- pedido rodam concorrentes (webhook orders_v2 + shipments, ou webhook + reconciliar). Ver plans/012.

-- Dedup defensivo (no-op quando já não há duplicatas) antes de criar o índice único.
delete from public.ml_vendas_itens a
using public.ml_vendas_itens b
where a.ctid < b.ctid
  and a.venda_id = b.venda_id
  and coalesce(a.ml_item_id, '') = coalesce(b.ml_item_id, '')
  and coalesce(a.variation_id, 0) = coalesce(b.variation_id, 0);

-- nulls not distinct (PG15+): trata variation_id null como igual, para um item sem variação
-- não duplicar. ml_item_id é sempre preenchido no dado atual (verificado).
create unique index if not exists ml_vendas_itens_uniq
  on public.ml_vendas_itens (venda_id, ml_item_id, variation_id) nulls not distinct;
```

**Verify**: `node -e "const fs=require('fs');const d='supabase/migrations';const f=fs.readdirSync(d).filter(x=>x.includes('add_ml_vendas_itens_unique')).sort().pop();const t=fs.readFileSync(d+'/'+f,'utf8');if(!/nulls not distinct/i.test(t)||!/create unique index/i.test(t))throw new Error('migration incompleta');console.log('migration OK:',f)"` → `migration OK: <arquivo>`.

### Step 3: Trocar `insert` por `upsert` idempotente em `io.ts`

Substitua o bloco de itens por (mantém o `delete` para remover itens que sumiram do pedido; o `upsert`
com `onConflict` garante zero duplicata sob corrida; adiciona checagem de erro que hoje falta):

```ts
  // Substitui os itens. Idempotente: unique (venda_id, ml_item_id, variation_id) impede
  // duplicata quando dois syncs do mesmo pedido correm concorrentes (ver plans/012).
  await admin.from('ml_vendas_itens').delete().eq('venda_id', vendaId);
  if (itens.length > 0) {
    const { error: itensErr } = await admin.from('ml_vendas_itens').upsert(
      itens.map((i: VendaItemRow) => ({ user_id: userId, venda_id: vendaId, ...i })),
      { onConflict: 'venda_id,ml_item_id,variation_id' },
    );
    if (itensErr) throw new Error(`upsert ml_vendas_itens: ${itensErr.message}`);
  }
```

**Verify**: `grep -n "upsert" supabase/functions/_shared/faturamento/io.ts` → mostra o upsert dos itens;
`grep -n "\.insert(" supabase/functions/_shared/faturamento/io.ts` → não mostra mais o insert dos itens.

### Step 4: Sanidade

**Verify**: `pnpm exec tsc -b` exit 0 (não cobre Deno, mas garante que nada do FE quebrou). Se o Plan 009
estiver aplicado, rode `pnpm lint:functions` no `io.ts` para checar sintaxe Deno.

## Test plan

- `io.ts` não roda sob vitest (acoplado a Deno/supabase-js) — por isso **não há teste unitário direto**
  aqui hoje. A garantia vem de: (a) a unique key no banco (impede duplicata por construção); (b) o upsert
  idempotente; (c) revisão do diff pequeno.
- **Validação do operador** (após `db push`): re-sincronizar um pedido já existente (botão "Sincronizar"
  ou disparar o webhook 2×) e confirmar via `select count(*) from ml_vendas_itens where venda_id = ...`
  que a contagem de itens **não muda** (idempotente).
- **Follow-up (após Plan 009 / deno test)**: teste de orquestração de `upsertVenda` com fake `SupabaseClient`.

## Done criteria

- [ ] Step 1 re-checado: `ml_item_id_null = 0` e dups tratados (ou STOP acionado).
- [ ] Migration criada via `supabase migration new`, com dedup + unique index `nulls not distinct`.
- [ ] `io.ts` usa `upsert(onConflict:'venda_id,ml_item_id,variation_id')` com checagem de erro; sem `.insert` de itens.
- [ ] `pnpm exec tsc -b` exit 0.
- [ ] Nenhum arquivo fora do escopo modificado.
- [ ] Linha de status atualizada em `plans/README.md`.

## STOP conditions

Pare e reporte se:

- Step 1: `ml_item_id_null > 0` ou dups suspeitos (chave precisa ser repensada — risco de perda de dado).
- A migration `db push` (passo do operador) falhar na criação do índice por duplicata remanescente.
- Você for tentado a rodar `supabase db push` contra produção — é passo do operador, não do executor.

## Maintenance notes

- **Passo do operador (após merge)**: `supabase db push` (com `SUPABASE_ACCESS_TOKEN` do `.env.local`),
  depois `npm run db:check` (deve dizer "Migrations alinhadas"), e **redeploy** das funções que chamam
  `upsertVenda` (`sync-venda`, `backfill-faturamento`, `reconciliar-faturamento`) para o `io.ts` novo valer.
- A unique key também protege qualquer **futuro** caller de `upsertVenda` (não depende de lembrar de lockar).
- Revisor deve checar: a chave não colapsa itens distintos (depende de `ml_item_id` não-null — re-checado no Step 1).
