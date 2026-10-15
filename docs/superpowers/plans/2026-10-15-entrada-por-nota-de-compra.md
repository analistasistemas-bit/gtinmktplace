# Entrada por Nota de Compra (XML NF-e) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O operador importa o XML de uma NF-e de compra em `/estoque`. O sistema liga cada item a um
produto (vínculo de fornecedor), distribui a quantidade na grade e dá entrada no estoque numa única
transação, guardando a nota como documento à parte.

**Architecture:**
- **Leitura do XML:** no navegador, com `DOMParser`, num módulo puro.
- **Regras puras:** ficam em `supabase/functions/_shared/nfe/regras.ts`, importado pelo front e pela edge.
- **Validação e gravação:** a edge `importar-nota-compra` revalida as invariantes, sobe o XML para um bucket
  privado e chama a RPC `importar_nota_compra` (`security invoker`, executada como `service_role`).
- **Dentro da RPC:** grava `notas_compra`, `notas_compra_itens` e `notas_compra_distribuicao`, faz upsert em
  `vinculos_fornecedor` e chama a `registrar_entrada`, que já existe, por SKU. Tudo numa transação.
- **Push:** a edge enfileira o push de estoque por produto tocado, como faz a `entrada-estoque`.

**Tech Stack:** React 19 + Vite + TS, React Query, shadcn/ui, `react-dropzone` (já instalado); Supabase
(Postgres + RLS + Storage); Edge Functions Deno; vitest (jsdom, TZ `America/Sao_Paulo`).

**Spec:** `docs/decisions/0181-entrada-por-nota-de-compra-e-pacote-do-contador.md` (D-1…D-11).
Glossário: `docs/reference/glossario.md` (Nota de compra, Item da nota, Vínculo de fornecedor,
Distribuição na grade, Custo de aquisição, Custo de precificação, Descrição fiscal).

**Fora deste plano (Plano 2 — pacote do contador):** D-12 (inventário/custo médio/foto 31/12), D-13
(export mensal, XMLs de venda ao vivo do ML), custos adicionais por CT-e (parte de D-9). Este plano já
grava o `custo_aquisicao_unit` por SKU distribuído, que é o insumo do custo médio do Plano 2.

## Global Constraints

- Migrations **só** por `supabase migration new <nome>` + `supabase db push`; validar com `npm run db:check`. Nunca MCP/painel para DDL (ADR-0043). O worktree **não herda o link**: rodar `supabase link --project-ref txvncrgkoynoxwopfkbp` antes do `db push`.
- Timestamp de migration nova > `20261005143525` (última na main).
- Toda tabela nova: RLS habilitada, `select` por `org_id = public.current_org_id()`. Escrita **só** por `service_role` (sem policy de insert/update/delete).
- Escrita de saldo **só** via `registrar_entrada` / `ajustar_estoque` (trigger `bloquear_escrita_direta_estoque` recusa UPDATE direto em `variacoes.estoque`).
- Edge JWT: `requireUserOrg` (`_shared/auth.ts`), `exigirModulo(admin, orgId, 'estoque')` (`_shared/produto/modulo.ts`), `corsHeaders`/`handleOptions` (`_shared/cors.ts`), `auditarOperacaoSuporte` (`_shared/support-audit.ts`), registrar em `supabase/config.toml` com `verify_jwt = true`.
- `processar.ts` / `validar.ts` / `_shared/nfe/*.ts`: **sem** `jsr:`/`npm:`/`Deno` (vitest roda eles); dependências injetadas.
- **Repo é público:** fixtures de XML usam CNPJs fictícios válidos (`11222333000181` emitente, `11444777000161` destinatário). **Nunca** commitar o XML real do cliente.
- Regra financeira inviolável: nenhum campo fiscal (NCM, origem, CSOSN) é gravado sem confirmação ativa do operador; CSOSN/CFOP do fornecedor **nunca** são copiados (ADR-0181 D-10).
- Importação **nunca publica** nada no marketplace (revisão humana obrigatória).
- Mudança em `_shared/` → redeployar **todas** as edges que importam o arquivo e conferir a versão (`supabase functions list`).
- Portão de pré-push: `pnpm preflight` (static + test). Nunca remontar à mão.
- Textos de UI em português do Brasil.

## Review Focus

