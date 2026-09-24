# Monitor de Frete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avisar (sino + Telegram, categoria `financeiro`) quando o frete pago pelo vendedor numa venda nova de 1 item sobe >10% e ≥R$2 vs a venda anterior do mesmo anúncio, com liga/desliga por org em Configurações > Notificações.

**Architecture:** Função pura de decisão + orquestrador com dependências injetadas (padrão `cancelamento.ts` / `cancelamento-deps.ts`), chamado só pelo `sync-venda` no fim do handler (prazo checado antes da reserva), best-effort; a seleção da venda anterior é uma função SQL reusada pela medição. Coluna booleana nova em `configuracoes` com grant de SELECT por coluna. Switch no front no padrão de `reancora_lider_ativa`.

**Tech Stack:** Supabase (Postgres + Edge Functions Deno), React + TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-09-24-monitor-de-frete-design.md` · **ADR:** `docs/decisions/0169-monitor-de-frete.md`

## Global Constraints

- Gatilho: `atual - anterior >= 2` **e** `atual > anterior * 1.10`; frete `null` ou `<= 0` em qualquer lado não compara.
- Só pedido com **1 item e `quantity = 1`** e **fora de pack** (`pack_id` nulo — em pack o `frete_vendedor` é o frete do ENVIO repetido em cada pedido, ADR-0042 item 4), comparado com a venda anterior do mesmo `ml_item_id` + `variation_id` (null casa com null), também 1 item/1 unidade/fora de pack, `frete_vendedor > 0`, status ≠ `cancelled`.
- Data da venda = `coalesce(date_closed, date_created)`. "Anterior" = maior `(data, order_id)` estritamente menor que o da venda atual (desempate por `order_id`). A seleção vive na função SQL `frete_venda_anterior` (Task 1), que a medição da Task 6 reusa — código e medição são a mesma regra.
- Só venda a **no máximo 3 dias** de agora; pedido atual `cancelled` não avisa.
- O monitor roda no **fim** do `sync-venda` (depois de alerta de venda, baixa e cancelamento) e com **prazo de 8 s checado antes da reserva do dedup** (`limiteMs`): estourou → desiste sem reservar, sem trabalho órfão após a resposta. Sem `Promise.race`.
- Categoria do aviso: **`financeiro`** (via `notificarCategoria`). Dedup: `reservarNotificacao(admin, orgId, userId, 'frete_subiu', String(order_id))`.
- Coluna: `configuracoes.monitor_frete_ativo boolean not null default false` + `grant select (monitor_frete_ativo) on public.configuracoes to authenticated`.
- **Só o `sync-venda` chama o monitor.** Backfill/reconciliação/`sync-devolucao` NÃO.
- Falha do monitor **nunca** derruba o `sync-venda` (try/catch + `console.error`).
- Migrations **só** via `supabase migration new` + `supabase db push` (ADR-0043). Nunca `apply_migration`/painel.
- Git neste worktree: usar `/usr/bin/git`, um comando por chamada, commit com `-F <arquivo de mensagem>`; mensagem termina com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Setup do worktree (antes da Task 1)

- [ ] `cp "/Users/diego/Desktop/IA/Anuncios MktPlace/.env.local" "/Users/diego/Desktop/IA/Anuncios MktPlace/.env.test" .` (a partir da raiz do worktree `/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/monitor-frete`)
- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm test -- supabase/functions/_shared/faturamento` → suíte existente verde.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/<ts>_monitor_frete.sql` (novo) | coluna + grant + índice `(org_id, ml_item_id)` em `ml_vendas_itens` + função `frete_venda_anterior` (execute só `service_role`) |
| `src/lib/database.types.ts` (mod) | tipo da coluna em Row/Insert/Update de `configuracoes` |
| `supabase/functions/_shared/notificacoes/telegram.ts` (mod) | `montarMensagemAltaFrete` (junto dos outros montadores; usa o `fmtBRL` interno) |
| `supabase/functions/_shared/faturamento/monitor-frete.ts` (novo) | `avaliarAltaFrete` (pura) + `verificarAltaFrete` (orquestra via deps) + tipos. **Sem import Deno-only** (testado por vitest/Node) |
| `supabase/functions/_shared/faturamento/monitor-frete-deps.ts` (novo) | fiação real das deps com o client admin (só ligação, sem decisão) |
| `supabase/functions/_shared/faturamento/__tests__/monitor-frete.test.ts` (novo) | testes da pura, da mensagem e do orquestrador |
| `supabase/functions/sync-venda/index.ts` (mod) | chamada best-effort no fim do handler, com prazo de 8 s checado antes da reserva |
| `src/lib/queries.ts` (mod) | `fetchMonitorFreteAtivo` / `upsertMonitorFreteAtivo` |
| `src/hooks/useConfiguracoes.ts` (mod) | `useMonitorFreteAtivo` / `useSalvarMonitorFreteAtivo` |
| `src/components/configuracoes/secao-notificacoes.tsx` (mod) | grupo "Monitor de frete" com o Switch |
| `src/components/configuracoes/__tests__/secao-notificacoes.test.tsx` (novo) | teste do switch |

---

### Task 1: Migration + tipos

**Files:**
- Create: `supabase/migrations/<timestamp>_monitor_frete.sql` (gerado pelo CLI)
- Modify: `src/lib/database.types.ts` (bloco `configuracoes`, linhas ~223/243/263 onde está `reancora_lider_ativa`)

**Interfaces:**
- Produces: coluna `configuracoes.monitor_frete_ativo: boolean` (Row), `monitor_frete_ativo?: boolean` (Insert/Update).

- [ ] **Step 1: Gerar o arquivo**

Run: `supabase migration new monitor_frete`
Expected: cria `supabase/migrations/<timestamp>_monitor_frete.sql` vazio.

- [ ] **Step 2: Conteúdo da migration**

```sql
-- ADR-0169 — Monitor de frete: liga/desliga por organização (nasce desligado).
alter table public.configuracoes
  add column if not exists monitor_frete_ativo boolean not null default false;

