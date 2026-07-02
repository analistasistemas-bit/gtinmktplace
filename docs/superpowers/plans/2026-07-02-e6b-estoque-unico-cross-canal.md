# E6b — Estoque Único e Sincronização Cross-Canal — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estoque único por empresa: venda paga em qualquer marketplace dá **baixa atômica e idempotente** no estoque canônico e **propaga o novo estoque** para todos os outros canais onde o produto está publicado — com reconciliação periódica anti-oversell.

**Architecture:** Ledger `estoque_movimentos` (idempotência por referência única venda+item) + função SQL `baixar_estoque` (baixa atômica, nunca negativa) plugada no gancho `novaPaga` do `sync-venda` (o mesmo que já dispara Telegram/mensagem ao comprador) → job QStash `sincronizar-estoque` (fila serial por org, valores **absolutos** — push redundante é inofensivo) → método novo `atualizarEstoque` no `ChannelConnector` → reconciliação diária re-push. Falha de estoque **nunca** trava o sync da venda.

**Tech Stack:** Supabase (Postgres/plpgsql, Edge Functions Deno), QStash, `_shared/canais/*`, vitest.

**Dependências (ordem de execução):** executa **depois do E7** (org_id, `marketplace_connections`, `resolverConexao`/`getValidAccessTokenConexao`) **e do E6** (worker genérico, estado por canal em `anuncios_externos`, registry injetável, `fakeConnector`). O fio do 2º canal real (webhook de pedido da Shopee) liga quando o **E5** existir — Task 10. Com ML apenas, o épico já entrega o ledger auditável + a fundação provada por conector fake.

## Global Constraints

- **ADR-0043:** schema só via `supabase migration new` + `db push` + `npm run db:check`.
- **Deploy nunca defasado:** CLI completa; `verify_jwt` do `config.toml` preservado; workers novos (`sincronizar-estoque`, `reconciliar-estoque`) entram com `verify_jwt = false` + `verificarAssinatura` QStash.
- **A venda é sagrada:** nenhuma falha de baixa/push pode falhar o `sync-venda` (try/catch + log, mesmo padrão da mensagem ao comprador de 2026-06-29).
- **Baseline em todo checkpoint:** `pnpm test` + `npx tsc --noEmit` + `deno check` + `pnpm lint` + `pnpm build`; browser-use e `scripts/verificar-isolamento-tenant.ts` (E7) no gate final.
- **TDD** em toda função pura; PONTOS DE DEPLOY só com OK explícito do Diego.
- **Nomes fixos deste plano:** tabela `estoque_movimentos`; função SQL `baixar_estoque`; helper `registrarBaixaVenda` (`_shared/estoque/baixa.ts`); worker `sincronizar-estoque`; job agendado `reconciliar-estoque`; método `atualizarEstoque` + tipo `EstoquePorSku` no contrato; enfileirador `enfileirarSincronizacaoEstoque`; ADR `0054-estoque-unico-cross-canal.md`.

## Estado atual (fatos verificados no código em 2026-07-02)

- **Venda → SKU já existe:** `ml_vendas_itens` tem `codigo` (SKU interno da planilha), `quantity`, `ml_item_id`, `variation_id`, `venda_id` (`supabase/migrations/20260622193345_faturamento_vendas.sql:38-50`).
- **Gancho idempotente pronto:** `sync-venda/index.ts:55-60` — `upsertVenda` devolve `{ novaPaga, itens }`; o bloco `if (novaPaga)` dispara exatamente 1× por pedido pago (já usado por Telegram + mensagem ao comprador).
- **Estoque canônico:** `variacoes.codigo text not null` + `variacoes.estoque integer not null default 0` (`20260527125643_familias_variacoes.sql:91,94`). Nuance ADR-0025: `familias`/`variacoes` são **por-lote** — a linha canônica de um produto é a da família mais recente do `(org_id, codigo_pai)` (mesmo critério do dedupe de Publicados).
- **Push de estoque no ML:** `_shared/ml/atualizar.ts` — `VariacaoUpdate { id, available_quantity, picture_ids?, price?, original_price? }` (linha 62), padrão "só `available_quantity`, sem price" (linha 65, preserva preço de venda); **gotcha conhecido: o ML deleta variações omitidas** → todo push manda TODAS as variações do anúncio.
- **Webhook dedup:** `ml_webhook_eventos` unique `(topic, resource)` — re-entregas do ML já não reprocessam; o ledger dá a 2ª camada de idempotência (re-sync manual/backfill).
- **Split (ADR-0048):** um produto >100 cores vive em N partições do mesmo canal; cada cor existe em exatamente 1 partição; `anuncios_externos.variacoes_externas` (mapa `sku → {variation_id,...}`) diz qual anúncio contém cada SKU.

