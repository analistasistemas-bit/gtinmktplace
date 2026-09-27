# Vendas SKU — Fatia 2a (Dossiê do SKU) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página de dossiê por SKU (`/faturamento/sku/:codigo`) e por família (`/faturamento/sku/familia/:codigoPai`): histórico observado desde a 1ª venda, série semanal/mensal em BRT (unidades, faturamento, lucro, preço vendido), eventos com vínculo declarado, estoque/cobertura, devoluções, UFs, mix das irmãs e situação atual nas campanhas.

**Architecture:** Nenhuma fórmula nova de dinheiro. Uma RPC de **seleção** devolve os ids das vendas que contêm o(s) código(s) **mais os membros dos mesmos packs/envios**; o navegador busca essas vendas com o mesmo `select` de `buscarVendas`, roda `agruparPorPedido` com os mesmos resolvers e só então separa os itens do SKU (ADR-0172 D-5). A série reaproveita `agregarPorSku` por intervalo (recorte das vendas por `date_closed` antes de agrupar, como a Fatia 1). Uma segunda RPC devolve, por MLB, quais códigos ele atende — base da classificação "SKU exato / anúncio compartilhado". Eventos vêm de tabelas com RLS por org (leitura direta).

**Tech Stack:** React 18 + TS, TanStack Query v5, recharts, Tailwind v4 + shadcn/ui, Vitest (TZ fixo `America/Sao_Paulo`), Supabase Postgres (RPC `security definer` + `current_org_id()`).

**Spec:** `docs/superpowers/specs/2026-09-26-vendas-sku-design.md` (seção "Fatia 2a", revisada pelo GPT-6 Astra) · ADR-0172 · glossário "Vendas SKU".

## Global Constraints

- Contrato: **histórico observado, com cobertura explícita**; nunca "história completa". Toda fonte parcial aparece como parcial.
- Dinheiro: só via `agruparPorPedido` + `agregarPorSku`/`metricas` (Fatia 1). Nunca somar taxas nem coberturas; percentuais recalculados do total.
- Recorte: cada intervalo filtra as **vendas** por `date_closed` antes de `agruparPorPedido`.
- Devolução = claim `type === 'returns'` (`orderIdsComDevolucaoReal`), a mesma da Fatia 1.
- Calendário BRT fixo (UTC−03:00, sem horário de verão desde 2019): semana começa na **segunda**, mês civil; intervalos meio-abertos `[inicio, fim)`; o intervalo corrente é marcado `incompleto`.
- Preço vendido = média ponderada por quantidade dos itens faturáveis do SKU no intervalo, com mín./máx.; intervalo sem venda → `null`.
- Tendência e cobertura = posição **de hoje** ("posição em dd/mm"); série e KPIs seguem o período escolhido.
- `exato` = o MLB atende só este código; `compartilhado` = 2+ códigos. Claim sem pedido → não entra no dossiê do SKU.
- Promoção: bloco **Situação atual nas campanhas** (status + última sincronização); nunca "data de adesão".
- Kit vinculado: saldo = `floor(estoque_base / N)` (conta copiada, não importar `_shared/estoque/kit.ts`, que usa `jsr:`); cobertura "estoque compartilhado", sem dias.
- Família = composição **atual** do catálogo, incluindo irmãs sem venda; pedidos contados por order.
- RPCs novas: `security definer`, `set search_path = ''`, `public.current_org_id()`, `revoke all ... from public, anon`, `grant execute ... to authenticated`; migrations só via `supabase migration new` (sem `db push` nesta fatia — Ruling 2 da Fatia 1).
- RPC com argumento devolve **um valor único** (`uuid[]`/`jsonb`) e é chamada por POST (padrão `.rpc(fn, args)`), sem depender de Range — o mesmo truque de valor escalar de `platform_org_cost_catalog` contra o teto de 1.000 linhas. Tabelas por `buscarTodasPaginas`; colunas explícitas, nunca `raw`.
- Vínculo de evento por MLB: `exato`, `compartilhado` ou `nao_resolvido` (MLB fora do mapa).
- UI: skill `frontend-design-fable5` em modo system work; tooltip do recharts com tokens (`var(--popover)`, `var(--border)`, `var(--popover-foreground)`), nunca caixa branca no escuro; português com acentos.

## Review Focus

1. **Pack com o SKU e outro produto** → frete e líquido do SKU no dossiê iguais aos da aba Vendas/ranking para o mesmo período (a RPC traz os irmãos do pack). Task 3.
2. **Semana cruzando meia-noite de domingo BRT** (ex.: venda 2026-09-21T02:30Z = domingo 23:30 BRT) → cai na semana que começa na segunda 14/09, não na de 21/09. Task 4.
3. **MLB legado com 3 cores** → moderação/pergunta desse MLB aparecem como "anúncio compartilhado" no dossiê de cada cor, e uma vez só no da família. Task 5.
4. **SKU cadastrado sem vendas** → dossiê abre com "sem vendas registradas", sem tendência nem idade, estoque do catálogo; nunca tela quebrada. Task 7.
5. **Kit vinculado** → estoque `floor(base/N)`, cobertura "estoque compartilhado". Task 2 + Task 7.

---

