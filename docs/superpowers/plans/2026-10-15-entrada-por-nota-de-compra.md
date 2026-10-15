# Entrada por Nota de Compra (XML NF-e) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revisão 4** — incorpora a rodada 3 do Codex:
- R3-B1: a RPC recusa entrada com a ref da nota fora da distribuição, e a retomada traz linhas travadas.
- R3-B2: uma variação por chamada no modo nota.
- R3-B3: a mensagem de falha não manda dar entrada manual.
- R3-B4: desfazer não reativa, e o reenvio reativa só com a nota importada.
- R3-I1 a R3-I4: ref no retry; aceite ativo da divergência de `vNF`; PIs e `protNFe` vazio; reenvio via RPC com auditoria.
- N-I1: `familias.origem_cadastro`.

**Revisão 3** — incorpora a rodada 2 do Codex `gpt-6.1-sol` (5 bloqueadores novos: leitor endurecido,
rateio por maiores restos com sinais validados, XML endereçado por hash, D-8 com referência da nota,
`codigoPai` no contrato tipado) e as decisões do Diego de 2026-10-15 (D-8 com referência da nota; XML de
exportação do ERP como base dos testes; Zaven sendo conectada ao ML).

**Revisão 2** — incorporou a rodada 1 do Codex (12 bloqueadores, 5 importantes, 3 menores). Mudanças centrais:
- o servidor lê o próprio XML, e o navegador só manda **decisões**;
- o arquivo da nota é imutável e a importação concorrente é serializada;
- o desfazer trava os SKUs antes de ler o saldo e é idempotente;
- há conciliação de totais e rateio;
- a distribuição pode ir para vários produtos;
- a variação nova entra pelo fluxo existente com a referência da nota (D-8 revisada, aprovada pelo Diego).

**Goal:** O operador importa o XML de uma NF-e de compra em `/estoque`. O sistema liga cada item a um
produto (vínculo de fornecedor), distribui a quantidade na grade e dá entrada no estoque numa única
transação, guardando a nota como documento à parte.

**Architecture:**
- **Leitor do XML:** um único módulo puro em `supabase/functions/_shared/nfe/` lê a NF-e por extração textual
  do subconjunto da NF-e, sem `DOMParser` e sem dependência nova. Front e edge usam o mesmo leitor.
- **Front:** lê o XML para montar a tela.
- **Edge `importar-nota-compra`:** relê o XML recebido e deriva dele **todo** o dado documental. Do navegador
  aceita só as decisões do operador: produto vinculado, fator e distribuição.
- **RPC `importar_nota_compra`:** `security invoker`, executada como `service_role`, serializada por
  `pg_advisory_xact_lock` da chave. Grava a nota, os itens, a distribuição e o vínculo, e chama a
  `registrar_entrada`, que já existe, por SKU. Tudo numa transação.
- **XML original:** vai para um bucket privado sem sobrescrita.

**Tech Stack:** React 18 + Vite + TS, React Query, shadcn/ui, `react-dropzone` (já instalado); Supabase
(Postgres + RLS + Storage); Edge Functions Deno; vitest (jsdom, TZ `America/Sao_Paulo`).

**Spec:** `docs/decisions/0181-entrada-por-nota-de-compra-e-pacote-do-contador.md` (D-1…D-11).
Glossário: `docs/reference/glossario.md` (Nota de compra, Item da nota, Vínculo de fornecedor,
Distribuição na grade, Custo de aquisição, Custo de precificação, Descrição fiscal).

**Fora deste plano (Plano 2 — pacote do contador):** D-12 (inventário/custo médio/foto 31/12), D-13
(export mensal, XMLs de venda ao vivo do ML), custos adicionais por CT-e (parte de D-9). Este plano grava
o `custo_aquisicao_unit` por SKU distribuído, que é o insumo do custo médio do Plano 2.

**D-8 revisada (OK do Diego em 2026-10-15; ADR-0181 atualizado):** a variação faltante entra pelo
`dialog-adicionar-variacao-roteador` existente (produto publicado, admin). O estoque inicial é a quantidade
da nota para aquele SKU, e a referência de ledger é a da nota (`nfe:{chave}:{nItem}:{codigo}`). Na
confirmação, `registrar_entrada` reconhece a referência e não soma de novo (Task 11). Produto não publicado:
v1 recusa o item e orienta a cadastrar a grade completa.

## Global Constraints

- Migrations **só** por `supabase migration new <nome>` + `supabase db push`; validar com `npm run db:check`. Nunca MCP/painel para DDL (ADR-0043). O worktree **não herda o link**: rodar `supabase link --project-ref txvncrgkoynoxwopfkbp` antes do `db push`.
- Timestamp de migration nova > `20261005143525`.
- `scripts/teste-sql-desfeito.py` roda **em produção**, numa transação sempre desfeita. As fixtures usam UUIDs com prefixo próprio (`93…`, `94…`) e nunca tocam dado real.
- Toda tabela nova: RLS habilitada, `select` por `org_id = public.current_org_id()`. Escrita **só** por `service_role`.
- Escrita de saldo **só** via `registrar_entrada` / `ajustar_estoque` (trigger `bloquear_escrita_direta_estoque`). Os grants para `service_role` existem (`20260729084329_e6b_estoque_movimentos.sql:362`, `20260811203500_fix_grants_ajustar_estoque.sql:37`).
- Edge JWT: `requireUserOrg` (`_shared/auth.ts`; suporte `full` devolve `isAdmin: false`, `_shared/auth-org.ts:40`), `exigirModulo(admin, orgId, 'estoque')`, `corsHeaders`/`handleOptions`, `auditarOperacaoSuporte`, registro em `supabase/config.toml` com `verify_jwt = true`.
- `processar.ts` / `validar.ts` / `_shared/nfe/*.ts`: **sem** `jsr:`/`npm:`/`Deno`; dependências injetadas. Imports com extensão `.ts` são permitidos no front (`tsconfig.app.json:11`), como faz `src/lib/tamanhos.ts`.
- `pnpm check:functions` usa `git ls-files`: arquivo novo de edge precisa de `git add -N <arquivo>` **antes** do check.
- **Repo é público:** fixtures de XML com CNPJs fictícios válidos (`11222333000181` emitente, `11444777000161` destinatário). **Nunca** commitar o XML real do cliente.
- Regra financeira inviolável: nenhum campo fiscal nem a origem binária (`familias.origem`, imposto 8%/16%) é gravado sem confirmação ativa; CSOSN/CFOP do fornecedor **nunca** são copiados (ADR-0181 D-10).
- A importação **nunca publica** nada no marketplace.
- Mudança em `_shared/` ou numa edge → redeploy de **todas** as afetadas, com conferência da versão (`supabase functions list`).
- Portão de pré-push: `pnpm preflight`.
- UI em português do Brasil.

## Review Focus

