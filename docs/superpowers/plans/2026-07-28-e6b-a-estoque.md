# E6b Bloco A — Estoque (ledger, baixa por venda, push cross-canal) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toda venda paga baixa o estoque de forma atômica e idempotente, e todo movimento de estoque (venda, entrada, ajuste, estorno) propaga o saldo absoluto para os marketplaces onde o produto está publicado.

**Architecture:** Ledger `estoque_movimentos` (idempotência por `(org_id, referencia_externa)`) + funções SQL atômicas `baixar_estoque`/`estornar_estoque`/`registrar_entrada`, plugadas no gancho `novaPaga` que já existe no `sync-venda` → fila serial QStash `estoque-{orgId}` → worker `sincronizar-estoque` → método novo `atualizarEstoque` no `ChannelConnector`. Push é sempre **valor absoluto** (idempotente e auto-corretivo), nunca delta.

**Tech Stack:** Supabase (Postgres/plpgsql, Edge Functions Deno), QStash, `_shared/canais/*`, vitest.

**Spec:** `docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md` (decisões D-5 a D-12, D-15).

**Bloco B** (cadastro manual + entrada pela UI) é um plano separado que consome o ledger e as RPCs criadas aqui: `docs/superpowers/plans/2026-07-28-e6b-b-cadastro-e-entrada.md`.

## Global Constraints

- **ADR-0043:** schema só via `supabase migration new` + `supabase db push` + `npm run db:check`. Nunca `apply_migration` nem painel para DDL.
- **A venda é sagrada:** nenhuma falha de baixa ou de push pode fazer o `sync-venda` falhar. `try/catch` + `console.error`, mesmo padrão da mensagem automática ao comprador.
- **Deploy nunca defasado:** mudança em `supabase/functions/**` exige `supabase functions deploy` da CLI. Workers novos entram com `verify_jwt = false` em `config.toml` **e** `verificarAssinatura` do QStash no corpo da função.
- **Escrita de estoque só por `service_role`** (D-15): as três RPCs são `security definer` com `revoke execute ... from public, anon, authenticated`.
- **Baseline em todo checkpoint:** `pnpm test` + `npx tsc --noEmit` + `pnpm lint` + `pnpm build` + `deno check` nas funções tocadas.
- **TDD obrigatório** em toda função pura. Teste RED antes da implementação, sempre.
- **PONTOS DE DEPLOY só com OK explícito do Diego.**
- **Nomes fixos deste plano (não renomear entre tasks):** tabela `estoque_movimentos`; funções SQL `baixar_estoque`, `estornar_estoque`, `registrar_entrada`; helper `registrarBaixaVenda` e função pura `selecionarBaixas` em `_shared/estoque/baixa.ts`; worker `sincronizar-estoque`; worker `reconciliar-estoque`; enfileirador `enfileirarSincronizacaoEstoque`; tipos `EstoquePorSku` e `SincronizarEstoqueJob`; método de contrato `atualizarEstoque`; capability `atualizarEstoque`; ADR `0054-estoque-unico-cadastro-manual.md`.

## File Structure

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `docs/decisions/0054-estoque-unico-cadastro-manual.md` | ADR das decisões D-1..D-15 |
| `supabase/migrations/<ts>_e6b_estoque_movimentos.sql` | Ledger + 3 RPCs atômicas + trigger de ajuste manual |
| `supabase/functions/_shared/estoque/baixa.ts` | `selecionarBaixas` (pura) + `registrarBaixaVenda` (I/O) |
| `supabase/functions/_shared/estoque/__tests__/baixa.test.ts` | Testes da seleção pura |
| `supabase/functions/_shared/estoque/alvos.ts` | `resolverAlvosPush` (pura): linhas do banco → lista de pushes por item externo |
| `supabase/functions/_shared/estoque/__tests__/alvos.test.ts` | Testes da resolução de alvos (variações, item plano, UP, split) |
| `supabase/functions/sincronizar-estoque/index.ts` | Worker de push absoluto por canal |
| `supabase/functions/reconciliar-estoque/index.ts` | Job diário de re-push |

**Modificar:**

| Arquivo | Mudança |
|---|---|
| `supabase/functions/_shared/canais/contrato.ts` | `+EstoquePorSku`, `+atualizarEstoque` em `ChannelConnector`, `+atualizarEstoque` em `Capabilities` |
| `supabase/functions/_shared/canais/mercado-livre.ts` | Implementa `atualizarEstoque` (3 formas: variações, item plano, erro LOUD) |
| `supabase/functions/_shared/canais/fake.ts` | Implementa `atualizarEstoque` gravando em `chamadas` |
| `supabase/functions/_shared/queue.ts` | `+SincronizarEstoqueJob`, `+enfileirarSincronizacaoEstoque` |
| `supabase/functions/sync-venda/index.ts` | Gancho de baixa dentro do `if (novaPaga)` + estorno em cancelamento |
| `supabase/config.toml` | 2 entradas `verify_jwt = false` |
| `src/lib/queries.ts` | `+fetchMovimentosEstoque` |
| `src/lib/query-keys.ts` (ou onde vive `QK`) | `+QK.movimentosEstoque` |
| Componente do expandir de Publicados | Seção "Movimentos de estoque" |
| `scripts/verificar-isolamento-tenant.ts` | `estoque_movimentos` na lista de tabelas |

---

### Task 1: ADR-0054

**Files:**
- Create: `docs/decisions/0054-estoque-unico-cadastro-manual.md`

**Interfaces:**
- Consumes: nada.
- Produces: documento de referência citado por todas as tasks seguintes.

- [ ] **Step 1: Escrever o ADR**

Use o formato dos ADRs existentes em `docs/decisions/` (leia `0089-atualizacao-rapida-de-estoque.md` como molde de estilo). Conteúdo obrigatório:

- **Status:** Aceito · **Data:** 2026-07-28
- **Contexto:** estoque hoje flui só PubliAI → ML na publicação; `sync-venda` grava `ml_vendas`/`ml_vendas_itens` e não toca `variacoes`; oversell cross-canal é o risco que trava o multicanal; produto só entra por planilha, o que exige ERP do cliente.
- **Decisão:** copie a tabela D-1..D-15 da seção 5 da spec `docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md`, **verbatim**.
- **Diagrama do fluxo:** copie o bloco ASCII da seção 6 da spec.
- **Alternativas rejeitadas:** (a) `lote_id` nullable — custo verificado em 6 frentes, duas em código que publica anúncio real; (b) delta em vez de push absoluto — não é idempotente, um retry duplica a correção; (c) tabela `produtos` separada — duplica a fonte de verdade do produto; (d) custo médio ponderado — cálculo num caminho financeiro sem demanda; (e) emissão de NF-e — ver seção 11 da spec.
- **Consequências:** extensões futuras registradas — importação do XML de compra, reposição automática em devolução, custo médio ponderado, leitura comparativa por variação na reconciliação.

- [ ] **Step 2: Registrar no índice do vault**

Adicione uma linha para o ADR-0054 em `obsidian-vault/04-Decisões/Índice de ADRs.md`, seguindo exatamente o formato das linhas vizinhas.

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0054-estoque-unico-cadastro-manual.md "obsidian-vault/04-Decisões/Índice de ADRs.md"
git commit -m "docs(adr-0054): estoque único, cadastro manual e entrada de mercadoria"
```

---

### Task 2: Pré-voo — revalidar as premissas herdadas

**Files:** nenhum. Verificação executável.

**Interfaces:**
- Consumes: nada.
- Produces: confirmação de que os símbolos usados nas tasks 4-9 existem com estes nomes.

- [ ] **Step 1: Confirmar que todos os símbolos existem**

```bash
rtk proxy grep -n "export async function resolverConexao" supabase/functions/_shared/canais/conexao.ts
rtk proxy grep -n "getValidAccessTokenConexao" supabase/functions/_shared/ml/token.ts
rtk proxy grep -n "export function getConnector" supabase/functions/_shared/canais/registry.ts
rtk proxy grep -n "export function registrarConectorParaTeste" supabase/functions/_shared/canais/registry.ts
rtk proxy grep -n "export function montarVariacoesUpdate" supabase/functions/_shared/ml/atualizar.ts
rtk proxy grep -n "export async function buscarItemML" supabase/functions/_shared/ml/atualizar-item.ts
rtk proxy grep -n "export async function atualizarItemML" supabase/functions/_shared/ml/atualizar-item.ts
rtk proxy grep -n "export async function atualizarItemPlanoML" supabase/functions/_shared/ml/atualizar-item.ts
rtk proxy grep -n "export async function garantirFilaSerialCanal" supabase/functions/_shared/queue.ts
rtk proxy grep -n "export async function notificarCategoria" supabase/functions/_shared/notificacoes/config.ts
rtk proxy grep -n "novaPaga" supabase/functions/sync-venda/index.ts
rtk proxy grep -n "export async function verificarAssinatura" supabase/functions/_shared/qstash.ts
```

Expected: **todos com match**. Qualquer divergência = **parar e ajustar este plano antes de codar** — os nomes reais do código vencem os nomes deste plano.

- [ ] **Step 2: Confirmar a forma dos `itens` que o `upsertVenda` devolve**

```bash
rtk proxy grep -n "itens" supabase/functions/_shared/faturamento/venda.ts | rtk proxy head -20
```

Expected: cada item tem pelo menos `codigo: string | null` e `quantity: number`. O helper da Task 5 depende disso. Se os nomes forem outros, ajuste a interface `ItemVendaBaixa` na Task 5 para bater com a realidade.

- [ ] **Step 3: Rodar o baseline atual e anotar o número de testes**

```bash
pnpm test 2>&1 | tail -20
```

Anote o total de testes que passa hoje. Toda task seguinte deve manter esse número **ou maior**, nunca menor.

---

### Task 3: Migration — ledger + 3 RPCs atômicas + trigger de ajuste manual

**Files:**
- Create: `supabase/migrations/<timestamp>_e6b_estoque_movimentos.sql` (gere o timestamp com `supabase migration new e6b_estoque_movimentos`)

**Interfaces:**
- Consumes: `public.organizations`, `public.familias`, `public.variacoes`, `public.current_org_id()` (todos já existem).
- Produces, consumidos pelas Tasks 5, 7, 8 e pelo Bloco B:
  - `public.baixar_estoque(p_org uuid, p_codigo text, p_qtd integer, p_canal text, p_ref text) returns integer`
  - `public.estornar_estoque(p_org uuid, p_codigo text, p_qtd integer, p_canal text, p_ref text) returns integer`
  - `public.registrar_entrada(p_org uuid, p_codigo text, p_qtd integer, p_custo numeric, p_doc text, p_criado_por uuid) returns integer`
  - tabela `public.estoque_movimentos`

- [ ] **Step 1: Criar o arquivo de migration**

```bash
supabase migration new e6b_estoque_movimentos
```

- [ ] **Step 2: Escrever o DDL da tabela**

```sql
-- E6b (ADR-0054): ledger de movimentos de estoque + operações atômicas idempotentes.
-- Toda escrita de estoque passa por estas funções (D-15); o app só lê a tabela.

