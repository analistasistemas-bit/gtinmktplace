# Clientes, Links e Pedidos Cancelados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Identificar clientes em Perguntas e Mensagens, adicionar o link do anúncio às conversas e impedir que pedidos cancelados apareçam ou sejam tratados como aguardando resposta.

**Architecture:** A sincronização normaliza metadados já disponíveis no Mercado Livre e em `ml_vendas` para colunas próprias. A lista, o badge e o endpoint de resposta consomem a mesma regra de cancelamento; a interface apenas representa o estado normalizado e o servidor continua sendo a barreira autoritativa.

**Tech Stack:** React 18, TypeScript 5.7, TanStack Query, Supabase/PostgreSQL, Supabase Edge Functions (Deno), Vitest.

## Global Constraints

- Quando rodar comandos shell, sempre prefixar cada segmento com `rtk`.
- Executar tudo no worktree isolado `.worktrees/customer-names-links`, nunca no checkout principal.
- Stop at the first solution that works.
- Deletion beats addition. Reuse beats rewriting. Simple beats clever.
- No speculative abstractions, unnecessary dependencies, unrelated refactors or unrelated formatting.
- Fix root cause, not symptoms.
- Run the smallest validation that proves the change.
- Nenhuma produção sem teste falhando primeiro; confirmar RED, depois GREEN.
- Preservar validação, segurança, acessibilidade, integridade dos dados e todos os requisitos explícitos.

## File Structure

- `supabase/migrations/20260727120000_clientes_links_mensagens_canceladas.sql` — acrescenta colunas, preenche registros existentes e corrige a RPC do badge.
- `supabase/functions/_shared/faturamento/pergunta.ts` — normaliza o apelido da pergunta.
- `supabase/functions/_shared/faturamento/perguntas-io.ts` — persiste o apelido normalizado.
- `supabase/functions/_shared/faturamento/mensagens-io.ts` — resolve e persiste metadados de venda por pack.
- `supabase/functions/backfill-faturamento/index.ts` e `supabase/functions/sync-mensagem/index.ts` — passam os metadados normalizados ao upsert.
- `src/lib/perguntas.ts` e `src/components/faturamento/aba-perguntas.tsx` — expõem e mostram a identificação da pergunta.
- `src/lib/mensagens.ts` e `src/components/faturamento/aba-mensagens.tsx` — aplicam cancelamento, identificação e link do anúncio.
- `supabase/functions/responder-mensagem/index.ts` — consulta o status autoritativo e bloqueia envio cancelado.
- Testes existentes próximos aos módulos serão estendidos; nenhum novo helper ou dependência será criado sem necessidade.

---

### Task 1: Persistir metadados de cliente, anúncio e pedido

**Responsável:** executor Terra, sequencial.

**Files:**
- Create: `supabase/migrations/20260727120000_clientes_links_mensagens_canceladas.sql`
- Modify: `supabase/functions/_shared/faturamento/pergunta.ts`
- Modify: `supabase/functions/_shared/faturamento/perguntas-io.ts`
- Modify: `supabase/functions/_shared/faturamento/mensagens-io.ts`
- Modify: `supabase/functions/backfill-faturamento/index.ts`
- Modify: `supabase/functions/sync-mensagem/index.ts`
- Modify: `supabase/functions/responder-mensagem/index.ts` somente nas chamadas pós-envio de `resolverMetaPack`/`upsertMensagens`
- Test: `supabase/functions/_shared/faturamento/__tests__/pergunta.test.ts`
- Test: `supabase/functions/_shared/faturamento/__tests__/mensagens-io.test.ts`

**Interfaces:**
- Produces `PerguntaML.from?: { id?: number | string | null; nickname?: string | null } | null`.
- Produces `PerguntaRow.comprador_nick: string | null`.
- Produces:

```ts
export interface MetaPack {
  orderId: string | null;
  itemId: string | null;
  itemTitulo: string | null;
  compradorNome: string | null;
  compradorNick: string | null;
  orderStatus: string | null;
}
```

- Produces `resolverMetaPack(...): Promise<MetaPack>`.
- Produces `PackVenda extends MetaPack { packId: string }`.
- Changes `upsertMensagens` to consume `meta: MetaPack` between `packId` and `sellerId`.

- [ ] **Step 1: Write failing mapper and persistence tests**

In `pergunta.test.ts`, extend the non-answered fixture with `nickname: 'CLIENTE_01'` and require:

```ts
expect(r.comprador_nick).toBe('CLIENTE_01');
```

Require the absent-fields result to include:

```ts
comprador_nick: null,
```

In `mensagens-io.test.ts`, define:

```ts
const META = {
  orderId: 'order-1',
  itemId: 'MLB123',
  itemTitulo: 'Produto X',
  compradorNome: 'Maria Silva',
  compradorNick: 'MARIA_01',
  orderStatus: 'paid',
};
```

Call `upsertMensagens(admin, 'user-1', 'org-1', 'pack-1', META, SELLER_ID, msgs)` and assert the first upsert rows contain:

```ts
expect.objectContaining({
  order_id: 'order-1',
  item_id: 'MLB123',
  item_titulo: 'Produto X',
  comprador_nome: 'Maria Silva',
  comprador_nick: 'MARIA_01',
  order_status: 'paid',
})
```

- [ ] **Step 2: Verify RED**

Run:

```bash
rtk pnpm test -- supabase/functions/_shared/faturamento/__tests__/pergunta.test.ts supabase/functions/_shared/faturamento/__tests__/mensagens-io.test.ts
```

Expected: FAIL because `comprador_nick`, `MetaPack` and the new `upsertMensagens` signature do not exist.

- [ ] **Step 3: Add the migration**

Create `supabase/migrations/20260727120000_clientes_links_mensagens_canceladas.sql` with:

```sql
alter table public.ml_perguntas
  add column if not exists comprador_nick text;

alter table public.ml_mensagens
  add column if not exists item_id text,
  add column if not exists comprador_nome text,
  add column if not exists comprador_nick text,
  add column if not exists order_status text;

update public.ml_perguntas
set comprador_nick = nullif(raw #>> '{from,nickname}', '')
where comprador_nick is null;

with meta as (
  select distinct on (m.id)
    m.id,
    i.ml_item_id::text as item_id,
    v.comprador_nome,
    v.comprador_nick,
    v.status as order_status
  from public.ml_mensagens m
  join public.ml_vendas v
    on v.user_id = m.user_id
   and (
     v.order_id::text = m.order_id
     or v.pack_id::text = m.pack_id
     or (v.pack_id is null and v.order_id::text = m.pack_id)
   )
  left join lateral (
    select vi.ml_item_id
    from public.ml_vendas_itens vi
    where vi.venda_id = v.id
    order by vi.id
    limit 1
  ) i on true
  order by m.id, v.date_created desc nulls last
)
update public.ml_mensagens m
set item_id = coalesce(m.item_id, meta.item_id),
    comprador_nome = coalesce(m.comprador_nome, meta.comprador_nome),
    comprador_nick = coalesce(m.comprador_nick, meta.comprador_nick),
    order_status = coalesce(meta.order_status, m.order_status)
from meta
where m.id = meta.id;
```

- [ ] **Step 4: Implement the normalized interfaces**

In `pergunta.ts`, add `nickname` to `PerguntaML.from`, `comprador_nick` to `PerguntaRow`, and:

```ts
comprador_nick: q.from?.nickname?.trim() || null,
```

In `mensagens-io.ts`, make `resolverMetaPack` select:

```ts
'order_id, status, comprador_nome, comprador_nick, ml_vendas_itens(ml_item_id, titulo)'
```

Map the first item and return every `MetaPack` field. Make `listarPacksDeVendas` select the same metadata and return it per unique pack. Make `upsertMensagens` write all fields from `meta`.

