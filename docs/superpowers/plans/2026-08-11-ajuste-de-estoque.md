# Ajuste e zeragem de estoque pelo PubliAI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao operador uma ação no PubliAI para reduzir ou zerar o saldo de uma variação (ou de todas as variações de um produto), que se propaga ao Mercado Livre pelo push absoluto já existente.

**Architecture:** Três camadas espelhando a Entrada de mercadoria, em produção desde 2026-07-29: migration (motivo `ajuste` + RPC `ajustar_estoque`), edge `ajustar-estoque` (casca fina de auth + miolo injetável em `processar.ts`), e diálogo React no módulo Estoque. A edge aplica item a item com uma referência de idempotência por item e enfileira um `sincronizar-estoque` por `codigo_pai`.

**Tech Stack:** Postgres/plpgsql (Supabase), Deno (Edge Functions), React + TypeScript + react-query, vitest, QStash.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-11-ajuste-de-estoque-design.md`. Decisão: `docs/decisions/0110-ajuste-de-estoque-so-reduz.md`.
- O ajuste **só reduz ou zera**. `novoSaldo > saldo atual` é rejeitado na tela e de novo na RPC.
- Faixa válida: inteiro `0 ≤ novoSaldo ≤ 99999` (cap do ML, `_shared/split/capar-estoque.ts`).
- Ação **admin-only** (ADR-0060). `requireUserOrg` já devolve `isAdmin` (`supabase/functions/_shared/auth.ts:35-61`).
- Uma `referencia_externa` **por item**: `ajuste:{ref}:{codigo}`. O índice é `(org_id, referencia_externa)` (`supabase/migrations/20260729084329_e6b_estoque_movimentos.sql:48-50`) — ref compartilhada faria o 2º item colidir e ser lido como duplicata.
- Código repetido na mesma lista é **erro 400**, nunca dedupe silencioso (colidiria na ref pelo mesmo motivo).
- A edge enfileira o push **sempre**, inclusive quando todos os itens vieram `duplicada` ou com delta 0 — mesmo contrato de `entrada-estoque/index.ts:62-68`.
- Migrations só por `supabase migration new` + `supabase db push` (ADR-0043). Nunca painel.
- Comentários e mensagens de erro em pt-BR, como o resto do repo.
- `pnpm lint` e `pnpm test` verdes antes de cada commit.

---

### Task 1: Migration — motivo `ajuste` e RPC `ajustar_estoque`

**Files:**
- Create: `supabase/migrations/<timestamp>_e6b_ajuste_estoque.sql` (nome gerado por `supabase migration new e6b_ajuste_estoque`)
- Reference: `supabase/migrations/20260729084329_e6b_estoque_movimentos.sql` (constraint em `:38-44`, `baixar_estoque` insert-first em `:108-115`, `registrar_entrada` em `:260-315`, grants em `:350-363`)

**Interfaces:**
- Consumes: tabela `estoque_movimentos`, tabela `variacoes`, trigger `bloquear_escrita_direta_estoque`.
- Produces: `public.ajustar_estoque(p_org uuid, p_codigo text, p_novo_saldo integer, p_obs text, p_criado_por uuid, p_ref text) returns integer` — devolve o novo saldo, ou `null` quando a referência já foi aplicada.

- [ ] **Step 1: Criar o arquivo da migration**

```bash
cd "$(git rev-parse --show-toplevel)"
supabase migration new e6b_ajuste_estoque
```

- [ ] **Step 2: Escrever a migration**

```sql
-- E6b (ADR-0110): ajuste de estoque pelo PubliAI. Só REDUZ ou zera — aumentar continua
-- sendo Entrada de mercadoria, que exige custo e alimenta markup/preço (ADR-0055).
--
-- Motivação: sem este caminho o operador zerava a cor direto no Mercado Livre, e o push
-- absoluto (`sincronizar-estoque`) mais o cron `reconciliar-estoque` restauravam o número
-- antigo em até 24h.

-- Check constraint não aceita append: derruba e recria com o motivo novo.
alter table public.estoque_movimentos
  drop constraint estoque_movimentos_motivo_check;

alter table public.estoque_movimentos
  add constraint estoque_movimentos_motivo_check check (motivo in (
    'venda', 'entrada', 'estorno_venda',
    'venda_sku_nao_encontrado', 'estorno_sku_nao_encontrado',
    'cancelamento_sem_baixa', 'venda_cancelada_antes',
    -- ADR-0110: redução manual de saldo (venda física, perda, fim de estoque).
    'ajuste'
  ));