1. **Reimportar a mesma nota** (duplo clique, retry de rede, reabrir o arquivo amanhã): o saldo não pode somar duas vezes. A RPC devolve `duplicada: true` e o estoque fica igual (Task 2, teste SQL; Task 5, teste do processar).
2. **Item com unidade de caixa** (`uCom = CX`, `qCom = 2`, 12 peças por caixa): a distribuição tem que exigir 24 unidades, não 2. Fator não inteiro ou qCom fracionário que não fecha → erro claro (Task 3).
3. **Desfazer depois de vender parte**: o desfazer é recusado e lista os SKUs com saldo insuficiente. Nada é ajustado pela metade (Task 2, teste SQL).
4. **XML de outra empresa ou de natureza errada** (destinatário ≠ CNPJ da org, CFOP de remessa ou bonificação, `cStat` ≠ 100, chave com DV inválido): recusa antes de gravar qualquer coisa, com o motivo (Tasks 3 e 5).
5. **Nota com SKU distribuído num produto diferente do vinculado** (REF genérica): o push sai para **todos** os produtos tocados, não só para o vinculado. Por isso a RPC lê os `codigo_pai` do ledger (Task 2).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/<ts>_adr181_nota_compra.sql` | Tabelas, colunas novas, bucket, RLS, RPCs `importar_nota_compra` e `desfazer_nota_compra` |
| `supabase/tests/nota_compra.sql` | Teste SQL das RPCs (transação desfeita) |
| `supabase/functions/_shared/nfe/tipos.ts` | Tipos `NotaCompraLida`, `ItemNotaLido`, `ItemImportacao` |
| `supabase/functions/_shared/nfe/regras.ts` | Chave DV, CFOP aceito, custo de aquisição, conversão, distribuição exata, limpeza de descrição |
| `src/lib/nfe/ler-nfe.ts` | XML → `NotaCompraLida` (DOMParser), aceita formato SEFAZ e exportação de ERP |
| `supabase/functions/importar-nota-compra/{index,validar,processar}.ts` | Edge de importação |
| `supabase/functions/desfazer-nota-compra/{index,processar}.ts` | Edge de desfazer/cancelar (admin) |
| `supabase/functions/_shared/canais/fiscal-ml.ts` | `title` passa a usar `descricao_fiscal` |
| `src/lib/notas-compra.ts` | Wrappers de edge + leituras (vínculos, notas, SKUs) |
| `src/components/estoque/importar-nota/*` | Assistente (estado puro + etapas) e lista de notas |
| `src/pages/Estoque.tsx` | Botão "Importar nota de compra" e seção "Notas de compra" |

---

### Task 1: Schema — tabelas da nota, vínculo, colunas novas, bucket

**Files:**
- Create: `supabase/migrations/<ts>_adr181_nota_compra.sql` (via `supabase migration new adr181_nota_compra`)
- Modify: `src/lib/database.types.ts`
- Test: `supabase/tests/nota_compra_schema.sql`

**Interfaces:**
- Produces: tabelas `notas_compra`, `notas_compra_itens`, `notas_compra_distribuicao`, `vinculos_fornecedor`; colunas `familias.descricao_fiscal`, `empresa_fiscal.csosn_padrao_revenda`; bucket `notas-compra` (path `{org_id}/{chave}.xml`).

- [ ] **Step 1: Escrever o teste SQL que falha**

`supabase/tests/nota_compra_schema.sql`:

```sql
\set ON_ERROR_STOP on
begin;
do $$
begin
  if to_regclass('public.notas_compra') is null then raise exception 'falta notas_compra'; end if;
  if to_regclass('public.notas_compra_itens') is null then raise exception 'falta notas_compra_itens'; end if;
  if to_regclass('public.notas_compra_distribuicao') is null then raise exception 'falta distribuicao'; end if;
  if to_regclass('public.vinculos_fornecedor') is null then raise exception 'falta vinculos_fornecedor'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_name='familias' and column_name='descricao_fiscal') then
    raise exception 'falta familias.descricao_fiscal'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_name='empresa_fiscal' and column_name='csosn_padrao_revenda') then
    raise exception 'falta empresa_fiscal.csosn_padrao_revenda'; end if;
  if not exists (select 1 from storage.buckets where id='notas-compra' and public=false) then
    raise exception 'falta bucket notas-compra privado'; end if;
  if exists (select 1 from pg_tables where schemaname='public'
             and tablename in ('notas_compra','notas_compra_itens','notas_compra_distribuicao','vinculos_fornecedor')
             and not rowsecurity) then
    raise exception 'RLS desligada em tabela nova'; end if;
  raise exception 'TESTE_OK' using errcode = 'P0001';
end $$;
rollback;
```

- [ ] **Step 2: Rodar e ver falhar (prova de vermelho)**

Run: `python3 scripts/teste-sql-desfeito.py supabase/tests/nota_compra_schema.sql`
Expected: FAIL com `falta notas_compra`.

- [ ] **Step 3: Criar a migration**

Run: `supabase migration new adr181_nota_compra` e preencher:

```sql
-- ADR-0181: nota de compra como documento à parte + vínculo de fornecedor.
-- Escrita só por service_role (edges importar-/desfazer-nota-compra); leitura por org.

alter table public.familias add column if not exists descricao_fiscal text
  check (descricao_fiscal is null or length(btrim(descricao_fiscal)) between 1 and 120);
comment on column public.familias.descricao_fiscal is
  'ADR-0181 D-5: texto que sai na nota de venda do Faturador ML (title do fiscal_information). Null = usa nome_pai.';

alter table public.empresa_fiscal add column if not exists csosn_padrao_revenda text
  check (csosn_padrao_revenda is null or csosn_padrao_revenda ~ '^[0-9]{3}$');
comment on column public.empresa_fiscal.csosn_padrao_revenda is
  'ADR-0181 D-10: CSOSN de saída sugerido no cadastro (informado com o contador). Nunca aplicado sem confirmação.';

create table public.notas_compra (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  chave         text not null check (chave ~ '^[0-9]{44}$'),
  numero        integer not null,
  serie         integer not null,
  emitente_cnpj text not null check (emitente_cnpj ~ '^[0-9]{14}$'),
  emitente_nome text not null,
  emitida_em    timestamptz not null,
  valor_total   numeric(14,2) not null,
  assinada      boolean not null,
  xml_path      text not null,
  status        text not null default 'importada' check (status in ('importada','desfeita','cancelada')),
  importada_por uuid references auth.users(id),
  importada_em  timestamptz not null default now(),
  desfeita_por  uuid references auth.users(id),
  desfeita_em   timestamptz,
  unique (org_id, chave)
);
create index notas_compra_org_emitida on public.notas_compra (org_id, emitida_em desc);

create table public.notas_compra_itens (
  id              uuid primary key default gen_random_uuid(),
  nota_id         uuid not null references public.notas_compra(id) on delete cascade,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  n_item          smallint not null,
  cprod           text not null,
  xprod           text not null,
  ncm             text,
  cfop            text not null,
  gtin            text,
  ucom            text not null,
  qcom            numeric(15,4) not null check (qcom > 0),
  fator_conversao integer not null default 1 check (fator_conversao >= 1),
  v_prod          numeric(14,2) not null,
  v_frete         numeric(14,2) not null default 0,
  v_seg           numeric(14,2) not null default 0,
  v_desc          numeric(14,2) not null default 0,
  v_outro         numeric(14,2) not null default 0,
  v_ipi           numeric(14,2) not null default 0,
  v_st            numeric(14,2) not null default 0,
  orig            smallint check (orig between 0 and 8),
  codigo_pai      text not null,
  unique (nota_id, n_item)
);

create table public.notas_compra_distribuicao (
  id                      uuid primary key default gen_random_uuid(),
  item_id                 uuid not null references public.notas_compra_itens(id) on delete cascade,
  org_id                  uuid not null references public.organizations(id) on delete cascade,
  codigo                  text not null,
  quantidade              integer not null check (quantidade > 0),
  custo_aquisicao_unit    numeric(14,6) not null check (custo_aquisicao_unit > 0),
  custo_precificacao_unit numeric(12,2) not null check (custo_precificacao_unit > 0),
  unique (item_id, codigo)
);
create index notas_compra_distribuicao_org_codigo on public.notas_compra_distribuicao (org_id, codigo);

create table public.vinculos_fornecedor (
  org_id          uuid not null references public.organizations(id) on delete cascade,
  cnpj_fornecedor text not null check (cnpj_fornecedor ~ '^[0-9]{14}$'),
  cprod           text not null,
  codigo_pai      text not null,
  fator_conversao integer not null default 1 check (fator_conversao >= 1),
  atualizado_em   timestamptz not null default now(),
  primary key (org_id, cnpj_fornecedor, cprod)
);

alter table public.notas_compra enable row level security;
alter table public.notas_compra_itens enable row level security;
alter table public.notas_compra_distribuicao enable row level security;
alter table public.vinculos_fornecedor enable row level security;

create policy notas_compra_select on public.notas_compra for select to authenticated
  using (org_id = public.current_org_id());
create policy notas_compra_itens_select on public.notas_compra_itens for select to authenticated
  using (org_id = public.current_org_id());
create policy notas_compra_distribuicao_select on public.notas_compra_distribuicao for select to authenticated
  using (org_id = public.current_org_id());
create policy vinculos_fornecedor_select on public.vinculos_fornecedor for select to authenticated
  using (org_id = public.current_org_id());

insert into storage.buckets (id, name, public) values ('notas-compra', 'notas-compra', false)
  on conflict (id) do nothing;
-- Leitura do XML pela org (download na lista de notas). Upload só pela edge (service_role).
create policy notas_compra_xml_select on storage.objects for select to authenticated
  using (bucket_id = 'notas-compra' and (storage.foldername(name))[1] = public.current_org_id()::text);
```

- [ ] **Step 4: Aplicar e rodar o teste**

```bash
supabase link --project-ref txvncrgkoynoxwopfkbp
supabase db push
npm run db:check
python3 scripts/teste-sql-desfeito.py supabase/tests/nota_compra_schema.sql
```
Expected: `db:check` sem divergência; teste termina com `TESTE_OK`.

- [ ] **Step 5: Regenerar tipos**

Run: `supabase gen types typescript --linked --schema public > src/lib/database.types.ts`
Depois: `git diff --stat src/lib/database.types.ts`. Esperado: só tabelas e colunas novas. Se o diff trouxer
mudanças fora do escopo, o arquivo é mantido à mão: reverter e adicionar só os blocos das 4 tabelas e das
2 colunas.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_adr181_nota_compra.sql supabase/tests/nota_compra_schema.sql src/lib/database.types.ts
git commit -m "feat(adr-0181): schema da nota de compra, vínculo de fornecedor e bucket"
```

---

### Task 2: RPCs `importar_nota_compra` e `desfazer_nota_compra`

**Files:**
- Create: `supabase/migrations/<ts>_adr181_rpc_nota_compra.sql`
- Test: `supabase/tests/nota_compra.sql`

**Interfaces:**
- Consumes: Task 1; `public.registrar_entrada(p_org, p_codigo, p_qtd, p_custo, p_doc, p_obs, p_criado_por, p_ref) returns integer` (null = ref duplicada); `public.ajustar_estoque(p_org, p_codigo, p_novo_saldo, p_obs, p_criado_por, p_ref) returns integer`.
- Produces:
  - `public.importar_nota_compra(p_org uuid, p_user uuid, p_nota jsonb, p_itens jsonb) returns jsonb` → `{nota_id, duplicada, codigos_pai: text[]}`
  - `public.desfazer_nota_compra(p_org uuid, p_user uuid, p_nota_id uuid, p_status text) returns jsonb` → `{codigos_pai: text[]}`
  - Contrato de `p_nota`: `{chave, numero, serie, emitente_cnpj, emitente_nome, emitida_em, valor_total, assinada, xml_path}`.
  - Contrato de `p_itens[]`: `{n_item, cprod, xprod, ncm, cfop, gtin, ucom, qcom, fator_conversao, v_prod, v_frete, v_seg, v_desc, v_outro, v_ipi, v_st, orig, codigo_pai, distribuicao:[{codigo, quantidade, custo_aquisicao_unit, custo_precificacao_unit}]}`.
  - Ref do ledger: `nfe:{chave}:{n_item}:{codigo}`; desfazer: `nfe-desfazer:{chave}:{codigo}`.

- [ ] **Step 1: Escrever o teste SQL que falha**

`supabase/tests/nota_compra.sql` (UUIDs com prefixo `93…` para não colidir com outros testes):

```sql
\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('93000000-0000-0000-0000-000000000001', 'NF test', 'nf-test');
insert into auth.users (id, email, raw_user_meta_data) values
  ('93000000-0000-0000-0000-000000000101', 'nf@test.local',
   '{"org_id":"93000000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('93000000-0000-0000-0000-000000000201', '93000000-0000-0000-0000-000000000101',
   '93000000-0000-0000-0000-000000000001', 'processando', 'manual');
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro)
values ('93000000-0000-0000-0000-000000000301', '93000000-0000-0000-0000-000000000201',
  '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001',
  '09300000', 'Short teste', 'CREATE', 'nacional', gen_random_uuid());
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, preco, custo, estoque) values
  ('93000000-0000-0000-0000-000000000301', '93000000-0000-0000-0000-000000000101',
   '93000000-0000-0000-0000-000000000001', '09300001', 'P', 49.9, 8, 0),
  ('93000000-0000-0000-0000-000000000301', '93000000-0000-0000-0000-000000000101',
   '93000000-0000-0000-0000-000000000001', '09300002', 'M', 49.9, 8, 0);

set local role service_role;

do $$
declare r jsonb; v_p integer; v_m integer; v_custo numeric;
  v_nota jsonb := '{"chave":"26261011222333000181550010000010511000030324","numero":1051,"serie":1,
    "emitente_cnpj":"11222333000181","emitente_nome":"Fornecedor Teste","emitida_em":"2026-10-13T15:57:33-03:00",
    "valor_total":350,"assinada":false,"xml_path":"93000000-0000-0000-0000-000000000001/x.xml"}';
  v_itens jsonb := '[{"n_item":1,"cprod":"REF 06","xprod":"Short masculino - DIV - DIV","ncm":"62034900",
    "cfop":"5102","gtin":null,"ucom":"PC","qcom":35,"fator_conversao":1,"v_prod":350,"v_frete":0,"v_seg":0,
    "v_desc":0,"v_outro":0,"v_ipi":0,"v_st":0,"orig":0,"codigo_pai":"09300000",
    "distribuicao":[{"codigo":"09300001","quantidade":15,"custo_aquisicao_unit":10,"custo_precificacao_unit":14},
                    {"codigo":"09300002","quantidade":20,"custo_aquisicao_unit":10,"custo_precificacao_unit":14}]}]';
begin
  r := public.importar_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101', v_nota, v_itens);
  if (r->>'duplicada')::boolean then raise exception '1a importação veio duplicada'; end if;
  if r->'codigos_pai' <> '["09300000"]'::jsonb then raise exception 'codigos_pai errado: %', r; end if;
  select estoque, custo into v_p, v_custo from public.variacoes where codigo='09300001';
  if v_p <> 15 then raise exception 'estoque P esperado 15, veio %', v_p; end if;
  if v_custo <> 14 then raise exception 'custo de precificação esperado 14, veio %', v_custo; end if;
  if not exists (select 1 from public.vinculos_fornecedor where cprod='REF 06' and codigo_pai='09300000') then
    raise exception 'vínculo não gravado'; end if;

  -- Reimportação: idempotente, saldo não soma.
  r := public.importar_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101', v_nota, v_itens);
  if not (r->>'duplicada')::boolean then raise exception 'reimportação não marcada duplicada'; end if;
  select estoque into v_p from public.variacoes where codigo='09300001';
  if v_p <> 15 then raise exception 'reimportação somou: %', v_p; end if;

  -- Desfazer com saldo insuficiente (vendeu 1 do M): recusa inteira, nada ajustado.
  perform public.ajustar_estoque('93000000-0000-0000-0000-000000000001', '09300002', 19, 'venda simulada',
        '93000000-0000-0000-0000-000000000101', 'teste-venda-1');
  begin
    perform public.desfazer_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101', (r->>'nota_id')::uuid, 'desfeita');
    raise exception 'desfazer deveria ter recusado';
  exception when sqlstate '23514' then null;
  end;
  select estoque into v_p from public.variacoes where codigo='09300001';
  if v_p <> 15 then raise exception 'desfazer recusado mexeu no P: %', v_p; end if;

  -- Repõe o M e desfaz de verdade.
  perform public.registrar_entrada('93000000-0000-0000-0000-000000000001', '09300002', 1, null, null, null,
        '93000000-0000-0000-0000-000000000101', 'teste-repoe-1');
  r := public.desfazer_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101', (r->>'nota_id')::uuid, 'desfeita');
  select estoque into v_p from public.variacoes where codigo='09300001';
  select estoque into v_m from public.variacoes where codigo='09300002';
  if v_p <> 0 or v_m <> 0 then raise exception 'desfazer não zerou: P=% M=%', v_p, v_m; end if;
  if (select status from public.notas_compra where chave = v_nota->>'chave') <> 'desfeita' then
    raise exception 'status não virou desfeita'; end if;

  -- Nota desfeita não pode ser reimportada em silêncio.
  begin
    perform public.importar_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101', v_nota, v_itens);
    raise exception 'reimportar nota desfeita deveria recusar';
  exception when sqlstate '23514' then null;
  end;

  raise exception 'TESTE_OK' using errcode = 'P0001';
end $$;
rollback;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python3 scripts/teste-sql-desfeito.py supabase/tests/nota_compra.sql`
Expected: FAIL com `function public.importar_nota_compra(...) does not exist`.

- [ ] **Step 3: Criar a migration das RPCs**

Run: `supabase migration new adr181_rpc_nota_compra` e preencher:

```sql
-- ADR-0181 D-4/D-11. security INVOKER de propósito: roda como o chamador (service_role, via
-- edge), que já pode executar registrar_entrada/ajustar_estoque e escrever nas tabelas novas.
-- Sem security definer não há troca de dono nem o grant/revoke de estoque_rpc_executor.
-- Uma chamada = uma transação: a nota entra inteira ou nada entra.

create or replace function public.importar_nota_compra(
  p_org uuid, p_user uuid, p_nota jsonb, p_itens jsonb
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_chave text := p_nota->>'chave';
  v_nota uuid; v_status text; v_item jsonb; v_item_id uuid; v_d jsonb; v_doc text;
  v_pais jsonb;
begin
  select id, status into v_nota, v_status from public.notas_compra
   where org_id = p_org and chave = v_chave;

  if v_nota is not null and v_status <> 'importada' then
    raise exception 'importar_nota_compra: a nota % está %; não pode ser reimportada', v_chave, v_status
      using errcode = '23514';
  end if;

  if v_nota is null then
    insert into public.notas_compra (org_id, chave, numero, serie, emitente_cnpj, emitente_nome,
      emitida_em, valor_total, assinada, xml_path, importada_por)
    values (p_org, v_chave, (p_nota->>'numero')::int, (p_nota->>'serie')::int,
      p_nota->>'emitente_cnpj', p_nota->>'emitente_nome', (p_nota->>'emitida_em')::timestamptz,
      (p_nota->>'valor_total')::numeric, (p_nota->>'assinada')::boolean, p_nota->>'xml_path', p_user)
    returning id into v_nota;

    v_doc := 'NF-e ' || (p_nota->>'numero') || ' · ' || (p_nota->>'emitente_nome');

    for v_item in select * from jsonb_array_elements(p_itens) loop
      insert into public.notas_compra_itens (nota_id, org_id, n_item, cprod, xprod, ncm, cfop, gtin,
        ucom, qcom, fator_conversao, v_prod, v_frete, v_seg, v_desc, v_outro, v_ipi, v_st, orig, codigo_pai)
      values (v_nota, p_org, (v_item->>'n_item')::smallint, v_item->>'cprod', v_item->>'xprod',
        v_item->>'ncm', v_item->>'cfop', v_item->>'gtin', v_item->>'ucom', (v_item->>'qcom')::numeric,
        (v_item->>'fator_conversao')::int, (v_item->>'v_prod')::numeric, (v_item->>'v_frete')::numeric,
        (v_item->>'v_seg')::numeric, (v_item->>'v_desc')::numeric, (v_item->>'v_outro')::numeric,
        (v_item->>'v_ipi')::numeric, (v_item->>'v_st')::numeric, (v_item->>'orig')::smallint,
        v_item->>'codigo_pai')
      returning id into v_item_id;

      insert into public.vinculos_fornecedor (org_id, cnpj_fornecedor, cprod, codigo_pai, fator_conversao)
      values (p_org, p_nota->>'emitente_cnpj', v_item->>'cprod', v_item->>'codigo_pai',
        (v_item->>'fator_conversao')::int)
      on conflict (org_id, cnpj_fornecedor, cprod) do update
        set codigo_pai = excluded.codigo_pai, fator_conversao = excluded.fator_conversao,
            atualizado_em = now();

      for v_d in select * from jsonb_array_elements(v_item->'distribuicao') loop
        insert into public.notas_compra_distribuicao (item_id, org_id, codigo, quantidade,
          custo_aquisicao_unit, custo_precificacao_unit)
        values (v_item_id, p_org, v_d->>'codigo', (v_d->>'quantidade')::int,
          (v_d->>'custo_aquisicao_unit')::numeric, (v_d->>'custo_precificacao_unit')::numeric);

        -- Ledger guarda o custo de PRECIFICAÇÃO (ADR-0181 D-3); o de aquisição fica na nota.
        perform public.registrar_entrada(p_org, v_d->>'codigo', (v_d->>'quantidade')::int,
          (v_d->>'custo_precificacao_unit')::numeric, v_doc, null, p_user,
          'nfe:' || v_chave || ':' || (v_item->>'n_item') || ':' || (v_d->>'codigo'));
      end loop;
    end loop;
  end if;

  -- Produtos tocados lidos do LEDGER: a distribuição pode cair em SKU de produto diferente do
  -- vinculado (REF genérica, D-7), e o push tem de ir para todos.
  select coalesce(jsonb_agg(distinct m.codigo_pai), '[]'::jsonb) into v_pais
    from public.estoque_movimentos m
   where m.org_id = p_org and m.referencia_externa like 'nfe:' || v_chave || ':%';

  return jsonb_build_object('nota_id', v_nota, 'duplicada', v_status is not null, 'codigos_pai', v_pais);
end $$;

create or replace function public.desfazer_nota_compra(
  p_org uuid, p_user uuid, p_nota_id uuid, p_status text
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare v_chave text; v_numero int; v_status text; r record; v_faltas text; v_pais jsonb;
begin
  if p_status not in ('desfeita','cancelada') then
    raise exception 'desfazer_nota_compra: status inválido %', p_status using errcode = '22023';
  end if;
  select chave, numero, status into v_chave, v_numero, v_status from public.notas_compra
   where id = p_nota_id and org_id = p_org for update;
  if v_chave is null then raise exception 'desfazer_nota_compra: nota não encontrada' using errcode = 'P0002'; end if;
  if v_status <> 'importada' then
    raise exception 'desfazer_nota_compra: nota já está %', v_status using errcode = '23514';
  end if;

  -- Saldo canônico (família mais recente) × quantidade somada por SKU na nota.
  select string_agg(x.codigo || ' (saldo ' || x.saldo || ', nota ' || x.qtd || ')', ', ')
    into v_faltas
    from (
      select d.codigo, sum(d.quantidade)::int as qtd,
        (select v.estoque from public.variacoes v join public.familias f on f.id = v.familia_id
          where v.org_id = p_org and v.codigo = d.codigo order by f.criado_em desc limit 1) as saldo
        from public.notas_compra_distribuicao d
        join public.notas_compra_itens i on i.id = d.item_id
       where i.nota_id = p_nota_id
       group by d.codigo
    ) x where x.saldo < x.qtd;
  if v_faltas is not null then
    raise exception 'desfazer_nota_compra: saldo insuficiente em %', v_faltas using errcode = '23514';
  end if;

  for r in
    select d.codigo, sum(d.quantidade)::int as qtd,
      (select v.estoque from public.variacoes v join public.familias f on f.id = v.familia_id
        where v.org_id = p_org and v.codigo = d.codigo order by f.criado_em desc limit 1) as saldo
      from public.notas_compra_distribuicao d
      join public.notas_compra_itens i on i.id = d.item_id
     where i.nota_id = p_nota_id
     group by d.codigo
  loop
    perform public.ajustar_estoque(p_org, r.codigo, r.saldo - r.qtd,
      case p_status when 'desfeita' then 'Desfazer NF-e ' else 'NF-e cancelada ' end || v_numero,
      p_user, 'nfe-desfazer:' || v_chave || ':' || r.codigo);
  end loop;

  update public.notas_compra set status = p_status, desfeita_por = p_user, desfeita_em = now()
   where id = p_nota_id;

  select coalesce(jsonb_agg(distinct m.codigo_pai), '[]'::jsonb) into v_pais
    from public.estoque_movimentos m
   where m.org_id = p_org and m.referencia_externa like 'nfe-desfazer:' || v_chave || ':%';
  return jsonb_build_object('codigos_pai', v_pais);
end $$;

revoke all on function public.importar_nota_compra(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.desfazer_nota_compra(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.importar_nota_compra(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.desfazer_nota_compra(uuid, uuid, uuid, text) to service_role;
```

- [ ] **Step 4: Aplicar e rodar o teste**

```bash
supabase db push
npm run db:check
python3 scripts/teste-sql-desfeito.py supabase/tests/nota_compra.sql
```
Expected: `TESTE_OK`. Se `registrar_entrada` recusar execução para `service_role`, conferir os grants em
`20260804113000_guard_manual_product_direct_writes.sql` e **não** mudar para `security definer`.
Reportar antes de seguir.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_adr181_rpc_nota_compra.sql supabase/tests/nota_compra.sql
git commit -m "feat(adr-0181): RPCs importar/desfazer nota de compra (atômicas, idempotentes)"
```

---

### Task 3: Regras puras da nota (`_shared/nfe`)

**Files:**
- Create: `supabase/functions/_shared/nfe/tipos.ts`, `supabase/functions/_shared/nfe/regras.ts`
- Test: `supabase/functions/_shared/nfe/__tests__/regras.test.ts`

**Interfaces:**
- Produces (exatos, usados pelas Tasks 4, 5, 8 e 9):

```ts
// tipos.ts
export interface ItemNotaLido {
  nItem: number; cProd: string; xProd: string; ncm: string | null; cfop: string;
  gtin: string | null; uCom: string; qCom: number;
  vProd: number; vFrete: number; vSeg: number; vDesc: number; vOutro: number; vIPI: number; vST: number;
  orig: number | null;
}
export interface NotaCompraLida {
  chave: string; numero: number; serie: number; modelo: number; tipoNf: number;
  emitidaEm: string; emitenteCnpj: string; emitenteNome: string; destinatarioCnpj: string;
  valorTotal: number; assinada: boolean; cStat: number | null; itens: ItemNotaLido[];
}
export interface LinhaDistribuicao { codigo: string; quantidade: number; custoPrecificacao: number }
export interface ItemImportacao { nItem: number; codigoPai: string; fator: number; distribuicao: LinhaDistribuicao[] }
```

```ts
// regras.ts
export function chaveNfeValida(chave: string): boolean;
export const CFOPS_ACEITOS: ReadonlySet<string>;
export function cfopAceito(cfop: string): boolean;
export function quantidadeEmEstoque(qCom: number, fator: number): { ok: true; quantidade: number } | { ok: false; erro: string };
export function custoAquisicaoUnit(item: ItemNotaLido, fator: number): number; // sem arredondar
export function erroDistribuicao(esperado: number, linhas: LinhaDistribuicao[]): string | null;
export function limparDescricaoFornecedor(xProd: string): string;
```

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { describe, it, expect } from 'vitest';
import {
  chaveNfeValida, cfopAceito, quantidadeEmEstoque, custoAquisicaoUnit, erroDistribuicao,
  limparDescricaoFornecedor,
} from '../regras';
import type { ItemNotaLido } from '../tipos';

const item = (o: Partial<ItemNotaLido> = {}): ItemNotaLido => ({
  nItem: 1, cProd: 'REF 06', xProd: 'Short', ncm: '62034900', cfop: '5102', gtin: null, uCom: 'PC',
  qCom: 35, vProd: 350, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, orig: 0, ...o,
});

describe('chaveNfeValida', () => {
  it('aceita chave com DV correto (módulo 11)', () => {
    expect(chaveNfeValida('26261011222333000181550010000010511000030324')).toBe(true);
  });
  it('recusa DV errado, tamanho errado e não dígito', () => {
    expect(chaveNfeValida('26261011222333000181550010000010511000030325')).toBe(false);
    expect(chaveNfeValida('2626101122233300018155001000001051100003032')).toBe(false);
    expect(chaveNfeValida('2626101122233300018155001000001051100003032X')).toBe(false);
  });
});

describe('cfopAceito', () => {
  it('aceita venda/revenda do fornecedor (5102, 6102, ST 5405)', () => {
    expect(cfopAceito('5102')).toBe(true);
    expect(cfopAceito('6102')).toBe(true);
    expect(cfopAceito('5405')).toBe(true);
  });
  it('recusa bonificação (5910), remessa (5949) e devolução (5202)', () => {
    expect(cfopAceito('5910')).toBe(false);
    expect(cfopAceito('5949')).toBe(false);
    expect(cfopAceito('5202')).toBe(false);
  });
});

describe('quantidadeEmEstoque', () => {
  it('caixa com 12: 2 CX viram 24 unidades', () => {
    expect(quantidadeEmEstoque(2, 12)).toEqual({ ok: true, quantidade: 24 });
  });
  it('recusa quantidade que não fecha inteira (2,5 PC com fator 1)', () => {
    expect(quantidadeEmEstoque(2.5, 1)).toEqual({ ok: false, erro: expect.stringContaining('inteira') });
  });
  it('recusa fator < 1 ou não inteiro', () => {
    expect(quantidadeEmEstoque(2, 0).ok).toBe(false);
    expect(quantidadeEmEstoque(2, 1.5).ok).toBe(false);
  });
});

describe('custoAquisicaoUnit', () => {
  it('sem acessórios: vProd / quantidade', () => {
    expect(custoAquisicaoUnit(item(), 1)).toBe(10);
  });
  it('soma frete, seguro, outras, IPI e ST; subtrai desconto; divide pela quantidade convertida', () => {
    const i = item({ qCom: 2, vProd: 240, vFrete: 12, vSeg: 1, vOutro: 2, vIPI: 6, vST: 3, vDesc: 4 });
    expect(custoAquisicaoUnit(i, 12)).toBeCloseTo((240 + 12 + 1 + 2 + 6 + 3 - 4) / 24, 10);
  });
});

describe('erroDistribuicao', () => {
  const l = (codigo: string, quantidade: number) => ({ codigo, quantidade, custoPrecificacao: 10 });
  it('soma exata passa', () => {
    expect(erroDistribuicao(35, [l('A', 15), l('B', 20)])).toBeNull();
  });
  it('soma diferente da nota falha dizendo quanto falta', () => {
    expect(erroDistribuicao(35, [l('A', 15), l('B', 18)])).toMatch(/33 de 35/);
  });
  it('SKU repetido, quantidade não inteira ou ≤ 0 e custo ≤ 0 falham', () => {
    expect(erroDistribuicao(10, [l('A', 5), l('A', 5)])).toMatch(/repetido/);
    expect(erroDistribuicao(10, [l('A', 10.5)])).toMatch(/inteira/);
    expect(erroDistribuicao(10, [l('A', 0), l('B', 10)])).toMatch(/maior que zero/);
    expect(erroDistribuicao(10, [{ codigo: 'A', quantidade: 10, custoPrecificacao: 0 }])).toMatch(/custo/i);
  });
});

describe('limparDescricaoFornecedor', () => {
  it('tira o sufixo de grade agregada do fornecedor', () => {
    expect(limparDescricaoFornecedor('Short masculino - DIV - DIV')).toBe('Short masculino');
    expect(limparDescricaoFornecedor('Conjunto infantil - DIV')).toBe('Conjunto infantil');
  });
  it('não mexe em descrição sem sufixo e normaliza espaços', () => {
    expect(limparDescricaoFornecedor('  Camiseta  básica ')).toBe('Camiseta básica');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- supabase/functions/_shared/nfe`
Expected: FAIL (`Cannot find module '../regras'`).

- [ ] **Step 3: Implementar**

`tipos.ts`: exatamente o bloco de interfaces acima.

`regras.ts`:

```ts
// ADR-0181 — regras puras da nota de compra. Importado pelo front (src/lib/nfe) e pela edge
// importar-nota-compra: só imports relativos folha, sem jsr:/npm:/Deno.
import type { ItemNotaLido, LinhaDistribuicao } from './tipos.ts';

/** DV módulo 11 da chave de acesso (pesos 2..9 da direita para a esquerda; resto 0/1 → 0). */
export function chaveNfeValida(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false;
  let soma = 0;
  let peso = 2;
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return (r < 2 ? 0 : 11 - r) === Number(chave[43]);
}