1. **A mesma nota importada duas vezes, inclusive ao mesmo tempo** (duplo clique, retry, duas abas): o saldo não pode somar duas vezes e o XML guardado não pode ser trocado. A segunda chamada devolve `duplicada: true` (Task 2: lock + teste SQL; Task 5: verificação antes do upload e `upsert: false`).
2. **Item em caixa** (`uCom = CX`, `qCom = 2`, 12 por caixa): a distribuição tem que exigir 24 unidades (Task 3).
3. **Desfazer com venda acontecendo no meio**: o saldo é relido com os SKUs travados. Com saldo insuficiente, recusa listando os SKUs, sem ajuste pela metade. Repetir o desfazer já concluído é no-op que reenfileira o push (Task 2).
4. **XML de outra empresa, de natureza errada ou com totais incoerentes** (destinatário ≠ CNPJ, CFOP de remessa ou bonificação, `cStat` ≠ 100, DV inválido, soma dos itens ≠ total): recusa antes de gravar, com o motivo, e a decisão é tomada **sobre o XML lido no servidor** (Tasks 3 e 5). Exceção registrada no ADR D-2: divergência apenas entre `vNF` e a composição dos totais exige **aceite ativo**, que fica gravado em `divergencia_total_aceita`.
5. **REF genérica distribuída em SKUs de produtos diferentes**: a UI permite e o push sai para todos os produtos tocados (Task 2: `codigo_pai` lido do ledger; Task 9: SKU de outro produto).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/<ts>_adr181_nota_compra.sql` | Tabelas, colunas novas, bucket, RLS |
| `supabase/migrations/<ts>_adr181_rpc_nota_compra.sql` | RPCs `importar_nota_compra`, `desfazer_nota_compra` |
| `supabase/tests/nota_compra_schema.sql`, `supabase/tests/nota_compra.sql` | Testes SQL (transação desfeita) |
| `supabase/functions/_shared/nfe/tipos.ts` | Tipos |
| `supabase/functions/_shared/nfe/ler-nfe.ts` | XML → `NotaCompraLida` (puro; front e edge) |
| `supabase/functions/_shared/nfe/regras.ts` | DV de chave e GTIN, CFOP, conversão, conciliação + rateio, custo, distribuição, descrição, origem sugerida |
| `supabase/functions/importar-nota-compra/{index,validar,processar}.ts` | Edge de importação |
| `supabase/functions/desfazer-nota-compra/{index,validar,processar}.ts` | Edge de desfazer/cancelar (admin) |
| `supabase/functions/_shared/canais/fiscal-ml.ts` | `title` passa a usar `descricao_fiscal` |
| `src/lib/notas-compra.ts` | Wrappers de edge + leituras |
| `src/components/estoque/importar-nota/*` | Assistente (estado puro + etapas) e lista de notas |
| `src/pages/Estoque.tsx` | Botão "Importar nota de compra" e seção "Notas de compra" |

---

### Task 1: Schema — tabelas da nota, vínculo, colunas novas, bucket

**Files:**
- Create: `supabase/migrations/<ts>_adr181_nota_compra.sql` (via `supabase migration new adr181_nota_compra`)
- Modify: `src/lib/database.types.ts`
- Test: `supabase/tests/nota_compra_schema.sql`

**Interfaces:**
- Produces: tabelas `notas_compra`, `notas_compra_itens`, `notas_compra_distribuicao`, `vinculos_fornecedor`; colunas `familias.descricao_fiscal`, `familias.origem_cadastro`, `empresa_fiscal.csosn_padrao_revenda`, `notas_compra.divergencia_total_aceita`; bucket `notas-compra` (path `{org_id}/{chave}/{sha256}.xml`).

- [ ] **Step 1: Escrever o teste SQL que falha** — estrutura **e** isolamento entre orgs

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
end $$;

-- Isolamento: usuário da org B não enxerga a nota da org A (RLS por current_org_id()).
insert into public.organizations (id, nome, slug) values
  ('93100000-0000-0000-0000-00000000000a', 'NF A', 'nf-a'),
  ('93100000-0000-0000-0000-00000000000b', 'NF B', 'nf-b');
insert into auth.users (id, email) values ('93100000-0000-0000-0000-0000000000b1', 'nfb@test.local');
insert into public.profiles (id, org_id, is_active) values
  ('93100000-0000-0000-0000-0000000000b1', '93100000-0000-0000-0000-00000000000b', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.notas_compra (org_id, chave, numero, serie, emitente_cnpj, emitente_nome, emitida_em,
  valor_total, assinada, xml_path)
values
  ('93100000-0000-0000-0000-00000000000a', '26261011222333000181550010000010511000030324', 1, 1,
   '11222333000181', 'F', now(), 1, false, '93100000-0000-0000-0000-00000000000a/x.xml'),
  ('93100000-0000-0000-0000-00000000000b', '26261011222333000181550010000010511000030324', 1, 1,
   '11222333000181', 'F', now(), 1, false, '93100000-0000-0000-0000-00000000000b/x.xml');
insert into storage.objects (bucket_id, name) values
  ('notas-compra', '93100000-0000-0000-0000-00000000000a/26261011222333000181550010000010511000030324/h.xml'),
  ('notas-compra', '93100000-0000-0000-0000-00000000000b/26261011222333000181550010000010511000030324/h.xml');

-- current_org_id() lê profiles.org_id do auth.uid() ativo (20260725224000_support_access.sql:183),
-- mesmo padrão de supabase/tests/estoque_rpc_tamanho.sql:70.
set local role authenticated;
set local request.jwt.claims = '{"sub":"93100000-0000-0000-0000-0000000000b1","role":"authenticated"}';
do $$
begin
  -- Controle positivo: a identidade resolve para a org B (senão "não vê A" passaria por cegueira total).
  if public.current_org_id() is distinct from '93100000-0000-0000-0000-00000000000b'::uuid then
    raise exception 'current_org_id não resolveu a org B: %', public.current_org_id(); end if;
  if (select count(*) from public.notas_compra) <> 1 then raise exception 'B deveria ver exatamente a própria nota'; end if;
  if exists (select 1 from public.notas_compra where org_id = '93100000-0000-0000-0000-00000000000a') then
    raise exception 'org B enxergou nota da org A'; end if;
  if (select count(*) from storage.objects where bucket_id = 'notas-compra') <> 1 then
    raise exception 'B deveria ver só o próprio XML no bucket'; end if;
  raise exception 'TESTE_OK' using errcode = 'P0001';
end $$;
rollback;
```

Sessão de suporte (read/expirada) não ganha teste próprio aqui: o isolamento passa por `current_org_id()`,
que já trata a sessão de suporte e é coberto pelos testes do ADR-0092. A recusa de `authenticated` ao
executar as RPCs fica no teste da Task 2.

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

-- N-I1 (rodada 2/3 do Codex): o modo "cadastro pela nota" é persistido; o retry do cadastrar-produto
-- nunca aplica estoque inicial numa família criada nesse modo, mesmo que o payload do retry mude.
alter table public.familias add column if not exists origem_cadastro text
  check (origem_cadastro is null or origem_cadastro = 'nota');

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
  xml_sha256    text,
  -- Diferença (R$) entre vNF e a composição dos totais, aceita por confirmação ativa do operador.
  divergencia_total_aceita numeric(14,2),
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
  -- Valores como estão no documento (por item) + o rateio dos que só existiam no total (D-9).
  v_prod          numeric(14,2) not null,
  v_frete         numeric(14,2) not null default 0,
  v_seg           numeric(14,2) not null default 0,
  v_desc          numeric(14,2) not null default 0,
  v_outro         numeric(14,2) not null default 0,
  v_ipi           numeric(14,2) not null default 0,
  v_st            numeric(14,2) not null default 0,
  rateio          jsonb not null default '{}'::jsonb,
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

-- Precedente de bucket via migration: 20260527123422_enums_lotes_storage.sql:80.
insert into storage.buckets (id, name, public) values ('notas-compra', 'notas-compra', false)
  on conflict (id) do nothing;
-- Leitura do XML pela org. Upload só pela edge (service_role); nenhuma policy de escrita.
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
Expected: `TESTE_OK`.

- [ ] **Step 5: Regenerar tipos**

Run: `supabase gen types typescript --linked --schema public > src/lib/database.types.ts`, depois
`git diff --stat src/lib/database.types.ts`. Se aparecer mudança fora das tabelas e colunas novas, reverter
e adicionar só esses blocos à mão.

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
- Consumes: Task 1. `public.registrar_entrada(p_org, p_codigo, p_qtd, p_custo, p_doc, p_obs, p_criado_por, p_ref) returns integer` (null = ref duplicada). `public.ajustar_estoque(p_org, p_codigo, p_novo_saldo, p_obs, p_criado_por, p_ref) returns integer`.
- Produces:
  - `public.importar_nota_compra(p_org uuid, p_user uuid, p_nota jsonb, p_itens jsonb) returns jsonb` → `{nota_id, duplicada, codigos_pai}`.
  - `public.desfazer_nota_compra(p_org uuid, p_user uuid, p_nota_id uuid, p_status text) returns jsonb` → `{codigos_pai, ja_estava: boolean}`.
  - `public.registrar_entrada_nota_pendente(p_org, p_chave, p_codigo, p_qtd, p_custo, p_doc, p_user, p_ref) returns integer`: usado **só** pela Task 11. Mesmo lock da importação; recusa se a nota já existe.
  - `public.codigos_pai_da_nota(p_org uuid, p_chave text) returns text[]`.
  - Contrato de `p_nota`: `{chave, numero, serie, emitente_cnpj, emitente_nome, emitida_em, valor_total, assinada, xml_path, xml_sha256}`.
  - Contrato de `p_itens[]`: `{n_item, cprod, xprod, ncm, cfop, gtin, ucom, qcom, fator_conversao, v_prod, v_frete, v_seg, v_desc, v_outro, v_ipi, v_st, rateio, orig, codigo_pai, distribuicao:[{codigo, quantidade, custo_aquisicao_unit, custo_precificacao_unit}]}`.
  - Ref do ledger: `nfe:{chave}:{n_item}:{codigo}`. Ref do desfazer: `nfe-desfazer:{chave}:{codigo}`.

- [ ] **Step 1: Escrever o teste SQL que falha**

`supabase/tests/nota_compra.sql` (prefixo `93…`):

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
  '09300000', 'Short teste', 'CREATE', 'nacional', gen_random_uuid()),
  ('93000000-0000-0000-0000-000000000302', '93000000-0000-0000-0000-000000000201',
  '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001',
  '09310000', 'Outro produto', 'CREATE', 'nacional', gen_random_uuid());
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, preco, custo, estoque) values
  ('93000000-0000-0000-0000-000000000301', '93000000-0000-0000-0000-000000000101',
   '93000000-0000-0000-0000-000000000001', '09300001', 'P', 49.9, 8, 0),
  ('93000000-0000-0000-0000-000000000301', '93000000-0000-0000-0000-000000000101',
   '93000000-0000-0000-0000-000000000001', '09300002', 'M', 49.9, 8, 0),
  ('93000000-0000-0000-0000-000000000302', '93000000-0000-0000-0000-000000000101',
   '93000000-0000-0000-0000-000000000001', '09310001', 'U', 39.9, 8, 0);

set local role service_role;

do $$
declare r jsonb; r2 jsonb; v_p integer; v_m integer; v_o integer; v_custo numeric;
  v_nota jsonb := '{"chave":"26261011222333000181550010000010511000030324","numero":1051,"serie":1,
    "emitente_cnpj":"11222333000181","emitente_nome":"Fornecedor Teste","emitida_em":"2026-10-13T15:57:33-03:00",
    "valor_total":350,"assinada":false,"xml_path":"93000000-0000-0000-0000-000000000001/x.xml","xml_sha256":"abc"}';
  -- REF genérica: 30 no produto vinculado + 5 em SKU de OUTRO produto (D-7).
  v_itens jsonb := '[{"n_item":1,"cprod":"REF 06","xprod":"Short masculino - DIV - DIV","ncm":"62034900",
    "cfop":"5102","gtin":null,"ucom":"PC","qcom":35,"fator_conversao":1,"v_prod":350,"v_frete":0,"v_seg":0,
    "v_desc":0,"v_outro":0,"v_ipi":0,"v_st":0,"rateio":{},"orig":0,"codigo_pai":"09300000",
    "distribuicao":[{"codigo":"09300001","quantidade":10,"custo_aquisicao_unit":10,"custo_precificacao_unit":14},
                    {"codigo":"09300002","quantidade":20,"custo_aquisicao_unit":10,"custo_precificacao_unit":14},
                    {"codigo":"09310001","quantidade":5,"custo_aquisicao_unit":10,"custo_precificacao_unit":14}]}]';
begin
  -- D-8: o M "nasceu" pelo fluxo existente já com as 20 peças e a ref da nota.
  perform public.registrar_entrada('93000000-0000-0000-0000-000000000001', '09300002', 20, 14, 'addvar', null,
        '93000000-0000-0000-0000-000000000101', 'nfe:26261011222333000181550010000010511000030324:1:09300002');
  r := public.importar_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101', v_nota, v_itens);
  if (r->>'duplicada')::boolean then raise exception '1a importação veio duplicada'; end if;
  if (select estoque from public.variacoes where codigo='09300002') <> 20 then
    raise exception 'ref da nota já aplicada foi somada de novo (D-8)'; end if;
  if (select array_agg(x order by x) from jsonb_array_elements_text(r->'codigos_pai') x)
     <> array['09300000','09310000'] then
    raise exception 'push precisa ir para os 2 produtos tocados: %', r; end if;
  select estoque, custo into v_p, v_custo from public.variacoes where codigo='09300001';
  if v_p <> 10 then raise exception 'estoque P esperado 10, veio %', v_p; end if;
  if v_custo <> 14 then raise exception 'custo de precificação esperado 14, veio %', v_custo; end if;

  -- Reimportação: idempotente, saldo não soma, devolve os mesmos produtos.
  r2 := public.importar_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101', v_nota, v_itens);
  if not (r2->>'duplicada')::boolean then raise exception 'reimportação não marcada duplicada'; end if;
  if r2->>'nota_id' <> r->>'nota_id' then raise exception 'reimportação devolveu outra nota'; end if;
  select estoque into v_p from public.variacoes where codigo='09300001';
  if v_p <> 10 then raise exception 'reimportação somou: %', v_p; end if;

  -- Vendeu 1 do M (saldo 19 < 20 da nota): desfazer recusa inteiro, nada ajustado.
  perform public.ajustar_estoque('93000000-0000-0000-0000-000000000001', '09300002', 19, 'venda simulada',
        '93000000-0000-0000-0000-000000000101', 'teste-venda-1');
  begin
    perform public.desfazer_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101', (r->>'nota_id')::uuid, 'desfeita');
    raise exception 'desfazer deveria ter recusado';
  exception when sqlstate '23514' then
    if sqlerrm not like '%09300002%' then raise exception 'mensagem não lista o SKU: %', sqlerrm; end if;
  end;
  select estoque into v_p from public.variacoes where codigo='09300001';
  if v_p <> 10 then raise exception 'desfazer recusado mexeu no P: %', v_p; end if;

  -- Repõe o M e desfaz de verdade.
  perform public.registrar_entrada('93000000-0000-0000-0000-000000000001', '09300002', 1, null, null, null,
        '93000000-0000-0000-0000-000000000101', 'teste-repoe-1');
  r2 := public.desfazer_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101', (r->>'nota_id')::uuid, 'desfeita');
  select estoque into v_p from public.variacoes where codigo='09300001';
  select estoque into v_m from public.variacoes where codigo='09300002';
  select estoque into v_o from public.variacoes where codigo='09310001';
  if v_p <> 0 or v_m <> 0 or v_o <> 0 then raise exception 'desfazer não zerou: P=% M=% O=%', v_p, v_m, v_o; end if;
  if (r2->>'ja_estava')::boolean then raise exception '1o desfazer marcou ja_estava'; end if;

  -- Repetir o desfazer: no-op financeiro, devolve produtos para reenfileirar o push.
  r2 := public.desfazer_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101', (r->>'nota_id')::uuid, 'desfeita');
  if not (r2->>'ja_estava')::boolean then raise exception 'repetição do desfazer não é no-op'; end if;
  if jsonb_array_length(r2->'codigos_pai') <> 2 then raise exception 'repetição sem produtos: %', r2; end if;

  -- Nota desfeita não pode ser reimportada.
  begin
    perform public.importar_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101', v_nota, v_itens);
    raise exception 'reimportar nota desfeita deveria recusar';
  exception when sqlstate '23514' then null;
  end;

  -- Ref da nota já aplicada com quantidade DIFERENTE da distribuição: recusa a nota inteira.
  perform public.registrar_entrada('93000000-0000-0000-0000-000000000001', '09310001', 3, 14, 'addvar', null,
        '93000000-0000-0000-0000-000000000101', 'nfe:26261011222333000181550010000010511000099991:1:09310001');
  begin
    perform public.importar_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101',
        jsonb_set(v_nota, '{chave}', '"26261011222333000181550010000010511000099991"'),
        '[{"n_item":1,"cprod":"REF 09","xprod":"X","ncm":null,"cfop":"5102","gtin":null,"ucom":"PC","qcom":5,
          "fator_conversao":1,"v_prod":50,"v_frete":0,"v_seg":0,"v_desc":0,"v_outro":0,"v_ipi":0,"v_st":0,
          "rateio":{},"orig":0,"codigo_pai":"09310000",
          "distribuicao":[{"codigo":"09310001","quantidade":5,"custo_aquisicao_unit":10,"custo_precificacao_unit":14}]}]');
    raise exception 'quantidade divergente da ref já aplicada deveria recusar';
  exception when sqlstate '23514' then null;
  end;
  if exists (select 1 from public.notas_compra where chave = '26261011222333000181550010000010511000099991') then
    raise exception 'nota recusada deixou registro (deveria ser atômica)'; end if;

  -- R3-B1: entrada prévia com a ref da nota num SKU que ficou FORA da distribuição → recusa.
  perform public.registrar_entrada('93000000-0000-0000-0000-000000000001', '09300001', 5, 14, 'addvar', null,
        '93000000-0000-0000-0000-000000000101', 'nfe:26261011222333000181550010000010511000099992:1:09300001');
  begin
    perform public.importar_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101',
        jsonb_set(v_nota, '{chave}', '"26261011222333000181550010000010511000099992"'),
        '[{"n_item":1,"cprod":"REF 10","xprod":"X","ncm":null,"cfop":"5102","gtin":null,"ucom":"PC","qcom":5,
          "fator_conversao":1,"v_prod":50,"v_frete":0,"v_seg":0,"v_desc":0,"v_outro":0,"v_ipi":0,"v_st":0,
          "rateio":{},"orig":0,"codigo_pai":"09310000",
          "distribuicao":[{"codigo":"09310001","quantidade":5,"custo_aquisicao_unit":10,"custo_precificacao_unit":14}]}]');
    raise exception 'entrada prévia fora da distribuição deveria recusar';
  exception when sqlstate '23514' then
    if sqlerrm not like '%09300001%' then raise exception 'mensagem não cita o SKU órfão: %', sqlerrm; end if;
  end;

  -- registrar_entrada_nota_pendente: nota já importada (a 1a, agora desfeita) recusa; ref de outra nota recusa.
  begin
    perform public.registrar_entrada_nota_pendente('93000000-0000-0000-0000-000000000001',
      '26261011222333000181550010000010511000030324', '09300001', 5, 14, 'addvar',
      '93000000-0000-0000-0000-000000000101', 'nfe:26261011222333000181550010000010511000030324:1:09300001');
    raise exception 'entrada pendente aceitou nota já fechada';
  exception when sqlstate '23514' then null;
  end;
  begin
    perform public.registrar_entrada_nota_pendente('93000000-0000-0000-0000-000000000001',
      '26261011222333000181550010000010511000077771', '09300001', 5, 14, 'addvar',
      '93000000-0000-0000-0000-000000000101', 'nfe:99999999999999999999999999999999999999999999:1:09300001');
    raise exception 'entrada pendente aceitou ref de outra nota';
  exception when sqlstate '22023' then null;
  end;
  if public.registrar_entrada_nota_pendente('93000000-0000-0000-0000-000000000001',
      '26261011222333000181550010000010511000077771', '09300001', 5, 14, 'addvar',
      '93000000-0000-0000-0000-000000000101', 'nfe:26261011222333000181550010000010511000077771:1:09300001') is null then
    raise exception 'entrada pendente de nota ainda não importada deveria aplicar';
  end if;

  -- codigos_pai_da_nota devolve os produtos da 1a nota (importação + desfazer).
  if (select array_agg(x order by x) from unnest(public.codigos_pai_da_nota('93000000-0000-0000-0000-000000000001',
        '26261011222333000181550010000010511000030324')) x) <> array['09300000','09310000'] then
    raise exception 'codigos_pai_da_nota errado'; end if;
end $$;

-- authenticated nunca executa as RPCs (escrita só via edge/service_role).
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"93000000-0000-0000-0000-000000000101","role":"authenticated"}';
do $$
begin
  begin
    perform public.importar_nota_compra('93000000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000101', '{}'::jsonb, '[]'::jsonb);
    raise exception 'authenticated executou importar_nota_compra';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.desfazer_nota_compra('93000000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000101', gen_random_uuid(), 'desfeita');
    raise exception 'authenticated executou desfazer_nota_compra';
  exception when insufficient_privilege then null;
  end;
  raise exception 'TESTE_OK' using errcode = 'P0001';
end $$;
rollback;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python3 scripts/teste-sql-desfeito.py supabase/tests/nota_compra.sql`
Expected: FAIL (`function public.importar_nota_compra(...) does not exist`).

- [ ] **Step 3: Criar a migration das RPCs**

Run: `supabase migration new adr181_rpc_nota_compra` e preencher:

```sql
-- ADR-0181 D-4/D-11. security INVOKER: roda como o chamador (service_role, via edge), que já
-- executa registrar_entrada/ajustar_estoque (ambas definer, owner estoque_rpc_executor).
-- Uma chamada = uma transação.

create or replace function public.importar_nota_compra(
  p_org uuid, p_user uuid, p_nota jsonb, p_itens jsonb
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_chave text := p_nota->>'chave';
  v_nota uuid; v_status text; v_item jsonb; v_item_id uuid; v_d jsonb; v_doc text; v_pais jsonb;
  v_ref text; v_ret integer; v_lancada integer; v_orfas text;
begin
  -- Serializa importações concorrentes da MESMA nota: a segunda espera e cai em "duplicada"
  -- em vez de estourar a unique (org_id, chave).
  perform pg_advisory_xact_lock(hashtextextended('nfe:' || p_org::text || ':' || v_chave, 0));

  select id, status into v_nota, v_status from public.notas_compra
   where org_id = p_org and chave = v_chave;

  if v_nota is not null and v_status <> 'importada' then
    raise exception 'importar_nota_compra: a nota % está %; não pode ser reimportada', v_chave, v_status
      using errcode = '23514';
  end if;

  if v_nota is null then
    insert into public.notas_compra (org_id, chave, numero, serie, emitente_cnpj, emitente_nome,
      emitida_em, valor_total, assinada, xml_path, xml_sha256, divergencia_total_aceita, importada_por)
    values (p_org, v_chave, (p_nota->>'numero')::int, (p_nota->>'serie')::int,
      p_nota->>'emitente_cnpj', p_nota->>'emitente_nome', (p_nota->>'emitida_em')::timestamptz,
      (p_nota->>'valor_total')::numeric, (p_nota->>'assinada')::boolean, p_nota->>'xml_path',
      p_nota->>'xml_sha256', nullif(p_nota->>'divergencia_total_aceita', '')::numeric, p_user)
    returning id into v_nota;

    v_doc := 'NF-e ' || (p_nota->>'numero') || ' · ' || (p_nota->>'emitente_nome');

    for v_item in select * from jsonb_array_elements(p_itens) loop
      insert into public.notas_compra_itens (nota_id, org_id, n_item, cprod, xprod, ncm, cfop, gtin,
        ucom, qcom, fator_conversao, v_prod, v_frete, v_seg, v_desc, v_outro, v_ipi, v_st, rateio,
        orig, codigo_pai)
      values (v_nota, p_org, (v_item->>'n_item')::smallint, v_item->>'cprod', v_item->>'xprod',
        v_item->>'ncm', v_item->>'cfop', v_item->>'gtin', v_item->>'ucom', (v_item->>'qcom')::numeric,
        (v_item->>'fator_conversao')::int, (v_item->>'v_prod')::numeric, (v_item->>'v_frete')::numeric,
        (v_item->>'v_seg')::numeric, (v_item->>'v_desc')::numeric, (v_item->>'v_outro')::numeric,
        (v_item->>'v_ipi')::numeric, (v_item->>'v_st')::numeric, coalesce(v_item->'rateio', '{}'::jsonb),
        (v_item->>'orig')::smallint, v_item->>'codigo_pai')
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

        -- Ledger guarda o custo de PRECIFICAÇÃO (D-3); o de aquisição fica na nota.
        v_ref := 'nfe:' || v_chave || ':' || (v_item->>'n_item') || ':' || (v_d->>'codigo');
        v_ret := public.registrar_entrada(p_org, v_d->>'codigo', (v_d->>'quantidade')::int,
          (v_d->>'custo_precificacao_unit')::numeric, v_doc, null, p_user, v_ref);
        if v_ret is null then
          -- Ref já aplicada: a variação nasceu pelo fluxo existente com a referência da nota (D-8).
          -- A quantidade lançada tem de ser a da nota, senão a nota e o ledger divergem.
          select m.quantidade into v_lancada from public.estoque_movimentos m
           where m.org_id = p_org and m.referencia_externa = v_ref;
          if v_lancada is distinct from (v_d->>'quantidade')::int then
            raise exception 'importar_nota_compra: % já recebeu % unidades por esta nota; a distribuição diz %',
              v_d->>'codigo', v_lancada, v_d->>'quantidade' using errcode = '23514';
          end if;
        end if;
      end loop;
    end loop;

    -- R3-B1: toda entrada já lançada com a ref desta nota (ex.: variação criada pela D-8) tem de
    -- estar na distribuição confirmada. Senão a nota de 35 viraria 40 no estoque.
    select string_agg(m.codigo, ', ' order by m.codigo) into v_orfas
      from public.estoque_movimentos m
     where m.org_id = p_org and m.referencia_externa like 'nfe:' || v_chave || ':%'
       and not exists (
         select 1 from public.notas_compra_distribuicao d
           join public.notas_compra_itens i on i.id = d.item_id
          where i.nota_id = v_nota
            and m.referencia_externa = 'nfe:' || v_chave || ':' || i.n_item || ':' || d.codigo);
    if v_orfas is not null then
      raise exception 'importar_nota_compra: já houve entrada por esta nota em % fora da distribuição', v_orfas
        using errcode = '23514';
    end if;
  end if;

  -- Produtos tocados lidos do LEDGER (distribuição pode cair em outro produto, D-7).
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

  if v_status = 'importada' then
    -- Trava as variações CANÔNICAS de todos os SKUs da nota, em ordem determinística, ANTES
    -- de ler saldo: venda/entrada concorrente espera, e o ajuste absoluto não apaga movimento.
    perform 1 from public.variacoes v
     where v.id in (
       select (select v2.id from public.variacoes v2 join public.familias f on f.id = v2.familia_id
                where v2.org_id = p_org and v2.codigo = d.codigo order by f.criado_em desc limit 1)
         from public.notas_compra_distribuicao d join public.notas_compra_itens i on i.id = d.item_id
        where i.nota_id = p_nota_id)
     order by v.codigo for update;

    create temp table if not exists _nfe_desfazer (codigo text, qtd int, saldo int) on commit drop;
    truncate _nfe_desfazer;
    insert into _nfe_desfazer
    select d.codigo, sum(d.quantidade)::int,
      (select v.estoque from public.variacoes v join public.familias f on f.id = v.familia_id
        where v.org_id = p_org and v.codigo = d.codigo order by f.criado_em desc limit 1)
      from public.notas_compra_distribuicao d join public.notas_compra_itens i on i.id = d.item_id
     where i.nota_id = p_nota_id group by d.codigo;

    select string_agg(codigo || ' (saldo ' || saldo || ', nota ' || qtd || ')', ', ' order by codigo)
      into v_faltas from _nfe_desfazer where saldo < qtd;
    if v_faltas is not null then
      raise exception 'desfazer_nota_compra: saldo insuficiente em %', v_faltas using errcode = '23514';
    end if;

    for r in select * from _nfe_desfazer order by codigo loop
      perform public.ajustar_estoque(p_org, r.codigo, r.saldo - r.qtd,
        case p_status when 'desfeita' then 'Desfazer NF-e ' else 'NF-e cancelada ' end || v_numero,
        p_user, 'nfe-desfazer:' || v_chave || ':' || r.codigo);
    end loop;

    update public.notas_compra set status = p_status, desfeita_por = p_user, desfeita_em = now()
     where id = p_nota_id;
  end if;

  -- Já desfeita/cancelada: no-op financeiro. Devolve os produtos para o retry reenfileirar o push.
  select coalesce(jsonb_agg(distinct m.codigo_pai), '[]'::jsonb) into v_pais
    from public.estoque_movimentos m
   where m.org_id = p_org and m.referencia_externa like 'nfe:' || v_chave || ':%';
  return jsonb_build_object('codigos_pai', v_pais, 'ja_estava', v_status <> 'importada');
end $$;

-- D-8 / R3-B1 (rodada 4): entrada de variação nova com a ref de uma nota AINDA NÃO importada. Pega o
-- MESMO advisory lock da importação: depois que a nota fecha (qualquer status), recusa — senão uma aba
-- antiga somaria peças fora da distribuição já confirmada.
create or replace function public.registrar_entrada_nota_pendente(
  p_org uuid, p_chave text, p_codigo text, p_qtd integer, p_custo numeric, p_doc text, p_user uuid, p_ref text
) returns integer language plpgsql security invoker set search_path = ''
as $$
begin
  if p_ref not like 'nfe:' || p_chave || ':%' then
    raise exception 'registrar_entrada_nota_pendente: ref % não pertence à nota %', p_ref, p_chave using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nfe:' || p_org::text || ':' || p_chave, 0));
  if exists (select 1 from public.notas_compra where org_id = p_org and chave = p_chave) then
    raise exception 'registrar_entrada_nota_pendente: a nota % já foi importada; adicione o tamanho/cor sem a nota', p_chave
      using errcode = '23514';
  end if;
  return public.registrar_entrada(p_org, p_codigo, p_qtd, p_custo, p_doc, null, p_user, p_ref);
end $$;
revoke all on function public.registrar_entrada_nota_pendente(uuid, text, text, integer, numeric, text, uuid, text) from public, anon, authenticated;
grant execute on function public.registrar_entrada_nota_pendente(uuid, text, text, integer, numeric, text, uuid, text) to service_role;

-- Produtos tocados pela nota (importação e desfazer), para o "Reenviar estoque" (R3-I4: sem
-- paginação de PostgREST, distinto no banco).
create or replace function public.codigos_pai_da_nota(p_org uuid, p_chave text)
returns text[] language sql stable security invoker set search_path = ''
as $$
  select coalesce(array_agg(distinct m.codigo_pai), '{}')
    from public.estoque_movimentos m
   where m.org_id = p_org
     and (m.referencia_externa like 'nfe:' || p_chave || ':%'
          or m.referencia_externa like 'nfe-desfazer:' || p_chave || ':%');
$$;
revoke all on function public.codigos_pai_da_nota(uuid, text) from public, anon, authenticated;
grant execute on function public.codigos_pai_da_nota(uuid, text) to service_role;

revoke all on function public.importar_nota_compra(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.desfazer_nota_compra(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.importar_nota_compra(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.desfazer_nota_compra(uuid, uuid, uuid, text) to service_role;
```

- [ ] **Step 4: Aplicar e rodar os dois testes**

```bash
supabase db push
npm run db:check
python3 scripts/teste-sql-desfeito.py supabase/tests/nota_compra.sql
python3 scripts/teste-sql-desfeito.py supabase/tests/nota_compra_schema.sql
```
Expected: os dois com `TESTE_OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_adr181_rpc_nota_compra.sql supabase/tests/nota_compra.sql
git commit -m "feat(adr-0181): RPCs importar/desfazer nota (atômicas, serializadas, idempotentes)"
```

---

### Task 3: Regras puras da nota (`_shared/nfe/regras.ts`)

**Files:**
- Create: `supabase/functions/_shared/nfe/tipos.ts`, `supabase/functions/_shared/nfe/regras.ts`
- Test: `supabase/functions/_shared/nfe/__tests__/regras.test.ts`

**Interfaces:**
- Produces (exatos):

```ts
// tipos.ts
export interface ItemNotaLido {
  nItem: number; cProd: string; xProd: string; ncm: string | null; cfop: string;
  gtin: string | null; uCom: string; qCom: number;
  vProd: number; vFrete: number; vSeg: number; vDesc: number; vOutro: number; vIPI: number; vST: number;
  orig: number | null;
}
export type CampoAcessorio = 'vFrete' | 'vSeg' | 'vDesc' | 'vOutro' | 'vIPI' | 'vST';
export interface TotaisNota {
  vProd: number; vFrete: number; vSeg: number; vDesc: number; vOutro: number; vIPI: number; vST: number;
  vII: number; vIPIDevol: number; vFCPST: number; vNF: number;
}
export interface NotaCompraLida {
  chave: string; numero: number; serie: number; modelo: number; tipoNf: number;
  emitidaEm: string; emitenteCnpj: string; emitenteNome: string; destinatarioCnpj: string;
  totais: TotaisNota; assinada: boolean; cStat: number | null; itens: ItemNotaLido[];
}
/** Item depois da conciliação: valores efetivos (documento + rateio) e o rateio aplicado. */
export interface ItemConciliado extends ItemNotaLido { rateio: Partial<Record<CampoAcessorio, number>> }
export interface LinhaDistribuicao { codigo: string; quantidade: number; custoPrecificacao: number }
/** O que o NAVEGADOR manda por item: só decisões do operador. */
export interface DecisaoImportacao { nItem: number; codigoPai: string; fator: number; distribuicao: LinhaDistribuicao[] }
```

```ts
// regras.ts
export function chaveNfeValida(chave: string): boolean;
export function gtinValido(gtin: string): boolean;               // GTIN-8/12/13/14, DV módulo 10
export const CFOPS_ACEITOS: ReadonlySet<string>;
export function cfopAceito(cfop: string): boolean;
export function quantidadeEmEstoque(qCom: number, fator: number): { ok: true; quantidade: number } | { ok: false; erro: string };
export function conciliarItens(nota: NotaCompraLida): { ok: true; itens: ItemConciliado[]; avisoTotal: string | null; divergenciaTotal: number } | { ok: false; erro: string }; // divergenciaTotal em R$ (vNF − composição)
export function custoAquisicaoUnit(item: ItemConciliado, fator: number): number; // sem arredondar
export function erroDistribuicao(esperado: number, linhas: LinhaDistribuicao[]): string | null;
export function limparDescricaoFornecedor(xProd: string): string;
export function origemSugerida(orig: number | null): { origemNfe: number; origem: 'nacional' | 'importado' } | null;
```

`conciliarItens` (tudo em **centavos inteiros**, sem tolerância):
- Qualquer valor negativo, por item ou no total → recusa.
- Soma dos `vProd` dos itens ≠ `totais.vProd` → recusa.
- Para cada campo acessório:
  - soma dos itens = total → usa os valores por item;
  - soma dos itens = 0 e total > 0 → **rateia** o total proporcionalmente ao `vProd` pelo método dos **maiores
    restos**. Cada parcela recebe o piso, e os centavos que sobram vão, um a um, aos maiores restos (empate →
    menor `nItem`). Nenhuma parcela fica negativa e a soma fecha exata. O valor rateado é somado ao campo do
    item e registrado em `rateio`;
  - nos demais casos → recusa ("totais de {campo} não batem").
- Composição de `vNF`: `vProd − vDesc + vST + vFCPST + vFrete + vSeg + vOutro + vII + vIPI + vIPIDevol`.
  Se divergir, devolve `divergenciaTotal` (em R$, `vNF − composição`) e `avisoTotal`. **A importação só segue
  com confirmação ativa do operador** (R3-I2): o servidor recusa sem `aceitarDivergenciaTotal: true` e grava o
  valor aceito em `notas_compra.divergencia_total_aceita`. Não recusa direto porque há componentes, como
  `vICMSDeson` e ISSQN, que só valem em leiautes específicos. Não aceita em silêncio por causa do ADR D-2.

`origemSugerida`:
- `null` → `null` (fica pendente, nunca vira "nacional").
- `1 → 2` e `6 → 7`: importação direta do fornecedor vira "estrangeira adquirida no mercado interno" na revenda.
- Demais valores iguais.
- `origem` binária derivada de `ORIGENS_NFE_POR_ORIGEM` (`_shared/fiscal/validar.ts`, espelho em `src/lib/fiscal.ts:4`):
  - nacional = 0, 3, 4, 5, 8;
  - importado = 1, 2, 6, 7.

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { describe, it, expect } from 'vitest';
import {
  chaveNfeValida, gtinValido, cfopAceito, quantidadeEmEstoque, conciliarItens, custoAquisicaoUnit,
  erroDistribuicao, limparDescricaoFornecedor, origemSugerida,
} from '../regras';
import type { ItemNotaLido, NotaCompraLida } from '../tipos';

const item = (o: Partial<ItemNotaLido> = {}): ItemNotaLido => ({
  nItem: 1, cProd: 'REF 06', xProd: 'Short', ncm: '62034900', cfop: '5102', gtin: null, uCom: 'PC',
  qCom: 35, vProd: 350, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, orig: 0, ...o,
});
const zero = { vProd: 0, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vII: 0, vIPIDevol: 0, vFCPST: 0, vNF: 0 };
const nota = (itens: ItemNotaLido[], tot: Partial<typeof zero>): NotaCompraLida => ({
  chave: '26261011222333000181550010000010511000030324', numero: 1, serie: 1, modelo: 55, tipoNf: 1,
  emitidaEm: '2026-10-13T00:00:00-03:00', emitenteCnpj: '11222333000181', emitenteNome: 'F',
  destinatarioCnpj: '11444777000161', assinada: false, cStat: 100, itens, totais: { ...zero, ...tot },
});

describe('chaveNfeValida', () => {
  it('aceita DV correto e recusa DV, tamanho e caractere errados', () => {
    expect(chaveNfeValida('26261011222333000181550010000010511000030324')).toBe(true);
    expect(chaveNfeValida('26261011222333000181550010000010511000030325')).toBe(false);
    expect(chaveNfeValida('2626101122233300018155001000001051100003032')).toBe(false);
    expect(chaveNfeValida('2626101122233300018155001000001051100003032X')).toBe(false);
  });
});

describe('gtinValido', () => {
  it('aceita EAN-13 com DV certo e recusa DV errado ou tamanho inválido', () => {
    expect(gtinValido('7891234567895')).toBe(true);
    expect(gtinValido('7891234567894')).toBe(false);
    expect(gtinValido('12345')).toBe(false);
  });
});

describe('cfopAceito', () => {
  it('venda/revenda (5102, 6102, 5405) sim; bonificação, remessa, devolução não', () => {
    for (const c of ['5102', '6102', '5405']) expect(cfopAceito(c)).toBe(true);
    for (const c of ['5910', '5949', '5202']) expect(cfopAceito(c)).toBe(false);
  });
});

describe('quantidadeEmEstoque', () => {
  it('2 CX × 12 = 24; fracionário que não fecha e fator inválido recusam', () => {
    expect(quantidadeEmEstoque(2, 12)).toEqual({ ok: true, quantidade: 24 });
    expect(quantidadeEmEstoque(2.5, 1).ok).toBe(false);
    expect(quantidadeEmEstoque(2, 0).ok).toBe(false);
    expect(quantidadeEmEstoque(2, 1.5).ok).toBe(false);
  });
});

describe('conciliarItens', () => {
  it('usa os valores por item quando batem com o total', () => {
    const r = conciliarItens(nota([item({ vFrete: 5 })], { vProd: 350, vFrete: 5, vNF: 355 }));
    if (!r.ok) throw new Error(r.erro);
    expect(r.itens[0].vFrete).toBe(5);
    expect(r.itens[0].rateio).toEqual({});
    expect(r.avisoTotal).toBeNull();
  });
  it('rateia por maiores restos: 10,00 em 3 itens iguais', () => {
    const r = conciliarItens(nota(
      [item({ nItem: 1, vProd: 100 }), item({ nItem: 2, vProd: 100 }), item({ nItem: 3, vProd: 100 })],
      { vProd: 300, vFrete: 10, vNF: 310 },
    ));
    if (!r.ok) throw new Error(r.erro);
    expect(r.itens.map((i) => i.vFrete)).toEqual([3.34, 3.33, 3.33]);
    expect(r.itens[0].rateio).toEqual({ vFrete: 3.34 });
  });
  it('0,02 em 4 itens nunca gera parcela negativa; 0,01 só no total também rateia', () => {
    const quatro = [1, 2, 3, 4].map((n) => item({ nItem: n, vProd: 10 }));
    const r = conciliarItens(nota(quatro, { vProd: 40, vFrete: 0.02, vNF: 40.02 }));
    if (!r.ok) throw new Error(r.erro);
    expect(r.itens.map((i) => i.vFrete)).toEqual([0.01, 0.01, 0, 0]);
    const um = conciliarItens(nota([item({ vProd: 10 })], { vProd: 10, vSeg: 0.01, vNF: 10.01 }));
    expect(um.ok && um.itens[0].vSeg).toBe(0.01);
  });
  it('desconto só no total é rateado e reduz (não aumenta) o custo', () => {
    const r = conciliarItens(nota([item({ nItem: 1, vProd: 75 }), item({ nItem: 2, vProd: 25 })],
      { vProd: 100, vDesc: 10, vNF: 90 }));
    if (!r.ok) throw new Error(r.erro);
    expect(r.itens.map((i) => i.vDesc)).toEqual([7.5, 2.5]);
  });
  it('recusa negativo, vProd que não bate e acessório parcial', () => {
    expect(conciliarItens(nota([item({ vFrete: -5 })], { vProd: 350, vFrete: -5 })).ok).toBe(false);
    expect(conciliarItens(nota([item({ vProd: 100 })], { vProd: 300 })).ok).toBe(false);
    expect(conciliarItens(nota([item({ vFrete: 2 })], { vProd: 350, vFrete: 5 })).ok).toBe(false);
  });
  it('vNF fora da composição vira aviso, não recusa', () => {
    const r = conciliarItens(nota([item()], { vProd: 350, vNF: 999999 }));
    expect(r.ok && r.avisoTotal).toMatch(/999999/);
    expect(r.ok && r.divergenciaTotal).toBeCloseTo(999649, 2);
  });
  it('maiores restos desempatam pelo menor nItem, não pela posição no XML', () => {
    const r = conciliarItens(nota([4, 3, 2, 1].map((n) => item({ nItem: n, vProd: 10 })), { vProd: 40, vFrete: 0.02, vNF: 40.02 }));
    if (!r.ok) throw new Error(r.erro);
    expect(Object.fromEntries(r.itens.map((i) => [i.nItem, i.vFrete]))).toEqual({ 1: 0.01, 2: 0.01, 3: 0, 4: 0 });
  });
});

describe('custoAquisicaoUnit', () => {
  it('soma acessórios, subtrai desconto e divide pela quantidade convertida', () => {
    const r = conciliarItens(nota(
      [item({ qCom: 2, vProd: 240, vFrete: 12, vSeg: 1, vOutro: 2, vIPI: 6, vST: 3, vDesc: 4 })],
      { vProd: 240, vFrete: 12, vSeg: 1, vOutro: 2, vIPI: 6, vST: 3, vDesc: 4, vNF: 260 },
    ));
    if (!r.ok) throw new Error(r.erro);
    expect(custoAquisicaoUnit(r.itens[0], 12)).toBeCloseTo(260 / 24, 10);
  });
});

describe('erroDistribuicao', () => {
  const l = (codigo: string, quantidade: number) => ({ codigo, quantidade, custoPrecificacao: 10 });
  it('soma exata passa; diferente diz quanto falta', () => {
    expect(erroDistribuicao(35, [l('A', 15), l('B', 20)])).toBeNull();
    expect(erroDistribuicao(35, [l('A', 15), l('B', 18)])).toMatch(/33 de 35/);
  });
  it('repetido, não inteiro, ≤ 0, custo ≤ 0 e lista vazia falham', () => {
    expect(erroDistribuicao(10, [l('A', 5), l('A', 5)])).toMatch(/repetido/);
    expect(erroDistribuicao(10, [l('A', 10.5)])).toMatch(/inteira/);
    expect(erroDistribuicao(10, [l('A', 0), l('B', 10)])).toMatch(/maior que zero/);
    expect(erroDistribuicao(10, [{ codigo: 'A', quantidade: 10, custoPrecificacao: 0 }])).toMatch(/custo/i);
    expect(erroDistribuicao(10, [])).toMatch(/0 de 10/);
  });
});

describe('limparDescricaoFornecedor', () => {
  it('tira o sufixo de grade agregada e normaliza espaços', () => {
    expect(limparDescricaoFornecedor('Short masculino - DIV - DIV')).toBe('Short masculino');
    expect(limparDescricaoFornecedor('  Camiseta  básica ')).toBe('Camiseta básica');
  });
});

describe('origemSugerida', () => {
  it('ausente fica pendente; importação direta vira mercado interno; binária coerente', () => {
    expect(origemSugerida(null)).toBeNull();
    expect(origemSugerida(0)).toEqual({ origemNfe: 0, origem: 'nacional' });
    expect(origemSugerida(1)).toEqual({ origemNfe: 2, origem: 'importado' });
    expect(origemSugerida(6)).toEqual({ origemNfe: 7, origem: 'importado' });
    expect(origemSugerida(3)).toEqual({ origemNfe: 3, origem: 'nacional' });
    expect(origemSugerida(8)).toEqual({ origemNfe: 8, origem: 'nacional' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- supabase/functions/_shared/nfe`
