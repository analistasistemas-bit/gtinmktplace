# Plano Técnico: Tratativa de Pedido Cancelado em Mensagens

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans para implementar task por task. Passos usam checkbox (`- [ ]`).

**Goal:** Ao tentar responder mensagem pós-venda de pedido cancelado, persistir `order_status = 'cancelled'` em `ml_mensagens` (e `ml_vendas`), responder HTTP 409 com `codigo: 'pedido_cancelado'` e fazer a UI reagir: toast informativo, invalidação de queries e card marcado como cancelado.

**Architecture:** O ML bloqueia resposta em pedido cancelado com 403 `blocked_by_cancelled_order`. Hoje `responder-mensagem` detecta (check inicial e mensagem de erro traduzida) mas devolve o erro sem gravar o estado — o card continua "aguardando resposta" até o próximo sync. O fix adiciona `marcarConversaCancelada()` em `_shared/faturamento/mensagens-io.ts` (mesmo padrão de update de `io.ts:337-341`), invoca nos dois pontos de detecção do `responder-mensagem`, e propaga o `codigo` estruturado até a UI para reação local imediata.

**Tech Stack:** Deno Edge Functions (Supabase), Vitest, React + TanStack Query, sonner (toast).

**Spec:** pedido do operador (DSH orquestração) — responder mensagem de pedido cancelado não pode falhar silenciosamente nem deixar a UI desatualizada.

**Data:** 2026-09-08
**Worktree:** `.worktrees/plan-pedido-cancelado-mensagens` (branch `plan/pedido-cancelado-mensagens`)

## Visão Geral

Sintoma: operador responde conversa pós-venda → Edge Function devolve erro → UI mostra só `toast.error` → card segue como "aguardando resposta", badge não zera, conversa não aparece como cancelada.

Causa raiz (provada no código):

1. `supabase/functions/responder-mensagem/index.ts:44-46` — o check `pedidoCancelado(meta.orderStatus)` devolve 409 mas **não grava** o status em `ml_mensagens`.
2. O catch do envio (`index.ts:55-60`) trata o 403 do ML como erro genérico 502 — mesmo sem persistir o cancelamento.
3. `src/lib/mensagens.ts:94` — `postEdge` joga fora o corpo JSON do erro (`json.codigo`), só propaga a mensagem.
4. `src/components/faturamento/aba-mensagens.tsx:47` — o catch só faz `toast.error`; não invalida queries nem marca a conversa.

O sync de vendas já sabe propagar cancelamento (`io.ts:337-341` faz `.update({ order_status: venda.status })` em `ml_mensagens` por `order_id`/`pack_id`) — o gap é só no caminho interativo de resposta.

## Arquivos Envolvidos

| Arquivo | Mudança |
|---|---|
| `supabase/functions/_shared/faturamento/mensagens-io.ts` | Adicionar `marcarConversaCancelada()`; exportar constante do texto/código de erro |
| `supabase/functions/_shared/faturamento/__tests__/mensagens-io.test.ts` | Testes novos (TDD) |
| `supabase/functions/responder-mensagem/index.ts` | Invocar `marcarConversaCancelada` no check inicial e no catch 403; responder 409 com `codigo` |
| `src/lib/mensagens.ts` | Propagar `codigo` no erro lançado por `postEdge` |
| `src/components/faturamento/aba-mensagens.tsx` | Detectar `pedido_cancelado` no catch: toast info + invalidar queries + estado local cancelado |
| `src/components/faturamento/__tests__/aba-mensagens.test.tsx` | Teste novo da reação da UI |

## Global Constraints

- Edge Functions idempotentes (CLAUDE.md) — `marcarConversaCancelada` deve ser no-op seguro em repetição.
- Toda mutation leva predicado `org_id` (regra inegociável multi-tenant, ADR-0027). Fallback para `user_id` segue o padrão existente de `io.ts:339`.
- Não alterar assinatura pública de `responderMensagem` no frontend além do erro estruturado.
- Texto exato do erro (já usado e testado): `Não é possível responder porque o pedido foi cancelado.`
- Código de erro exato: `pedido_cancelado`.
- HTTP status: **409** (conflito de estado), não 502.

---

### Task 1: `marcarConversaCancelada` no backend compartilhado (RED → GREEN)

**Files:**
- Modify: `supabase/functions/_shared/faturamento/mensagens-io.ts` (após `resolverCompradorId`, ~linha 110)
- Test: `supabase/functions/_shared/faturamento/__tests__/mensagens-io.test.ts`