## Decisões travadas (para o ADR-0054, Task 1)

| # | Decisão | Racional |
|---|---|---|
| D-E6b.1 | **Estoque canônico = `variacoes.estoque` da família mais recente** por `(org_id, codigo_pai)`; a planilha **continua mandando** na importação (UPDATE de lote repõe estoque, como hoje) | Sem tabela nova de estoque (YAGNI); mesma âncora do ADR-0025. Corrida "planilha exportada antes de vendas recentes" é risco operacional documentado — mitigado pela reconciliação diária e pelo ledger (dá para auditar o que a planilha sobrescreveu). |
| D-E6b.2 | **Ledger `estoque_movimentos`** com idempotência por `(org_id, referencia_externa)` única — `referencia_externa = '{canal}:{order_id}:{codigo}'` | Baixa nunca aplica 2× (webhook re-entregue, backfill, reconciliar). Auditável (base p/ LGPD/E8 e p/ depurar divergência). |
| D-E6b.3 | Baixa dispara na **transição `novaPaga`** (pedido pago), não na criação do pedido | Pedido não-pago não reserva estoque no MVP (o próprio ML também só baixa ao pagar). Reserva de carrinho = fora de escopo. |
| D-E6b.4 | **Propagação por valor absoluto** (push do estoque atual), nunca delta; fila serial `estoque-{orgId}` (parallelism 1) | Push absoluto é idempotente e auto-corretivo; a fila serial garante ordem (2 vendas seguidas nunca aplicam estoque velho por cima do novo). |
| D-E6b.5 | Canal de **origem da venda não recebe push** (ele já baixou o próprio anúncio); no split, o push por SKU vai só à partição que contém o SKU (via `variacoes_externas`) | Evita eco e writes inúteis; respeita a ancoragem do ADR-0048. |
| D-E6b.6 | Contrato ganha `atualizarEstoque(ctx, itemExternoId, estoques, variacoesExternas)` + `Capabilities.atualizarEstoque: boolean`; ML implementa reusando `_shared/ml/atualizar.ts` (todas as variações, só `available_quantity`) | Método dedicado e barato por canal (Shopee tem `update_stock` nativo); não passa pelo pipeline pesado de UPDATE completo. |
| D-E6b.7 | **Devolução/cancelamento NÃO repõe estoque automaticamente** no MVP | Repor exige decisão comercial (produto voltou vendável?). O ledger prevê `motivo='ajuste_manual'`; automação fica como extensão futura (registrada no ADR). |
| D-E6b.8 | **Reconciliação = re-push absoluto diário** de todo produto com anúncio em ≥2 canais (job `reconciliar-estoque`), sem leitura por-variação dos canais no MVP | Rede de segurança contra webhook perdido, simples e robusta; leitura comparativa por variação é otimização futura. |

## Estrutura de arquivos