create or replace function public.ajustar_estoque(
  p_org uuid, p_codigo text, p_novo_saldo integer, p_obs text,
  p_criado_por uuid, p_ref text
) returns integer language plpgsql security definer set search_path = ''
as $$
declare v_var uuid; v_pai text; v_antes integer; v_novo integer; v_mov uuid;
begin
  -- Caminho que alimenta saldo falha LOUD (regra da casa, ADR-0055): nada de default silencioso.
  if p_novo_saldo is null or p_novo_saldo < 0 then
    raise exception 'ajustar_estoque: novo saldo deve ser inteiro >= 0 (recebeu %)', p_novo_saldo;
  end if;
  -- Teto do ML (ADR-0048). O ajuste só reduz, então isto é trava barata, não caminho quente.
  if p_novo_saldo > 99999 then
    raise exception 'ajustar_estoque: novo saldo acima do teto do canal (99999): %', p_novo_saldo;
  end if;
  if p_ref is null or btrim(p_ref) = '' then
    raise exception 'ajustar_estoque: referência de idempotência é obrigatória';
  end if;

  -- Mesma âncora de registrar_entrada/baixar_estoque e do push: a família MAIS RECENTE.
  select v.id, f.codigo_pai into v_var, v_pai
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo
  order by f.criado_em desc
  limit 1;

  if v_var is null then
    raise exception 'ajustar_estoque: SKU % não encontrado na organização', p_codigo;
  end if;

  -- INSERT-FIRST, como baixar_estoque: a idempotência precisa vir antes do lock da linha de
  -- `variacoes`. Se o lock viesse primeiro, um retry duplicado seguraria a variação só para
  -- descobrir que era no-op, bloqueando `baixar_estoque` concorrente à toa.
  -- `codigo_pai` entra já aqui: sem ele o movimento fica fora do índice de outbox
  -- (estoque_movimentos_push_pendente_idx) e o push nunca seria recuperado.
  begin
    insert into public.estoque_movimentos
      (org_id, codigo, codigo_pai, quantidade, motivo, observacao, criado_por,
       referencia_externa, push_canal_origem)
    values (p_org, p_codigo, v_pai, 0, 'ajuste', p_obs, p_criado_por, p_ref, null)
    returning id into v_mov;
  exception when unique_violation then
    return null;   -- mesma submissão já aplicada
  end;

  select estoque into v_antes from public.variacoes where id = v_var for update;

  -- Aumento é caminho da Entrada (que exige custo). Aqui a exceção derruba também o insert
  -- acima — a função inteira é uma transação, então não sobra movimento órfão.
  if p_novo_saldo > v_antes then
    raise exception 'ajustar_estoque: ajuste só reduz saldo (atual %, pedido %). Para aumentar, use Entrada de mercadoria.', v_antes, p_novo_saldo;
  end if;

  update public.variacoes set estoque = p_novo_saldo
  where id = v_var
  returning estoque into v_novo;

  -- Delta negativo (ou 0 quando o saldo já era o pedido). Mesma convenção da venda, então as
  -- somas do histórico continuam corretas.
  update public.estoque_movimentos
  set quantidade = v_novo - v_antes, estoque_anterior = v_antes, estoque_resultante = v_novo
  where id = v_mov;

  return v_novo;
end $$;