create table public.estoque_movimentos (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id),
  codigo             text not null,             -- SKU interno (variacoes.codigo)
  codigo_pai         text not null default '',  -- preenchido ao resolver a variação canônica
  quantidade         integer not null,          -- negativo = baixa, positivo = entrada/estorno
  motivo             text not null,
  canal_origem       text,
  referencia_externa text,                      -- idempotência; null = movimento manual
  custo_unitario     numeric(12,2),             -- só em 'entrada'
  documento          text,                      -- NF do fornecedor / observação curta
  estoque_anterior   integer,                   -- saldo ANTES do movimento
  estoque_resultante integer,
  criado_por         uuid references auth.users(id),
  criado_em          timestamptz not null default now(),
  constraint estoque_movimentos_motivo_check check (motivo in (
    'venda', 'entrada', 'ajuste_manual', 'estorno_venda', 'venda_sku_nao_encontrado'
  ))
);

-- Idempotência: 1 movimento por referência externa. Movimento manual (ref null) fica de fora.
create unique index estoque_movimentos_ref_uniq
  on public.estoque_movimentos (org_id, referencia_externa)
  where referencia_externa is not null;

create index estoque_movimentos_org_pai_idx
  on public.estoque_movimentos (org_id, codigo_pai, criado_em desc);
create index estoque_movimentos_org_codigo_idx
  on public.estoque_movimentos (org_id, codigo, criado_em desc);

alter table public.estoque_movimentos enable row level security;

create policy "estoque_movimentos: select org" on public.estoque_movimentos
  for select to authenticated using (org_id = (select public.current_org_id()));
-- Sem policy de escrita: só service_role, via as funções abaixo.
```

- [ ] **Step 3: Escrever `baixar_estoque`**

```sql
-- Baixa atômica e idempotente. Devolve o estoque resultante, ou null quando a
-- referência já foi aplicada (duplicata) ou o SKU não existe na org.
create or replace function public.baixar_estoque(
  p_org uuid, p_codigo text, p_qtd integer, p_canal text, p_ref text
) returns integer language plpgsql security definer set search_path = ''
as $$
declare v_var uuid; v_pai text; v_antes integer; v_novo integer;
begin
  if p_qtd is null or p_qtd <= 0 then
    raise exception 'baixar_estoque: quantidade deve ser positiva (recebeu %)', p_qtd;
  end if;

  -- 1) Idempotência: a unique parcial rejeita a 2ª aplicação da mesma referência.
  begin
    insert into public.estoque_movimentos
      (org_id, codigo, quantidade, motivo, canal_origem, referencia_externa)
    values (p_org, p_codigo, -p_qtd, 'venda', p_canal, p_ref);
  exception when unique_violation then
    return null;
  end;

  -- 2) Variação canônica = a da família mais recente do produto (âncora ADR-0025).
  --    Guardamos o saldo ANTES da baixa: é o que torna "vendeu sem saldo" uma
  --    comparação local (anterior < pedido), sem reconstruir histórico por timestamp.
  select v.id, f.codigo_pai, v.estoque into v_var, v_pai, v_antes
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

  -- 3) Baixa atômica, nunca negativa (D-8). O ledger guarda a quantidade REAL vendida.
  update public.variacoes set estoque = greatest(0, estoque - p_qtd)
  where id = v_var
  returning estoque into v_novo;

  update public.estoque_movimentos
  set codigo_pai = v_pai, estoque_anterior = v_antes, estoque_resultante = v_novo
  where org_id = p_org and referencia_externa = p_ref;

  return v_novo;
end $$;
```

- [ ] **Step 4: Escrever `estornar_estoque`**

```sql
-- Reposição por cancelamento antes do despacho (D-7). Espelha baixar_estoque com
-- sinal invertido e referência própria, então é idempotente independentemente da baixa.
create or replace function public.estornar_estoque(
  p_org uuid, p_codigo text, p_qtd integer, p_canal text, p_ref text
) returns integer language plpgsql security definer set search_path = ''
as $$
declare v_var uuid; v_pai text; v_novo integer;
begin
  if p_qtd is null or p_qtd <= 0 then
    raise exception 'estornar_estoque: quantidade deve ser positiva (recebeu %)', p_qtd;
  end if;

  begin
    insert into public.estoque_movimentos
      (org_id, codigo, quantidade, motivo, canal_origem, referencia_externa)
    values (p_org, p_codigo, p_qtd, 'estorno_venda', p_canal, p_ref);
  exception when unique_violation then
    return null;
  end;

  select v.id, f.codigo_pai into v_var, v_pai
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo
  order by f.criado_em desc
  limit 1;

  if v_var is null then
    delete from public.estoque_movimentos
    where org_id = p_org and referencia_externa = p_ref;
    return null;
  end if;

  update public.variacoes set estoque = estoque + p_qtd
  where id = v_var
  returning estoque into v_novo;

  update public.estoque_movimentos
  set codigo_pai = v_pai, estoque_resultante = v_novo
  where org_id = p_org and referencia_externa = p_ref;

  return v_novo;
end $$;
```

- [ ] **Step 5: Escrever `registrar_entrada`**

```sql
-- Entrada de mercadoria (D-9). Custo é caminho financeiro (ADR-0055): valor inválido
-- FALHA em vez de virar default silencioso; custo ausente soma quantidade sem tocar o custo.
create or replace function public.registrar_entrada(
  p_org uuid, p_codigo text, p_qtd integer, p_custo numeric, p_doc text, p_criado_por uuid
) returns integer language plpgsql security definer set search_path = ''
as $$
declare v_var uuid; v_pai text; v_novo integer;
begin
  if p_qtd is null or p_qtd <= 0 then
    raise exception 'registrar_entrada: quantidade deve ser positiva (recebeu %)', p_qtd;
  end if;
  if p_custo is not null and p_custo <= 0 then
    raise exception 'registrar_entrada: custo deve ser positivo quando informado (recebeu %)', p_custo;
  end if;

  select v.id, f.codigo_pai into v_var, v_pai
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo
  order by f.criado_em desc
  limit 1;

  if v_var is null then
    raise exception 'registrar_entrada: SKU % não encontrado na organização', p_codigo;
  end if;

  update public.variacoes
  set estoque = estoque + p_qtd,
      custo   = coalesce(p_custo, custo)
  where id = v_var
  returning estoque into v_novo;

  insert into public.estoque_movimentos
    (org_id, codigo, codigo_pai, quantidade, motivo, custo_unitario, documento,
     estoque_resultante, criado_por)
  values (p_org, p_codigo, v_pai, p_qtd, 'entrada', p_custo, p_doc, v_novo, p_criado_por);

  return v_novo;
end $$;
```

- [ ] **Step 6: Escrever o trigger de ajuste manual e revogar as permissões**

```sql
-- Ajuste manual: edição humana de variacoes.estoque na UI vira movimento no ledger.
-- auth.uid() é NULL quando quem escreve é service_role (as RPCs acima), então
-- entrada/baixa/estorno NÃO disparam um segundo movimento aqui (D-15).
create or replace function public.registrar_ajuste_manual_estoque()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_pai text;
begin
  if new.estoque = old.estoque or auth.uid() is null then
    return new;
  end if;
  select f.codigo_pai into v_pai from public.familias f where f.id = new.familia_id;
  insert into public.estoque_movimentos
    (org_id, codigo, codigo_pai, quantidade, motivo, estoque_resultante, criado_por)
  values (new.org_id, new.codigo, coalesce(v_pai, ''), new.estoque - old.estoque,
          'ajuste_manual', new.estoque, auth.uid());
  return new;
