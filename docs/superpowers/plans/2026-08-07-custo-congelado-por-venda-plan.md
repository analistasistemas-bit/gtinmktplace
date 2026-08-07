# Plano — Custo congelado por venda (markup histórico fiel)

**Data:** 2026-08-07
**Design:** `docs/superpowers/specs/2026-08-07-custo-congelado-por-venda-design.md`
**Branch:** `worktree-custo-congelado-venda`

## Mudanças em relação ao design original (da revisão adversarial)

1. **Congelamento dentro de `upsertVenda` (io.ts), não no `sync-venda`.** O design intitula a
   gravação como "sync-venda", mas `ml_vendas_itens` é escrito por **4 funções** via `upsertVenda`:
   `sync-venda`, `sync-devolucao` (fora do checklist do design), `backfill-faturamento` (é quem
   DESCOBRE vendas novas no schedule horário) e `reconciliar-faturamento` (2 call sites). Congelar
   no caller deixaria 3 caminhos sem congelamento. O congelamento vai para dentro de `upsertVenda`,
   com o resolver como **campo obrigatório** de `opts` — o TypeScript quebra a compilação de
   qualquer caller que não passe (trava em tempo de build, não convenção).
2. **`UNIQUE NULLS NOT DISTINCT` no lugar do índice com `COALESCE(variation_id, -1)`.**
   Dois motivos: (a) supabase-js/PostgREST não consegue apontar `onConflict` para índice de
   expressão — o `ON CONFLICT DO NOTHING` do insert-once falharia na prática; (b) o design só
   tratou `variation_id` NULL, mas `ml_item_id` também é nullable (`VendaItemRow.ml_item_id:
   string | null`). `unique nulls not distinct (venda_id, ml_item_id, variation_id)` resolve os
   dois e é o **mesmo padrão que `ml_vendas_itens` já usa**
   (`20260627095025_add_ml_vendas_itens_unique.sql`).
3. **Paridade FE↔BE garantida por teste de paridade**, no padrão já existente
   `tests/lib/paridade-preco-fe-be.test.ts` (vitest importa o módulo do BE direto).
4. **Backfill normaliza o código** (`ltrim(codigo, '0')`) — o resolver do FE casa por
   `normGtin(codigo)` (zeros à esquerda removidos); sem isso `'02841037'` da venda não casa
   `'2841037'`/`'02841037'` da variação, e o escopo é por `user_id` (mesmo escopo do
   `carregarCatalogo`).
5. **ADR-0109 escrito antes da implementação** (regra do CLAUDE.md: decisão nova e não-trivial →
   ADR antes do código).

---

## Tarefa 0 — ADR-0109

**Objetivo:** registrar a decisão "custo congelado por venda em tabela satélite insert-once".

- **Criar:** `docs/decisions/0109-custo-congelado-por-venda.md`
- **Editar:** `obsidian-vault/04-Decisões/Índice de ADRs.md` (nova linha)
- **Teste:** n/a (documento).
- **Conteúdo:** status aceito; contexto (ADR-0108 deixou "custo histórico por data de venda" como
  decisão não tomada; 307/1164 itens com markup calculado com custo de hoje ≠ custo da época);
  decisão (tabela `venda_item_custo`, insert-once via `ON CONFLICT DO NOTHING` +
  `unique nulls not distinct`, trigger que barra UPDATE do custo, congelamento dentro de
  `upsertVenda` cobrindo todos os callers, backfill por lote vigente com `fonte='backfill'`);
  alternativas descartadas (coluna em `ml_vendas_itens` — destruída pelo delete+reinsert do
  `io.ts:260`; histórico de custo por produto); consequências (sem escape pela UI — correção só no
  banco com `alter table ... disable trigger`; peso/origem/imposto continuam dinâmicos).
- **Verificação:** arquivo existe, índice atualizado.
- **Depende de:** nada.

## Tarefa 1 — Migration: tabela `venda_item_custo` + trigger + RLS

**Objetivo:** criar a tabela satélite com unicidade correta, trava de UPDATE e RLS por org.

- **Criar:** migration via `supabase migration new venda_item_custo` (NUNCA apply_migration/painel
  — ADR-0043). Estilo de referência: `20260729084329_e6b_estoque_movimentos.sql`.