**Criar:**
- `docs/decisions/0054-estoque-unico-cross-canal.md`
- `supabase/migrations/<ts>_e6b_estoque_movimentos.sql`
- `supabase/functions/_shared/estoque/baixa.ts` + `__tests__/baixa.test.ts`
- `supabase/functions/sincronizar-estoque/index.ts`
- `supabase/functions/reconciliar-estoque/index.ts`
- (config.toml: 2 entradas `verify_jwt = false`)

**Modificar:**
- `_shared/canais/contrato.ts` (+`EstoquePorSku`, +método, +capability) · `_shared/canais/mercado-livre.ts` · `_shared/canais/fake.ts` (E6) · `_shared/queue.ts` (+`enfileirarSincronizacaoEstoque`) · `sync-venda/index.ts` (gancho) · front: expandir da Publicados (seção "Movimentos de estoque") + `src/lib/queries.ts` (`fetchMovimentosEstoque`)

---

### Task 1: ADR-0054 — Estoque único e sincronização cross-canal

**Files:** Create: `docs/decisions/0054-estoque-unico-cross-canal.md`

- [ ] **Step 1:** Escrever o ADR: Status Aceito; Contexto (estoque único por empresa; oversell cross-canal é o risco 🟠 do doc mestre §9; venda→SKU já persistida pelo ADR-0037); Decisão = tabela D-E6b.1..D-E6b.8 + diagrama do fluxo (webhook venda → `novaPaga` → `baixar_estoque` (ledger) → fila `estoque-{org}` → `sincronizar-estoque` → `conn.atualizarEstoque` nos canais ≠ origem); Alternativas rejeitadas (delta em vez de absoluto — não idempotente; tabela de estoque separada de `variacoes` — duplica fonte de verdade; baixa na criação do pedido — reserva sem pagamento); Consequências (extensões futuras: reposição em devolução, reserva, leitura comparativa por variação).
- [ ] **Step 2: Commit** — `git commit -m "docs(adr-0054): estoque único cross-canal — ledger idempotente + push absoluto"`

### Task 2: Pré-voo — revalidar as premissas herdadas de E7/E6

**Files:** nenhum — verificação executável.

- [ ] **Step 1:** Confirmar que os símbolos dos quais este plano depende existem exatamente como planejados (E7/E6 já executados):

```bash
rtk proxy grep -rn "export function resolverConexao" supabase/functions/_shared/canais/conexao.ts
rtk proxy grep -rn "getValidAccessTokenConexao" supabase/functions/_shared/ml/token.ts
rtk proxy grep -rn "org_id" supabase/migrations/ | grep -c e7          # migrations E7 aplicadas
rtk proxy grep -rn "registrarConectorParaTeste" supabase/functions/_shared/canais/registry.ts
rtk proxy grep -rln "fakeConnector" supabase/functions/_shared/canais/fake.ts
rtk proxy grep -n "claimAnuncioExterno" supabase/functions/_shared/anuncios/estado.ts
```

Expected: todos com match. **Qualquer divergência = parar e ajustar este plano antes de codar** (os nomes reais vencem os planejados).

### Task 3: Migration `e6b_estoque_movimentos` — ledger + baixa atômica

**Files:** Create: `supabase/migrations/<ts>_e6b_estoque_movimentos.sql`

**Interfaces:** Produces: tabela `estoque_movimentos`; função `public.baixar_estoque(p_org uuid, p_codigo text, p_qtd int, p_canal text, p_ref text) returns int` (service_role-only; retorna estoque resultante, ou `null` p/ duplicata/SKU órfão).

- [ ] **Step 1: Migration**