Update all three callers to pass the returned `MetaPack` object unchanged.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
rtk pnpm test -- supabase/functions/_shared/faturamento/__tests__/pergunta.test.ts supabase/functions/_shared/faturamento/__tests__/mensagens-io.test.ts
rtk pnpm run check:functions
```

Expected: both test files PASS and Deno check exits zero.

- [ ] **Step 6: Commit**

```bash
rtk git add supabase/migrations supabase/functions/_shared/faturamento supabase/functions/backfill-faturamento/index.ts supabase/functions/sync-mensagem/index.ts supabase/functions/responder-mensagem/index.ts
rtk git commit -m "feat: sincroniza clientes e metadados das mensagens"
```

---

### Task 2: Aplicar identificação, link e regra de cancelamento na lista e badge

**Responsável:** executor Terra, depende da Task 1.

**Files:**
- Modify: migration criada na Task 1
- Modify: `src/lib/perguntas.ts`
- Modify: `src/lib/mensagens.ts`
- Modify: `src/components/faturamento/aba-perguntas.tsx`
- Modify: `src/components/faturamento/aba-mensagens.tsx`
- Test: `src/lib/__tests__/mensagens-conversas.test.ts`
- Test: `src/lib/__tests__/perguntas.test.ts` se já existir; caso contrário, testar somente o mapeamento puro da Task 1 e validar a renderização via typecheck/lint.

**Interfaces:**
- `Pergunta.comprador_nick: string | null`.
- `Mensagem.item_id`, `comprador_nome`, `comprador_nick`, `order_status`: `string | null`.
- `Conversa` expõe os mesmos quatro campos.
- A identificação usa `comprador_nome?.trim() || comprador_nick?.trim() || 'Comprador'`.
- `Conversa.aguardando` é verdadeira somente se `order_status !== 'cancelled'` e a última mensagem é recebida.

- [ ] **Step 1: Write the failing conversation test**

Extend the `msg` fixture with the four nullable fields. Add:

```ts
it('pedido cancelado nunca aguarda resposta mesmo se a última mensagem é recebida', async () => {
  mockOrder.mockResolvedValueOnce({
    data: [msg({
      direcao: 'recebida',
      order_status: 'cancelled',
      comprador_nome: 'Maria Silva',
      comprador_nick: 'MARIA_01',
      item_id: 'MLB123',
    })],
    error: null,
  });
  const [conversa] = await buscarConversas();
  expect(conversa).toMatchObject({
    aguardando: false,
    order_status: 'cancelled',
    comprador_nome: 'Maria Silva',
    comprador_nick: 'MARIA_01',
    item_id: 'MLB123',
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
rtk pnpm test -- src/lib/__tests__/mensagens-conversas.test.ts
```

Expected: FAIL because the types/query/grouping do not expose order metadata and cancelled still awaits.

- [ ] **Step 3: Implement list and badge rules**

Select the new columns in `buscarConversas`, copy them from the first non-null message while grouping, and calculate:

```ts
c.aguardando = c.order_status !== 'cancelled' && ultima?.direcao === 'recebida';
```

In the Task 1 migration, replace the RPC with the same rule:

```sql
create or replace function public.contar_conversas_aguardando()
returns integer
language sql
security definer
set search_path = public
as $$
  with ultimas as (
    select distinct on (pack_id) direcao, order_status
    from public.ml_mensagens
    where user_id = auth.uid()
    order by pack_id, data_ml desc nulls last, message_id desc
  )
  select count(*)::int
  from ultimas
  where direcao = 'recebida'
    and coalesce(order_status, '') <> 'cancelled';
$$;
```

- [ ] **Step 4: Implement the minimal UI**

In Perguntas, add `comprador_nick` to the query/type and show it in the metadata line with fallback `Comprador`.

In Mensagens:

- import `ExternalLink` and `urlAnuncioML`;
- compute `const cancelada = c.order_status === 'cancelled'`;
- compute the client label with the required fallback;
- render an external link only when `c.item_id` exists:

```tsx
<a
  href={urlAnuncioML(c.item_id)}
  target="_blank"
  rel="noreferrer"
  aria-label="Abrir anúncio no Mercado Livre"
  className="text-info hover:underline"
>
  <ExternalLink className="h-3 w-3" />
</a>
```

- render `Pedido cancelado` with danger tone instead of `Aguardando resposta`;
- replace `Comprador` on received bubbles with the client label;
- set `disabled={cancelada}` on `Textarea`;
- include `cancelada` in both IA and send button disabled expressions.

- [ ] **Step 5: Verify GREEN and UI static gates**

Run:

```bash
rtk pnpm test -- src/lib/__tests__/mensagens-conversas.test.ts src/hooks/__tests__/useMensagens.test.ts
rtk pnpm run build
rtk pnpm exec eslint src/components/faturamento/aba-perguntas.tsx src/components/faturamento/aba-mensagens.tsx src/lib/perguntas.ts src/lib/mensagens.ts
```

Expected: tests PASS, build succeeds and targeted ESLint exits zero.

- [ ] **Step 6: Commit**

```bash
rtk git add supabase/migrations src/lib src/components/faturamento
rtk git commit -m "feat: identifica clientes e trata conversas canceladas"
```

---

### Task 3: Bloquear envio cancelado e traduzir o erro do Mercado Livre

**Responsável:** executor Terra, depende da Task 1.

**Files:**
- Modify: `supabase/functions/_shared/faturamento/mensagens-io.ts`
- Modify: `supabase/functions/responder-mensagem/index.ts`
- Test: `supabase/functions/_shared/faturamento/__tests__/mensagens-io.test.ts`

**Interfaces:**
- Produces `pedidoCancelado(status: string | null | undefined): boolean`.
- Produces `mensagemErroEnvioML(status: number, corpo: string): string`.
- `responderMensagemPedido` uses `mensagemErroEnvioML` when `resp.ok === false`.

- [ ] **Step 1: Write failing guard/error tests**

Add:

```ts
expect(pedidoCancelado('cancelled')).toBe(true);
expect(pedidoCancelado('paid')).toBe(false);
expect(pedidoCancelado(null)).toBe(false);
expect(mensagemErroEnvioML(
  403,
  '{"code":"forbidden","message":"blocked_by_cancelled_order"}',
)).toBe('Não é possível responder porque o pedido foi cancelado.');
expect(mensagemErroEnvioML(429, 'Too many requests')).toMatch(/ML \/messages 429/);
```

- [ ] **Step 2: Verify RED**

Run:

```bash
rtk pnpm test -- supabase/functions/_shared/faturamento/__tests__/mensagens-io.test.ts
```

Expected: FAIL because both pure functions are missing.

- [ ] **Step 3: Implement the pure rules and authoritative guard**

Implement:

```ts
export const pedidoCancelado = (status: string | null | undefined): boolean =>
  status === 'cancelled';

export function mensagemErroEnvioML(status: number, corpo: string): string {
  if (status === 403 && corpo.includes('blocked_by_cancelled_order')) {
    return 'Não é possível responder porque o pedido foi cancelado.';
  }
  return `ML /messages ${status}: ${corpo.slice(0, 200)}`;
}
```

Read `await resp.text()` once in `responderMensagemPedido` and throw with this message.

In `responder-mensagem/index.ts`, call `resolverMetaPack` before resolving buyer/sending and return:

```ts
if (pedidoCancelado(meta.orderStatus)) {
  return erro('Não é possível responder porque o pedido foi cancelado.', 409);
}
```

This check must occur before `responderMensagemPedido`; preserve the current audit and catch path for a cancellation race after the check.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
rtk pnpm test -- supabase/functions/_shared/faturamento/__tests__/mensagens-io.test.ts
rtk pnpm run check:functions
```

Expected: tests PASS and Deno check exits zero.

- [ ] **Step 5: Commit**

```bash
rtk git add supabase/functions/_shared/faturamento/mensagens-io.ts supabase/functions/_shared/faturamento/__tests__/mensagens-io.test.ts supabase/functions/responder-mensagem/index.ts
rtk git commit -m "fix: bloqueia resposta de pedido cancelado"
```

## Final Verification

After all tasks and reviews:

```bash
rtk pnpm test -- supabase/functions/_shared/faturamento/__tests__/pergunta.test.ts supabase/functions/_shared/faturamento/__tests__/mensagens-io.test.ts src/lib/__tests__/mensagens-conversas.test.ts src/hooks/__tests__/useMensagens.test.ts
rtk pnpm run build
rtk pnpm run check:functions
rtk pnpm exec eslint src/components/faturamento/aba-perguntas.tsx src/components/faturamento/aba-mensagens.tsx src/lib/perguntas.ts src/lib/mensagens.ts
rtk git diff --check
```

Run the app and verify in the browser:

1. Pergunta displays nickname/login.
2. Message displays full name, falling back to nickname/login.
3. Message title includes the external ML link with accessible label.
4. Cancelled conversation shows `Pedido cancelado`, has no awaiting pill, and all reply controls are disabled.
5. The Messages badge excludes the cancelled conversation.
6. A stale direct send attempt receives the friendly cancellation error rather than the ML JSON.

## Self-Review Record

- Spec coverage: all requirements map to Tasks 1–3; no gaps found.
- Placeholder scan: no deferred implementation markers remain.
- Type consistency: `MetaPack`, `Pergunta.comprador_nick`, message metadata and cancellation values use the same names and nullable string types across tasks.
- Scope: one cohesive synchronization-and-presentation change; no unrelated subsystem included.