Expected: FAIL (`Cannot find module '../regras'`).

- [ ] **Step 3: Implementar**

`tipos.ts`: exatamente o bloco de interfaces acima. `regras.ts`:

```ts
// ADR-0181 — regras puras da nota de compra. Importado pelo front e pela edge: só imports
// relativos folha, sem jsr:/npm:/Deno.
import type { CampoAcessorio, ItemConciliado, LinhaDistribuicao, NotaCompraLida } from './tipos.ts';
import { ORIGENS_NFE_POR_ORIGEM } from '../fiscal/validar.ts';

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

export function gtinValido(gtin: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)) return false;
  const d = gtin.split('').map(Number);
  const dv = d.pop()!;
  const soma = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === dv;
}

// D-2: só venda/revenda do fornecedor (com e sem ST).
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
  const arred = Math.round(q);
  if (!Number.isFinite(q) || Math.abs(q - arred) > 1e-6 || arred <= 0) {
    return { ok: false, erro: `A quantidade (${qCom} × ${fator}) precisa fechar em uma quantidade inteira de unidades.` };
  }
  return { ok: true, quantidade: arred };
}

const CAMPOS: CampoAcessorio[] = ['vFrete', 'vSeg', 'vDesc', 'vOutro', 'vIPI', 'vST'];
const cent = (n: number) => Math.round(n * 100);

/** Divide `total` (centavos) proporcionalmente a `pesos` pelos maiores restos: soma exata, sem negativos.
 *  Empate de resto → menor `desempate` (o nItem). */
function maioresRestos(total: number, pesos: number[], desempate: number[]): number[] {
  const somaPesos = pesos.reduce((s, p) => s + p, 0);
  const brutos = pesos.map((p) => (total * p) / somaPesos);
  const partes = brutos.map(Math.floor);
  let sobra = total - partes.reduce((s, p) => s + p, 0);
  const ordem = brutos.map((b, i) => ({ i, resto: b - Math.floor(b) }))
    .sort((a, b) => b.resto - a.resto || desempate[a.i] - desempate[b.i]);
  for (const { i } of ordem) { if (sobra <= 0) break; partes[i] += 1; sobra -= 1; }
  return partes;
}

export function conciliarItens(
  nota: NotaCompraLida,
): { ok: true; itens: ItemConciliado[]; avisoTotal: string | null } | { ok: false; erro: string } {
  const itens: ItemConciliado[] = nota.itens.map((i) => ({ ...i, rateio: {} }));
  const negativo = [...itens.flatMap((i) => [i.vProd, ...CAMPOS.map((c) => i[c])]), ...Object.values(nota.totais)]
    .some((v) => v < 0);
  if (negativo) return { ok: false, erro: 'A nota tem valor negativo — não é possível conferir os totais.' };

  const prodItens = itens.map((i) => cent(i.vProd));
  const somaProd = prodItens.reduce((s, v) => s + v, 0);
  if (somaProd !== cent(nota.totais.vProd)) {
    return { ok: false, erro: `A soma dos itens (${somaProd / 100}) não bate com o total de produtos da nota (${nota.totais.vProd}).` };
  }
  for (const campo of CAMPOS) {
    const somaItens = itens.reduce((s, i) => s + cent(i[campo]), 0);
    const total = cent(nota.totais[campo]);
    if (somaItens === total) continue;
    if (somaItens !== 0 || somaProd === 0) {
      return { ok: false, erro: `Os totais de ${campo} não batem entre os itens e o total da nota.` };
    }
    maioresRestos(total, prodItens, itens.map((i) => i.nItem)).forEach((parte, idx) => {
      itens[idx][campo] = parte / 100;
      if (parte > 0) itens[idx].rateio[campo] = parte / 100;
    });
  }
  const t = nota.totais;
  const composto = cent(t.vProd) - cent(t.vDesc) + cent(t.vST) + cent(t.vFCPST) + cent(t.vFrete) + cent(t.vSeg)
    + cent(t.vOutro) + cent(t.vII) + cent(t.vIPI) + cent(t.vIPIDevol);
  const diff = cent(t.vNF) - composto;
  const avisoTotal = diff === 0 ? null
    : `O total da nota (${t.vNF}) difere da soma dos componentes (${composto / 100}). Confira antes de confirmar.`;
  return { ok: true, itens, avisoTotal, divergenciaTotal: diff / 100 };
}

export function custoAquisicaoUnit(item: ItemConciliado, fator: number): number {
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
    if (!(Number.isFinite(l.custoPrecificacao) && l.custoPrecificacao > 0)) return `O custo de ${l.codigo} precisa ser maior que zero.`;
    soma += l.quantidade;
  }
  if (soma !== esperado) return `A distribuição soma ${soma} de ${esperado} unidades da nota.`;
  return null;
}

export function limparDescricaoFornecedor(xProd: string): string {
  return xProd.replace(/(\s*-\s*DIV)+\s*$/i, '').replace(/\s+/g, ' ').trim();
}

const REVENDA_INTERNA: Record<number, number> = { 1: 2, 6: 7 };
export function origemSugerida(orig: number | null): { origemNfe: number; origem: 'nacional' | 'importado' } | null {
  if (orig === null || !Number.isInteger(orig) || orig < 0 || orig > 8) return null;
  const origemNfe = REVENDA_INTERNA[orig] ?? orig;
  return { origemNfe, origem: ORIGENS_NFE_POR_ORIGEM.nacional.includes(origemNfe) ? 'nacional' : 'importado' };
}
```

Antes, conferir em `_shared/fiscal/validar.ts` que `ORIGENS_NFE_POR_ORIGEM` é exportado com o mesmo formato
do espelho do front. Se não for, importar a constante equivalente que esse arquivo exporta e manter o teste.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- supabase/functions/_shared/nfe`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/nfe
git commit -m "feat(adr-0181): regras puras da nota (chave, GTIN, CFOP, conciliação+rateio, custo, distribuição, origem)"
```

---

### Task 4: Leitor de XML puro (`_shared/nfe/ler-nfe.ts`) — front e edge

**Files:**
- Create: `supabase/functions/_shared/nfe/ler-nfe.ts`
- Create: `supabase/functions/_shared/nfe/__tests__/fixtures/nfe-exportacao-erp.xml`, `.../fixtures/nfe-sefaz.xml`
- Test: `supabase/functions/_shared/nfe/__tests__/ler-nfe.test.ts`

**Interfaces:**
- Consumes: `NotaCompraLida`, `ItemNotaLido`, `TotaisNota` (Task 3); `gtinValido`.
- Produces: `export function lerNfe(xml: string): { ok: true; nota: NotaCompraLida } | { ok: false; erro: string }`

**Por que não `DOMParser`:** o Deno das edges não tem `DOMParser`, e o servidor **precisa** ler o XML
(bloqueador 1 do Codex). Um leitor textual do subconjunto da NF-e funciona nos dois lados, não traz
dependência e é testado com os dois formatos reais. Ele aceita prefixo de namespace e entidades XML básicas.

- [ ] **Step 1: Fixtures**

`nfe-exportacao-erp.xml` (forma do arquivo real do cliente: `nItem` como elemento, sem `Signature`):

```xml
<?xml version="1.0" encoding="utf-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><protNFe><infProt><chNFe>26261011222333000181550010000010511000030324</chNFe><cStat>100</cStat></infProt></protNFe><NFe><infNFe Id="NFe26261011222333000181550010000010511000030324"><det><nItem>1</nItem><prod><cEAN>SEM GTIN</cEAN><cProd>REF 06</cProd><qCom>35.0000</qCom><vProd>350.00</vProd><xProd>Short masculino - DIV - DIV</xProd><NCM>62034900</NCM><uCom>PC</uCom><CFOP>5102</CFOP></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto></det><det><nItem>2</nItem><prod><cEAN>SEM GTIN</cEAN><cProd>REF 08</cProd><qCom>35.0000</qCom><vProd>350.00</vProd><xProd>Conjunto infantil &amp; bebê - DIV - DIV</xProd><NCM>61042300</NCM><uCom>PC</uCom><CFOP>5102</CFOP></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto></det><total><ICMSTot><vProd>700.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vOutro>0.00</vOutro><vIPI>0.00</vIPI><vST>0.00</vST><vNF>700.00</vNF></ICMSTot></total><ide><tpNF>1</tpNF><mod>55</mod><nNF>1051</nNF><serie>1</serie><dhEmi>2026-10-13T15:57:33-03:00</dhEmi></ide><emit><xNome>FORNECEDOR TESTE LTDA</xNome><CNPJ>11222333000181</CNPJ></emit><dest><xNome>CLIENTE TESTE LTDA</xNome><CNPJ>11444777000161</CNPJ></dest></infNFe></NFe></nfeProc>
```