**Interfaces:**
- Produces: `export async function marcarConversaCancelada(admin: SupabaseClient, orgId: string, packId: string | number, userId?: string | null): Promise<void>` — atualiza `ml_mensagens.order_status = 'cancelled'` filtrando por `org_id` + `pack_id`; se houver `order_id` vinculado ao pack em `ml_vendas`, atualiza `ml_vendas.status = 'cancelled'` (somente se a venda existir — não cria linha). Falha de update lança `Error` (o caller decide se engole).
- Exporta também `export const ERRO_PEDIDO_CANCELADO = 'Não é possível responder porque o pedido foi cancelado.'` e `export const CODIGO_PEDIDO_CANCELADO = 'pedido_cancelado'` para reuso em `mensagemErroEnvioML` e no handler.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao `describe` existente (padrão de mock: `criarAdminMock`, linhas 22-37 do teste atual):

```ts
describe('marcarConversaCancelada', () => {
  it('marca order_status=cancelled nas mensagens do pack com predicado org_id', async () => {
    // arrange: admin mock encadeável registrando .update/.eq/.or
    // act: await marcarConversaCancelada(admin, 'org-1', 'pack-1', 'user-1')
    // assert: from('ml_mensagens').update({ order_status: 'cancelled' })
    //         .eq('org_id', 'org-1') chamado com pack_id 'pack-1'
  });

  it('atualiza ml_vendas quando o pack tem order_id vinculado', async () => {
    // arrange: mock cuja select em ml_vendas devolve { order_id: 'order-9' }
    // assert: update em ml_vendas com { status: 'cancelled' } e eq('org_id', 'org-1')
  });

  it('não toca ml_vendas quando não há venda vinculada', async () => {
    // select em ml_vendas devolve null → nenhum update em ml_vendas
  });

  it('é idempotente: segunda chamada repete os mesmos updates sem erro', async () => {
    // duas invocações → ambas resolvem
  });
});
```

- [ ] **Step 2: Rodar e confirmar RED**

Run: `pnpm vitest run supabase/functions/_shared/faturamento/__tests__/mensagens-io.test.ts`
Expected: FAIL — `marcarConversaCancelada is not a function`.

- [ ] **Step 3: Implementar o mínimo**

Em `mensagens-io.ts`, após `resolverCompradorId`:

```ts
export const ERRO_PEDIDO_CANCELADO = 'Não é possível responder porque o pedido foi cancelado.';
export const CODIGO_PEDIDO_CANCELADO = 'pedido_cancelado';

/** Marca a conversa do pack como cancelada (resposta bloqueada pelo ML ou status conhecido).
 *  Idempotente: update puro, sem leitura prévia obrigatória. */
export async function marcarConversaCancelada(
  admin: SupabaseClient, orgId: string, packId: string | number, userId?: string | null,
): Promise<void> {
  const { error } = await admin.from('ml_mensagens')
    .update({ order_status: 'cancelled' })
    .eq('org_id', orgId).eq('pack_id', String(packId));
  if (error) throw new Error(`marcar conversa cancelada: ${error.message}`);

  // Reflete em ml_vendas quando o pack já tem venda sincronizada (sem criar linha nova).
  const q = admin.from('ml_vendas').select('order_id').eq('org_id', orgId)
    .or(`pack_id.eq.${packId},order_id.eq.${packId}`).limit(1).maybeSingle();
  const { data: venda } = await q;
  if (venda?.order_id != null) {
    const upd = admin.from('ml_vendas').update({ status: 'cancelled' })
      .eq('org_id', orgId).eq('order_id', venda.order_id);
    if (userId) upd.eq('user_id', userId);
    const { error: vendaErr } = await upd;
    if (vendaErr) throw new Error(`marcar venda cancelada: ${vendaErr.message}`);
  }
}
```

Reusar `ERRO_PEDIDO_CANCELADO` em `mensagemErroEnvioML` (linha 21) no lugar da string literal.

- [ ] **Step 4: Rodar e confirmar GREEN**

Run: `pnpm vitest run supabase/functions/_shared/faturamento/__tests__/mensagens-io.test.ts`
Expected: PASS (testes novos + os existentes de `pedidoCancelado`/`mensagemErroEnvioML`).

- [ ] **Step 5: Commit**

`git add -A && git commit -m "feat(mensagens-io): marcarConversaCancelada persiste cancelamento do pack"`

