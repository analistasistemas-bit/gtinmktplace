# Vendas SKU — Fatia 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a aba **Vendas SKU** em Faturamento (`/faturamento?aba=sku`): ranking de variações por lucro, com Markup, Margem s/ venda, devolução, tendência, alertas, Curva ABC, "quem explica a variação do lucro" e agrupamento por família.

**Architecture:** Tudo roda no navegador sobre os **itens de `agruparPorPedido`**, a mesma fonte da aba Vendas (ADR-0172 D-5). Não existe fórmula nova de lucro. Uma única RPC nova, `vendas_sku_catalogo()`, só **enriquece** cada código: família canônica, fornecedor, origem, estoque, kit, primeira e última venda. Ela não calcula dinheiro. A lógica pura fica em `src/lib/vendas-sku.ts` (testável sem React). Um hook junta os dados e a aba só renderiza.

**Tech Stack:** React 18 + TypeScript, TanStack Query v5, Vitest, Tailwind + shadcn/ui (`Table`, `Tabs`, `Button`, `Input`, `KpiCard`), Supabase Postgres (RPC `security definer` + `current_org_id()`).

**Spec:** `docs/superpowers/specs/2026-09-26-vendas-sku-design.md` · **ADR:** `docs/decisions/0172-vendas-sku-analise-por-variacao.md` · **Termos:** `docs/reference/glossario.md` → "Vendas SKU".

## Global Constraints

- Unidade = variação (`ml_vendas_itens.codigo`); enriquecimento pela **família mais recente** do `(org_id, codigo)` (glossário "Estoque canônico").
- Lucro = Σ(líquido do item − custo do item), só itens faturáveis **com** custo; nunca lucro = líquido.
- Rótulos exatos: **"Markup"** (`lucro ÷ custo`) e **"Margem s/ venda"** (`lucro ÷ preço de venda`) — ADR-0150; nunca "margem" sozinha nem `%` sem denominador.
- Custo: congelado; sem congelado → custo atual marcado **"custo estimado"**; sem nenhum → **"sem custo"** (alerta de primeira classe). SKU com parte sem custo = **"lucro parcial"**.
- Dinheiro segue `ehFaturavel` + ADR-0106; soma dos SKUs = KPIs da aba Vendas no mesmo período (bruto, líquido, unidades).
- Taxa de devolução = pedidos do SKU vendidos no período com `tem_devolucao` ÷ pedidos do SKU no período (faturáveis ou com devolução). Conta **pedidos**, não unidades.
- Limites fixos (constante `LIMITES`): tendência ±20% em 30 dias contra os 30 anteriores, mínimo 5 unidades; cobertura < 15 dias; devolução > 5% com ≥ 20 pedidos; ABC A até 80% acumulado, B até 95%, C o resto; D = prejuízo (só na ABC por lucro).
- Tendência mede até o **fim do período selecionado**.
- Cada recorte de período filtra as **vendas** por `date_closed` **antes** de `agruparPorPedido`, como a aba Vendas (que só carrega a janela). Nunca agrupar a janela estendida e cortar por `Pedido.data`.
- Bruto do SKU = Σ `unit_price × quantity` dos itens faturáveis. Medido em 2026-09-26: `total_amount` = Σ itens em 4.211 de 4.211 pedidos. A paridade é conferida tela contra tela (Task 8).
- Migrations só via `supabase migration new` + `supabase db push` (ADR-0043). RPC nova: `security definer`, `set search_path = ''`, filtra por `public.current_org_id()`, `grant execute ... to authenticated`.
- Leitura paginada por GET (`supabase.rpc(fn, undefined, { get: true }).range()`) — POST ignora `Range`.
- Nenhuma escrita no Mercado Livre. Toda a UI em português com acentuação correta.

## Review Focus

1. **Pack com order cancelada + paga** → a cancelada entra em "canceladas", não em unidades/faturamento; a soma continua batendo com a aba Vendas. Coberto em Task 3.
2. **SKU com parte das vendas sem custo** → `fonteCusto = 'parcial'`, lucro só dos itens com custo, Margem s/ venda sobre o bruto **desses** itens. Coberto em Task 3.
3. **Base anterior zero ou negativa** → Δ em R$, nunca `+∞%`; Markup/Margem variam em pontos percentuais. Coberto em Task 5.
4. **Kit vinculado** → cobertura `'compartilhado'`, nunca um número de dias. Coberto em Task 4.
5. **Item sem código** → linha `SEM_CODIGO` ("sem código"); soma total preservada. Coberto em Task 3.
6. **Pack com uma order em cada período** (ex.: 31/08 e 01/09) → dividido entre os períodos, igual à aba Vendas; a soma do período continua batendo. Coberto em Task 6.