-- A tabela tem SELECT concedido coluna a coluna desde 20260822131053 (token do Telegram fora).
-- Coluna nova sem este grant fica invisível ao front (PostgREST devolve 401/erro de permissão).
grant select (monitor_frete_ativo) on public.configuracoes to authenticated;

-- Busca da venda anterior por item (antes só havia índice por venda_id).
create index if not exists ml_vendas_itens_org_item_idx
  on public.ml_vendas_itens (org_id, ml_item_id);

-- Venda de referência do monitor: a mais recente ANTES da atual (por data e, no empate, order_id),
-- mesmo item+variação, pedido de 1 linha e 1 unidade, fora de pack (em pack o frete é do envio e se
-- repete em cada pedido — ADR-0042), não cancelada, com frete > 0. Elegibilidade ANTES do limit.
-- Reusada pela medição da Task 6: código e medição aplicam a mesma regra.
create or replace function public.frete_venda_anterior(
  p_org_id uuid, p_ml_item_id text, p_variation_id bigint, p_antes timestamptz, p_order_id bigint
) returns table (order_id bigint, frete_vendedor numeric)
language sql stable security invoker set search_path = public as $$
  select v.order_id, v.frete_vendedor
  from ml_vendas v
  join ml_vendas_itens i on i.venda_id = v.id
  where v.org_id = p_org_id
    and i.org_id = p_org_id
    and i.ml_item_id = p_ml_item_id
    and i.variation_id is not distinct from p_variation_id
    and i.quantity = 1
    and v.pack_id is null
    and v.status <> 'cancelled'
    and v.frete_vendedor > 0
    and (coalesce(v.date_closed, v.date_created), v.order_id) < (p_antes, p_order_id)
    and not exists (select 1 from ml_vendas_itens x where x.venda_id = v.id and x.id <> i.id)
  order by coalesce(v.date_closed, v.date_created) desc, v.order_id desc
  limit 1
$$;