end $$;

create trigger variacoes_registrar_ajuste_manual
  after update of estoque on public.variacoes
  for each row execute procedure public.registrar_ajuste_manual_estoque();

revoke execute on function public.baixar_estoque(uuid, text, integer, text, text)
  from public, anon, authenticated;
revoke execute on function public.estornar_estoque(uuid, text, integer, text, text)
  from public, anon, authenticated;
revoke execute on function public.registrar_entrada(uuid, text, integer, numeric, text, uuid)
  from public, anon, authenticated;
```

- [ ] **Step 7: Aplicar e validar o schema**

```bash
supabase db push
npm run db:check
```

Expected: ambos OK, sem erro. Rode também o advisor de segurança do Supabase e confirme que ele **não** aponta achado novo de RLS em `estoque_movimentos`.

- [ ] **Step 8: Prova SQL da idempotência e dos guards**

Contra o banco **local** (`supabase db reset` antes, para não sujar produção), com uma org e um SKU de teste já existentes, execute e confira cada expectativa:

```sql
-- A) Baixa aplica uma vez só.
select public.baixar_estoque('<org>', '<sku>', 3, 'mercado_livre', 'mercado_livre:999:<sku>');
-- Expected: estoque anterior menos 3.
select public.baixar_estoque('<org>', '<sku>', 3, 'mercado_livre', 'mercado_livre:999:<sku>');
-- Expected: NULL, e select estoque from variacoes NÃO mudou.

-- B) SKU inexistente vira movimento marcado, não erro.
select public.baixar_estoque('<org>', 'SKU-QUE-NAO-EXISTE', 1, 'mercado_livre', 'mercado_livre:998:x');
-- Expected: NULL, e existe 1 linha com motivo='venda_sku_nao_encontrado'.

-- C) Nunca negativo.
select public.baixar_estoque('<org>', '<sku>', 999999, 'mercado_livre', 'mercado_livre:997:<sku>');
-- Expected: 0, e o movimento gravou quantidade = -999999 (a quantidade REAL vendida).

-- D) Estorno é independente da baixa.
select public.estornar_estoque('<org>', '<sku>', 3, 'mercado_livre', 'estorno:mercado_livre:999:<sku>');
-- Expected: estoque + 3.
select public.estornar_estoque('<org>', '<sku>', 3, 'mercado_livre', 'estorno:mercado_livre:999:<sku>');
-- Expected: NULL, estoque não mudou.

-- E) Entrada: custo inválido FALHA, ausente não toca o custo.
select public.registrar_entrada('<org>', '<sku>', 10, 0, 'NF 123', null);
-- Expected: ERRO "custo deve ser positivo quando informado".
select public.registrar_entrada('<org>', '<sku>', 10, null, 'NF 123', null);
-- Expected: estoque + 10, e variacoes.custo INALTERADO.
select public.registrar_entrada('<org>', '<sku>', 5, 12.50, 'NF 124', null);
-- Expected: estoque + 5, e variacoes.custo = 12.50.

-- F) Trigger de ajuste manual não dispara para service_role.
-- Confirme que os passos A-E NÃO criaram nenhuma linha com motivo='ajuste_manual'.
select count(*) from public.estoque_movimentos where motivo = 'ajuste_manual';
-- Expected: 0.
```

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(e6b): ledger estoque_movimentos + baixar/estornar/registrar_entrada atômicos"
```

**Reversão:** `drop trigger variacoes_registrar_ajuste_manual on public.variacoes; drop function public.registrar_ajuste_manual_estoque, public.baixar_estoque, public.estornar_estoque, public.registrar_entrada; drop table public.estoque_movimentos;` — nada depende até a Task 5.

---

### Task 4: Contrato `atualizarEstoque` + implementação ML + fake

**Files:**
- Modify: `supabase/functions/_shared/canais/contrato.ts`
- Modify: `supabase/functions/_shared/canais/mercado-livre.ts`
- Modify: `supabase/functions/_shared/canais/fake.ts`
- Test: `supabase/functions/_shared/canais/__tests__/estoque-ml.test.ts` (criar)

**Interfaces:**
- Consumes: `buscarItemML`, `atualizarItemML`, `atualizarItemPlanoML` (`_shared/ml/atualizar-item.ts`), `montarVariacoesUpdate` (`_shared/ml/atualizar.ts`), `classificarErroCanal` (já usado em `mercado-livre.ts`).
- Produces, consumido pela Task 7:

```ts
export interface EstoquePorSku { sku: string; estoque: number }
// em Capabilities: atualizarEstoque: boolean
// em ChannelConnector:
atualizarEstoque(
  ctx: ContextoCanal,
  itemExternoId: string,
  estoques: EstoquePorSku[],
): Promise<ResultadoCanal<void>>
```

**Nota de desenho:** o método **não** recebe `variacoesExternas`. `montarVariacoesUpdate` casa por `seller_custom_field` (que é o SKU interno), então o próprio item do ML carrega o vínculo. Quem resolve qual SKU vive em qual item externo é o worker (Task 7), não o conector.

- [ ] **Step 1: Escrever o teste RED**

Crie `supabase/functions/_shared/canais/__tests__/estoque-ml.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { montarVariacoesUpdate } from '../../ml/atualizar';

describe('push de estoque: montagem das variações', () => {
  const atuais = [
    { id: 1, seller_custom_field: 'A1', available_quantity: 5, picture_ids: ['p1'], cor: 'Azul', price: 10 },
    { id: 2, seller_custom_field: 'A2', available_quantity: 7, picture_ids: ['p2'], cor: 'Rosa', price: 10 },
    { id: 3, seller_custom_field: 'A3', available_quantity: 9, picture_ids: ['p3'], cor: 'Verde', price: 10 },
  ];

  it('reenvia TODAS as variações — o ML deleta as omitidas', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: 'A1', estoque: 2 }], undefined, null, null, undefined, true);
    expect(r).toHaveLength(3);
    expect(r.map((v) => v.id)).toEqual([1, 2, 3]);
  });

  it('aplica o estoque novo só nos SKUs cobertos e preserva o atual nos demais', () => {
    const r = montarVariacoesUpdate(
      atuais,
      [{ codigo: 'A1', estoque: 2 }, { codigo: 'A3', estoque: 0 }],
      undefined, null, null, undefined, true,
    );
    expect(r.find((v) => v.id === 1)!.available_quantity).toBe(2);
    expect(r.find((v) => v.id === 2)!.available_quantity).toBe(7);
    expect(r.find((v) => v.id === 3)!.available_quantity).toBe(0);
  });

  it('nunca envia price nem original_price em push de estoque', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: 'A1', estoque: 2 }], undefined, null, null, undefined, true);
    for (const v of r) {
      expect(v.price).toBeUndefined();
      expect(v.original_price).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Rodar o teste e verificar que passa**

```bash
pnpm test supabase/functions/_shared/canais/__tests__/estoque-ml.test.ts
```

Expected: **PASS**. Este bloco caracteriza o comportamento que já existe em `montarVariacoesUpdate` — é a rede de segurança antes de reusá-lo. Se falhar, `montarVariacoesUpdate` mudou e o resto desta task precisa ser revisto.

- [ ] **Step 3: Adicionar os tipos ao contrato**

Em `supabase/functions/_shared/canais/contrato.ts`, adicione junto aos outros tipos:

```ts
/** Estoque absoluto desejado para um SKU dentro de um anúncio. */
export interface EstoquePorSku { sku: string; estoque: number }
```

Em `interface Capabilities`, adicione o campo:

```ts
  atualizarEstoque: boolean;   // push barato de estoque sem passar pelo UPDATE completo
```

Em `interface ChannelConnector`, adicione o método:

```ts
  /**
   * Push de estoque por VALOR ABSOLUTO para um anúncio já publicado.
   * `estoques` cobre apenas os SKUs que vivem neste item externo — quem resolve
   * isso é o worker, que conhece split (ADR-0048) e user products (ADR-0088).
   * Não lança: erros viram ResultadoCanal.erro.
   */
  atualizarEstoque(
    ctx: ContextoCanal,
    itemExternoId: string,
    estoques: EstoquePorSku[],
  ): Promise<ResultadoCanal<void>>;
```

- [ ] **Step 4: Implementar no conector ML**

Em `supabase/functions/_shared/canais/mercado-livre.ts`, adicione `atualizarEstoque: true` ao objeto `capabilities` e implemente o método. Coloque-o logo depois de `atualizarAnuncio`:

```ts
  async atualizarEstoque(
    ctx: ContextoCanal,
    itemExternoId: string,
    estoques: EstoquePorSku[],
  ): Promise<ResultadoCanal<void>> {
    if (estoques.length === 0) return { ok: true };
    const token = await ctx.getToken();
    try {
      const atual = await buscarItemML(token, itemExternoId);

      // Item plano (ADR-0084/0088): sem sub-recurso `variations`. Repõe na raiz do item.
      // Um item plano corresponde a exatamente 1 SKU; mais que isso é bug do chamador.
      if (atual.variations.length === 0) {
        if (estoques.length !== 1) {
          return {
            ok: false,
            erro: {
              codigo: 'ESTOQUE',
              mensagemOperador:
                `Item plano ${itemExternoId} recebeu ${estoques.length} SKUs no push de estoque `
                + '(esperado exatamente 1). Isso indica alvo mal resolvido, não erro do Mercado Livre.',
              retentavel: false,
            },
          };
        }
        await atualizarItemPlanoML(token, itemExternoId, { available_quantity: estoques[0].estoque });
        return { ok: true };
      }

      // Item com variações: reenvia TODAS (o ML deleta as omitidas), só available_quantity.
      const desejados = estoques.map((e) => ({ codigo: e.sku, estoque: e.estoque }));
      const variations = montarVariacoesUpdate(atual.variations, desejados, undefined, null, null, undefined, true);
      await atualizarItemML(token, itemExternoId, variations);
      return { ok: true };
    } catch (e) {
      return { ok: false, erro: classificarErroCanal(e) };
    }
  },