---

### Task 2: `responder-mensagem` persiste cancelamento e responde 409 estruturado (RED → GREEN)

**Files:**
- Modify: `supabase/functions/responder-mensagem/index.ts:13-15, 43-46, 55-60`
- Test: `supabase/functions/_shared/faturamento/__tests__/mensagens-io.test.ts` (cobertura do helper) — o handler em si não tem harness de teste Deno no repo; a verificação é por teste do helper + lint + inspeção. Se o executor quiser cobertura de handler, espelhar o padrão dos testes existentes; caso contrário documentar a decisão.

**Interfaces:**
- Consumes: `marcarConversaCancelada`, `ERRO_PEDIDO_CANCELADO`, `CODIGO_PEDIDO_CANCELADO` (Task 1).
- Produces: resposta HTTP 409 com body `{ ok: false, erro: ERRO_PEDIDO_CANCELADO, codigo: 'pedido_cancelado' }`.

- [ ] **Step 1: Escrever o teste que falha (contrato do body)**

Em `mensagens-io.test.ts`, testar que o body de erro 409 esperado usa as constantes:

```ts
it('body do 409 usa erro e codigo padronizados', () => {
  expect(ERRO_PEDIDO_CANCELADO).toBe('Não é possível responder porque o pedido foi cancelado.');
  expect(CODIGO_PEDIDO_CANCELADO).toBe('pedido_cancelado');
});
```

(Este teste passa desde a Task 1 — serve de trava de contrato para o handler e para o frontend.)

- [ ] **Step 2: Atualizar o helper `erro` para aceitar `codigo`**

Em `index.ts`, estender o helper local:

```ts
const erro = (msg: string, status: number, codigo?: string) =>
  new Response(JSON.stringify({ ok: false, erro: msg, ...(codigo ? { codigo } : {}) }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
```

- [ ] **Step 3: Check inicial — persistir antes de responder 409**

Substituir o bloco `index.ts:44-46`:

```ts
if (pedidoCancelado(meta.orderStatus)) {
  await marcarConversaCancelada(admin, orgId, packId, dono ?? context.userId)
    .catch(() => {}); // não mascara o 409 se o update falhar
  return erro(ERRO_PEDIDO_CANCELADO, 409, CODIGO_PEDIDO_CANCELADO);
}
```

- [ ] **Step 4: Catch do envio — detectar 403 de cancelamento e persistir**

No catch (`index.ts:57-60`), antes de devolver o erro genérico:

```ts
} catch (e) {
  const msg = (e as Error).message;
  if (msg === ERRO_PEDIDO_CANCELADO) {
    await marcarConversaCancelada(admin, orgId, packId, dono ?? context.userId).catch(() => {});
    return erro(ERRO_PEDIDO_CANCELADO, 409, CODIGO_PEDIDO_CANCELADO);
  }
  await auditarOperacaoSuporte(admin, context, { type: 'pack', id: packId }, 'failed');
  return erro(msg, 502);
}
```

A detecção por igualdade com `ERRO_PEDIDO_CANCELADO` funciona porque `mensagemErroEnvioML` (403 + `blocked_by_cancelled_order`) devolve exatamente essa string — agora via constante compartilhada.

- [ ] **Step 5: Validar**

Run: `pnpm vitest run supabase/functions/_shared/faturamento/__tests__/mensagens-io.test.ts && pnpm lint supabase/functions/responder-mensagem/index.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

`git commit -m "feat(responder-mensagem): persiste cancelamento e responde 409 pedido_cancelado"`

---

### Task 3: Frontend propaga `codigo` no erro (RED → GREEN)

**Files:**
- Modify: `src/lib/mensagens.ts:85-101`
- Test: novo `src/lib/__tests__/mensagens-erro.test.ts` (mock do `supabase.auth.getSession` + `fetch`, padrão dos testes em `src/lib/__tests__/`)

**Interfaces:**
- Produces: erro lançado por `responderMensagem` passa a ser `Error` com propriedade `.codigo?: string` quando o body trouxer `codigo`. Exportar type guard `export const ehPedidoCancelado = (e: unknown): boolean => e instanceof Error && (e as Error & { codigo?: string }).codigo === 'pedido_cancelado'`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('propaga codigo pedido_cancelado do body 409', async () => {
  // fetch mock → status 409, json { ok: false, erro: '...', codigo: 'pedido_cancelado' }
  await expect(responderMensagem('123', 'oi')).rejects.toMatchObject({
    message: 'Não é possível responder porque o pedido foi cancelado.',
    codigo: 'pedido_cancelado',
  });
});

it('ehPedidoCancelado reconhece o erro estruturado e ignora erros comuns', () => {
  const e = Object.assign(new Error('x'), { codigo: 'pedido_cancelado' });
  expect(ehPedidoCancelado(e)).toBe(true);
  expect(ehPedidoCancelado(new Error('x'))).toBe(false);
  expect(ehPedidoCancelado('x')).toBe(false);
});
```