> Revisão do plano: Grok 4.7 xhigh (via Cursor), 2026-09-27 — "pronto com ajustes"; achados incorporados.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/hooks/useVendasSku.ts` (modificar) | esperar/tratar `useDevolucoes` (pendência da Fatia 1) |
| `src/lib/pedidos-faturamento.ts` (modificar) | `ItemPedido.uf` (UF da order do item) |
| `supabase/migrations/<ts>_vendas_sku_dossie.sql` | índices + RPCs `vendas_sku_dossie_ids`, `vendas_sku_mlbs`; `vendas_sku_catalogo` ganha kit |
| `supabase/tests/vendas_sku_dossie.sql` | teste SQL das RPCs |
| `src/lib/faturamento.ts` (modificar) | exportar `SELECT_VENDAS`; `buscarVendasPorIds` |
| `src/lib/calendario-brt.ts` | buckets semana/mês em BRT |
| `src/lib/sku-dossie.ts` | série, UFs, eventos, mix, estados — lógica pura |
| `src/lib/sku-dossie-dados.ts` | fetch de ids, MLBs, movimentos, moderação, perguntas, promoções |
| `src/hooks/useSkuDossie.ts` | junta tudo |
| `src/pages/SkuDossie.tsx` + `src/components/sku-dossie/*` | a página (SKU e família) |
| `src/App.tsx`, `src/components/faturamento/ranking-sku.tsx` (modificar) | rotas e link do ranking |

---

### Task 1: `useVendasSku` espera e trata as devoluções + `ItemPedido.uf`

**Files:** Modify `src/hooks/useVendasSku.ts`, `src/lib/pedidos-faturamento.ts`, `src/components/faturamento/aba-vendas-sku.tsx` (só se precisar do novo estado); Test `src/hooks/__tests__/useVendasSku.test.ts`, `tests/lib/pedidos-faturamento.test.ts`.

**Interfaces — Produces:** `ItemPedido.uf: string | null`; `ItemPedido.dentroDeKit: boolean` (`venda.kit_item_id != null` — só rótulo, nenhum cálculo de dinheiro usa); `useVendasSku` retorna `dados = null` enquanto `useDevolucoes` carrega; `isError` inclui erro de devoluções.

- [ ] **Step 1: Failing tests.**
  - `src/hooks/__tests__/useVendasSku.test.ts` (seguir o padrão já existente no arquivo): (a) devoluções ainda carregando → `dados === null` e `isLoading === true`; (b) devoluções com erro → `isError === true` (a taxa não pode ser calculada com lista vazia em silêncio).
  - `tests/lib/pedidos-faturamento.test.ts`: pack com 2 orders de UFs diferentes → cada item carrega a UF da sua order:

```ts
describe('uf por item', () => {
  it('cada item carrega a UF da própria order', () => {
    const [p] = agruparPorPedido([
      venda({ id: 'a', order_id: 1, pack_id: 9, uf: 'SP', itens: [item({ id: 'i1' })] }),
      venda({ id: 'b', order_id: 2, pack_id: 9, uf: 'RJ', itens: [item({ id: 'i2' })] }),
    ]);
    expect(p.itens.map((x) => [x.id, x.uf])).toEqual([['i1', 'SP'], ['i2', 'RJ']]);
  });
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - Em `useVendasSku`: guardar a query `const devQ = useDevolucoes()`; no `useMemo`, `if (!vendasQ.data || !catQ.data || (!custos && !custosQ.isError) || !devQ.data) return null;`; `isLoading` inclui `devQ.isLoading`; `isError` = `vendasQ.isError || catQ.isError || devQ.isError`; `refetch` também refaz `devQ`.
  - Em `pedidos-faturamento.ts`: `ItemPedido` ganha `/** UF da order deste item (um pack pode ter orders de UFs diferentes). */ uf: string | null;` — `itensFlat` já carrega `uf: v.uf`; incluir `uf` e `dentroDeKit: v.kit_item_id != null` no objeto do item (acrescentar `kitItemId` ao objeto de `itensFlat`). Teste: item de order com `kit_item_id` → `dentroDeKit: true`. Completar fixtures de `ItemPedido` que o typecheck apontar com `uf: null, dentroDeKit: false`.
- [ ] **Step 4: Run** focados + `pnpm preflight:static` + `pnpm test`.
- [ ] **Step 5: Commit** `fix(vendas-sku): espera as devoluções e item carrega a UF da order`.

---

### Task 2: RPCs de seleção e de vínculo MLB + kit no catálogo

> Migration → Opus. Rodar SQL local via `docker exec -i -e PGPASSWORD=postgres supabase_db_txvncrgkoynoxwopfkbp psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < arquivo.sql`.

**Files:** Create `supabase/migrations/<ts>_vendas_sku_dossie.sql` (`supabase migration new vendas_sku_dossie`), `supabase/tests/vendas_sku_dossie.sql`; Modify `src/lib/database.types.ts`, `src/lib/vendas-sku-catalogo.ts`, `tests/lib/vendas-sku-catalogo.test.ts`.

**Interfaces — Produces:**
- RPC `vendas_sku_dossie_ids(p_codigos text[]) returns uuid[]` (valor único, ordenado) — vendas da org que contêm algum código + todas as vendas dos mesmos `pack_id`/`shipping_id`.
- RPC `vendas_sku_mlbs(p_codigos text[]) returns jsonb` (valor único: `{ "MLB1": ["A","B"], ... }`) — para cada MLB ligado aos códigos, todos os códigos que ele atende: vendas, `anuncios_externos_itens.sku`, chaves de `anuncios_externos.variacoes_externas` **e o MLB encerrado pela migração PxV** (`anuncios_externos.ml_item_id_anterior` + os SKUs de `migracao_pxv_snapshot`; conferir o nome do campo do SKU no snapshot em `supabase/functions/_shared/faturamento/anuncios-migrados.ts:39-55` e `supabase/functions/migrar-preco-por-variacao/index.ts:104-124` — é array de objetos, não chaves).
- `vendas_sku_catalogo()` passa a devolver também `kit_multiplicador int | null`, `kit_base_codigo text | null` (código da única variação da família-base canônica) e `estoque_kit int | null`; `CatalogoSku` ganha `kitMultiplicador: number | null`, `kitBaseCodigo: string | null`, `estoqueKit: number | null`.

- [ ] **Step 1: Failing SQL test** `supabase/tests/vendas_sku_dossie.sql` — copiar o cabeçalho de fixtures de `supabase/tests/vendas_sku_catalogo.sql` (2 orgs, users, profiles, lotes `'planilha'`, famílias, variações) e acrescentar:
  - org 1: venda V1 (`pack_id` 500) com item código `A`; venda V2 (mesmo `pack_id` 500) com item código `B`; venda V3 (`shipping_id` 700, sem pack) com `A`; venda V4 (`shipping_id` 700) com `C`; venda V5 com só `D`.
  - org 2: venda com código `A` e `pack_id` 500.
  - `anuncios_externos` (org 1) com `item_externo_id 'MLB1'` e `variacoes_externas '{"A":{},"B":{}}'::jsonb`; `ml_vendas_itens` de V1/V2 com `ml_item_id 'MLB1'`.
  - Família kit (org 1): `kit_base_codigo_pai` = família de `A` (estoque base 9), `kit_multiplicador 2`, variação `K1`.
  - PxV (org 1): `anuncios_externos` com `ml_item_id_anterior 'MLB9'` e `migracao_pxv_snapshot` contendo um elemento com o SKU `A` (formato real do snapshot).
  - Asserções (após `set local role authenticated` + claims do user 1): `vendas_sku_dossie_ids('{A}')` = {V1, V2, V3, V4} como `uuid[]` (nunca V5 nem a venda da org 2, mesmo com o mesmo `pack_id`); `vendas_sku_mlbs('{A}')` tem `MLB1` → `[A,B]` e `MLB9` → contém `A`; `vendas_sku_catalogo()` para `K1` tem `kit_multiplicador = 2`, `kit_base_codigo` = o código da variação da família-base **mais recente** e `estoque_kit = 4` (a base tem estoque 3 numa família antiga e 9 na nova — tem de usar a nova); como `anon`, `has_function_privilege('anon','public.vendas_sku_dossie_ids(text[])','execute')` é false.
- [ ] **Step 2: Run** → `ERROR: function public.vendas_sku_dossie_ids(text[]) does not exist`.
- [ ] **Step 3: Migration.**

```sql
-- ADR-0172 Fatia 2a: seleção para o dossiê do SKU. Não calcula dinheiro: devolve ids para o navegador
-- buscar as vendas completas e rodar agruparPorPedido (packs/envios inteiros, para o rateio de frete
-- ser o mesmo da aba Vendas).
create index if not exists ml_vendas_itens_org_codigo_idx on public.ml_vendas_itens (org_id, codigo);
create index if not exists ml_vendas_org_pack_idx on public.ml_vendas (org_id, pack_id) where pack_id is not null;
create index if not exists ml_vendas_org_shipping_idx on public.ml_vendas (org_id, shipping_id) where shipping_id is not null;