> Revisão do plano: Grok 4.7 xhigh (via Cursor), 2026-09-26. Achados acatados já estão incorporados.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/pedidos-faturamento.ts` (modificar) | `ItemPedido` ganha `custoEstimado`, `temDevolucao`, `orderId` |
| `supabase/migrations/<ts>_vendas_sku_catalogo.sql` (criar) | RPC `vendas_sku_catalogo()` |
| `supabase/tests/vendas_sku_catalogo.sql` (criar) | Teste SQL da RPC |
| `src/lib/vendas-sku-catalogo.ts` (criar) | Tipo `CatalogoSku` + fetch paginado |
| `src/hooks/useCatalogoVendasSku.ts` (criar) | Query do catálogo |
| `src/lib/vendas-sku.ts` (criar) | Lógica pura: agregação, métricas, tendência, cobertura, alertas, KPIs, Δ, ABC, variação, insights, família, janela estendida |
| `tests/lib/vendas-sku.test.ts` (criar) | Testes da lógica pura |
| `src/hooks/useVendasSku.ts` (criar) | Junta vendas + resolvers + catálogo + devoluções |
| `src/components/faturamento/aba-vendas-sku.tsx` (criar) | Aba: filtros, faixa sem custo, KPIs, insights, variação, ABC, ranking |
| `src/components/faturamento/ranking-sku.tsx` (criar) | Tabela do ranking + linha expandida "a conta" |
| `src/components/faturamento/__tests__/aba-vendas-sku.test.tsx` (criar) | Teste de render |
| `src/pages/Faturamento.tsx` (modificar) | Registrar a aba `sku` |

---

### Task 1: `ItemPedido` expõe custo estimado, devolução e order

**Files:**
- Modify: `src/lib/pedidos-faturamento.ts` (interface `ItemPedido` ~l.14-40; `itensFlat` ~l.148-152; retorno do item ~l.192-200)
- Test: `tests/lib/pedidos-faturamento.test.ts`

**Interfaces:**
- Produces: `ItemPedido.custoEstimado: boolean` (tem custo mas sem `custo_congelado`), `ItemPedido.temDevolucao: boolean` (da venda/order do item), `ItemPedido.orderId: number`.

- [ ] **Step 1: Write the failing test** (anexar ao fim de `tests/lib/pedidos-faturamento.test.ts`)

```ts
describe('sinais por item para Vendas SKU', () => {
  it('custoEstimado = tem custo mas não congelado; temDevolucao e orderId vêm da order do item', () => {
    const custo: CustoResolver = (it) => (it.custo_congelado ?? 7);
    const vendas = [
      venda({ id: 'a', order_id: 11, pack_id: 70, tem_devolucao: true,
        itens: [item({ id: 'i1', custo_congelado: 5 })] }),
      venda({ id: 'b', order_id: 12, pack_id: 70,
        itens: [item({ id: 'i2' })] }),
    ];
    const [p] = agruparPorPedido(vendas, custo);
    const i1 = p.itens.find((x) => x.id === 'i1')!;
    const i2 = p.itens.find((x) => x.id === 'i2')!;
    expect([i1.custoEstimado, i1.temDevolucao, i1.orderId]).toEqual([false, true, 11]);
    expect([i2.custoEstimado, i2.temDevolucao, i2.orderId]).toEqual([true, false, 12]);
  });

  it('sem custo nenhum → custoEstimado false (é "sem custo", não "estimado")', () => {
    const [p] = agruparPorPedido([venda({ id: 'a' })]);
    expect(p.itens[0].custo).toBeNull();
    expect(p.itens[0].custoEstimado).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/pedidos-faturamento.test.ts`
Expected: FAIL — `expected [ undefined, undefined, undefined ] to deeply equal [ false, true, 11 ]`

- [ ] **Step 3: Write minimal implementation**

Em `ItemPedido`, depois de `faturavel: boolean;`:

```ts
  /** Tem custo, mas não congelado na venda (ADR-0109): veio do custo atual do cadastro. */
  custoEstimado: boolean;
  /** A order deste item tem devolução (ml_vendas.tem_devolucao). */
  temDevolucao: boolean;
  /** order_id do ML de onde veio o item (um pack junta várias). */
  orderId: number;
```

Em `itensFlat`, trocar o `return` por:

```ts
      return v.itens.map((it, i) => ({
        it, faturavel, uf: v.uf, estorno: i === 0 ? v.estorno ?? 0 : 0,
        temDevolucao: v.tem_devolucao, orderId: v.order_id,
      }));
```

No `.map` dos itens, desestruturar `temDevolucao, orderId` junto de `{ it, faturavel, uf, estorno }` e acrescentar ao objeto retornado:

```ts
        custoEstimado: custo != null && it.custo_congelado == null,
        temDevolucao, orderId,
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/lib/pedidos-faturamento.test.ts` → PASS. Depois `pnpm exec tsc -b --noEmit` (ou `pnpm preflight:static`) e completar `custoEstimado: false, temDevolucao: false, orderId: 1` em qualquer fixture de `ItemPedido` que o typecheck apontar.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add src/lib/pedidos-faturamento.ts tests/lib/pedidos-faturamento.test.ts
/usr/bin/git commit -m "feat(vendas-sku): item de pedido expõe custo estimado, devolução e order"
```

---

### Task 2: RPC `vendas_sku_catalogo()` + fetch + hook

> Migration → **nunca rebaixar modelo** (CLAUDE.md). Executor: Opus.

**Files:**
- Create: `supabase/migrations/<timestamp>_vendas_sku_catalogo.sql` (via `supabase migration new vendas_sku_catalogo`)
- Create: `supabase/tests/vendas_sku_catalogo.sql`
- Create: `src/lib/vendas-sku-catalogo.ts`
- Create: `src/hooks/useCatalogoVendasSku.ts`
- Test: `tests/lib/vendas-sku-catalogo.test.ts`

**Interfaces:**
- Produces: `interface CatalogoSku { codigo: string; codigoPai: string | null; nomeFamilia: string | null; nome: string | null; cor: string | null; tamanho: string | null; estoque: number; fornecedor: string | null; origem: 'nacional' | 'importado' | null; ehKit: boolean; primeiraVenda: string | null; ultimaVenda: string | null }`, `mapCatalogoSku(raw): CatalogoSku`, `fetchCatalogoVendasSku(): Promise<CatalogoSku[]>`, `useCatalogoVendasSku()`.

- [ ] **Step 1: Write the failing SQL test** — `supabase/tests/vendas_sku_catalogo.sql`

```sql
\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('93000000-0000-0000-0000-000000000001', 'SKU test', 'sku-test'),
  ('93000000-0000-0000-0000-000000000002', 'Outra org', 'outra-org');
insert into auth.users (id, email, raw_user_meta_data) values
  ('93000000-0000-0000-0000-000000000101', 'sku@test.local', '{"org_id":"93000000-0000-0000-0000-000000000001"}'::jsonb),
  ('93000000-0000-0000-0000-000000000102', 'outra@test.local', '{"org_id":"93000000-0000-0000-0000-000000000002"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', true),
  ('93000000-0000-0000-0000-000000000102', '93000000-0000-0000-0000-000000000002', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('93000000-0000-0000-0000-000000000201', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 'processando', 'manual'),
  ('93000000-0000-0000-0000-000000000202', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 'processando', 'manual'),
  ('93000000-0000-0000-0000-000000000203', '93000000-0000-0000-0000-000000000102', '93000000-0000-0000-0000-000000000002', 'processando', 'manual');
-- Família antiga e família nova do mesmo produto: a RPC tem que devolver a NOVA (estoque 9, fornecedor B).
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, fornecedor, chave_cadastro, criado_em) values
  ('93000000-0000-0000-0000-000000000301', '93000000-0000-0000-0000-000000000201', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '09300000', 'Fita antiga', 'CREATE', 'nacional', 'Fornecedor A', gen_random_uuid(), now() - interval '10 days'),
  ('93000000-0000-0000-0000-000000000302', '93000000-0000-0000-0000-000000000202', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '09300000', 'Fita nova', 'UPDATE', 'importado', 'Fornecedor B', gen_random_uuid(), now()),
  ('93000000-0000-0000-0000-000000000303', '93000000-0000-0000-0000-000000000203', '93000000-0000-0000-0000-000000000102', '93000000-0000-0000-0000-000000000002', '09400000', 'Outra org', 'CREATE', 'nacional', null, gen_random_uuid(), now());
-- Kit vinculado da org 1 (eh_kit = true).
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, kit_base_codigo_pai, kit_multiplicador, criado_em) values
  ('93000000-0000-0000-0000-000000000304', '93000000-0000-0000-0000-000000000202', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '09310000', 'Kit 2 fitas', 'CREATE', 'nacional', gen_random_uuid(), '09300000', 2, now());
insert into public.variacoes (familia_id, user_id, org_id, codigo, preco, estoque, nome) values
  ('93000000-0000-0000-0000-000000000304', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '09310001', 20, 0, 'Kit 2 fitas');
insert into public.variacoes (familia_id, user_id, org_id, codigo, preco, estoque, nome) values
  ('93000000-0000-0000-0000-000000000301', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '09300001', 10, 3, 'Fita azul'),
  ('93000000-0000-0000-0000-000000000302', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '09300001', 10, 9, 'Fita azul'),
  ('93000000-0000-0000-0000-000000000303', '93000000-0000-0000-0000-000000000102', '93000000-0000-0000-0000-000000000002', '09400001', 10, 5, 'Não pode vazar');
-- Vendas: uma paga antiga, uma paga recente, uma cancelada mais recente (não conta).
insert into public.ml_vendas (id, user_id, org_id, order_id, status, date_closed, total_amount) values
  ('93000000-0000-0000-0000-000000000401', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 930001, 'paid', '2026-07-01T12:00:00Z', 10),
  ('93000000-0000-0000-0000-000000000402', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 930002, 'paid', '2026-09-01T12:00:00Z', 10),
  ('93000000-0000-0000-0000-000000000403', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 930003, 'cancelled', '2026-09-20T12:00:00Z', 10),
  -- Venda PAGA da OUTRA org com o MESMO código e data mais antiga: não pode mexer na primeira_venda da org 1.
  ('93000000-0000-0000-0000-000000000404', '93000000-0000-0000-0000-000000000102', '93000000-0000-0000-0000-000000000002', 930004, 'paid', '2026-01-01T12:00:00Z', 10);
insert into public.ml_vendas_itens (user_id, org_id, venda_id, codigo, quantity, unit_price) values
  ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000401', '09300001', 1, 10),
  ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000402', '09300001', 1, 10),
  ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000403', '09300001', 1, 10),
  ('93000000-0000-0000-0000-000000000102', '93000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000404', '09300001', 1, 10);

set local role authenticated;
set local request.jwt.claims = '{"sub":"93000000-0000-0000-0000-000000000101","role":"authenticated"}';
do $$
declare r json; n int;
begin
  select count(*) into n from public.vendas_sku_catalogo() x where x->>'codigo' = '09400001';
  if n <> 0 then raise exception 'vazou SKU de outra org'; end if;
  select count(*) into n from public.vendas_sku_catalogo() x where x->>'codigo' = '09300001';
  if n <> 1 then raise exception 'código duplicado: % linhas, esperado 1 (família mais recente)', n; end if;
  select x into r from public.vendas_sku_catalogo() x where x->>'codigo' = '09300001';
  if (r->>'estoque')::int <> 9 or r->>'fornecedor' <> 'Fornecedor B' or r->>'origem' <> 'importado' or r->>'nome_familia' <> 'Fita nova'
    then raise exception 'não usou a família mais recente: %', r; end if;
  if (r->>'eh_kit')::boolean is distinct from false then raise exception 'eh_kit errado: %', r; end if;
  if (r->>'primeira_venda')::timestamptz <> '2026-07-01T12:00:00Z' or (r->>'ultima_venda')::timestamptz <> '2026-09-01T12:00:00Z'
    then raise exception 'primeira/última venda erradas (cancelada e outra org não contam): %', r; end if;
  select x into r from public.vendas_sku_catalogo() x where x->>'codigo' = '09310001';
  if (r->>'eh_kit')::boolean is distinct from true then raise exception 'kit vinculado sem eh_kit: %', r; end if;
end $$;
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run (com `supabase start` de pé): `psql "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres" -f supabase/tests/vendas_sku_catalogo.sql`
Expected: `ERROR: function public.vendas_sku_catalogo() does not exist`

- [ ] **Step 3: Write the migration** — `supabase migration new vendas_sku_catalogo`, conteúdo:

```sql
-- ADR-0172: enriquecimento por código para a aba Vendas SKU. Não calcula dinheiro — o lucro vem
-- dos itens de agruparPorPedido no navegador (D-5). Família mais recente por (org, codigo), a mesma
-- âncora do estoque canônico (ADR-0025). Primeira/última venda só de orders faturáveis
-- (mesma lista de ehFaturavel: paid, partially_refunded, refunded).
create or replace function public.vendas_sku_catalogo()
returns setof json
language sql stable security definer
set search_path = ''
as $$
  with org as (
    select public.current_org_id() as id
  ),
  canonica as (
    select distinct on (v.codigo)
      v.codigo, v.nome, v.cor, v.tamanho, v.estoque,
      f.codigo_pai, f.nome_pai, f.fornecedor, f.origem,
      (f.kit_multiplicador is not null) as eh_kit
    from public.variacoes v
    join public.familias f on f.id = v.familia_id
    cross join org
    where v.org_id = org.id and f.org_id = org.id
    order by v.codigo, f.criado_em desc, f.id desc
  ),
  vendas as (
    select i.codigo, min(s.date_closed) as primeira, max(s.date_closed) as ultima
    from public.ml_vendas s
    join public.ml_vendas_itens i on i.venda_id = s.id
    cross join org
    where s.org_id = org.id
      and s.status in ('paid', 'partially_refunded', 'refunded')
      and coalesce(i.codigo, '') <> ''
    group by i.codigo
  )
  select json_build_object(
    'codigo', c.codigo,
    'codigo_pai', c.codigo_pai,
    'nome_familia', c.nome_pai,
    'nome', coalesce(c.nome, c.nome_pai),
    'cor', c.cor,
    'tamanho', c.tamanho,
    'estoque', c.estoque,
    'fornecedor', c.fornecedor,
    'origem', c.origem,
    'eh_kit', c.eh_kit,
    'primeira_venda', vd.primeira,
    'ultima_venda', vd.ultima
  )
  from canonica c
  left join vendas vd on vd.codigo = c.codigo
  order by c.codigo
$$;
revoke all on function public.vendas_sku_catalogo() from public;
grant execute on function public.vendas_sku_catalogo() to authenticated;
```

Aplicar local: `supabase db reset` (ou, se o reset estiver quebrado, `psql ... -f supabase/migrations/<ts>_vendas_sku_catalogo.sql`).

- [ ] **Step 4: Run SQL test** — mesmo comando do Step 2. Expected: termina com `ROLLBACK` e sem `ERROR`.

- [ ] **Step 5: Write the failing TS test** — `tests/lib/vendas-sku-catalogo.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { mapCatalogoSku } from '@/lib/vendas-sku-catalogo';

describe('mapCatalogoSku', () => {
  it('converte o JSON da RPC em CatalogoSku', () => {
    expect(mapCatalogoSku({
      codigo: '09300001', codigo_pai: '09300000', nome_familia: 'Fita', nome: 'Fita azul', cor: 'Azul',
      tamanho: null, estoque: 9, fornecedor: 'B', origem: 'importado', eh_kit: false,
      primeira_venda: '2026-07-01T12:00:00+00:00', ultima_venda: null,
    })).toEqual({
      codigo: '09300001', codigoPai: '09300000', nomeFamilia: 'Fita', nome: 'Fita azul', cor: 'Azul',
      tamanho: null, estoque: 9, fornecedor: 'B', origem: 'importado', ehKit: false,
      primeiraVenda: '2026-07-01T12:00:00+00:00', ultimaVenda: null,
    });
  });

  it('origem fora de nacional/importado vira null (nunca presumida)', () => {
    expect(mapCatalogoSku({ codigo: 'x', estoque: 0, eh_kit: false, origem: 'NACIONAL ' }).origem).toBeNull();
  });
});
```

Run: `pnpm vitest run tests/lib/vendas-sku-catalogo.test.ts` → FAIL (módulo não existe).

- [ ] **Step 6: Implement** — `src/lib/vendas-sku-catalogo.ts`

```ts
import { supabase } from '@/lib/supabase';
import { buscarTodasPaginasParalelo } from '@/lib/paginacao-supabase';

/** Uma linha por código (variação), da família mais recente da org — RPC vendas_sku_catalogo (ADR-0172). */
export interface CatalogoSku {
  codigo: string;
  codigoPai: string | null;
  nomeFamilia: string | null;
  nome: string | null;
  cor: string | null;
  tamanho: string | null;
  estoque: number;
  fornecedor: string | null;
  origem: 'nacional' | 'importado' | null;
  ehKit: boolean;
  primeiraVenda: string | null;
  ultimaVenda: string | null;
}

type Raw = Record<string, unknown>;
const txt = (v: unknown): string | null => (v == null ? null : String(v));

export function mapCatalogoSku(r: Raw): CatalogoSku {
  const origem = r.origem === 'nacional' || r.origem === 'importado' ? r.origem : null;
  return {
    codigo: String(r.codigo),
    codigoPai: txt(r.codigo_pai),
    nomeFamilia: txt(r.nome_familia),
    nome: txt(r.nome),
    cor: txt(r.cor),
    tamanho: txt(r.tamanho),
    estoque: Number(r.estoque ?? 0),
    fornecedor: txt(r.fornecedor),
    origem,
    ehKit: r.eh_kit === true,
    primeiraVenda: txt(r.primeira_venda),
    ultimaVenda: txt(r.ultima_venda),
  };
}

/** Paginado por GET: RPC por POST ignora o header Range (teto de 1.000 linhas do PostgREST). */
export async function fetchCatalogoVendasSku(): Promise<CatalogoSku[]> {
  const data = await buscarTodasPaginasParalelo<Raw>((de, ate) =>
    supabase.rpc('vendas_sku_catalogo', undefined, { get: true }).range(de, ate) as unknown as PromiseLike<{
      data: Raw[] | null; error: { message: string } | null;
    }>);
  return data.map(mapCatalogoSku);
}
```

`src/hooks/useCatalogoVendasSku.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { fetchCatalogoVendasSku, type CatalogoSku } from '@/lib/vendas-sku-catalogo';

export function useCatalogoVendasSku() {
  return useQuery<CatalogoSku[]>({
    queryKey: ['vendas-sku-catalogo'],
    queryFn: fetchCatalogoVendasSku,
    staleTime: 10 * 60_000,
  });
}
```

Em `src/lib/database.types.ts`, dentro de `Functions` e em ordem alfabética (o vizinho `skus_estoque_org` está na l.3557), acrescentar `vendas_sku_catalogo: { Args: never; Returns: Json[] }`. Sem isso `supabase.rpc('vendas_sku_catalogo')` não compila (`createClient<Database>`, `src/lib/supabase.ts:10`).

- [ ] **Step 7: Run tests** — `pnpm vitest run tests/lib/vendas-sku-catalogo.test.ts` → PASS; `pnpm preflight:static` → verde.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add supabase/migrations/*_vendas_sku_catalogo.sql supabase/tests/vendas_sku_catalogo.sql src/lib/database.types.ts src/lib/vendas-sku-catalogo.ts src/hooks/useCatalogoVendasSku.ts tests/lib/vendas-sku-catalogo.test.ts
/usr/bin/git commit -m "feat(vendas-sku): RPC vendas_sku_catalogo com família canônica e 1ª/última venda"
```

---

### Task 3: Agregação por SKU e métricas (núcleo financeiro)

> Código financeiro → Opus.

**Files:**
- Create: `src/lib/vendas-sku.ts`
- Test: `tests/lib/vendas-sku.test.ts`

**Interfaces:**
- Consumes: `Pedido`, `ItemPedido` (Task 1), `CatalogoSku` (Task 2), `Janela` (`@/lib/metricas`).
- Produces:
  - `SEM_CODIGO = ''`
  - `interface AcumuladorSku { unidades; unidadesComCusto; pedidos; bruto; liquido; imposto; brutoComCusto; liquidoComCusto; custo; brutoCustoReal; itensComCusto; itensSemCusto; itensEstimados; canceladas; pedidosBaseDevolucao; pedidosDevolvidos }` (todos `number`)
  - `type FonteCusto = 'real' | 'estimado' | 'parcial' | 'sem_custo'`
  - `interface MetricasSku { lucro: number | null; lucroPorUnidade: number | null; markup: number | null; margemSVenda: number | null; ticket: number; taxaDevolucao: number | null; fonteCusto: FonteCusto }`
  - `interface LinhaSku { codigo: string; titulo: string | null; imagemPath: string | null; codigoPai: string | null; nomeFamilia: string | null; fornecedor: string | null; origem: 'nacional' | 'importado' | null; ehKit: boolean; estoque: number | null; primeiraVenda: string | null; acc: AcumuladorSku; m: MetricasSku; pedidoChaves: string[] }`
  - `dentroDaJanela(data: string | null, j: Janela): boolean`
  - `somarAcumuladores(accs: AcumuladorSku[]): AcumuladorSku`
  - `metricas(a: AcumuladorSku): MetricasSku`
  - `agregarPorSku(pedidos: Pedido[], janela: Janela, catalogo: Map<string, CatalogoSku>): LinhaSku[]`

- [ ] **Step 1: Write the failing tests** — `tests/lib/vendas-sku.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { agruparPorPedido, calcularKpisPedidos } from '@/lib/pedidos-faturamento';
import { agregarPorSku, SEM_CODIGO } from '@/lib/vendas-sku';
import type { Venda, VendaItem } from '@/lib/faturamento';
import type { CustoResolver } from '@/lib/resumo-vendas';
import type { Janela } from '@/lib/metricas';

function item(over: Partial<VendaItem> = {}): VendaItem {
  return { id: 'it1', ml_item_id: 'MLB1', variation_id: null, titulo: 'FITA', codigo: '001', cor: null,
    ean: '789', quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: true, ...over };
}
function venda(over: Partial<Venda> = {}): Venda {
  return { id: 'v1', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
    date_closed: '2026-09-10T12:00:00Z', date_created: null, comprador_nick: 'c', comprador_id: 100,
    total_amount: 10, paid_amount: 10, sale_fee_total: 1, frete_vendedor: null, liquido: 9, estorno: null,
    money_release_date: null, currency: 'BRL', shipping_id: null, shipping_status: null,
    shipping_substatus: null, shipping_logistic: null, tracking_number: null, is_publiai: true,
    tem_devolucao: false, itens: [item()], ...over };
}
const SET: Janela = { desde: '2026-09-01T00:00:00.000Z', ate: '2026-09-30T23:59:59.999Z' };
const r2 = (n: number) => Math.round(n * 100) / 100;

describe('agregarPorSku', () => {
  it('soma dos SKUs bate com os KPIs da aba Vendas (bruto, líquido, unidades)', () => {
    const custo: CustoResolver = () => 4;
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: 9, total_amount: 30, sale_fee_total: 3,
        itens: [item({ id: 'i1', codigo: 'A', unit_price: 10 }), item({ id: 'i2', codigo: 'B', unit_price: 20 })] }),
      venda({ id: 'b', order_id: 2, pack_id: 9, status: 'cancelled', total_amount: 10,
        itens: [item({ id: 'i3', codigo: 'A', unit_price: 10 })] }),
      venda({ id: 'c', order_id: 3, total_amount: 10, itens: [item({ id: 'i4', codigo: 'A' })] }),
    ];
    const pedidos = agruparPorPedido(vendas, custo);
    const linhas = agregarPorSku(pedidos, SET, new Map());
    const k = calcularKpisPedidos(pedidos);
    expect(r2(linhas.reduce((s, l) => s + l.acc.bruto, 0))).toBe(k.bruto);
    expect(r2(linhas.reduce((s, l) => s + l.acc.liquido, 0))).toBe(k.liquido);
    expect(linhas.reduce((s, l) => s + l.acc.unidades, 0)).toBe(k.unidades);
    expect(linhas.find((l) => l.codigo === 'A')!.acc.canceladas).toBe(1);
  });

  it('lucro só dos itens com custo; fonte parcial; margem sobre o bruto desses itens', () => {
    const custo: CustoResolver = (it) => (it.id === 'i1' ? 4 : null);
    const vendas = [
      // Pedido avulso sem frete usa v.liquido direto (sales-summary.ts:336): liquido 10 explícito.
      venda({ id: 'a', order_id: 1, total_amount: 10, sale_fee_total: 0, liquido: 10, itens: [item({ id: 'i1', codigo: 'A', custo_congelado: 4 })] }),
      venda({ id: 'b', order_id: 2, total_amount: 10, sale_fee_total: 0, liquido: 10, itens: [item({ id: 'i2', codigo: 'A' })] }),
    ];
    const [l] = agregarPorSku(agruparPorPedido(vendas, custo), SET, new Map());
    expect(l.m.fonteCusto).toBe('parcial');
    expect(l.m.lucro).toBe(6);                 // 10 − 4, o item sem custo fica fora
    expect(l.m.markup).toBeCloseTo(1.5, 5);    // 6 ÷ 4
    expect(l.m.margemSVenda).toBeCloseTo(0.6, 5); // 6 ÷ 10 (bruto do item com custo)
    expect(l.m.lucroPorUnidade).toBe(6);
  });

  it('sem custo nenhum → lucro null e fonte sem_custo (nunca lucro = líquido)', () => {
    const [l] = agregarPorSku(agruparPorPedido([venda()]), SET, new Map());
    expect(l.m.lucro).toBeNull();
    expect(l.m.fonteCusto).toBe('sem_custo');
  });

  it('custo atual (não congelado) → fonte estimado', () => {
    const [l] = agregarPorSku(agruparPorPedido([venda()], () => 3), SET, new Map());
    expect(l.m.fonteCusto).toBe('estimado');
  });

  it('taxa de devolução conta pedidos: 1 devolvido em 2', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, tem_devolucao: true, status: 'cancelled', itens: [item({ id: 'i1', codigo: 'A' })] }),
      venda({ id: 'b', order_id: 2, itens: [item({ id: 'i2', codigo: 'A', quantity: 3 })] }),
    ];
    const [l] = agregarPorSku(agruparPorPedido(vendas), SET, new Map());
    expect(l.m.taxaDevolucao).toBe(0.5);
    expect(l.acc.canceladas).toBe(0);  // devolvida não é "cancelada"
  });

  it('item sem código vira a linha SEM_CODIGO e não some do total', () => {
    const linhas = agregarPorSku(agruparPorPedido([venda({ itens: [item({ codigo: null })] })]), SET, new Map());
    expect(linhas.map((l) => l.codigo)).toEqual([SEM_CODIGO]);
    expect(linhas[0].acc.bruto).toBe(10);
  });

  it('pedido fora da janela não entra', () => {
    const linhas = agregarPorSku(agruparPorPedido([venda({ date_closed: '2026-08-31T23:59:59.000Z' })]), SET, new Map());
    expect(linhas).toHaveLength(0);
  });

  it('usa o catálogo para título, família, fornecedor, estoque', () => {
    const cat = new Map([['001', { codigo: '001', codigoPai: '000', nomeFamilia: 'Fitas', nome: 'Fita azul', cor: null,
      tamanho: null, estoque: 7, fornecedor: 'F', origem: 'nacional' as const, ehKit: false, primeiraVenda: null, ultimaVenda: null }]]);
    const [l] = agregarPorSku(agruparPorPedido([venda()]), SET, cat);
    expect([l.titulo, l.nomeFamilia, l.fornecedor, l.estoque, l.origem]).toEqual(['Fita azul', 'Fitas', 'F', 7, 'nacional']);
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/lib/vendas-sku.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Implement** — `src/lib/vendas-sku.ts` (primeira parte)

```ts
// Vendas SKU (ADR-0172): agrega por código (variação) os itens que agruparPorPedido já produz —
// a mesma fonte da aba Vendas. Nenhuma fórmula nova de dinheiro: bruto = preço × qtd, líquido =
// item.liquido (já sem imposto), custo = item.custo. Só itens faturáveis entram no dinheiro.
import type { Pedido } from './pedidos-faturamento';
import type { CatalogoSku } from './vendas-sku-catalogo';
import type { Janela } from './metricas';
import { round2 } from './formato';

export const SEM_CODIGO = '';

export interface AcumuladorSku {
  unidades: number; unidadesComCusto: number; pedidos: number;
  bruto: number; liquido: number; imposto: number;
  brutoComCusto: number; liquidoComCusto: number; custo: number; brutoCustoReal: number;
  itensComCusto: number; itensSemCusto: number; itensEstimados: number;
  canceladas: number; pedidosBaseDevolucao: number; pedidosDevolvidos: number;
}

export type FonteCusto = 'real' | 'estimado' | 'parcial' | 'sem_custo';

export interface MetricasSku {
  lucro: number | null;
  lucroPorUnidade: number | null;
  markup: number | null;
  margemSVenda: number | null;
  /** Preço médio unitário (bruto ÷ unidades). */
  ticket: number;
  taxaDevolucao: number | null;
  fonteCusto: FonteCusto;
}

export interface LinhaSku {
  codigo: string;
  titulo: string | null;
  imagemPath: string | null;
  codigoPai: string | null;
  nomeFamilia: string | null;
  fornecedor: string | null;
  origem: 'nacional' | 'importado' | null;
  ehKit: boolean;
  estoque: number | null;
  primeiraVenda: string | null;
  acc: AcumuladorSku;
  m: MetricasSku;
  pedidoChaves: string[];
}

const vazio = (): AcumuladorSku => ({
  unidades: 0, unidadesComCusto: 0, pedidos: 0, bruto: 0, liquido: 0, imposto: 0,
  brutoComCusto: 0, liquidoComCusto: 0, custo: 0, brutoCustoReal: 0,
  itensComCusto: 0, itensSemCusto: 0, itensEstimados: 0,
  canceladas: 0, pedidosBaseDevolucao: 0, pedidosDevolvidos: 0,
});

export function somarAcumuladores(accs: AcumuladorSku[]): AcumuladorSku {
  const t = vazio();
  for (const a of accs) for (const k of Object.keys(t) as (keyof AcumuladorSku)[]) t[k] += a[k];
  return t;
}

export function dentroDaJanela(data: string | null, j: Janela): boolean {
  if (!data) return false;
  const t = Date.parse(data);
  return t >= Date.parse(j.desde) && t <= Date.parse(j.ate);
}

export function metricas(a: AcumuladorSku): MetricasSku {
  const lucro = a.itensComCusto > 0 ? round2(a.liquidoComCusto - a.custo) : null;
  const fonteCusto: FonteCusto =
    a.itensSemCusto > 0 ? (a.itensComCusto > 0 ? 'parcial' : 'sem_custo')
      : a.itensEstimados > 0 ? 'estimado' : 'real';
  return {
    lucro,
    lucroPorUnidade: lucro != null && a.unidadesComCusto > 0 ? round2(lucro / a.unidadesComCusto) : null,
    markup: lucro != null && a.custo > 0 ? lucro / a.custo : null,
    margemSVenda: lucro != null && a.brutoComCusto > 0 ? lucro / a.brutoComCusto : null,
    ticket: a.unidades > 0 ? round2(a.bruto / a.unidades) : 0,
    taxaDevolucao: a.pedidosBaseDevolucao > 0 ? a.pedidosDevolvidos / a.pedidosBaseDevolucao : null,
    fonteCusto,
  };
}

interface Grupo {
  acc: AcumuladorSku; ordens: Set<number>; base: Set<number>; devolvidos: Set<number>;
  chaves: Set<string>; titulo: string | null; imagem: string | null;
}

export function agregarPorSku(pedidos: Pedido[], janela: Janela, catalogo: Map<string, CatalogoSku>): LinhaSku[] {
  const grupos = new Map<string, Grupo>();
  for (const p of pedidos) {
    if (!dentroDaJanela(p.data, janela)) continue;
    for (const it of p.itens) {
      const codigo = it.codigo?.trim() || SEM_CODIGO;
      let g = grupos.get(codigo);
      if (!g) {
        g = { acc: vazio(), ordens: new Set(), base: new Set(), devolvidos: new Set(), chaves: new Set(), titulo: null, imagem: null };
        grupos.set(codigo, g);
      }
      const a = g.acc;
      const valor = it.unit_price * it.quantity;
      g.chaves.add(p.chave);
      g.titulo ??= it.titulo;
      g.imagem ??= it.imagem_path;
      if (it.faturavel) {
        a.unidades += it.quantity;
        a.bruto += valor;
        a.liquido += it.liquido;
        a.imposto += it.imposto;
        g.ordens.add(it.orderId);
        if (it.custo != null) {
          a.itensComCusto += 1;
          a.unidadesComCusto += it.quantity;
          a.custo += it.custo;
          a.liquidoComCusto += it.liquido;
          a.brutoComCusto += valor;
          if (it.custoEstimado) a.itensEstimados += 1; else a.brutoCustoReal += valor;
        } else {
          a.itensSemCusto += 1;
        }
      } else if (!it.temDevolucao) {
        a.canceladas += it.quantity;
      }
      if (it.faturavel || it.temDevolucao) g.base.add(it.orderId);
      if (it.temDevolucao) g.devolvidos.add(it.orderId);
    }
  }
  const linhas: LinhaSku[] = [];
  for (const [codigo, g] of grupos) {
    g.acc.pedidos = g.ordens.size;
    g.acc.pedidosBaseDevolucao = g.base.size;
    g.acc.pedidosDevolvidos = g.devolvidos.size;
    const cat = codigo === SEM_CODIGO ? undefined : catalogo.get(codigo);
    linhas.push({
      codigo,
      titulo: cat?.nome ?? g.titulo,
      imagemPath: g.imagem,
      codigoPai: cat?.codigoPai ?? null,
      nomeFamilia: cat?.nomeFamilia ?? null,
      fornecedor: cat?.fornecedor ?? null,
      origem: cat?.origem ?? null,
      ehKit: cat?.ehKit ?? false,
      estoque: cat ? cat.estoque : null,
      primeiraVenda: cat?.primeiraVenda ?? null,
      acc: g.acc,
      m: metricas(g.acc),
      pedidoChaves: [...g.chaves],
    });
  }
  return linhas;
}
```

- [ ] **Step 4: Run** `pnpm vitest run tests/lib/vendas-sku.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add src/lib/vendas-sku.ts tests/lib/vendas-sku.test.ts
/usr/bin/git commit -m "feat(vendas-sku): agregação por código com lucro por item e soma batendo com a aba Vendas"
```

---

### Task 4: Tendência, cobertura e alertas

**Files:**
- Modify: `src/lib/vendas-sku.ts`
- Test: `tests/lib/vendas-sku.test.ts`

**Interfaces:**
- Produces:
  - `LIMITES` (constante abaixo)
  - `type Tendencia = 'novo' | 'em_alta' | 'em_queda' | 'estavel' | 'parado' | 'baixo_giro'`
  - `unidadesPorCodigo(pedidos: Pedido[], j: Janela): Map<string, number>`
  - `classificarTendencia(u30: number, uAnt: number, primeiraVenda: string | null, fimMs: number): Tendencia`
  - `type Cobertura = number | null | 'compartilhado'`
  - `coberturaDias(estoque: number | null, u30: number, ehKit: boolean): Cobertura`
  - `type Alerta = 'lucro_negativo' | 'cobertura_baixa' | 'devolucao_alta' | 'sem_custo'`
  - `alertasSku(l: LinhaSku, cobertura: Cobertura): Alerta[]`

- [ ] **Step 1: Write the failing tests.** Acrescentar `classificarTendencia, coberturaDias, alertasSku, unidadesPorCodigo, metricas, somarAcumuladores` ao `import ... from '@/lib/vendas-sku'` do topo de `tests/lib/vendas-sku.test.ts` (import no meio do arquivo é erro de sintaxe) e anexar no fim:

```ts
const DIA = 86_400_000;
const FIM = Date.parse('2026-09-30T23:59:59.999Z');

describe('classificarTendencia', () => {
  it('precedência: novo > parado > baixo giro > alta/queda/estável', () => {
    expect(classificarTendencia(10, 0, new Date(FIM - 10 * DIA).toISOString(), FIM)).toBe('novo');
    expect(classificarTendencia(0, 8, '2026-06-01T00:00:00Z', FIM)).toBe('parado');
    expect(classificarTendencia(2, 1, '2026-06-01T00:00:00Z', FIM)).toBe('baixo_giro'); // 2 vs 1 não é "+100%"
    expect(classificarTendencia(12, 10, '2026-06-01T00:00:00Z', FIM)).toBe('em_alta');  // +20%
    expect(classificarTendencia(8, 10, '2026-06-01T00:00:00Z', FIM)).toBe('em_queda');  // −20%
    expect(classificarTendencia(11, 10, '2026-06-01T00:00:00Z', FIM)).toBe('estavel');
    expect(classificarTendencia(6, 0, '2026-06-01T00:00:00Z', FIM)).toBe('em_alta');    // voltou a vender
  });
});

describe('coberturaDias', () => {
  it('estoque ÷ média diária dos últimos 30 dias', () => {
    expect(coberturaDias(30, 60, false)).toBe(15); // 2/dia
  });
  it('kit vinculado → compartilhado; sem venda → null (não infinito)', () => {
    expect(coberturaDias(30, 60, true)).toBe('compartilhado');
    expect(coberturaDias(30, 0, false)).toBeNull();
  });
});

describe('alertasSku', () => {
  it('devolução alta só com ≥ 20 pedidos; lucro negativo; cobertura baixa; sem custo', () => {
    const base = somarAcumuladores([]);
    const l = (over: Partial<typeof base>) => {
      const acc = { ...base, ...over };
      return { acc, m: metricas(acc) } as unknown as Parameters<typeof alertasSku>[0];
    };
    expect(alertasSku(l({ pedidosBaseDevolucao: 19, pedidosDevolvidos: 5 }), null)).toEqual([]);
    expect(alertasSku(l({ pedidosBaseDevolucao: 20, pedidosDevolvidos: 2 }), null)).toEqual(['devolucao_alta']);
    expect(alertasSku(l({ itensComCusto: 1, liquidoComCusto: 5, custo: 8 }), 10)).toEqual(['lucro_negativo', 'cobertura_baixa']);
    expect(alertasSku(l({ itensSemCusto: 1 }), 'compartilhado')).toEqual(['sem_custo']);
  });
});

describe('unidadesPorCodigo', () => {
  it('soma só itens faturáveis dentro da janela', () => {
    const pedidos = agruparPorPedido([
      venda({ id: 'a', order_id: 1, itens: [item({ codigo: 'A', quantity: 2 })] }),
      venda({ id: 'b', order_id: 2, status: 'cancelled', itens: [item({ codigo: 'A', quantity: 5 })] }),
    ]);
    expect(unidadesPorCodigo(pedidos, SET).get('A')).toBe(2);
  });
});
```

- [ ] **Step 2: Run** → FAIL (funções inexistentes).

- [ ] **Step 3: Implement** (anexar a `src/lib/vendas-sku.ts`)

```ts
/** Limites fixos da v1 (ADR-0172 D-7) — recalibrar com dado real, sem tela de configuração. */
export const LIMITES = {
  janelaTendenciaDias: 30,
  variacaoTendencia: 0.2,
  minUnidadesTendencia: 5,
  coberturaMinDias: 15,
  taxaDevolucaoMax: 0.05,
  minPedidosDevolucao: 20,
  abcA: 0.8,
  abcB: 0.95,
} as const;

const DIA_MS = 86_400_000;

export type Tendencia = 'novo' | 'em_alta' | 'em_queda' | 'estavel' | 'parado' | 'baixo_giro';

export function unidadesPorCodigo(pedidos: Pedido[], j: Janela): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of pedidos) {
    if (!dentroDaJanela(p.data, j)) continue;
    for (const it of p.itens) {
      if (!it.faturavel) continue;
      const c = it.codigo?.trim() || SEM_CODIGO;
      m.set(c, (m.get(c) ?? 0) + it.quantity);
    }
  }
  return m;
}

/** u30 = unidades nos 30 dias até o fim do período; uAnt = os 30 anteriores. Precedência:
 *  novo > parado > baixo giro > alta/queda/estável (glossário "Tendência do SKU"). */
export function classificarTendencia(u30: number, uAnt: number, primeiraVenda: string | null, fimMs: number): Tendencia {
  if (primeiraVenda && fimMs - Date.parse(primeiraVenda) < LIMITES.janelaTendenciaDias * DIA_MS) return 'novo';
  if (u30 === 0) return 'parado';
  if (Math.max(u30, uAnt) < LIMITES.minUnidadesTendencia) return 'baixo_giro';
  if (uAnt === 0) return 'em_alta';
  const d = (u30 - uAnt) / uAnt;
  if (d >= LIMITES.variacaoTendencia) return 'em_alta';
  if (d <= -LIMITES.variacaoTendencia) return 'em_queda';
  return 'estavel';
}

export type Cobertura = number | null | 'compartilhado';

/** Dias até acabar no ritmo dos últimos 30 dias. Kit vinculado divide o estoque com a base
 *  (ADR-0151): não tem número próprio. */
export function coberturaDias(estoque: number | null, u30: number, ehKit: boolean): Cobertura {
  if (ehKit) return 'compartilhado';
  if (estoque == null || u30 <= 0) return null;
  return Math.floor(estoque / (u30 / LIMITES.janelaTendenciaDias));
}

export type Alerta = 'lucro_negativo' | 'cobertura_baixa' | 'devolucao_alta' | 'sem_custo';

export function alertasSku(l: Pick<LinhaSku, 'acc' | 'm'>, cobertura: Cobertura): Alerta[] {
  const out: Alerta[] = [];
  if (l.m.lucro != null && l.m.lucro < 0) out.push('lucro_negativo');
  if (typeof cobertura === 'number' && cobertura < LIMITES.coberturaMinDias) out.push('cobertura_baixa');
  if (l.acc.pedidosBaseDevolucao >= LIMITES.minPedidosDevolucao && (l.m.taxaDevolucao ?? 0) > LIMITES.taxaDevolucaoMax) {
    out.push('devolucao_alta');
  }
  if (l.m.fonteCusto === 'sem_custo' || l.m.fonteCusto === 'parcial') out.push('sem_custo');
  return out;
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(vendas-sku): tendência, cobertura e alertas com limites fixos`.

---

### Task 5: KPIs, Δ, Curva ABC, variação do lucro, insights e família

**Files:**
- Modify: `src/lib/vendas-sku.ts`
- Test: `tests/lib/vendas-sku.test.ts`

**Interfaces:**
- Produces:
  - `interface KpisSku { bruto: number; lucro: number | null; markup: number | null; margemSVenda: number | null; unidades: number; skusComVenda: number; skusVendaUnica: number; concentracaoTop5: number | null; pctBrutoCustoReal: number | null; prejuizo: number }`
  - `calcularKpisSku(linhas: LinhaSku[]): KpisSku`
  - `interface Delta { texto: string; tendencia: 'up' | 'down' | 'neutral' }` (compatível com `DeltaTrend` do `KpiCard`)
  - `deltaValor(atual: number | null, anterior: number | null, fmt: (n: number) => string): Delta | null`
  - `deltaPp(atual: number | null, anterior: number | null): Delta | null`
  - `type ClasseAbc = 'A' | 'B' | 'C' | 'D'`; `curvaAbc(linhas: LinhaSku[], base: 'lucro' | 'bruto'): Map<string, ClasseAbc>`
  - `interface VariacaoLucro { codigo: string; titulo: string | null; delta: number; situacao: 'entrou' | 'saiu' | 'mudou' }`; `explicarVariacao(atual: LinhaSku[], anterior: LinhaSku[], n?: number): VariacaoLucro[]`
  - `gerarInsights(p: { linhas: LinhaSku[]; variacoes: VariacaoLucro[]; coberturaBaixa: number; parados: number }): string[]`
  - `interface LinhaFamilia { codigoPai: string; nomeFamilia: string | null; acc: AcumuladorSku; m: MetricasSku; filhos: LinhaSku[] }`; `agruparPorFamilia(linhas: LinhaSku[]): LinhaFamilia[]`

- [ ] **Step 1: Write the failing tests.** Acrescentar `calcularKpisSku, deltaValor, deltaPp, curvaAbc, explicarVariacao, gerarInsights, agruparPorFamilia, type LinhaSku` ao `import ... from '@/lib/vendas-sku'` do topo e anexar no fim:

```ts
function linha(codigo: string, lucro: number | null, bruto = 100, extra: Partial<LinhaSku> = {}): LinhaSku {
  const acc = somarAcumuladores([]);
  acc.bruto = bruto; acc.unidades = 1; acc.pedidos = 1; acc.brutoCustoReal = bruto;
  if (lucro != null) { acc.itensComCusto = 1; acc.unidadesComCusto = 1; acc.custo = 10; acc.liquidoComCusto = lucro + 10; acc.brutoComCusto = bruto; }
  return { codigo, titulo: codigo, imagemPath: null, codigoPai: null, nomeFamilia: null, fornecedor: null,
    origem: null, ehKit: false, estoque: null, primeiraVenda: null, acc, m: metricas(acc), pedidoChaves: [], ...extra };
}
const brl = (n: number) => `R$ ${n.toFixed(2)}`;

describe('deltas', () => {
  it('base anterior zero ou negativa → Δ em R$, não %', () => {
    expect(deltaValor(50, 0, brl)).toEqual({ texto: '+R$ 50.00', tendencia: 'up' });
    expect(deltaValor(-20, -50, brl)).toEqual({ texto: '+R$ 30.00', tendencia: 'up' });
    expect(deltaValor(120, 100, brl)).toEqual({ texto: '+20,0%', tendencia: 'up' });
    expect(deltaValor(null, 100, brl)).toBeNull();
  });
  it('percentuais variam em pontos percentuais', () => {
    expect(deltaPp(0.35, 0.3)).toEqual({ texto: '+5,0 p.p.', tendencia: 'up' });
  });
});

describe('curvaAbc por lucro', () => {
  it('só lucro positivo entra em A/B/C; prejuízo é D; sem custo fica sem classe', () => {
    const ls = [linha('a', 80), linha('b', 15), linha('c', 5), linha('d', -30), linha('e', null)];
    const abc = curvaAbc(ls, 'lucro');
    expect([abc.get('a'), abc.get('b'), abc.get('c'), abc.get('d'), abc.get('e')]).toEqual(['A', 'B', 'C', 'D', undefined]);
  });
});

describe('calcularKpisSku', () => {
  it('prejuízo total, concentração sobre lucro positivo e % do bruto com custo real', () => {
    const k = calcularKpisSku([linha('a', 80), linha('b', 20), linha('d', -30), linha('e', null)]);
    expect(k.prejuizo).toBe(-30);
    expect(k.concentracaoTop5).toBe(1);   // 100 de 100 positivos
    expect(k.skusComVenda).toBe(4);
    expect(k.pctBrutoCustoReal).toBe(1);
  });
});

describe('explicarVariacao', () => {
  it('ordena por |Δ lucro| e marca entrou/saiu', () => {
    const v = explicarVariacao([linha('a', 100), linha('n', 40)], [linha('a', 150), linha('x', 10)]);
    expect(v.map((x) => [x.codigo, x.delta, x.situacao])).toEqual([
      ['a', -50, 'mudou'], ['n', 40, 'entrou'], ['x', -10, 'saiu'],
    ]);
  });
});

describe('gerarInsights', () => {
  it('no máximo 3, e só com evidência', () => {
    expect(gerarInsights({ linhas: [linha('a', 10)], variacoes: [], coberturaBaixa: 0, parados: 0 })).toEqual([]);
    const ins = gerarInsights({ linhas: [], variacoes: [{ codigo: 'a', titulo: 'Fita', delta: -50, situacao: 'mudou' }], coberturaBaixa: 2, parados: 3 });
    expect(ins.length).toBeLessThanOrEqual(3);
    expect(ins[0]).toContain('Fita');
  });
});

describe('agruparPorFamilia', () => {
  it('soma os filhos e recalcula as razões pelo total', () => {
    const fams = agruparPorFamilia([linha('a', 10, 100, { codigoPai: 'P' }), linha('b', 30, 100, { codigoPai: 'P' })]);
    expect(fams).toHaveLength(1);
    expect(fams[0].m.lucro).toBe(40);
    expect(fams[0].m.margemSVenda).toBeCloseTo(0.2, 5);
    expect(fams[0].filhos).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** (anexar a `src/lib/vendas-sku.ts`)

```ts
export interface KpisSku {
  bruto: number; lucro: number | null; markup: number | null; margemSVenda: number | null;
  unidades: number; skusComVenda: number; skusVendaUnica: number;
  concentracaoTop5: number | null; pctBrutoCustoReal: number | null; prejuizo: number;
}

export function calcularKpisSku(linhas: LinhaSku[]): KpisSku {
  const total = somarAcumuladores(linhas.map((l) => l.acc));
  const m = metricas(total);
  const positivos = linhas.map((l) => l.m.lucro ?? 0).filter((v) => v > 0).sort((a, b) => b - a);
  const somaPos = positivos.reduce((s, v) => s + v, 0);
  const comVenda = linhas.filter((l) => l.codigo !== SEM_CODIGO && l.acc.unidades > 0);
  return {
    bruto: round2(total.bruto),
    lucro: m.lucro,
    markup: m.markup,
    margemSVenda: m.margemSVenda,
    unidades: total.unidades,
    skusComVenda: comVenda.length,
    skusVendaUnica: comVenda.filter((l) => l.acc.pedidos === 1).length,
    concentracaoTop5: somaPos > 0 ? positivos.slice(0, 5).reduce((s, v) => s + v, 0) / somaPos : null,
    pctBrutoCustoReal: total.bruto > 0 ? total.brutoCustoReal / total.bruto : null,
    prejuizo: round2(linhas.reduce((s, l) => s + (l.m.lucro != null && l.m.lucro < 0 ? l.m.lucro : 0), 0)),
  };
}

export interface Delta { texto: string; tendencia: 'up' | 'down' | 'neutral' }

// Mesmo sinal de menos (U+2212) no Δ% e no Δ em R$.
const pct1 = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n * 100).toFixed(1).replace('.', ',')}`;
const tend = (d: number): Delta['tendencia'] => (d > 0 ? 'up' : d < 0 ? 'down' : 'neutral');

/** Δ% quando a base anterior é positiva; senão Δ em R$ (base zero/negativa não tem % honesto). */
export function deltaValor(atual: number | null, anterior: number | null, fmt: (n: number) => string): Delta | null {
  if (atual == null || anterior == null) return null;
  const d = atual - anterior;
  if (anterior > 0) return { texto: `${pct1(d / anterior)}%`, tendencia: tend(d) };
  return { texto: `${d >= 0 ? '+' : '−'}${fmt(Math.abs(d))}`, tendencia: tend(d) };
}

/** Markup e Margem s/ venda variam em pontos percentuais. */
export function deltaPp(atual: number | null, anterior: number | null): Delta | null {
  if (atual == null || anterior == null) return null;
  const d = atual - anterior;
  return { texto: `${pct1(d)} p.p.`, tendencia: tend(d) };
}

export type ClasseAbc = 'A' | 'B' | 'C' | 'D';

/** A até 80% acumulado, B até 95%, C o resto — acumulado ANTES do item, então o 1º é sempre A.
 *  Por lucro: só lucro positivo entra; prejuízo = D; sem custo fica sem classe. */
export function curvaAbc(linhas: LinhaSku[], base: 'lucro' | 'bruto'): Map<string, ClasseAbc> {
  const valor = (l: LinhaSku) => (base === 'lucro' ? l.m.lucro : l.acc.bruto);
  const out = new Map<string, ClasseAbc>();
  const pos = linhas.filter((l) => (valor(l) ?? 0) > 0).sort((a, b) => valor(b)! - valor(a)!);
  const total = pos.reduce((s, l) => s + valor(l)!, 0);
  let acum = 0;
  for (const l of pos) {
    const share = acum / total;
    out.set(l.codigo, share < LIMITES.abcA ? 'A' : share < LIMITES.abcB ? 'B' : 'C');
    acum += valor(l)!;
  }
  if (base === 'lucro') for (const l of linhas) if (l.m.lucro != null && l.m.lucro < 0) out.set(l.codigo, 'D');
  return out;
}

export interface VariacaoLucro { codigo: string; titulo: string | null; delta: number; situacao: 'entrou' | 'saiu' | 'mudou' }

/** Quem explica a variação do lucro, em R$. Só SKUs com lucro calculado em algum dos períodos. */
export function explicarVariacao(atual: LinhaSku[], anterior: LinhaSku[], n = 5): VariacaoLucro[] {
  const ant = new Map(anterior.map((l) => [l.codigo, l]));
  const at = new Map(atual.map((l) => [l.codigo, l]));
  const out: VariacaoLucro[] = [];
  for (const codigo of new Set([...at.keys(), ...ant.keys()])) {
    const a = at.get(codigo); const b = ant.get(codigo);
    if (a?.m.lucro == null && b?.m.lucro == null) continue;
    const delta = round2((a?.m.lucro ?? 0) - (b?.m.lucro ?? 0));
    if (delta === 0) continue;
    out.push({ codigo, titulo: (a ?? b)!.titulo, delta, situacao: !b ? 'entrou' : !a ? 'saiu' : 'mudou' });
  }
  return out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, n);
}

const fmtBRL0 = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** 0 a 3 frases, só quando a evidência existe. */
export function gerarInsights(p: { linhas: LinhaSku[]; variacoes: VariacaoLucro[]; coberturaBaixa: number; parados: number }): string[] {
  const out: string[] = [];
  const pos = p.linhas.map((l) => l.m.lucro ?? 0).filter((v) => v > 0).sort((a, b) => b - a);
  if (pos.length >= 5) {
    const metade = pos.reduce((s, v) => s + v, 0) / 2;
    let acum = 0; let k = 0;
    while (acum < metade) acum += pos[k++];
    if (k <= Math.ceil(pos.length * 0.2)) out.push(`${k} ${k === 1 ? 'SKU faz' : 'SKUs fazem'} metade do lucro do período.`);
  }
  const queda = p.variacoes.find((v) => v.delta < 0 && v.situacao !== 'entrou');
  if (queda) out.push(`${queda.titulo ?? queda.codigo} tirou ${fmtBRL0(-queda.delta)} do lucro contra o período anterior.`);
  if (p.coberturaBaixa > 0) out.push(`${p.coberturaBaixa} ${p.coberturaBaixa === 1 ? 'SKU tem' : 'SKUs têm'} estoque para menos de ${LIMITES.coberturaMinDias} dias.`);
  if (p.parados > 0) out.push(`${p.parados} ${p.parados === 1 ? 'SKU parou' : 'SKUs pararam'} de vender há mais de ${LIMITES.janelaTendenciaDias} dias.`);
  return out.slice(0, 3);
}

export interface LinhaFamilia { codigoPai: string; nomeFamilia: string | null; acc: AcumuladorSku; m: MetricasSku; filhos: LinhaSku[] }

export function agruparPorFamilia(linhas: LinhaSku[]): LinhaFamilia[] {
  const g = new Map<string, LinhaSku[]>();
  for (const l of linhas) {
    const k = l.codigoPai ?? `sem-familia:${l.codigo}`;
    g.set(k, [...(g.get(k) ?? []), l]);
  }
  return [...g].map(([codigoPai, filhos]) => {
    const acc = somarAcumuladores(filhos.map((f) => f.acc));
    return { codigoPai, nomeFamilia: filhos[0].nomeFamilia, acc, m: metricas(acc), filhos };
  });
}
```

- [ ] **Step 4: Run** → PASS (ajustar só o formato de moeda esperado no teste se `fmt` diferir — o teste passa `brl` próprio).
- [ ] **Step 5: Commit** — `feat(vendas-sku): KPIs, deltas, curva ABC por lucro, variação e insights`.

---

### Task 6: Montagem por período + hook `useVendasSku`

**Files:**
- Modify: `src/lib/vendas-sku.ts`
- Create: `src/hooks/useVendasSku.ts`
- Test: `tests/lib/vendas-sku.test.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1-5; `Venda` (`src/lib/faturamento.ts`); `useVendas`, `useCustos`, `useFotosProduto`, `useCoresProduto`, `useAnuncioCanonico`, `useAliquotas`, `useDevolucoes`, `useCatalogoVendasSku`; `resolverJanela`, `janelaAnterior`.
- Produces:
  - `janelaEstendida(atual: Janela, anterior: Janela): Janela`: cobre o período anterior e os 60 dias da tendência.
  - `interface VendasSku { linhas: LinhaSku[]; linhasAnterior: LinhaSku[]; kpis: KpisSku; kpisAnterior: KpisSku; tendencias: Map<string, Tendencia>; coberturas: Map<string, Cobertura>; alertas: Map<string, Alerta[]>; variacoes: VariacaoLucro[]; insights: string[]; parados: number; devolucoesNaoAtribuidas: number; historicoDesde: string | null }`
  - `montarVendasSku(p: { vendas: Venda[]; agrupar: (vs: Venda[]) => Pedido[]; janela: Janela; anterior: Janela; catalogo: Map<string, CatalogoSku>; devolucoes: Devolucao[] }): VendasSku`
  - `useVendasSku(periodo: Periodo): { dados: VendasSku | null; isLoading: boolean; isFetching: boolean; refetch: () => void }`

**Regra central (achado da revisão Grok):** cada recorte (período, anterior, 30 dias, 30 anteriores) filtra as **vendas** por `date_closed` **antes** de chamar `agruparPorPedido`. É exatamente o que a aba Vendas faz: ela só carrega a janela, então um pack com uma order dentro e outra fora fica dividido. Agrupar a janela estendida inteira e depois cortar por `Pedido.data` juntaria as duas orders num período só e mudaria o rateio de frete.

- [ ] **Step 1: Write the failing tests.** Acrescentar `janelaEstendida, montarVendasSku` ao `import ... from '@/lib/vendas-sku'` do topo e anexar:

```ts
describe('janelaEstendida', () => {
  it('começa no menor entre o início do anterior e fim − 60 dias', () => {
    const atual = { desde: '2026-09-24T00:00:00.000Z', ate: '2026-09-30T23:59:59.999Z' };
    const ant = { desde: '2026-09-17T00:00:00.000Z', ate: '2026-09-24T00:00:00.000Z' };
    expect(janelaEstendida(atual, ant)).toEqual({ desde: new Date(Date.parse(atual.ate) - 60 * DIA).toISOString(), ate: atual.ate });
  });
});

describe('montarVendasSku', () => {
  const ANT = { desde: '2026-08-01T00:00:00.000Z', ate: '2026-08-31T23:59:59.999Z' };
  const agrupar = (vs: Venda[]) => agruparPorPedido(vs);

  it('ranking usa só o período; tendência usa os 60 dias até o fim; parados só com estoque', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, date_closed: '2026-09-10T12:00:00Z', itens: [item({ codigo: 'A', quantity: 6 })] }),
      venda({ id: 'b', order_id: 2, date_closed: '2026-08-10T12:00:00Z', itens: [item({ codigo: 'A', quantity: 5 })] }),
    ];
    const z = { codigo: 'Z', codigoPai: null, nomeFamilia: null, nome: 'Parado', cor: null, tamanho: null,
      estoque: 3, fornecedor: null, origem: null, ehKit: false, primeiraVenda: '2026-05-01T00:00:00Z', ultimaVenda: '2026-07-01T00:00:00Z' };
    const semEstoque = { ...z, codigo: 'Y', estoque: 0 };
    const r = montarVendasSku({ vendas, agrupar, janela: SET, anterior: ANT,
      catalogo: new Map([['Z', z], ['Y', semEstoque]]), devolucoes: [] });
    expect(r.linhas.map((l) => [l.codigo, l.acc.unidades])).toEqual([['A', 6]]);
    expect(r.linhasAnterior.map((l) => [l.codigo, l.acc.unidades])).toEqual([['A', 5]]);
    expect(r.tendencias.get('A')).toBe('em_alta');  // 6 vs 5 = +20%
    expect(r.parados).toBe(1);                       // Y tem estoque 0: não conta
    expect(r.historicoDesde).toBe('2026-05-01T00:00:00Z');
  });

  it('pack com uma order em agosto e outra em setembro é dividido, igual à aba Vendas', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: 77, date_closed: '2026-08-31T20:00:00Z', itens: [item({ codigo: 'A' })] }),
      venda({ id: 'b', order_id: 2, pack_id: 77, date_closed: '2026-09-01T10:00:00Z', itens: [item({ codigo: 'B' })] }),
    ];
    const r = montarVendasSku({ vendas, agrupar, janela: SET, anterior: ANT, catalogo: new Map(), devolucoes: [] });
    expect(r.linhas.map((l) => l.codigo)).toEqual(['B']);
    expect(r.linhasAnterior.map((l) => l.codigo)).toEqual(['A']);
    const kpisVendasSet = calcularKpisPedidos(agrupar(vendas.filter((v) => v.date_closed! >= SET.desde)));
    expect(r.kpis.bruto).toBe(kpisVendasSet.bruto);
  });

  it('devolução sem pedido conhecido conta como não atribuída', () => {
    const dev = [{ id: 'd', claim_id: 1, order_id: null, stage: null, status: 'closed', type: null, reason_texto: null,
      valor_em_jogo: null, return_status: null, return_status_money: null, acoes_pendentes: null,
      aberto_em: '2026-09-05T00:00:00Z', fechado_em: '2026-09-06T00:00:00Z' }];
    const r = montarVendasSku({ vendas: [], agrupar, janela: SET, anterior: SET, catalogo: new Map(), devolucoes: dev });
    expect(r.devolucoesNaoAtribuidas).toBe(1);
  });
});
```

(`Venda` já está importado no topo do arquivo desde a Task 3.)

- [ ] **Step 2: Run** `pnpm vitest run tests/lib/vendas-sku.test.ts` → FAIL (`montarVendasSku is not a function`).

- [ ] **Step 3: Implement.** No topo de `src/lib/vendas-sku.ts`, acrescentar `import type { Venda } from './faturamento';` e `import { dataNoPeriodo, type Devolucao } from './devolucoes';`. Anexar:

```ts
export function janelaEstendida(atual: Janela, anterior: Janela): Janela {
  const fim = Date.parse(atual.ate);
  const inicio = Math.min(Date.parse(anterior.desde), fim - 2 * LIMITES.janelaTendenciaDias * DIA_MS);
  return { desde: new Date(inicio).toISOString(), ate: atual.ate };
}

export interface VendasSku {
  linhas: LinhaSku[]; linhasAnterior: LinhaSku[];
  kpis: KpisSku; kpisAnterior: KpisSku;
  tendencias: Map<string, Tendencia>; coberturas: Map<string, Cobertura>; alertas: Map<string, Alerta[]>;
  variacoes: VariacaoLucro[]; insights: string[]; parados: number; devolucoesNaoAtribuidas: number;
  /** Primeira venda faturável registrada na org (ADR-0172 D-2): a tela diz desde quando conta. */
  historicoDesde: string | null;
}

export function montarVendasSku(p: {
  vendas: Venda[]; agrupar: (vs: Venda[]) => Pedido[]; janela: Janela; anterior: Janela;
  catalogo: Map<string, CatalogoSku>; devolucoes: Devolucao[];
}): VendasSku {
  // Recorta as VENDAS pela data antes de agrupar, como a aba Vendas (que só carrega a janela).
  const recorte = (j: Janela) => p.agrupar(p.vendas.filter((v) => dentroDaJanela(v.date_closed, j)));
  const fim = Date.parse(p.janela.ate);
  const j30 = { desde: new Date(fim - LIMITES.janelaTendenciaDias * DIA_MS).toISOString(), ate: p.janela.ate };
  const jAnt = {
    desde: new Date(fim - 2 * LIMITES.janelaTendenciaDias * DIA_MS).toISOString(),
    ate: new Date(fim - LIMITES.janelaTendenciaDias * DIA_MS - 1).toISOString(),
  };
  const linhas = agregarPorSku(recorte(p.janela), p.janela, p.catalogo)
    .sort((a, b) => (b.m.lucro ?? -Infinity) - (a.m.lucro ?? -Infinity) || a.codigo.localeCompare(b.codigo));
  const linhasAnterior = agregarPorSku(recorte(p.anterior), p.anterior, p.catalogo);
  const u30 = unidadesPorCodigo(recorte(j30), j30);
  const uAnt = unidadesPorCodigo(recorte(jAnt), jAnt);

  const tendencias = new Map<string, Tendencia>();
  const coberturas = new Map<string, Cobertura>();
  const alertas = new Map<string, Alerta[]>();
  for (const l of linhas) {
    if (l.codigo === SEM_CODIGO) continue;
    tendencias.set(l.codigo, classificarTendencia(u30.get(l.codigo) ?? 0, uAnt.get(l.codigo) ?? 0, l.primeiraVenda, fim));
    const cob = coberturaDias(l.estoque, u30.get(l.codigo) ?? 0, l.ehKit);
    coberturas.set(l.codigo, cob);
    alertas.set(l.codigo, alertasSku(l, cob));
  }
  // ponytail: "parado" = SKU do catálogo com estoque > 0 cuja última venda faturável é anterior aos
  // 30 dias até o fim do período (estoque parado é o que importa). Não vê SKU fora do catálogo.
  let parados = 0;
  let historicoDesde: string | null = null;
  for (const c of p.catalogo.values()) {
    if (c.estoque > 0 && c.ultimaVenda && Date.parse(c.ultimaVenda) < Date.parse(j30.desde)) parados += 1;
    if (c.primeiraVenda && (historicoDesde == null || Date.parse(c.primeiraVenda) < Date.parse(historicoDesde))) historicoDesde = c.primeiraVenda;
  }
  const variacoes = explicarVariacao(linhas, linhasAnterior);
  const coberturaBaixa = [...alertas.values()].filter((a) => a.includes('cobertura_baixa')).length;
  // ponytail: devolução "não atribuída" = claim do período sem pedido carregado na janela estendida.
  // Um claim de venda mais antiga que a janela também cai aqui; é um teto conhecido.
  const orderIds = new Set(p.vendas.map((v) => v.order_id));
  const devolucoesNaoAtribuidas = p.devolucoes.filter((d) =>
    dentroDaJanela(dataNoPeriodo(d), p.janela) && (d.order_id == null || !orderIds.has(d.order_id))).length;
  return {
    linhas, linhasAnterior,
    kpis: calcularKpisSku(linhas), kpisAnterior: calcularKpisSku(linhasAnterior),
    tendencias, coberturas, alertas, variacoes,
    insights: gerarInsights({ linhas, variacoes, coberturaBaixa, parados }),
    parados, devolucoesNaoAtribuidas, historicoDesde,
  };
}
```

`src/hooks/useVendasSku.ts`:

```ts
import { useMemo } from 'react';
import { resolverJanela, janelaAnterior, type Periodo } from '@/lib/metricas';
import { useVendas } from '@/hooks/useVendas';
import { useCustos } from '@/hooks/useCustos';
import { useFotosProduto } from '@/hooks/useFotosProduto';
import { useCoresProduto } from '@/hooks/useCoresProduto';
import { useAnuncioCanonico } from '@/hooks/useAnuncioCanonico';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import { useDevolucoes } from '@/hooks/useDevolucoes';
import { useCatalogoVendasSku } from '@/hooks/useCatalogoVendasSku';
import { montarCustoResolver, montarPesoResolver, montarAliquotaResolver } from '@/lib/custos';
import { montarFotoResolver } from '@/lib/fotos-produto';
import { montarCorResolver } from '@/lib/cor-produto';
import { agruparPorPedido } from '@/lib/pedidos-faturamento';
import type { Venda } from '@/lib/faturamento';
import { janelaEstendida, montarVendasSku, type VendasSku } from '@/lib/vendas-sku';

/** Mesmos resolvers e mesma fonte da aba Vendas (aba-vendas.tsx:173-190): é isso que faz a soma bater. */
export function useVendasSku(periodo: Periodo) {
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);
  const anterior = useMemo(() => janelaAnterior(janela, periodo), [janela, periodo]);
  const estendida = useMemo(() => janelaEstendida(janela, anterior), [janela, anterior]);
  const vendasQ = useVendas(estendida, 'todos');
  const { data: custos } = useCustos();
  const { data: fotos } = useFotosProduto();
  const { data: cores } = useCoresProduto();
  const { data: canonico } = useAnuncioCanonico();
  const { data: aliquotas } = useAliquotas();
  const { data: devolucoes } = useDevolucoes();
  const catQ = useCatalogoVendasSku();

  const dados = useMemo<VendasSku | null>(() => {
    if (!vendasQ.data || !catQ.data) return null;
    const custoR = montarCustoResolver(custos);
    const pesoR = montarPesoResolver(custos);
    const fotoR = montarFotoResolver(fotos, canonico);
    const aliqR = montarAliquotaResolver(custos, aliquotas ?? { nacional: 8, importado: 16 });
    const corR = montarCorResolver(cores, canonico);
    return montarVendasSku({
      vendas: vendasQ.data,
      agrupar: (vs: Venda[]) => agruparPorPedido(vs, custoR, pesoR, fotoR, aliqR, corR),
      janela, anterior,
      catalogo: new Map(catQ.data.map((c) => [c.codigo, c])),
      devolucoes: devolucoes ?? [],
    });
  }, [vendasQ.data, catQ.data, custos, fotos, cores, canonico, aliquotas, devolucoes, janela, anterior]);

  return { dados, isLoading: vendasQ.isLoading || catQ.isLoading, isFetching: vendasQ.isFetching, refetch: vendasQ.refetch };
}
```

- [ ] **Step 4: Run** `pnpm vitest run tests/lib/vendas-sku.test.ts` → PASS; `pnpm preflight:static` → verde.
- [ ] **Step 5: Commit**: `feat(vendas-sku): montagem por período (recorte antes de agrupar) e hook useVendasSku`.

---

### Task 7: UI da aba Vendas SKU

> Tela nova dentro de um produto que já existe: seguir o visual das outras abas (KpiCard, Table, StatusPill, ThumbProduto). Invocar `frontend-design` em modo "system work" antes de estilizar.

**Files:**
- Create: `src/components/faturamento/ranking-sku.tsx`
- Create: `src/components/faturamento/aba-vendas-sku.tsx`
- Modify: `src/lib/kpi-descriptions.ts` (entradas `::vendas-sku`)
- Modify: `src/pages/Faturamento.tsx` (`ABAS` ~l.18, `TabsList` ~l.56-74, `TabsContent` ~l.76-80)
- Test: `src/components/faturamento/__tests__/aba-vendas-sku.test.tsx`

**Interfaces:**
- Consumes: `useVendasSku`, `VendasSku`, `LinhaSku`, `LinhaFamilia`, `agruparPorFamilia`, `curvaAbc`, `deltaValor`, `deltaPp`, `LIMITES`, `SEM_CODIGO`; `fmtBRL`, `fmtInt`, `fmtMarkup` de `@/lib/formato`; `ThumbProduto` de `@/components/faturamento/pilha-thumbs`; `rotuloAnterior`, `resolverJanela` de `@/lib/metricas`; `normalizarParaBusca` de `@/lib/texto`.
- Produces: `AbaVendasSku(): JSX.Element`; `RankingSku(props: RankingSkuProps): JSX.Element`; `type ChaveOrdem = 'lucro' | 'bruto' | 'unidades' | 'lucroPorUnidade'`.

- [ ] **Step 1: Write the failing test.** Criar `src/components/faturamento/__tests__/aba-vendas-sku.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AbaVendasSku } from '@/components/faturamento/aba-vendas-sku';
import { metricas, somarAcumuladores, type LinhaSku, type VendasSku } from '@/lib/vendas-sku';

function linha(codigo: string, lucro: number | null, over: { semCusto?: boolean; parcial?: boolean; codigoPai?: string } = {}): LinhaSku {
  const acc = somarAcumuladores([]);
  acc.bruto = 100; acc.unidades = 2; acc.pedidos = 2; acc.liquido = 80;
  if (lucro != null) { acc.itensComCusto = 1; acc.unidadesComCusto = 2; acc.custo = 80 - lucro; acc.liquidoComCusto = 80; acc.brutoComCusto = 100; acc.brutoCustoReal = 100; }
  if (over.semCusto || over.parcial) acc.itensSemCusto = 1;
  return { codigo, titulo: `Produto ${codigo}`, imagemPath: null, codigoPai: over.codigoPai ?? 'P', nomeFamilia: 'Família P',
    fornecedor: null, origem: null, ehKit: false, estoque: 10, primeiraVenda: null, acc, m: metricas(acc), pedidoChaves: ['1'] };
}
const kz = { bruto: 0, lucro: null, markup: null, margemSVenda: null, unidades: 0, skusComVenda: 0, skusVendaUnica: 0, concentracaoTop5: null, pctBrutoCustoReal: null, prejuizo: 0 };
const dados: VendasSku = {
  linhas: [linha('A', 30), linha('C', 10), linha('B', null, { semCusto: true }), linha('D', 5, { parcial: true })],
  linhasAnterior: [],
  kpis: { bruto: 400, lucro: 45, markup: 0.6, margemSVenda: 0.3, unidades: 8, skusComVenda: 4, skusVendaUnica: 0, concentracaoTop5: 1, pctBrutoCustoReal: 0.5, prejuizo: 0 },
  kpisAnterior: kz,
  tendencias: new Map([['A', 'em_alta']]), coberturas: new Map(), alertas: new Map([['B', ['sem_custo']]]),
  variacoes: [], insights: ['1 SKU faz metade do lucro do período.'], parados: 0, devolucoesNaoAtribuidas: 0,
  historicoDesde: '2026-06-02T12:00:00Z',
};
vi.mock('@/hooks/useVendasSku', () => ({ useVendasSku: () => ({ dados, isLoading: false, isFetching: false, refetch: vi.fn() }) }));

const renderAba = () => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter><AbaVendasSku /></MemoryRouter></QueryClientProvider>,
);

describe('AbaVendasSku', () => {
  it('faixa separa sem custo de lucro parcial; rótulos Markup e Margem s/ venda; histórico com data', () => {
    renderAba();
    expect(screen.getByText(/1 SKU sem custo/i)).toBeInTheDocument();
    expect(screen.getByText(/1 com lucro parcial/i)).toBeInTheDocument();
    expect(screen.getAllByText('Markup').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Margem s/ venda').length).toBeGreaterThan(0);
    expect(screen.getByText(/Histórico desde 02\/06\/2026/)).toBeInTheDocument();
  });

  it('ordena por lucro e troca a ordem ao clicar em Unidades', () => {
    renderAba();
    const nomes = () => screen.getAllByTestId('sku-titulo').map((e) => e.textContent);
    expect(nomes()[0]).toBe('Produto A');
    fireEvent.click(screen.getByRole('button', { name: /Unidades/ }));
    expect(nomes()).toHaveLength(4);
  });

  it('agrupar por família mostra a família e, ao expandir, as variações', () => {
    renderAba();
    fireEvent.click(screen.getByRole('button', { name: 'Agrupar por família' }));
    expect(screen.getByText(/Família P \(4 variações\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Família P \(4 variações\)/));
    expect(screen.getAllByTestId('sku-titulo').map((e) => e.textContent)).toContain('Produto A');
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/components/faturamento/__tests__/aba-vendas-sku.test.tsx` → FAIL (módulo inexistente).

- [ ] **Step 3: Descrições dos KPIs.** Em `src/lib/kpi-descriptions.ts`, antes do fechamento de `KPI_DESCRIPTIONS`:

```ts
  // ── Faturamento / aba Vendas SKU (ADR-0172): lucro por ITEM, não por pedido ──
  'Lucro::vendas-sku':
    'Soma, por item vendido, do líquido (já sem comissão, frete e imposto) menos o custo. Só entram itens com custo; item sem custo não entra como lucro.',
  'Markup::vendas-sku':
    'Lucro ÷ custo, somando item a item. Mede o retorno sobre a compra. Só itens com custo.',
  'Margem s/ venda::vendas-sku':
    'Lucro ÷ preço de venda dos itens com custo. Mede a saúde do preço.',
  'Faturamento com custo real::vendas-sku':
    'Quanto do faturamento tem custo congelado na venda. O resto usa o custo atual do cadastro (custo estimado) ou não tem custo.',
```

- [ ] **Step 4: Implement `ranking-sku.tsx`**

```tsx
import { Fragment, useState } from 'react';
import { ArrowDown, ChevronDown, ChevronRight } from 'lucide-react';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { ThumbProduto } from '@/components/faturamento/pilha-thumbs';
import { fmtBRL, fmtInt, fmtMarkup } from '@/lib/formato';
import {
  SEM_CODIGO, type LinhaSku, type LinhaFamilia, type Tendencia, type Alerta, type Cobertura, type ClasseAbc, type FonteCusto,
} from '@/lib/vendas-sku';

export type ChaveOrdem = 'lucro' | 'bruto' | 'unidades' | 'lucroPorUnidade';

const TENDENCIA: Record<Tendencia, { label: string; tom: StatusTone; dica: string }> = {
  novo: { label: 'Novo', tom: 'info', dica: '1ª venda há menos de 30 dias' },
  em_alta: { label: 'Em alta', tom: 'success', dica: '+20% ou mais em unidades: últimos 30 dias contra os 30 anteriores' },
  em_queda: { label: 'Em queda', tom: 'danger', dica: '−20% ou menos em unidades: últimos 30 dias contra os 30 anteriores' },
  estavel: { label: 'Estável', tom: 'neutral', dica: 'Entre −20% e +20%' },
  parado: { label: 'Parado', tom: 'warning', dica: 'Já vendeu; nenhuma venda nos últimos 30 dias' },
  baixo_giro: { label: 'Baixo giro', tom: 'neutral', dica: 'Menos de 5 unidades nas duas janelas de 30 dias' },
};
const ALERTA: Record<Alerta, string> = {
  lucro_negativo: 'Lucro negativo', cobertura_baixa: 'Estoque < 15 dias',
  devolucao_alta: 'Devolução > 5%', sem_custo: 'Sem custo',
};
const FONTE: Partial<Record<FonteCusto, string>> = { estimado: 'custo estimado', parcial: 'lucro parcial', sem_custo: 'sem custo' };
const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1).replace('.', ',')}%`);

export interface RankingSkuProps {
  /** Variações soltas ou famílias (quando agrupado). */
  linhas: LinhaSku[];
  familias: LinhaFamilia[] | null;
  tendencias: Map<string, Tendencia>;
  coberturas: Map<string, Cobertura>;
  alertas: Map<string, Alerta[]>;
  abc: Map<string, ClasseAbc>;
  ordem: ChaveOrdem;
  onOrdem: (k: ChaveOrdem) => void;
}

function Cabecalho({ rot, k, ordem, onOrdem }: { rot: string; k: ChaveOrdem; ordem: ChaveOrdem; onOrdem: (k: ChaveOrdem) => void }) {
  return (
    <TableHead className="text-right">
      <button type="button" onClick={() => onOrdem(k)} className="inline-flex items-center gap-1 font-medium">
        {rot}{ordem === k && <ArrowDown className="h-3 w-3" aria-hidden />}
      </button>
    </TableHead>
  );
}

function Celulas({ l, abc, t, alertas, cob }: {
  l: LinhaSku; abc?: ClasseAbc; t?: Tendencia; alertas: Alerta[]; cob?: Cobertura;
}) {
  return (
    <>
      <TableCell className="text-right tabular-nums">{fmtInt(l.acc.unidades)}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtBRL(l.acc.bruto)}</TableCell>
      <TableCell className="text-right tabular-nums">{l.m.lucro == null ? '—' : fmtBRL(l.m.lucro)}</TableCell>
      <TableCell className="text-right tabular-nums">{l.m.lucroPorUnidade == null ? '—' : fmtBRL(l.m.lucroPorUnidade)}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtMarkup(l.m.markup)}</TableCell>
      <TableCell className="text-right tabular-nums">{pct(l.m.margemSVenda)}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtBRL(l.m.ticket)}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtInt(l.acc.canceladas)}</TableCell>
      <TableCell className="text-right tabular-nums">{pct(l.m.taxaDevolucao)}</TableCell>
      <TableCell>{abc ?? '—'}</TableCell>
      <TableCell>{t && <span title={TENDENCIA[t].dica}><StatusPill tone={TENDENCIA[t].tom}>{TENDENCIA[t].label}</StatusPill></span>}</TableCell>
      <TableCell className="space-x-1 whitespace-nowrap">
        {alertas.map((a) => <StatusPill key={a} tone={a === 'lucro_negativo' || a === 'sem_custo' ? 'danger' : 'warning'}>{ALERTA[a]}</StatusPill>)}
        {cob === 'compartilhado' && <span className="text-xs text-muted-foreground">estoque compartilhado com a base</span>}
      </TableCell>
    </>
  );
}

function Nome({ l, recuo = false }: { l: LinhaSku; recuo?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${recuo ? 'pl-6' : ''}`}>
      <ThumbProduto path={l.imagemPath} titulo={l.titulo} size={32} />
      <div>
        <div className="font-medium" data-testid="sku-titulo">{l.titulo ?? '—'}</div>
        <div className="text-xs text-muted-foreground">
          {l.codigo === SEM_CODIGO ? 'sem código' : l.codigo}
          {FONTE[l.m.fonteCusto] && <> · <span className="text-warning">{FONTE[l.m.fonteCusto]}</span></>}
        </div>
      </div>
    </div>
  );
}

/** Bruto → comissão + frete → imposto → líquido → custo → lucro. Comissão e frete vêm juntos: o item
 *  só carrega o líquido rateado (agruparPorPedido). */
function ContaDaLinha({ l }: { l: LinhaSku }) {
  const a = l.acc;
  const passos: [string, number | null][] = [
    ['Faturamento', a.bruto], ['Comissão + frete', -(a.bruto - a.liquido - a.imposto)], ['Imposto', -a.imposto],
    ['Líquido', a.liquido], ['Custo (itens com custo)', a.itensComCusto > 0 ? -a.custo : null], ['Lucro', l.m.lucro],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {passos.map(([rot, v]) => (
        <span key={rot}><span className="text-muted-foreground">{rot}:</span> <span className="tabular-nums">{v == null ? '—' : fmtBRL(v)}</span></span>
      ))}
      <span className="text-muted-foreground">· {l.pedidoChaves.length} pedidos</span>
    </div>
  );
}

export function RankingSku({ linhas, familias, tendencias, coberturas, alertas, abc, ordem, onOrdem }: RankingSkuProps) {
  const [aberto, setAberto] = useState<string | null>(null);
  const alternar = (k: string) => setAberto((a) => (a === k ? null : k));
  const linhaVariacao = (l: LinhaSku, recuo = false) => {
    const exp = aberto === `v:${l.codigo}`;
    return (
      <Fragment key={`v:${l.codigo || 'sem-codigo'}`}>
        <TableRow className="cursor-pointer" onClick={() => alternar(`v:${l.codigo}`)}>
          <TableCell>{exp ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
          <TableCell className="min-w-64"><Nome l={l} recuo={recuo} /></TableCell>
          <Celulas l={l} abc={recuo ? undefined : abc.get(l.codigo)} t={tendencias.get(l.codigo)}
            alertas={alertas.get(l.codigo) ?? []} cob={coberturas.get(l.codigo)} />
        </TableRow>
        {exp && (
          <TableRow><TableCell /><TableCell colSpan={13} className="bg-muted/40 text-sm"><ContaDaLinha l={l} /></TableCell></TableRow>
        )}
      </Fragment>
    );
  };
  return (
    <Table containerClassName="rounded-lg border">
      <TableHeader>
        <TableRow>
          <TableHead className="w-6" />
          <TableHead>SKU</TableHead>
          <Cabecalho rot="Unidades" k="unidades" ordem={ordem} onOrdem={onOrdem} />
          <Cabecalho rot="Faturamento" k="bruto" ordem={ordem} onOrdem={onOrdem} />
          <Cabecalho rot="Lucro" k="lucro" ordem={ordem} onOrdem={onOrdem} />
          <Cabecalho rot="Lucro/un." k="lucroPorUnidade" ordem={ordem} onOrdem={onOrdem} />
          <TableHead className="text-right">Markup</TableHead>
          <TableHead className="text-right">Margem s/ venda</TableHead>
          <TableHead className="text-right">Preço médio</TableHead>
          <TableHead className="text-right">Canceladas</TableHead>
          <TableHead className="text-right">Devolução</TableHead>
          <TableHead>ABC</TableHead>
          <TableHead>Tendência</TableHead>
          <TableHead>Alertas</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {familias == null
          ? linhas.map((l) => linhaVariacao(l))
          : familias.map((f) => {
            const exp = aberto === `f:${f.codigoPai}`;
            const soma: LinhaSku = {
              ...f.filhos[0], codigo: f.codigoPai, titulo: `${f.nomeFamilia ?? f.codigoPai} (${f.filhos.length} ${f.filhos.length === 1 ? 'variação' : 'variações'})`,
              acc: f.acc, m: f.m, pedidoChaves: [...new Set(f.filhos.flatMap((x) => x.pedidoChaves))],
            };
            const piores = [...new Set(f.filhos.flatMap((x) => alertas.get(x.codigo) ?? []))];
            return (
              <Fragment key={`f:${f.codigoPai}`}>
                <TableRow className="cursor-pointer bg-muted/20" onClick={() => alternar(`f:${f.codigoPai}`)}>
                  <TableCell>{exp ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                  <TableCell className="min-w-64">
                    <div className="font-medium">{soma.titulo}</div>
                    <div className="text-xs text-muted-foreground">{f.codigoPai.startsWith('sem-familia:') ? 'sem família' : f.codigoPai}</div>
                  </TableCell>
                  <Celulas l={soma} abc={abc.get(f.codigoPai)} alertas={piores} />
                </TableRow>
                {exp && f.filhos.map((x) => linhaVariacao(x, true))}
              </Fragment>
            );
          })}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 5: Implement `aba-vendas-sku.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { AlertTriangle, DollarSign, Package, Percent, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KpiCard } from '@/components/ui/kpi-card';
import { fmtBRL, fmtInt, fmtMarkup } from '@/lib/formato';
import { rotuloAnterior, type Periodo, type PeriodoDias } from '@/lib/metricas';
import { normalizarParaBusca } from '@/lib/texto';
import { useVendasSku } from '@/hooks/useVendasSku';
import { RankingSku, type ChaveOrdem } from '@/components/faturamento/ranking-sku';
import { agruparPorFamilia, curvaAbc, deltaPp, deltaValor, type Delta, type LinhaSku } from '@/lib/vendas-sku';

const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1).replace('.', ',')}%`);
const comDelta = (d: Delta | null, rot: string) => (d ? { delta: `${d.texto} ${rot}`, deltaTrend: d.tendencia } : {});
const valorOrdem = (l: LinhaSku, k: ChaveOrdem): number =>
  k === 'lucro' ? l.m.lucro ?? -Infinity : k === 'lucroPorUnidade' ? l.m.lucroPorUnidade ?? -Infinity
    : k === 'bruto' ? l.acc.bruto : l.acc.unidades;

export function AbaVendasSku() {
  const [periodo, setPeriodo] = useState<Periodo>({ tipo: 'preset', dias: 30 });
  const [custom, setCustom] = useState({ desde: '', ate: '' });
  const [busca, setBusca] = useState('');
  const [familia, setFamilia] = useState('');
  const [fornecedor, setFornecedor] = useState('');
  const [origem, setOrigem] = useState<'' | 'nacional' | 'importado'>('');
  const [soSemCusto, setSoSemCusto] = useState(false);
  const [porFamilia, setPorFamilia] = useState(false);
  const [baseAbc, setBaseAbc] = useState<'lucro' | 'bruto'>('lucro');
  const [ordem, setOrdem] = useState<ChaveOrdem>('lucro');
  const { dados, isLoading } = useVendasSku(periodo);

  const opcoes = useMemo(() => {
    const ls = dados?.linhas ?? [];
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
    return { familias: uniq(ls.map((l) => l.nomeFamilia)), fornecedores: uniq(ls.map((l) => l.fornecedor)) };
  }, [dados]);
  const filtradas = useMemo(() => {
    const q = normalizarParaBusca(busca);
    return (dados?.linhas ?? [])
      .filter((l) =>
        (!q || normalizarParaBusca(`${l.codigo} ${l.titulo ?? ''} ${l.nomeFamilia ?? ''}`).includes(q))
        && (!familia || l.nomeFamilia === familia)
        && (!fornecedor || l.fornecedor === fornecedor)
        && (!origem || l.origem === origem)
        && (!soSemCusto || l.m.fonteCusto === 'sem_custo' || l.m.fonteCusto === 'parcial'))
      .sort((a, b) => valorOrdem(b, ordem) - valorOrdem(a, ordem) || a.codigo.localeCompare(b.codigo));
  }, [dados, busca, familia, fornecedor, origem, soSemCusto, ordem]);
  const familias = useMemo(() => (porFamilia
    ? agruparPorFamilia(filtradas).sort((a, b) => (b.m.lucro ?? -Infinity) - (a.m.lucro ?? -Infinity))
    : null), [filtradas, porFamilia]);
  // ABC na linha que a tabela mostra: família quando agrupado, variação quando não.
  const abc = useMemo(() => curvaAbc(
    familias ? familias.map((f) => ({ ...f.filhos[0], codigo: f.codigoPai, acc: f.acc, m: f.m })) : filtradas, baseAbc,
  ), [familias, filtradas, baseAbc]);

  if (isLoading || !dados) return <p className="text-sm text-muted-foreground">Carregando vendas por SKU…</p>;
  const { kpis, kpisAnterior: ka } = dados;
  const rot = rotuloAnterior(periodo);
  const semCusto = dados.linhas.filter((l) => l.m.fonteCusto === 'sem_custo');
  const parciais = dados.linhas.filter((l) => l.m.fonteCusto === 'parcial');
  const brutoSemCusto = [...semCusto, ...parciais].reduce((s, l) => s + l.acc.bruto - l.acc.brutoComCusto, 0);
  const customValido = !!custom.desde && !!custom.ate && custom.desde <= custom.ate;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={periodo.tipo === 'hoje' ? 'default' : 'outline'} onClick={() => setPeriodo({ tipo: 'hoje' })}>Hoje</Button>
        {([7, 30, 90] as PeriodoDias[]).map((d) => (
          <Button key={d} size="sm" variant={periodo.tipo === 'preset' && periodo.dias === d ? 'default' : 'outline'}
            onClick={() => setPeriodo({ tipo: 'preset', dias: d })}>{d} dias</Button>
        ))}
        <Button size="sm" variant={periodo.tipo === 'mes_atual' ? 'default' : 'outline'} onClick={() => setPeriodo({ tipo: 'mes_atual' })}>Mês atual</Button>
        <Input type="date" className="w-40" aria-label="De" value={custom.desde} onChange={(e) => setCustom((c) => ({ ...c, desde: e.target.value }))} />
        <Input type="date" className="w-40" aria-label="Até" value={custom.ate} onChange={(e) => setCustom((c) => ({ ...c, ate: e.target.value }))} />
        <Button size="sm" variant={periodo.tipo === 'range' ? 'default' : 'outline'} disabled={!customValido}
          onClick={() => setPeriodo({ tipo: 'range', desde: custom.desde, ate: custom.ate })}>Aplicar</Button>
      </div>

      {(semCusto.length > 0 || parciais.length > 0) && (
        <button type="button" onClick={() => setSoSemCusto(true)}
          className="flex w-full items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-left text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span>
            {semCusto.length > 0 && <>{semCusto.length} {semCusto.length === 1 ? 'SKU sem custo' : 'SKUs sem custo'}</>}
            {semCusto.length > 0 && parciais.length > 0 && ' · '}
            {parciais.length > 0 && <>{parciais.length} com lucro parcial</>}
            {' · '}{fmtBRL(brutoSemCusto)} de faturamento sem lucro calculado. Todo produto tem que ter custo.
          </span>
        </button>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard size="compact" icon={DollarSign} label="Faturamento" value={fmtBRL(kpis.bruto)} {...comDelta(deltaValor(kpis.bruto, ka.bruto, fmtBRL), rot)} />
        <KpiCard size="compact" icon={TrendingUp} label="Lucro" infoKey="Lucro::vendas-sku" value={kpis.lucro == null ? '—' : fmtBRL(kpis.lucro)}
          {...comDelta(deltaValor(kpis.lucro, ka.lucro, fmtBRL), rot)} />
        <KpiCard size="compact" icon={Percent} label="Markup" infoKey="Markup::vendas-sku" value={fmtMarkup(kpis.markup)} {...comDelta(deltaPp(kpis.markup, ka.markup), rot)} />
        <KpiCard size="compact" icon={Percent} label="Margem s/ venda" infoKey="Margem s/ venda::vendas-sku" value={pct(kpis.margemSVenda)}
          {...comDelta(deltaPp(kpis.margemSVenda, ka.margemSVenda), rot)} />
        <KpiCard size="compact" icon={Package} label="Unidades" value={fmtInt(kpis.unidades)} {...comDelta(deltaValor(kpis.unidades, ka.unidades, fmtInt), rot)} />
        <KpiCard size="compact" label="SKUs com venda" value={fmtInt(kpis.skusComVenda)} hint={`${kpis.skusVendaUnica} venderam 1 vez`} />
        <KpiCard size="compact" label="Concentração top 5" value={pct(kpis.concentracaoTop5)} hint="do lucro positivo" />
        <KpiCard size="compact" label="Faturamento com custo real" infoKey="Faturamento com custo real::vendas-sku" value={pct(kpis.pctBrutoCustoReal)}
          hint={kpis.prejuizo < 0 ? `SKUs com prejuízo: ${fmtBRL(kpis.prejuizo)}` : undefined} />
      </div>

      {dados.insights.length > 0 && (
        <ul className="space-y-1 rounded-lg border p-3 text-sm">{dados.insights.map((t) => <li key={t}>• {t}</li>)}</ul>
      )}

      {dados.variacoes.length > 0 && (
        <div className="rounded-lg border p-3 text-sm">
          <div className="mb-1 font-medium">Quem explica a variação do lucro ({rot})</div>
          <ul className="space-y-0.5">{dados.variacoes.map((v) => (
            <li key={v.codigo} className="flex justify-between gap-2">
              <span>{v.titulo ?? v.codigo}{v.situacao === 'entrou' ? ' (entrou)' : v.situacao === 'saiu' ? ' (deixou de vender)' : ''}</span>
              <span className={v.delta < 0 ? 'text-destructive tabular-nums' : 'text-success tabular-nums'}>{v.delta > 0 ? '+' : '−'}{fmtBRL(Math.abs(v.delta))}</span>
            </li>
          ))}</ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-56" placeholder="Buscar código ou produto" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={familia} onChange={(e) => setFamilia(e.target.value)} aria-label="Família">
          <option value="">Todas as famílias</option>
          {opcoes.familias.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} aria-label="Fornecedor">
          <option value="">Todos os fornecedores</option>
          {opcoes.fornecedores.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={origem} onChange={(e) => setOrigem(e.target.value as typeof origem)} aria-label="Origem">
          <option value="">Nacional e importado</option>
          <option value="nacional">Nacional</option>
          <option value="importado">Importado</option>
        </select>
        <Button size="sm" variant={soSemCusto ? 'default' : 'outline'} onClick={() => setSoSemCusto((v) => !v)}>Só sem custo</Button>
        <Button size="sm" variant={porFamilia ? 'default' : 'outline'} onClick={() => setPorFamilia((v) => !v)}>Agrupar por família</Button>
        <Button size="sm" variant="outline" onClick={() => setBaseAbc((b) => (b === 'lucro' ? 'bruto' : 'lucro'))}>
          Curva ABC por {baseAbc === 'lucro' ? 'lucro' : 'faturamento'}
        </Button>
      </div>

      <RankingSku linhas={filtradas} familias={familias} tendencias={dados.tendencias} coberturas={dados.coberturas}
        alertas={dados.alertas} abc={abc} ordem={ordem} onOrdem={setOrdem} />
      {dados.devolucoesNaoAtribuidas > 0 && (
        <p className="text-xs text-muted-foreground">{dados.devolucoesNaoAtribuidas} devoluções do período não chegam a um SKU (carrinho ou envio sem pedido).</p>
      )}
      <p className="text-xs text-muted-foreground">
        {dados.historicoDesde
          ? `Histórico desde ${new Date(dados.historicoDesde).toLocaleDateString('pt-BR')}, quando a organização começou a vender pelo PubliAI.`
          : 'Histórico desde a entrada da organização no PubliAI.'}
      </p>
    </div>
  );
}
```

`Delta` precisa estar exportado de `vendas-sku.ts` (já está na Task 5).

- [ ] **Step 6: Register tab** em `src/pages/Faturamento.tsx`:
  - `const ABAS = ['vendas', 'sku', 'devolucoes', 'perguntas', 'mensagens', 'geografia'] as const;`
  - Depois do `TabsTrigger value="vendas"`: `<TabsTrigger value="sku"><Boxes className="h-4 w-4" />Vendas SKU</TabsTrigger>` (importar `Boxes` de `lucide-react`).
  - Depois do `TabsContent value="vendas"`: `<TabsContent value="sku" className="mt-4"><AbaVendasSku /></TabsContent>` (importar de `@/components/faturamento/aba-vendas-sku`).

- [ ] **Step 7: Run** `pnpm vitest run src/components/faturamento/__tests__/aba-vendas-sku.test.tsx` → PASS; `pnpm preflight:static` → verde.
- [ ] **Step 8: Commit**: `feat(vendas-sku): aba Vendas SKU em Faturamento`.

---

### Task 8: Migration em produção, validação real e docs

- [ ] **Step 1: Suíte completa** — `pnpm test` (todas as 571+ files verdes) e `pnpm preflight` (portão completo, ~3min37).
- [ ] **Step 2: Paridade tela contra tela** — na mesma sessão e no mesmo período fechado (Personalizado, ex.: 01/09/2026 a 25/09/2026), anotar Faturamento e Unidades da aba **Vendas** e da aba **Vendas SKU**: têm que ser iguais. Opcional, como conferência extra read-only: a mesma soma pela Management API com o período em horário de Brasília explícito (`'2026-09-01T00:00:00-03:00'` a `'2026-09-25T23:59:59.999-03:00'`), nunca data sem hora.
- [ ] **Step 3: Validação visual** — skill `playwright-cli`, sessão isolada (`-s=val`), app local no worktree (copiar `.env.local` antes), login `VALIDATION_EMAIL`/`VALIDATION_PASSWORD`; abrir `/faturamento?aba=sku`; screenshot real em 1440px e 390px (bug de breakpoint não aparece em snapshot); conferir faixa "sem custo", KPIs com Δ, ranking, "a conta" expandida, agrupar por família, ABC por lucro/faturamento. Conta VALIDATION não tem os produtos da Avil → injetar dados com `playwright-cli route` se a tela ficar vazia.
- [ ] **Step 4: Docs** — seguir a skill `docs-update-checklist`: `docs/project-status.md` (aba nova), `docs/reference/glossario.md` (precedência da Tendência: novo > parado > baixo giro > alta/queda/estável; "baixo giro" = menos de 5 unidades nas duas janelas), ADR-0172 status "Aceito", `obsidian-vault/` conforme o checklist.
- [ ] **Step 5: Revisão final do diff** (Fable, regra de merge) e só então: push → CI verde (`frontend`, `backend-lint`) → **`supabase db push`** (migration nova — o CI não deploya) → conferir `select proname from pg_proc where proname='vendas_sku_catalogo'` em produção → merge fast-forward → deletar branch e worktree.