- **Esboço:**

```sql
-- ADR-0109 — custo do produto congelado no instante da venda (insert-once).
create table public.venda_item_custo (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references public.organizations(id),
  user_id        uuid not null references auth.users(id) on delete cascade,
  venda_id       uuid not null references public.ml_vendas(id) on delete cascade,
  ml_item_id     text,
  variation_id   bigint,
  codigo         text,                                   -- SKU casado, auditoria
  custo_unitario numeric not null check (custo_unitario > 0),
  congelado_em   timestamptz not null default now(),
  fonte          text not null check (fonte in ('sync', 'backfill')),
  -- nulls not distinct (PG15+): item sem variação (variation_id null) e/ou sem ml_item_id
  -- não pode duplicar — mesmo padrão de ml_vendas_itens (20260627095025). ON CONFLICT do
  -- supabase-js só infere constraint por lista de colunas, então NADA de índice de expressão.
  constraint venda_item_custo_uniq unique nulls not distinct (venda_id, ml_item_id, variation_id)
);

alter table public.venda_item_custo enable row level security;
create policy "venda_item_custo: select org" on public.venda_item_custo
  for select to authenticated using (org_id = (select public.current_org_id()));
-- Sem policy de escrita: só service_role (bypassa RLS). GRANT além da policy (padrão
-- estoque_movimentos: privilégio de tabela e RLS são checagens independentes).
grant select on public.venda_item_custo to authenticated;

-- Trava: congelado é congelado. Qualquer UPDATE que mude custo_unitario FALHA — inclusive
-- service_role e migrations futuras (correção legítima exige disable trigger explícito, loud).
create or replace function public.bloquear_update_custo_congelado()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.custo_unitario is distinct from old.custo_unitario then
    raise exception 'custo congelado da venda não pode ser alterado (ADR-0109)';
  end if;
  return new;
end $$;
create trigger venda_item_custo_bloquear_update
  before update on public.venda_item_custo
  for each row execute procedure public.bloquear_update_custo_congelado();
```

- **Verificação:** `supabase db push` + `npm run db:check`; depois, contra o banco:
  - `insert` duplicado com `variation_id` null → viola `venda_item_custo_uniq` (ou DO NOTHING);
  - `update venda_item_custo set custo_unitario = 1 where ...` → erro do trigger;
  - `delete` → passa (cascade da venda depende disso);
  - com um JWT `authenticated` de outra org → select vazio.
- **Depende de:** Tarefa 0.

## Tarefa 2 — Resolução do custo vigente no backend (`custo-vigente.ts`)

**Objetivo:** função pura, no Deno `_shared`, que espelha exatamente a cadeia do frontend
(`variação → anúncio → GTIN → código`, tie-break `atualizado_em` mais recente — ADR-0108).

- **Criar:** `supabase/functions/_shared/faturamento/custo-vigente.ts`
- **Testes PRIMEIRO (RED):**
  - `supabase/functions/_shared/faturamento/__tests__/custo-vigente.test.ts` — mesmos casos de
    `tests/lib/custos.test.ts`: precedência da cadeia; caso COLA do ADR-0108 (3 linhas, chaves
    idênticas, vence `15.8558` por qualquer chave); custo ≤ 0/null descartado; `atualizado_em`
    ausente/inválido = `-Infinity` (não derruba linha datada; empate mantém a primeira);
    normalização de GTIN e de código (zeros à esquerda); nenhum match → null.
  - `tests/lib/paridade-custo-fe-be.test.ts` — padrão de `paridade-preco-fe-be.test.ts`: mesmo
    grid de fixtures (linhas de variações × itens de venda) alimentado em
    `montarMapasCusto`/`montarCustoResolver` (FE, `src/lib/custos.ts`) e no módulo novo (BE);
    `expect(fe).toBe(be)` para cada combinação. Falha no dia em que as cópias divergirem.
- **Esboço:**