- [ ] **Step 2: Rodar e confirmar RED**

Run: `pnpm vitest run src/lib/__tests__/mensagens-erro.test.ts`
Expected: FAIL — `toMatchObject` não acha `codigo`.

- [ ] **Step 3: Implementar o mínimo**

Em `postEdge` (`mensagens.ts:94`):

```ts
if (!resp.ok || json?.ok === false) {
  const err = new Error(json?.erro ?? `Falha (${resp.status})`) as Error & { codigo?: string };
  if (json?.codigo) err.codigo = json.codigo;
  throw err;
}
```

Adicionar no fim do arquivo:

```ts
export const ehPedidoCancelado = (e: unknown): boolean =>
  e instanceof Error && (e as Error & { codigo?: string }).codigo === 'pedido_cancelado';
```

- [ ] **Step 4: Rodar e confirmar GREEN**

Run: `pnpm vitest run src/lib/__tests__/mensagens-erro.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(mensagens): propaga codigo pedido_cancelado no erro do responder"`

---

### Task 4: UI reage ao cancelamento (RED → GREEN → REFACTOR)

**Files:**
- Modify: `src/components/faturamento/aba-mensagens.tsx:36-48`
- Test: `src/components/faturamento/__tests__/aba-mensagens.test.tsx`

**Interfaces:**
- Consumes: `ehPedidoCancelado` (Task 3); `Conversa.order_status` já existente.
- Produces: no catch de `responder()`, quando `ehPedidoCancelado(e)`: `toast.info`, `invalidateQueries` de `['mensagens']` e `['mensagensAguardando']`, e estado local `canceladaLocal = true` que força o card a renderizar como cancelado (botão desabilitado via `cancelada || canceladaLocal`).

- [ ] **Step 1: Escrever o teste que falha**

Em `aba-mensagens.test.tsx` (padrão existente: mock de `@/lib/mensagens` com `vi.mock`, render com `QueryClientProvider`):

```tsx
it('ao receber pedido_cancelado, mostra toast informativo, invalida queries e bloqueia o card', async () => {
  const erroCancelado = Object.assign(
    new Error('Não é possível responder porque o pedido foi cancelado.'),
    { codigo: 'pedido_cancelado' },
  );
  vi.mocked(responderMensagem).mockRejectedValueOnce(erroCancelado);
  // render com conversa aguardando (order_status 'paid'), digitar texto, clicar Enviar
  // assert: toast.info chamado com mensagem de cancelado (não toast.error)
  // assert: botão Enviar fica disabled
  // assert: invalidateQueries chamado para ['mensagens'] e ['mensagensAguardando']
});

it('erros genéricos continuam em toast.error sem marcar cancelado', async () => {
  vi.mocked(responderMensagem).mockRejectedValueOnce(new Error('ML /messages 500'));
  // assert: toast.error; botão volta habilitado
});
```

- [ ] **Step 2: Rodar e confirmar RED**

Run: `pnpm vitest run src/components/faturamento/__tests__/aba-mensagens.test.tsx`
Expected: FAIL — hoje todo erro cai em `toast.error`.

- [ ] **Step 3: Implementar o mínimo**

Em `CardConversa`:

```tsx
const [canceladaLocal, setCanceladaLocal] = useState(false);
const cancelada = c.order_status === 'cancelled' || canceladaLocal;

async function responder() {
  const t = texto.trim();
  if (!t) return;
  setEnviando(true);
  try {
    await responderMensagem(c.pack_id, t);
    setTexto('');
    toast.success('Mensagem enviada.');
    await qc.invalidateQueries({ queryKey: ['mensagens'] });
    await qc.invalidateQueries({ queryKey: ['mensagensAguardando'] });
  } catch (e) {
    if (ehPedidoCancelado(e)) {
      setCanceladaLocal(true);
      toast.info('Este pedido foi cancelado — a conversa não aceita mais respostas.');
      await qc.invalidateQueries({ queryKey: ['mensagens'] });
      await qc.invalidateQueries({ queryKey: ['mensagensAguardando'] });
    } else {
      toast.error(`Falha ao enviar: ${(e as Error).message}`);
    }
  } finally { setEnviando(false); }
}
```