create or replace function public.vendas_sku_dossie_ids(p_codigos text[])
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  with org as (select public.current_org_id() as id),
  base as (
    select s.id, s.pack_id, s.shipping_id
    from public.ml_vendas_itens i
    join public.ml_vendas s on s.id = i.venda_id
    cross join org
    where i.org_id = org.id and s.org_id = org.id and i.codigo = any (p_codigos)
  )
  select coalesce(array_agg(distinct s.id order by s.id), '{}')
  from public.ml_vendas s
  cross join org
  where s.org_id = org.id
    and (
      s.id in (select b.id from base b)
      or s.pack_id in (select b.pack_id from base b where b.pack_id is not null)
      or s.shipping_id in (select b.shipping_id from base b where b.shipping_id is not null)
    )
$$;

create or replace function public.vendas_sku_mlbs(p_codigos text[])
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with org as (select public.current_org_id() as id),
  mlbs as (
    select i.ml_item_id as mlb from public.ml_vendas_itens i cross join org
     where i.org_id = org.id and i.codigo = any (p_codigos) and i.ml_item_id is not null
    union
    select x.item_externo_id from public.anuncios_externos_itens x cross join org
     where x.org_id = org.id and x.sku = any (p_codigos) and x.item_externo_id is not null
    union
    select a.item_externo_id from public.anuncios_externos a cross join org
     where a.org_id = org.id and a.item_externo_id is not null
       and a.variacoes_externas ?| p_codigos
    union
    -- MLB encerrado pela migração PxV (ADR-0161): SKUs vivem no snapshot (array de objetos).
    select a.ml_item_id_anterior from public.anuncios_externos a
      cross join org
      cross join lateral jsonb_array_elements(coalesce(a.migracao_pxv_snapshot, '[]'::jsonb)) as e(v)
     where a.org_id = org.id and a.ml_item_id_anterior is not null
       and (e.v ->> 'sku') = any (p_codigos) -- conferir o nome do campo no snapshot real
  ),
  pares as (
    select i.ml_item_id as mlb, i.codigo from public.ml_vendas_itens i cross join org
     where i.org_id = org.id and i.ml_item_id in (select mlb from mlbs) and coalesce(i.codigo, '') <> ''
    union
    select x.item_externo_id, x.sku from public.anuncios_externos_itens x cross join org
     where x.org_id = org.id and x.item_externo_id in (select mlb from mlbs) and coalesce(x.sku, '') <> ''
    union
    select a.item_externo_id, k.codigo from public.anuncios_externos a
      cross join org
      cross join lateral jsonb_object_keys(coalesce(a.variacoes_externas, '{}'::jsonb)) as k(codigo)
     where a.org_id = org.id and a.item_externo_id in (select mlb from mlbs)
    union
    select a.ml_item_id_anterior, e.v ->> 'sku' from public.anuncios_externos a
      cross join org
      cross join lateral jsonb_array_elements(coalesce(a.migracao_pxv_snapshot, '[]'::jsonb)) as e(v)
     where a.org_id = org.id and a.ml_item_id_anterior in (select mlb from mlbs)
       and coalesce(e.v ->> 'sku', '') <> ''
  )
  select coalesce(jsonb_object_agg(g.mlb, g.codigos), '{}'::jsonb)
  from (
    select p.mlb, to_jsonb(array_agg(distinct p.codigo order by p.codigo)) as codigos
    from pares p group by p.mlb
  ) g
$$;