// D-2: só venda/revenda do fornecedor (com e sem ST). Bonificação, remessa, devolução e demais
// naturezas são recusadas — entrariam no estoque com custo/efeito errado.
export const CFOPS_ACEITOS: ReadonlySet<string> = new Set([
  '5101', '5102', '5103', '5104', '5105', '5106',
  '6101', '6102', '6103', '6104', '6105', '6106', '6107', '6108',
  '5401', '5402', '5403', '5405', '6401', '6402', '6403', '6404',
]);
export const cfopAceito = (cfop: string): boolean => CFOPS_ACEITOS.has(cfop.trim());

export function quantidadeEmEstoque(
  qCom: number, fator: number,
): { ok: true; quantidade: number } | { ok: false; erro: string } {
  if (!Number.isInteger(fator) || fator < 1) {
    return { ok: false, erro: 'O fator de conversão precisa ser um número inteiro maior ou igual a 1.' };
  }
  const q = qCom * fator;
  // Tolerância de ponto flutuante: qCom vem com 4 casas no XML.
  const arred = Math.round(q);
  if (Math.abs(q - arred) > 1e-6 || arred <= 0) {
    return { ok: false, erro: `A quantidade (${qCom} × ${fator}) precisa fechar em uma quantidade inteira de unidades.` };
  }
  return { ok: true, quantidade: arred };
}

/** Custo de aquisição unitário (D-9), sem arredondar — o arredondamento é do armazenamento. */
export function custoAquisicaoUnit(item: ItemNotaLido, fator: number): number {
  const total = item.vProd + item.vFrete + item.vSeg + item.vOutro + item.vIPI + item.vST - item.vDesc;
  return total / (item.qCom * fator);
}

export function erroDistribuicao(esperado: number, linhas: LinhaDistribuicao[]): string | null {
  const vistos = new Set<string>();
  let soma = 0;
  for (const l of linhas) {
    if (vistos.has(l.codigo)) return `SKU repetido na distribuição: ${l.codigo}.`;
    vistos.add(l.codigo);
    if (!Number.isInteger(l.quantidade)) return `A quantidade de ${l.codigo} precisa ser inteira.`;
    if (l.quantidade <= 0) return `A quantidade de ${l.codigo} precisa ser maior que zero.`;
    if (!(l.custoPrecificacao > 0)) return `O custo de ${l.codigo} precisa ser maior que zero.`;
    soma += l.quantidade;
  }
  if (soma !== esperado) return `A distribuição soma ${soma} de ${esperado} unidades da nota.`;
  return null;
}