```

Adicione `atualizarItemPlanoML` ao import existente de `../ml/atualizar-item.ts` se ainda não estiver lá, e `EstoquePorSku` ao import de `./contrato.ts`.

- [ ] **Step 5: Implementar no fake**

Em `supabase/functions/_shared/canais/fake.ts`, adicione `atualizarEstoque: true` ao objeto `capabilities` e o método na classe:

```ts
  atualizarEstoque(
    _ctx: ContextoCanal,
    itemExternoId: string,
    estoques: EstoquePorSku[],
  ): Promise<ResultadoCanal<void>> {
    this.registrar('atualizarEstoque', { itemExternoId, estoques });
    const f = this.consumirFalha();
    if (f) {
      return Promise.resolve({
        ok: false,
        erro: { codigo: f.codigo, mensagemOperador: `fake:${f.codigo}`, retentavel: f.retentavel },
      });
    }
    return Promise.resolve({ ok: true });
  }
```

Adicione `EstoquePorSku` ao import de tipos do topo do arquivo.

- [ ] **Step 6: Rodar o baseline**

```bash
pnpm test && npx tsc --noEmit && pnpm lint
deno check supabase/functions/_shared/canais/mercado-livre.ts
```

Expected: tudo verde, e o total de testes **maior** que o anotado na Task 2 Step 3 (os 3 testes novos). Se `tsc` reclamar de `Capabilities` incompleto em algum outro lugar, é porque existe outro objeto de capabilities no repo — adicione `atualizarEstoque` nele também.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/canais/
git commit -m "feat(e6b): atualizarEstoque no contrato de canal + impl ML (variações e item plano) + fake"
```

---

### Task 5: `selecionarBaixas` (pura) + `registrarBaixaVenda`

**Files:**
- Create: `supabase/functions/_shared/estoque/baixa.ts`
- Test: `supabase/functions/_shared/estoque/__tests__/baixa.test.ts`

**Interfaces:**
- Consumes: RPC `baixar_estoque` (Task 3).
- Produces, consumido pela Task 6:

```ts
export interface ItemVendaBaixa { codigo: string | null; quantity: number }
export interface BaixaSelecionada { codigo: string; quantity: number }
export function selecionarBaixas(itens: ItemVendaBaixa[]): BaixaSelecionada[]
export interface ResultadoBaixaVenda { paisAfetados: string[]; semSaldo: Array<{ codigo: string; pedido: number }> }
export async function registrarBaixaVenda(
  admin: SupabaseClient,
  p: { orgId: string; canal: string; orderId: string | number; itens: ItemVendaBaixa[] },
): Promise<ResultadoBaixaVenda>
```

- [ ] **Step 1: Escrever o teste RED da função pura**

Crie `supabase/functions/_shared/estoque/__tests__/baixa.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { selecionarBaixas } from '../baixa';

describe('selecionarBaixas', () => {
  it('ignora item sem codigo', () => {
    expect(selecionarBaixas([{ codigo: null, quantity: 2 }])).toEqual([]);
  });

  it('ignora quantity <= 0', () => {
    expect(selecionarBaixas([
      { codigo: 'A1', quantity: 0 },
      { codigo: 'A2', quantity: -1 },
    ])).toEqual([]);
  });

  it('mantém item válido', () => {
    expect(selecionarBaixas([{ codigo: '02835002RS', quantity: 3 }]))
      .toEqual([{ codigo: '02835002RS', quantity: 3 }]);
  });

  it('agrega o mesmo sku repetido no mesmo pedido', () => {
    expect(selecionarBaixas([
      { codigo: 'A1', quantity: 1 },
      { codigo: 'A1', quantity: 2 },
    ])).toEqual([{ codigo: 'A1', quantity: 3 }]);
  });

  it('preserva a ordem de primeira aparição', () => {
    expect(selecionarBaixas([
      { codigo: 'B', quantity: 1 },
      { codigo: 'A', quantity: 1 },
      { codigo: 'B', quantity: 1 },
    ])).toEqual([{ codigo: 'B', quantity: 2 }, { codigo: 'A', quantity: 1 }]);
  });

  it('lista vazia devolve vazio', () => {
    expect(selecionarBaixas([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar o teste e verificar que FALHA**

```bash
pnpm test supabase/functions/_shared/estoque/__tests__/baixa.test.ts
```

Expected: **FAIL** — "Cannot find module '../baixa'".

- [ ] **Step 3: Implementar `baixa.ts`**

Crie `supabase/functions/_shared/estoque/baixa.ts`:

```ts
// E6b (ADR-0054): seleção e aplicação da baixa de estoque de uma venda paga.
// A venda é sagrada — nada aqui pode derrubar o sync-venda; o chamador envolve em try/catch.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface ItemVendaBaixa { codigo: string | null; quantity: number }
export interface BaixaSelecionada { codigo: string; quantity: number }

/** Filtra itens sem SKU ou sem quantidade e agrega o mesmo SKU repetido no pedido. */
export function selecionarBaixas(itens: ItemVendaBaixa[]): BaixaSelecionada[] {
  const porCodigo = new Map<string, number>();
  for (const i of itens) {
    if (!i.codigo || i.quantity <= 0) continue;
    porCodigo.set(i.codigo, (porCodigo.get(i.codigo) ?? 0) + i.quantity);
  }
  return [...porCodigo].map(([codigo, quantity]) => ({ codigo, quantity }));
}

export interface ResultadoBaixaVenda {
  /** codigo_pai distintos afetados — cada um vira 1 job de sincronização. */
  paisAfetados: string[];
  /** SKUs cuja venda excedeu o saldo (D-8) — o operador precisa saber. */
  semSaldo: Array<{ codigo: string; pedido: number }>;
}

/** Referência de idempotência da baixa. Canal-agnóstica por construção. */
export function refBaixa(canal: string, orderId: string | number, codigo: string): string {
  return `${canal}:${orderId}:${codigo}`;
}

export async function registrarBaixaVenda(
  admin: SupabaseClient,
  p: { orgId: string; canal: string; orderId: string | number; itens: ItemVendaBaixa[] },
): Promise<ResultadoBaixaVenda> {
  const baixas = selecionarBaixas(p.itens);
  if (baixas.length === 0) return { paisAfetados: [], semSaldo: [] };

  const refs: string[] = [];
  for (const b of baixas) {
    const ref = refBaixa(p.canal, p.orderId, b.codigo);
    refs.push(ref);
    await admin.rpc('baixar_estoque', {
      p_org: p.orgId, p_codigo: b.codigo, p_qtd: b.quantity, p_canal: p.canal, p_ref: ref,
    });
  }

  // Relê os movimentos desta venda: a função SQL preencheu codigo_pai, estoque_anterior
  // e estoque_resultante. Duplicatas (retry) não aparecem duas vezes — a ref é única.
  const { data: movs } = await admin.from('estoque_movimentos')
    .select('codigo, codigo_pai, quantidade, estoque_anterior, estoque_resultante, motivo')
    .eq('org_id', p.orgId).in('referencia_externa', refs);

  const pais = new Set<string>();
  const semSaldo: Array<{ codigo: string; pedido: number }> = [];
  for (const m of movs ?? []) {
    if (m.codigo_pai) pais.add(m.codigo_pai as string);
    if (m.motivo !== 'venda') continue;
    // "Vendeu sem saldo": o pedido foi maior que o saldo que existia antes da baixa.
    // Comparação local graças a estoque_anterior — nada de reconstruir por timestamp.
    const pedido = Math.abs(m.quantidade as number);
    const anterior = m.estoque_anterior as number | null;
    if (anterior !== null && anterior < pedido) semSaldo.push({ codigo: m.codigo as string, pedido });
  }
  return { paisAfetados: [...pais], semSaldo };
}
```

- [ ] **Step 4: Rodar o teste e verificar que PASSA**

```bash
pnpm test supabase/functions/_shared/estoque/__tests__/baixa.test.ts
```

Expected: **PASS**, 6 testes.

- [ ] **Step 5: Rodar o baseline**

```bash
pnpm test && npx tsc --noEmit && pnpm lint
deno check supabase/functions/_shared/estoque/baixa.ts
```

Expected: verde, 6 testes novos.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/estoque/
git commit -m "feat(e6b): selecionarBaixas + registrarBaixaVenda com deteccao de venda sem saldo"
```

---

### Task 6: Fila + enfileirador