revoke all on function public.vendas_sku_dossie_ids(text[]) from public, anon;
revoke all on function public.vendas_sku_mlbs(text[]) from public, anon;
grant execute on function public.vendas_sku_dossie_ids(text[]) to authenticated;
grant execute on function public.vendas_sku_mlbs(text[]) to authenticated;
```

  Recriar `vendas_sku_catalogo()` **colando o corpo exato** de `20260927024030_vendas_sku_catalogo.sql` e só então acrescentar: no `canonica`, `f.kit_base_codigo_pai, f.kit_multiplicador`; um `left join lateral` que acha a **família-base canônica** (`familias` da org com `codigo_pai = c.kit_base_codigo_pai`, `order by criado_em desc, id desc limit 1`) e as variações dela: se a contagem for exatamente 1, `kit_base_codigo` = o código dessa variação e `estoque_kit = floor(estoque / kit_multiplicador)`; se for diferente de 1, `kit_base_codigo = null` e `estoque_kit = 0` (mesma regra de `aplicarEstoqueDerivado`, `supabase/functions/_shared/estoque/kit.ts:122-128`). No JSON: `'kit_multiplicador'`, `'kit_base_codigo'`, `'estoque_kit'`. Mesmos `revoke`/`grant` da original.
- [ ] **Step 4: Aplicar local + rodar o teste** → termina em `ROLLBACK` sem `ERROR`.
- [ ] **Step 5: TS.** `database.types.ts`: `vendas_sku_dossie_ids: { Args: { p_codigos: string[] }; Returns: string[] }` e `vendas_sku_mlbs: { Args: { p_codigos: string[] }; Returns: Json }` em ordem alfabética. `mapCatalogoSku` mapeia `kit_multiplicador`/`kit_base_codigo`/`estoque_kit` (null quando ausente) + teste em `tests/lib/vendas-sku-catalogo.test.ts`. Provar a chamada real: com o Supabase local no ar, um script node (em /Users/diego/.claude/jobs/1e464c62/tmp) que faz `signInWithPassword` num usuário da fixture... — se não houver usuário local com senha, basta o teste SQL + um `curl` POST em `http://127.0.0.1:54321/rest/v1/rpc/vendas_sku_dossie_ids` com a service key local mostrando que o PostgREST aceita `{"p_codigos":["A"]}` (service_role não tem org, então a resposta esperada é `[]`).
- [ ] **Step 6:** `pnpm preflight:static`, `pnpm test`. **Commit** `feat(vendas-sku): RPCs de seleção do dossiê e vínculo MLB; kit no catálogo`.

---

### Task 3: Busca das vendas do dossiê (mesmo select, packs inteiros)

**Files:** Modify `src/lib/faturamento.ts`; Create `src/lib/sku-dossie-dados.ts`; Test `tests/lib/sku-dossie-dados.test.ts`.

**Interfaces — Produces:**
- `export const SELECT_VENDAS: string` (a string hoje inline em `buscarVendas`, sem mudar nada nela) e `buscarVendas` passa a usá-la.
- `export async function buscarVendasPorIds(ids: string[]): Promise<Venda[]>` — lotes de 80 ids com `.in('id', lote)` (o `select` + 150 uuids ficava perto de 8 KB de URL), mesmo `select`, mesmo pós-processamento (`comCustoCongelado`, remoção de `custos`) de `buscarVendas`; ordena por `date_closed desc, id`.
- `sku-dossie-dados.ts`: `buscarIdsDossie(codigos: string[]): Promise<string[]>` (`supabase.rpc('vendas_sku_dossie_ids', { p_codigos })`, valor único), `buscarMlbsDossie(codigos: string[]): Promise<Map<string, string[]>>` (`supabase.rpc('vendas_sku_mlbs', { p_codigos })` → Map).

- [ ] **Step 1: Failing tests** (mock do client supabase no padrão dos testes de `src/lib/__tests__` que já mockam `@/lib/supabase`): `buscarVendasPorIds` com 320 ids faz 4 chamadas `.in` (80×4), aplica `comCustoCongelado` e remove `custos`; `buscarIdsDossie` devolve o array; `buscarMlbsDossie` monta o Map a partir do objeto JSON.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** Extrair a string do `select` sem alterar um caractere; `buscarVendas` continua com o mesmo comportamento (testes existentes de faturamento seguem verdes).
- [ ] **Step 4:** testes + `pnpm preflight:static` + `pnpm test`. **Step 5: Commit** `feat(vendas-sku): busca das vendas do dossiê por ids com o mesmo select da aba Vendas`.

---

### Task 4: Calendário BRT e série temporal do SKU

**Files:** Create `src/lib/calendario-brt.ts`, `src/lib/sku-dossie.ts`; Test `tests/lib/calendario-brt.test.ts`, `tests/lib/sku-dossie.test.ts`.

**Interfaces — Produces:**
- `type Passo = 'semana' | 'mes'`; `interface Intervalo { inicio: string; fim: string; rotulo: string; incompleto: boolean }` (ISO; `[inicio, fim)`).
- `intervalosBRT(desde: string, ate: string, passo: Passo, agora?: Date): Intervalo[]`.
- `interface PontoSerie { intervalo: Intervalo; unidades: number; bruto: number; lucro: number | null; fonteCusto: FonteCusto; precoMedio: number | null; precoMin: number | null; precoMax: number | null }`
- `serieDoSku(p: { vendas: Venda[]; agrupar: (vs: Venda[]) => Pedido[]; codigos: string[]; intervalos: Intervalo[]; catalogo: Map<string, CatalogoSku>; ordensDevolvidas: Set<number> }): PontoSerie[]`

- [ ] **Step 1: Failing tests.**