-- Função em public nasce com EXECUTE para PUBLIC: só o worker (service_role) chama.
revoke execute on function public.frete_venda_anterior(uuid, text, bigint, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.frete_venda_anterior(uuid, text, bigint, timestamptz, bigint) to service_role;
```

- [ ] **Step 3: Tipos** — em `src/lib/database.types.ts`, no bloco `configuracoes`, logo após cada ocorrência de `reancora_lider_ativa`, acrescentar:
  - Row: `monitor_frete_ativo: boolean`
  - Insert: `monitor_frete_ativo?: boolean`
  - Update: `monitor_frete_ativo?: boolean`

- [ ] **Step 4: Validar** — Run: `npm run db:check` → Expected: OK (sem erro de lint/ordem de migration). Run: `pnpm exec tsc -b` → Expected: sem erro.

- [ ] **Step 5: Commit** — `git add` da migration + `database.types.ts`; mensagem `feat(frete): coluna monitor_frete_ativo em configuracoes (ADR-0169)`.

> `supabase db push` NÃO roda aqui — só na Task 6, depois do CI verde.

---

### Task 2: Função pura + mensagem (TDD)

**Files:**
- Create: `supabase/functions/_shared/faturamento/monitor-frete.ts`
- Modify: `supabase/functions/_shared/notificacoes/telegram.ts` (após `montarMensagemNovaVenda`, ~linha 108)
- Test: `supabase/functions/_shared/faturamento/__tests__/monitor-frete.test.ts`

**Interfaces:**
- Produces:
  - `avaliarAltaFrete(atual: number | null, anterior: number | null): { diferenca: number; pct: number } | null`
  - `montarMensagemAltaFrete(a: { titulo: string | null; mlItemId: string; atual: number; anterior: number; pct: number }): string` (em `telegram.ts`)

- [ ] **Step 1: Testes que falham**

```ts
import { describe, expect, it } from 'vitest';
import { avaliarAltaFrete } from '../monitor-frete.ts';
import { montarMensagemAltaFrete } from '../../notificacoes/telegram.ts';

describe('avaliarAltaFrete', () => {
  it('alta real (+62%, +R$9,50): dispara', () => {
    expect(avaliarAltaFrete(24.9, 15.4)).toEqual({ diferenca: 9.5, pct: 62 });
  });
  it('exatamente +10% não dispara (precisa ser maior)', () => {
    expect(avaliarAltaFrete(22, 20)).toBeNull();
  });
  it('+10,05% e +R$2,01: dispara', () => {
    expect(avaliarAltaFrete(22.01, 20)).toEqual({ diferenca: 2.01, pct: 10 });
  });
  it('acima de 10% mas menos de R$2: não dispara', () => {
    expect(avaliarAltaFrete(11.99, 10)).toBeNull();
  });
  it('R$2 mas menos de 10%: não dispara', () => {
    expect(avaliarAltaFrete(32, 30)).toBeNull();
  });
  it('queda não dispara', () => {
    expect(avaliarAltaFrete(10, 20)).toBeNull();
  });
  it.each([
    [null, 10], [10, null], [0, 10], [10, 0], [-1, 10],
  ])('frete %s vs %s (nulo/zero/negativo): não compara', (atual, anterior) => {
    expect(avaliarAltaFrete(atual as number | null, anterior as number | null)).toBeNull();
  });
});

describe('montarMensagemAltaFrete', () => {
  it('traz título, MLB, os dois valores e o %', () => {
    const msg = montarMensagemAltaFrete({ titulo: 'Shampoo X', mlItemId: 'MLB123', atual: 24.9, anterior: 15.4, pct: 62 });
    expect(msg).toContain('Frete subiu');
    expect(msg).toContain('Shampoo X');
    expect(msg).toContain('MLB123');
    expect(msg).toContain('24,90');
    expect(msg).toContain('15,40');
    expect(msg).toContain('+62%');
  });
  it('sem título usa o MLB', () => {
    expect(montarMensagemAltaFrete({ titulo: null, mlItemId: 'MLB9', atual: 30, anterior: 20, pct: 50 })).toContain('MLB9');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `pnpm test -- supabase/functions/_shared/faturamento/__tests__/monitor-frete.test.ts` → Expected: FAIL (módulo/export inexistente).

- [ ] **Step 3: Implementar a pura** — `monitor-frete.ts`:

```ts
// ADR-0169 — Monitor de frete. Este módulo é testado por vitest (Node): nada de import
// Deno-only aqui. A fiação com o client admin vive em monitor-frete-deps.ts.

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Alta de frete que merece aviso: > 10% E ≥ R$ 2. Nulo/zero em qualquer lado não compara
 *  (nulo = /shipments/costs falhou; 0 = sem custo ao vendedor — incidente de 2026-07-30). */
export function avaliarAltaFrete(
  atual: number | null, anterior: number | null,
): { diferenca: number; pct: number } | null {
  if (atual == null || anterior == null || atual <= 0 || anterior <= 0) return null;
  const diferenca = round2(atual - anterior);
  if (diferenca < 2 || atual <= anterior * 1.1) return null;
  return { diferenca, pct: Math.round((atual / anterior - 1) * 100) };
}
```

- [ ] **Step 4: Implementar a mensagem** — em `telegram.ts`, após `montarMensagemNovaVenda`:

```ts
export function montarMensagemAltaFrete(a: {
  titulo: string | null; mlItemId: string; atual: number; anterior: number; pct: number;
}): string {
  return [
    `🚚 Frete subiu — ${a.titulo ?? a.mlItemId} (${a.mlItemId})`,
    `Esta venda: ${fmtBRL(a.atual, 'BRL')} · venda anterior: ${fmtBRL(a.anterior, 'BRL')} (+${a.pct}%)`,
    'Possível causa: o ML mudou peso/dimensões da embalagem. Confira o anúncio.',
  ].join('\n');
}
```

- [ ] **Step 5: Rodar e ver passar** — mesmo comando → Expected: PASS. Se `fmtBRL` usar espaço não-quebrável (`R$ 24,90`), o `toContain('24,90')` continua valendo.

- [ ] **Step 6: Commit** — `feat(frete): regra pura e mensagem do monitor de frete (ADR-0169)`.

---

### Task 3: Orquestrador `verificarAltaFrete` + deps (TDD)

**Files:**
- Modify: `supabase/functions/_shared/faturamento/monitor-frete.ts`
- Create: `supabase/functions/_shared/faturamento/monitor-frete-deps.ts`
- Test: `supabase/functions/_shared/faturamento/__tests__/monitor-frete.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `avaliarAltaFrete` (Task 2), `montarMensagemAltaFrete` (Task 2).
- Produces:

```ts
export interface ItemPedidoFrete { ml_item_id: string | null; variation_id: number | null; quantity: number; titulo: string | null }
export interface CtxAltaFrete {
  orgId: string; userId: string; orderId: number; packId: number | null; status: string;
  freteVendedor: number | null; dataVenda: string | null; itens: ItemPedidoFrete[];
  agoraMs?: number; // injetável para teste; default Date.now()
  limiteMs?: number; // epoch ms; passou dele antes da reserva → desiste sem reservar
  relogio?: () => number; // injetável para teste; default Date.now
}
export interface VendaAnteriorFrete { order_id: number; frete_vendedor: number }
export interface DepsAltaFrete {
  monitorAtivo(orgId: string): Promise<boolean>;
  buscarVendaAnterior(p: { orgId: string; mlItemId: string; variationId: number | null; antesDe: string; orderId: number }): Promise<VendaAnteriorFrete | null>;
  reservar(orgId: string, userId: string, chave: string): Promise<boolean>;
  notificar(orgId: string, texto: string): Promise<unknown>;
}
export async function verificarAltaFrete(ctx: CtxAltaFrete, deps: DepsAltaFrete): Promise<boolean> // true = avisou
export function depsMonitorFrete(admin: SupabaseClient): DepsAltaFrete // em monitor-frete-deps.ts
```

- [ ] **Step 1: Testes que falham** (acrescentar ao arquivo de teste):

```ts
import { vi } from 'vitest';
import { verificarAltaFrete, type CtxAltaFrete, type DepsAltaFrete } from '../monitor-frete.ts';

const AGORA = Date.parse('2026-09-24T12:00:00.000Z');
const base = (over: Partial<CtxAltaFrete> = {}): CtxAltaFrete => ({
  orgId: 'org1', userId: 'u1', orderId: 555, packId: null, status: 'paid',
  freteVendedor: 24.9, dataVenda: '2026-09-24T10:00:00.000Z',
  itens: [{ ml_item_id: 'MLB1', variation_id: 7, quantity: 1, titulo: 'Shampoo X' }],
  agoraMs: AGORA, ...over,
});
const deps = (over: Partial<DepsAltaFrete> = {}): DepsAltaFrete => ({
  monitorAtivo: vi.fn().mockResolvedValue(true),
  buscarVendaAnterior: vi.fn().mockResolvedValue({ order_id: 444, frete_vendedor: 15.4 }),
  reservar: vi.fn().mockResolvedValue(true),
  notificar: vi.fn().mockResolvedValue(1),
  ...over,
});

describe('verificarAltaFrete', () => {
  it('caso feliz: busca a anterior do mesmo item+variação e notifica 1x', async () => {
    const d = deps();
    expect(await verificarAltaFrete(base(), d)).toBe(true);
    expect(d.buscarVendaAnterior).toHaveBeenCalledWith({
      orgId: 'org1', mlItemId: 'MLB1', variationId: 7, antesDe: '2026-09-24T10:00:00.000Z', orderId: 555,
    });
    expect(d.reservar).toHaveBeenCalledWith('org1', 'u1', '555');
    expect(d.notificar).toHaveBeenCalledTimes(1);
    expect((d.notificar as ReturnType<typeof vi.fn>).mock.calls[0][1]).toContain('+62%');
  });

  it('monitor desligado: não busca nem notifica', async () => {
    const d = deps({ monitorAtivo: vi.fn().mockResolvedValue(false) });
    expect(await verificarAltaFrete(base(), d)).toBe(false);
    expect(d.buscarVendaAnterior).not.toHaveBeenCalled();
    expect(d.notificar).not.toHaveBeenCalled();
  });

  it.each([
    ['2 itens', { itens: [
      { ml_item_id: 'MLB1', variation_id: 7, quantity: 1, titulo: 'a' },
      { ml_item_id: 'MLB2', variation_id: null, quantity: 1, titulo: 'b' },
    ] }],
    ['quantity 2', { itens: [{ ml_item_id: 'MLB1', variation_id: 7, quantity: 2, titulo: 'a' }] }],
    ['sem ml_item_id', { itens: [{ ml_item_id: null, variation_id: null, quantity: 1, titulo: 'a' }] }],
    ['frete nulo', { freteVendedor: null }],
    ['frete zero', { freteVendedor: 0 }],
    ['venda com mais de 3 dias', { dataVenda: '2026-09-20T11:59:00.000Z' }],
    ['sem data', { dataVenda: null }],
    ['pedido cancelado', { status: 'cancelled' }],
    ['pedido em pack (frete é do envio)', { packId: 2000001 }],
  ])('%s: não avisa e não consulta o toggle', async (_nome, over) => {
    const d = deps();
    expect(await verificarAltaFrete(base(over as Partial<CtxAltaFrete>), d)).toBe(false);
    expect(d.monitorAtivo).not.toHaveBeenCalled();
    expect(d.notificar).not.toHaveBeenCalled();
  });

  it('sem venda anterior: não avisa', async () => {
    const d = deps({ buscarVendaAnterior: vi.fn().mockResolvedValue(null) });
    expect(await verificarAltaFrete(base(), d)).toBe(false);
    expect(d.notificar).not.toHaveBeenCalled();
  });

  it('alta abaixo do gatilho: não reserva nem avisa', async () => {
    const d = deps({ buscarVendaAnterior: vi.fn().mockResolvedValue({ order_id: 444, frete_vendedor: 24 }) });
    expect(await verificarAltaFrete(base(), d)).toBe(false);
    expect(d.reservar).not.toHaveBeenCalled();
  });

  it('reserva já tomada (webhook repetido): não avisa de novo', async () => {
    const d = deps({ reservar: vi.fn().mockResolvedValue(false) });
    expect(await verificarAltaFrete(base(), d)).toBe(false);
    expect(d.notificar).not.toHaveBeenCalled();
  });

  it('prazo estourado antes da reserva: não reserva nem avisa', async () => {
    const d = deps();
    const r = await verificarAltaFrete(base({ limiteMs: 1000, relogio: () => 1001 }), d);
    expect(r).toBe(false);
    expect(d.reservar).not.toHaveBeenCalled();
    expect(d.notificar).not.toHaveBeenCalled();
  });

  it('dentro do prazo: segue normal', async () => {
    const d = deps();
    expect(await verificarAltaFrete(base({ limiteMs: 1000, relogio: () => 999 }), d)).toBe(true);
  });

  it('variação nula é repassada como null', async () => {
    const d = deps();
    await verificarAltaFrete(base({ itens: [{ ml_item_id: 'MLB1', variation_id: null, quantity: 1, titulo: 'x' }] }), d);
    expect(d.buscarVendaAnterior).toHaveBeenCalledWith(expect.objectContaining({ variationId: null }));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test -- supabase/functions/_shared/faturamento/__tests__/monitor-frete.test.ts` → FAIL (`verificarAltaFrete` inexistente).

- [ ] **Step 3: Implementar** — acrescentar em `monitor-frete.ts` (tipos da seção Interfaces acima, exportados) e:

```ts
import { montarMensagemAltaFrete } from '../notificacoes/telegram.ts';

const JANELA_MS = 3 * 24 * 60 * 60 * 1000;

/** ADR-0169. Chamado SÓ pelo sync-venda. Checagens baratas antes de qualquer leitura no banco. */
export async function verificarAltaFrete(ctx: CtxAltaFrete, deps: DepsAltaFrete): Promise<boolean> {
  if (ctx.status === 'cancelled') return false;
  // Em pack o frete_vendedor é o do ENVIO, repetido em cada pedido (ADR-0042 item 4).
  if (ctx.packId != null) return false;
  if (ctx.itens.length !== 1) return false;
  const item = ctx.itens[0];
  if (item.quantity !== 1 || !item.ml_item_id) return false;
  if (ctx.freteVendedor == null || ctx.freteVendedor <= 0) return false;
  if (!ctx.dataVenda) return false;
  const agora = ctx.agoraMs ?? Date.now();
  if (agora - Date.parse(ctx.dataVenda) > JANELA_MS) return false;

  if (!(await deps.monitorAtivo(ctx.orgId))) return false;

  const anterior = await deps.buscarVendaAnterior({
    orgId: ctx.orgId, mlItemId: item.ml_item_id, variationId: item.variation_id,
    antesDe: ctx.dataVenda, orderId: ctx.orderId,
  });
  if (!anterior) return false;

  const alta = avaliarAltaFrete(ctx.freteVendedor, anterior.frete_vendedor);
  if (!alta) return false;

  // Prazo checado ANTES da reserva: se as leituras demoraram, desiste sem tomar o dedup — nada fica
  // rodando depois da resposta do worker (não há Promise.race nem trabalho órfão no isolate).
  const relogio = ctx.relogio ?? Date.now;
  if (ctx.limiteMs != null && relogio() > ctx.limiteMs) {
    console.warn(`monitor de frete (order ${ctx.orderId}): prazo estourado antes da reserva, desistindo`);
    return false;
  }

  if (!(await deps.reservar(ctx.orgId, ctx.userId, String(ctx.orderId)))) return false;

  await deps.notificar(ctx.orgId, montarMensagemAltaFrete({
    titulo: item.titulo, mlItemId: item.ml_item_id,
    atual: ctx.freteVendedor, anterior: anterior.frete_vendedor, pct: alta.pct,
  }));
  return true;
}
```

- [ ] **Step 4: Rodar e ver passar** — mesmo comando → PASS (todos os testes das Tasks 2 e 3).

- [ ] **Step 5: Deps reais** — criar `monitor-frete-deps.ts`:

```ts
// Fiação real do monitor de frete (ADR-0169). Só ligação, nenhuma decisão — a regra vive em
// monitor-frete.ts, testada por vitest. Validada contra Postgres real na Task 6.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { reservarNotificacao } from './notificacoes-dedupe.ts';
import { notificarCategoria } from '../notificacoes/config.ts';
import type { DepsAltaFrete, VendaAnteriorFrete } from './monitor-frete.ts';

export function depsMonitorFrete(admin: SupabaseClient): DepsAltaFrete {
  return {
    async monitorAtivo(orgId) {
      const { data, error } = await admin.from('configuracoes')
        .select('monitor_frete_ativo').eq('org_id', orgId).maybeSingle();
      if (error) throw new Error(`monitorAtivo: ${error.message}`);
      return data?.monitor_frete_ativo === true;
    },

    async buscarVendaAnterior({ orgId, mlItemId, variationId, antesDe, orderId }) {
      // Regra inteira (1 linha/1 unidade, fora de pack, desempate por order_id) vive na função SQL
      // da Task 1 — a mesma que a medição da Task 6 usa.
      const { data, error } = await admin.rpc('frete_venda_anterior', {
        p_org_id: orgId, p_ml_item_id: mlItemId, p_variation_id: variationId,
        p_antes: antesDe, p_order_id: orderId,
      }).maybeSingle();
      if (error) throw new Error(`buscarVendaAnterior: ${error.message}`);
      if (!data) return null;
      const r = data as { order_id: number | string; frete_vendedor: number | string };
      return { order_id: Number(r.order_id), frete_vendedor: Number(r.frete_vendedor) } as VendaAnteriorFrete;
    },
    reservar: (orgId, userId, chave) => reservarNotificacao(admin, orgId, userId, 'frete_subiu', chave),
    notificar: (orgId, texto) => notificarCategoria(admin, orgId, 'financeiro', texto),
  };
}
```

- [ ] **Step 6: Checar Deno** — Run: `pnpm check:functions && pnpm lint:functions` → Expected: sem erro.

- [ ] **Step 7: Commit** — `feat(frete): verificarAltaFrete com deps injetadas (ADR-0169)`.

---

### Task 4: Ligar no `sync-venda`

**Files:**
- Modify: `supabase/functions/sync-venda/index.ts` (imports ~linha 16-18; chamada no FIM do handler, logo depois do bloco `if (orgId) { await tratarPedidoCancelado(...) }` (~linha 246) e ANTES do `if (liquidoPorPayment === null) { return ... 502 }`)

**Interfaces:**
- Consumes: `verificarAltaFrete` (Task 3), `depsMonitorFrete` (Task 3); `upsertVenda` já devolve `itens: VendaItemRow[]`; `frete` já é a variável do `Promise.all`; `pedido.pack_id` existe em `PedidoML`.

- [ ] **Step 1: Imports**

```ts
import { verificarAltaFrete } from '../_shared/faturamento/monitor-frete.ts';
import { depsMonitorFrete } from '../_shared/faturamento/monitor-frete-deps.ts';
```

- [ ] **Step 2: Chamada** — no ponto indicado acima (depois de alerta de venda, baixa e cancelamento; antes do 502 do MP, cujo retry é coberto pelo dedup):

```ts
  // ADR-0169 — monitor de frete. SÓ aqui (não em backfill/reconciliação), para histórico nunca
  // virar avalanche de avisos. Fica no FIM de propósito (depois de alerta de venda, baixa e
  // cancelamento) e com prazo de 8 s checado antes da reserva do dedup. Best-effort.
  if (orgId) {
    try {
      await verificarAltaFrete({
        orgId, userId, orderId: Number(pedido.id), limiteMs: Date.now() + 8000,
        packId: pedido.pack_id != null ? Number(pedido.pack_id) : null,
        status: String(pedido.status ?? ''),
        freteVendedor: frete, dataVenda: pedido.date_closed ?? pedido.date_created ?? null,
        itens: itens.map((i) => ({ ml_item_id: i.ml_item_id, variation_id: i.variation_id, quantity: i.quantity, titulo: i.titulo })),
      }, depsMonitorFrete(admin));
    } catch (e) {
      console.error(`monitor de frete (order ${pedido.id}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
```

- [ ] **Step 3: Validar** — Run: `pnpm check:functions && pnpm lint:functions` → sem erro. Run: `pnpm test -- supabase/functions` → verde (nada existente quebrou).

- [ ] **Step 4: Commit** — `feat(frete): sync-venda chama o monitor de frete (ADR-0169)`.

---

### Task 5: Switch em Configurações > Notificações (TDD)

**Files:**
- Modify: `src/lib/queries.ts` (após `upsertReancoraLiderAtiva`, ~linha 765)
- Modify: `src/hooks/useConfiguracoes.ts` (após `useSalvarReancoraLiderAtiva`, ~linha 43)
- Modify: `src/components/configuracoes/secao-notificacoes.tsx`
- Test: `src/components/configuracoes/__tests__/secao-notificacoes.test.tsx` (novo)

**Interfaces:**
- Consumes: coluna `monitor_frete_ativo` (Task 1).
- Produces: `fetchMonitorFreteAtivo(): Promise<boolean>`, `upsertMonitorFreteAtivo(ativo: boolean): Promise<void>`, `useMonitorFreteAtivo()`, `useSalvarMonitorFreteAtivo()`.

- [ ] **Step 1: Teste que falha**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mutate = vi.fn();
let ativo = false;
let podeEditar = true;
vi.mock('@/hooks/useConfiguracoes', () => ({
  useMonitorFreteAtivo: () => ({ data: ativo }),
  useSalvarMonitorFreteAtivo: () => ({ mutate, isPending: false, isSuccess: false, isError: false }),
}));
vi.mock('../permissoes', () => ({ usePermissoesConfig: () => ({ podeEditarConfig: podeEditar }) }));
vi.mock('@/components/config-telegram', () => ({ ConfigTelegram: () => <div data-testid="telegram" /> }));

import { SecaoNotificacoes } from '../secao-notificacoes';

describe('SecaoNotificacoes — monitor de frete', () => {
  beforeEach(() => { mutate.mockReset(); ativo = false; podeEditar = true; });

  it('mostra o switch desligado e liga ao clicar', () => {
    render(<SecaoNotificacoes />);
    const sw = screen.getByRole('switch', { name: /monitor de frete/i });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(mutate).toHaveBeenCalledWith(true);
  });

  it('reflete o valor salvo', () => {
    ativo = true;
    render(<SecaoNotificacoes />);
    expect(screen.getByRole('switch', { name: /monitor de frete/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('não-admin vê desabilitado', () => {
    podeEditar = false;
    render(<SecaoNotificacoes />);
    expect(screen.getByRole('switch', { name: /monitor de frete/i })).toBeDisabled();
  });
});
```

> Se `estadoDeMutation` exigir outros campos da mutation, completar o objeto do mock olhando `src/components/configuracoes/settings-row.tsx` — não mockar `settings-row`.

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test -- src/components/configuracoes/__tests__/secao-notificacoes.test.tsx` → FAIL (switch não existe).

- [ ] **Step 3: queries.ts**

```ts
export async function fetchMonitorFreteAtivo(): Promise<boolean> {
  const orgId = effectiveOrgId();
  if (!orgId) return false;
  const { data } = await supabase.from('configuracoes')
    .select('monitor_frete_ativo').eq('org_id', orgId).maybeSingle();
  return data?.monitor_frete_ativo ?? false;
}

export async function upsertMonitorFreteAtivo(ativo: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const orgId = effectiveOrgId();
  if (!user || !orgId) throw new Error('sem sessão');
  const { error } = await supabase.from('configuracoes')
    .upsert({ org_id: orgId, user_id: user.id, monitor_frete_ativo: ativo, atualizado_em: new Date().toISOString() }, { onConflict: 'org_id' });
  if (error) throw error;
}
```

- [ ] **Step 4: useConfiguracoes.ts** (acrescentar `fetchMonitorFreteAtivo, upsertMonitorFreteAtivo` ao import de `@/lib/queries`)

```ts
export function useMonitorFreteAtivo() {
  return useQuery({ queryKey: ['configuracoes', 'monitor_frete_ativo'], queryFn: fetchMonitorFreteAtivo });
}
export function useSalvarMonitorFreteAtivo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ativo: boolean) => upsertMonitorFreteAtivo(ativo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'monitor_frete_ativo'] }),
  });
}
```

- [ ] **Step 5: secao-notificacoes.tsx** — novo conteúdo completo:

```tsx
import { ConfigTelegram } from '@/components/config-telegram';
import { Switch } from '@/components/ui/switch';
import { useMonitorFreteAtivo, useSalvarMonitorFreteAtivo } from '@/hooks/useConfiguracoes';
import { usePermissoesConfig } from './permissoes';
import { AvisoLeitura, EstadoSalvo, SettingsGroup, SettingsRow, estadoDeMutation } from './settings-row';

export function SecaoNotificacoes() {
  const { podeEditarConfig } = usePermissoesConfig();
  const { data: monitorFreteAtivo } = useMonitorFreteAtivo();
  const salvarMonitorFrete = useSalvarMonitorFreteAtivo();
  const aviso = !podeEditarConfig && <AvisoLeitura>Só um administrador altera estas opções.</AvisoLeitura>;

  // ConfigTelegram entra SEM card próprio — card dentro de card é o ruído que esta
  // refatoração existe para tirar. E mantém o botão "Salvar configurações" explícito: o
  // token do bot não deve ser gravado a cada blur, e o teste do componente trava isso.
  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup
        titulo="Alertas no Telegram"
        descricao="Avisos de anúncio moderado, estoque zerado e afins, direto no seu Telegram."
        aviso={aviso}
      >
        <ConfigTelegram semCard podeEditar={podeEditarConfig} />
      </SettingsGroup>

      <SettingsGroup
        titulo="Monitor de frete"
        descricao="Compara o frete pago em cada venda com a venda anterior do mesmo anúncio."
        aviso={aviso}
      >
        <SettingsRow
          titulo="Avisar quando o frete de um anúncio subir"
          descricao="Dispara quando sobe mais de 10% e pelo menos R$ 2, em pedidos de 1 item. O aviso vai para quem recebe a categoria Financeiro (ADR-0169)."
          estado={<EstadoSalvo estado={estadoDeMutation(salvarMonitorFrete)} />}
        >
          <Switch
            checked={monitorFreteAtivo ?? false}
            disabled={!podeEditarConfig}
            onCheckedChange={(v) => salvarMonitorFrete.mutate(v)}
            aria-label="Monitor de frete: avisar quando o frete de um anúncio subir"
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
```

> Dois grupos ficam num `div flex flex-col gap-6` porque o layout de `Configuracoes.tsx` não dá espaçamento entre irmãos (achado do Codex). Conferir visualmente na Task 6.

- [ ] **Step 6: Rodar e ver passar** — o teste novo + `pnpm test -- src/components/__tests__/config-telegram.test.tsx` → PASS.

- [ ] **Step 7: Gate completo** — `pnpm preflight:static` → Expected: verde (lint, tsc, build, lint/check de functions, links de docs).

- [ ] **Step 8: Commit** — `feat(frete): switch do monitor de frete em Configuracoes > Notificacoes (ADR-0169)`.

---

### Task 6: Postgres real, deploy e docs (orquestrador — não delegar)

- [ ] **Step 1: Suíte inteira** — `pnpm preflight` (≈3–4 min) → verde.
- [ ] **Step 2: Push + CI** — `git push`; `gh run list --branch worktree-monitor-frete` → aguardar `frontend` e `backend-lint` verdes.
- [ ] **Step 3: Revisão do Fable** sobre `git diff origin/main...HEAD` (obrigatória antes do merge).
- [ ] **Step 4: `supabase db push`** (projeto já linkado no checkout principal; se o worktree não estiver linkado, `supabase link` antes). Conferir:
  - `select column_name, data_type, column_default from information_schema.columns where table_name='configuracoes' and column_name='monitor_frete_ativo';` → `boolean`, `false`.
  - `select has_column_privilege('authenticated', 'public.configuracoes', 'monitor_frete_ativo', 'SELECT');` → `true`.
  - `select has_function_privilege('authenticated', 'public.frete_venda_anterior(uuid,text,bigint,timestamptz,bigint)', 'EXECUTE');` → `false`; mesmo com `'service_role'` → `true`.
  - `explain` da função com um item real da Avil → usa `ml_vendas_itens_org_item_idx` (nada de seq scan em `ml_vendas_itens`).
- [ ] **Step 5: Medição com dado real (só leitura, Management API)** — quantos avisos teriam saído nos últimos 60 dias por org:

```sql
-- Mesma regra do código: elegibilidade da venda atual aqui, seleção da anterior pela função
-- frete_venda_anterior (Task 1). Rodar como service_role (Management API).
with atual as (
  select v.org_id, v.order_id, coalesce(v.date_closed, v.date_created) as data,
    v.frete_vendedor as frete, i.ml_item_id, i.variation_id
  from ml_vendas v
  join ml_vendas_itens i on i.venda_id = v.id
  where v.status <> 'cancelled' and v.pack_id is null and v.frete_vendedor > 0
    and i.quantity = 1 and i.ml_item_id is not null
    and not exists (select 1 from ml_vendas_itens x where x.venda_id = v.id and x.id <> i.id)
    and coalesce(v.date_closed, v.date_created) >= now() - interval '60 days'
)
select a.org_id,
  count(*) as elegiveis,
  count(ant.order_id) as comparaveis,
  count(*) filter (where a.frete - ant.frete_vendedor >= 2 and a.frete > ant.frete_vendedor * 1.10) as teto_avisos
from atual a
left join lateral public.frete_venda_anterior(a.org_id, a.ml_item_id, a.variation_id, a.data, a.order_id) ant on true
group by a.org_id;
```

  Reportar ao Diego como **teto** (vendas que entraram por backfill/reconciliação também contam, mas não dispariam o monitor): elegíveis, comparáveis e `teto_avisos`/60 dias por org. Se o volume parecer barulho, parar e rediscutir o limite antes do deploy.
- [ ] **Step 6: Deploy** — `supabase functions deploy sync-venda`; `supabase functions list | grep sync-venda` → versão nova com `UPDATED_AT` de agora.
- [ ] **Step 6b: Latência** — nos logs do `sync-venda` (Management API, com `iso_timestamp_start/end`), comparar `execution_time_ms` das execuções antes e depois do deploy; nenhum `prazo estourado antes da reserva` recorrente. O toggle só é ligado por decisão do Diego.
- [ ] **Step 7: Docs** — `docs/TASKS.md` (seção nova no topo, 2026-09-24, com o checklist desta entrega) e `docs/reference/edge-functions.md` (linha do `sync-venda`: "chama o monitor de frete, ADR-0169"). Commit.
- [ ] **Step 8: Merge** — CI verde no último commit → `git fetch` → fast-forward `git push origin <sha>:main` → apagar branch local/remota e o worktree → `git pull --ff-only` no checkout principal.
- [ ] **Step 9: Graphify** — atualizar o grafo (skill `graphify-update-maintenance`) com os arquivos novos.