-- Sem o revoke, uma função `security definer` fica chamável pelo browser via PostgREST e
-- contorna tanto o trigger de bloqueio quanto a RLS. Mesmo padrão das RPCs do Bloco A.
revoke execute on function public.ajustar_estoque(uuid, text, integer, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.ajustar_estoque(uuid, text, integer, text, uuid, text)
  to service_role;
```

- [ ] **Step 3: Validar a sintaxe sem tocar em dados**

Rodar a migration inteira dentro de uma transação abortada, pelo mesmo endpoint SQL usado na investigação (Management API, `SUPABASE_ACCESS_TOKEN` do `.env.local`):

```bash
# begin; <conteúdo da migration>; rollback;
```
Expected: sem erro de sintaxe. Se acusar `constraint ... does not exist`, conferir o nome exato em `20260729084329_e6b_estoque_movimentos.sql:38`.

- [ ] **Step 4: Exercitar a RPC com rollback (dados reais, sem efeito)**

```sql
begin;
  -- SKU real com saldo > 0. 18760903 = Vermelho do 26705343 (saldo 1990 em 2026-08-11).
  select public.ajustar_estoque(
    (select org_id from public.variacoes where codigo = '18760903' limit 1),
    '18760903', 0, 'teste rollback', null, 'ajuste:teste-1:18760903');
  select estoque from public.variacoes where codigo = '18760903';
  select motivo, quantidade, estoque_anterior, estoque_resultante
  from public.estoque_movimentos where referencia_externa = 'ajuste:teste-1:18760903';
rollback;
```
Expected: retorno `0`; `variacoes.estoque` = 0; movimento com `quantidade = -1990`, `estoque_anterior = 1990`, `estoque_resultante = 0`. Depois do `rollback`, nada mudou.

- [ ] **Step 5: Exercitar as três recusas (também com rollback)**

```sql
begin;
  -- (a) aumento: deve falhar
  select public.ajustar_estoque((select org_id from public.variacoes where codigo='18760903' limit 1),
    '18760903', 999999, null, null, 'ajuste:teste-2:18760903');
rollback;
-- Expected: exception "novo saldo acima do teto do canal (99999)"

begin;
  select public.ajustar_estoque((select org_id from public.variacoes where codigo='18760903' limit 1),
    '18760903', 5000, null, null, 'ajuste:teste-3:18760903');
rollback;
-- Expected: exception "ajuste só reduz saldo (atual 1990, pedido 5000)"

begin;
  select public.ajustar_estoque((select org_id from public.variacoes where codigo='18760903' limit 1),
    'SKU-QUE-NAO-EXISTE', 0, null, null, 'ajuste:teste-4:x');
rollback;
-- Expected: exception "SKU SKU-QUE-NAO-EXISTE não encontrado na organização"
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_e6b_ajuste_estoque.sql
git commit -m "feat(estoque): migration do motivo ajuste e da RPC ajustar_estoque (ADR-0110)"
```

---

### Task 2: Módulo puro de validação da edge

**Files:**
- Create: `supabase/functions/ajustar-estoque/validar.ts`
- Test: `supabase/functions/ajustar-estoque/__tests__/validar.test.ts`

**Interfaces:**
- Consumes: nada (módulo puro, sem import de Deno — é o que o permite rodar no vitest do frontend).
- Produces:
  - `export interface ItemAjuste { codigo: string; novoSaldo: number }`
  - `export function refDoItem(ref: string, codigo: string): string`
  - `export function validarAjustes(bruto: unknown): { ok: true; itens: ItemAjuste[] } | { ok: false; erro: string }`

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { describe, it, expect } from 'vitest';
import { refDoItem, validarAjustes } from '../validar.ts';

describe('refDoItem', () => {
  it('gera uma referência por item — nunca a mesma para dois códigos', () => {
    expect(refDoItem('abc', '18760903')).toBe('ajuste:abc:18760903');
    expect(refDoItem('abc', '26706073')).not.toBe(refDoItem('abc', '18760903'));
  });
});

describe('validarAjustes', () => {
  it('aceita lista válida', () => {
    const r = validarAjustes([{ codigo: '18760903', novoSaldo: 0 }, { codigo: '26706073', novoSaldo: 12 }]);
    expect(r).toEqual({ ok: true, itens: [
      { codigo: '18760903', novoSaldo: 0 }, { codigo: '26706073', novoSaldo: 12 },
    ] });
  });

  it('recusa lista vazia', () => {
    expect(validarAjustes([])).toEqual({ ok: false, erro: 'Informe ao menos um SKU.' });
  });

  it('recusa o que não é lista', () => {
    expect(validarAjustes({ codigo: 'x', novoSaldo: 0 })).toEqual({ ok: false, erro: 'Informe ao menos um SKU.' });
  });

  it('recusa saldo negativo', () => {
    expect(validarAjustes([{ codigo: 'x', novoSaldo: -1 }]))
      .toEqual({ ok: false, erro: 'Saldo de x inválido: deve ser inteiro entre 0 e 99999.' });
  });

  it('recusa saldo acima do teto do canal', () => {
    expect(validarAjustes([{ codigo: 'x', novoSaldo: 100000 }]))
      .toEqual({ ok: false, erro: 'Saldo de x inválido: deve ser inteiro entre 0 e 99999.' });
  });

  it('recusa saldo fracionário', () => {
    expect(validarAjustes([{ codigo: 'x', novoSaldo: 1.5 }]))
      .toEqual({ ok: false, erro: 'Saldo de x inválido: deve ser inteiro entre 0 e 99999.' });
  });

  it('recusa código vazio', () => {
    expect(validarAjustes([{ codigo: '  ', novoSaldo: 0 }]))
      .toEqual({ ok: false, erro: 'Item sem SKU na lista de ajustes.' });
  });

  // O código repetido colidiria na referência de idempotência (ajuste:{ref}:{codigo}) e a
  // segunda ocorrência voltaria como "duplicada" sem ser aplicada — falha silenciosa.
  it('recusa código repetido em vez de deduplicar em silêncio', () => {
    expect(validarAjustes([{ codigo: 'x', novoSaldo: 0 }, { codigo: 'x', novoSaldo: 3 }]))
      .toEqual({ ok: false, erro: 'SKU repetido na lista: x.' });
  });

  it('normaliza espaços em volta do código', () => {
    const r = validarAjustes([{ codigo: ' 18760903 ', novoSaldo: 0 }]);
    expect(r).toEqual({ ok: true, itens: [{ codigo: '18760903', novoSaldo: 0 }] });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- supabase/functions/ajustar-estoque`
Expected: FAIL — módulo `../validar.ts` não existe.

- [ ] **Step 3: Implementar**

```ts
// E6b (ADR-0110): validação pura do corpo de `ajustar-estoque`. Sem import de Deno de
// propósito — assim roda no vitest do frontend, como `_shared/estoque/baixa.ts`.

export interface ItemAjuste { codigo: string; novoSaldo: number }

export const TETO_SALDO = 99999;

/**
 * Uma referência de idempotência POR ITEM. O índice é (org_id, referencia_externa): uma ref
 * compartilhada pela lista inteira faria o 2º item colidir e ser lido como duplicata — o
 * "Zerar tudo" aplicaria só a primeira cor e devolveria sucesso.
 */
export function refDoItem(ref: string, codigo: string): string {
  return `ajuste:${ref}:${codigo}`;
}

export function validarAjustes(
  bruto: unknown,
): { ok: true; itens: ItemAjuste[] } | { ok: false; erro: string } {
  if (!Array.isArray(bruto) || bruto.length === 0) {
    return { ok: false, erro: 'Informe ao menos um SKU.' };
  }
  const itens: ItemAjuste[] = [];
  const vistos = new Set<string>();
  for (const cru of bruto) {
    const codigo = String((cru as ItemAjuste)?.codigo ?? '').trim();
    if (!codigo) return { ok: false, erro: 'Item sem SKU na lista de ajustes.' };
    if (vistos.has(codigo)) return { ok: false, erro: `SKU repetido na lista: ${codigo}.` };
    vistos.add(codigo);
    const novoSaldo = Number((cru as ItemAjuste)?.novoSaldo);
    if (!Number.isInteger(novoSaldo) || novoSaldo < 0 || novoSaldo > TETO_SALDO) {
      return { ok: false, erro: `Saldo de ${codigo} inválido: deve ser inteiro entre 0 e ${TETO_SALDO}.` };
    }
    itens.push({ codigo, novoSaldo });
  }
  return { ok: true, itens };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- supabase/functions/ajustar-estoque`
Expected: PASS (10 testes)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ajustar-estoque/validar.ts supabase/functions/ajustar-estoque/__tests__/validar.test.ts
git commit -m "feat(estoque): validação pura do ajuste (ref por item, faixa 0..99999)"
```

---

### Task 3: Miolo da edge (`processar.ts`) com dependências injetadas

**Files:**
- Create: `supabase/functions/ajustar-estoque/processar.ts`
- Test: `supabase/functions/ajustar-estoque/__tests__/processar.test.ts`
- Reference: `supabase/functions/sincronizar-estoque/processar.ts` (padrão de deps injetadas), `supabase/functions/entrada-estoque/index.ts:55-80` (contrato de push e duplicada)

**Interfaces:**
- Consumes: `ItemAjuste`, `refDoItem` (Task 2).
- Produces:
  - `export interface ResultadoItem { codigo: string; estoque: number | null; duplicada: boolean; erro?: string }`
  - `export interface DepsAjuste { rpc(nome: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>; lerMovimento(orgId: string, ref: string): Promise<{ codigo_pai: string | null; estoque_resultante: number | null } | null>; enfileirar(job: { org_id: string; codigo_pai: string; canal_origem: null }, orgId: string): Promise<string> }`
  - `export async function processarAjuste(deps: DepsAjuste, p: { orgId: string; userId: string; itens: ItemAjuste[]; observacao: string | null; ref: string }): Promise<{ resultados: ResultadoItem[]; pushOk: boolean }>`

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { describe, it, expect } from 'vitest';
import { processarAjuste, type DepsAjuste } from '../processar.ts';

function deps(over: Partial<DepsAjuste> = {}): DepsAjuste & { filas: unknown[] } {
  const filas: unknown[] = [];
  return {
    filas,
    rpc: async () => ({ data: 0, error: null }),
    lerMovimento: async () => ({ codigo_pai: '26705343', estoque_resultante: 0 }),
    enfileirar: async (job) => { filas.push(job); return 'msg_1'; },
    ...over,
  } as DepsAjuste & { filas: unknown[] };
}

describe('processarAjuste', () => {
  it('aplica cada item e enfileira um push por codigo_pai', async () => {
    const d = deps();
    const r = await processarAjuste(d, {
      orgId: 'org1', userId: 'u1', ref: 'abc', observacao: null,
      itens: [{ codigo: '18760903', novoSaldo: 0 }, { codigo: '26706073', novoSaldo: 0 }],
    });
    expect(r.resultados).toEqual([
      { codigo: '18760903', estoque: 0, duplicada: false },
      { codigo: '26706073', estoque: 0, duplicada: false },
    ]);
    expect(d.filas).toEqual([{ org_id: 'org1', codigo_pai: '26705343', canal_origem: null }]);
    expect(r.pushOk).toBe(true);
  });

  it('usa uma referência distinta por item', async () => {
    const refs: string[] = [];
    const d = deps({ rpc: async (_n, args) => { refs.push(args.p_ref as string); return { data: 0, error: null }; } });
    await processarAjuste(d, {
      orgId: 'org1', userId: 'u1', ref: 'abc', observacao: null,
      itens: [{ codigo: 'A', novoSaldo: 0 }, { codigo: 'B', novoSaldo: 0 }],
    });
    expect(refs).toEqual(['ajuste:abc:A', 'ajuste:abc:B']);
  });

  it('item que falha não impede os seguintes', async () => {
    let n = 0;
    const d = deps({
      rpc: async () => {
        n += 1;
        return n === 1 ? { data: null, error: { message: 'ajuste só reduz saldo' } } : { data: 5, error: null };
      },
    });
    const r = await processarAjuste(d, {
      orgId: 'org1', userId: 'u1', ref: 'abc', observacao: null,
      itens: [{ codigo: 'A', novoSaldo: 9 }, { codigo: 'B', novoSaldo: 5 }],
    });
    expect(r.resultados[0]).toEqual({ codigo: 'A', estoque: null, duplicada: false, erro: 'ajuste só reduz saldo' });
    expect(r.resultados[1]).toEqual({ codigo: 'B', estoque: 5, duplicada: false });
  });

  // data null da RPC = referência já aplicada. O push TEM de sair mesmo assim: se a primeira
  // tentativa gravou e morreu antes de enfileirar, o retry cairia aqui e o push se perderia.
  it('duplicada ainda enfileira o push e devolve o saldo do movimento', async () => {
    const d = deps({
      rpc: async () => ({ data: null, error: null }),
      lerMovimento: async () => ({ codigo_pai: '26705343', estoque_resultante: 7 }),
    });
    const r = await processarAjuste(d, {
      orgId: 'org1', userId: 'u1', ref: 'abc', observacao: null,
      itens: [{ codigo: 'A', novoSaldo: 7 }],
    });
    expect(r.resultados[0]).toEqual({ codigo: 'A', estoque: 7, duplicada: true });
    expect(d.filas).toHaveLength(1);
  });

  it('não repete o push quando dois SKUs são do mesmo produto', async () => {
    const d = deps();
    await processarAjuste(d, {
      orgId: 'org1', userId: 'u1', ref: 'abc', observacao: null,
      itens: [{ codigo: 'A', novoSaldo: 0 }, { codigo: 'B', novoSaldo: 0 }],
    });
    expect(d.filas).toHaveLength(1);
  });

  it('enfileira um push por produto quando os SKUs são de produtos diferentes', async () => {
    let n = 0;
    const d = deps({
      lerMovimento: async () => { n += 1; return { codigo_pai: n === 1 ? 'P1' : 'P2', estoque_resultante: 0 }; },
    });
    await processarAjuste(d, {
      orgId: 'org1', userId: 'u1', ref: 'abc', observacao: null,
      itens: [{ codigo: 'A', novoSaldo: 0 }, { codigo: 'B', novoSaldo: 0 }],
    });
    expect(d.filas).toEqual([
      { org_id: 'org1', codigo_pai: 'P1', canal_origem: null },
      { org_id: 'org1', codigo_pai: 'P2', canal_origem: null },
    ]);
  });

  it('falha de enfileiramento não derruba o ajuste, só marca pushOk=false', async () => {
    const d = deps({ enfileirar: async () => { throw new Error('QStash fora'); } });
    const r = await processarAjuste(d, {
      orgId: 'org1', userId: 'u1', ref: 'abc', observacao: null,
      itens: [{ codigo: 'A', novoSaldo: 0 }],
    });
    expect(r.resultados[0].estoque).toBe(0);
    expect(r.pushOk).toBe(false);
  });

  it('não enfileira push para item que falhou', async () => {
    const d = deps({ rpc: async () => ({ data: null, error: { message: 'SKU não encontrado' } }) });
    const r = await processarAjuste(d, {
      orgId: 'org1', userId: 'u1', ref: 'abc', observacao: null,
      itens: [{ codigo: 'A', novoSaldo: 0 }],
    });
    expect(r.resultados[0].erro).toBe('SKU não encontrado');
    expect(d.filas).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- supabase/functions/ajustar-estoque`
Expected: FAIL — `../processar.ts` não existe.

- [ ] **Step 3: Implementar**

```ts
// E6b (ADR-0110): miolo do ajuste de estoque, com dependências injetadas para ser testável
// sem Deno — mesmo arranjo de `sincronizar-estoque/processar.ts`.
import { refDoItem, type ItemAjuste } from './validar.ts';

export interface ResultadoItem {
  codigo: string;
  estoque: number | null;
  duplicada: boolean;
  erro?: string;
}

export interface DepsAjuste {
  rpc(nome: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  lerMovimento(orgId: string, ref: string): Promise<{ codigo_pai: string | null; estoque_resultante: number | null } | null>;
  enfileirar(job: { org_id: string; codigo_pai: string; canal_origem: null }, orgId: string): Promise<string>;
}

export async function processarAjuste(
  deps: DepsAjuste,
  p: { orgId: string; userId: string; itens: ItemAjuste[]; observacao: string | null; ref: string },
): Promise<{ resultados: ResultadoItem[]; pushOk: boolean }> {
  const resultados: ResultadoItem[] = [];
  const produtos = new Set<string>();

  for (const item of p.itens) {
    const ref = refDoItem(p.ref, item.codigo);
    const { data, error } = await deps.rpc('ajustar_estoque', {
      p_org: p.orgId, p_codigo: item.codigo, p_novo_saldo: item.novoSaldo,
      p_obs: p.observacao, p_criado_por: p.userId, p_ref: ref,
    });
    if (error) {
      // Um item ruim não pode derrubar os outros: o operador precisa saber o que entrou.
      resultados.push({ codigo: item.codigo, estoque: null, duplicada: false, erro: error.message });
      continue;
    }
    // `data` null = a referência já tinha sido aplicada. O movimento existe; leia dele o saldo
    // e o produto, porque é ele que diz para onde o push precisa ir.
    const mov = await deps.lerMovimento(p.orgId, ref);
    if (mov?.codigo_pai) produtos.add(mov.codigo_pai);
    resultados.push({
      codigo: item.codigo,
      estoque: data === null ? (mov?.estoque_resultante ?? null) : Number(data),
      duplicada: data === null,
    });
  }

  // O push sai SEMPRE para todo produto tocado — inclusive quando tudo veio duplicado. Mesmo
  // contrato da entrada: perder a propagação é pior que enfileirar de novo, e push absoluto é
  // idempotente. canal_origem null = todos os canais publicados.
  let pushOk = true;
  for (const codigoPai of produtos) {
    try {
      await deps.enfileirar({ org_id: p.orgId, codigo_pai: codigoPai, canal_origem: null }, p.orgId);
    } catch (e) {
      pushOk = false;
      console.error('ajuste_push_falhou', codigoPai, String(e));
    }
  }

  return { resultados, pushOk };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- supabase/functions/ajustar-estoque`
Expected: PASS (todos os testes das Tasks 2 e 3)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ajustar-estoque/processar.ts supabase/functions/ajustar-estoque/__tests__/processar.test.ts
git commit -m "feat(estoque): miolo do ajuste com push por produto e resultado por item"
```

---

### Task 4: Casca da edge `ajustar-estoque` + config

**Files:**
- Create: `supabase/functions/ajustar-estoque/index.ts`
- Modify: `supabase/config.toml` (bloco das funções com `verify_jwt = true`)
- Reference: `supabase/functions/entrada-estoque/index.ts` (auth, módulo, auditoria)

**Interfaces:**
- Consumes: `validarAjustes` (Task 2), `processarAjuste` (Task 3), `requireUserOrg`/`isAdmin` (`_shared/auth.ts`), `exigirModulo` (`_shared/produto/modulo.ts`), `enfileirarSincronizacaoEstoque` (`_shared/queue.ts`), `auditarOperacaoSuporte` (`_shared/support-audit.ts`).
- Produces: `POST /functions/v1/ajustar-estoque` com body `{ ajustes: [{codigo, novoSaldo}], observacao?, ref }` → `{ resultados: ResultadoItem[], pushOk: boolean }`.

- [ ] **Step 1: Escrever a casca**

```ts
// E6b (ADR-0110): ajuste/zeragem de saldo. Escrita de estoque só passa por aqui (service_role),
// nunca do browser — o trigger do Bloco A recusa UPDATE direto em `variacoes.estoque`.
// Admin-only por paridade com pausar/reativar anúncio (ADR-0060): zerar tira o produto de venda.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { enfileirarSincronizacaoEstoque } from '../_shared/queue.ts';
import { validarAjustes } from './validar.ts';
import { processarAjuste } from './processar.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let userId: string;
  let orgId: string;
  let isAdmin: boolean;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ({ userId, orgId, isAdmin } = context = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  if (!isAdmin) {
    return json({ error: 'Somente administradores podem ajustar estoque.' }, 403);
  }

  const admin = adminClient();
  if (!(await exigirModulo(admin, orgId, 'estoque'))) {
    return json({ error: 'Módulo de estoque não habilitado para esta organização.' }, 403);
  }

  let body: { ajustes?: unknown; observacao?: string | null; ref?: string };
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const validacao = validarAjustes(body.ajustes);
  if (!validacao.ok) return json({ error: validacao.erro }, 400);

  // Idempotência: o cliente gera um uuid por submissão. Sem isso, duplo clique aplicaria o
  // ajuste duas vezes — e a segunda veria um saldo já reduzido.
  const ref = body.ref?.trim();
  if (!ref) return json({ error: 'Referência de idempotência ausente.' }, 400);

  const r = await processarAjuste(
    {
      rpc: (nome, args) => admin.rpc(nome, args).then((res) => ({ data: res.data, error: res.error })),
      lerMovimento: async (org, refItem) => {
        const { data } = await admin.from('estoque_movimentos')
          .select('codigo_pai, estoque_resultante')
          .eq('org_id', org).eq('referencia_externa', refItem).maybeSingle();
        return (data as { codigo_pai: string | null; estoque_resultante: number | null } | null) ?? null;
      },
      enfileirar: enfileirarSincronizacaoEstoque,
    },
    { orgId, userId, itens: validacao.itens, observacao: body.observacao?.trim() || null, ref },
  );

  await auditarOperacaoSuporte(
    admin, context, { type: 'variacao', id: validacao.itens.map((i) => i.codigo).join(',') }, 'succeeded',
  );

  return json(r);
});
```

- [ ] **Step 2: Registrar o `verify_jwt` no config**

Em `supabase/config.toml`, junto de `entrada-estoque` (que já é `verify_jwt = true`):

```toml
[functions.ajustar-estoque]
verify_jwt = true
```

- [ ] **Step 3: Conferir que o type-check passa**

Run: `pnpm lint`
Expected: sem erro novo. (As Edge Functions não entram no tsconfig do frontend; o erro que importa aqui é de import quebrado nos arquivos testados.)

- [ ] **Step 4: Rodar a suíte inteira**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ajustar-estoque/index.ts supabase/config.toml
git commit -m "feat(estoque): edge ajustar-estoque (admin-only, módulo estoque, push por produto)"
```

---

### Task 5: Cliente do front (`ajustarEstoque`)

**Files:**
- Modify: `src/lib/produtos-saldo.ts` (ao lado de `registrarEntrada`, `:104-115`)
- Test: `src/lib/__tests__/produtos-saldo-ajuste.test.ts`

**Interfaces:**
- Consumes: `supabase.functions.invoke`, `erroDaEdge` (já usados por `registrarEntrada`).
- Produces:
  - `export interface ResultadoAjusteItem { codigo: string; estoque: number | null; duplicada: boolean; erro?: string }`
  - `export interface ResultadoAjuste { resultados: ResultadoAjusteItem[]; pushOk: boolean }`
  - `export async function ajustarEstoque(p: { ajustes: { codigo: string; novoSaldo: number }[]; observacao?: string | null; ref: string }): Promise<ResultadoAjuste>`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { ajustarEstoque } from '@/lib/produtos-saldo';

beforeEach(() => invoke.mockReset());

describe('ajustarEstoque', () => {
  it('envia a lista e devolve o resultado por item', async () => {
    invoke.mockResolvedValue({
      data: { resultados: [{ codigo: 'A', estoque: 0, duplicada: false }], pushOk: true },
      error: null,
    });
    const r = await ajustarEstoque({ ajustes: [{ codigo: 'A', novoSaldo: 0 }], ref: 'r1' });
    expect(invoke).toHaveBeenCalledWith('ajustar-estoque', {
      body: { ajustes: [{ codigo: 'A', novoSaldo: 0 }], observacao: null, ref: 'r1' },
    });
    expect(r).toEqual({ resultados: [{ codigo: 'A', estoque: 0, duplicada: false }], pushOk: true });
  });

  it('trata pushOk ausente como sucesso, igual à entrada', async () => {
    invoke.mockResolvedValue({ data: { resultados: [] }, error: null });
    const r = await ajustarEstoque({ ajustes: [{ codigo: 'A', novoSaldo: 0 }], ref: 'r1' });
    expect(r.pushOk).toBe(true);
  });

  it('propaga erro da edge', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('403') });
    await expect(ajustarEstoque({ ajustes: [{ codigo: 'A', novoSaldo: 0 }], ref: 'r1' })).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- produtos-saldo-ajuste`
Expected: FAIL — `ajustarEstoque` não é exportado.

- [ ] **Step 3: Implementar em `src/lib/produtos-saldo.ts`**

```ts
export interface ResultadoAjusteItem {
  codigo: string;
  estoque: number | null;
  duplicada: boolean;
  erro?: string;
}

export interface ResultadoAjuste {
  resultados: ResultadoAjusteItem[];
  /** false = saldo gravado, mas a propagação para os marketplaces falhou. NUNCA descartar. */
  pushOk: boolean;
}

/** Reduz ou zera saldo (ADR-0110). Aumentar é Entrada — a edge recusa. */
export async function ajustarEstoque(p: {
  ajustes: { codigo: string; novoSaldo: number }[];
  observacao?: string | null;
  /** uuid gerado UMA vez por submissão — não regenerar no retry, senão reaplica. */
  ref: string;
}): Promise<ResultadoAjuste> {
  const { data, error } = await supabase.functions.invoke('ajustar-estoque', {
    body: { ajustes: p.ajustes, observacao: p.observacao ?? null, ref: p.ref },
  });
  if (error) throw await erroDaEdge(error);
  const r = data as { resultados?: ResultadoAjusteItem[]; pushOk?: boolean };
  return { resultados: r.resultados ?? [], pushOk: r.pushOk !== false };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- produtos-saldo-ajuste`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/produtos-saldo.ts src/lib/__tests__/produtos-saldo-ajuste.test.ts
git commit -m "feat(estoque): cliente do ajuste de estoque no front"
```

---

### Task 6: Diálogo de ajuste na tela Estoque

**Files:**
- Create: `src/components/estoque/dialog-ajuste.tsx`
- Modify: `src/components/estoque/produto-card.tsx` (botão ao lado de "Entrada", `:132-141`)
- Modify: `src/pages/Estoque.tsx` (estado do diálogo, junto do `DialogEntrada` em `:160`)
- Test: `src/components/estoque/__tests__/dialog-ajuste.test.tsx`
- Reference: `src/components/estoque/dialog-entrada.tsx` (mutation, react-query, toast)

**Interfaces:**
- Consumes: `ajustarEstoque` (Task 5), `ProdutoComSaldo` (`src/lib/produtos-saldo.ts:27`).
- Produces: `export function DialogAjuste({ produto, aberto, onFechar }: { produto: ProdutoComSaldo | null; aberto: boolean; onFechar: () => void })`; `ProdutoCard` ganha a prop `onAjustar?: (produto: ProdutoComSaldo) => void`.

- [ ] **Step 1: Escrever os testes que falham**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DialogAjuste } from '../dialog-ajuste';
import type { ProdutoComSaldo } from '@/lib/produtos-saldo';

const ajustar = vi.fn();
vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<typeof import('@/lib/produtos-saldo')>()),
  ajustarEstoque: (...a: unknown[]) => ajustar(...a),
}));