```ts
// tests/lib/calendario-brt.test.ts
import { describe, it, expect } from 'vitest';
import { intervalosBRT } from '@/lib/calendario-brt';

describe('intervalosBRT', () => {
  it('semana começa na segunda 00:00 BRT (03:00Z) e é meio-aberta', () => {
    const iv = intervalosBRT('2026-09-14T03:00:00.000Z', '2026-09-27T02:59:59.999Z', 'semana', new Date('2026-10-01T12:00:00Z'));
    expect(iv.map((i) => [i.inicio, i.fim, i.rotulo])).toEqual([
      ['2026-09-14T03:00:00.000Z', '2026-09-21T03:00:00.000Z', '14/09'],
      ['2026-09-21T03:00:00.000Z', '2026-09-28T03:00:00.000Z', '21/09'],
    ]);
    expect(iv.every((i) => !i.incompleto)).toBe(true);
  });
  it('domingo 23:30 BRT cai na semana que começou na segunda anterior', () => {
    const iv = intervalosBRT('2026-09-21T02:30:00.000Z', '2026-09-21T02:30:00.000Z', 'semana');
    expect(iv[0].inicio).toBe('2026-09-14T03:00:00.000Z');
  });
  it('mês civil em BRT, e o mês corrente é incompleto', () => {
    const iv = intervalosBRT('2026-08-10T12:00:00.000Z', '2026-09-20T12:00:00.000Z', 'mes', new Date('2026-09-20T12:00:00Z'));
    expect(iv.map((i) => [i.inicio, i.rotulo, i.incompleto])).toEqual([
      ['2026-08-01T03:00:00.000Z', 'ago/26', false],
      ['2026-09-01T03:00:00.000Z', 'set/26', true],
    ]);
  });
});
```

```ts
// tests/lib/sku-dossie.test.ts — reutilizar os helpers item()/venda() (copiar do topo de tests/lib/vendas-sku.test.ts)
it('série: bate com agregarPorSku no mesmo intervalo; preço médio ponderado; intervalo sem venda sem preço', () => {
  // semana 1: 2 un a R$10 + 1 un a R$13 (preço médio 11, mín 10, máx 13); semana 2: nada
  // assert: unidades 3, bruto 33, precoMedio 11, precoMin 10, precoMax 13; semana 2 unidades 0 e precoMedio null
  // assert: bruto/lucro do ponto 1 = agregarPorSku(recorte do mesmo intervalo) da Fatia 1
});
it('pack com o SKU e outro produto: o SKU recebe só a fatia dele (frete rateado igual à aba Vendas)', () => { /* ... */ });
```
  O implementer escreve os valores exatos dos dois testes de série a partir das fixtures, calculando com as funções reais da Fatia 1 como oráculo (`agregarPorSku` sobre o mesmo recorte) — a série NÃO pode ter conta própria.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**