**Files:**
- Modify: `supabase/functions/_shared/queue.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `garantirFilaSerialCanal`, `qstashClient` (já existem em `queue.ts`).
- Produces, consumido pelas Tasks 7, 8, 9 e pelo Bloco B:

```ts
export interface SincronizarEstoqueJob {
  org_id: string;
  codigo_pai: string;
  /** null = push para TODOS os canais (entrada, ajuste, reconciliação). */
  canal_origem: string | null;
}
export async function enfileirarSincronizacaoEstoque(
  job: SincronizarEstoqueJob, orgId: string,
): Promise<string>
```

- [ ] **Step 1: Adicionar a entrada no `config.toml`**

Adicione ao final de `supabase/config.toml`, **sem tocar em nenhuma entrada existente**:

```toml
[functions.sincronizar-estoque]
verify_jwt = false

[functions.reconciliar-estoque]
verify_jwt = false
```

- [ ] **Step 2: Implementar o enfileirador**

Em `supabase/functions/_shared/queue.ts`, depois de `enfileirarPublicacaoCanal`, adicione:

```ts
export interface SincronizarEstoqueJob {
  org_id: string;
  codigo_pai: string;
  /** null = push para TODOS os canais (entrada, ajuste manual, reconciliação). */
  canal_origem: string | null;
}

/**
 * Fila serial por org (parallelism=1): dois movimentos seguidos do mesmo produto
 * nunca aplicam estoque velho por cima do novo. O push é absoluto, então repetir
 * é sempre seguro — daí retries agressivo.
 */
