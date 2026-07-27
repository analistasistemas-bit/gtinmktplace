# Reconciliação Definitiva de Estornos e Devoluções - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantir que todas as devoluções e reembolsos (estornos) do Mercado Livre/Mercado Pago sejam automaticamente associados às vendas e contabilizados no Dashboard/Faturamento, mesmo quando a venda tiver sido realizada há mais de 3 dias ou quando o claim for aberto sobre `shipment`.

**Architecture:** 
1. Em `devolucoes-io.ts`, resolver `order_id` a partir do `shipping_id` quando o claim possuir `resource = 'shipment'`.
2. Em `reconciliar-faturamento`, incluir um passo adicional para re-sincronizar o estorno/líquido via Mercado Pago para todos os pedidos com devoluções abertas ou concluídas recentemente (janela de 30 dias).
3. Testes unitários para cobrir resolução de `order_id` por `shipping_id` e reconciliação.

**Tech Stack:** TypeScript, Deno / Edge Functions, Supabase Postgres, Vitest.

## Global Constraints

- Manter compatibilidade com isolamento multi-tenant (`org_id` e RLS).
- Preservar regras de idempotência e não sobrescrever `estorno` válido por `null`.
- Manter código enxuto e testes 100% verdes.

---

### Task 1: Resolução de `order_id` a partir do `shipping_id` em `upsertDevolucao`

**Files:**
- Modify: `supabase/functions/_shared/faturamento/devolucoes-io.ts`
- Modify: `supabase/functions/_shared/faturamento/devolucao.ts`
- Test: `supabase/functions/_shared/faturamento/__tests__/devolucoes-io.test.ts`

**Interfaces:**
- Consumes: `adminClient`, `ClaimML`, `ReturnML`, tabela `ml_vendas`
- Produces: `upsertDevolucao` com `order_id` resolvido caso `claim.resource === 'shipment'`

- [ ] **Step 1: Criar o teste que falha para resolução de `order_id` via `shipping_id`**

Em `supabase/functions/_shared/faturamento/__tests__/devolucoes-io.test.ts`, adicionar um teste garantindo que quando `claim.resource === 'shipment'`, o `upsertDevolucao` consulta `ml_vendas` pelo `shipping_id` e preenche o `order_id`.

- [ ] **Step 2: Executar o teste e verificar a falha**

Run: `npx vitest run supabase/functions/_shared/faturamento/__tests__/devolucoes-io.test.ts`
Expected: FAIL (pois `upsertDevolucao` atualmente mantinha `order_id = null`).

- [ ] **Step 3: Implementar a resolução de `order_id` em `upsertDevolucao`**

Em `supabase/functions/_shared/faturamento/devolucoes-io.ts`:
```ts
if (row.order_id === null && claim.resource === 'shipment' && claim.resource_id != null) {
  const { data: venda } = await admin.from('ml_vendas')
    .select('order_id')
    .eq('user_id', userId)
    .eq('shipping_id', String(claim.resource_id))
    .maybeSingle();
  if (venda?.order_id) {
    row.order_id = Number(venda.order_id);
  }
}
```

- [ ] **Step 4: Executar os testes e verificar que passam**

Run: `npx vitest run supabase/functions/_shared/faturamento/__tests__/devolucoes-io.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/faturamento/
git commit -m "fix(faturamento): resolve order_id de devoluções por shipping_id"
```

---

### Task 2: Reconciliação Periódica de Estornos em `reconciliar-faturamento`

**Files:**
- Modify: `supabase/functions/reconciliar-faturamento/index.ts`
- Test: `supabase/functions/_shared/faturamento/__tests__/enriquecimento.test.ts`

**Interfaces:**
- Consumes: `ml_devolucoes`, `carregarLiquidoMPDoPedido`, `upsertVenda`
- Produces: Re-sincronização de estornos para vendas associadas a devoluções recentes (30 dias)

- [ ] **Step 1: Atualizar `reconciliar-faturamento/index.ts` para reconciliar vendas de devoluções recentes**

No `reconciliar-faturamento`, buscar devoluções com `order_id` não nulo abertas/atualizadas nos últimos 30 dias. Para cada pedido encontrado fora da janela de 72h do faturamento regular, re-checar o pagamento no Mercado Pago (`carregarLiquidoMPDoPedido`) e atualizar a venda se o estorno tiver sido processado.

- [ ] **Step 2: Executar testes da suíte completa de faturamento**

Run: `npx vitest run supabase/functions/_shared/faturamento/__tests__/`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/reconciliar-faturamento/
git commit -m "feat(faturamento): inclui estornos de devoluções recentes no reconciliador"
```

---

### Task 4: Validação Final e Build

- [ ] **Step 1: Executar todos os testes unitários**

Run: `npx vitest run`
Expected: PASS 100%

- [ ] **Step 2: Executar verificação de build do projeto**

Run: `npm run build`
Expected: PASS 100%

- [ ] **Step 3: Commit final**

```bash
git add .
git commit -m "chore(faturamento): conclusao da solucao de reconciliacao de estornos"
```