```ts
// Espelho servidor de src/lib/custos.ts (cadeia + tie-break ADR-0108). Coberto por
// tests/lib/paridade-custo-fe-be.test.ts — mudou lá, muda aqui.
import { normGtin } from './venda.ts';

export interface LinhaCusto {
  custo: unknown; atualizado_em: unknown;
  ml_variation_id: string | null; ml_item_id: string | null;
  gtin: string | null; codigo: string | null;
}
export interface ItemParaCusto {
  variation_id: number | null; ml_item_id: string | null;
  ean: string | null; codigo: string | null;
}
export interface MapasCustoVigente { /* porVariacao/porItem/porGtin/porCodigo: Map<string, number> */ }

export function montarMapasCustoVigente(rows: LinhaCusto[]): MapasCustoVigente { /* upsertRecente por atualizado_em, custo <= 0 fora */ }
export function resolverCustoVigente(m: MapasCustoVigente, item: ItemParaCusto): number | null { /* cadeia var → item → gtin → codigo */ }
```

- **Verificação:** `pnpm test` — os dois arquivos novos verdes; suite inteira verde.
- **Depende de:** nada (pode correr em paralelo com T1).

## Tarefa 3 — Gravação no `upsertVenda` (cobre TODOS os caminhos de escrita)

**Objetivo:** congelar o custo logo após a gravação dos itens, dentro de `upsertVenda`, com
resolver obrigatório vindo de `carregarCatalogo`.

- **Editar:**
  - `supabase/functions/_shared/faturamento/io.ts` —
    `carregarCatalogo`: acrescentar `custo, atualizado_em` ao select de `variacoes` (o
    `ml_item_id` vem de `famPorId`, já carregado); montar `MapasCustoVigente` e devolver
    `custoVigenteResolver` no `Catalogo`.
    `upsertVenda`: `opts.custoVigenteResolver` **obrigatório** (sem `?`); após o upsert dos itens:

```ts
const congelar = itens
  .map((i) => ({ item: i, custo: opts.custoVigenteResolver(i) }))
  .filter((x): x is ... => x.custo != null && x.custo > 0)
  .map(({ item, custo }) => ({
    user_id: userId, org_id: orgId, venda_id: vendaId,
    ml_item_id: item.ml_item_id, variation_id: item.variation_id,
    codigo: item.codigo, custo_unitario: custo, fonte: 'sync',
  }));
if (congelar.length > 0) {
  // insert-once: primeiro sync grava; os seguintes caem no DO NOTHING (ignoreDuplicates).
  const { error } = await admin.from('venda_item_custo')
    .upsert(congelar, { onConflict: 'venda_id,ml_item_id,variation_id', ignoreDuplicates: true });
  if (error) throw new Error(`congelar custo da venda: ${error.message}`); // LOUD — caminho financeiro
}
```

  - Call sites (o TS obriga — passar `custoVigenteResolver` do destructure de `carregarCatalogo`):
    - `supabase/functions/sync-venda/index.ts` (~87/98)
    - `supabase/functions/sync-devolucao/index.ts` (~89/99)
    - `supabase/functions/backfill-faturamento/index.ts` (~111/132)
    - `supabase/functions/reconciliar-faturamento/index.ts` (~105/122 e ~139/157)
- **Teste PRIMEIRO (RED):** estender
  `supabase/functions/_shared/faturamento/__tests__/io.test.ts` (fake admin ganha captura de
  `venda_item_custo`):
  - item com custo resolvido → 1 upsert em `venda_item_custo` com
    `{ onConflict: 'venda_id,ml_item_id,variation_id', ignoreDuplicates: true }`, `fonte: 'sync'`,
    `custo_unitario` do resolver;
  - item sem match (resolver → null) → nenhuma linha;
  - erro do upsert de custo → `upsertVenda` lança (não engole);
  - re-chamada do mesmo pedido → chama de novo com ignoreDuplicates (o banco garante o resto —
    o unit valida os parâmetros, o SQL da T7 valida o comportamento real).
- **Verificação:** `pnpm test` verde; `pnpm lint` verde (o lint pega caller sem o campo? não — o
  `tsc` do CI pega; rodar `pnpm build` ou o typecheck do repo).
- **Depende de:** T1 (tabela), T2 (resolver).

## Tarefa 4 — Backfill (migration de dados)

**Objetivo:** reconstruir o custo das 1202 vendas existentes pelo lote vigente na data da venda.

- **Criar:** migration via `supabase migration new backfill_venda_item_custo` (timestamp posterior
  ao da T1).