export async function enfileirarSincronizacaoEstoque(
  job: SincronizarEstoqueJob, orgId: string,
): Promise<string> {
  const nomeFila = `estoque-${orgId}`;
  await garantirFilaSerialCanal(nomeFila);
  const target = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sincronizar-estoque`;
  const { messageId } = await qstashClient()
    .queue({ queueName: nomeFila })
    .enqueueJSON({ url: target, body: job, retries: 3, retryDelay: '10000' });
  return messageId;
}
```

Se o padrão exato de `enqueueJSON`/`messageId` divergir do que está em `enfileirarPublicacaoCanal`, **copie o padrão do arquivo** — o código real vence este plano.

- [ ] **Step 3: Rodar o baseline**

```bash
npx tsc --noEmit && pnpm lint
deno check supabase/functions/_shared/queue.ts
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/queue.ts supabase/config.toml
git commit -m "feat(e6b): fila serial estoque-{org} + enfileirarSincronizacaoEstoque"
```

---

### Task 7: Resolução de alvos (pura) + worker `sincronizar-estoque`

**Files:**
- Create: `supabase/functions/_shared/estoque/alvos.ts`
- Test: `supabase/functions/_shared/estoque/__tests__/alvos.test.ts`
- Create: `supabase/functions/sincronizar-estoque/index.ts`

**Interfaces:**
- Consumes: `EstoquePorSku` (Task 4), `SincronizarEstoqueJob` (Task 6), `resolverConexao`, `getValidAccessTokenConexao`, `getConnector`, `verificarAssinatura`, `adminClient`.
- Produces, consumido pela Task 9:

```ts
export interface LinhaAnuncio {
  canal: string;
  item_externo_id: string | null;
  variacoes_externas: Record<string, unknown> | null;
}
export interface LinhaItemUP {
  anuncio_externo_id: string;
  sku: string;
  item_externo_id: string | null;
  retirado: boolean;
}
export interface AlvoPush { canal: string; itemExternoId: string; estoques: EstoquePorSku[] }
export function resolverAlvosPush(
  anuncios: Array<LinhaAnuncio & { id: string }>,
  itensUP: LinhaItemUP[],
  estoquePorSku: Record<string, number>,
  canalOrigem: string | null,
): AlvoPush[]
```

- [ ] **Step 1: Escrever o teste RED da resolução de alvos**

Crie `supabase/functions/_shared/estoque/__tests__/alvos.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolverAlvosPush } from '../alvos';

const estoques = { A1: 5, A2: 0, A3: 7 };

describe('resolverAlvosPush', () => {
  it('anúncio com variações recebe os SKUs que o mapa declara', () => {
    const r = resolverAlvosPush(
      [{ id: 'x', canal: 'mercado_livre', item_externo_id: 'MLB1', variacoes_externas: { A1: {}, A2: {} } }],
      [], estoques, null,
    );
    expect(r).toEqual([{
      canal: 'mercado_livre', itemExternoId: 'MLB1',
      estoques: [{ sku: 'A1', estoque: 5 }, { sku: 'A2', estoque: 0 }],
    }]);
  });

  it('mapa vazio → manda todos os SKUs do produto', () => {
    const r = resolverAlvosPush(
      [{ id: 'x', canal: 'mercado_livre', item_externo_id: 'MLB1', variacoes_externas: {} }],
      [], estoques, null,
    );
    expect(r[0].estoques).toHaveLength(3);
  });

  it('exclui o canal de origem (venda já se decrementou lá)', () => {
    const r = resolverAlvosPush(
      [
        { id: 'x', canal: 'mercado_livre', item_externo_id: 'MLB1', variacoes_externas: { A1: {} } },
        { id: 'y', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } },
      ],
      [], estoques, 'mercado_livre',
    );
    expect(r.map((a) => a.canal)).toEqual(['fake']);
  });

  it('canal_origem null → push para todos (entrada, ajuste, reconciliação)', () => {
    const r = resolverAlvosPush(
      [
        { id: 'x', canal: 'mercado_livre', item_externo_id: 'MLB1', variacoes_externas: { A1: {} } },
        { id: 'y', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } },
      ],
      [], estoques, null,
    );
    expect(r).toHaveLength(2);
  });

  it('split (ADR-0048): cada partição recebe só os SKUs que contém', () => {
    const r = resolverAlvosPush(
      [
        { id: 'p0', canal: 'mercado_livre', item_externo_id: 'MLB1', variacoes_externas: { A1: {} } },
        { id: 'p1', canal: 'mercado_livre', item_externo_id: 'MLB2', variacoes_externas: { A3: {} } },
      ],
      [], estoques, null,
    );
    expect(r).toEqual([
      { canal: 'mercado_livre', itemExternoId: 'MLB1', estoques: [{ sku: 'A1', estoque: 5 }] },
      { canal: 'mercado_livre', itemExternoId: 'MLB2', estoques: [{ sku: 'A3', estoque: 7 }] },
    ]);
  });

  it('user products (ADR-0088): 1 alvo por item filho, 1 SKU cada', () => {
    const r = resolverAlvosPush(
      [{ id: 'p0', canal: 'mercado_livre', item_externo_id: 'MLB1', variacoes_externas: { A1: {}, A3: {} } }],
      [
        { anuncio_externo_id: 'p0', sku: 'A1', item_externo_id: 'MLB-A1', retirado: false },
        { anuncio_externo_id: 'p0', sku: 'A3', item_externo_id: 'MLB-A3', retirado: false },
      ],
      estoques, null,
    );
    expect(r).toEqual([
      { canal: 'mercado_livre', itemExternoId: 'MLB-A1', estoques: [{ sku: 'A1', estoque: 5 }] },
      { canal: 'mercado_livre', itemExternoId: 'MLB-A3', estoques: [{ sku: 'A3', estoque: 7 }] },
    ]);
  });

  it('item UP retirado é ignorado', () => {
    const r = resolverAlvosPush(
      [{ id: 'p0', canal: 'mercado_livre', item_externo_id: 'MLB1', variacoes_externas: { A1: {} } }],
      [
        { anuncio_externo_id: 'p0', sku: 'A1', item_externo_id: 'MLB-A1', retirado: true },
      ],
      estoques, null,
    );
    expect(r).toEqual([]);
  });

  it('anúncio sem item_externo_id é ignorado', () => {
    const r = resolverAlvosPush(
      [{ id: 'x', canal: 'mercado_livre', item_externo_id: null, variacoes_externas: { A1: {} } }],
      [], estoques, null,
    );
    expect(r).toEqual([]);
  });

  it('SKU no mapa que não está no estoque atual é ignorado', () => {
    const r = resolverAlvosPush(
      [{ id: 'x', canal: 'mercado_livre', item_externo_id: 'MLB1', variacoes_externas: { A1: {}, SUMIU: {} } }],
      [], estoques, null,
    );
    expect(r[0].estoques).toEqual([{ sku: 'A1', estoque: 5 }]);
  });
});
```

- [ ] **Step 2: Rodar o teste e verificar que FALHA**

```bash
pnpm test supabase/functions/_shared/estoque/__tests__/alvos.test.ts
```

Expected: **FAIL** — "Cannot find module '../alvos'".

- [ ] **Step 3: Implementar `alvos.ts`**

```ts
// E6b (ADR-0054): quem sabe qual SKU vive em qual item externo é o worker, não o conector.
// Cobre as três formas de publicação: variações num item, split em N partições (ADR-0048)
// e user products com N itens planos por família (ADR-0088).
import type { EstoquePorSku } from '../canais/contrato.ts';

export interface LinhaAnuncio {
  id: string;
  canal: string;
  item_externo_id: string | null;
  variacoes_externas: Record<string, unknown> | null;
}
export interface LinhaItemUP {
  anuncio_externo_id: string;
  sku: string;
  item_externo_id: string | null;
  retirado: boolean;
}
export interface AlvoPush { canal: string; itemExternoId: string; estoques: EstoquePorSku[] }

export function resolverAlvosPush(
  anuncios: LinhaAnuncio[],
  itensUP: LinhaItemUP[],
  estoquePorSku: Record<string, number>,
  canalOrigem: string | null,
): AlvoPush[] {
  const alvos: AlvoPush[] = [];
  const todosSkus = Object.keys(estoquePorSku);

  for (const a of anuncios) {
    // O canal onde a venda ocorreu já se decrementou sozinho; empurrar de volta é eco inútil.
    if (canalOrigem !== null && a.canal === canalOrigem) continue;
    if (!a.item_externo_id) continue;

    const filhos = itensUP.filter((i) => i.anuncio_externo_id === a.id);
    if (filhos.length > 0) {
      // User products: cada cor é um item técnico separado, com 1 SKU cada.
      for (const f of filhos) {
        if (f.retirado || !f.item_externo_id) continue;
        const estoque = estoquePorSku[f.sku];
        if (estoque === undefined) continue;
        alvos.push({ canal: a.canal, itemExternoId: f.item_externo_id, estoques: [{ sku: f.sku, estoque }] });
      }
      continue;
    }

    // Item com variações (ou item plano de 1 SKU): o mapa diz quais SKUs vivem aqui.
    // Mapa vazio = anúncio sem ancoragem registrada → manda o produto inteiro.
    const skusDoAnuncio = Object.keys(a.variacoes_externas ?? {});
    const skus = skusDoAnuncio.length > 0 ? skusDoAnuncio : todosSkus;
    const estoques = skus
      .filter((sku) => estoquePorSku[sku] !== undefined)
      .map((sku) => ({ sku, estoque: estoquePorSku[sku] }));
    if (estoques.length === 0) continue;
    alvos.push({ canal: a.canal, itemExternoId: a.item_externo_id, estoques });
  }

  return alvos;
}
```

- [ ] **Step 4: Rodar o teste e verificar que PASSA**

```bash
pnpm test supabase/functions/_shared/estoque/__tests__/alvos.test.ts
```

Expected: **PASS**, 9 testes.

- [ ] **Step 5: Implementar o worker**

Crie `supabase/functions/sincronizar-estoque/index.ts`:

```ts
// E6b (ADR-0054): push de estoque por VALOR ABSOLUTO para os canais publicados.
// Chamado pela fila serial estoque-{orgId} (parallelism=1), então a ordem é garantida
// e repetir é sempre seguro. verify_jwt=false + assinatura QStash (worker de fila).
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/qstash.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import { resolverAlvosPush } from '../_shared/estoque/alvos.ts';
import type { SincronizarEstoqueJob } from '../_shared/queue.ts';

Deno.serve(async (req) => {
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('assinatura inválida', { status: 401 });
  }
  const { org_id, codigo_pai, canal_origem } = JSON.parse(body) as SincronizarEstoqueJob;
  const admin = adminClient();

  // 1) Estoque canônico ATUAL: variações da família mais recente (mesma âncora da baixa).
  const { data: familia } = await admin.from('familias')
    .select('id').eq('org_id', org_id).eq('codigo_pai', codigo_pai)
    .order('criado_em', { ascending: false }).limit(1).maybeSingle();
  if (!familia) return Response.json({ ok: true, skip: 'produto sem família' });

  const { data: variacoes } = await admin.from('variacoes')
    .select('codigo, estoque').eq('familia_id', familia.id);
  const estoquePorSku: Record<string, number> = {};
  for (const v of variacoes ?? []) estoquePorSku[v.codigo as string] = (v.estoque as number) ?? 0;
  if (Object.keys(estoquePorSku).length === 0) return Response.json({ ok: true, skip: 'sem variações' });

  // 2) Anúncios publicados do produto + itens técnicos UP (ADR-0088).
  const { data: anuncios } = await admin.from('anuncios_externos')
    .select('id, canal, item_externo_id, variacoes_externas')
    .eq('org_id', org_id).eq('codigo_pai', codigo_pai).eq('status', 'publicado');
  const idsAnuncio = (anuncios ?? []).map((a) => a.id as string);
  const { data: itensUP } = idsAnuncio.length > 0
    ? await admin.from('anuncios_externos_itens')
        .select('anuncio_externo_id, sku, item_externo_id, retirado')
        .eq('org_id', org_id).in('anuncio_externo_id', idsAnuncio)
    : { data: [] };

  const alvos = resolverAlvosPush(
    (anuncios ?? []) as never, (itensUP ?? []) as never, estoquePorSku, canal_origem,
  );
  if (alvos.length === 0) return Response.json({ ok: true, alvos: 0 });

  // 3) Push absoluto, um alvo por vez. Falha de um canal nunca afeta outro.
  const retentaveis: string[] = [];
  const tokenPorCanal = new Map<string, () => Promise<string>>();

  for (const alvo of alvos) {
    let getToken = tokenPorCanal.get(alvo.canal);
    if (!getToken) {
      const conexao = await resolverConexao(admin, org_id, alvo.canal);
      if (!conexao) continue;                       // canal desconectado: nada a fazer
      getToken = () => getValidAccessTokenConexao(conexao);
      tokenPorCanal.set(alvo.canal, getToken);
    }
    const conn = getConnector(alvo.canal);
    if (!conn.capabilities.atualizarEstoque) {
      console.log('estoque_push_nao_suportado', alvo.canal);
      continue;
    }
    const r = await conn.atualizarEstoque({ getToken }, alvo.itemExternoId, alvo.estoques);
    if (!r.ok && r.erro?.retentavel) retentaveis.push(`${alvo.canal}:${alvo.itemExternoId}`);
    if (!r.ok && !r.erro?.retentavel) {
      console.error('estoque_push_definitivo', alvo.canal, alvo.itemExternoId, r.erro);
    }
  }

  // Push é absoluto: repetir é seguro, então 500 para o QStash re-tentar.
  if (retentaveis.length > 0) {
    return new Response(JSON.stringify({ retry: retentaveis }), { status: 500 });
  }
  return Response.json({ ok: true, alvos: alvos.length });
});
```

Se os caminhos de import (`_shared/supabase.ts`, `_shared/qstash.ts`, `_shared/canais/conexao.ts`) divergirem, **copie os imports reais de outro worker** — por exemplo `supabase/functions/publicar-anuncio/index.ts`.

- [ ] **Step 6: Rodar o baseline**

```bash
pnpm test && npx tsc --noEmit && pnpm lint
deno check supabase/functions/sincronizar-estoque/index.ts
```

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/estoque/ supabase/functions/sincronizar-estoque/
git commit -m "feat(e6b): worker sincronizar-estoque com resolucao de alvos (split e user products)"
```

---

### Task 8: Gancho no `sync-venda` — baixa na venda paga + estorno no cancelamento

**Files:**
- Modify: `supabase/functions/sync-venda/index.ts`

**Interfaces:**
- Consumes: `registrarBaixaVenda` (Task 5), `enfileirarSincronizacaoEstoque` (Task 6), `notificarCategoria` (já existe).
- Produces: nada novo.

- [ ] **Step 1: Adicionar os imports**

No topo de `supabase/functions/sync-venda/index.ts`:

```ts
import { registrarBaixaVenda, refBaixa, selecionarBaixas } from '../_shared/estoque/baixa.ts';
import { enfileirarSincronizacaoEstoque } from '../_shared/queue.ts';
```

- [ ] **Step 2: Inserir a baixa dentro do `if (novaPaga)` existente**

Localize o bloco que começa em `if (novaPaga && orgId && await reservarNotificacao(...))` (por volta da linha 105). **Depois** do fechamento desse bloco `}` (linha ~126) e **antes** do `if (liquidoPorPayment === null)`, insira:

```ts
  // E6b (ADR-0054): baixa de estoque na transição para pago. A venda é SAGRADA —
  // nenhuma falha aqui pode derrubar o sync. A baixa é idempotente por referência,
  // então o retry do QStash re-executando este bloco não duplica nada.
  if (novaPaga && orgId) {
    try {
      const { paisAfetados, semSaldo } = await registrarBaixaVenda(admin, {
        orgId, canal: 'mercado_livre', orderId: pedido.id, itens,
      });
      for (const codigoPai of paisAfetados) {
        await enfileirarSincronizacaoEstoque(
          { org_id: orgId, codigo_pai: codigoPai, canal_origem: 'mercado_livre' }, orgId,
        );
      }
      if (semSaldo.length > 0) {
        const linhas = semSaldo.map((s) => `• ${s.codigo} — pedido de ${s.pedido} un.`).join('\n');
        await notificarCategoria(
          admin, orgId, 'vendas',
          `⚠️ Venda sem saldo suficiente (pedido ${pedido.id})\n\n${linhas}\n\n`
          + 'O estoque foi zerado e o anúncio pode ter vendido mais do que você tem.',
        );
      }
    } catch (e) {
      console.error('baixa_estoque_falhou', e);
    }
  }