const produto = {
  codigoPai: '26705343',
  nome: 'Tecido Helanca Light',
  variacoes: [
    { codigo: '18760903', cor: 'Vermelho', estoque: 1990 },
    { codigo: '26706073', cor: 'Azul', estoque: 10 },
  ],
} as unknown as ProdutoComSaldo;

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DialogAjuste produto={produto} aberto onFechar={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => { ajustar.mockReset(); ajustar.mockResolvedValue({ resultados: [], pushOk: true }); });

describe('DialogAjuste', () => {
  it('mostra uma linha por variação com o saldo atual pré-preenchido', () => {
    montar();
    expect(screen.getByLabelText('Novo saldo de 18760903')).toHaveValue(1990);
    expect(screen.getByLabelText('Novo saldo de 26706073')).toHaveValue(10);
  });

  it('"Zerar tudo" preenche 0 em todas as linhas', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Zerar tudo' }));
    expect(screen.getByLabelText('Novo saldo de 18760903')).toHaveValue(0);
    expect(screen.getByLabelText('Novo saldo de 26706073')).toHaveValue(0);
  });

  it('recusa valor acima do saldo atual e aponta para a Entrada', () => {
    montar();
    fireEvent.change(screen.getByLabelText('Novo saldo de 26706073'), { target: { value: '50' } });
    expect(screen.getByText(/só reduz.*Entrada/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmar/ })).toBeDisabled();
  });

  it('envia só as linhas que mudaram, com uma ref por submissão', async () => {
    montar();
    fireEvent.change(screen.getByLabelText('Novo saldo de 18760903'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    await waitFor(() => expect(ajustar).toHaveBeenCalledTimes(1));
    const arg = ajustar.mock.calls[0][0];
    expect(arg.ajustes).toEqual([{ codigo: '18760903', novoSaldo: 0 }]);
    expect(typeof arg.ref).toBe('string');
    expect(arg.ref.length).toBeGreaterThan(10);
  });

  it('avisa que um cancelamento posterior repõe o saldo', () => {
    montar();
    expect(screen.getByText(/cancelado.*rep(õe|oe)/i)).toBeInTheDocument();
  });

  it('mostra o total que sai do saldo', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Zerar tudo' }));
    expect(screen.getByText(/−2000|-2000/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- dialog-ajuste`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Implementar `dialog-ajuste.tsx`**

Seguir a anatomia de `dialog-entrada.tsx`: `useMutation` + `queryClient.invalidateQueries(QK...)` + `toast`. Requisitos que os testes fixam:
- Uma linha por variação: rótulo `Novo saldo de {codigo}`, `type="number"`, valor inicial = saldo atual.
- Botão `Zerar` por linha e `Zerar tudo` no topo.
- Campo maior que o saldo atual: mensagem contendo "só reduz" e "Entrada", e `Confirmar` desabilitado.
- `Confirmar` envia **apenas** as linhas cujo valor mudou, com `ref` de `crypto.randomUUID()` gerada uma vez por submissão (guardar em `useRef`, não regenerar no retry).
- Aviso fixo: "Um pedido cancelado depois disso repõe o saldo e a cor pode voltar a vender no canal. Para tirar de venda de vez, use Pausar."
- Resumo do total: `−N` unidades.
- Sucesso: toast `✓ Salvo`. `pushOk === false`: toast avisando que a sincronização com o canal será refeita. Item com `erro`: mostrar o erro por SKU sem fechar o diálogo.

- [ ] **Step 4: Ligar o botão no card e a página**

Em `produto-card.tsx`, ao lado do botão "Entrada" (`:132-141`), adicionar botão "Ajustar" que chama `onAjustar(produto)`. Renderizar somente quando a prop existir — a página decide pelo `is_admin` do perfil.

Em `src/pages/Estoque.tsx`, ao lado do `DialogEntrada` (`:160`): estado `produtoAjuste`, passar `onAjustar` ao `ProdutoCard` apenas se o perfil for admin, e montar `<DialogAjuste produto={produtoAjuste} aberto={produtoAjuste != null} onFechar={() => setProdutoAjuste(null)} />`.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test -- dialog-ajuste`
Expected: PASS

- [ ] **Step 6: Suíte inteira + lint**

Run: `pnpm lint && pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/estoque/dialog-ajuste.tsx src/components/estoque/produto-card.tsx src/pages/Estoque.tsx src/components/estoque/__tests__/dialog-ajuste.test.tsx
git commit -m "feat(estoque): diálogo de ajuste/zeragem por produto e variação"
```

---

### Task 7: Rótulo do motivo no histórico de movimentos

**Files:**
- Modify: `src/components/movimentos-estoque.tsx` (mapa de rótulos de `motivo`)
- Test: `src/components/__tests__/movimentos-estoque*.test.tsx` (arquivo existente; se não houver caso de rótulo, adicionar um)

**Interfaces:**
- Consumes: linhas de `estoque_movimentos` já carregadas pela tela.
- Produces: nada para outras tasks.

- [ ] **Step 1: Localizar o mapa de rótulos**

```bash
grep -n "estorno_venda\|venda_sku_nao_encontrado" src/components/movimentos-estoque.tsx
```

- [ ] **Step 2: Escrever o teste do rótulo novo**

Adicionar ao arquivo de teste existente um caso que renderiza um movimento com `motivo: 'ajuste'` e espera o texto "Ajuste".

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm test -- movimentos-estoque`
Expected: FAIL

- [ ] **Step 4: Adicionar `ajuste: 'Ajuste'` ao mapa e rodar de novo**

Run: `pnpm test -- movimentos-estoque`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/movimentos-estoque.tsx src/components/__tests__/
git commit -m "feat(estoque): rótulo do motivo ajuste no histórico"
```

---

### Task 8: Documentação obrigatória

**Files:**
- Modify: `docs/reference/edge-functions.md` (tabela de funções + seção Estoque Bloco B)
- Modify: `docs/reference/modelo-de-dados.md` (motivo `ajuste`, RPC `ajustar_estoque`)
- Modify: `docs/TASKS.md`
- Modify: `obsidian-vault/04-Decisões/Índice de ADRs.md` (entrada do ADR-0110)
- Modify: `docs/how-to/operacoes-rotineiras.md` (regra operacional "nunca editar estoque direto no ML")

- [ ] **Step 1: `docs/reference/edge-functions.md`**

Linha na tabela de funções: `| ajustar-estoque | **true** | HTTP (frontend) | sim (`ref` por item) |`, e um parágrafo na seção "Estoque (ADR-0094, Bloco B)" explicando: admin-only, só reduz, ref por item, push por `codigo_pai` sempre.

- [ ] **Step 2: `docs/reference/modelo-de-dados.md`**

Registrar o motivo `ajuste` na lista de motivos de `estoque_movimentos` e a RPC `ajustar_estoque` com a assinatura completa.

- [ ] **Step 3: `docs/how-to/operacoes-rotineiras.md`**

Seção curta: **nunca editar estoque direto no Mercado Livre** — o push absoluto e o cron `reconciliar-estoque` restauram o número local em até 24h. Para reduzir ou zerar, usar Estoque → Ajustar.

- [ ] **Step 4: `docs/TASKS.md` e índice de ADRs**

Entrada do trabalho concluído e do ADR-0110.

- [ ] **Step 5: Commit**

```bash
git add docs/ obsidian-vault/
git commit -m "docs(estoque): registra a edge de ajuste, o motivo ajuste e a regra de nunca editar estoque no ML"
```

---

### Task 9: Deploy e validação em produção

**Files:** nenhum (operação)

- [ ] **Step 1: Aplicar a migration**

```bash
supabase db push
npm run db:check
```
Expected: migration aplicada, `db:check` sem divergência.

- [ ] **Step 2: Deploy da edge**

```bash
supabase functions deploy ajustar-estoque
```
Expected: deploy OK. Conferir a versão publicada logo depois (regra da casa: deploy nunca defasado).

- [ ] **Step 3: Verificar o gate de admin e o de módulo**

Chamar a função sem JWT e com JWT não-admin; esperar 401 e 403.

- [ ] **Step 4: Validar na UI real**

Abrir a tela Estoque, achar o produto `26705343`, abrir **Ajustar**, zerar a cor Vermelho (`18760903`), confirmar. Conferir:
- `variacoes.estoque` do SKU = 0 e movimento `ajuste` com `quantidade = -1990` no banco;
- `sincronizar-estoque` enfileirado no QStash logo em seguida;
- estoque da cor no Mercado Livre = 0 (item técnico `MLB4959860751`).

- [ ] **Step 5: Verificar o risco de item user products pausado (registrado na spec)**

Depois de zerar, conferir `status` do item no ML e o `status` local em `anuncios_externos_itens` para o SKU `18760903`. Se o item ficar `paused` no ML **e** o status local virar `pausado`, uma reposição futura pela Entrada não alcançaria esse item (`_shared/estoque/alvos.ts:45`) — registrar o achado e abrir tarefa própria, sem tentar consertar dentro deste plano.

- [ ] **Step 6: Repor o saldo de teste**

Se o Vermelho ainda tiver mercadoria física, usar Estoque → Entrada para devolver o saldo e conferir que o push levou o número de volta ao ML.

---

## Self-Review

**Cobertura da spec:** §Banco → Task 1. §Edge → Tasks 2-4. §UI → Tasks 5-6 (+ Task 7, rótulo do histórico, que a spec pede indiretamente ao gravar `observacao` e motivo novo). §Cap de estoque → Task 1 (validação) + Task 2 (faixa). §Fluxo de dados e §Tratamento de erro → cobertos pelos testes da Task 3. §Riscos aceitos → Task 9 Step 5. §Documentação → Task 8.

**Placeholders:** os passos de código trazem o código completo. A Task 6 Step 3 descreve o componente por requisitos em vez de despejar o JSX inteiro — os testes da Step 1 fixam cada comportamento, então não há ambiguidade sobre o que precisa existir.

**Consistência de tipos:** `ItemAjuste { codigo, novoSaldo }` é o mesmo nas Tasks 2, 3, 5 e 6. `ResultadoItem`/`ResultadoAjusteItem` têm os mesmos campos dos dois lados da fronteira HTTP. `refDoItem(ref, codigo)` é usada só na Task 3. `ajustar_estoque` tem a mesma ordem de parâmetros na migration (Task 1), na chamada da Task 3 e nos grants.