(`cancelada` na linha 22 vira derivada; o `disabled` do botão na linha 106 já usa `cancelada`.)

- [ ] **Step 4: Rodar e confirmar GREEN**

Run: `pnpm vitest run src/components/faturamento/__tests__/aba-mensagens.test.tsx`
Expected: PASS — incluindo os testes pré-existentes de paginação e da conversa `pack-1` cancelada.

- [ ] **Step 5: REFACTOR (opcional, só se sair de graça)**

Se o par de invalidações repetir 3×, extrair `const invalidarMensagens = () => Promise.all([...])`. Não extrair nada além disso (YAGNI).

- [ ] **Step 6: Commit**

`git commit -m "feat(aba-mensagens): reage a pedido cancelado com toast, invalidação e card bloqueado"`

---

### Task 5: Validação final, docs e deploy

- [ ] **Step 1: Validação completa local**

Run: `pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 2: Docs (regra de conclusão, CLAUDE.md)**

Mudou `supabase/functions/**` → atualizar `docs/reference/edge-functions.md` (seção de `responder-mensagem`: resposta 409 `pedido_cancelado`, efeito colateral de persistir cancelamento). Atualizar `docs/TASKS.md`. Declarar no commit se `obsidian-vault/` foi atualizado ou conferido sem necessidade.

- [ ] **Step 3: Deploy da Edge Function**

Mudança em `_shared/` → redeployar as funções afetadas via CLI completa e conferir versão pós-deploy (`responder-mensagem` e qualquer outra que importe `mensagens-io.ts` — checar com `grep` escopado em `supabase/functions/` por `mensagens-io`).

- [ ] **Step 4: Commit final**

`git commit -m "docs(edge-functions): resposta 409 pedido_cancelado em responder-mensagem"`

---

## Critérios de Aceite

1. Responder conversa de pedido já cancelado no banco → HTTP 409, body `{ ok: false, erro, codigo: 'pedido_cancelado' }`, e `ml_mensagens.order_status = 'cancelled'` gravado para o pack (verificável com query por `org_id` + `pack_id`).
2. Responder conversa cujo cancelamento só é revelado pelo 403 do ML (`blocked_by_cancelled_order`) → mesmo resultado do item 1 (não 502).
3. `ml_vendas.status` vira `'cancelled'` quando o pack tem venda vinculada; nenhuma linha nova é criada; nenhum outro tenant é tocado (predicado `org_id` em todos os updates).
4. UI: toast **informativo** (não de erro), card bloqueia o campo/botão de resposta imediatamente, badge "aguardando" zera após invalidação.
5. Erros genéricos do ML mantêm comportamento atual (`toast.error`, 502 no backend, auditoria `failed`).
6. `pnpm lint` e `pnpm test` verdes.

## Comandos de Teste

```bash
# Backend (Task 1-2)
pnpm vitest run supabase/functions/_shared/faturamento/__tests__/mensagens-io.test.ts

# Frontend lib (Task 3)
pnpm vitest run src/lib/__tests__/mensagens-erro.test.ts

# Frontend UI (Task 4)
pnpm vitest run src/components/faturamento/__tests__/aba-mensagens.test.tsx

# Gate final (Task 5)
pnpm lint && pnpm test
```

## Riscos e Notas

- **Detecção no catch por igualdade de string** é acoplamento aceitável porque ambos os lados usam a constante `ERRO_PEDIDO_CANCELADO` do mesmo módulo; alternativa (classe de erro) seria over-engineering para 2 call sites.
- **`userId` opcional** em `marcarConversaCancelada`: o predicado `org_id` já isola o tenant; `user_id` só é adicionado no update de `ml_vendas` quando disponível, espelhando `io.ts:339`.
- **Falha do update não mascara o 409**: `.catch(() => {})` proposital — a resposta correta ao operador é "pedido cancelado" mesmo se o snapshot falhar (o próximo sync de vendas repara via `io.ts`).
- Fora de escopo: backfill de conversas antigas já canceladas, mudança em `useMensagens`, realtime. O sync periódico já converge esses casos.