```

- [ ] **Step 3: Inserir o estorno no cancelamento**

Localize onde o status do pedido é gravado (`upsertVenda` já recebe `pedido`). Logo depois do bloco da baixa, insira:

```ts
  // Cancelado ANTES do despacho: a mercadoria nunca saiu, então repõe (D-7).
  // Já despachado ou devolvido: só o alerta — repor exige conferir o que voltou.
  if (orgId && pedido.status === 'cancelled') {
    const despachado = shipment?.status != null
      && !['pending', 'handling', 'ready_to_ship', 'cancelled'].includes(String(shipment.status));
    try {
      if (!despachado) {
        for (const b of selecionarBaixas(itens)) {
          await admin.rpc('estornar_estoque', {
            p_org: orgId, p_codigo: b.codigo, p_qtd: b.quantity,
            p_canal: 'mercado_livre', p_ref: `estorno:${refBaixa('mercado_livre', pedido.id, b.codigo)}`,
          });
        }
        const { data: movs } = await admin.from('estoque_movimentos')
          .select('codigo_pai').eq('org_id', orgId)
          .in('referencia_externa', selecionarBaixas(itens)
            .map((b) => `estorno:${refBaixa('mercado_livre', pedido.id, b.codigo)}`));
        for (const codigoPai of new Set((movs ?? []).map((m) => m.codigo_pai as string).filter(Boolean))) {
          await enfileirarSincronizacaoEstoque(
            { org_id: orgId, codigo_pai: codigoPai, canal_origem: null }, orgId,
          );
        }
      } else {
        await notificarCategoria(
          admin, orgId, 'pos_venda',
          `📦 Pedido ${pedido.id} cancelado após o despacho.\n\n`
          + 'O estoque NÃO foi reposto automaticamente — confira o que voltou e dê entrada manual.',
        );
      }
    } catch (e) {
      console.error('estorno_estoque_falhou', e);
    }
  }
```

**Atenção:** `canal_origem: null` no estorno é proposital — a reposição precisa alcançar **todos** os canais, inclusive o ML, porque o ML não repõe sozinho um cancelamento.

- [ ] **Step 4: Verificar que os testes existentes do `sync-venda` continuam passando**

```bash
pnpm test supabase/functions/_shared/faturamento
pnpm test 2>&1 | tail -5
```

Expected: nenhum teste existente quebrou. Se algum mock de `admin` reclamar de `rpc` não implementado, adicione o stub mínimo no mock — não altere a lógica.

- [ ] **Step 5: Confirmar que a lista de valores de status do shipment está correta**

```bash
rtk proxy grep -rn "ready_to_ship\|handling\|shipped" supabase/functions/_shared/ml/ | rtk proxy head -10
```

Ajuste o array `['pending', 'handling', 'ready_to_ship', 'cancelled']` do Step 3 para bater com os valores que o código já trata. Se não houver referência, mantenha o array e registre a suposição num comentário.

- [ ] **Step 6: Baseline + commit**

```bash
pnpm test && npx tsc --noEmit && pnpm lint
deno check supabase/functions/sync-venda/index.ts
git add supabase/functions/sync-venda/index.ts
git commit -m "feat(e6b): baixa de estoque na venda paga + estorno no cancelamento pre-despacho"
```

---

### Task 9: Reconciliação diária `reconciliar-estoque`

**Files:**
- Create: `supabase/functions/reconciliar-estoque/index.ts`

**Interfaces:**
- Consumes: `enfileirarSincronizacaoEstoque` (Task 6), `verificarAssinatura`, `adminClient`.
- Produces: nada consumido por outra task.

- [ ] **Step 1: Implementar o worker**

```ts
// E6b (ADR-0054, D-12): rede de segurança contra webhook perdido ou push que falhou
// em definitivo. NÃO varre o catálogo: só produtos com movimento nas últimas 24h e
// produtos publicados em ≥2 canais. verify_jwt=false + assinatura QStash.
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/qstash.ts';
import { enfileirarSincronizacaoEstoque } from '../_shared/queue.ts';

Deno.serve(async (req) => {
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('assinatura inválida', { status: 401 });
  }
  const admin = adminClient();
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // (a) Produtos com movimento nas últimas 24h.
  const { data: movs } = await admin.from('estoque_movimentos')
    .select('org_id, codigo_pai').gte('criado_em', desde).neq('codigo_pai', '');

  // (b) Produtos publicados em ≥2 canais.
  const { data: pub } = await admin.from('anuncios_externos')
    .select('org_id, codigo_pai, canal').eq('status', 'publicado');
  const canaisPorProduto = new Map<string, Set<string>>();
  for (const p of pub ?? []) {
    const chave = `${p.org_id}|${p.codigo_pai}`;
    if (!canaisPorProduto.has(chave)) canaisPorProduto.set(chave, new Set());
    canaisPorProduto.get(chave)!.add(p.canal as string);
  }

  const alvos = new Set<string>();
  for (const m of movs ?? []) alvos.add(`${m.org_id}|${m.codigo_pai}`);
  for (const [chave, canais] of canaisPorProduto) if (canais.size >= 2) alvos.add(chave);

  let enfileirados = 0;
  for (const chave of alvos) {
    const [orgId, codigoPai] = chave.split('|');
    // Só vale re-empurrar produto que está publicado em algum lugar.
    if (!canaisPorProduto.has(chave)) continue;
    try {
      // canal_origem null = push para TODOS os canais.
      await enfileirarSincronizacaoEstoque(
        { org_id: orgId, codigo_pai: codigoPai, canal_origem: null }, orgId,
      );
      enfileirados++;
    } catch (e) {
      // Uma org nunca bloqueia outra.
      console.error('reconciliar_estoque_enfileirar_falhou', orgId, codigoPai, e);
    }
  }

  return Response.json({ ok: true, enfileirados, avaliados: alvos.size });
});
```

- [ ] **Step 2: Baseline**

```bash
npx tsc --noEmit && pnpm lint
deno check supabase/functions/reconciliar-estoque/index.ts
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/reconciliar-estoque/
git commit -m "feat(e6b): reconciliacao diaria de estoque (re-push absoluto, escopo restrito)"
```

- [ ] **Step 4: PENDÊNCIA DE INFRA para o Diego (não é código)**

Após o deploy, criar o schedule no QStash apontando para `.../functions/v1/reconciliar-estoque`, cron `30 12 * * *` (UTC ≈ 09h30 BRT) — mesmo procedimento usado em `notificar-liberacao`. **Confirmar que o schedule existe de fato**: o `reconciliar-faturamento` passou ~1 mês sem schedule desde a criação e ninguém percebeu.

---

### Task 10: UI — Movimentos de estoque no expandir de Publicados

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: o componente do painel expandido de Publicados (o mesmo que mostra "Análise para publicação")
- Test: `src/lib/__tests__/movimentos-estoque.test.ts` (criar)

**Interfaces:**
- Consumes: tabela `estoque_movimentos` (Task 3), RLS org-scoped.
- Produces:

```ts
export interface MovimentoEstoque {
  criado_em: string;
  codigo: string;
  quantidade: number;
  motivo: 'venda' | 'entrada' | 'ajuste_manual' | 'estorno_venda' | 'venda_sku_nao_encontrado';
  canal_origem: string | null;
  estoque_resultante: number | null;
}
export function rotuloMotivo(m: MovimentoEstoque['motivo']): string
export async function fetchMovimentosEstoque(codigoPai: string): Promise<MovimentoEstoque[]>
```

- [ ] **Step 1: Localizar o componente do expandir**

```bash
rtk proxy grep -rn "Análise para publicação" src/ | rtk proxy head -5
```

Anote o arquivo. É onde a seção nova entra.

- [ ] **Step 2: Escrever o teste RED do rótulo**

Crie `src/lib/__tests__/movimentos-estoque.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rotuloMotivo } from '../queries';

describe('rotuloMotivo', () => {
  it('traduz cada motivo para texto do operador', () => {
    expect(rotuloMotivo('venda')).toBe('Venda');
    expect(rotuloMotivo('entrada')).toBe('Entrada');
    expect(rotuloMotivo('ajuste_manual')).toBe('Ajuste manual');
    expect(rotuloMotivo('estorno_venda')).toBe('Estorno de venda');
    expect(rotuloMotivo('venda_sku_nao_encontrado')).toBe('Venda de SKU não cadastrado');
  });
});
```

- [ ] **Step 3: Rodar e verificar que FALHA**

```bash
pnpm test src/lib/__tests__/movimentos-estoque.test.ts
```

Expected: **FAIL** — `rotuloMotivo` não existe.

- [ ] **Step 4: Implementar em `src/lib/queries.ts`**

```ts
export interface MovimentoEstoque {
  criado_em: string;
  codigo: string;
  quantidade: number;
  motivo: 'venda' | 'entrada' | 'ajuste_manual' | 'estorno_venda' | 'venda_sku_nao_encontrado';
  canal_origem: string | null;
  estoque_resultante: number | null;
}

const ROTULO_MOTIVO: Record<MovimentoEstoque['motivo'], string> = {
  venda: 'Venda',
  entrada: 'Entrada',
  ajuste_manual: 'Ajuste manual',
  estorno_venda: 'Estorno de venda',
  venda_sku_nao_encontrado: 'Venda de SKU não cadastrado',
};

export function rotuloMotivo(m: MovimentoEstoque['motivo']): string {
  return ROTULO_MOTIVO[m];
}