export function limparDescricaoFornecedor(xProd: string): string {
  return xProd.replace(/(\s*-\s*DIV)+\s*$/i, '').replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- supabase/functions/_shared/nfe`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/nfe
git commit -m "feat(adr-0181): regras puras da nota de compra (chave, CFOP, conversão, custo, distribuição)"
```

---

### Task 4: Leitor de XML no front (`src/lib/nfe/ler-nfe.ts`)

**Files:**
- Create: `src/lib/nfe/ler-nfe.ts`
- Create: `src/lib/nfe/__tests__/fixtures/nfe-exportacao-erp.xml`, `src/lib/nfe/__tests__/fixtures/nfe-sefaz.xml`
- Test: `src/lib/nfe/__tests__/ler-nfe.test.ts`

**Interfaces:**
- Consumes: `NotaCompraLida`, `ItemNotaLido` de `supabase/functions/_shared/nfe/tipos.ts` (import relativo, como `src/lib/tamanhos.ts` faz).
- Produces: `export function lerNfe(xml: string): { ok: true; nota: NotaCompraLida } | { ok: false; erro: string }`

- [ ] **Step 1: Criar as fixtures (dados fictícios)**

`nfe-exportacao-erp.xml`: mesma forma do arquivo real do cliente (`nItem` como elemento, sem `Signature`),
com CNPJs fictícios:

```xml
<?xml version="1.0" encoding="utf-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><protNFe><infProt><chNFe>26261011222333000181550010000010511000030324</chNFe><cStat>100</cStat></infProt></protNFe><NFe><infNFe Id="NFe26261011222333000181550010000010511000030324"><det><nItem>1</nItem><prod><cEAN>SEM GTIN</cEAN><cProd>REF 06</cProd><qCom>35.0000</qCom><vProd>350.00</vProd><xProd>Short masculino - DIV - DIV</xProd><NCM>62034900</NCM><uCom>PC</uCom><CFOP>5102</CFOP></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto></det><det><nItem>2</nItem><prod><cEAN>SEM GTIN</cEAN><cProd>REF 08</cProd><qCom>35.0000</qCom><vProd>350.00</vProd><xProd>Conjunto infantil - DIV - DIV</xProd><NCM>61042300</NCM><uCom>PC</uCom><CFOP>5102</CFOP></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto></det><total><ICMSTot><vNF>700.00</vNF></ICMSTot></total><ide><tpNF>1</tpNF><mod>55</mod><nNF>1051</nNF><serie>1</serie><dhEmi>2026-10-13T15:57:33-03:00</dhEmi></ide><emit><xNome>FORNECEDOR TESTE LTDA</xNome><CNPJ>11222333000181</CNPJ></emit><dest><xNome>CLIENTE TESTE LTDA</xNome><CNPJ>11444777000161</CNPJ></dest></infNFe></NFe></nfeProc>
```

`nfe-sefaz.xml`: formato oficial (`<det nItem="1">`, `<Signature>`), com frete, desconto, IPI, ST e GTIN, e
`uCom = CX`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe26261011222333000181550010000010511000030324" versao="4.00"><ide><mod>55</mod><serie>1</serie><nNF>1051</nNF><dhEmi>2026-10-13T15:57:33-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>11222333000181</CNPJ><xNome>FORNECEDOR TESTE LTDA</xNome></emit><dest><CNPJ>11444777000161</CNPJ><xNome>CLIENTE TESTE LTDA</xNome></dest><det nItem="1"><prod><cProd>CX-12</cProd><cEAN>7891234567895</cEAN><xProd>Meia soquete</xProd><NCM>61159500</NCM><CFOP>6102</CFOP><uCom>CX</uCom><qCom>2.0000</qCom><vProd>240.00</vProd><vFrete>12.00</vFrete><vSeg>1.00</vSeg><vDesc>4.00</vDesc><vOutro>2.00</vOutro></prod><imposto><ICMS><ICMS10><orig>2</orig><vICMSST>3.00</vICMSST></ICMS10></ICMS><IPI><IPITrib><vIPI>6.00</vIPI></IPITrib></IPI></imposto></det><total><ICMSTot><vNF>260.00</vNF></ICMSTot></total></infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/></Signature></NFe><protNFe versao="4.00"><infProt><chNFe>26261011222333000181550010000010511000030324</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>
```

- [ ] **Step 2: Escrever os testes que falham**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lerNfe } from '../ler-nfe';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');

describe('lerNfe — exportação de ERP (formato do cliente)', () => {
  const r = lerNfe(fx('nfe-exportacao-erp.xml'));
  it('lê cabeçalho e marca como não assinada', () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nota).toMatchObject({
      chave: '26261011222333000181550010000010511000030324', numero: 1051, serie: 1, modelo: 55,
      tipoNf: 1, emitenteCnpj: '11222333000181', emitenteNome: 'FORNECEDOR TESTE LTDA',
      destinatarioCnpj: '11444777000161', valorTotal: 700, assinada: false, cStat: 100,
      emitidaEm: '2026-10-13T15:57:33-03:00',
    });
  });
  it('lê nItem como elemento e trata SEM GTIN como null', () => {
    if (!r.ok) throw new Error(r.erro);
    expect(r.nota.itens).toHaveLength(2);
    expect(r.nota.itens[0]).toEqual({
      nItem: 1, cProd: 'REF 06', xProd: 'Short masculino - DIV - DIV', ncm: '62034900', cfop: '5102',
      gtin: null, uCom: 'PC', qCom: 35, vProd: 350, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0,
      vIPI: 0, vST: 0, orig: 0,
    });
  });
});

describe('lerNfe — XML da SEFAZ', () => {
  const r = lerNfe(fx('nfe-sefaz.xml'));
  it('lê nItem como atributo, assinatura, GTIN e valores acessórios', () => {
    if (!r.ok) throw new Error(r.erro);
    expect(r.nota.assinada).toBe(true);
    expect(r.nota.itens[0]).toMatchObject({
      nItem: 1, gtin: '7891234567895', uCom: 'CX', qCom: 2, vProd: 240, vFrete: 12, vSeg: 1,
      vDesc: 4, vOutro: 2, vIPI: 6, vST: 3, orig: 2,
    });
  });
});

describe('lerNfe — recusas', () => {
  it('XML malformado', () => {
    expect(lerNfe('<nfeProc><NFe>')).toEqual({ ok: false, erro: expect.stringContaining('XML') });
  });
  it('arquivo que não é NF-e', () => {
    expect(lerNfe('<?xml version="1.0"?><cte/>')).toEqual({ ok: false, erro: expect.stringContaining('NF-e') });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm test -- src/lib/nfe`
Expected: FAIL (`Cannot find module '../ler-nfe'`).

- [ ] **Step 4: Implementar**

```ts
// ADR-0181 D-2 — leitura do XML da nota de compra no navegador (DOMParser nativo; jsdom nos
// testes). Aceita o XML da SEFAZ (nfeProc assinado, nItem atributo) e a exportação de ERP
// (sem Signature, nItem elemento). A edge revalida as invariantes; aqui só se lê.
import type { ItemNotaLido, NotaCompraLida } from '../../../supabase/functions/_shared/nfe/tipos';

const filhos = (el: Element | Document, nome: string): Element[] =>
  Array.from(el.getElementsByTagNameNS('*', nome));
const primeiro = (el: Element | Document, nome: string): Element | null => filhos(el, nome)[0] ?? null;
const texto = (el: Element | Document | null, nome: string): string | null =>
  el ? (primeiro(el, nome)?.textContent?.trim() || null) : null;
const num = (el: Element | Document | null, nome: string): number => Number(texto(el, nome) ?? 0);

export function lerNfe(xml: string): { ok: true; nota: NotaCompraLida } | { ok: false; erro: string } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return { ok: false, erro: 'Arquivo XML inválido ou corrompido.' };
  }
  const inf = primeiro(doc, 'infNFe');
  if (!inf) return { ok: false, erro: 'O arquivo não é uma NF-e (falta infNFe).' };

  const chave = texto(doc, 'chNFe') ?? (inf.getAttribute('Id') ?? '').replace(/^NFe/, '');
  const ide = primeiro(inf, 'ide');
  const emit = primeiro(inf, 'emit');
  const dest = primeiro(inf, 'dest');
  const cStat = texto(primeiro(doc, 'infProt'), 'cStat');

  const itens: ItemNotaLido[] = filhos(inf, 'det').map((det) => {
    const prod = primeiro(det, 'prod');
    const imposto = primeiro(det, 'imposto');
    const icms = imposto ? primeiro(imposto, 'ICMS') : null;
    const ipi = imposto ? primeiro(imposto, 'IPI') : null;
    const gtin = texto(prod, 'cEAN');
    const orig = texto(icms, 'orig');
    return {
      nItem: Number(det.getAttribute('nItem') ?? texto(det, 'nItem')),
      cProd: texto(prod, 'cProd') ?? '',
      xProd: texto(prod, 'xProd') ?? '',
      ncm: texto(prod, 'NCM'),
      cfop: texto(prod, 'CFOP') ?? '',
      gtin: gtin && /^\d{8,14}$/.test(gtin) ? gtin : null,
      uCom: texto(prod, 'uCom') ?? '',
      qCom: num(prod, 'qCom'),
      vProd: num(prod, 'vProd'), vFrete: num(prod, 'vFrete'), vSeg: num(prod, 'vSeg'),
      vDesc: num(prod, 'vDesc'), vOutro: num(prod, 'vOutro'),
      vIPI: num(ipi, 'vIPI'), vST: num(icms, 'vICMSST'),
      orig: orig === null ? null : Number(orig),
    };
  });

  return {
    ok: true,
    nota: {
      chave,
      numero: num(ide, 'nNF'), serie: num(ide, 'serie'), modelo: num(ide, 'mod'), tipoNf: num(ide, 'tpNF'),
      emitidaEm: texto(ide, 'dhEmi') ?? '',
      emitenteCnpj: texto(emit, 'CNPJ') ?? '', emitenteNome: texto(emit, 'xNome') ?? '',
      destinatarioCnpj: texto(dest, 'CNPJ') ?? '',
      valorTotal: num(primeiro(inf, 'ICMSTot'), 'vNF'),
      assinada: filhos(doc, 'Signature').length > 0,
      cStat: cStat === null ? null : Number(cStat),
      itens,
    },
  };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test -- src/lib/nfe`
Expected: PASS. Se `texto(emit, 'xNome')` pegar o `xNome` errado (o de `enderEmit` não existe, mas o de
`dest` não está dentro de `emit`), não há conflito. Mesmo assim, conferir no teste.

- [ ] **Step 6: Commit**

```bash
git add src/lib/nfe
git commit -m "feat(adr-0181): leitor de XML NF-e de compra (SEFAZ e exportação de ERP)"
```

---

### Task 5: Edge `importar-nota-compra`

**Files:**
- Create: `supabase/functions/importar-nota-compra/{index.ts,validar.ts,processar.ts}`
- Create: `supabase/functions/importar-nota-compra/__tests__/{validar,processar}.test.ts`
- Modify: `supabase/config.toml` (add `[functions.importar-nota-compra]` `verify_jwt = true`, comentário `# ADR-0181`)

**Interfaces:**
- Consumes: Task 2 (RPC), Task 3 (`chaveNfeValida`, `cfopAceito`, `quantidadeEmEstoque`, `custoAquisicaoUnit`, `erroDistribuicao`, tipos), `enfileirarSincronizacaoEstoque` (`_shared/queue.ts`).
- Produces: `POST importar-nota-compra` com body `{ xml: string; nota: NotaCompraLida; itens: ItemImportacao[] }` → 200 `{ notaId: string; duplicada: boolean; pushOk: boolean }` | 400 `{ error }` | 403 `{ error }`.
  - `validarImportacao(body: unknown, cnpjOrg: string): { ok: true; nota: NotaCompraLida; itens: ItemImportacao[]; xml: string } | { ok: false; erro: string }`
  - `montarItensRpc(nota: NotaCompraLida, itens: ItemImportacao[]): Record<string, unknown>[]`
  - `processarImportacao(deps: DepsImportacao, p: { orgId: string; userId: string; nota: NotaCompraLida; itens: ItemImportacao[]; xml: string }): Promise<{ notaId: string; duplicada: boolean; pushOk: boolean }>`

- [ ] **Step 1: Testes de `validar` que falham**

```ts
import { describe, it, expect } from 'vitest';
import { validarImportacao } from '../validar';
import type { NotaCompraLida } from '../../_shared/nfe/tipos';

const CHAVE = '26261011222333000181550010000010511000030324';
const nota = (o: Partial<NotaCompraLida> = {}): NotaCompraLida => ({
  chave: CHAVE, numero: 1051, serie: 1, modelo: 55, tipoNf: 1, emitidaEm: '2026-10-13T15:57:33-03:00',
  emitenteCnpj: '11222333000181', emitenteNome: 'F', destinatarioCnpj: '11444777000161',
  valorTotal: 350, assinada: false, cStat: 100,
  itens: [{ nItem: 1, cProd: 'REF 06', xProd: 'Short', ncm: '62034900', cfop: '5102', gtin: null,
    uCom: 'PC', qCom: 35, vProd: 350, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, orig: 0 }],
  ...o,
});
const itens = [{ nItem: 1, codigoPai: '09300000', fator: 1, distribuicao: [
  { codigo: '09300001', quantidade: 15, custoPrecificacao: 14 },
  { codigo: '09300002', quantidade: 20, custoPrecificacao: 14 }] }];
const body = (o: Record<string, unknown> = {}) => ({ xml: `<x>${CHAVE}</x>`, nota: nota(), itens, ...o });

describe('validarImportacao', () => {
  it('aceita nota coerente', () => {
    expect(validarImportacao(body(), '11444777000161').ok).toBe(true);
  });
  it('recusa destinatário diferente da empresa', () => {
    expect(validarImportacao(body(), '99999999000191')).toEqual({ ok: false, erro: expect.stringMatching(/destinat/i) });
  });
  it('recusa chave com DV inválido', () => {
    expect(validarImportacao(body({ nota: nota({ chave: CHAVE.slice(0, 43) + '5' }) }), '11444777000161').ok).toBe(false);
  });
  it('recusa cStat diferente de 100 quando há protocolo, aceita sem protocolo', () => {
    expect(validarImportacao(body({ nota: nota({ cStat: 101 }) }), '11444777000161').ok).toBe(false);
    expect(validarImportacao(body({ nota: nota({ cStat: null }) }), '11444777000161').ok).toBe(true);
  });
  it('recusa modelo ≠ 55 e tipo ≠ saída', () => {
    expect(validarImportacao(body({ nota: nota({ modelo: 65 }) }), '11444777000161').ok).toBe(false);
    expect(validarImportacao(body({ nota: nota({ tipoNf: 0 }) }), '11444777000161').ok).toBe(false);
  });
  it('recusa CFOP fora da lista, nomeando o item', () => {
    const n = nota(); n.itens[0].cfop = '5910';
    expect(validarImportacao(body({ nota: n }), '11444777000161'))
      .toEqual({ ok: false, erro: expect.stringMatching(/item 1.*5910/i) });
  });
  it('recusa item da nota sem decisão e decisão para item inexistente', () => {
    expect(validarImportacao(body({ itens: [] }), '11444777000161').ok).toBe(false);
    expect(validarImportacao(body({ itens: [{ ...itens[0], nItem: 9 }] }), '11444777000161').ok).toBe(false);
  });
  it('recusa distribuição que não fecha com a quantidade convertida', () => {
    const it2 = [{ ...itens[0], fator: 2 }];
    expect(validarImportacao(body({ itens: it2 }), '11444777000161'))
      .toEqual({ ok: false, erro: expect.stringMatching(/35 de 70/) });
  });
  it('recusa XML que não contém a chave informada (arquivo trocado)', () => {
    expect(validarImportacao(body({ xml: '<x/>' }), '11444777000161').ok).toBe(false);
  });
  it('recusa XML acima de 1 MB', () => {
    expect(validarImportacao(body({ xml: CHAVE + 'x'.repeat(1_048_577) }), '11444777000161').ok).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- supabase/functions/importar-nota-compra`
Expected: FAIL (`Cannot find module '../validar'`).

- [ ] **Step 3: Implementar `validar.ts`**

```ts
// ADR-0181 D-2 — invariantes da importação, revalidadas no servidor.
// ponytail: confia na leitura estruturada feita no navegador e confere só a coerência com o XML
// bruto (a chave tem de estar no arquivo). Teto: uma org poderia enviar JSON divergente do
// próprio XML — o dado e o risco são dela. Upgrade: parser XML no servidor.
import {
  chaveNfeValida, cfopAceito, quantidadeEmEstoque, erroDistribuicao,
} from '../_shared/nfe/regras.ts';
import type { ItemImportacao, NotaCompraLida } from '../_shared/nfe/tipos.ts';

const TETO_XML = 1_048_576;

export function validarImportacao(
  body: unknown, cnpjOrg: string,
): { ok: true; nota: NotaCompraLida; itens: ItemImportacao[]; xml: string } | { ok: false; erro: string } {
  const b = body as { xml?: unknown; nota?: NotaCompraLida; itens?: ItemImportacao[] };
  if (typeof b?.xml !== 'string' || !b.nota || !Array.isArray(b.itens)) {
    return { ok: false, erro: 'Envie o XML, a nota lida e as decisões por item.' };
  }
  const { nota, itens, xml } = { nota: b.nota, itens: b.itens, xml: b.xml };
  if (xml.length > TETO_XML) return { ok: false, erro: 'O XML passa de 1 MB.' };
  if (!chaveNfeValida(nota.chave)) return { ok: false, erro: 'Chave de acesso inválida (dígito verificador).' };
  if (!xml.includes(nota.chave)) return { ok: false, erro: 'O arquivo enviado não contém a chave da nota lida.' };
  if (nota.modelo !== 55) return { ok: false, erro: 'Só NF-e modelo 55 é aceita.' };
  if (nota.tipoNf !== 1) return { ok: false, erro: 'A nota precisa ser de saída do fornecedor (venda).' };
  if (nota.cStat !== null && nota.cStat !== 100) {
    return { ok: false, erro: `A nota não está autorizada (cStat ${nota.cStat}).` };
  }
  if (nota.destinatarioCnpj.replace(/\D/g, '') !== cnpjOrg.replace(/\D/g, '')) {
    return { ok: false, erro: 'O destinatário da nota não é o CNPJ desta empresa.' };
  }

  const porItem = new Map(itens.map((i) => [i.nItem, i]));
  if (porItem.size !== itens.length) return { ok: false, erro: 'Decisão repetida para o mesmo item.' };
  for (const n of itens) {
    if (!nota.itens.some((i) => i.nItem === n.nItem)) return { ok: false, erro: `Item ${n.nItem} não existe na nota.` };
  }
  for (const item of nota.itens) {
    if (!cfopAceito(item.cfop)) {
      return { ok: false, erro: `Item ${item.nItem}: CFOP ${item.cfop} não é de venda/revenda — nota recusada.` };
    }
    const dec = porItem.get(item.nItem);
    if (!dec) return { ok: false, erro: `Item ${item.nItem} (${item.xProd}) está sem produto definido.` };
    if (!dec.codigoPai?.trim()) return { ok: false, erro: `Item ${item.nItem}: escolha o produto.` };
    const q = quantidadeEmEstoque(item.qCom, dec.fator);
    if (!q.ok) return { ok: false, erro: `Item ${item.nItem}: ${q.erro}` };
    const e = erroDistribuicao(q.quantidade, dec.distribuicao);
    if (e) return { ok: false, erro: `Item ${item.nItem}: ${e}` };
  }
  return { ok: true, nota, itens, xml };
}
```

- [ ] **Step 4: Rodar validar e ver passar**

Run: `pnpm test -- supabase/functions/importar-nota-compra/__tests__/validar`
Expected: PASS.

- [ ] **Step 5: Testes de `processar` que falham**

```ts
import { describe, it, expect } from 'vitest';
import { processarImportacao, montarItensRpc, type DepsImportacao } from '../processar';
import type { NotaCompraLida, ItemImportacao } from '../../_shared/nfe/tipos';

const nota: NotaCompraLida = {
  chave: '26261011222333000181550010000010511000030324', numero: 1051, serie: 1, modelo: 55, tipoNf: 1,
  emitidaEm: '2026-10-13T15:57:33-03:00', emitenteCnpj: '11222333000181', emitenteNome: 'F',
  destinatarioCnpj: '11444777000161', valorTotal: 300, assinada: false, cStat: 100,
  itens: [{ nItem: 1, cProd: 'REF 06', xProd: 'Short', ncm: '62034900', cfop: '5102', gtin: null,
    uCom: 'PC', qCom: 3, vProd: 100, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, orig: 0 }],
};
const itens: ItemImportacao[] = [{ nItem: 1, codigoPai: 'P1', fator: 1,
  distribuicao: [{ codigo: 'S1', quantidade: 3, custoPrecificacao: 40 }] }];

function deps(over: Partial<DepsImportacao> = {}) {
  const log: string[] = [];
  const jobs: string[] = [];
  const d: DepsImportacao = {
    upload: async (path) => { log.push(`upload:${path}`); },
    rpc: async (_n, args) => {
      log.push('rpc');
      expect(args.p_nota).toMatchObject({ xml_path: `org-1/${nota.chave}.xml` });
      return { data: { nota_id: 'n1', duplicada: false, codigos_pai: ['P1', 'P2'] }, error: null };
    },
    enfileirar: async (job) => { jobs.push(job.codigo_pai); return 'm'; },
    ...over,
  };
  return { d, log, jobs };
}

describe('montarItensRpc', () => {
  it('guarda custo de aquisição exato (100/3) e o de precificação informado', () => {
    const [i] = montarItensRpc(nota, itens);
    const dist = (i.distribuicao as Array<Record<string, number>>)[0];
    expect(dist.custo_aquisicao_unit).toBeCloseTo(33.333333, 6);
    expect(dist.custo_precificacao_unit).toBe(40);
    expect(i).toMatchObject({ n_item: 1, cprod: 'REF 06', codigo_pai: 'P1', fator_conversao: 1 });
  });
});

describe('processarImportacao', () => {
  it('sobe o XML antes da RPC e enfileira push para TODOS os produtos tocados', async () => {
    const { d, log, jobs } = deps();
    const r = await processarImportacao(d, { orgId: 'org-1', userId: 'u', nota, itens, xml: '<x/>' });
    expect(log).toEqual([`upload:org-1/${nota.chave}.xml`, 'rpc']);
    expect(jobs).toEqual(['P1', 'P2']);
    expect(r).toEqual({ notaId: 'n1', duplicada: false, pushOk: true });
  });
  it('reimportação (duplicada) ainda enfileira o push (retry que morreu antes do push)', async () => {
    const { d, jobs } = deps({
      rpc: async () => ({ data: { nota_id: 'n1', duplicada: true, codigos_pai: ['P1'] }, error: null }),
    });
    const r = await processarImportacao(d, { orgId: 'org-1', userId: 'u', nota, itens, xml: '<x/>' });
    expect(r.duplicada).toBe(true);
    expect(jobs).toEqual(['P1']);
  });
  it('erro da RPC propaga como Error com a mensagem do banco', async () => {
    const { d } = deps({ rpc: async () => ({ data: null, error: { message: 'saldo insuficiente' } }) });
    await expect(processarImportacao(d, { orgId: 'org-1', userId: 'u', nota, itens, xml: '<x/>' }))
      .rejects.toThrow('saldo insuficiente');
  });
  it('falha de push não desfaz a entrada: pushOk=false', async () => {
    const { d } = deps({ enfileirar: async () => { throw new Error('qstash'); } });
    const r = await processarImportacao(d, { orgId: 'org-1', userId: 'u', nota, itens, xml: '<x/>' });
    expect(r.pushOk).toBe(false);
  });
});
```

- [ ] **Step 6: Implementar `processar.ts`**

```ts
// ADR-0181 D-3/D-4 — miolo da importação, dependências injetadas (testável sem Deno).
import { custoAquisicaoUnit } from '../_shared/nfe/regras.ts';
import type { ItemImportacao, NotaCompraLida } from '../_shared/nfe/tipos.ts';

export interface DepsImportacao {
  upload(path: string, xml: string): Promise<void>;
  rpc(nome: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  enfileirar(job: { org_id: string; codigo_pai: string; canal_origem: null; reativar: true }, orgId: string): Promise<string>;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function montarItensRpc(nota: NotaCompraLida, itens: ItemImportacao[]): Record<string, unknown>[] {
  return nota.itens.map((i) => {
    const dec = itens.find((d) => d.nItem === i.nItem)!;
    const custo = r6(custoAquisicaoUnit(i, dec.fator));
    return {
      n_item: i.nItem, cprod: i.cProd, xprod: i.xProd, ncm: i.ncm, cfop: i.cfop, gtin: i.gtin,
      ucom: i.uCom, qcom: i.qCom, fator_conversao: dec.fator,
      v_prod: i.vProd, v_frete: i.vFrete, v_seg: i.vSeg, v_desc: i.vDesc, v_outro: i.vOutro,
      v_ipi: i.vIPI, v_st: i.vST, orig: i.orig, codigo_pai: dec.codigoPai,
      distribuicao: dec.distribuicao.map((l) => ({
        codigo: l.codigo, quantidade: l.quantidade,
        custo_aquisicao_unit: custo, custo_precificacao_unit: l.custoPrecificacao,
      })),
    };
  });
}

export async function processarImportacao(
  deps: DepsImportacao,
  p: { orgId: string; userId: string; nota: NotaCompraLida; itens: ItemImportacao[]; xml: string },
): Promise<{ notaId: string; duplicada: boolean; pushOk: boolean }> {
  const xmlPath = `${p.orgId}/${p.nota.chave}.xml`;
  // XML primeiro: se a RPC falhar, sobra um arquivo órfão sobrescrevível (upsert) na próxima
  // tentativa — o contrário (nota gravada sem XML) violaria D-3.
  await deps.upload(xmlPath, p.xml);

  const { data, error } = await deps.rpc('importar_nota_compra', {
    p_org: p.orgId, p_user: p.userId,
    p_nota: {
      chave: p.nota.chave, numero: p.nota.numero, serie: p.nota.serie,
      emitente_cnpj: p.nota.emitenteCnpj, emitente_nome: p.nota.emitenteNome,
      emitida_em: p.nota.emitidaEm, valor_total: p.nota.valorTotal, assinada: p.nota.assinada,
      xml_path: xmlPath,
    },
    p_itens: montarItensRpc(p.nota, p.itens),
  });
  if (error) throw new Error(error.message);
  const r = data as { nota_id: string; duplicada: boolean; codigos_pai: string[] };

  // Push sempre, inclusive em duplicada (mesmo racional de entrada-estoque/processar.ts).
  let pushOk = true;
  for (const codigoPai of r.codigos_pai) {
    try {
      await deps.enfileirar({ org_id: p.orgId, codigo_pai: codigoPai, canal_origem: null, reativar: true }, p.orgId);
    } catch (e) {
      pushOk = false;
      console.error('importar_nota_push_falhou', codigoPai, String(e));
    }
  }
  return { notaId: r.nota_id, duplicada: r.duplicada, pushOk };
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm test -- supabase/functions/importar-nota-compra`
Expected: PASS.

- [ ] **Step 8: Implementar `index.ts`**

```ts
// ADR-0181 — importação de NF-e de compra. JWT do app; gate estoque; exige PJ + CNPJ na
// empresa_fiscal (o destinatário da nota é conferido contra ele). Escrita via service_role.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { enfileirarSincronizacaoEstoque } from '../_shared/queue.ts';
import { validarImportacao } from './validar.ts';
import { processarImportacao } from './processar.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let ctx: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ctx = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { userId, orgId } = ctx;
  const admin = adminClient();

  if (!(await exigirModulo(admin, orgId, 'estoque'))) {
    return json({ error: 'Módulo de estoque não habilitado.' }, 403);
  }
  const { data: org } = await admin.from('organizations').select('tipo_pessoa').eq('id', orgId).maybeSingle();
  const { data: emp } = await admin.from('empresa_fiscal').select('cnpj').eq('org_id', orgId).maybeSingle();
  if (org?.tipo_pessoa !== 'pj' || !emp?.cnpj) {
    return json({ error: 'Cadastre o CNPJ da empresa em Configurações › Fiscal antes de importar notas.' }, 403);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const v = validarImportacao(body, emp.cnpj as string);
  if (!v.ok) return json({ error: v.erro }, 400);

  try {
    const r = await processarImportacao({
      upload: async (path, xml) => {
        const { error } = await admin.storage.from('notas-compra')
          .upload(path, new Blob([xml], { type: 'application/xml' }), { upsert: true, contentType: 'application/xml' });
        if (error) throw new Error(`upload do XML: ${error.message}`);
      },
      rpc: async (nome, args) => {
        const { data, error } = await admin.rpc(nome, args);
        return { data, error: error ? { message: error.message } : null };
      },
      enfileirar: (job, org) => enfileirarSincronizacaoEstoque(job, org),
    }, { orgId, userId, nota: v.nota, itens: v.itens, xml: v.xml });
    await auditarOperacaoSuporte(admin, ctx, { type: 'nota_compra', id: v.nota.chave }, 'succeeded');
    return json(r);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
```

Conferir a assinatura real de `enfileirarSincronizacaoEstoque` em `_shared/queue.ts:222` e de
`auditarOperacaoSuporte` no `entrada-estoque/index.ts`. Ajustar a chamada para ficar **idêntica** ao uso de lá.

- [ ] **Step 9: Registrar no config e checar Deno**

Em `supabase/config.toml`, junto das entradas de estoque:

```toml
# ADR-0181 — importação de NF-e de compra (JWT do app, gate estoque).
[functions.importar-nota-compra]
verify_jwt = true
```

Run: `pnpm lint:functions && pnpm check:functions`
Expected: sem erros.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/importar-nota-compra supabase/config.toml
git commit -m "feat(adr-0181): edge importar-nota-compra"
```

---

### Task 6: Edge `desfazer-nota-compra` (admin)

**Files:**
- Create: `supabase/functions/desfazer-nota-compra/{index.ts,processar.ts}`, `supabase/functions/desfazer-nota-compra/__tests__/processar.test.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: RPC `desfazer_nota_compra` (Task 2).
- Produces: `POST desfazer-nota-compra` body `{ notaId: string; status: 'desfeita' | 'cancelada' }` → 200 `{ pushOk: boolean }` | 400/403 `{ error }`.
  - `processarDesfazer(deps: DepsDesfazer, p: { orgId: string; userId: string; notaId: string; status: 'desfeita' | 'cancelada' }): Promise<{ pushOk: boolean }>`

- [ ] **Step 1: Teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { processarDesfazer, type DepsDesfazer } from '../processar';

describe('processarDesfazer', () => {
  it('chama a RPC com o status e enfileira push dos produtos devolvidos', async () => {
    const jobs: string[] = [];
    const args: Record<string, unknown>[] = [];
    const d: DepsDesfazer = {
      rpc: async (_n, a) => { args.push(a); return { data: { codigos_pai: ['P1'] }, error: null }; },
      enfileirar: async (j) => { jobs.push(j.codigo_pai); return 'm'; },
    };
    const r = await processarDesfazer(d, { orgId: 'o', userId: 'u', notaId: 'n', status: 'cancelada' });
    expect(args[0]).toEqual({ p_org: 'o', p_user: 'u', p_nota_id: 'n', p_status: 'cancelada' });
    expect(jobs).toEqual(['P1']);
    expect(r).toEqual({ pushOk: true });
  });
  it('erro de saldo insuficiente propaga a mensagem', async () => {
    const d: DepsDesfazer = {
      rpc: async () => ({ data: null, error: { message: 'desfazer_nota_compra: saldo insuficiente em 09300002' } }),
      enfileirar: async () => 'm',
    };
    await expect(processarDesfazer(d, { orgId: 'o', userId: 'u', notaId: 'n', status: 'desfeita' }))
      .rejects.toThrow(/saldo insuficiente/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- supabase/functions/desfazer-nota-compra`
Expected: FAIL.

- [ ] **Step 3: Implementar `processar.ts`**

```ts
// ADR-0181 D-11 — desfazer/cancelar importação (admin). Reduz via ajustar_estoque dentro da RPC.
export interface DepsDesfazer {
  rpc(nome: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  enfileirar(job: { org_id: string; codigo_pai: string; canal_origem: null; reativar: true }, orgId: string): Promise<string>;
}

export async function processarDesfazer(
  deps: DepsDesfazer,
  p: { orgId: string; userId: string; notaId: string; status: 'desfeita' | 'cancelada' },
): Promise<{ pushOk: boolean }> {
  const { data, error } = await deps.rpc('desfazer_nota_compra', {
    p_org: p.orgId, p_user: p.userId, p_nota_id: p.notaId, p_status: p.status,
  });
  if (error) throw new Error(error.message);
  let pushOk = true;
  for (const codigoPai of (data as { codigos_pai: string[] }).codigos_pai) {
    try {
      await deps.enfileirar({ org_id: p.orgId, codigo_pai: codigoPai, canal_origem: null, reativar: true }, p.orgId);
    } catch (e) { pushOk = false; console.error('desfazer_nota_push_falhou', codigoPai, String(e)); }
  }
  return { pushOk };
}
```

- [ ] **Step 4: Implementar `index.ts`**

Mesmo esqueleto do `index.ts` da Task 5, com estas diferenças:
- `if (!ctx.isAdmin) return json({ error: 'Só administradores podem desfazer uma importação.' }, 403);`
- valida `typeof body.notaId === 'string'` e `body.status in ['desfeita','cancelada']` (senão 400);
- chama `processarDesfazer` e `auditarOperacaoSuporte(admin, ctx, { type: 'nota_compra', id: body.notaId }, 'succeeded')`;
- erro → 400 `{ error: e.message }`.

Config:

```toml
# ADR-0181 D-11 — desfazer/cancelar importação de NF-e de compra (admin).
[functions.desfazer-nota-compra]
verify_jwt = true
```

- [ ] **Step 5: Rodar testes e checagem Deno**

Run: `pnpm test -- supabase/functions/desfazer-nota-compra && pnpm lint:functions && pnpm check:functions`
Expected: PASS, sem erros.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/desfazer-nota-compra supabase/config.toml
git commit -m "feat(adr-0181): edge desfazer-nota-compra (admin)"
```

---

### Task 7: Descrição fiscal no Faturador + CSOSN padrão de revenda

**Files:**
- Modify: `supabase/functions/_shared/canais/fiscal-ml.ts:20-44` (`FamiliaFiscalPush` + `title`)
- Modify: quem monta `FamiliaFiscalPush` (localizar com `grep -rn "montarFiscalInformation\|FamiliaFiscalPush" supabase/functions --include=*.ts`) para selecionar `descricao_fiscal`
- Modify: `supabase/functions/_shared/produto/validar.ts` (`ProdutoEntrada.fiscal.descricaoFiscal?`, `montarLinhasProduto` grava `descricao_fiscal`) + espelho `src/lib/produto-entrada.ts`
- Modify: `supabase/functions/atualizar-fiscal-familia/processar.ts` (aceita e grava `descricaoFiscal`)
- Modify: `src/components/estoque/etapa-fiscal-form.tsx` e `src/components/estoque/dialog-fiscal-produto.tsx` (campo "Descrição na nota fiscal")
- Modify: `src/components/configuracoes/secao-fiscal.tsx` (campo "CSOSN padrão de revenda")
- Test: `supabase/functions/_shared/canais/__tests__/fiscal-ml.test.ts`, `supabase/functions/atualizar-fiscal-familia/__tests__/processar.test.ts`, `supabase/functions/_shared/produto/__tests__/` (teste existente do `montarLinhasProduto`)

**Interfaces:**
- Produces: `FamiliaFiscalPush.descricao_fiscal: string | null`; `ProdutoEntrada.fiscal.descricaoFiscal?: string | null`; o `CadastroInicial` da Task 10 usa `descricaoFiscal`.

- [ ] **Step 1: Teste que falha em `fiscal-ml.test.ts`**

```ts
it('title usa a descrição fiscal quando existe, e cai no nome_pai quando é nula ou vazia', () => {
  const base = { nome_pai: 'Short Masculino Tactel Praia', unidade: 'UN', ncm: '62034900', cest: null,
    origem_nfe: 0, fci: null, ex_tipi: null, tributacao_icms: '102' };
  const v = { codigo: 'S1', gtin: null, peso_gramas: null, ml_variation_id: null };
  expect(montarFiscalInformation({ ...base, descricao_fiscal: 'Short masculino' }, v, { origin_type: 'reseller' }).title)
    .toBe('Short masculino');
  expect(montarFiscalInformation({ ...base, descricao_fiscal: null }, v, { origin_type: 'reseller' }).title)
    .toBe('Short Masculino Tactel Praia');
  expect(montarFiscalInformation({ ...base, descricao_fiscal: '  ' }, v, { origin_type: 'reseller' }).title)
    .toBe('Short Masculino Tactel Praia');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- supabase/functions/_shared/canais/__tests__/fiscal-ml`
Expected: FAIL (erro de tipo/valor no title).

- [ ] **Step 3: Implementar em `fiscal-ml.ts`**

```ts
export interface FamiliaFiscalPush {
  nome_pai: string; descricao_fiscal: string | null; unidade: string | null; ncm: string | null; cest: string | null;
  origem_nfe: number | null; fci: string | null; ex_tipi: string | null;
  tributacao_icms: string | null;
}
// ...
    // ADR-0181 D-5: o texto da nota de venda é a descrição fiscal; sem ela, o nome do produto.
    title: familia.descricao_fiscal?.trim() || familia.nome_pai,
```

Em cada chamador encontrado pelo grep, incluir `descricao_fiscal` no `select` da família. Os testes
existentes que montam `FamiliaFiscalPush` ganham `descricao_fiscal: null`.

- [ ] **Step 4: `descricaoFiscal` no cadastro e na edição fiscal**

- Em `_shared/produto/validar.ts`: adicionar `descricaoFiscal?: string | null` ao bloco `fiscal` de
  `ProdutoEntrada`, validar `≤ 120` caracteres depois do `trim` e gravar `descricao_fiscal`
  (`trim() || null`) em `montarLinhasProduto` junto dos outros campos fiscais.
- Espelhar o mesmo tipo em `src/lib/produto-entrada.ts`.
- Em `atualizar-fiscal-familia/processar.ts`: aceitar `descricaoFiscal` com a mesma validação e gravar.
- Teste a acrescentar no arquivo de teste existente de cada um:
  - `montarLinhasProduto` com `fiscal.descricaoFiscal: ' Short masculino '` grava `descricao_fiscal: 'Short masculino'`;
  - com string de 121 caracteres, a validação devolve erro no campo `fiscal.descricaoFiscal`.

- [ ] **Step 5: UI dos campos**

- `etapa-fiscal-form.tsx`: novo `Input` "Descrição na nota fiscal" com `maxLength={120}`, antes do NCM, com
  a ajuda "É o texto que sai na nota de venda do Mercado Livre. Vazio = usa o nome do produto." Ele entra
  no payload como `fiscal.descricaoFiscal`.
- `dialog-fiscal-produto.tsx`: o mesmo campo, pré-preenchido com `familia.descricao_fiscal`.
- `secao-fiscal.tsx`:
  - `Select` "CSOSN padrão de revenda" com as opções `101, 102, 103, 201, 202, 203, 300, 400, 500, 900`
    e "Não definido";
  - ajuda: "Combine com seu contador. É sugerido no cadastro de produto e sempre pede confirmação.";
  - grava `csosn_padrao_revenda` pelo mesmo caminho de salvar `empresa_fiscal` que a seção já usa.
- Em `etapa-fiscal-form.tsx`, quando `tributacaoIcms` estiver vazio e `empresaFiscal.csosn_padrao_revenda`
  existir, mostrar um botão "Usar padrão da empresa (102)". Ele **não** preenche sozinho
  (ADR-0181 D-10: nunca em silêncio).

- [ ] **Step 6: Rodar testes e build**

Run: `pnpm test -- supabase/functions/_shared supabase/functions/atualizar-fiscal-familia src/components/estoque && pnpm preflight:static`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A supabase/functions src/components src/lib
git commit -m "feat(adr-0181): descrição fiscal no Faturador ML e CSOSN padrão de revenda"
```

---

### Task 8: Camada de dados do front (`src/lib/notas-compra.ts`) + estado do assistente

**Files:**
- Create: `src/lib/notas-compra.ts`
- Create: `src/components/estoque/importar-nota/estado.ts`
- Test: `src/components/estoque/importar-nota/__tests__/estado.test.ts`
- Modify: `src/lib/queries.ts` (chaves `QK.notasCompra`, `QK.vinculosFornecedor(cnpj)`)

**Interfaces:**
- Consumes: `lerNfe` (Task 4), regras (Task 3), `erroDaEdge` (`src/lib/edge-erro.ts`).
- Produces:

```ts
// src/lib/notas-compra.ts
export interface Vinculo { cprod: string; codigoPai: string; fator: number }
export interface NotaCompraResumo {
  id: string; chave: string; numero: number; emitenteNome: string; emitidaEm: string;
  valorTotal: number; status: 'importada' | 'desfeita' | 'cancelada'; assinada: boolean; xmlPath: string;
}
export async function buscarVinculos(cnpjFornecedor: string): Promise<Vinculo[]>;
export async function listarNotasCompra(): Promise<NotaCompraResumo[]>;
export async function importarNotaCompra(b: { xml: string; nota: NotaCompraLida; itens: ItemImportacao[] }): Promise<{ notaId: string; duplicada: boolean; pushOk: boolean }>;
export async function desfazerNotaCompra(notaId: string, status: 'desfeita' | 'cancelada'): Promise<{ pushOk: boolean }>;
export async function urlXmlNota(xmlPath: string): Promise<string>; // signedUrl('notas-compra', path, 60)

// estado.ts
export interface DecisaoItem {
  nItem: number; codigoPai: string | null; fator: number; origemVinculo: 'vinculo' | 'gtin' | 'manual' | null;
  distribuicao: LinhaDistribuicao[];
}
export interface EstadoImportacao { nota: NotaCompraLida; xml: string; decisoes: DecisaoItem[] }
export function estadoInicial(nota: NotaCompraLida, xml: string, vinculos: Vinculo[], skuPorGtin: Record<string, string>): EstadoImportacao;
export function definirProduto(e: EstadoImportacao, nItem: number, codigoPai: string): EstadoImportacao;
export function definirFator(e: EstadoImportacao, nItem: number, fator: number): EstadoImportacao;
export function definirDistribuicao(e: EstadoImportacao, nItem: number, linhas: LinhaDistribuicao[]): EstadoImportacao;
export function pendencias(e: EstadoImportacao): Array<{ nItem: number; erro: string }>;
export function payload(e: EstadoImportacao): { xml: string; nota: NotaCompraLida; itens: ItemImportacao[] };
```

`skuPorGtin` mapeia GTIN para `codigo_pai`. Ele é montado a partir de `skus_estoque_org()` (RPC existente).
Conferir as colunas que ela retorna; se `gtin` não vier, a casa por GTIN fica desligada e o teste da
regra continua valendo.

- [ ] **Step 1: Testes do estado que falham**

```ts
import { describe, it, expect } from 'vitest';
import { estadoInicial, definirProduto, definirFator, definirDistribuicao, pendencias, payload } from '../estado';
import type { NotaCompraLida } from '../../../../../supabase/functions/_shared/nfe/tipos';

const nota: NotaCompraLida = {
  chave: '26261011222333000181550010000010511000030324', numero: 1, serie: 1, modelo: 55, tipoNf: 1,
  emitidaEm: '2026-10-13T00:00:00-03:00', emitenteCnpj: '11222333000181', emitenteNome: 'F',
  destinatarioCnpj: '11444777000161', valorTotal: 0, assinada: false, cStat: 100,
  itens: [
    { nItem: 1, cProd: 'REF 06', xProd: 'Short', ncm: null, cfop: '5102', gtin: null, uCom: 'PC', qCom: 35,
      vProd: 350, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, orig: 0 },
    { nItem: 2, cProd: 'X9', xProd: 'Meia', ncm: null, cfop: '5102', gtin: '7891234567895', uCom: 'CX', qCom: 2,
      vProd: 240, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, orig: 0 },
  ],
};

describe('estado da importação', () => {
  it('vínculo salvo pré-seleciona produto e fator; GTIN casa quando não há vínculo', () => {
    const e = estadoInicial(nota, '<x/>', [{ cprod: 'REF 06', codigoPai: 'P1', fator: 1 }], { '7891234567895': 'P2' });
    expect(e.decisoes[0]).toMatchObject({ codigoPai: 'P1', fator: 1, origemVinculo: 'vinculo' });
    expect(e.decisoes[1]).toMatchObject({ codigoPai: 'P2', fator: 1, origemVinculo: 'gtin' });
  });
  it('sem vínculo nem GTIN: item fica pendente de produto', () => {
    const e = estadoInicial(nota, '<x/>', [], {});
    expect(pendencias(e).map((p) => p.nItem)).toEqual([1, 2]);
  });
  it('pendência de distribuição usa a quantidade convertida pelo fator', () => {
    let e = estadoInicial(nota, '<x/>', [], {});
    e = definirProduto(e, 2, 'P2');
    e = definirFator(e, 2, 12);
    e = definirDistribuicao(e, 2, [{ codigo: 'S1', quantidade: 20, custoPrecificacao: 10 }]);
    expect(pendencias(e).find((p) => p.nItem === 2)?.erro).toMatch(/20 de 24/);
  });
  it('trocar o produto zera a distribuição (SKUs eram do produto anterior)', () => {
    let e = estadoInicial(nota, '<x/>', [], {});
    e = definirProduto(e, 1, 'P1');
    e = definirDistribuicao(e, 1, [{ codigo: 'S1', quantidade: 35, custoPrecificacao: 10 }]);
    e = definirProduto(e, 1, 'P9');
    expect(e.decisoes[0].distribuicao).toEqual([]);
  });
  it('payload só sai sem pendências e no formato da edge', () => {
    let e = estadoInicial(nota, '<x/>', [], {});
    expect(() => payload(e)).toThrow(/pendên/);
    e = definirProduto(e, 1, 'P1');
    e = definirDistribuicao(e, 1, [{ codigo: 'S1', quantidade: 35, custoPrecificacao: 10 }]);
    e = definirProduto(e, 2, 'P2'); e = definirFator(e, 2, 12);
    e = definirDistribuicao(e, 2, [{ codigo: 'S2', quantidade: 24, custoPrecificacao: 10 }]);
    expect(payload(e).itens).toEqual([
      { nItem: 1, codigoPai: 'P1', fator: 1, distribuicao: [{ codigo: 'S1', quantidade: 35, custoPrecificacao: 10 }] },
      { nItem: 2, codigoPai: 'P2', fator: 12, distribuicao: [{ codigo: 'S2', quantidade: 24, custoPrecificacao: 10 }] },
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- src/components/estoque/importar-nota`
Expected: FAIL.

- [ ] **Step 3: Implementar `estado.ts`**

```ts
// ADR-0181 — estado puro do assistente de importação (sem React; testado direto).
import { quantidadeEmEstoque, erroDistribuicao } from '../../../../supabase/functions/_shared/nfe/regras';
import type { LinhaDistribuicao, NotaCompraLida, ItemImportacao } from '../../../../supabase/functions/_shared/nfe/tipos';
import type { Vinculo } from '@/lib/notas-compra';

export interface DecisaoItem {
  nItem: number; codigoPai: string | null; fator: number;
  origemVinculo: 'vinculo' | 'gtin' | 'manual' | null; distribuicao: LinhaDistribuicao[];
}
export interface EstadoImportacao { nota: NotaCompraLida; xml: string; decisoes: DecisaoItem[] }

export function estadoInicial(
  nota: NotaCompraLida, xml: string, vinculos: Vinculo[], skuPorGtin: Record<string, string>,
): EstadoImportacao {
  const porCprod = new Map(vinculos.map((v) => [v.cprod, v]));
  return {
    nota, xml,
    decisoes: nota.itens.map((i) => {
      const v = porCprod.get(i.cProd);
      if (v) return { nItem: i.nItem, codigoPai: v.codigoPai, fator: v.fator, origemVinculo: 'vinculo', distribuicao: [] };
      const g = i.gtin ? skuPorGtin[i.gtin] : undefined;
      if (g) return { nItem: i.nItem, codigoPai: g, fator: 1, origemVinculo: 'gtin', distribuicao: [] };
      return { nItem: i.nItem, codigoPai: null, fator: 1, origemVinculo: null, distribuicao: [] };
    }),
  };
}

const mudar = (e: EstadoImportacao, nItem: number, f: (d: DecisaoItem) => DecisaoItem): EstadoImportacao =>
  ({ ...e, decisoes: e.decisoes.map((d) => (d.nItem === nItem ? f(d) : d)) });

export const definirProduto = (e: EstadoImportacao, nItem: number, codigoPai: string) =>
  mudar(e, nItem, (d) => (d.codigoPai === codigoPai ? d
    : { ...d, codigoPai, origemVinculo: 'manual', distribuicao: [] }));
export const definirFator = (e: EstadoImportacao, nItem: number, fator: number) =>
  mudar(e, nItem, (d) => ({ ...d, fator }));
export const definirDistribuicao = (e: EstadoImportacao, nItem: number, linhas: LinhaDistribuicao[]) =>
  mudar(e, nItem, (d) => ({ ...d, distribuicao: linhas }));

export function pendencias(e: EstadoImportacao): Array<{ nItem: number; erro: string }> {
  const out: Array<{ nItem: number; erro: string }> = [];
  for (const d of e.decisoes) {
    const item = e.nota.itens.find((i) => i.nItem === d.nItem)!;
    if (!d.codigoPai) { out.push({ nItem: d.nItem, erro: 'Escolha ou cadastre o produto.' }); continue; }
    const q = quantidadeEmEstoque(item.qCom, d.fator);
    if (!q.ok) { out.push({ nItem: d.nItem, erro: q.erro }); continue; }
    const err = erroDistribuicao(q.quantidade, d.distribuicao);
    if (err) out.push({ nItem: d.nItem, erro: err });
  }
  return out;
}

export function payload(e: EstadoImportacao): { xml: string; nota: NotaCompraLida; itens: ItemImportacao[] } {
  if (pendencias(e).length > 0) throw new Error('Há pendências na importação.');
  return {
    xml: e.xml, nota: e.nota,
    itens: e.decisoes.map((d) => ({ nItem: d.nItem, codigoPai: d.codigoPai!, fator: d.fator, distribuicao: d.distribuicao })),
  };
}
```

- [ ] **Step 4: Implementar `src/lib/notas-compra.ts`**

```ts
// ADR-0181 — acesso a dados da nota de compra no front. Leitura por RLS (org); escrita só pelas edges.
import { supabase } from '@/lib/supabase';
import { erroDaEdge } from '@/lib/edge-erro';
import { signedUrl } from '@/lib/storage';
import type { ItemImportacao, NotaCompraLida } from '../../supabase/functions/_shared/nfe/tipos';

export interface Vinculo { cprod: string; codigoPai: string; fator: number }
export interface NotaCompraResumo {
  id: string; chave: string; numero: number; emitenteNome: string; emitidaEm: string;
  valorTotal: number; status: 'importada' | 'desfeita' | 'cancelada'; assinada: boolean; xmlPath: string;
}

export async function buscarVinculos(cnpjFornecedor: string): Promise<Vinculo[]> {
  const { data, error } = await supabase.from('vinculos_fornecedor')
    .select('cprod, codigo_pai, fator_conversao').eq('cnpj_fornecedor', cnpjFornecedor);
  if (error) throw error;
  return (data ?? []).map((v) => ({ cprod: v.cprod, codigoPai: v.codigo_pai, fator: v.fator_conversao }));
}

export async function listarNotasCompra(): Promise<NotaCompraResumo[]> {
  const { data, error } = await supabase.from('notas_compra')
    .select('id, chave, numero, emitente_nome, emitida_em, valor_total, status, assinada, xml_path')
    .order('emitida_em', { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []).map((n) => ({
    id: n.id, chave: n.chave, numero: n.numero, emitenteNome: n.emitente_nome, emitidaEm: n.emitida_em,
    valorTotal: Number(n.valor_total), status: n.status as NotaCompraResumo['status'],
    assinada: n.assinada, xmlPath: n.xml_path,
  }));
}

export async function importarNotaCompra(b: { xml: string; nota: NotaCompraLida; itens: ItemImportacao[] }) {
  const { data, error } = await supabase.functions.invoke('importar-nota-compra', { body: b });
  if (error) throw await erroDaEdge(error);
  return data as { notaId: string; duplicada: boolean; pushOk: boolean };
}

export async function desfazerNotaCompra(notaId: string, status: 'desfeita' | 'cancelada') {
  const { data, error } = await supabase.functions.invoke('desfazer-nota-compra', { body: { notaId, status } });
  if (error) throw await erroDaEdge(error);
  return data as { pushOk: boolean };
}

export const urlXmlNota = (xmlPath: string) => signedUrl('notas-compra', xmlPath, 60);
```

Conferir o caminho real do client (`@/lib/supabase`) e a assinatura de `signedUrl` em `src/lib/storage.ts`.
Usar exatamente os de `src/lib/produtos-saldo.ts`.

- [ ] **Step 5: Rodar testes**

Run: `pnpm test -- src/components/estoque/importar-nota && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notas-compra.ts src/lib/queries.ts src/components/estoque/importar-nota
git commit -m "feat(adr-0181): estado do assistente de importação e camada de dados"
```

---

### Task 9: Assistente "Importar nota de compra" (UI)

**Files:**
- Create: `src/components/estoque/importar-nota/dialog-importar-nota.tsx`, `etapa-arquivo.tsx`, `etapa-itens.tsx`, `etapa-distribuicao.tsx`, `etapa-resumo.tsx`
- Modify: `src/pages/Estoque.tsx` (botão no cabeçalho, ao lado de "Entrada de mercadoria")
- Test: `src/components/estoque/importar-nota/__tests__/dialog-importar-nota.test.tsx`

**Interfaces:**
- Consumes: Tasks 4 e 8; RPC existente `variacoes_estoque_produto(p_codigo_pai)` para listar os SKUs (cor × tamanho e saldo) do produto escolhido; `produtos_estoque_resumo()` (já usado na página) para o seletor de produto.
- Produces: `export function DialogImportarNota({ aberto, onFechar }: { aberto: boolean; onFechar: () => void })`

Comportamento (cada etapa num componente; o diálogo guarda `EstadoImportacao` com `useState` e usa as
funções puras da Task 8):

1. **Arquivo:**
   - `react-dropzone` aceitando `.xml` (`accept: { 'application/xml': ['.xml'], 'text/xml': ['.xml'] }`), um arquivo, ≤ 1 MB.
   - `file.text()` → `lerNfe`. Erro de leitura vira mensagem na própria etapa.
   - Sucesso → `buscarVinculos(nota.emitenteCnpj)` → `estadoInicial`.
   - Mostra fornecedor, número/série, emissão, total e nº de itens. Se `!assinada`: aviso amarelo "Cópia sem
     assinatura digital — confira com o XML original quando possível".
   - Recusas imediatas (sem avançar):
     - destinatário ≠ CNPJ da empresa (de `useEmpresaFiscal()`);
     - algum CFOP fora de `CFOPS_ACEITOS`;
     - nota já importada: consultar `notas_compra` por `chave`. Se `importada`: "Esta nota já foi importada
       em DD/MM" com botão "Ver nota". Se `desfeita`/`cancelada`: recusa com o status.
2. **Itens:** uma linha por item, com descrição do fornecedor, `qCom uCom`, custo de aquisição unitário
   (`custoAquisicaoUnit`, formatado com `fmtBRL`) e o selo de origem do vínculo ("Vinculado" / "Casou
   pelo GTIN" / "Escolha o produto"). Em cada linha:
   - seletor de produto (busca por nome/código em `produtos_estoque_resumo`) → `definirProduto`;
   - botão "Cadastrar produto novo" (Task 10);
   - campo "Unidades por {uCom}", visível quando `uCom` ≠ unidade do produto ou quando o vínculo já tem
     fator > 1 → `definirFator`.
3. **Distribuição:**
   - Por item com produto: tabela dos SKUs do produto (`variacoes_estoque_produto`) com cor, tamanho, saldo
     atual, quantidade (input inteiro) e custo de precificação (input, default = custo de aquisição
     arredondado a 2 casas, editável) → `definirDistribuicao`.
   - Contador "X de Y unidades" verde quando fecha.
   - Produto com 1 SKU: quantidade preenchida com o total e só leitura.
   - Botão "Repetir custo em todos".
   - Link "Falta um tamanho/cor?" (Task 11).
4. **Resumo:**
   - Lista `pendencias(e)`. Com pendência, "Confirmar entrada" fica desabilitado e cada pendência leva à
     etapa e ao item certos.
   - Sem pendência: total de unidades por produto e nota de rodapé "A entrada é registrada de uma vez. A
     nota fica guardada e pode ser desfeita por um administrador enquanto houver saldo".
   - Confirmar → `useMutation(importarNotaCompra(payload(e)))`:
     - sucesso: `toast.success` ("Nota 1051 importada · 70 unidades"); se `duplicada`, "Esta nota já tinha
       sido importada — nada foi somado"; invalida `QK.produtosEstoqueResumo` e `QK.notasCompra`; fecha.
     - erro: `toast.error` com a mensagem da edge; mantém o diálogo aberto.

Botão em `Estoque.tsx`: `Importar nota de compra`. Visível com `modulos.includes('estoque')` e
`empresaFiscal?.cnpj`. Sem CNPJ, aparece desabilitado com tooltip "Cadastre o CNPJ em Configurações › Fiscal".

- [ ] **Step 1: Teste de integração do diálogo que falha**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DialogImportarNota } from '../dialog-importar-nota';

vi.mock('@/lib/notas-compra', () => ({
  buscarVinculos: vi.fn(async () => []),
  importarNotaCompra: vi.fn(),
  listarNotasCompra: vi.fn(async () => []),
}));
vi.mock('@/hooks/useConfiguracoes', () => ({
  useEmpresaFiscal: () => ({ data: { cnpj: '99999999000191' } }),
}));

const xml = readFileSync(join(__dirname, '../../../../lib/nfe/__tests__/fixtures/nfe-exportacao-erp.xml'), 'utf8');

describe('DialogImportarNota', () => {
  it('recusa nota cujo destinatário não é a empresa, sem avançar de etapa', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DialogImportarNota aberto onFechar={() => {}} />
      </QueryClientProvider>,
    );
    const input = screen.getByTestId('nfe-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([xml], 'n.xml', { type: 'application/xml' })] } });
    await waitFor(() => expect(screen.getByText(/destinatário da nota não é o CNPJ/i)).toBeInTheDocument());
    expect(screen.queryByText(/Escolha o produto/i)).not.toBeInTheDocument();
  });
});
```

Conferir se `@testing-library/react` já está no `package.json`. Se não estiver, **não** adicionar
dependência: trocar este teste pelo teste da função `recusaInicial(nota, cnpjEmpresa, chavesExistentes)`
extraída para `estado.ts`, com os mesmos casos (destinatário, CFOP, nota já importada).

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- src/components/estoque/importar-nota`
Expected: FAIL.

- [ ] **Step 3: Implementar as etapas e o diálogo conforme o comportamento acima**

Usar `Dialog`, `Button`, `Input`, `Table`, `Badge`, `Select` e `Progress` de `src/components/ui`, seguindo o
padrão visual de `dialog-entrada.tsx` (largura `sm:max-w-5xl`, rodapé com Voltar/Avançar). O input do
dropzone recebe `data-testid="nfe-input"`.

- [ ] **Step 4: Rodar testes e build**

Run: `pnpm test -- src/components/estoque && pnpm preflight:static`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/estoque/importar-nota src/pages/Estoque.tsx
git commit -m "feat(adr-0181): assistente Importar nota de compra em /estoque"
```

---

### Task 10: "Cadastrar produto novo" a partir do item da nota

**Files:**
- Modify: `src/components/estoque/dialog-cadastro-produto.tsx` (`CadastroInicial` em `:43`; `onCadastrado` passa a receber `{ codigoPai: string }`)
- Modify: `supabase/functions/cadastrar-produto/index.ts:341` (resposta inclui `codigoPai: gerados.codigoPai`)
- Modify: `src/lib/produtos-saldo.ts` (tipo de retorno de `cadastrarProduto` com `codigoPai`)
- Modify: `src/components/estoque/etapa-fiscal-form.tsx` (selo "veio da nota do fornecedor — confirme")
- Modify: `src/components/estoque/importar-nota/etapa-itens.tsx`
- Create: `src/components/estoque/importar-nota/prefill-cadastro.ts` + `__tests__/prefill-cadastro.test.ts`

**Interfaces:**
- Consumes: `limparDescricaoFornecedor` (Task 3), `descricaoFiscal` (Task 7).
- Produces: `export function prefillCadastro(item: ItemNotaLido, nota: NotaCompraLida, fator: number): CadastroInicial`

Regras do pré-preenchimento (D-5, D-6, D-10):
- `nomePai` = `limparDescricaoFornecedor(xProd)`;
- `descricaoFiscal` = `limparDescricaoFornecedor(xProd)`;
- `unidade` = `'UN'`;
- `fornecedor` = `nota.emitenteNome`;
- variações: nenhuma pré-criada. O operador monta a grade no próprio diálogo; a quantidade vem depois, na
  distribuição. `estoqueInicial` **não** é enviado (D-4: saldo só pela nota);
- custo da variação = `custoAquisicaoUnit(item, fator)` arredondado a 2 casas;
- fiscal **sugerido, nunca confirmado**: `ncm` = `item.ncm`; `origemNfe` = `item.orig`; `origem` = `'importado'`
  se `orig ∈ {1,2,3,6,7,8}`, senão `'nacional'`; `sugestaoDaNota: true`. `tributacaoIcms` fica **vazio** (o
  CSOSN do fornecedor nunca é copiado).

- [ ] **Step 1: Teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { prefillCadastro } from '../prefill-cadastro';

const item = { nItem: 1, cProd: 'REF 06', xProd: 'Short masculino - DIV - DIV', ncm: '62034900', cfop: '5102',
  gtin: null, uCom: 'PC', qCom: 35, vProd: 350, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, orig: 0 };
const nota = { emitenteNome: 'FORNECEDOR TESTE LTDA' } as never;

describe('prefillCadastro', () => {
  it('limpa a descrição, sugere fiscal sem CSOSN e não envia estoque inicial', () => {
    const p = prefillCadastro(item, nota, 1);
    expect(p).toMatchObject({
      nomePai: 'Short masculino', descricaoFiscal: 'Short masculino', fornecedor: 'FORNECEDOR TESTE LTDA',
      custo: 10, fiscal: { ncm: '62034900', origemNfe: 0, origem: 'nacional', sugestaoDaNota: true },
    });
    expect(p.fiscal?.tributacaoIcms ?? '').toBe('');
    expect(JSON.stringify(p)).not.toContain('estoqueInicial');
  });
  it('origem 2 (estrangeira adquirida no mercado interno) sugere importado', () => {
    expect(prefillCadastro({ ...item, orig: 2 }, nota, 1).fiscal?.origem).toBe('importado');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- src/components/estoque/importar-nota/__tests__/prefill-cadastro`
Expected: FAIL.

- [ ] **Step 3: Implementar**

- Estender `CadastroInicial` com `descricaoFiscal?`, `custo?` e `fiscal?: { ncm?; origemNfe?; origem?; sugestaoDaNota?: boolean; tributacaoIcms?: string }`.
  O efeito de abertura do diálogo já aplica o `inicial`; acrescentar esses campos lá.
- `prefill-cadastro.ts` implementa as regras acima.
- Com `sugestaoDaNota`, `etapa-fiscal-form.tsx` mostra ao lado de NCM e Origem o selo "Veio da nota do
  fornecedor" e um checkbox obrigatório "Conferi NCM e origem". Sem ele marcado, "Salvar" fica desabilitado
  na etapa fiscal (D-10: confirmação ativa). Reusar o padrão visual da sugestão de NCM por IA que já existe
  no mesmo formulário.
- `cadastrar-produto/index.ts`: incluir `codigoPai: gerados.codigoPai` no `json({...})` final e espelhar no tipo
  do front.
- `etapa-itens.tsx`: "Cadastrar produto novo" abre `DialogCadastroProduto` com `inicial = prefillCadastro(...)`
  guardado em `useState` no clique (snapshot estável, conforme o comentário em `:56`). O `onCadastrado({ codigoPai })`
  chama `definirProduto(e, nItem, codigoPai)` e invalida o resumo de produtos.

- [ ] **Step 4: Rodar testes e build**

Run: `pnpm test -- src/components/estoque supabase/functions/cadastrar-produto && pnpm preflight:static`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/estoque src/lib/produtos-saldo.ts supabase/functions/cadastrar-produto
git commit -m "feat(adr-0181): cadastrar produto novo a partir do item da nota (fiscal sugerido, confirmação ativa)"
```

---

### Task 11: Variação nova local, não publicada (D-8)

**Files:**
- Modify: `supabase/functions/sincronizar-estoque/processar.ts:158-175` (`lerFamiliaComSaldo` ignora `excluida_da_publicacao = true`)
- Test: `supabase/functions/sincronizar-estoque/__tests__/processar.test.ts`
- Create: `supabase/migrations/<ts>_adr181_variacao_local.sql` (RPC `criar_variacao_local`)
- Test: `supabase/tests/variacao_local.sql`
- Modify: `supabase/functions/importar-nota-compra/index.ts` → **não**. Criar edge `criar-variacao-local` (`index.ts` + `validar.ts` + teste), `verify_jwt = true`, gate estoque.
- Modify: `src/components/estoque/importar-nota/etapa-distribuicao.tsx` (link "Falta um tamanho/cor?")

**Interfaces:**
- Produces:
  - `public.criar_variacao_local(p_org uuid, p_codigo_pai text, p_cor text, p_tamanho text, p_preco numeric, p_custo numeric) returns text` (código do SKU novo).
  - Edge `POST criar-variacao-local` `{ codigoPai, cor, tamanho, preco, custo }` → `{ codigo }`.

**Por que mexer no push:** `lerFamiliaComSaldo` lê **todas** as variações da família. Quando o anúncio não
tem mapa de SKUs (`variacoes_externas` vazio), `resolverAlvosPush` usa todos os SKUs
(`_shared/estoque/alvos.ts:58`). Em anúncio plano, 2 SKUs viram erro definitivo `ESTOQUE`. Variação não
publicada não tem o que empurrar.

- [ ] **Step 1: Teste de caracterização que falha no push**

Em `sincronizar-estoque/__tests__/processar.test.ts`, seguir o mock de `admin.from('variacoes')` já usado
no arquivo. Família com 2 variações, `S1` (`excluida_da_publicacao: false`, estoque 5) e `S2`
(`excluida_da_publicacao: true`, estoque 3), anúncio plano sem `variacoes_externas`. Esperado:
- o push sai com `estoques = [{ sku: 'S1', quantidade: 5 }]`;
- nenhum erro `ESTOQUE`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- supabase/functions/sincronizar-estoque`
Expected: FAIL (2 estoques no alvo).

- [ ] **Step 3: Corrigir `lerFamiliaComSaldo`**

```ts
  const { data: variacoes } = await admin.from('variacoes')
    .select('codigo, estoque, nome, cor').eq('familia_id', familia.id)
    // ADR-0181 D-8: variação marcada como não publicada (ex.: criada na importação de nota) não
    // existe no anúncio — empurrá-la quebraria o anúncio plano (`resolverAlvosPush` sem mapa).
    .eq('excluida_da_publicacao', false);
```

Rodar a suíte inteira de `sincronizar-estoque` e de `_shared/estoque`. Se algum teste existente depender
de variação excluída ser empurrada, **parar e reportar**, sem ajustar o teste.

- [ ] **Step 4: Teste SQL da RPC que falha**

`supabase/tests/variacao_local.sql`: mesmo preâmbulo de `nota_compra.sql` (prefixo `94…`), família
`09400000` com variação `09400001` (P). Como `service_role`, chamar
`criar_variacao_local(org, '09400000', null, 'M', 49.9, 10)` e verificar:
- devolve um código de 8 dígitos;
- a variação nasceu na família **mais recente** do PAI com `tamanho = 'M'`, `estoque = 0` e
  `excluida_da_publicacao = true`;
- repetir com o mesmo tamanho falha com `23505` (combinação já existe).

Termina com `TESTE_OK`.

- [ ] **Step 5: Migration da RPC**

```sql
-- ADR-0181 D-8: variação criada só no PubliAI, fora da publicação. Vai ao marketplace depois
-- pelo fluxo normal (Revisão/UPDATE). Nunca publica daqui.
create or replace function public.criar_variacao_local(
  p_org uuid, p_codigo_pai text, p_cor text, p_tamanho text, p_preco numeric, p_custo numeric
) returns text language plpgsql security invoker set search_path = ''
as $$
declare v_fam uuid; v_user uuid; v_ult bigint; v_codigo text;
begin
  select f.id, f.user_id into v_fam, v_user from public.familias f
   where f.org_id = p_org and f.codigo_pai = p_codigo_pai order by f.criado_em desc limit 1;
  if v_fam is null then raise exception 'criar_variacao_local: produto % não encontrado', p_codigo_pai using errcode = 'P0002'; end if;
  if exists (select 1 from public.variacoes v where v.familia_id = v_fam
              and coalesce(v.cor, '') = coalesce(p_cor, '') and coalesce(v.tamanho, '') = coalesce(p_tamanho, '')) then
    raise exception 'criar_variacao_local: % / % já existe neste produto', p_cor, p_tamanho using errcode = '23505';
  end if;
  v_ult := public.proximo_codigo_produto(p_org, 1);
  v_codigo := lpad(v_ult::text, 8, '0');
  insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, cor_origem, tamanho,
    preco, custo, estoque, excluida_da_publicacao)
  values (v_fam, v_user, p_org, v_codigo, p_cor, p_cor, case when p_cor is null then null else 'manual' end,
    p_tamanho, p_preco, p_custo, 0, true);
  return v_codigo;
end $$;
revoke all on function public.criar_variacao_local(uuid, text, text, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.criar_variacao_local(uuid, text, text, text, numeric, numeric) to service_role;
```

Antes de aplicar, conferir em `20260731192443_codigo_produto_automatico.sql:36` a assinatura e o retorno de
`proximo_codigo_produto` e como `derivarCodigos` (`_shared/produto/codigos.ts`) formata o código. Usar a
**mesma** formatação; se o retorno for o último da faixa, não o primeiro, ajustar. Conferir também se o
trigger `bloquear_variacao_extra_com_kit` exige algo. Aplicar com `supabase db push` e rodar o teste SQL.

- [ ] **Step 6: Edge `criar-variacao-local`**

- `validar.ts`:
  - `tamanho` só da whitelist de `_shared/produto/tipos-produto-valores.ts` e só se o tipo estiver em
    `organizations.tipos_produto_habilitados`;
  - `cor` com até 60 caracteres;
  - pelo menos um entre `cor` e `tamanho`;
  - `preco > 0` e `custo > 0`.
- Testes para cada recusa.
- `index.ts`: mesmo esqueleto da Task 5 (gate estoque); chama a RPC e devolve `{ codigo }`.
- Registrar em `config.toml`.

- [ ] **Step 7: UI**

Em `etapa-distribuicao.tsx`, o link "Falta um tamanho/cor?" abre um popover com cor, tamanho (select da
whitelist), preço e custo. Esse custo vem preenchido com o custo de precificação do item. O popover chama
a edge, recarrega os SKUs do produto e mostra a linha nova com o selo "Não publicada — vai ao anúncio
pela Revisão".

- [ ] **Step 8: Rodar tudo e commit**

Run: `pnpm test -- supabase/functions src/components/estoque && pnpm preflight:static && python3 scripts/teste-sql-desfeito.py supabase/tests/variacao_local.sql`
Expected: PASS / `TESTE_OK`.

```bash
git add -A supabase src/components/estoque
git commit -m "feat(adr-0181): variação nova local não publicada + push ignora variação excluída"
```

---

### Task 12: Lista "Notas de compra" em `/estoque` (ver XML, desfazer, cancelar)

**Files:**
- Create: `src/components/estoque/importar-nota/secao-notas-compra.tsx`
- Modify: `src/pages/Estoque.tsx`
- Test: `src/components/estoque/importar-nota/__tests__/secao-notas-compra.test.ts` (função pura `rotuloStatus` e `podeDesfazer(nota, isAdmin)`)

**Interfaces:**
- Consumes: `listarNotasCompra`, `desfazerNotaCompra`, `urlXmlNota` (Task 8).
- Produces: `export function SecaoNotasCompra()`; `export function podeDesfazer(n: NotaCompraResumo, isAdmin: boolean): boolean`.

Comportamento:
- A seção é recolhível ("Notas de compra (N)") abaixo da listagem de produtos.
- Tabela: emissão (dd/mm/aaaa), fornecedor, nº, total (`fmtBRL`), status (`status-pill`: Importada/Desfeita/
  Cancelada), selo "sem assinatura" quando for o caso, e ações:
  - **Baixar XML** → `urlXmlNota` + `window.open`;
  - **Desfazer** e **Marcar como cancelada** (só admin e só `importada`) → `alert-dialog` explicando que o
    saldo será reduzido → `desfazerNotaCompra`.
- Erro de saldo insuficiente aparece em `toast.error` com a mensagem da edge, que lista os SKUs.

- [ ] **Step 1: Teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { podeDesfazer } from '../secao-notas-compra';

const n = (status: 'importada' | 'desfeita' | 'cancelada') => ({ id: '1', chave: 'x', numero: 1, emitenteNome: 'F',
  emitidaEm: '2026-10-13', valorTotal: 1, status, assinada: true, xmlPath: 'o/x.xml' });

describe('podeDesfazer', () => {
  it('só admin e só nota importada', () => {
    expect(podeDesfazer(n('importada'), true)).toBe(true);
    expect(podeDesfazer(n('importada'), false)).toBe(false);
    expect(podeDesfazer(n('desfeita'), true)).toBe(false);
    expect(podeDesfazer(n('cancelada'), true)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- src/components/estoque/importar-nota/__tests__/secao-notas-compra`
Expected: FAIL.

- [ ] **Step 3: Implementar a seção e incluir em `Estoque.tsx`**

`podeDesfazer = (n, isAdmin) => isAdmin && n.status === 'importada'`. A query `useQuery({ queryKey: QK.notasCompra, queryFn: listarNotasCompra })`
fica habilitada só quando o módulo estoque está ligado.

- [ ] **Step 4: Rodar testes e build**

Run: `pnpm test -- src/components/estoque && pnpm preflight:static`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/estoque/importar-nota src/pages/Estoque.tsx
git commit -m "feat(adr-0181): lista de notas de compra com XML, desfazer e cancelar"
```

---

### Task 13: Docs, deploy e validação em runtime

**Files:**
- Modify: `docs/reference/edge-functions.md` (tabela-resumo + seção `### Estoque`: `importar-nota-compra`, `desfazer-nota-compra`, `criar-variacao-local`; tabela `_shared/` com `_shared/nfe/*`; contador "As N Edge Functions")
- Modify: `docs/reference/modelo-de-dados.md` (seção nova "Nota de compra (ADR-0181)": 4 tabelas, colunas novas, bucket, RPCs na tabela de funções SQL)
- Modify: `docs/decisions/0181-…md` (Status → "aceito — em implementação (Plano 1)"; "A verificar #3" marcado como resolvido pela Task 11)
- Modify: `docs/TASKS.md`, `docs/project-status.md`, `obsidian-vault/03-Módulos/Fiscal.md` (seguir a skill `docs-update-checklist`)

- [ ] **Step 1: Atualizar docs** conforme a skill `docs-update-checklist`.

- [ ] **Step 2: Rodar o portão completo**

Run: `pnpm preflight`
Expected: tudo verde.

- [ ] **Step 3: Deploy das edges afetadas**

Calcular o blast radius de `_shared/canais/fiscal-ml.ts` e `_shared/produto/validar.ts`:

```bash
grep -rln "canais/fiscal-ml\|produto/validar" supabase/functions --include=*.ts | grep -v __tests__ | cut -d/ -f3 | sort -u
```

Deploy de cada função listada, mais `importar-nota-compra`, `desfazer-nota-compra`, `criar-variacao-local`,
`sincronizar-estoque` e `cadastrar-produto`:

```bash
supabase functions deploy importar-nota-compra desfazer-nota-compra criar-variacao-local sincronizar-estoque cadastrar-produto <demais da lista>
supabase functions list
```
Expected: cada uma `ACTIVE` com versão incrementada. Conferir `verify_jwt` preservado.

- [ ] **Step 4: Validação em runtime real (org Zaven, sem ML conectado)**

Em sessão Playwright isolada (skill `playwright-cli`, sem disputar o Chrome do Diego), com screenshot de
cada passo, no app em produção (`/#/estoque`), conta de teste na org Zaven:
1. Importar a fixture `nfe-sefaz.xml` adaptada com o destinatário `69541033000145`. Gerar a chave com DV
   válido pelo script de geração da fixture; **não** commitar.
2. Cadastrar produto novo pelo item e conferir o selo "veio da nota" e o checkbox obrigatório.
3. Distribuir 24 unidades com fator 12. Confirmar.
4. Conferir o saldo no card do produto.
5. Reimportar o mesmo arquivo: a recusa "já importada" aparece.
6. Desfazer como admin: o saldo volta a 0 e o status fica "Desfeita".

Sem conexão ML, o push enfileira e não acha anúncio. Isso é o esperado; conferir no log que não há erro.

- [ ] **Step 5: Commit das docs**

```bash
git add docs obsidian-vault
git commit -m "docs(adr-0181): entrada por nota de compra — referência, modelo de dados e status"
```

---

## Self-Review (feito na escrita)

- **Cobertura do ADR:**
  - D-1 (Tasks 5, 9);
  - D-2 (Tasks 3, 4, 5, 9);
  - D-3 (Tasks 1, 2);
  - D-4 (Task 2; Task 10 sem `estoqueInicial`);
  - D-5 (Tasks 1, 7, 10);
  - D-6 (Tasks 2, 8, 9);
  - D-7 (Tasks 3, 8, 9; push multiproduto na Task 2);
  - D-8 (Task 11);
  - D-9 parcial: aquisição e precificação nas Tasks 2, 5 e 9; CT-e no Plano 2;
  - D-10 (Tasks 7, 10);
  - D-11 (Tasks 2, 6, 12).
  - D-12 e D-13 ficam no Plano 2.
- **Pontos que o executor precisa conferir no código** (estão marcados nas tasks e não são placeholders de
  desenho): assinatura de `enfileirarSincronizacaoEstoque` e de `auditarOperacaoSuporte`; caminho do client
  Supabase e de `signedUrl`; retorno de `proximo_codigo_produto`; presença de `@testing-library/react`; colunas
  de `skus_estoque_org()`.