- **Esboço:**

```sql
-- ADR-0109 — backfill: custo da variação cujo LOTE é o mais recente anterior à data da venda.
-- Aproximação assumida: não capta mudança de custo por recebimento entre o lote e a venda
-- (fonte='backfill' deixa isso explícito). Idempotente: on conflict do nothing.
insert into public.venda_item_custo
  (org_id, user_id, venda_id, ml_item_id, variation_id, codigo, custo_unitario, fonte)
select v.org_id, v.user_id, i.venda_id, i.ml_item_id, i.variation_id, i.codigo, c.custo, 'backfill'
from public.ml_vendas_itens i
join public.ml_vendas v on v.id = i.venda_id
cross join lateral (
  select va.custo
  from public.variacoes va
  join public.familias f on f.id = va.familia_id
  join public.lotes l on l.id = f.lote_id
  where va.user_id = v.user_id
    and ltrim(va.codigo, '0') = ltrim(i.codigo, '0')   -- normGtin do FE remove zeros à esquerda
    and va.custo > 0
    and l.criado_em <= coalesce(v.date_created, v.date_closed, now())
  order by l.criado_em desc, va.atualizado_em desc
  limit 1
) c
where i.codigo is not null
on conflict (venda_id, ml_item_id, variation_id) do nothing;
```

- **Furos aceitos (design):** item com `codigo` null (~38) e venda anterior ao primeiro lote (1) →
  sem linha, resolução dinâmica; produto cadastrado sem lote → variação sem família/lote não entra
  no lateral → dinâmica.
- **Verificação (contra o banco, pós-push):**
  - `select count(*) from venda_item_custo where fonte = 'backfill'` → **≥ 1163** (1163 na medição
    de 07/08; vendas novas até a execução podem somar);
  - reexecutar o mesmo INSERT manualmente → **0 linhas** (idempotente);
  - venda `2000017810823298` (código `02841037`) → `custo_unitario = 15.8558`;
  - uma venda de **junho** do mesmo código → `custo_unitario = 17.1224`;
  - `select count(*) from venda_item_custo c join variacoes ...` divergentes do custo de hoje ≈ 307.
- **Ordem de deploy:** `db push` (T1+T4) **antes** do deploy das functions (T7). Vendas que
  sincronizarem na janela entre push e deploy ficam sem linha e se curam no próximo re-sync/backfill
  horário (fonte 'sync', custo daquele momento — defasagem de horas, aceitável e documentada).
- **Depende de:** T1.

## Tarefa 5 — Leitura no frontend (prefere o congelado, cai no dinâmico)

**Objetivo:** `buscarVendas` traz o custo congelado; o resolver de custo o prefere; sem congelado,
comportamento idêntico ao atual. Nenhuma mudança visual.

- **Editar:**
  - `src/lib/faturamento.ts` — no select de `buscarVendas`, acrescentar o embed
    `custos_congelados:venda_item_custo(ml_item_id, variation_id, custo_unitario)` (FK
    `venda_id → ml_vendas.id`); `VendaItem` ganha `custo_congelado?: number | null`; helper puro:

```ts
/** Anexa o custo congelado (ADR-0109) a cada item da venda; match por (ml_item_id, variation_id),
 *  null == null. Puro, testável. */
export function aplicarCustoCongelado(itens: VendaItem[], congelados: CustoCongeladoRow[]): VendaItem[]
```

    aplicado no map final de `buscarVendas` (e o array cru não fica no objeto `Venda`).
  - `src/lib/custos.ts` — `montarCustoResolver`:

```ts
export function montarCustoResolver(m: MapasCusto | undefined): CustoResolver {
  // Congelado vence (ADR-0109) — inclusive sem mapas carregados; fallback = comportamento atual.
  return (item) => (item.custo_congelado != null && item.custo_congelado > 0)
    ? item.custo_congelado
    : resolverProduto(m, item)?.custo ?? null;
}
```

  - **Não mudar:** peso, origem/alíquota (continuam dinâmicos — fora de escopo do design),
    `resumo-vendas.ts`, `detalhe-vendas.ts`, `pedidos-faturamento.ts` — todos consomem
    `CustoResolver` e herdam a preferência automaticamente (Dashboard, DetalheFinanceiro,
    DetalheVendas, aba-vendas, useResumoVendas).