```sql
-- E6b (ADR-0054): ledger de movimentos + baixa atômica idempotente.
create table public.estoque_movimentos (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id),
  codigo             text not null,            -- SKU interno (variacoes.codigo)
  codigo_pai         text not null default '', -- preenchido ao resolver a variação
  quantidade         integer not null,         -- negativo = baixa
  motivo             text not null,            -- 'venda' | 'venda_sku_nao_encontrado' | 'ajuste_manual'
  canal_origem       text,
  referencia_externa text,                     -- '{canal}:{order_id}:{codigo}' — idempotência
  estoque_resultante integer,
  criado_em          timestamptz not null default now()
);
create unique index estoque_movimentos_ref_uniq
  on public.estoque_movimentos (org_id, referencia_externa)
  where referencia_externa is not null;
create index estoque_movimentos_org_pai_idx
  on public.estoque_movimentos (org_id, codigo_pai, criado_em desc);
alter table public.estoque_movimentos enable row level security;
create policy "estoque_movimentos: select org" on public.estoque_movimentos
  for select to authenticated using (org_id = (select public.current_org_id()));
-- escrita: só service_role (via baixar_estoque / workers).

create or replace function public.baixar_estoque(
  p_org uuid, p_codigo text, p_qtd integer, p_canal text, p_ref text
) returns integer language plpgsql security definer set search_path = ''
as $$
declare v_var uuid; v_pai text; v_novo integer;
begin
  -- 1) idempotência: 1 movimento por referência; duplicata sai sem tocar estoque.
  begin
    insert into public.estoque_movimentos
      (org_id, codigo, quantidade, motivo, canal_origem, referencia_externa)
    values (p_org, p_codigo, -p_qtd, 'venda', p_canal, p_ref);
  exception when unique_violation then
    return null;
  end;
  -- 2) variação canônica = a da família mais recente do produto (âncora ADR-0025).
  select v.id, f.codigo_pai into v_var, v_pai
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo
  order by f.criado_em desc
  limit 1;
  if v_var is null then
    update public.estoque_movimentos set motivo = 'venda_sku_nao_encontrado'
    where org_id = p_org and referencia_externa = p_ref;
    return null;
  end if;
  -- 3) baixa atômica, nunca negativa.
  update public.variacoes set estoque = greatest(0, estoque - p_qtd)
  where id = v_var
  returning estoque into v_novo;
  update public.estoque_movimentos
  set codigo_pai = v_pai, estoque_resultante = v_novo
  where org_id = p_org and referencia_externa = p_ref;
  return v_novo;
end $$;
revoke execute on function public.baixar_estoque(uuid, text, integer, text, text)
  from public, anon, authenticated;
```

- [ ] **Step 2:** `supabase db push && npm run db:check` → OK; `get_advisors` (security) limpo.
- [ ] **Step 3: Prova SQL** (leitura + service_role em ambiente de teste): chamar `baixar_estoque` 2× com a MESMA `p_ref` → 1º retorna estoque decrementado, 2º retorna `null` e o estoque **não** muda; SKU inexistente → movimento vira `venda_sku_nao_encontrado` e retorna `null`.
- [ ] **Step 4: Commit** — `git commit -m "feat(e6b): ledger estoque_movimentos + baixar_estoque atômico idempotente"`

**Reversão:** `drop function baixar_estoque; drop table estoque_movimentos;` — nada mais depende até a Task 5.

### Task 4: Contrato — `atualizarEstoque` + capability (ML + fake)

**Files:** Modify: `_shared/canais/contrato.ts` · `_shared/canais/mercado-livre.ts` · `_shared/canais/fake.ts` · Test: teste existente do conector ML + do fake

**Interfaces:** Produces (consumido pelas Tasks 6-8):

```ts
// contrato.ts
export interface EstoquePorSku { sku: string; estoque: number; }
export interface Capabilities { /* campos atuais */; atualizarEstoque: boolean; }
export interface ChannelConnector {
  /* métodos atuais inalterados */
  /** Push de estoque (valores ABSOLUTOS) para um anúncio. Não lança: erros viram ResultadoCanal.erro. */
  atualizarEstoque(
    ctx: ContextoCanal,
    itemExternoId: string,
    estoques: EstoquePorSku[],
    variacoesExternas: Record<string, string>, // sku -> variation_id no canal
  ): Promise<ResultadoCanal<void>>;
}
```