`nfe-sefaz.xml` (oficial: `<det nItem="1">`, `Signature`, frete só no total, GTIN, `uCom = CX`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe26261011222333000181550010000010511000030324" versao="4.00"><ide><mod>55</mod><serie>1</serie><nNF>1051</nNF><dhEmi>2026-10-13T15:57:33-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>11222333000181</CNPJ><xNome>FORNECEDOR TESTE LTDA</xNome><enderEmit><xLgr>Rua A</xLgr></enderEmit></emit><dest><CNPJ>11444777000161</CNPJ><xNome>CLIENTE TESTE LTDA</xNome></dest><det nItem="1"><prod><cProd>CX-12</cProd><cEAN>7891234567895</cEAN><xProd>Meia soquete</xProd><NCM>61159500</NCM><CFOP>6102</CFOP><uCom>CX</uCom><qCom>2.0000</qCom><vProd>240.00</vProd><vSeg>1.00</vSeg><vDesc>4.00</vDesc><vOutro>2.00</vOutro></prod><imposto><ICMS><ICMS10><orig>2</orig><vICMSST>3.00</vICMSST></ICMS10></ICMS><IPI><IPITrib><vIPI>6.00</vIPI></IPITrib></IPI></imposto></det><total><ICMSTot><vProd>240.00</vProd><vFrete>12.00</vFrete><vSeg>1.00</vSeg><vDesc>4.00</vDesc><vOutro>2.00</vOutro><vIPI>6.00</vIPI><vST>3.00</vST><vNF>260.00</vNF></ICMSTot></total></infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/></Signature></NFe><protNFe versao="4.00"><infProt><chNFe>26261011222333000181550010000010511000030324</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>
```

- [ ] **Step 2: Testes que falham**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lerNfe } from '../ler-nfe';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');

describe('lerNfe — exportação de ERP', () => {
  const r = lerNfe(fx('nfe-exportacao-erp.xml'));
  it('lê cabeçalho, totais e marca não assinada', () => {
    if (!r.ok) throw new Error(r.erro);
    expect(r.nota).toMatchObject({
      chave: '26261011222333000181550010000010511000030324', numero: 1051, serie: 1, modelo: 55, tipoNf: 1,
      emitenteCnpj: '11222333000181', emitenteNome: 'FORNECEDOR TESTE LTDA', destinatarioCnpj: '11444777000161',
      assinada: false, cStat: 100, emitidaEm: '2026-10-13T15:57:33-03:00',
      totais: { vProd: 700, vFrete: 0, vNF: 700 },
    });
  });
  it('nItem elemento, SEM GTIN → null, entidade &amp; decodificada', () => {
    if (!r.ok) throw new Error(r.erro);
    expect(r.nota.itens[0]).toEqual({
      nItem: 1, cProd: 'REF 06', xProd: 'Short masculino - DIV - DIV', ncm: '62034900', cfop: '5102',
      gtin: null, uCom: 'PC', qCom: 35, vProd: 350, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, orig: 0,
    });
    expect(r.nota.itens[1].xProd).toBe('Conjunto infantil & bebê - DIV - DIV');
  });
});

describe('lerNfe — XML da SEFAZ', () => {
  const r = lerNfe(fx('nfe-sefaz.xml'));
  it('nItem atributo, assinatura, GTIN válido, ST/IPI no imposto, frete só no total', () => {
    if (!r.ok) throw new Error(r.erro);
    expect(r.nota.assinada).toBe(true);
    expect(r.nota.emitenteNome).toBe('FORNECEDOR TESTE LTDA');
    expect(r.nota.itens[0]).toMatchObject({
      nItem: 1, gtin: '7891234567895', uCom: 'CX', qCom: 2, vProd: 240, vFrete: 0, vSeg: 1,
      vDesc: 4, vOutro: 2, vIPI: 6, vST: 3, orig: 2,
    });
    expect(r.nota.totais).toMatchObject({ vFrete: 12, vNF: 260 });
  });
});

describe('lerNfe — endurecimento (rodada 2 do Codex)', () => {
  const base = fx('nfe-exportacao-erp.xml');
  it('NF-e escondida em comentário não conta como documento', () => {
    expect(lerNfe(`<?xml version="1.0"?><outro><!-- ${base.replace('<?xml version="1.0" encoding="utf-8"?>', '')} --></outro>`).ok).toBe(false);
  });
  it('chNFe do protocolo diferente do Id da infNFe recusa', () => {
    expect(lerNfe(base.replace('<chNFe>26261011222333000181550010000010511000030324</chNFe>',
      '<chNFe>26261011222333000181550010000010511000099991</chNFe>')).ok).toBe(false);
  });
  it('protocolo presente sem cStat recusa (não é "sem protocolo")', () => {
    expect(lerNfe(base.replace('<cStat>100</cStat>', '')).ok).toBe(false);
    expect(lerNfe(base.replace(/<protNFe>[\s\S]*<\/protNFe>/, '<protNFe/>')).ok).toBe(false);
    expect(lerNfe(base.replace(/<protNFe>[\s\S]*<\/protNFe>/, '<protNFe></protNFe>')).ok).toBe(false);
  });
  it('NF-e escondida dentro de uma instrução de processamento não conta', () => {
    const corpo = base.replace('<?xml version="1.0" encoding="utf-8"?>', '');
    expect(lerNfe(`<?xml version="1.0"?><?xml-stylesheet ${corpo} ?><outro/>`).ok).toBe(false);
  });
  it('mais de uma infNFe recusa', () => {
    const dup = base.replace('</NFe>', '</NFe><NFe><infNFe Id="NFe1"></infNFe></NFe>');
    expect(lerNfe(dup).ok).toBe(false);
  });
  it('aceita prefixo de namespace com hífen/ponto (nfe-1:)', () => {
    const pref = base.replace(/<(\/?)([A-Za-z])/g, '<$1nfe-1:$2').replace('<nfe-1:?xml', '<?xml');
    const r = lerNfe(pref);
    if (!r.ok) throw new Error(r.erro);
    expect(r.nota.itens).toHaveLength(2);
  });
});

describe('lerNfe — recusas', () => {
  it('não é NF-e, sem itens, número inválido', () => {
    expect(lerNfe('<?xml version="1.0"?><cteProc/>')).toEqual({ ok: false, erro: expect.stringContaining('NF-e') });
    expect(lerNfe(fx('nfe-exportacao-erp.xml').replace(/<det>[\s\S]*<\/det>/, '')).ok).toBe(false);
    expect(lerNfe(fx('nfe-exportacao-erp.xml').replace('<qCom>35.0000</qCom>', '<qCom>abc</qCom>')).ok).toBe(false);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm test -- supabase/functions/_shared/nfe/__tests__/ler-nfe`
Expected: FAIL.

- [ ] **Step 4: Implementar**

```ts
// ADR-0181 D-2 — leitura do XML da NF-e de compra, pura (front e edge). Extração textual do
// subconjunto da NF-e: aceita o XML da SEFAZ (nItem atributo, Signature) e a exportação de ERP
// (nItem elemento, sem Signature).
// ponytail: não é um parser XML genérico — não trata CDATA nem tags homônimas aninhadas (a NF-e
// não as usa nos campos lidos). Comentários são removidos; exige uma única infNFe; protocolo é
// casado pela chave. Upgrade: parser XML completo se aparecer leiaute fora disso.
import type { ItemNotaLido, NotaCompraLida, TotaisNota } from './tipos.ts';
import { gtinValido } from './regras.ts';

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENT[e]);
// Prefixo de namespace XML válido (NCName): letras, dígitos, '-', '_', '.'.
const PFX = '(?:[A-Za-z_][\\w.-]*:)?';

function blocos(xml: string, tag: string): Array<{ attrs: string; corpo: string }> {
  const re = new RegExp(`<${PFX}${tag}\\b([^>]*)>([\\s\\S]*?)</${PFX}${tag}>`, 'g');
  return Array.from(xml.matchAll(re), (m) => ({ attrs: m[1], corpo: m[2] }));
}
const bloco = (xml: string | null, tag: string): string | null => (xml === null ? null : blocos(xml, tag)[0]?.corpo ?? null);
function texto(xml: string | null, tag: string): string | null {
  if (xml === null) return null;
  const m = xml.match(new RegExp(`<${PFX}${tag}\\b[^>]*>([^<]*)</${PFX}${tag}>`));
  const t = m ? decodificar(m[1]).trim() : '';
  return t === '' ? null : t;
}

class ErroLeitura extends Error {}
function numero(xml: string | null, tag: string, obrigatorio = false): number {
  const t = texto(xml, tag);
  if (t === null) { if (obrigatorio) throw new ErroLeitura(`Campo ${tag} ausente.`); return 0; }
  const n = Number(t);
  if (!Number.isFinite(n)) throw new ErroLeitura(`Campo ${tag} com valor inválido: ${t}.`);
  return n;
}
const obrig = (xml: string | null, tag: string): string => {
  const t = texto(xml, tag);
  if (t === null) throw new ErroLeitura(`Campo ${tag} ausente.`);
  return t;
};

export function lerNfe(entrada: string): { ok: true; nota: NotaCompraLida } | { ok: false; erro: string } {
  try {
    // Comentários e instruções de processamento não são documento: removidos antes de tudo.
    // A declaração XML só vale no início; qualquer outra <?...?> (inclusive <?xml-...?>) é removida.
    const xml = entrada.replace(/^\uFEFF?\s*<\?xml\s[^?]*\?>/, '')
      .replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
    const infs = blocos(xml, 'infNFe');
    if (infs.length === 0) return { ok: false, erro: 'O arquivo não é uma NF-e (falta infNFe).' };
    if (infs.length > 1) return { ok: false, erro: 'O arquivo tem mais de uma NF-e; envie uma nota por arquivo.' };
    const inf = infs[0];
    const chave = inf.attrs.match(/Id="NFe(\d{44})"/)?.[1] ?? '';
    const ide = bloco(inf.corpo, 'ide');
    const emit = bloco(inf.corpo, 'emit');
    const dest = bloco(inf.corpo, 'dest');
    const tot = bloco(inf.corpo, 'ICMSTot');
    // Protocolo é associado à NF-e pela chave; protocolo sem status NÃO é "sem protocolo".
    const temProtocolo = new RegExp(`<${PFX}protNFe\\b`).test(xml);
    const prot = bloco(xml, 'infProt');
    const cStat = texto(prot, 'cStat');
    if (temProtocolo && prot === null) return { ok: false, erro: 'O protocolo de autorização está incompleto.' };
    if (prot !== null) {
      if (cStat === null) return { ok: false, erro: 'O protocolo de autorização está sem status (cStat).' };
      const chProt = texto(prot, 'chNFe');
      if (chProt !== chave) return { ok: false, erro: 'A chave do protocolo não corresponde à chave da NF-e.' };
    }

    const dets = blocos(inf.corpo, 'det');
    if (dets.length === 0) return { ok: false, erro: 'A nota não tem itens.' };
    const itens: ItemNotaLido[] = dets.map((det) => {
      const prod = bloco(det.corpo, 'prod');
      const imposto = bloco(det.corpo, 'imposto');
      const icms = bloco(imposto, 'ICMS');
      const ipi = bloco(imposto, 'IPI');
      const gtin = texto(prod, 'cEAN');
      const orig = texto(icms, 'orig');
      const nItem = Number(det.attrs.match(/nItem="(\d+)"/)?.[1] ?? texto(det.corpo, 'nItem'));
      if (!Number.isInteger(nItem) || nItem < 1) throw new ErroLeitura('Item sem nItem válido.');
      return {
        nItem,
        cProd: obrig(prod, 'cProd'), xProd: obrig(prod, 'xProd'),
        ncm: texto(prod, 'NCM'), cfop: obrig(prod, 'CFOP'),
        gtin: gtin && gtinValido(gtin) ? gtin : null,
        uCom: obrig(prod, 'uCom'), qCom: numero(prod, 'qCom', true),
        vProd: numero(prod, 'vProd', true), vFrete: numero(prod, 'vFrete'), vSeg: numero(prod, 'vSeg'),
        vDesc: numero(prod, 'vDesc'), vOutro: numero(prod, 'vOutro'),
        vIPI: numero(ipi, 'vIPI'), vST: numero(icms, 'vICMSST'),
        orig: orig === null ? null : Number(orig),
      };
    });

    const totais: TotaisNota = {
      vProd: numero(tot, 'vProd', true), vFrete: numero(tot, 'vFrete'), vSeg: numero(tot, 'vSeg'),
      vDesc: numero(tot, 'vDesc'), vOutro: numero(tot, 'vOutro'), vIPI: numero(tot, 'vIPI'),
      vST: numero(tot, 'vST'), vII: numero(tot, 'vII'), vIPIDevol: numero(tot, 'vIPIDevol'),
      vFCPST: numero(tot, 'vFCPST'), vNF: numero(tot, 'vNF', true),
    };
    return {
      ok: true,
      nota: {
        chave,
        numero: numero(ide, 'nNF', true), serie: numero(ide, 'serie', true),
        modelo: numero(ide, 'mod', true), tipoNf: numero(ide, 'tpNF', true),
        emitidaEm: obrig(ide, 'dhEmi'),
        emitenteCnpj: obrig(emit, 'CNPJ'), emitenteNome: obrig(emit, 'xNome'),
        destinatarioCnpj: texto(dest, 'CNPJ') ?? '',
        totais,
        assinada: new RegExp(`<${PFX}Signature\\b`).test(xml),
        cStat: cStat === null ? null : Number(cStat),
        itens,
      },
    };
  } catch (e) {
    if (e instanceof ErroLeitura) return { ok: false, erro: e.message };
    throw e;
  }
}
```

`emit` contém `enderEmit` sem outro `xNome`. Já `texto(emit, 'xNome')` pega a primeira ocorrência, que é a
do emitente. O teste SEFAZ cobre isso.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test -- supabase/functions/_shared/nfe`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/nfe
git commit -m "feat(adr-0181): leitor puro de NF-e de compra (SEFAZ e exportação de ERP)"
```

---

### Task 5: Edge `importar-nota-compra` — o servidor lê o XML

**Files:**
- Create: `supabase/functions/importar-nota-compra/{index.ts,validar.ts,processar.ts}` + `__tests__/{validar,processar}.test.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: Tasks 2, 3, 4; `enfileirarSincronizacaoEstoque` (`_shared/queue.ts:222`).
- Produces:
  - `POST importar-nota-compra` com body `{ xml: string; decisoes: DecisaoImportacao[] }` → 200 `{ notaId; duplicada; pushOk }` | 400 `{ error }` | 403 `{ error }`.
  - `POST importar-nota-compra` com body `{ reenviarPush: { chave: string } }` → 200 `{ pushOk }`. Reenfileira o push dos produtos tocados pela nota (importação **ou** desfazer), sem nenhuma movimentação. É a recuperação quando `pushOk` veio `false` (N-I3).
  - `reenviarPush(deps: Pick<DepsImportacao, 'enfileirar'> & { codigosDaNota(orgId: string, chave: string): Promise<string[]>; statusDaNota(orgId: string, chave: string): Promise<string | null> }, orgId: string, chave: string): Promise<{ pushOk: boolean }>`
  - **Reativação (R3-B4):** `reativar = (status da nota === 'importada')`. Nota desfeita ou cancelada reenvia o saldo **sem** reativar anúncio pausado (`sincronizar-estoque/processar.ts:348`).
  - O tipo do job em `DepsImportacao.enfileirar` passa a ser `reativar: boolean`. Conferir o tipo aceito por `enfileirarSincronizacaoEstoque` em `_shared/queue.ts:222`.
  - `validarImportacao(body: unknown, cnpjOrg: string): { ok: true; nota: NotaCompraLida; itens: ItemConciliado[]; decisoes: DecisaoImportacao[]; xml: string } | { ok: false; erro: string }`
  - `montarItensRpc(itens: ItemConciliado[], decisoes: DecisaoImportacao[]): Record<string, unknown>[]`
  - `processarImportacao(deps: DepsImportacao, p: { orgId; userId; nota; itens; decisoes; xml; sha256: string }): Promise<{ notaId: string; duplicada: boolean; pushOk: boolean }>`

- [ ] **Step 1: Testes de `validar` que falham**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validarImportacao } from '../validar';

const XML = readFileSync(join(__dirname, '../../_shared/nfe/__tests__/fixtures/nfe-exportacao-erp.xml'), 'utf8');
const CNPJ = '11444777000161';
const dec = [
  { nItem: 1, codigoPai: 'P1', fator: 1, distribuicao: [{ codigo: 'S1', quantidade: 35, custoPrecificacao: 14 }] },
  { nItem: 2, codigoPai: 'P2', fator: 1, distribuicao: [{ codigo: 'S2', quantidade: 35, custoPrecificacao: 14 }] },
];

describe('validarImportacao', () => {
  it('aceita e deriva os dados do XML, não do navegador', () => {
    const r = validarImportacao({ xml: XML, decisoes: dec, nota: { destinatarioCnpj: CNPJ, itens: [] } }, CNPJ);
    if (!r.ok) throw new Error(r.erro);
    expect(r.nota.itens).toHaveLength(2);
    expect(r.itens[0].qCom).toBe(35);
  });
  it('corpo malformado não lança: devolve erro', () => {
    for (const b of [null, {}, { xml: 1 }, { xml: XML, decisoes: 'x' }, { xml: XML, decisoes: [{ nItem: 'a' }] }]) {
      expect(validarImportacao(b, CNPJ).ok).toBe(false);
    }
  });
  it('destinatário diferente da empresa recusa', () => {
    expect(validarImportacao({ xml: XML, decisoes: dec }, '99999999000191'))
      .toEqual({ ok: false, erro: expect.stringMatching(/destinat/i) });
  });
  it('chave com DV inválido, cStat ≠ 100, modelo ≠ 55, tipo ≠ saída recusam', () => {
    const casos = [
      XML.replaceAll('030324', '030325'),
      XML.replace('<cStat>100</cStat>', '<cStat>101</cStat>'),
      XML.replace('<mod>55</mod>', '<mod>65</mod>'),
      XML.replace('<tpNF>1</tpNF>', '<tpNF>0</tpNF>'),
    ];
    for (const x of casos) expect(validarImportacao({ xml: x, decisoes: dec }, CNPJ).ok).toBe(false);
  });
  it('CFOP fora da lista recusa nomeando o item', () => {
    expect(validarImportacao({ xml: XML.replace('<CFOP>5102</CFOP>', '<CFOP>5910</CFOP>'), decisoes: dec }, CNPJ))
      .toEqual({ ok: false, erro: expect.stringMatching(/item 1.*5910/i) });
  });
  it('totais incoerentes recusam', () => {
    expect(validarImportacao({ xml: XML.replace('<vProd>700.00</vProd>', '<vProd>650.00</vProd>'), decisoes: dec }, CNPJ).ok).toBe(false);
  });
  it('vNF divergente: recusa sem aceite, segue com aceite e devolve a diferença', () => {
    const x = XML.replace('<vNF>700.00</vNF>', '<vNF>705.00</vNF>');
    expect(validarImportacao({ xml: x, decisoes: dec }, CNPJ)).toEqual({ ok: false, erro: expect.stringMatching(/difere/) });
    const r = validarImportacao({ xml: x, decisoes: dec, aceitarDivergenciaTotal: true }, CNPJ);
    expect(r.ok && r.divergenciaTotal).toBe(5);
  });
  it('item sem decisão, decisão repetida ou de item inexistente recusam', () => {
    expect(validarImportacao({ xml: XML, decisoes: [dec[0]] }, CNPJ).ok).toBe(false);
    expect(validarImportacao({ xml: XML, decisoes: [dec[0], dec[0], dec[1]] }, CNPJ).ok).toBe(false);
    expect(validarImportacao({ xml: XML, decisoes: [...dec, { ...dec[0], nItem: 9 }] }, CNPJ).ok).toBe(false);
  });
  it('distribuição que não fecha com a quantidade convertida recusa', () => {
    const d = [{ ...dec[0], fator: 2 }, dec[1]];
    expect(validarImportacao({ xml: XML, decisoes: d }, CNPJ))
      .toEqual({ ok: false, erro: expect.stringMatching(/35 de 70/) });
  });
  it('XML acima de 1 MB recusa', () => {
    expect(validarImportacao({ xml: XML + ' '.repeat(1_048_577), decisoes: dec }, CNPJ).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- supabase/functions/importar-nota-compra`
Expected: FAIL.

- [ ] **Step 3: Implementar `validar.ts`**

```ts
// ADR-0181 D-2 — o servidor lê o próprio XML; do navegador só vêm as decisões do operador.
import { lerNfe } from '../_shared/nfe/ler-nfe.ts';
import {
  chaveNfeValida, cfopAceito, conciliarItens, quantidadeEmEstoque, erroDistribuicao,
} from '../_shared/nfe/regras.ts';
import type { DecisaoImportacao, ItemConciliado, NotaCompraLida } from '../_shared/nfe/tipos.ts';

const TETO_XML = 1_048_576;
const ehTexto = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const ehNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function decisoesValidas(v: unknown): DecisaoImportacao[] | null {
  if (!Array.isArray(v)) return null;
  const out: DecisaoImportacao[] = [];
  for (const d of v as Array<Record<string, unknown>>) {
    if (!d || !ehNum(d.nItem) || !ehTexto(d.codigoPai) || !ehNum(d.fator) || !Array.isArray(d.distribuicao)) return null;
    const dist = [];
    for (const l of d.distribuicao as Array<Record<string, unknown>>) {
      if (!l || !ehTexto(l.codigo) || !ehNum(l.quantidade) || !ehNum(l.custoPrecificacao)) return null;
      dist.push({ codigo: l.codigo.trim(), quantidade: l.quantidade, custoPrecificacao: l.custoPrecificacao });
    }
    out.push({ nItem: d.nItem, codigoPai: d.codigoPai.trim(), fator: d.fator, distribuicao: dist });
  }
  return out;
}

export function validarImportacao(
  body: unknown, cnpjOrg: string,
): { ok: true; nota: NotaCompraLida; itens: ItemConciliado[]; decisoes: DecisaoImportacao[]; xml: string; divergenciaTotal: number } | { ok: false; erro: string } {
  const b = (body ?? {}) as { xml?: unknown; decisoes?: unknown };
  if (typeof b.xml !== 'string') return { ok: false, erro: 'Envie o XML da nota.' };
  if (b.xml.length > TETO_XML) return { ok: false, erro: 'O XML passa de 1 MB.' };
  const decisoes = decisoesValidas(b.decisoes);
  if (!decisoes) return { ok: false, erro: 'Decisões por item em formato inválido.' };

  const aceitarDivergencia = (body as { aceitarDivergenciaTotal?: unknown })?.aceitarDivergenciaTotal === true;
  const lida = lerNfe(b.xml);
  if (!lida.ok) return { ok: false, erro: lida.erro };
  const nota = lida.nota;
  if (!chaveNfeValida(nota.chave)) return { ok: false, erro: 'Chave de acesso inválida (dígito verificador).' };
  if (nota.modelo !== 55) return { ok: false, erro: 'Só NF-e modelo 55 é aceita.' };
  if (nota.tipoNf !== 1) return { ok: false, erro: 'A nota precisa ser de saída do fornecedor (venda).' };
  if (nota.cStat !== null && nota.cStat !== 100) return { ok: false, erro: `A nota não está autorizada (cStat ${nota.cStat}).` };
  if (nota.destinatarioCnpj.replace(/\D/g, '') !== cnpjOrg.replace(/\D/g, '')) {
    return { ok: false, erro: 'O destinatário da nota não é o CNPJ desta empresa.' };
  }
  for (const i of nota.itens) {
    if (!cfopAceito(i.cfop)) return { ok: false, erro: `Item ${i.nItem}: CFOP ${i.cfop} não é de venda/revenda — nota recusada.` };
  }
  const conc = conciliarItens(nota);
  if (!conc.ok) return { ok: false, erro: conc.erro };
  if (conc.divergenciaTotal !== 0 && !aceitarDivergencia) {
    return { ok: false, erro: `${conc.avisoTotal} Marque a confirmação de divergência para seguir.` };
  }

  const porItem = new Map(decisoes.map((d) => [d.nItem, d]));
  if (porItem.size !== decisoes.length) return { ok: false, erro: 'Decisão repetida para o mesmo item.' };
  for (const d of decisoes) {
    if (!nota.itens.some((i) => i.nItem === d.nItem)) return { ok: false, erro: `Item ${d.nItem} não existe na nota.` };
  }
  for (const item of conc.itens) {
    const d = porItem.get(item.nItem);
    if (!d) return { ok: false, erro: `Item ${item.nItem} (${item.xProd}) está sem produto definido.` };
    const q = quantidadeEmEstoque(item.qCom, d.fator);
    if (!q.ok) return { ok: false, erro: `Item ${item.nItem}: ${q.erro}` };
    const e = erroDistribuicao(q.quantidade, d.distribuicao);
    if (e) return { ok: false, erro: `Item ${item.nItem}: ${e}` };
  }
  return { ok: true, nota, itens: conc.itens, decisoes, xml: b.xml, divergenciaTotal: conc.divergenciaTotal };
}
```

- [ ] **Step 4: Testes de `processar` que falham**

```ts
import { describe, it, expect } from 'vitest';
import { processarImportacao, montarItensRpc, reenviarPush, type DepsImportacao } from '../processar';
import type { NotaCompraLida, ItemConciliado, DecisaoImportacao } from '../../_shared/nfe/tipos';

const item: ItemConciliado = { nItem: 1, cProd: 'REF 06', xProd: 'Short', ncm: '62034900', cfop: '5102', gtin: null,
  uCom: 'PC', qCom: 3, vProd: 100, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, orig: 0, rateio: {} };
const nota = { chave: '26261011222333000181550010000010511000030324', numero: 1051, serie: 1,
  emitenteCnpj: '11222333000181', emitenteNome: 'F', emitidaEm: '2026-10-13T15:57:33-03:00',
  totais: { vNF: 100 }, assinada: false } as unknown as NotaCompraLida;
const decisoes: DecisaoImportacao[] = [{ nItem: 1, codigoPai: 'P1', fator: 1,
  distribuicao: [{ codigo: 'S1', quantidade: 3, custoPrecificacao: 40 }] }];
const P = { orgId: 'org-1', userId: 'u', nota, itens: [item], decisoes, xml: '<x/>', sha256: 'h1', divergenciaTotal: 0 };

function deps(over: Partial<DepsImportacao> = {}) {
  const log: string[] = [];
  const jobs: string[] = [];
  const d: DepsImportacao = {
    notaExistente: async () => { log.push('existe?'); return null; },
    upload: async (path) => { log.push(`upload:${path}`); return 'criado'; },
    rpc: async () => { log.push('rpc'); return { data: { nota_id: 'n1', duplicada: false, codigos_pai: ['P1', 'P2'] }, error: null }; },
    enfileirar: async (job) => { jobs.push(job.codigo_pai); return 'm'; },
    ...over,
  };
  return { d, log, jobs };
}

describe('montarItensRpc', () => {
  it('custo de aquisição exato (100/3) e precificação informada; rateio vai junto', () => {
    const [i] = montarItensRpc([item], decisoes);
    const dist = (i.distribuicao as Array<Record<string, number>>)[0];
    expect(dist.custo_aquisicao_unit).toBeCloseTo(33.333333, 6);
    expect(dist.custo_precificacao_unit).toBe(40);
    expect(i).toMatchObject({ n_item: 1, cprod: 'REF 06', codigo_pai: 'P1', fator_conversao: 1, rateio: {} });
  });
});

describe('processarImportacao', () => {
  it('confere existência, sobe XML endereçado pelo hash, chama RPC e enfileira todos os produtos', async () => {
    const { d, log, jobs } = deps();
    const r = await processarImportacao(d, P);
    expect(log).toEqual(['existe?', `upload:org-1/${nota.chave}/h1.xml`, 'rpc']);
    expect(jobs).toEqual(['P1', 'P2']);
    expect(r).toEqual({ notaId: 'n1', duplicada: false, pushOk: true });
  });
  it('nota já importada: NÃO sobe XML de novo, chama a RPC (devolve duplicada) e reenfileira push', async () => {
    const { d, log } = deps({
      notaExistente: async () => ({ status: 'importada' }),
      rpc: async () => ({ data: { nota_id: 'n1', duplicada: true, codigos_pai: ['P1'] }, error: null }),
    });
    const r = await processarImportacao(d, P);
    expect(log.some((l) => l.startsWith('upload'))).toBe(false);
    expect(r.duplicada).toBe(true);
  });
  it('nota desfeita/cancelada: recusa sem subir nem chamar RPC', async () => {
    const { d, log } = deps({ notaExistente: async () => ({ status: 'desfeita' }) });
    await expect(processarImportacao(d, P)).rejects.toThrow(/desfeita/);
    expect(log).toEqual([]);
  });
  it('objeto já existe no storage (mesmo hash = mesmo conteúdo): segue para a RPC sem sobrescrever', async () => {
    const { d, log } = deps({ upload: async () => 'ja_existia' });
    const r = await processarImportacao(d, P);
    expect(log).toContain('rpc');
    expect(r.notaId).toBe('n1');
  });
  it('reenviarPush: só enfileira os produtos da nota, sem RPC de estoque', async () => {
    for (const [status, reativa] of [['importada', true], ['desfeita', false], ['cancelada', false]] as const) {
      const jobs: Array<{ codigo_pai: string; reativar: boolean }> = [];
      const r = await reenviarPush({
        codigosDaNota: async () => ['P1', 'P2'],
        statusDaNota: async () => status,
        enfileirar: async (j) => { jobs.push({ codigo_pai: j.codigo_pai, reativar: j.reativar }); return 'm'; },
      }, 'org-1', nota.chave);
      expect(jobs).toEqual([{ codigo_pai: 'P1', reativar: reativa }, { codigo_pai: 'P2', reativar: reativa }]);
      expect(r).toEqual({ pushOk: true });
    }
  });
  it('erro da RPC propaga; falha de push dá pushOk=false', async () => {
    await expect(processarImportacao(deps({ rpc: async () => ({ data: null, error: { message: 'x' } }) }).d, P)).rejects.toThrow('x');
    const r = await processarImportacao(deps({ enfileirar: async () => { throw new Error('q'); } }).d, P);
    expect(r.pushOk).toBe(false);
  });
});
```

O `log` do caso "desfeita" fica vazio porque o mock de `notaExistente` foi sobrescrito sem registrar.
Isso é intencional: o teste verifica só que não houve upload nem RPC.

- [ ] **Step 5: Implementar `processar.ts`**

```ts
// ADR-0181 D-3/D-4 — miolo da importação, dependências injetadas.
import { custoAquisicaoUnit } from '../_shared/nfe/regras.ts';
import type { DecisaoImportacao, ItemConciliado, NotaCompraLida } from '../_shared/nfe/tipos.ts';

export interface DepsImportacao {
  notaExistente(orgId: string, chave: string): Promise<{ status: string } | null>;
  /** Sobe SEM sobrescrever: 'ja_existia' quando o objeto já está lá (corrida/retry). */
  upload(path: string, xml: string): Promise<'criado' | 'ja_existia'>;
  rpc(nome: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  enfileirar(job: { org_id: string; codigo_pai: string; canal_origem: null; reativar: boolean }, orgId: string): Promise<string>;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function montarItensRpc(itens: ItemConciliado[], decisoes: DecisaoImportacao[]): Record<string, unknown>[] {
  return itens.map((i) => {
    const d = decisoes.find((x) => x.nItem === i.nItem)!;
    const custo = r6(custoAquisicaoUnit(i, d.fator));
    return {
      n_item: i.nItem, cprod: i.cProd, xprod: i.xProd, ncm: i.ncm, cfop: i.cfop, gtin: i.gtin,
      ucom: i.uCom, qcom: i.qCom, fator_conversao: d.fator,
      v_prod: i.vProd, v_frete: i.vFrete, v_seg: i.vSeg, v_desc: i.vDesc, v_outro: i.vOutro,
      v_ipi: i.vIPI, v_st: i.vST, rateio: i.rateio, orig: i.orig, codigo_pai: d.codigoPai,
      distribuicao: d.distribuicao.map((l) => ({
        codigo: l.codigo, quantidade: l.quantidade,
        custo_aquisicao_unit: custo, custo_precificacao_unit: l.custoPrecificacao,
      })),
    };
  });
}

export async function processarImportacao(
  deps: DepsImportacao,
  p: { orgId: string; userId: string; nota: NotaCompraLida; itens: ItemConciliado[];
       decisoes: DecisaoImportacao[]; xml: string; sha256: string; divergenciaTotal: number },
): Promise<{ notaId: string; duplicada: boolean; pushOk: boolean }> {
  const existente = await deps.notaExistente(p.orgId, p.nota.chave);
  if (existente && existente.status !== 'importada') {
    throw new Error(`Esta nota está ${existente.status} e não pode ser importada de novo.`);
  }
  // Endereçado pelo CONTEÚDO: o path carrega o sha256 do XML que gerou os dados desta chamada.
  // Duas tentativas com XMLs diferentes da mesma chave nunca compartilham objeto, e quem vence a
  // RPC grava o path/hash do próprio arquivo (N-B3). 'ja_existia' = mesmo hash = mesmo conteúdo.
  const xmlPath = `${p.orgId}/${p.nota.chave}/${p.sha256}.xml`;
  if (!existente) await deps.upload(xmlPath, p.xml);

  const { data, error } = await deps.rpc('importar_nota_compra', {
    p_org: p.orgId, p_user: p.userId,
    p_nota: {
      chave: p.nota.chave, numero: p.nota.numero, serie: p.nota.serie,
      emitente_cnpj: p.nota.emitenteCnpj, emitente_nome: p.nota.emitenteNome,
      emitida_em: p.nota.emitidaEm, valor_total: p.nota.totais.vNF, assinada: p.nota.assinada,
      xml_path: xmlPath, xml_sha256: p.sha256,
      divergencia_total_aceita: p.divergenciaTotal === 0 ? null : p.divergenciaTotal,
    },
    p_itens: montarItensRpc(p.itens, p.decisoes),
  });
  if (error) throw new Error(error.message);
  const r = data as { nota_id: string; duplicada: boolean; codigos_pai: string[] };

  let pushOk = true;
  for (const codigoPai of r.codigos_pai) {
    try {
      await deps.enfileirar({ org_id: p.orgId, codigo_pai: codigoPai, canal_origem: null, reativar: true }, p.orgId);
    } catch (e) { pushOk = false; console.error('importar_nota_push_falhou', codigoPai, String(e)); }
  }
  return { notaId: r.nota_id, duplicada: r.duplicada, pushOk };
}

export async function reenviarPush(
  deps: Pick<DepsImportacao, 'enfileirar'> & {
    codigosDaNota(orgId: string, chave: string): Promise<string[]>;
    statusDaNota(orgId: string, chave: string): Promise<string | null>;
  },
  orgId: string, chave: string,
): Promise<{ pushOk: boolean }> {
  // Só a nota ainda importada é reposição (reativa pausado, ADR-0111); desfeita/cancelada só reduz.
  const reativar = (await deps.statusDaNota(orgId, chave)) === 'importada';
  let pushOk = true;
  for (const codigoPai of await deps.codigosDaNota(orgId, chave)) {
    try {
      await deps.enfileirar({ org_id: orgId, codigo_pai: codigoPai, canal_origem: null, reativar }, orgId);
    } catch (e) { pushOk = false; console.error('reenviar_push_falhou', codigoPai, String(e)); }
  }
  return { pushOk };
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm test -- supabase/functions/importar-nota-compra`
Expected: PASS.

- [ ] **Step 7: Implementar `index.ts`**

```ts
// ADR-0181 — importação de NF-e de compra. JWT do app; gate estoque; exige PJ + CNPJ.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { enfileirarSincronizacaoEstoque } from '../_shared/queue.ts';
import { validarImportacao } from './validar.ts';
import { processarImportacao, reenviarPush } from './processar.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let ctx: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ctx = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { userId, orgId } = ctx;
  const admin = adminClient();

  if (!(await exigirModulo(admin, orgId, 'estoque'))) return json({ error: 'Módulo de estoque não habilitado.' }, 403);
  const { data: org } = await admin.from('organizations').select('tipo_pessoa').eq('id', orgId).maybeSingle();
  const { data: emp } = await admin.from('empresa_fiscal').select('cnpj').eq('org_id', orgId).maybeSingle();
  if (org?.tipo_pessoa !== 'pj' || !emp?.cnpj) {
    return json({ error: 'Cadastre o CNPJ da empresa em Configurações › Fiscal antes de importar notas.' }, 403);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const reenvio = (body as { reenviarPush?: { chave?: unknown } })?.reenviarPush;
  if (reenvio) {
    if (typeof reenvio.chave !== 'string' || !/^\d{44}$/.test(reenvio.chave)) return json({ error: 'chave inválida' }, 400);
    const chave = reenvio.chave;
    try {
      const r = await reenviarPush({
        codigosDaNota: async (o, c) => {
          const { data, error } = await admin.rpc('codigos_pai_da_nota', { p_org: o, p_chave: c });
          if (error) throw new Error(error.message);
          return (data as string[] | null) ?? [];
        },
        statusDaNota: async (o, c) => {
          const { data, error } = await admin.from('notas_compra').select('status').eq('org_id', o).eq('chave', c).maybeSingle();
          if (error) throw new Error(error.message);
          return (data?.status as string | undefined) ?? null;
        },
        enfileirar: (job, o) => enfileirarSincronizacaoEstoque(job, o),
      }, orgId, chave);
      await auditarOperacaoSuporte(admin, ctx, { type: 'nota_compra_reenvio', id: chave }, 'succeeded');
      return json(r);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  }

  const v = validarImportacao(body, emp.cnpj as string);
  if (!v.ok) return json({ error: v.erro }, 400);

  try {
    const r = await processarImportacao({
      notaExistente: async (o, chave) => {
        const { data, error } = await admin.from('notas_compra').select('status').eq('org_id', o).eq('chave', chave).maybeSingle();
        if (error) throw new Error(error.message);
        return data as { status: string } | null;
      },
      upload: async (path, xml) => {
        const { error } = await admin.storage.from('notas-compra')
          .upload(path, new Blob([xml], { type: 'application/xml' }), { upsert: false, contentType: 'application/xml' });
        if (!error) return 'criado';
        // Objeto já existe com o MESMO hash no path: mesmo conteúdo (retry/corrida). storage-js 2.108.2
        // (deno.lock:9) devolve "The resource already exists"/"Duplicate" com statusCode 400/409.
        if (/exists|duplicate|409/i.test(`${error.message} ${(error as { statusCode?: string }).statusCode ?? ''}`)) return 'ja_existia';
        throw new Error(`upload do XML: ${error.message}`);
      },
      rpc: async (nome, args) => {
        const { data, error } = await admin.rpc(nome, args);
        return { data, error: error ? { message: error.message } : null };
      },
      enfileirar: (job, o) => enfileirarSincronizacaoEstoque(job, o),
    }, { orgId, userId, nota: v.nota, itens: v.itens, decisoes: v.decisoes, xml: v.xml,
         sha256: await sha256(v.xml), divergenciaTotal: v.divergenciaTotal });
    await auditarOperacaoSuporte(admin, ctx, { type: 'nota_compra', id: v.nota.chave }, 'succeeded');
    return json(r);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
```

Conferir em `entrada-estoque/index.ts` a assinatura real de `enfileirarSincronizacaoEstoque` e de
`auditarOperacaoSuporte`, e deixar as duas chamadas **idênticas** ao uso de lá. Conferir também, no
`@supabase/storage-js` em uso, a mensagem e o `statusCode` de "objeto já existe" (`Duplicate`/`409`).

- [ ] **Step 8: Config, intent-to-add e checagem Deno**

```toml
# ADR-0181 — importação de NF-e de compra (JWT do app, gate estoque).
[functions.importar-nota-compra]
verify_jwt = true
```

```bash
git add -N supabase/functions/importar-nota-compra supabase/functions/_shared/nfe
pnpm lint:functions && pnpm check:functions
```
Expected: sem erros.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/importar-nota-compra supabase/config.toml
git commit -m "feat(adr-0181): edge importar-nota-compra (lê o XML no servidor, arquivo imutável)"
```

---

### Task 6: Edge `desfazer-nota-compra` (admin)

**Files:**
- Create: `supabase/functions/desfazer-nota-compra/{index.ts,validar.ts,processar.ts}` + `__tests__/{validar,processar}.test.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Produces: `POST desfazer-nota-compra` com body `{ notaId: string; status: 'desfeita' | 'cancelada' }` → 200 `{ pushOk: boolean; jaEstava: boolean }` | 400/403.
  - `autorizarDesfazer(ctx: { isAdmin: boolean; support: unknown }): string | null`: devolve a mensagem de recusa, ou null.
  - `validarDesfazer(body: unknown): { ok: true; notaId: string; status: 'desfeita' | 'cancelada' } | { ok: false; erro: string }`
  - `processarDesfazer(deps, p): Promise<{ pushOk: boolean; jaEstava: boolean }>`

- [ ] **Step 1: Testes que falham**

```ts
import { describe, it, expect } from 'vitest';
import { processarDesfazer, type DepsDesfazer } from '../processar';
import { validarDesfazer, autorizarDesfazer } from '../validar';

describe('autorizarDesfazer', () => {
  it('só admin; suporte full (isAdmin=false) e membro comum recusam', () => {
    expect(autorizarDesfazer({ isAdmin: true, support: null })).toBeNull();
    expect(autorizarDesfazer({ isAdmin: false, support: null })).toMatch(/administrador/);
    expect(autorizarDesfazer({ isAdmin: false, support: { access: 'full' } })).toMatch(/administrador/);
  });
});

describe('validarDesfazer', () => {
  it('exige notaId uuid e status válido', () => {
    expect(validarDesfazer({ notaId: '00000000-0000-0000-0000-000000000001', status: 'cancelada' }).ok).toBe(true);
    expect(validarDesfazer({ notaId: 'x', status: 'cancelada' }).ok).toBe(false);
    expect(validarDesfazer({ notaId: '00000000-0000-0000-0000-000000000001', status: 'apagada' }).ok).toBe(false);
    expect(validarDesfazer(null).ok).toBe(false);
  });
});

describe('processarDesfazer', () => {
  it('chama a RPC e enfileira push SEM reativar; repetição (ja_estava) também reenfileira', async () => {
    for (const ja of [false, true]) {
      const jobs: Array<{ codigo_pai: string; reativar: boolean }> = [];
      const d: DepsDesfazer = {
        rpc: async () => ({ data: { codigos_pai: ['P1'], ja_estava: ja }, error: null }),
        enfileirar: async (j) => { jobs.push({ codigo_pai: j.codigo_pai, reativar: j.reativar }); return 'm'; },
      };
      const r = await processarDesfazer(d, { orgId: 'o', userId: 'u', notaId: 'n', status: 'desfeita' });
      expect(jobs).toEqual([{ codigo_pai: 'P1', reativar: false }]);
      expect(r).toEqual({ pushOk: true, jaEstava: ja });
    }
  });
  it('erro de saldo insuficiente propaga', async () => {
    const d: DepsDesfazer = {
      rpc: async () => ({ data: null, error: { message: 'desfazer_nota_compra: saldo insuficiente em 09300002' } }),
      enfileirar: async () => 'm',
    };
    await expect(processarDesfazer(d, { orgId: 'o', userId: 'u', notaId: 'n', status: 'desfeita' })).rejects.toThrow(/saldo/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- supabase/functions/desfazer-nota-compra`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// validar.ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function autorizarDesfazer(ctx: { isAdmin: boolean; support: unknown }): string | null {
  return ctx.isAdmin ? null : 'Só administradores da empresa podem desfazer ou cancelar uma importação.';
}
export function validarDesfazer(body: unknown):
  { ok: true; notaId: string; status: 'desfeita' | 'cancelada' } | { ok: false; erro: string } {
  const b = (body ?? {}) as { notaId?: unknown; status?: unknown };
  if (typeof b.notaId !== 'string' || !UUID.test(b.notaId)) return { ok: false, erro: 'notaId inválido.' };
  if (b.status !== 'desfeita' && b.status !== 'cancelada') return { ok: false, erro: 'status deve ser desfeita ou cancelada.' };
  return { ok: true, notaId: b.notaId, status: b.status };
}
```

```ts
// processar.ts
export interface DepsDesfazer {
  rpc(nome: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  enfileirar(job: { org_id: string; codigo_pai: string; canal_origem: null; reativar: boolean }, orgId: string): Promise<string>;
}
export async function processarDesfazer(
  deps: DepsDesfazer,
  p: { orgId: string; userId: string; notaId: string; status: 'desfeita' | 'cancelada' },
): Promise<{ pushOk: boolean; jaEstava: boolean }> {
  const { data, error } = await deps.rpc('desfazer_nota_compra', {
    p_org: p.orgId, p_user: p.userId, p_nota_id: p.notaId, p_status: p.status,
  });
  if (error) throw new Error(error.message);
  const r = data as { codigos_pai: string[]; ja_estava: boolean };
  let pushOk = true;
  for (const codigoPai of r.codigos_pai) {
    try {
      // R3-B4: desfazer/cancelar só REDUZ saldo — nunca reativa anúncio pausado pelo operador.
      await deps.enfileirar({ org_id: p.orgId, codigo_pai: codigoPai, canal_origem: null, reativar: false }, p.orgId);
    } catch (e) { pushOk = false; console.error('desfazer_nota_push_falhou', codigoPai, String(e)); }
  }
  return { pushOk, jaEstava: r.ja_estava };
}
```

`index.ts`: o mesmo esqueleto da Task 5 (auth `write` e gate de estoque), com estas trocas:
- `const recusa = autorizarDesfazer(ctx); if (recusa) return json({ error: recusa }, 403);`
- valida o corpo com `validarDesfazer` e devolve 400 se falhar;
- chama `processarDesfazer` e depois `auditarOperacaoSuporte(admin, ctx, { type: 'nota_compra', id: notaId }, 'succeeded')`;
- em erro, devolve 400 `{ error: e.message }`.

```toml
# ADR-0181 D-11 — desfazer/cancelar importação de NF-e de compra (admin).
[functions.desfazer-nota-compra]
verify_jwt = true
```

- [ ] **Step 4: Rodar testes e checagem Deno**

```bash
git add -N supabase/functions/desfazer-nota-compra
pnpm test -- supabase/functions/desfazer-nota-compra && pnpm lint:functions && pnpm check:functions
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/desfazer-nota-compra supabase/config.toml
git commit -m "feat(adr-0181): edge desfazer-nota-compra (admin, idempotente)"
```

---

### Task 7: Descrição fiscal no Faturador + CSOSN padrão de revenda

**Files:**
- Modify: `supabase/functions/_shared/canais/fiscal-ml.ts:20-44` e todo chamador que monta `FamiliaFiscalPush` (`grep -rn "montarFiscalInformation\|FamiliaFiscalPush" supabase/functions --include=*.ts`)
- Modify: `supabase/functions/_shared/produto/validar.ts` (`ProdutoEntrada.fiscal.descricaoFiscal`, `montarLinhasProduto`) + espelho `src/lib/produto-entrada.ts`
- Modify: `supabase/functions/atualizar-fiscal-familia/processar.ts:82-88`
- Modify: `src/components/estoque/use-cadastro-produto.ts:73-81` (serializador), `src/components/estoque/etapa-fiscal-form.tsx`, `src/components/estoque/dialog-fiscal-produto.tsx:69,117-125`, `src/components/configuracoes/secao-fiscal.tsx`
- Test: `_shared/canais/__tests__/fiscal-ml.test.ts`, `atualizar-fiscal-familia/__tests__/processar.test.ts`, teste existente de `montarLinhasProduto`, `src/components/estoque/__tests__/` (serializador)

**Interfaces:**
- Produces: `FamiliaFiscalPush.descricao_fiscal: string | null`; `ProdutoEntrada.fiscal.descricaoFiscal?: string | null`.
- **Contrato único (N-I2):** a descrição viaja **sempre dentro do bloco `fiscal`**, como `fiscal.descricaoFiscal`, tanto no `cadastrar-produto` quanto no `atualizar-fiscal-familia`. O `dialog-fiscal-produto.tsx:117` já envia `body.fiscal`, e o processador lê `entrada.fiscal` em `atualizar-fiscal-familia/processar.ts:63`.
- **Semântica de ausência:** chave **ausente** dentro de `fiscal` (cliente antigo) **não altera** a coluna. `null` ou string vazia **limpa**.
- **Sem módulo fiscal:** `cadastrar-produto/index.ts:66` descarta o bloco fiscal inteiro, e a descrição fiscal também **não** é gravada. É intencional: ela só tem efeito no push ao Faturador, que exige o módulo. A Zaven tem o módulo ligado.

- [ ] **Step 1: Testes que falham**

```ts
// fiscal-ml.test.ts
it('title usa descrição fiscal; nula ou vazia cai no nome_pai', () => {
  const base = { nome_pai: 'Short Masculino Tactel Praia', unidade: 'UN', ncm: '62034900', cest: null,
    origem_nfe: 0, fci: null, ex_tipi: null, tributacao_icms: '102' };
  const v = { codigo: 'S1', gtin: null, peso_gramas: null, ml_variation_id: null };
  const t = (d: string | null) => montarFiscalInformation({ ...base, descricao_fiscal: d }, v, { origin_type: 'reseller' }).title;
  expect(t('Short masculino')).toBe('Short masculino');
  expect(t(null)).toBe('Short Masculino Tactel Praia');
  expect(t('  ')).toBe('Short Masculino Tactel Praia');
});
```

```ts
// atualizar-fiscal-familia/__tests__/processar.test.ts — seguir a fábrica de deps do arquivo
it('descricaoFiscal: ausente preserva, null limpa, texto grava com trim, >120 recusa', async () => {
  // 1) body.fiscal sem a chave descricaoFiscal → o update NÃO contém descricao_fiscal
  // 2) body.fiscal.descricaoFiscal: null → update com descricao_fiscal: null
  // 3) body.fiscal.descricaoFiscal: ' Short ' → update com descricao_fiscal: 'Short'
  // 4) body.fiscal.descricaoFiscal: 'x'.repeat(121) → erro de validação em fiscal.descricaoFiscal
});
```

Escrever os 4 casos acima como 4 `expect` concretos, usando o mesmo formato de captura de `update` que o
arquivo já usa. Para o serializador do cadastro, extrair de `use-cadastro-produto.ts` a função pura
`montarPayload` (se ainda não for exportada) e testar que `fiscal.descricaoFiscal` sai com `trim()`, e `null`
quando vazio.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- supabase/functions/_shared/canais supabase/functions/atualizar-fiscal-familia src/components/estoque`
Expected: FAIL.

- [ ] **Step 3: Implementar**

- `fiscal-ml.ts`: acrescentar `descricao_fiscal: string | null` em `FamiliaFiscalPush` e usar
  `title: familia.descricao_fiscal?.trim() || familia.nome_pai`. Em cada chamador encontrado pelo grep,
  incluir `descricao_fiscal` no `select`. Nos testes existentes, acrescentar `descricao_fiscal: null`.
- `_shared/produto/validar.ts`:
  - acrescentar `descricaoFiscal?: string | null` no bloco `fiscal`;
  - validar ≤ 120 depois do `trim`;
  - `montarLinhasProduto` grava `descricao_fiscal: (descricaoFiscal ?? '').trim() || null` só quando o
    bloco fiscal existe.
  - Espelho em `src/lib/produto-entrada.ts`.
- `atualizar-fiscal-familia/processar.ts`: `if ('descricaoFiscal' in entrada.fiscal)`, validar e incluir no
  update. Se a chave não vier dentro de `fiscal`, não mexer.
- `use-cadastro-produto.ts`: o estado `fiscal` ganha `descricaoFiscal` e o serializador inclui
  `descricaoFiscal: fiscal.descricaoFiscal.trim() || null`.
- `etapa-fiscal-form.tsx`:
  - novo `Input` "Descrição na nota fiscal" (`maxLength={120}`), com a ajuda "É o texto que sai na nota de
    venda do Mercado Livre. Vazio = usa o nome do produto.";
  - se `tributacaoIcms` estiver vazio e `empresaFiscal.csosn_padrao_revenda` existir, botão "Usar padrão da
    empresa ({csosn})", que **não** preenche sozinho.
- `dialog-fiscal-produto.tsx`: incluir `descricao_fiscal` no select (`:69`), no estado e no payload
  (`:117-125`).
- `secao-fiscal.tsx`:
  - `Select` "CSOSN padrão de revenda" com `101, 102, 103, 201, 202, 203, 300, 400, 500, 900` e "Não definido";
  - ajuda: "Combine com seu contador. É sugerido no cadastro de produto e sempre pede confirmação.";
  - grava `csosn_padrao_revenda` pelo mesmo caminho de salvar já usado na seção.

- [ ] **Step 4: Rodar testes e build**

Run: `pnpm test -- supabase/functions src/components && pnpm preflight:static`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A supabase/functions src/components src/lib
git commit -m "feat(adr-0181): descrição fiscal ponta a ponta (Faturador ML) e CSOSN padrão de revenda"
```

---

### Task 8: Camada de dados do front + estado puro do assistente

**Files:**
- Create: `src/lib/notas-compra.ts`, `src/components/estoque/importar-nota/estado.ts`
- Test: `src/components/estoque/importar-nota/__tests__/estado.test.ts`
- Modify: `src/lib/queries.ts` (`QK.notasCompra`, `QK.vinculosFornecedor(cnpj)`)

**Interfaces:**
- Consumes: `lerNfe`, `conciliarItens`, `quantidadeEmEstoque`, `erroDistribuicao`, tipos (Tasks 3 e 4).
- Produces:

```ts
// src/lib/notas-compra.ts
export interface Vinculo { cprod: string; codigoPai: string; fator: number }
export interface NotaCompraResumo { id: string; chave: string; numero: number; emitenteNome: string; emitidaEm: string;
  valorTotal: number; status: 'importada' | 'desfeita' | 'cancelada'; assinada: boolean; xmlPath: string }
export async function buscarVinculos(cnpjFornecedor: string): Promise<Vinculo[]>;
export async function produtosPorGtin(gtins: string[]): Promise<Record<string, string[]>>; // gtin → codigo_pai[] (distintos)
export async function statusDaNota(chave: string): Promise<{ status: NotaCompraResumo['status']; importadaEm: string } | null>;
export async function listarNotasCompra(): Promise<NotaCompraResumo[]>;
export async function importarNotaCompra(b: { xml: string; decisoes: DecisaoImportacao[]; aceitarDivergenciaTotal: boolean }): Promise<{ notaId: string; duplicada: boolean; pushOk: boolean }>;
export async function desfazerNotaCompra(notaId: string, status: 'desfeita' | 'cancelada'): Promise<{ pushOk: boolean; jaEstava: boolean }>;
export async function urlXmlNota(xmlPath: string): Promise<string>;
/** Entradas já lançadas com a ref desta nota (variação criada pela D-8), para a retomada (R3-B1). */
export async function entradasPreviasDaNota(chave: string): Promise<Array<{ nItem: number; codigo: string; quantidade: number; custo: number }>>;
export async function reenviarEstoqueNota(chave: string): Promise<{ pushOk: boolean }>;

// estado.ts
export type LinhaEstado = LinhaDistribuicao & { travada?: boolean }; // travada = já está no ledger com a ref da nota
export interface DecisaoItem {
  nItem: number; codigoPai: string | null; fator: number;
  origemVinculo: 'vinculo' | 'gtin' | 'manual' | null;
  candidatosGtin: string[];            // >1 = conflito: operador escolhe (D-6)
  distribuicao: LinhaEstado[];
}
export interface EstadoImportacao {
  nota: NotaCompraLida; itens: ItemConciliado[]; xml: string;
  avisoTotal: string | null; divergenciaTotal: number; aceitarDivergencia: boolean; decisoes: DecisaoItem[];
}
export function recusaInicial(nota: NotaCompraLida, cnpjEmpresa: string, existente: { status: string; importadaEm: string } | null): string | null;
export function estadoInicial(nota: NotaCompraLida, xml: string, vinculos: Vinculo[], porGtin: Record<string, string[]>,
  previas?: Array<{ nItem: number; codigo: string; quantidade: number; custo: number | null }>): EstadoImportacao;
export function aceitarDivergencia(e: EstadoImportacao, aceita: boolean): EstadoImportacao;
export function definirProduto(e: EstadoImportacao, nItem: number, codigoPai: string): EstadoImportacao;
export function definirFator(e: EstadoImportacao, nItem: number, fator: number): EstadoImportacao;
export function definirDistribuicao(e: EstadoImportacao, nItem: number, linhas: LinhaDistribuicao[]): EstadoImportacao;
export function pendencias(e: EstadoImportacao): Array<{ nItem: number; erro: string }>;
export function payload(e: EstadoImportacao): { xml: string; decisoes: DecisaoImportacao[]; aceitarDivergenciaTotal: boolean };
```

Regras:
- `estadoInicial` chama `conciliarItens`. Se falhar, lança, e o diálogo mostra a mensagem.
- **Retomada (R3-B1):** `previas` (de `entradasPreviasDaNota`, que lê `estoque_movimentos` com
  `referencia_externa like 'nfe:{chave}:%'` e extrai `nItem` e `codigo` da ref) entram como linhas
  `travada: true` no item correspondente. `definirProduto` **preserva** as linhas travadas, e
  `definirDistribuicao` também. Numa linha travada, **SKU e quantidade** ficam fixos e o **custo de
  precificação é editável**: uma linha recebida com o mesmo SKU atualiza só o custo (R4-B1; o ledger aceita
  custo nulo, `20260729084329_e6b_estoque_movimentos.sql:21`). Custo prévio nulo nasce com o custo de
  aquisição do item, com 2 casas. A trava da UI é conveniência; a garantia é a checagem da RPC (Task 2).
- **Divergência de `vNF`:** com `divergenciaTotal ≠ 0` e sem `aceitarDivergencia`, há uma pendência
  (`nItem: 0`): "Confirme a divergência do total da nota".
- A ordem do vínculo é: vínculo salvo → GTIN com **exatamente 1** produto candidato → nenhum.
- GTIN com 2 ou mais produtos candidatos deixa `codigoPai = null` e preenche `candidatosGtin`. A pendência é
  "GTIN casa com N produtos — escolha".
- `produtosPorGtin` é uma consulta org-scoped por RLS:
  `supabase.from('variacoes').select('gtin, familias!inner(codigo_pai)').in('gtin', gtins)`. Agrupa os
  `codigo_pai` distintos por GTIN e considera só GTIN válido (`gtinValido`). A consulta em lote faz chunk de
  200 GTINs.

- [ ] **Step 1: Testes que falham**

```ts
import { describe, it, expect } from 'vitest';
import { estadoInicial, definirProduto, definirFator, definirDistribuicao, pendencias, payload, recusaInicial, aceitarDivergencia } from '../estado';
import type { NotaCompraLida } from '../../../../../supabase/functions/_shared/nfe/tipos';

const zero = { vProd: 590, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vII: 0, vIPIDevol: 0, vFCPST: 0, vNF: 590 };
const nota: NotaCompraLida = {
  chave: '26261011222333000181550010000010511000030324', numero: 1, serie: 1, modelo: 55, tipoNf: 1,
  emitidaEm: '2026-10-13T00:00:00-03:00', emitenteCnpj: '11222333000181', emitenteNome: 'F',
  destinatarioCnpj: '11444777000161', totais: zero, assinada: false, cStat: 100,
  itens: [
    { nItem: 1, cProd: 'REF 06', xProd: 'Short', ncm: null, cfop: '5102', gtin: null, uCom: 'PC', qCom: 35,
      vProd: 350, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, orig: 0 },
    { nItem: 2, cProd: 'X9', xProd: 'Meia', ncm: null, cfop: '5102', gtin: '7891234567895', uCom: 'CX', qCom: 2,
      vProd: 240, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, orig: 0 },
  ],
};

describe('recusaInicial', () => {
  it('destinatário, CFOP, já importada e desfeita', () => {
    expect(recusaInicial(nota, '11444777000161', null)).toBeNull();
    expect(recusaInicial(nota, '99999999000191', null)).toMatch(/destinatário/);
    expect(recusaInicial({ ...nota, itens: [{ ...nota.itens[0], cfop: '5910' }] }, '11444777000161', null)).toMatch(/5910/);
    expect(recusaInicial(nota, '11444777000161', { status: 'importada', importadaEm: '2026-10-14T10:00:00Z' })).toMatch(/já foi importada em 14\/10/);
    expect(recusaInicial(nota, '11444777000161', { status: 'desfeita', importadaEm: '2026-10-14T10:00:00Z' })).toMatch(/desfeita/);
  });
});

describe('estado da importação', () => {
  it('vínculo pré-seleciona; GTIN único casa; GTIN ambíguo vira conflito', () => {
    const e = estadoInicial(nota, '<x/>', [{ cprod: 'REF 06', codigoPai: 'P1', fator: 1 }], { '7891234567895': ['P2'] });
    expect(e.decisoes[0]).toMatchObject({ codigoPai: 'P1', origemVinculo: 'vinculo' });
    expect(e.decisoes[1]).toMatchObject({ codigoPai: 'P2', origemVinculo: 'gtin' });
    const amb = estadoInicial(nota, '<x/>', [], { '7891234567895': ['P2', 'P3'] });
    expect(amb.decisoes[1]).toMatchObject({ codigoPai: null, candidatosGtin: ['P2', 'P3'] });
    expect(pendencias(amb).find((p) => p.nItem === 2)?.erro).toMatch(/2 produtos/);
  });
  it('distribuição usa a quantidade convertida e aceita SKU de outro produto', () => {
    let e = estadoInicial(nota, '<x/>', [], {});
    e = definirProduto(e, 2, 'P2'); e = definirFator(e, 2, 12);
    e = definirDistribuicao(e, 2, [{ codigo: 'S2', quantidade: 20, custoPrecificacao: 10 }]);
    expect(pendencias(e).find((p) => p.nItem === 2)?.erro).toMatch(/20 de 24/);
    e = definirDistribuicao(e, 2, [{ codigo: 'S2', quantidade: 20, custoPrecificacao: 10 },
                                   { codigo: 'OUTRO-PRODUTO-1', quantidade: 4, custoPrecificacao: 10 }]);
    expect(pendencias(e).find((p) => p.nItem === 2)).toBeUndefined();
  });
  it('trocar o produto zera a distribuição, mas preserva o que já está no ledger (travado)', () => {
    let e = estadoInicial(nota, '<x/>', [], {}, [{ nItem: 1, codigo: 'S9', quantidade: 5, custo: 10 }]);
    e = definirProduto(e, 1, 'P1');
    e = definirDistribuicao(e, 1, [{ codigo: 'S1', quantidade: 30, custoPrecificacao: 10 }]);
    e = definirProduto(e, 1, 'P9');
    expect(e.decisoes[0].distribuicao).toEqual([{ codigo: 'S9', quantidade: 5, custoPrecificacao: 10, travada: true }]);
    // e a pendência cobra só o restante: 5 de 35
    expect(pendencias(e).find((p) => p.nItem === 1)?.erro).toMatch(/5 de 35/);
  });
  it('linha travada com custo nulo: nasce com o custo de aquisição e o custo é editável; quantidade não', () => {
    let e = estadoInicial(nota, '<x/>', [], {}, [{ nItem: 1, codigo: 'S9', quantidade: 5, custo: null }]);
    expect(e.decisoes[0].distribuicao[0]).toMatchObject({ codigo: 'S9', quantidade: 5, custoPrecificacao: 10, travada: true });
    e = definirProduto(e, 1, 'P1');
    e = definirDistribuicao(e, 1, [{ codigo: 'S9', quantidade: 99, custoPrecificacao: 12 },
                                   { codigo: 'S1', quantidade: 30, custoPrecificacao: 10 }]);
    expect(e.decisoes[0].distribuicao).toEqual([
      { codigo: 'S9', quantidade: 5, custoPrecificacao: 12, travada: true },
      { codigo: 'S1', quantidade: 30, custoPrecificacao: 10 }]);
    expect(pendencias(e).find((p) => p.nItem === 1)).toBeUndefined();
  });
  it('divergência de vNF vira pendência até o aceite e segue no payload', () => {
    const div = { ...nota, totais: { ...nota.totais, vNF: 600 } };
    let e = estadoInicial(div, '<x/>', [], {});
    expect(pendencias(e).some((p) => p.nItem === 0)).toBe(true);
    e = aceitarDivergencia(e, true);
    expect(pendencias(e).some((p) => p.nItem === 0)).toBe(false);
  });
  it('payload só sai sem pendências e contém só decisões (não a nota)', () => {
    let e = estadoInicial(nota, '<x/>', [], {});
    expect(() => payload(e)).toThrow(/pendên/);
    e = definirProduto(e, 1, 'P1');
    e = definirDistribuicao(e, 1, [{ codigo: 'S1', quantidade: 35, custoPrecificacao: 10 }]);
    e = definirProduto(e, 2, 'P2'); e = definirFator(e, 2, 12);
    e = definirDistribuicao(e, 2, [{ codigo: 'S2', quantidade: 24, custoPrecificacao: 10 }]);
    expect(payload(e)).toEqual({ xml: '<x/>', aceitarDivergenciaTotal: false, decisoes: [
      { nItem: 1, codigoPai: 'P1', fator: 1, distribuicao: [{ codigo: 'S1', quantidade: 35, custoPrecificacao: 10 }] },
      { nItem: 2, codigoPai: 'P2', fator: 12, distribuicao: [{ codigo: 'S2', quantidade: 24, custoPrecificacao: 10 }] },
    ] });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- src/components/estoque/importar-nota`
Expected: FAIL.

- [ ] **Step 3: Implementar `estado.ts`**

```ts
// ADR-0181 — estado puro do assistente de importação (sem React).
import { cfopAceito, conciliarItens, custoAquisicaoUnit, quantidadeEmEstoque, erroDistribuicao } from '../../../../supabase/functions/_shared/nfe/regras.ts';
import type { DecisaoImportacao, ItemConciliado, LinhaDistribuicao, NotaCompraLida } from '../../../../supabase/functions/_shared/nfe/tipos.ts';
import type { Vinculo } from '@/lib/notas-compra';

export type LinhaEstado = LinhaDistribuicao & { travada?: boolean };
export interface DecisaoItem {
  nItem: number; codigoPai: string | null; fator: number;
  origemVinculo: 'vinculo' | 'gtin' | 'manual' | null; candidatosGtin: string[]; distribuicao: LinhaEstado[];
}
export interface EstadoImportacao {
  nota: NotaCompraLida; itens: ItemConciliado[]; xml: string;
  avisoTotal: string | null; divergenciaTotal: number; aceitarDivergencia: boolean; decisoes: DecisaoItem[];
}

const dataBR = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

export function recusaInicial(
  nota: NotaCompraLida, cnpjEmpresa: string, existente: { status: string; importadaEm: string } | null,
): string | null {
  if (nota.destinatarioCnpj.replace(/\D/g, '') !== cnpjEmpresa.replace(/\D/g, '')) {
    return 'O destinatário da nota não é o CNPJ desta empresa.';
  }
  const ruim = nota.itens.find((i) => !cfopAceito(i.cfop));
  if (ruim) return `Item ${ruim.nItem}: CFOP ${ruim.cfop} não é de venda/revenda — nota recusada.`;
  if (existente?.status === 'importada') return `Esta nota já foi importada em ${dataBR(existente.importadaEm)}.`;
  if (existente) return `Esta nota está ${existente.status} e não pode ser importada de novo.`;
  return null;
}

export function estadoInicial(
  nota: NotaCompraLida, xml: string, vinculos: Vinculo[], porGtin: Record<string, string[]>,
  previas: Array<{ nItem: number; codigo: string; quantidade: number; custo: number | null }> = [],
): EstadoImportacao {
  const conc = conciliarItens(nota);
  if (!conc.ok) throw new Error(conc.erro);
  const porCprod = new Map(vinculos.map((v) => [v.cprod, v]));
  const custoDefault = (nItem: number) => {
    const it = conc.itens.find((i) => i.nItem === nItem)!;
    return Math.round(custoAquisicaoUnit(it, porCprod.get(it.cProd)?.fator ?? 1) * 100) / 100;
  };
  const travadas = (nItem: number): LinhaEstado[] => previas.filter((p) => p.nItem === nItem)
    .map((p) => ({ codigo: p.codigo, quantidade: p.quantidade, travada: true,
      custoPrecificacao: p.custo !== null && p.custo > 0 ? p.custo : custoDefault(nItem) }));
  return {
    nota, itens: conc.itens, xml, avisoTotal: conc.avisoTotal,
    divergenciaTotal: conc.divergenciaTotal, aceitarDivergencia: false,
    decisoes: nota.itens.map((i) => {
      const base = { nItem: i.nItem, fator: 1, candidatosGtin: [] as string[], distribuicao: travadas(i.nItem) };
      const v = porCprod.get(i.cProd);
      if (v) return { ...base, codigoPai: v.codigoPai, fator: v.fator, origemVinculo: 'vinculo' as const };
      const cands = i.gtin ? (porGtin[i.gtin] ?? []) : [];
      if (cands.length === 1) return { ...base, codigoPai: cands[0], origemVinculo: 'gtin' as const };
      return { ...base, codigoPai: null, origemVinculo: null, candidatosGtin: cands };
    }),
  };
}

const mudar = (e: EstadoImportacao, nItem: number, f: (d: DecisaoItem) => DecisaoItem): EstadoImportacao =>
  ({ ...e, decisoes: e.decisoes.map((d) => (d.nItem === nItem ? f(d) : d)) });

const soTravadas = (l: LinhaEstado[]) => l.filter((x) => x.travada);
export const definirProduto = (e: EstadoImportacao, nItem: number, codigoPai: string) =>
  mudar(e, nItem, (d) => (d.codigoPai === codigoPai ? d
    : { ...d, codigoPai, origemVinculo: 'manual', candidatosGtin: [], distribuicao: soTravadas(d.distribuicao) }));
export const definirFator = (e: EstadoImportacao, nItem: number, fator: number) => mudar(e, nItem, (d) => ({ ...d, fator }));
// Linhas travadas (já no ledger) são sempre preservadas com SKU e quantidade; de uma linha recebida com o
// mesmo código só se aproveita o custo de precificação (R4-B1).
export const definirDistribuicao = (e: EstadoImportacao, nItem: number, linhas: LinhaDistribuicao[]) =>
  mudar(e, nItem, (d) => {
    const porCod = new Map(linhas.map((l) => [l.codigo, l]));
    const fixas = soTravadas(d.distribuicao).map((f) =>
      ({ ...f, custoPrecificacao: porCod.get(f.codigo)?.custoPrecificacao ?? f.custoPrecificacao }));
    const cods = new Set(fixas.map((f) => f.codigo));
    return { ...d, distribuicao: [...fixas, ...linhas.filter((l) => !cods.has(l.codigo))] };
  });
export const aceitarDivergencia = (e: EstadoImportacao, aceita: boolean): EstadoImportacao => ({ ...e, aceitarDivergencia: aceita });

export function pendencias(e: EstadoImportacao): Array<{ nItem: number; erro: string }> {
  const out: Array<{ nItem: number; erro: string }> = [];
  if (e.divergenciaTotal !== 0 && !e.aceitarDivergencia) {
    out.push({ nItem: 0, erro: `Confirme a divergência do total da nota (R$ ${e.divergenciaTotal.toFixed(2)}).` });
  }
  for (const d of e.decisoes) {
    const item = e.itens.find((i) => i.nItem === d.nItem)!;
    if (!d.codigoPai) {
      out.push({ nItem: d.nItem, erro: d.candidatosGtin.length > 1
        ? `O GTIN casa com ${d.candidatosGtin.length} produtos — escolha qual.` : 'Escolha ou cadastre o produto.' });
      continue;
    }
    const q = quantidadeEmEstoque(item.qCom, d.fator);
    if (!q.ok) { out.push({ nItem: d.nItem, erro: q.erro }); continue; }
    const err = erroDistribuicao(q.quantidade, d.distribuicao);
    if (err) out.push({ nItem: d.nItem, erro: err });
  }
  return out;
}

export function payload(e: EstadoImportacao): { xml: string; decisoes: DecisaoImportacao[]; aceitarDivergenciaTotal: boolean } {
  if (pendencias(e).length > 0) throw new Error('Há pendências na importação.');
  return {
    xml: e.xml, aceitarDivergenciaTotal: e.aceitarDivergencia,
    decisoes: e.decisoes.map((d) => ({
      nItem: d.nItem, codigoPai: d.codigoPai!, fator: d.fator,
      distribuicao: d.distribuicao.map(({ codigo, quantidade, custoPrecificacao }) => ({ codigo, quantidade, custoPrecificacao })),
    })),
  };
}
```

- [ ] **Step 4: Implementar `src/lib/notas-compra.ts`**

Usar o client e os helpers que `src/lib/produtos-saldo.ts` já importa: o mesmo caminho de `supabase`,
`erroDaEdge` de `@/lib/edge-erro` e `signedUrl` de `@/lib/storage`. Funções:
- **`buscarVinculos`:** `from('vinculos_fornecedor').select('cprod, codigo_pai, fator_conversao').eq('cnpj_fornecedor', cnpj)`.
- **`produtosPorGtin`:** como descrito acima, com chunk de 200.
- **`statusDaNota`:** `from('notas_compra').select('status, importada_em').eq('chave', chave).maybeSingle()`.
- **`listarNotasCompra`:** `order('emitida_em', { ascending: false }).limit(200)`.
- **`importarNotaCompra`**, **`desfazerNotaCompra`** e **`reenviarEstoqueNota`** (`invoke('importar-nota-compra', { body: { reenviarPush: { chave } } })`): `supabase.functions.invoke(...)`; em erro, `throw await erroDaEdge(error)`.
- **`entradasPreviasDaNota`:** `from('estoque_movimentos').select('codigo, quantidade, custo_unitario, referencia_externa').like('referencia_externa', 'nfe:' + chave + ':%').order('id')`, **paginado** com `.range(i, i + 999)` até vir página com menos de 1000 linhas (PostgREST `max_rows = 1000`; usar o helper de `src/lib/paginacao-supabase.ts`). `nItem` = 3º segmento da ref. Conferir que a policy de select de `estoque_movimentos` é por org (é lida hoje pela seção "Movimentos de estoque").
- **`urlXmlNota`:** `signedUrl('notas-compra', path, 60)`.

- [ ] **Step 5: Rodar testes e lint**

Run: `pnpm test -- src/components/estoque/importar-nota && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notas-compra.ts src/lib/queries.ts src/components/estoque/importar-nota
git commit -m "feat(adr-0181): estado do assistente (vínculo, GTIN ambíguo, multiproduto) e camada de dados"
```

---

### Task 9: Assistente "Importar nota de compra" (UI)

**Files:**
- Create: `src/components/estoque/importar-nota/{dialog-importar-nota,etapa-arquivo,etapa-itens,etapa-distribuicao,etapa-resumo}.tsx`
- Modify: `src/pages/Estoque.tsx`
- Test: `src/components/estoque/importar-nota/__tests__/linhas-distribuicao.test.ts`

**Interfaces:**
- Consumes: Tasks 4 e 8; RPC `variacoes_estoque_produto(p_codigo_pai)` (SKUs do produto: cor, tamanho, saldo); `produtos_estoque_resumo()` (seletor).
- Produces:
  - `export function DialogImportarNota({ aberto, onFechar }: { aberto: boolean; onFechar: () => void })`;
  - função pura `linhasIniciais(skus: Array<{ codigo: string }>, quantidade: number, custo: number): LinhaDistribuicao[]` em `estado.ts`.

**Comportamento:**

1. **Arquivo**
   - `react-dropzone` com `accept: { 'application/xml': ['.xml'], 'text/xml': ['.xml'] }`, um arquivo, ≤ 1 MB.
   - `file.text()` → `lerNfe`.
   - `statusDaNota(chave)` → `recusaInicial`. Se houver recusa, a mensagem aparece na etapa (com "Ver nota"
     quando já importada) e não avança.
   - Sem recusa: `buscarVinculos` + `produtosPorGtin` + `entradasPreviasDaNota` → `estadoInicial` (a retomada
     traz as entradas já lançadas como linhas travadas).
   - Mostra fornecedor, nº/série, emissão, total e nº de itens.
   - `!assinada` → aviso amarelo "Cópia sem assinatura digital — confira com o XML original quando possível".
   - `avisoTotal` → aviso amarelo com o texto e um checkbox obrigatório "Conferi: o total da nota difere em
     R$ X" (`aceitarDivergencia`). Sem ele, o Resumo mostra a pendência e não confirma.
2. **Itens:** uma linha por item, com descrição do fornecedor, `qCom uCom`, custo de aquisição unitário
   (`custoAquisicaoUnit`, `fmtBRL`) e selo ("Vinculado", "Casou pelo GTIN", "GTIN ambíguo — escolha" ou
   "Escolha o produto"). Na linha:
   - seletor de produto (busca nome ou código; no conflito, mostra só os candidatos);
   - "Cadastrar produto novo" (Task 10);
   - "Unidades por {uCom}" (visível com `uCom` ≠ `UN`/`PC` ou com fator do vínculo > 1).
3. **Distribuição:** por item, tabela dos SKUs do produto vinculado.
   - Colunas: cor, tamanho, saldo, quantidade (inteiro) e custo de precificação (default = custo de aquisição
     com 2 casas, editável).
   - Contador "X de Y unidades".
   - Produto com 1 SKU: a quantidade vem preenchida com o total (`linhasIniciais`), **editável**.
   - **"+ SKU de outro produto"**: busca SKU em qualquer produto da org (`skus_estoque_org()`) e adiciona uma
     linha (D-7).
   - "Repetir custo em todos".
   - "Falta um tamanho/cor?" (Task 11). A linha do SKU criado por ali fica com a quantidade **travada** (o
     ledger já recebeu essas peças com a referência da nota).
4. **Resumo:** lista `pendencias(e)`, e cada item leva à etapa certa. Sem pendências:
   - mostra o total por produto e a nota "A entrada é registrada de uma vez. A nota fica guardada e pode ser
     desfeita por um administrador enquanto houver saldo.";
   - **Confirmar** → `importarNotaCompra(payload(e))`.
     - **Sucesso:** toast ("Nota 1051 importada · 70 unidades"; com `duplicada`, "já tinha sido importada —
       nada foi somado"). Invalida `QK.produtosEstoqueResumo`, `QK.notasCompra`,
       `QK.vinculosFornecedor(cnpj)` e `QK.variacoesEstoque(codigoPai)` de cada produto tocado. Fecha.
     - **`pushOk: false`:** em vez do toast verde, aviso "Estoque gravado, mas o envio aos canais falhou —
       use 'Reenviar estoque' em Notas de compra" (Task 12).
     - **Erro:** toast com a mensagem da edge; o diálogo continua aberto.

Botão em `Estoque.tsx`: "Importar nota de compra".
- Visível com o módulo `estoque` ligado.
- Habilitado com `empresaFiscal?.cnpj`; sem CNPJ, fica desabilitado com tooltip "Cadastre o CNPJ em
  Configurações › Fiscal".

- [ ] **Step 1: Teste que falha (`linhasIniciais`)**

```ts
import { describe, it, expect } from 'vitest';
import { linhasIniciais } from '../estado';

describe('linhasIniciais', () => {
  it('1 SKU recebe o total; vários SKUs começam zerados com o custo default', () => {
    expect(linhasIniciais([{ codigo: 'S1' }], 35, 10)).toEqual([{ codigo: 'S1', quantidade: 35, custoPrecificacao: 10 }]);
    expect(linhasIniciais([{ codigo: 'S1' }, { codigo: 'S2' }], 35, 10)).toEqual([
      { codigo: 'S1', quantidade: 0, custoPrecificacao: 10 }, { codigo: 'S2', quantidade: 0, custoPrecificacao: 10 }]);
  });
});
```

As linhas com quantidade 0 são filtradas antes de `definirDistribuicao` (o `erroDistribuicao` recusa ≤ 0).
O componente faz `linhas.filter((l) => l.quantidade > 0)`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- src/components/estoque/importar-nota`
Expected: FAIL.

- [ ] **Step 3: Implementar `linhasIniciais` e as etapas conforme o comportamento acima**

Usar `Dialog`, `Button`, `Input`, `Table`, `Badge`, `Select` e `Progress` de `src/components/ui`, com o padrão
visual de `dialog-entrada.tsx`. O input do dropzone recebe `data-testid="nfe-input"`.

- [ ] **Step 4: Rodar testes e build**

Run: `pnpm test -- src/components/estoque && pnpm preflight:static`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/estoque/importar-nota src/pages/Estoque.tsx
git commit -m "feat(adr-0181): assistente Importar nota de compra em /estoque"
```

---

### Task 10: "Cadastrar produto novo" a partir do item da nota (simples ou grade)

**Files:**
- Modify: `supabase/functions/cadastrar-produto/index.ts` (variável `codigoPai` comum aos ramos de criação e retry; resposta com `codigoPai`; `origemNota: true` recusa `estoqueInicial > 0`)
- Modify: `supabase/functions/_shared/produto/validar.ts` + `src/lib/produto-entrada.ts` (`origemNota?: boolean`)
- Modify: `src/lib/produtos-saldo.ts:489` (`ResultadoCadastro` ganha `codigoPai: string`; `cadastrarProduto` em `:498` continua devolvendo esse tipo)
- Modify: `src/components/estoque/use-cadastro-produto.ts:125,237,239` (callback `onCadastrado({ codigoPai })`; com `origemNota`, `estoqueInicial` é **sempre** omitido no payload)
- Modify: `src/components/estoque/dialog-cadastro-produto.tsx` (`CadastroInicial` `:43`; prop `origemNota`; campo de estoque inicial oculto)
- Modify: `src/components/estoque/dialog-cadastro-grade.tsx` (aceita `inicial` + `origemNota` com a mesma semântica)
- Modify: `src/components/estoque/linha-variacao-form.tsx:59,163` (oculta estoque inicial com `origemNota`)
- Modify: `src/components/estoque/etapa-fiscal-form.tsx` e a etapa de dados do cadastro (selo + confirmação)
- Create: `src/components/estoque/importar-nota/prefill-cadastro.ts` + teste
- Test: `supabase/functions/cadastrar-produto/__tests__/processar.test.ts` (ou o teste de validação existente)

**Interfaces:**
- Consumes: `limparDescricaoFornecedor`, `origemSugerida`, `custoAquisicaoUnit` (Task 3); `descricaoFiscal` (Task 7).
- Produces:
  - `prefillCadastro(item: ItemConciliado, nota: NotaCompraLida, fator: number): CadastroInicial`;
  - `CadastroInicial` passa a ter `descricaoFiscal?`, `custo?`, `fiscal?: { ncm?; origemNfe?; tributacaoIcms?: '' }`, `origemSugerida?: 'nacional' | 'importado'` e `sugestaoDaNota?: boolean`;
  - `onCadastrado?: (r: { codigoPai: string }) => void`.

Regras (D-4, D-5, D-6, D-10):
- **Textos e custo:** `nomePai` e `descricaoFiscal` = `limparDescricaoFornecedor(xProd)`; `fornecedor` =
  `nota.emitenteNome`; custo = `custoAquisicaoUnit` com 2 casas.
- **Fiscal:** `origemSugerida(item.orig)` → `fiscal.origemNfe` e `origemSugerida`. Se for `null`, os dois ficam
  vazios e pendentes. `ncm` = `item.ncm`. `tributacaoIcms` fica **vazio**.
- **Confirmação ativa da origem, com ou sem módulo fiscal:** com `sugestaoDaNota`, o campo **Origem
  (nacional/importado)** da etapa de dados nasce **vazio**, com o selo "Sugestão da nota:
  {Nacional|Importado} — escolha para confirmar". `familias.origem` define o imposto e não pode vir
  pré-escolhida. Na etapa fiscal, NCM e Origem NF-e vêm preenchidos com o selo e um checkbox obrigatório
  "Conferi NCM e origem".
- **Grade:** só é oferecida quando `organizations.tipos_produto_habilitados` não está vazio, porque o
  diálogo de grade depende do tipo (`dialog-cadastro-grade.tsx:67,78`) e o servidor recusa tamanho sem tipo
  (`cadastrar-produto/processar.ts:29`).
  - Com tipo habilitado: o assistente pergunta "Este produto tem tamanho/cor? Grade / Simples" e abre
    `DialogCadastroGrade` ou `DialogCadastroProduto`.
  - Sem tipo: abre direto o `DialogCadastroProduto`, com a nota "Para cadastrar grade (tamanho), habilite
    roupa/calçado em Configurações".
  - O callback `onCadastrado` também precisa chegar ao `useCadastroProduto({ aberto })` do diálogo de grade
    (`dialog-cadastro-grade.tsx:106`).
- **Estoque inicial:** com `origemNota`, o servidor recusa `estoqueInicial > 0` com
  `{ campo: 'variacoes[i].estoqueInicial', mensagem: 'Na importação por nota o saldo entra pela nota.' }`.
  - **Modo persistido (N-I1):** com `origemNota`, `montarLinhasProduto` grava `familias.origem_cadastro = 'nota'`
    (coluna da Task 1). No retry, `cadastrar-produto/index.ts` lê `origem_cadastro` junto do `jaCadastrado`. Se
    for `'nota'`, **não aplica** estoque inicial nenhum, mesmo que o payload do retry traga `estoqueInicial`
    e não traga `origemNota` (o guard de `cadastrar-produto/processar.ts:227` não é alcançado). Teste: retry
    com payload alterado sobre família `origem_cadastro = 'nota'` → zero chamadas a `registrar_entrada`.

- [ ] **Step 1: Testes que falham**

```ts
// prefill-cadastro.test.ts
import { describe, it, expect } from 'vitest';
import { prefillCadastro } from '../prefill-cadastro';

const item = { nItem: 1, cProd: 'REF 06', xProd: 'Short masculino - DIV - DIV', ncm: '62034900', cfop: '5102',
  gtin: null, uCom: 'PC', qCom: 35, vProd: 350, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, orig: 0, rateio: {} };
const nota = { emitenteNome: 'FORNECEDOR TESTE LTDA' } as never;

describe('prefillCadastro', () => {
  it('limpa descrição, sugere origem sem pré-escolher, CSOSN vazio, sem estoque inicial', () => {
    const p = prefillCadastro(item, nota, 1);
    expect(p).toMatchObject({
      nomePai: 'Short masculino', descricaoFiscal: 'Short masculino', fornecedor: 'FORNECEDOR TESTE LTDA',
      custo: 10, origemSugerida: 'nacional', sugestaoDaNota: true, fiscal: { ncm: '62034900', origemNfe: 0, tributacaoIcms: '' },
    });
    expect(p).not.toHaveProperty('origem');
    expect(JSON.stringify(p)).not.toContain('estoqueInicial');
  });
  it('origem 1 (importação direta) vira 2 e sugere importado; ausente fica pendente', () => {
    expect(prefillCadastro({ ...item, orig: 1 }, nota, 1)).toMatchObject({ origemSugerida: 'importado', fiscal: { origemNfe: 2 } });
    const p = prefillCadastro({ ...item, orig: null }, nota, 1);
    expect(p.origemSugerida).toBeUndefined();
    expect(p.fiscal?.origemNfe).toBeUndefined();
  });
});
```

```ts
// cadastrar-produto: validação
it('origemNota recusa estoqueInicial > 0', () => {
  const r = validarProdutoNovo({ ...produtoValido, origemNota: true,
    variacoes: [{ ...produtoValido.variacoes[0], estoqueInicial: 5 }] });
  // validarProdutoNovo devolve ErroValidacao[] direto (_shared/produto/validar.ts:53).
  expect(r).toContainEqual(expect.objectContaining({ campo: 'variacoes[0].estoqueInicial' }));
});
```

Usar a fixture `produtoValido` (ou equivalente) que o arquivo de teste já tem.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- src/components/estoque/importar-nota supabase/functions/cadastrar-produto supabase/functions/_shared/produto`
Expected: FAIL.

- [ ] **Step 3: Implementar**

- `cadastrar-produto/index.ts`: declarar `let codigoPai: string` antes do `if (jaCadastrado)`. No retry, ler o
  `codigo_pai` da família existente (acrescentar ao `select` do `jaCadastrado`). Na criação, usar
  `gerados.codigoPai`. Incluir `codigoPai` no `json({...})` final **mantendo** todos os campos atuais.
- `_shared/produto/validar.ts`: implementar a recusa de `origemNota` + `estoqueInicial > 0`.
- `use-cadastro-produto.ts`: `onCadastrado?.({ codigoPai: resposta.codigoPai })` nos dois pontos (`:125` e
  `:239`); com `origemNota`, o `montarPayload` omite `estoqueInicial` e envia `origemNota: true`.
- `dialog-cadastro-produto.tsx` e `dialog-cadastro-grade.tsx`:
  - recebem `inicial` (o snapshot estável, conforme o comentário em `:56`) e `origemNota`;
  - `linha-variacao-form.tsx` oculta o campo de estoque inicial com `origemNota`;
  - os chamadores atuais continuam iguais (props opcionais).
- Selos e confirmação: conforme as regras. Reusar o padrão visual da sugestão de NCM por IA de
  `etapa-fiscal-form.tsx`.
- `etapa-itens.tsx`: a pergunta "Grade / Simples" abre o diálogo certo com
  `inicial = prefillCadastro(...)` (guardado em `useState` no clique). O `onCadastrado({ codigoPai })` chama
  `definirProduto(e, nItem, codigoPai)` e invalida `QK.produtosEstoqueResumo`.

- [ ] **Step 4: Rodar testes e build**

Run: `pnpm test -- src/components/estoque supabase/functions && pnpm preflight:static`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/estoque src/lib supabase/functions/cadastrar-produto supabase/functions/_shared/produto
git commit -m "feat(adr-0181): cadastrar produto (simples ou grade) a partir da nota, sem estoque inicial, origem confirmada"
```

---

### Task 11: Variação faltante pelo fluxo existente, com a referência da nota (D-8 revisada)

**Files:**
- Modify: `supabase/functions/adicionar-variacoes-familia/processar.ts` (validação do corpo; `normalizarIntencao`/`decidirRetry` em `:229,247`; `aplicarEstoqueInicial` em `:385-393`)
- Modify: `supabase/functions/adicionar-variacoes-familia/index.ts` (repassa `refNota` até o ledger, `:354-359`)
- Test: `supabase/functions/adicionar-variacoes-familia/__tests__/processar.test.ts`
- Modify: `src/components/estoque/dialog-adicionar-variacao-roteador.tsx`, `dialog-adicionar-variacao.tsx`, `dialog-estender-grade.tsx` (props opcionais `refNota`, `estoqueFixo`)
- Modify: `src/components/estoque/importar-nota/etapa-distribuicao.tsx`, `estado.ts`
- Test: `src/components/estoque/importar-nota/__tests__/estado.test.ts`

**Interfaces:**
- Consumes: `adicionar-variacoes-familia` (ADR-0129, admin), que hoje grava o estoque inicial com a ref `addvar:{familiaId}:{codigo}` (`processar.ts:393`) e exige `estoqueInicial > 0` (`processar.ts:98`). A importação **mantém** esse > 0: as peças da nota são o estoque inicial.
- Produces:
  - Corpo de `adicionar-variacoes-familia` ganha `refNota?: string` (formato `nfe:{chave44}:{nItem}`, validado por `/^nfe:\d{44}:\d{1,3}$/`). Com `refNota`, a ref de ledger de cada variação nova vira `${refNota}:${codigo}`. Sem ela, nada muda (`addvar:...`).
  - **Uma variação por chamada no modo nota (R3-B2):** com `refNota`, a edge recusa `variacoes.length !== 1` ("Na importação por nota, adicione um tamanho/cor por vez"). Os diálogos, com `refNota`, escondem "adicionar linha" (`dialog-adicionar-variacao.tsx:355`). No `dialog-estender-grade.tsx`, aceitam **uma** combinação marcada (`:246`), bloqueando a geração em massa.
  - **Retry (R3-I1):** `refNota` entra em `normalizarIntencao` (`processar.ts:229`). `decidirRetry` (`:247`) compara a ref persistida com a do corpo; troca ou remoção é recusada com erro de validação.
  - A resposta já tem `codigos` na criação e no retry (`index.ts:133,377`).
  - Props nos três diálogos: `refNota?: string`, `estoqueFixo?: number` e `onConcluido?: (r: { codigos: string[] }) => void`. Hoje o roteador só recebe `onFechar` (`dialog-adicionar-variacao-roteador.tsx:9`); o roteador repassa as três ao diálogo escolhido. Com `estoqueFixo`, o campo de estoque inicial vem com esse valor, **travado**.
  - **Falha do ledger (R3-B3):** a edge tolera falha do estoque inicial e segue (`index.ts:354-369`), e os diálogos orientam "Use Dar entrada para corrigir" (`dialog-adicionar-variacao.tsx:264`, `dialog-estender-grade.tsx:472`). Com `refNota`, a mensagem passa a ser "O estoque desta variação será aplicado ao confirmar a importação da nota". Isso é verdade: sem a ref no ledger, a RPC da importação aplica a entrada normalmente (`registrar_entrada` não devolve `null`). **Nunca** sugerir entrada manual nesse modo, que somaria em dobro.
  - `acaoVariacaoFaltante(produto: { publicado: boolean }, isAdmin: boolean): 'adicionar-publicado' | 'pedir-admin' | 'recusar-nao-publicado'` em `estado.ts`.
  - `travarLinhaNova(e: EstadoImportacao, nItem: number, codigo: string, quantidade: number, custo: number): EstadoImportacao`: acrescenta a linha com `travada: true` (tipo `LinhaEstado` da Task 8; o `payload()` da Task 8 já remove a flag).

**Por que fecha sem dupla contagem:**
1. O fluxo existente lança as N peças com a ref `nfe:{chave}:{nItem}:{codigo}` e publica a variação por clique
   do operador.
2. Na confirmação da nota, a RPC (Task 2) chama `registrar_entrada` com a **mesma** ref e recebe `null`
   (duplicada). Em seguida confere se a quantidade lançada é a da distribuição; se não for, recusa a nota.
3. O teste SQL da Task 2 já cobre os dois casos (bate e diverge).

Se o operador abandonar a importação depois de criar a variação, a entrada fica no ledger com documento e
ref da nota. Reimportar a mesma nota fecha a conta.

- [ ] **Step 1: Teste da edge que falha**

No arquivo de teste existente de `adicionar-variacoes-familia`, seguir a fábrica de `admin` mockado que já
existe. Casos:
- com `refNota: 'nfe:26261011222333000181550010000010511000030324:1'`, o `registrar_entrada` recebe `p_ref = 'nfe:26261011222333000181550010000010511000030324:1:<codigo novo>'`;
- sem `refNota`, continua `addvar:{familiaId}:{codigo}`;
- `refNota` malformado (`'nfe:123:1'`, `'addvar:x'`) dá erro de validação no campo `refNota`;
- `refNota` com 2 variações no corpo dá erro de validação (uma por vez);
- retry com a mesma `chave` e a mesma `refNota` reaplica com a mesma ref (no-op no ledger);
- retry com `refNota` diferente ou ausente é recusado;
- com `refNota` de nota já importada: 409 antes de inserir a variação (nenhum insert, nenhum enfileiramento);
- com `refNota`, a RPC chamada é `registrar_entrada_nota_pendente` com `p_chave` = os 44 dígitos da ref.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- supabase/functions/adicionar-variacoes-familia`
Expected: FAIL.

- [ ] **Step 3: Implementar na edge**

- `processar.ts`:
  - validar `refNota` opcional com a regex acima e, com ela, exigir exatamente 1 variação;
  - com `refNota`, **antes de qualquer insert**, conferir que não existe `notas_compra` com essa chave para a org.
    Se existir, devolver 409 "Esta nota já foi importada" (falha cedo, sem criar nem publicar variação). A
    garantia contra a corrida vem do passo seguinte;
  - com `refNota`, `aplicarEstoqueInicial` chama `registrar_entrada_nota_pendente` (Task 2, mesmo lock da
    importação) em vez de `registrar_entrada`, passando `p_chave` extraída da `refNota`;
  - `aplicarEstoqueInicial` recebe `refNota?: string` e monta
    `p_ref: refNota ? `${refNota}:${it.codigo}` : `addvar:${e.familiaId}:${it.codigo}``;
  - `p_doc` passa a ser `refNota ? 'NF-e (variação nova)' : <valor atual>`.
- `index.ts`: ler `body.refNota` e passar ao validador e ao `aplicarEstoqueInicial`.
- Retry (`reaplicar`, `processar.ts:259`): `refNota` faz parte da intenção normalizada e persistida (onde o
  retry já persiste a intenção hoje; conferir o local exato) e é comparada no `decidirRetry`. Ref diferente
  ou ausente → recusa. Mesma ref → reaplica com ela (`registrar_entrada` devolve `null`, no-op).

- [ ] **Step 4: Testes de estado que falham**

```ts
import { acaoVariacaoFaltante, travarLinhaNova } from '../estado';

describe('variação faltante (D-8)', () => {
  it('publicado+admin abre o fluxo; publicado sem admin pede admin; não publicado recusa', () => {
    expect(acaoVariacaoFaltante({ publicado: true }, true)).toBe('adicionar-publicado');
    expect(acaoVariacaoFaltante({ publicado: true }, false)).toBe('pedir-admin');
    expect(acaoVariacaoFaltante({ publicado: false }, true)).toBe('recusar-nao-publicado');
  });
  it('linha nova entra travada e o payload não carrega a flag', () => {
    let e = estadoInicial(nota, '<x/>', [], {});
    e = definirProduto(e, 1, 'P1');
    e = definirDistribuicao(e, 1, [{ codigo: 'S1', quantidade: 30, custoPrecificacao: 10 }]);
    e = travarLinhaNova(e, 1, 'S9', 5, 10);
    expect(e.decisoes[0].distribuicao.find((l) => l.codigo === 'S9')).toMatchObject({ quantidade: 5, travada: true });
    e = definirProduto(e, 2, 'P2'); e = definirFator(e, 2, 12);
    e = definirDistribuicao(e, 2, [{ codigo: 'S2', quantidade: 24, custoPrecificacao: 10 }]);
    expect(JSON.stringify(payload(e))).not.toContain('travada');
  });
});
```

(Usar a `nota` e os imports já definidos no topo do arquivo de teste da Task 8.)

- [ ] **Step 5: Implementar o front**

- `estado.ts`: `acaoVariacaoFaltante = (p, isAdmin) => !p.publicado ? 'recusar-nao-publicado' : isAdmin ? 'adicionar-publicado' : 'pedir-admin'`. `travarLinhaNova` acrescenta `{ codigo, quantidade, custoPrecificacao: custo, travada: true }`, e `payload()` mapeia as linhas para `{ codigo, quantidade, custoPrecificacao }`.
- `etapa-distribuicao.tsx`, link "Falta um tamanho/cor?":
  - `adicionar-publicado`: pede a quantidade da nota para o tamanho novo (≤ unidades ainda não distribuídas) e abre o `DialogAdicionarVariacaoRoteador` com `refNota = nfe:{chave}:{nItem}`, `estoqueFixo = quantidade` e `onConcluido`. O `onConcluido({ codigos: [codigo] })` chama `travarLinhaNova` e recarrega `QK.variacoesEstoque(codigoPai)`;
  - `pedir-admin`: "Peça a um administrador para adicionar o tamanho/cor e volte";
  - `recusar-nao-publicado`: "Este produto ainda não foi publicado e não aceita tamanho novo nesta versão. Cadastre a grade completa ou publique antes."
- Diálogos existentes: `refNota` repassado no corpo da edge; `estoqueFixo` preenche e trava o campo. Sem as props, o comportamento atual fica idêntico (os chamadores atuais não mudam).

- [ ] **Step 6: Rodar tudo e commit**

```bash
pnpm test -- supabase/functions/adicionar-variacoes-familia src/components/estoque && pnpm preflight:static
git add -A supabase/functions/adicionar-variacoes-familia src/components/estoque
git commit -m "feat(adr-0181): variação faltante pelo fluxo existente com a referência da nota (D-8)"
```

---

### Task 12: Lista "Notas de compra" em `/estoque`

**Files:**
- Create: `src/components/estoque/importar-nota/secao-notas-compra.tsx`
- Modify: `src/pages/Estoque.tsx`
- Test: `src/components/estoque/importar-nota/__tests__/secao-notas-compra.test.ts`

**Interfaces:**
- Produces: `SecaoNotasCompra()`; `podeDesfazer(n: NotaCompraResumo, isAdmin: boolean): boolean`.

**Comportamento:**
- Seção recolhível "Notas de compra (N)", com a query habilitada só com o módulo estoque.
- Tabela: emissão, fornecedor, nº, total, status (`status-pill`), selo "sem assinatura" e ações:
  - **Baixar XML** (`urlXmlNota` + `window.open`);
  - **Desfazer** e **Marcar como cancelada**: só com `podeDesfazer`, via `alert-dialog` que explica a redução
    do saldo.
  - **Reenviar estoque** (qualquer membro com escrita, em nota de qualquer status): chama
    `importar-nota-compra` com `{ reenviarPush: { chave } }` (Task 5). Não mexe em saldo, só reenfileira o
    push dos produtos da nota. É a recuperação quando a importação ou o desfazer voltaram com `pushOk: false`.
    O wrapper `reenviarEstoqueNota(chave)` vai em `src/lib/notas-compra.ts`.
- **Sucesso do desfazer:** invalida `QK.notasCompra`, `QK.produtosEstoqueResumo` e `QK.variacoesEstoque` dos
  produtos da nota.
- **Erro:** `toast.error` com a mensagem, que lista os SKUs.

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

- [ ] **Step 2: Rodar, implementar e passar**

Run: `pnpm test -- src/components/estoque/importar-nota`.
`podeDesfazer = (n, isAdmin) => isAdmin && n.status === 'importada'`.

- [ ] **Step 3: Build e commit**

```bash
pnpm preflight:static
git add src/components/estoque/importar-nota src/pages/Estoque.tsx
git commit -m "feat(adr-0181): lista de notas de compra com XML, desfazer e cancelar"
```

---

### Task 13: Docs, deploy e validação em runtime

**Files:**
- Modify: `docs/reference/edge-functions.md`:
  - tabela-resumo + seção `### Estoque` com `importar-nota-compra` e `desfazer-nota-compra`;
  - tabela `_shared/` com `_shared/nfe/*`;
  - contador "As N Edge Functions".
- Modify: `docs/reference/modelo-de-dados.md` (seção "Nota de compra (ADR-0181)": 4 tabelas, colunas novas, bucket, RPCs)
- Modify: `docs/decisions/0181-…md`:
  - Status → "aceito — em implementação (Plano 1)";
  - D-8 revisado conforme o OK do Diego;
  - D-2 atualizado: leitor textual no servidor.
- Modify: `docs/TASKS.md`, `docs/project-status.md`, `obsidian-vault/03-Módulos/Fiscal.md` (skill `docs-update-checklist`)

- [ ] **Step 1: Docs**, conforme `docs-update-checklist`.

- [ ] **Step 2: Portão completo**

Run: `pnpm preflight`
Expected: tudo verde.

- [ ] **Step 3: Ordem de disponibilização e deploy**

Ordem: **migrations** (já aplicadas nas Tasks 1 e 2; conferir com `npm run db:check`) → **edges** → **front** (merge/Render).
A edge nova não pode receber chamada de um front que ainda não existe, e o front novo não pode chamar edge
que ainda não existe. Por isso o front sai por último.

Blast radius (dependências diretas e transitivas dos arquivos `_shared` alterados):

```bash
for f in canais/fiscal-ml produto/validar nfe/; do
  grep -rln "_shared/$f\|\.\./$f\|'\./$f" supabase/functions --include=*.ts | grep -v __tests__
done | sed -E 's#supabase/functions/([^/]+)/.*#\1#' | sort -u
```

Para cada arquivo `_shared/*.ts` que aparecer na lista, repetir o grep pelo **nome dele** até não surgir
nada novo (dependência transitiva). Deploy da lista final **mais** estas, explícitas:

```bash
supabase functions deploy importar-nota-compra desfazer-nota-compra atualizar-fiscal-familia cadastrar-produto adicionar-variacoes-familia sincronizar-fiscal-ml <demais da lista>
supabase functions list
```
Expected: cada uma `ACTIVE` com versão incrementada e `verify_jwt` preservado.

- [ ] **Step 4: Validação em runtime (org Zaven)**

Em sessão Playwright isolada (skill `playwright-cli`), com screenshot de cada passo, em `/#/estoque`:
1. Gerar localmente, **sem commitar**, uma cópia da `nfe-sefaz.xml` com destinatário `69541033000145` e chave
   de DV válido (função `chaveNfeValida` como oráculo).
2. Importar. Cadastrar produto novo em **grade** e conferir:
   - a Origem vazia com o selo "sugestão";
   - o checkbox fiscal obrigatório;
   - o estoque inicial ausente.
3. Distribuir 24 unidades (fator 12) em 2 SKUs, um deles de outro produto. Confirmar.
4. Conferir os saldos.
5. Reimportar: aparece "já importada" e o XML no bucket não muda (mesmo `xml_sha256`).
6. Desfazer como admin: saldos voltam e o status fica "Desfeita". Chamar o desfazer de novo pela edge
   (curl com o JWT da sessão de teste) responde `jaEstava: true`, sem mexer no saldo. "Reenviar estoque"
   responde `pushOk: true`.
7. Concorrência: (a) "Confirmar" a mesma nota em duas abas ao mesmo tempo → o saldo soma uma vez; (b) com a
   nota aberta em duas abas, confirmar na aba A e, na aba B, tentar "Falta um tamanho/cor?" → 409 "já
   importada", sem criar variação.
8. A Zaven está conectada ao ML (seller `3760134495`, 2026-10-15) e ainda sem anúncios. O push enfileira e
   não acha anúncio. Conferir no log que não há erro.

- [ ] **Step 5: Pendências do ADR (registrar no ADR, não fingir)**

- `fiscal_information.title` → `xProd` da nota do Faturador: a Zaven foi conectada em 2026-10-15, mas com 0
  anúncios e 0 vendas. Só dá para verificar numa **nota de venda emitida**. Verificar na **primeira venda
  faturada da Zaven**: `GET /users/3760134495/invoices/orders/{order_id}`, abrir o XML e comparar o `xProd`
  com a `descricao_fiscal` da família. Registrar o resultado no ADR. Até lá, a descrição fiscal é gravada e
  enviada, mas a afirmação "sai na nota" fica **não verificada**.
- XML original da SEFAZ: **dispensado pelo Diego** (2026-10-15). A base dos testes é a exportação de ERP
  (forma do arquivo real) mais a fixture no formato SEFAZ.

- [ ] **Step 6: Commit das docs**

```bash
git add docs obsidian-vault
git commit -m "docs(adr-0181): entrada por nota de compra — referência, modelo de dados e status"
```

---

## Self-Review (revisão 4)

- Rodada 3 do Codex: R3-B1 → Tasks 2, 8 e 9; R3-B2, R3-B3 e R3-I1 → Task 11; R3-B4 → Tasks 5 e 6;
  R3-I2 → Tasks 3, 5, 8 e 9; R3-I3 → Task 4; R3-I4 → Tasks 2 e 5; N-I1 → Tasks 1 e 10; menor 1 → Task 3.
- Concorrência real (duas importações simultâneas) segue sem teste automatizado: o `teste-sql-desfeito.py`
  roda numa sessão só. A garantia é o `pg_advisory_xact_lock`, com precedente em
  `20260729084329_e6b_estoque_movimentos.sql:102`. Na validação de runtime (Task 13), clicar "Confirmar" em
  duas abas ao mesmo tempo e conferir o saldo.

## Self-Review (revisão 3)

- **Rodada 2 do Codex:**
  - N-B1: leitor endurecido (comentários, `infNFe` única, `chNFe` = `Id`, protocolo sem `cStat`, prefixo NCName) → Task 4.
  - N-B2: centavos inteiros, sinais, maiores restos, aviso de `vNF` → Task 3.
  - N-B3: XML endereçado por `sha256` → Task 5.
  - N-B4: D-8 com a referência da nota no fluxo existente, mais a checagem de quantidade na RPC → Tasks 2 e 11.
  - N-B5: `codigoPai` em `ResultadoCadastro` e no diálogo de grade → Task 10.
  - N-I1: ponytail documentado → Task 10.
  - N-I2: contrato único `fiscal.descricaoFiscal` → Task 7.
  - N-I3: "Reenviar estoque" e tratamento de `pushOk` → Tasks 5, 9 e 12.
  - N-I4: controle positivo e storage entre orgs → Task 1; privilégio separado → Task 2.
  - N-I5: grade só com tipo de produto habilitado → Task 10.
  - Menor 4: asserção sobre `r` → Task 10.
  - I5 (verificações do ADR): decisão do Diego, registrada → Task 13, Step 5.
- **Cobertura do ADR:** D-1 a D-11 (D-8 revisada e aprovada); D-12 e D-13 no Plano 2.
- **Conferências do executor no código:** assinaturas de `enfileirarSincronizacaoEstoque` e
  `auditarOperacaoSuporte`; nome do campo de códigos na resposta de `adicionar-variacoes-familia`; persistência
  do retry dessa edge (Task 11, Step 3); `insert into storage.objects` no teste SQL (colunas exigidas pelo
  schema `storage`).