- **Teste PRIMEIRO (RED):** `tests/lib/custos.test.ts`, novo describe "custo congelado (ADR-0109)":
  - item com `custo_congelado` usa ele, mesmo com mapas apontando outro valor;
  - `custo_congelado` presente e mapas `undefined` → congelado (não null);
  - sem `custo_congelado` → cadeia dinâmica intacta (casos existentes seguem verdes);
  - `custo_congelado` 0/negativo (não deveria existir — check da tabela) → fallback dinâmico.
  E teste do helper `aplicarCustoCongelado` (novo `tests/lib/custo-congelado.test.ts` ou no mesmo
  arquivo): match exato por par, `variation_id` null casa null, congelado sem item correspondente é
  ignorado, itens sem congelado ficam com `undefined`.
- **Verificação:** `pnpm test` + `pnpm lint` verdes.
- **Depende de:** T1 (tabela p/ o embed funcionar em runtime; os testes são puros e não dependem).

## Tarefa 6 — Documentação

**Objetivo:** docs no mesmo commit da entrega (regra do CLAUDE.md).

- **Editar:**
  - `docs/reference/modelo-de-dados.md` — tabela `venda_item_custo` (colunas, unicidade
    nulls-not-distinct, trigger, RLS, fontes sync/backfill);
  - `docs/reference/glossario.md` — "custo congelado";
  - `docs/TASKS.md` — registrar a entrega;
  - `obsidian-vault/` — Sprint Atual/impacto funcional (markup histórico fiel).
- **Verificação:** revisão de texto; links para ADR-0108/0109 corretos.
- **Depende de:** T0–T5 (descreve o que foi entregue).

## Tarefa 7 — Deploy + verificação end-to-end (critérios do design)

**Objetivo:** entregar em produção e provar os 6 critérios de sucesso.

- **Passos:**
  1. `pnpm lint` + `pnpm test` verdes no worktree.
  2. `supabase db push` (T1 + T4) → `npm run db:check`.
  3. Deploy via CLI de **todas** as functions que importam `_shared/faturamento/io.ts` (mudança em
     `_shared` → redeployar todas as afetadas e conferir versão pós-deploy): `sync-venda`,
     `sync-devolucao`, `backfill-faturamento`, `reconciliar-faturamento`, `ml-webhook`,
     `sync-pergunta`, `sync-mensagem`.
  4. Verificações SQL (leitura + os UPDATEs de teste abaixo, nunca escrita em anúncio/venda real):

| # | Critério | Como verificar |
|---|---|---|
| 1 | `pnpm test` verde com os testes novos | CI + local |
| 2 | `UPDATE venda_item_custo SET custo_unitario = 1` falha | rodar o UPDATE numa linha real → esperar o erro do trigger (ADR-0109) |
| 3 | Backfill ≥1163 linhas; 2ª execução 0 | counts da T4 |
| 4 | Venda `2000017810823298` congelada em `15.8558` | select por order_id → venda_id → custo |
| 5 | Venda de junho do `02841037` congelada em `17.1224` | select por date_created em junho |
| 6 | Planilha nova não muda venda anterior; muda a posterior | ver "decisão humana" abaixo |
  5. Sanidade de UI (leitura): abrir Faturamento/Financeiro e conferir que o markup da venda COLA
     de 07/08 mostra custo `31,71` (2 × 15,8558) — validação browser-use somente-leitura.
- **Critério 6 — decisão humana:** a prova completa exige subir uma planilha com custo novo
  (operação real do Diego). Alternativa sintética: `begin; update variacoes set custo = X where
  codigo = ...; select` a resolução congelada vs dinâmica; `rollback;` — não altera nada
  persistente. Recomendado: sintética agora + confirmação na próxima planilha real.
- **Depende de:** todas.

## Ordem de execução

T0 → T1 → T2 (T2 pode paralelizar com T1) → T3 → T4 → T5 → T6 → T7.

## Fora de escopo (mantido do design)

Sem escape de correção pela UI; dedupe de famílias (ADR-0108, projeto à parte); congelar
comissão/frete/imposto/peso; mudança visual.