- [ ] **Step 1: Teste RED (ML):** dado um item com 3 variações no canal e `estoques` cobrindo 2, o payload enviado contém **as 3 variações** (gotcha: ML deleta omitidas), com `available_quantity` novo nas 2 e o atual preservado na 3ª; **sem** campo `price` (padrão de `atualizar.ts:65`).
- [ ] **Step 2: Implementar no `mercado-livre.ts`:** `buscarItemML(ctx, itemExternoId)` → montar `VariacaoUpdate[]` (todas as variações; para cada uma, se `variacoesExternas` mapeia um SKU presente em `estoques`, usa o valor novo; senão mantém `available_quantity` atual) → `atualizarItemML(ctx, itemExternoId, { variations })`. Erros → `classificarErroCanal` (mesmo contrato retentável/definitivo).
- [ ] **Step 3: fake.ts:** implementa gravando `{ itemExternoId, estoques }` em `chamadas` e devolvendo `{ ok: true }`; `capabilities.atualizarEstoque = true`. ML: `true`. (Canal futuro sem suporte declara `false` e o worker pula com log.)
- [ ] **Step 4:** Baseline verde. **Commit** — `git commit -m "feat(e6b): atualizarEstoque no contrato + impl ML (todas as variações) + fake (TDD)"`

### Task 5: `registrarBaixaVenda` — helper puro + gancho no `sync-venda`

**Files:** Create: `_shared/estoque/baixa.ts` + `__tests__/baixa.test.ts` · Modify: `supabase/functions/sync-venda/index.ts`

**Interfaces:**
- Produces: `registrarBaixaVenda(admin, p: { orgId: string; canal: string; orderId: string | number; itens: ItemVendaBaixa[] }): Promise<{ paisAfetados: string[] }>` com `ItemVendaBaixa = { codigo: string | null; quantity: number }` (forma exata dos itens que `upsertVenda` já devolve).

- [ ] **Step 1: Teste RED** da seleção pura (`selecionarBaixas(itens)`):

```ts
it('ignora item sem codigo e quantity<=0', () =>
  expect(selecionarBaixas([
    { codigo: null, quantity: 2 },
    { codigo: '02835002AZ', quantity: 0 },
    { codigo: '02835002RS', quantity: 3 },
  ])).toEqual([{ codigo: '02835002RS', quantity: 3 }]));
it('agrega o mesmo sku repetido no pedido', () =>
  expect(selecionarBaixas([
    { codigo: 'A1', quantity: 1 }, { codigo: 'A1', quantity: 2 },
  ])).toEqual([{ codigo: 'A1', quantity: 3 }]));
```

- [ ] **Step 2: Implementar** `selecionarBaixas` (pura) + `registrarBaixaVenda`: para cada baixa, `admin.rpc('baixar_estoque', { p_org: orgId, p_codigo, p_qtd, p_canal: canal, p_ref: `${canal}:${orderId}:${codigo}` })`; depois, 1 select em `estoque_movimentos` pelas refs para coletar `codigo_pai` distintos (preenchidos pela função SQL) → `paisAfetados`.
- [ ] **Step 3: Gancho** — `sync-venda/index.ts`, dentro do `if (novaPaga)` existente (linha ~60), **depois** dos disparos atuais:

```ts
try {
  const { paisAfetados } = await registrarBaixaVenda(admin, {
    orgId, canal: 'mercado_livre', orderId: pedido.id, itens,
  });
  for (const codigoPai of paisAfetados) {
    await enfileirarSincronizacaoEstoque(
      { org_id: orgId, codigo_pai: codigoPai, canal_origem: 'mercado_livre' }, orgId,
    );
  }
} catch (e) {
  console.error('baixa_estoque_falhou', e); // a venda NUNCA falha por estoque
}
```