/** Últimos 20 movimentos do produto. A RLS por org já filtra o tenant. */
export async function fetchMovimentosEstoque(codigoPai: string): Promise<MovimentoEstoque[]> {
  const { data, error } = await supabase.from('estoque_movimentos')
    .select('criado_em, codigo, quantidade, motivo, canal_origem, estoque_resultante')
    .eq('codigo_pai', codigoPai)
    .order('criado_em', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as MovimentoEstoque[];
}
```

Adicione a query key onde as outras vivem (procure por `QK` no mesmo arquivo ou em `src/lib/query-keys.ts`):

```ts
  movimentosEstoque: (codigoPai: string) => ['movimentos-estoque', codigoPai] as const,
```

- [ ] **Step 5: Rodar e verificar que PASSA**

```bash
pnpm test src/lib/__tests__/movimentos-estoque.test.ts
```

Expected: **PASS**.

- [ ] **Step 6: Adicionar a seção ao painel expandido**

No componente localizado no Step 1, adicione uma seção "Movimentos de estoque" que:

- busca com `useQuery({ queryKey: QK.movimentosEstoque(codigoPai), queryFn: () => fetchMovimentosEstoque(codigoPai), enabled: expandido })` — **lazy**, só busca ao expandir, mesmo padrão do `useFamilia` existente nesse painel;
- renderiza uma tabela compacta com colunas: **Data · SKU · Motivo · Qtd · Canal · Saldo**;
- mostra `quantidade` com sinal (`+10`, `-3`) e cor: positivo em verde, negativo em vermelho, usando os tokens de cor que o projeto já usa nessa tela (não invente cores novas);
- estado vazio: "Nenhum movimento registrado para este produto.";
- funciona em light **e** dark.

- [ ] **Step 7: Baseline + verificação visual**

```bash
pnpm test && npx tsc --noEmit && pnpm lint && pnpm build
```

Suba o dev server e confira a seção em light e dark num produto que já tenha movimentos.

- [ ] **Step 8: Commit**

```bash
git add src/
git commit -m "feat(e6b): movimentos de estoque no expandir de Publicados"
```

---

### Task 11: Gate final — isolamento, deploy e documentação

**Files:**
- Modify: `scripts/verificar-isolamento-tenant.ts`
- Modify: `docs/reference/modelo-de-dados.md`, `docs/reference/edge-functions.md`, `docs/explanation/arquitetura.md`, `docs/project-status.md`, `docs/TASKS.md`
- Modify: `obsidian-vault/06-Roadmap/Sprint Atual.md`

- [ ] **Step 1: Adicionar `estoque_movimentos` à suite de isolamento**

```bash
rtk proxy grep -n "TABELAS" scripts/verificar-isolamento-tenant.ts | rtk proxy head -5
```

Adicione `'estoque_movimentos'` à lista. Rode a suite contra o banco local:

```bash
npx tsx scripts/verificar-isolamento-tenant.ts
```

Expected: todas as asserções PASS, incluindo as novas (org B não enxerga movimento da org A).

- [ ] **Step 2: Rodar o baseline completo**

```bash
pnpm test && npx tsc --noEmit && pnpm lint && pnpm build
deno check supabase/functions/sincronizar-estoque/index.ts supabase/functions/reconciliar-estoque/index.ts supabase/functions/sync-venda/index.ts
```

Expected: tudo verde. O total de testes deve ser o da Task 2 Step 3 **+ 18** (3 do ML, 6 da baixa, 9 dos alvos) **+ 1** (rótulo de motivo).

- [ ] **Step 3: Teste de integração com o conector fake**

Crie um teste que exercite o miolo do worker com `registrarConectorParaTeste(fakeConnector)`, cobrindo:

- venda no `mercado_livre` de produto publicado em `mercado_livre` + `fake` → o fake recebe os valores absolutos atuais e o ML (origem) **não** recebe push;
- entrada (`canal_origem: null`) → **ambos** os canais recebem push;
- erro retentável no fake → o worker responde 500;
- erro definitivo no fake → o worker responde 200 e loga.

Se o worker não for testável sem extrair o miolo, extraia `processarSincronizacao(deps)` para um módulo próprio e teste essa função — mantendo o `Deno.serve` como casca fina.

- [ ] **Step 4: PONTO DE DEPLOY — pedir OK explícito do Diego**

Só depois do OK:

```bash
supabase db push
supabase functions deploy sincronizar-estoque
supabase functions deploy reconciliar-estoque
supabase functions deploy sync-venda
```

Confirme a versão de cada função depois do deploy (`supabase functions list`) — a versão tem que ter subido em 1. Calcule o blast radius com `deno info` antes: qualquer função que importe `_shared/queue.ts` precisa ser redeployada.

- [ ] **Step 5: Criar o schedule do QStash**

Ver Task 9 Step 4. **Confirme que o schedule aparece de fato na listagem do QStash** — não confie em ter criado.

- [ ] **Step 6: Validação em produção**

- Rode `scripts/verificar-isolamento-tenant.ts` contra produção e confirme todas as asserções PASS.
- Force um `sync-venda` de um pedido pago real já existente (re-enfileirar manual) e confirme: 1 movimento no ledger, estoque decrementado, job de sincronização enfileirado, e o push chegou ao ML (confira `available_quantity` no anúncio real).
- Confirme que a mesma re-execução **não** duplica o movimento.

- [ ] **Step 7: Documentação — no mesmo commit da entrega**

| Arquivo | O que escrever |
|---|---|
| `docs/reference/modelo-de-dados.md` | Seção `estoque_movimentos` (colunas, unique parcial, RLS) + as 3 RPCs + o trigger |
| `docs/reference/edge-functions.md` | `sincronizar-estoque` e `reconciliar-estoque` (verify_jwt=false, assinatura, schedule) |
| `docs/explanation/arquitetura.md` | Diagrama do fluxo venda → baixa → fila → push |
| `docs/reference/glossario.md` | Já atualizado na spec — **conferir** e remover a marcação "em design" das entradas de Estoque |
| `docs/project-status.md` | Bloco A do E6b em produção, com o que foi validado |
| `docs/TASKS.md` | Marcar o bloco concluído |
| `obsidian-vault/06-Roadmap/Sprint Atual.md` | Atualizar o "📍 Passo atual" para o Bloco B |

- [ ] **Step 8: Re-ingerir o Graphify**

Mudança estrutural relevante (tabela nova + 2 workers + método de contrato). Rode o `--update` do Graphify nos arquivos tocados.

- [ ] **Step 9: Commit final**

```bash
git add docs/ obsidian-vault/ scripts/
git commit -m "docs(e6b): documentar ledger de estoque, workers e fluxo de push"
```

---

## Critério de saída do Bloco A

1. ✅ Venda paga no ML dá baixa atômica e idempotente; re-entrega do webhook não duplica (provado no ledger).
2. ✅ Push absoluto chega aos canais ≠ origem em ≤1 job de fila; ordem garantida pela fila serial por org.
3. ✅ Entrada, ajuste manual e estorno propagam para **todos** os canais, inclusive o ML.
4. ✅ Cancelamento antes do despacho repõe; cancelamento pós-despacho só notifica.
5. ✅ Venda sem saldo baixa até zero, registra a quantidade real e notifica.
6. ✅ Falha de estoque nunca falha a venda; falha de um canal nunca afeta outro.
7. ✅ Split (ADR-0048) e user products (ADR-0088) recebem push no item externo correto.
8. ✅ `estoque_movimentos` isolado por org, provado por `scripts/verificar-isolamento-tenant.ts`.
9. ✅ Movimentos visíveis no expandir de Publicados, light e dark.
10. ⏳ **Pleno (bloqueado pelo E5):** venda no ML atualiza anúncio Shopee real e vice-versa. Até lá, a infra cross-canal é provada com o conector fake.

## Self-review (executado na escrita do plano)

- **Cobertura da spec:** D-5 (Task 3) · D-6 (Task 8) · D-7 (Tasks 3, 8) · D-8 (Tasks 3, 5, 8) · D-9 (Task 3, consumido no Bloco B) · D-10 (Tasks 4, 6, 7) · D-11 (nenhuma task — é ausência de código deliberada, registrada no ADR) · D-12 (Task 9) · D-15 (Task 3 Step 6). D-1..D-4, D-13, D-14 são do Bloco B.
- **Placeholders:** nenhum "TBD". As duas incertezas conhecidas viraram passos de verificação explícitos: forma dos `itens` do `upsertVenda` (Task 2 Step 2) e valores de status do shipment (Task 8 Step 5).
- **Consistência de tipos:** `EstoquePorSku` (Task 4) é consumido em `alvos.ts` (Task 7) e no conector ML (Task 4) com a mesma forma. `SincronizarEstoqueJob` (Task 6) é o mesmo em Tasks 7, 8, 9. `ItemVendaBaixa` (Task 5) casa com o que `upsertVenda` devolve, validado na Task 2. `AlvoPush.itemExternoId` alimenta `atualizarEstoque(ctx, itemExternoId, estoques)` sem conversão.
- **Decisão de desenho registrada:** `estoque_movimentos.estoque_anterior` existe desde a primeira migration (Task 3) porque "vendeu sem saldo" precisa da comparação `anterior < pedido`. A alternativa — reconstruir o saldo anterior lendo o movimento imediatamente anterior por timestamp — é frágil (depende de ordenação estável) e falha no primeiro movimento de um SKU. Uma coluna resolve.