```ts
// src/lib/calendario-brt.ts
// ponytail: BRT fixo em UTC−03:00 (o Brasil não tem horário de verão desde 2019). Se voltar a ter,
// trocar por Intl.DateTimeFormat com timeZone 'America/Sao_Paulo'.
const OFFSET_MS = 3 * 3_600_000;
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export type Passo = 'semana' | 'mes';
export interface Intervalo { inicio: string; fim: string; rotulo: string; incompleto: boolean }

/** "Relógio de parede" BRT como Date UTC (getUTC* = campos BRT). */
const brt = (ms: number) => new Date(ms - OFFSET_MS);
const deBrt = (d: Date) => new Date(d.getTime() + OFFSET_MS);

function inicioDe(ms: number, passo: Passo): Date {
  const d = brt(ms);
  d.setUTCHours(0, 0, 0, 0);
  if (passo === 'mes') d.setUTCDate(1);
  else d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // segunda
  return d;
}
function proximo(d: Date, passo: Passo): Date {
  const n = new Date(d);
  if (passo === 'mes') n.setUTCMonth(n.getUTCMonth() + 1); else n.setUTCDate(n.getUTCDate() + 7);
  return n;
}
const dd = (n: number) => String(n).padStart(2, '0');

export function intervalosBRT(desde: string, ate: string, passo: Passo, agora: Date = new Date()): Intervalo[] {
  const out: Intervalo[] = [];
  const fimMs = Date.parse(ate);
  for (let d = inicioDe(Date.parse(desde), passo); deBrt(d).getTime() <= fimMs; d = proximo(d, passo)) {
    const inicio = deBrt(d); const fim = deBrt(proximo(d, passo));
    out.push({
      inicio: inicio.toISOString(), fim: fim.toISOString(),
      rotulo: passo === 'mes' ? `${MESES[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}` : `${dd(d.getUTCDate())}/${dd(d.getUTCMonth() + 1)}`,
      incompleto: fim.getTime() > agora.getTime(),
    });
  }
  return out;
}
```

  `serieDoSku`: para cada intervalo, `vendasDoIv = vendas.filter(v => v.date_closed && Date.parse(v.date_closed) >= inicio && < fim)`; `linhas = agregarPorSku(agrupar(vendasDoIv), { desde: inicio, ate: new Date(Date.parse(fim) - 1).toISOString() }, catalogo, ordensDevolvidas).filter(l => codigos.includes(l.codigo))`; `acc = somarAcumuladores(linhas.map(l => l.acc))`; `m = metricas(acc)`; preço dos itens faturáveis do SKU nesses pedidos (`Σ unit_price×qty / Σ qty`, mín., máx.; `null` sem item). Reusa só funções da Fatia 1.
- [ ] **Step 4:** testes + `pnpm preflight:static` + `pnpm test`. **Step 5: Commit** `feat(vendas-sku): calendário BRT e série temporal do SKU`.

---

### Task 5: Eventos com vínculo declarado, UFs, devoluções e mix

**Files:** Modify `src/lib/sku-dossie.ts`, `src/lib/sku-dossie-dados.ts`; Test `tests/lib/sku-dossie.test.ts`, `tests/lib/sku-dossie-dados.test.ts`.

**Interfaces — Produces:**
- Fetchers em `sku-dossie-dados.ts` (colunas explícitas, `buscarTodasPaginas`, RLS por org): `buscarMovimentos(codigos)` → `estoque_movimentos(id, codigo, motivo, quantidade, custo_unitario, estoque_anterior, estoque_resultante, criado_em)` order `criado_em, id`; `buscarModeracoes(mlbs)` → `ml_moderacao(id, ml_item_id, status, motivo, detectado_em, resolvido_em)`; `buscarPerguntas(mlbs)` → `ml_perguntas(id, item_id, criada_em)` (coluna é `item_id`); `buscarCampanhas(mlbs)` → **duas leituras** (o typegen não tem relationship da FK composta, `src/lib/database.types.ts:1403`): `ml_promocao_itens(promocao_id, ml_item_id, status, preco_promo, sincronizado_em)` e `ml_promocoes(promocao_id, nome, tipo, status, inicio, fim, sincronizado_em)` filtrada pelos `promocao_id`, join no cliente (padrão de `src/lib/promocoes.ts:123-133`). `buscarDevolucoes` (`src/lib/devolucoes.ts`) passa a trazer também `reason_id` no select (só acrescenta coluna).
- `type Vinculo = 'exato' | 'compartilhado' | 'nao_resolvido'`; `vinculoDoMlb(mlb, mlbs: Map<string,string[]>): Vinculo` (1 código = exato; 2+ = compartilhado; MLB fora do mapa = nao_resolvido).
- `type TipoEvento = 'entrada' | 'ruptura' | 'retorno_estoque' | 'moderacao_detectada' | 'moderacao_resolvida' | 'devolucao_aberta' | 'devolucao_estorno'`; `interface Evento { id: string; tipo: TipoEvento; em: string; titulo: string; detalhe: string | null; vinculo: Vinculo | null; mlb: string | null }`.
- `montarEventos(p: { movimentos; moderacoes; devolucoes: Devolucao[]; ordersDosCodigos: Set<number>; mlbs: Map<string,string[]>; kitMultiplicador: number | null }): Evento[]` — ids de evento com sufixo (`${id}:entrada`, `${id}:ruptura`, `${id}:detectada`, `${id}:resolvida`, `${id}:abertura`, `${id}:estorno`); entrada = `motivo === 'entrada'` com custo ("Entrada registrada: N un. a R$ X"); ruptura = `estoque_anterior > 0 && estoque_resultante === 0`; retorno = `estoque_anterior === 0 && estoque_resultante > 0`; **kit** (`kitMultiplicador` não nulo; os movimentos são os da base, via `kitBaseCodigo`): ruptura quando `floor(anterior/N) > 0 && floor(resultante/N) === 0`, retorno no inverso; movimento sem saldo ignorado; moderação "detectada"/"resolução observada"; devolução: só `type === 'returns'` **com `order_id` em `ordersDosCodigos`**, evento de abertura em `aberto_em` e de estorno em `fechado_em`, motivo `reason_texto ?? reason_id ?? 'não informado'`; ordenado por `em`, desempate por id; dedupe por id do evento (família).
- `perguntasPorIntervalo(perguntas, intervalos): number[]`.
- `ufsDoSku(pedidos: Pedido[], codigos: string[]): { valores: Record<string, number>; semUf: number }` — soma o **bruto dos itens faturáveis do SKU** pela `item.uf` (Task 1), nunca o bruto do pack.
- `mixDaFamilia(linhas: LinhaSku[], anterior: LinhaSku[], catalogoFamilia: CatalogoSku[]): Array<{ codigo; titulo; unidades; participacaoUnidades: number; lucro: number | null; deltaLucro: number | null; semVendas: boolean }>` — inclui irmãs do catálogo sem venda.
- `situacaoCampanhas(itens)` → lista `{ nome, tipo, statusItem, statusCampanha, precoPromo, vigencia: {inicio, fim}, sincronizadoEm }`.

- [ ] **Step 1: Failing tests** cobrindo: devolução de outro produto (order fora de `ordersDosCodigos`) não aparece; abertura e estorno do mesmo claim viram 2 eventos; moderação detectada e resolvida viram 2 eventos; ruptura do kit por `floor(base/N)`; MLB fora do mapa → `nao_resolvido`; ruptura/retorno só por transição; movimento `estoque_anterior null` ignorado; moderação de MLB com 3 códigos → `compartilhado`; o mesmo evento não duplica ao juntar códigos da família; UF por item num pack com 2 UFs; irmã sem venda aparece com `semVendas: true`; devolução usa só `type === 'returns'`.
- [ ] **Step 2-4:** RED → implementar → GREEN; `pnpm preflight:static`; `pnpm test`.
- [ ] **Step 5: Commit** `feat(vendas-sku): eventos com vínculo, UFs por item, mix e campanhas do dossiê`.

---

### Task 6: Hook `useSkuDossie`

**Files:** Create `src/hooks/useSkuDossie.ts`; Test `src/hooks/__tests__/useSkuDossie.test.ts`.

**Interfaces — Produces:** `useSkuDossie(alvo: { tipo: 'sku'; codigo: string } | { tipo: 'familia'; codigoPai: string }, periodo: Periodo, passo: Passo)` → `{ dados: DossieSku | null; estado: 'carregando' | 'erro' | 'nao_encontrado' | 'sem_vendas' | 'sem_cadastro' | 'ok'; refetch }`, onde `DossieSku = { codigos: string[]; titulo; catalogo: CatalogoSku[]; historicoDesde: string | null; ultimaVenda: string | null; linhaPeriodo: LinhaSku | null; linhaAnterior: LinhaSku | null; tendencia: Tendencia | null; cobertura: Cobertura; alertas: Alerta[]; serie: PontoSerie[]; eventos: Evento[]; perguntasPorIntervalo: number[]; ufs; mix; campanhas; mlbs: Map<string,string[]>; qualidade: { pctBrutoCustoReal: number | null; fontesParciais: string[] } }`.
  - Códigos: SKU → `[codigo]`; família → códigos do catálogo com `codigoPai` (composição atual, inclui sem venda).
  - **KPIs do período (`linhaPeriodo`/`linhaAnterior`) = `montarVendasSku` da Fatia 1** sobre as vendas carregadas pela RPC (mesmo recorte por `date_closed` antes de `agruparPorPedido`, mesma janela inclusiva), pegando as linhas dos `codigos` e somando com `somarAcumuladores` + `metricas`. Nunca agrupar o histórico inteiro e filtrar depois. A série (Task 4) usa intervalos meio-abertos com `ate = fim − 1 ms`.
  - Tendência/cobertura "posição de hoje": `montarVendasSku` com `janela = resolverJanela({ tipo: 'preset', dias: 30 })` (termina agora); na família, `classificarTendencia` sobre a soma das unidades dos códigos.
  - Estados: `nao_encontrado` (fora do catálogo **e** sem nenhuma venda); `sem_vendas` (no catálogo, sem venda); `sem_cadastro` (tem venda, não está no catálogo: vendas e série aparecem, família e estoque não, `estoque: null` — estoque desconhecido não é zero).
  - Mesmos resolvers de `useVendasSku` (custos, peso, foto, alíquota, cor); espera custos/devoluções como a Task 1.
  - Tendência/cobertura: posição de hoje (`classificarTendencia`/`coberturaDias` da Fatia 1 com janelas de 30 dias até agora; kit → `'compartilhado'`, saldo `estoqueKit`).
  - `qualidade.fontesParciais`: sempre `['Promoções: só a situação atual', 'Publicação: só vínculos registrados']`, mais `'Kit Virtual: sem histórico antes de set/2026'` quando houver `kit_item_id`.
- [ ] Steps: teste com hooks mockados (padrão de `useVendasSku.test.ts`) para os 6 estados e um teste provando que o lucro do período = o da linha do ranking (`montarVendasSku`) com um pack que atravessa o início do período → implementar → `pnpm preflight:static` + `pnpm test` → commit `feat(vendas-sku): hook do dossiê do SKU`.

---

### Task 7: Dossiê — rotas, link do ranking, cabeçalho, estados, qualidade do histórico e KPIs (UI premium)

> Divisão (achado Grok #7): **Task 7** = rotas, link do ranking, cabeçalho, estados, qualidade do histórico, KPIs (itens 1, 2, 3, 11 abaixo). **Task 8** = série, Sheet de pedidos, eventos (itens 4, 5). **Task 9** = estoque, devoluções, UFs, mix, campanhas (itens 6-10) + passe final de responsividade e screenshots (item 12). Cada uma com seu teste e sua auditoria de design.

> Invocar `frontend-design-fable5` (system work). Referências: Central de Promoções (`src/pages/PromocaoDetalhe.tsx`, commit `8515ef06`), aba Vendas SKU (`src/components/faturamento/aba-vendas-sku.tsx`, `ranking-sku.tsx`), `MapaBrasil` (`src/components/faturamento/mapa-brasil.tsx`), `ThumbProduto`, `KpiCard`, `EmptyState`, `Breadcrumbs`, `PageHeader`, `SeletorPeriodo`.

**Files:** Create `src/pages/SkuDossie.tsx`, `src/components/sku-dossie/{cabecalho-dossie,serie-dossie,eventos-dossie,estoque-dossie,ufs-dossie,mix-familia,campanhas-dossie,qualidade-historico}.tsx`; Modify `src/App.tsx` (lazy + 2 rotas dentro do `MenuGuard`, ao lado de `/promocoes/:promocaoId`), `src/components/faturamento/ranking-sku.tsx` (link "Abrir dossiê" no nome do SKU e na linha de família, sem remover a expansão da conta; **sem link** quando `l.codigo === SEM_CODIGO` ou `codigoPai.startsWith('sem-familia:')`); Test `src/pages/__tests__/SkuDossie.test.tsx` (padrão de `PromocaoDetalhe.test.tsx`: `vi.mock` do hook, `MemoryRouter` + `Routes`).

**Conteúdo da página** (uma só página, `useParams` decide SKU × família):
1. **Cabeçalho:** voltar para `/faturamento?aba=sku` preservando a query de origem (`location.state?.de` → `Link to={de ?? '/faturamento?aba=sku'}`; o ranking passa `state={{ de: location.pathname + location.search }}`), foto, título, código/família, 1ª e última venda, idade comercial, tendência (pill, "posição em dd/mm"), alertas.
2. **Qualidade do histórico** (discreto): "Histórico desde dd/mm/aaaa", % faturamento com custo real, fontes parciais.
3. **KPIs do período** (SeletorPeriodo + Δ vs. anterior, mesma apresentação da aba): faturamento, lucro, Markup, Margem s/ venda, unidades, taxa de devolução.
4. **Série** (recharts, alternador semana/mês; na família, nota "o preço médio também muda pelo mix de variações"): barras de unidades + linha de lucro (eixo duplo), preço médio numa linha fina com faixa mín./máx.; ponto `incompleto` com opacidade reduzida e rótulo "(parcial)"; faixa de perguntas por intervalo (barrinhas discretas abaixo); marcadores de evento no eixo do tempo (ícone por tipo); tooltip com tokens (`contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--popover-foreground)', fontSize: 12 }}`). Clicar num ponto abre um `Sheet` com os pedidos daquele intervalo (reusar a linha/`DetalhePedidoItens` da aba Vendas), SKU destacado.
5. **Eventos** (lista cronológica agrupada por mês): ícone, título, data, selo "anúncio compartilhado" com o MLB quando `vinculo === 'compartilhado'`.
6. **Estoque:** saldo, cobertura (ou "estoque compartilhado com a base" no kit, com o saldo `floor(base/N)`).
7. **Devoluções:** taxa (coorte, só `returns`) e motivos.
8. **UFs:** `MapaBrasil` com `ufsDoSku`, lista top 5 e "sem localização".
9. **Mix (família):** tabela das variações com participação em unidades, lucro e Δ, incluindo sem venda ("sem vendas"); cada linha abre o dossiê da variação.
10. **Campanhas:** "Situação atual nas campanhas" com status, preço promocional, vigência e "sincronizado em"; texto "participação histórica desconhecida".
11. **Estados:** carregando (skeleton do layout), erro (EmptyState + "Tentar de novo"), `nao_encontrado` (EmptyState "Não encontramos este código" + voltar), `sem_vendas` (cabeçalho + estoque + "Sem vendas registradas desde a entrada no PubliAI"), `sem_cadastro` (aviso "Este código não está mais no catálogo": vendas e série aparecem, estoque "desconhecido").
12a. **Kit Virtual:** unidades vendidas dentro de kit (`ItemPedido.dentroDeKit`) aparecem separadas nos KPIs/série ("vendido dentro de kit"), com aviso de cobertura parcial (sem histórico antes de set/2026).
12. 1440 e 390 sem overflow de página; gráfico responsivo (`ResponsiveContainer`); acessível (gráfico com resumo textual `sr-only`, lista de eventos semântica).

- [ ] **Step 1: Failing test** — renderizar com dados mockados: título, "Histórico desde", selo "anúncio compartilhado", "estoque compartilhado com a base" (kit), estado `nao_encontrado`, link do ranking leva a `/faturamento/sku/<codigo>`.
- [ ] **Step 2-4:** RED → página → GREEN; `preflight.sh` da skill; `pnpm preflight:static`; `pnpm test`; subir o app (copiar `.env.local`, `pnpm dev`, `playwright-cli -s=ui2a`, login VALIDATION_*, `route` para as 3 RPCs novas + `vendas_sku_catalogo` com mocks realistas), screenshots 1440/390 escuro/claro de SKU, família, kit, sem vendas, não encontrado, erro, sheet de pedidos.
- [ ] **Step 5: Commit** por entrega: `feat(vendas-sku): dossiê — cabeçalho, estados e KPIs` (7), `feat(vendas-sku): dossiê — série e eventos` (8), `feat(vendas-sku): dossiê — estoque, devoluções, UFs, mix e campanhas` (9).

---

### Task 8: Dossiê — série temporal, Sheet de pedidos e eventos (UI premium)

**Conteúdo:** itens **4** (série) e **5** (eventos) da lista "Conteúdo da página" da Task 7 — o implementer lê também o brief da Task 7 (`task-7-brief.md`) para o contexto completo, referências e regras de UI. Mesmos arquivos-base da Task 7 (`src/pages/SkuDossie.tsx`, `src/components/sku-dossie/serie-dossie.tsx`, `eventos-dossie.tsx`).

- [ ] **Step 1: Failing test** em `src/pages/__tests__/SkuDossie.test.tsx`: série renderiza os rótulos dos intervalos, marca o intervalo incompleto como "(parcial)", resumo textual `sr-only` do gráfico; eventos mostram o selo "anúncio compartilhado" com o MLB e o de "não resolvido"; clicar num ponto abre o Sheet com os pedidos do intervalo.
- [ ] **Step 2-4:** RED → implementar (skill `frontend-design-fable5`, system work; tooltip do recharts com tokens) → GREEN; `preflight.sh`; `pnpm preflight:static`; `pnpm test`; screenshots 1440/390 escuro/claro da série e dos eventos com dados mockados.
- [ ] **Step 5: Commit** `feat(vendas-sku): dossiê — série e eventos`.

---

### Task 9: Dossiê — estoque, devoluções, UFs, mix da família e campanhas (UI premium)

**Conteúdo:** itens **6** a **10** e **12**/**12a** da lista "Conteúdo da página" da Task 7 — o implementer lê também o brief da Task 7. Arquivos: `src/components/sku-dossie/{estoque-dossie,ufs-dossie,mix-familia,campanhas-dossie}.tsx` + montagem em `SkuDossie.tsx`.

- [ ] **Step 1: Failing test**: kit mostra "estoque compartilhado com a base" e o saldo `floor(base/N)`; UFs usam `ufsDoSku` (mapa + top 5 + "sem localização"); mix da família lista irmã sem venda como "sem vendas"; campanhas mostram "participação histórica desconhecida"; Kit Virtual separado ("vendido dentro de kit").
- [ ] **Step 2-4:** RED → implementar → GREEN; `preflight.sh`; `pnpm preflight:static`; `pnpm test`; passe final de responsividade da página inteira (1440/390, sem overflow de página) e screenshots completos escuro/claro de SKU, família, kit, sem vendas, sem cadastro, não encontrado, erro e Sheet.
- [ ] **Step 5: Commit** `feat(vendas-sku): dossiê — estoque, devoluções, UFs, mix e campanhas`.

---

### Task 10: Validação real, carga e docs

- [ ] `pnpm test` + `pnpm preflight`.
- [ ] Paridade real (conta VALIDATION, RPCs mockadas só onde não existem em produção): para um SKU com vendas em pack, o faturamento e o lucro do dossiê no período = os da linha desse SKU no ranking da aba Vendas SKU no mesmo período. Como `vendas_sku_dossie_ids` não existe em produção, o mock dessa RPC devolve os ids reais obtidos por uma consulta read-only (Management API) com a mesma lógica — registrar a consulta no relatório.
- [ ] Carga (critério de aceite da spec): para o SKU de maior volume da Avil, medir por consulta read-only o nº de vendas devolvidas pela lógica da RPC (com expansão dos packs), bytes aproximados do payload de `buscarVendasPorIds` e tempo no navegador; registrar no relatório.
- [ ] Screenshots reais 1440/390 escuro/claro; console limpo.
- [ ] Docs pela skill `docs-update-checklist`: glossário (Dossiê do SKU, vínculo exato/compartilhado, histórico observado), `docs/project-status.md`, modelo de dados (2 RPCs + índices), ADR-0172 (nota da 2a; status segue "Proposto").
- [ ] Commit `docs(vendas-sku): Fatia 2a validada`.