- [ ] **Step 4:** Baseline; testes existentes do `sync-venda`/`venda.ts` intactos. **Commit** — `git commit -m "feat(e6b): baixa de estoque na transição novaPaga (idempotente, nunca trava a venda)"`

### Task 6: Fila + worker `sincronizar-estoque`

**Files:** Create: `supabase/functions/sincronizar-estoque/index.ts` · Modify: `_shared/queue.ts` · `supabase/config.toml`

**Interfaces:**

```ts
// _shared/queue.ts
export interface SincronizarEstoqueJob { org_id: string; codigo_pai: string; canal_origem: string | null; }
export async function enfileirarSincronizacaoEstoque(job: SincronizarEstoqueJob, orgId: string): Promise<string>
// fila serial `estoque-${orgId}` (parallelism 1 — pushes absolutos em ordem), retries: 3, retryDelay: '10000'
```

- [ ] **Step 1:** `config.toml`: `[functions.sincronizar-estoque]` `verify_jwt = false` (não tocar nas demais entradas). Implementar o enfileirador (mesmo padrão de `enfileirarPublicacaoCanal` do E6, com `garantirFilaSerialCanal('estoque-' + orgId)`).
- [ ] **Step 2: Worker** (estrutura completa):

```ts
Deno.serve(async (req) => {
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) return new Response('assinatura inválida', { status: 401 });
  const { org_id, codigo_pai, canal_origem } = JSON.parse(body) as SincronizarEstoqueJob;
  const admin = adminClient();

  // 1) estoque canônico ATUAL (família mais recente do produto — mesma âncora da baixa)
  const { data: familia } = await admin.from('familias')
    .select('id').eq('org_id', org_id).eq('codigo_pai', codigo_pai)
    .order('criado_em', { ascending: false }).limit(1).single();
  if (!familia) return Response.json({ skip: 'produto sem família' });
  const { data: variacoes } = await admin.from('variacoes')
    .select('codigo, estoque').eq('familia_id', familia.id);
  const estoques = (variacoes ?? []).map((v) => ({ sku: v.codigo, estoque: v.estoque }));

  // 2) anúncios do produto nos canais ≠ origem
  const { data: anuncios } = await admin.from('anuncios_externos')
    .select('canal, item_externo_id, variacoes_externas')
    .eq('org_id', org_id).eq('codigo_pai', codigo_pai)
    .eq('status', 'publicado').not('item_externo_id', 'is', null);
  const alvos = (anuncios ?? []).filter((a) => a.canal !== canal_origem);

  // 3) push absoluto por anúncio (partições: só os SKUs que o anúncio contém — variacoes_externas)
  const falhasRetentaveis: string[] = [];
  for (const a of alvos) {
    const conexao = await resolverConexao(admin, org_id, a.canal);
    if (!conexao) continue;                       // canal desconectado: nada a fazer
    const conn = getConnector(a.canal);
    if (!conn.capabilities.atualizarEstoque) continue;
    const ctx = { getToken: () => getValidAccessTokenConexao(conexao) };
    const mapa = (a.variacoes_externas ?? {}) as Record<string, { variation_id?: string }>;
    const skusDoAnuncio = new Set(Object.keys(mapa));
    const doAnuncio = estoques.filter((e) => skusDoAnuncio.size === 0 || skusDoAnuncio.has(e.sku));
    const vx = Object.fromEntries(Object.entries(mapa).map(([sku, v]) => [sku, String(v.variation_id ?? '')]));
    const r = await conn.atualizarEstoque(ctx, a.item_externo_id!, doAnuncio, vx);
    if (!r.ok && r.erro?.retentavel) falhasRetentaveis.push(`${a.canal}:${a.item_externo_id}`);
    if (!r.ok && !r.erro?.retentavel) console.error('estoque_push_definitivo', a.canal, a.item_externo_id, r.erro);
  }
  if (falhasRetentaveis.length) return new Response(JSON.stringify({ retry: falhasRetentaveis }), { status: 500 }); // QStash retenta (push é absoluto: repetir é seguro)
  return Response.json({ ok: true, alvos: alvos.length });
});
```

- [ ] **Step 3: Teste de integração com o fake** (registrar `fakeConnector` + extrair o miolo para `processarSincronizacao(deps)` se necessário): venda no canal `mercado_livre` de produto publicado em `mercado_livre` + `fake` → o fake recebe exatamente os valores absolutos atuais; o ML (origem) **não** recebe push; erro retentável no fake → resposta 500.
- [ ] **Step 4:** Baseline + `deno check`. **Commit** — `git commit -m "feat(e6b): worker sincronizar-estoque — push absoluto por canal, fila serial por org"`

### Task 7: Reconciliação diária `reconciliar-estoque`

**Files:** Create: `supabase/functions/reconciliar-estoque/index.ts` · Modify: `supabase/config.toml`

- [ ] **Step 1:** `config.toml`: `verify_jwt = false`. Worker: valida assinatura; para cada org com ≥2 conexões (`marketplace_connections group by org_id having count(*) >= 2` — com só ML no ar, é no-op barato), lista os `codigo_pai` distintos com anúncio `publicado` em ≥2 canais e enfileira `enfileirarSincronizacaoEstoque({ org_id, codigo_pai, canal_origem: null })` (origem null = push para TODOS os canais). Try/catch por org (uma org nunca bloqueia outra).
- [ ] **Step 2:** Baseline + deploy (com OK). **PENDENTE (Diego, infra):** QStash schedule diário (ex.: `30 12 * * *` UTC ≈ 09h30 BRT) → `.../functions/v1/reconciliar-estoque` — mesmo procedimento do `notificar-liberacao`.
- [ ] **Step 3: Commit** — `git commit -m "feat(e6b): reconciliação diária de estoque (re-push absoluto multi-canal)"`

### Task 8: UI — Movimentos de estoque no expandir da Publicados

**Files:** Modify: `src/lib/queries.ts` · componente do expandir da linha de Publicados (o mesmo do "Análise para publicação", 2026-06-24)

- [ ] **Step 1:** `fetchMovimentosEstoque(codigoPai: string): Promise<MovimentoEstoque[]>` — select em `estoque_movimentos` por `codigo_pai` (RLS da org filtra), `order criado_em desc limit 20`; tipo `MovimentoEstoque { criado_em, codigo, quantidade, motivo, canal_origem, estoque_resultante }`. Query key `QK.movimentosEstoque(codigoPai)`.
- [ ] **Step 2:** Seção "Movimentos de estoque" no painel expandido (lazy, só busca ao expandir — padrão do `useFamilia` existente): tabela compacta data · SKU · qtd · canal · estoque resultante; vazia → "Nenhum movimento registrado". Light+dark.
- [ ] **Step 3:** Teste de lógica pura (formatação/ordenação) + baseline + browser-use. **Commit** — `git commit -m "feat(e6b): movimentos de estoque visíveis no expandir da Publicados"`

### Task 9: Baixa manual/ajuste (escape hatch do operador)

**Files:** Modify: edge `atributos-familia`? **Não** — nova action na edge existente de edição inline **não** é necessária: o operador já edita `variacoes.estoque` inline na Revisão (persistência direta com RLS). O que falta é **registrar o movimento** e **propagar**.

- [ ] **Step 1:** Trigger leve na tabela (mesma migration da Task 3 ou nova): `AFTER UPDATE OF estoque ON variacoes` quando `auth.uid() is not null` (edição humana, não worker) → insere movimento `motivo='ajuste_manual'` com `quantidade = new.estoque - old.estoque` e `referencia_externa = null` (ajuste não precisa de idempotência).
- [ ] **Step 2:** A propagação do ajuste manual **não** é automática no MVP (o operador ajustou porque quis; o re-push diário da Task 7 propaga em ≤24h; se quiser imediato, republicar/UPDATE já existe). Registrado no ADR (D-E6b.7 estendida).
- [ ] **Step 3:** Baseline + prova SQL (editar estoque inline → movimento `ajuste_manual` aparece). **Commit** — `git commit -m "feat(e6b): ajuste manual de estoque registrado no ledger"`

### Task 10: Fio do 2º canal (BLOQUEADA pelo E5 — descrita para o encaixe ser trivial)

Quando o E5 (Shopee) entregar leitura de pedidos/webhook:

- [ ] **Step 1:** No worker de venda da Shopee (equivalente ao `sync-venda`), na transição para pago: `registrarBaixaVenda(admin, { orgId, canal: 'shopee', orderId, itens })` + `enfileirarSincronizacaoEstoque({ org_id, codigo_pai, canal_origem: 'shopee' })` — o helper e a ref `'{canal}:{order_id}:{codigo}'` já são canal-agnósticos por construção (Task 5).
- [ ] **Step 2:** `ShopeeConnector.atualizarEstoque` → `update_stock` nativo (batch ~50 models), `capabilities.atualizarEstoque = true`.
- [ ] **Step 3:** E2E real: venda de teste no ML → estoque baixa → anúncio Shopee atualiza (e vice-versa). **Este é o critério de saída pleno do épico.**

### Task 11: Gate final

- [ ] **Step 1:** Suite completa + tsc + deno check + lint + build verdes; integração com fake cobrindo: baixa idempotente (2ª entrega = no-op), venda multi-item, SKU órfão (loga, não quebra), push só nos canais ≠ origem, split (push por partição correta), erro retentável → 500.
- [ ] **Step 2:** `scripts/verificar-isolamento-tenant.ts` re-run — `estoque_movimentos` entra na lista `TABELAS` do script (org B não vê movimentos da Avil).
- [ ] **Step 3:** Browser-use: venda real (ou simulada via backfill de pedido de teste) → movimento aparece na Publicados; estoque canônico bateu.
- [ ] **Step 4: Docs:** `modelo-de-dados.md` (ledger), `edge-functions.md` (2 workers novos), `arquitetura.md` (diagrama do fluxo), `project-status.md` + `TASKS.md`, obsidian-vault, Graphify re-ingest.

---

## Critério de saída do E6b

1. ✅ Venda paga no ML → baixa atômica idempotente no estoque canônico (ledger prova: 1 movimento por venda+item, re-entrega não duplica).
2. ✅ Push absoluto para os demais canais em ≤1 job de fila (provado com fake; ordem garantida pela fila serial por org).
3. ✅ Reconciliação diária re-push para todo produto multi-canal + ajuste manual registrado no ledger.
4. ✅ Falha de estoque nunca falha a venda; falha de um canal nunca afeta outro; isolamento cross-tenant re-validado.
5. ⏳ **Pleno (bloqueado pelo E5):** venda no ML atualiza anúncio Shopee real e vice-versa (Task 10).

## Self-review (executado na escrita do plano)

- **Cobertura:** baixa (Tasks 3, 5) · propagação (4, 6) · reconciliação (7) · visibilidade (8) · ajuste manual (9) · 2º canal (10) · prova (11). Riscos do doc mestre §9 (oversell) endereçados por D-E6b.4/D-E6b.8.
- **Placeholders:** nenhum "TBD". Dois pontos dependem de artefatos do E6 ainda não executado (`enfileirarPublicacaoCanal`/`garantirFilaSerialCanal`, `fakeConnector`) — por isso a Task 2 (pré-voo) é bloqueante e os nomes estão travados nos dois planos.
- **Consistência de tipos:** `EstoquePorSku`/`SincronizarEstoqueJob`/`registrarBaixaVenda`/`baixar_estoque` idênticos entre tasks; `itens` do gancho = mesma forma que `upsertVenda` devolve hoje (`codigo`, `quantity` — verificado em `ml_vendas_itens`).
