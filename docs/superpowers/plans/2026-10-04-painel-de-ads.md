# Painel de Ads com margem real (I2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela `/ads` com o resultado da conta depois de Ads e o ranking de famílias por gasto (ACOS real × ACOS de equilíbrio), mais o Lucro após Ads do dossiê SKU deixando de ser bloqueado por gasto antigo fora dos grupos.

**Architecture:** O worker `coletar-ads-ml` passa a gravar também a **série diária do anunciante** (`ml_ads_conta_dia`), que fecha o total da conta em qualquer período (spike 054). Uma RPC de leitura (`ads_painel`) devolve, para o período, o sync, os dias da conta e os grupos com gasto (somados no servidor) com seus MLBs. O front resolve MLB → código → família com o que já existe (`vendas_sku_codigos_mlbs` + catálogo) e cruza com o lucro por família de `useVendasSku`, numa lib pura (`src/lib/ads-painel.ts`). Nada escreve no ML.

**Tech Stack:** Postgres (Supabase, migration via `supabase migration new` + `db push`), edge Deno (`supabase/functions`), React + TS + react-query + Tailwind/shadcn, vitest.

**Spec:** `docs/superpowers/specs/2026-10-04-painel-de-ads-design.md` · ADR `docs/decisions/0179-painel-de-ads.md` · spike `docs/spikes/054-total-de-ads-por-periodo.md` · base ADR-0172 (Fatia 2c), ADR-0173 (teto por mensagem).

## Global Constraints

- Só **GET** no ML. Nenhuma escrita em campanha, orçamento ou lance.
- **Nunca ratear** gasto entre cores, famílias ou SKUs; cada grupo entra uma vez em cada agregado.
- Somas por **Σ/Σ** (ROAS = Σvendas / Σgasto, ACOS = Σgasto / Σvendas); denominador zero → `null` ("—"), nunca 0.
- **Gasto de Ads não identificado** = Σ total diário da conta − Σ gasto dos grupos **com pelo menos um MLB conhecido**, no período exibido; entra inteiro no total da conta numa linha própria.
- Período: presets **7 / 30 / 90 dias**, padrão **30**, sempre **dias BRT inteiros terminando ontem** (o mesmo recorte para Ads e para vendas).
- Dia com `coletado_em − dia < 15` é **atribuição em aberto** → total ganha selo "provisório".
- **ACOS de equilíbrio** = lucro antes de Ads ÷ bruto com custo da família; rótulo "referência pela margem observada"; margem ≤ 0 → "sem espaço para Ads". Semáforo com 2 estados comparando o **ACOS direto** (gasto ÷ venda direta): **dentro** (≤ equilíbrio) ou **acima**. Custo parcial, gasto compartilhado, cobertura incompleta ou histórico de vendas incompleto → semáforo indisponível com motivo. Sem meta configurável.
- **Nunca mostrar resultado com despesa sabidamente incompleta:** família tocada por grupo compartilhado, período fora da cobertura dos grupos, Σ grupos acima do total da conta → indisponível/divergente com motivo.
- Rótulos: "Resultado após Ads" (nunca "lucro gerado pelo Ads"); "Despesa informada pela API de Ads" (nunca "fatura").
- Lucro herda `fonteCusto` (`real` / `estimado` / `parcial`); `sem_custo` → lucro `null`.
- Módulo por org `ads`, nasce desligado; menu `ads` entre Vitrine e Faturamento.
- Migrations só por `supabase migration new` + `supabase db push` (ADR-0043); RLS por `org_id`; escrita só `service_role`.
- Teste antes do código (TDD) em toda lógica; `pnpm preflight` verde antes de push.

## Review Focus

1. **Vendas incluindo hoje e Ads só até ontem** → o painel converte o preset em `range` BRT terminando ontem e passa o mesmo `range` a `useVendasSku` (Task 4, teste `periodoAds`).
2. **Σ grupos maior que o total da conta** (série da conta relida em outro momento da rodada) → conta marcada como divergente: valores observados mantidos, não identificado indisponível, nada ajustado (Task 3, testes "divergente" e "arredondamento").
3. **Família sem venda no período mas com gasto** → lucro antes 0, resultado = −gasto, ACOS de equilíbrio `null` com motivo "sem vendas" (Task 3).
4. **Série da conta não coberta no período** (org recém-coletada, retenção, worker parado) → total da conta indisponível com motivo, famílias continuam visíveis sem % de não identificado (Task 3 estado `conta_incompleta`).
5. **Grupo com MLB sem código ou com códigos de 2 famílias** → vai para "compartilhado", nunca para uma família (Task 3).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/<ts>_ads_painel.sql` (criar) | `ml_ads_conta_dia`, `ml_ads_sync.conta_cobertura_desde`, RPCs `gravar_ads_conta_dias`, `ads_painel`, `ads_resumo_periodo`, retenção, menu `ads` |
| `supabase/tests/ads_painel.sql` (criar) | teste SQL (RLS, isolamento entre orgs, somas, posse) |
| `supabase/functions/_shared/ads/parsers.ts` (mod) | `parseSerieConta` |
| `supabase/functions/_shared/ads/fiacao.ts` (mod) | `urlSerieConta`, `STATUS_CAMPANHAS` |
| `supabase/functions/_shared/ads/sincronizar.ts` (mod) | ler e gravar a série da conta na mensagem que fecha em `ok` |
| `supabase/functions/coletar-ads-ml/deps.ts` (mod) | `buscarSerieConta`, `gravarContaDias`, `lerEstadoSync` com `contaCoberturaDesde` |
| `src/lib/ads-painel.ts` (criar) | regra pura: buckets, métricas, semáforo, estados |
| `src/lib/ads-painel-dados.ts` (criar) | `buscarPainelAds` (RPC) |
| `src/hooks/useAdsPainel.ts` (criar) | junta RPC + códigos + catálogo + `useVendasSku` |
| `src/pages/Ads.tsx` (criar), `src/components/ads/*.tsx` (criar) | tela |
| `src/lib/modulos.ts`, `src/lib/menus.ts`, `src/components/sidebar.tsx`, `src/App.tsx`, `src/pages/Usuarios.tsx`, `supabase/functions/usuarios/index.ts` (mod) | módulo + menu `ads` |
| `src/hooks/useVendasSku.ts` (mod) | 2º parâmetro opcional `janelaFixa` (janela BRT explícita) |
| `src/lib/sku-ads.ts`, `src/lib/sku-dossie-dados.ts`, `src/lib/sku-dossie.ts`, `src/hooks/useSkuDossie.ts`, `src/components/sku-dossie/ads-dossie.tsx` (mod) | D2 no dossiê, com lucro e resumo nos mesmos dias do Ads |
| `supabase/migrations/<ts>_ads_menu_backfill.sql` (criar, Task 7) | `allowed_menus += 'ads'` depois do deploy da edge `usuarios` |
| `docs/spikes/055-base-acos-equilibrio.md` (criar, Task 7) | validação da base do ACOS de equilíbrio |

---

### Task 1: Migration — série da conta, RPCs de leitura e menu

**Files:**
- Create: `supabase/migrations/<ts>_ads_painel.sql` (via `supabase migration new ads_painel`)
- Create: `supabase/tests/ads_painel.sql`
- Modify: `src/lib/database.types.ts` (tabela + 3 RPCs)

**Interfaces:**
- Produces (SQL):
  - tabela `public.ml_ads_conta_dia (org_id uuid, dia date, cost numeric, clicks int, prints int, direct_amount numeric, indirect_amount numeric, total_amount numeric, coletado_em timestamptz, PK (org_id, dia))`
  - coluna `public.ml_ads_sync.conta_cobertura_desde date`
  - `public.gravar_ads_conta_dias(p_org uuid, p_rodada timestamptz, p_coletado_em timestamptz, p_dias jsonb) returns boolean` (service_role)
  - `public.ads_painel(p_desde date, p_ate date) returns jsonb` (authenticated) → `{ sync, conta: ContaDia[], grupos: GrupoPainel[] }`
  - `public.ads_resumo_periodo(p_desde date, p_ate date) returns jsonb` (authenticated) → `{ custo_conta, dias_conta, custo_grupos_com_membro }`

- [ ] **Step 1: Criar o arquivo de migration**

Run: `supabase migration new ads_painel`
Expected: cria `supabase/migrations/<timestamp>_ads_painel.sql` vazio.

- [ ] **Step 2: Escrever o teste SQL (vermelho)**

`supabase/tests/ads_painel.sql` (formato de `supabase/tests/vitrine.sql`; **toda** asserção usa `is distinct from` e `coalesce`, porque `NULL <> x` não dispara — a armadilha documentada em `vitrine.sql:81`):

```sql
\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('96000000-0000-0000-0000-000000000001', 'Ads test', 'ads-test'),
  ('96000000-0000-0000-0000-000000000002', 'Outra org ads', 'outra-org-ads');
insert into auth.users (id, email, raw_user_meta_data) values
  ('96000000-0000-0000-0000-000000000101', 'ads@test.local', '{"org_id":"96000000-0000-0000-0000-000000000001"}'::jsonb),
  ('96000000-0000-0000-0000-000000000102', 'outra-ads@test.local', '{"org_id":"96000000-0000-0000-0000-000000000002"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', true),
  ('96000000-0000-0000-0000-000000000102', '96000000-0000-0000-0000-000000000002', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;

insert into public.ml_ads_sync (org_id, estado, rodada, posse_ate, carga_inicial_ok, cobertura_desde) values
  ('96000000-0000-0000-0000-000000000001', 'ok', '2026-10-01 10:00+00', now() + interval '5 min', true, '2026-07-01'),
  ('96000000-0000-0000-0000-000000000002', 'ok', null, null, true, '2026-07-01');

-- Escrita como service_role (o papel real do worker), não como dono do banco.
set local role service_role;
do $$ begin
  if coalesce(public.gravar_ads_conta_dias('96000000-0000-0000-0000-000000000001', '2026-09-30 10:00+00', now(),
       '[{"dia":"2026-09-01","cost":1,"clicks":1,"prints":1,"direct_amount":1,"indirect_amount":0,"total_amount":1}]'), true)
     then raise exception 'gravou com rodada que não é dona'; end if;
  if public.gravar_ads_conta_dias('96000000-0000-0000-0000-000000000001', '2026-10-01 10:00+00', '2026-10-02 12:00+00',
       '[{"dia":"2026-09-01","cost":100,"clicks":10,"prints":1000,"direct_amount":800,"indirect_amount":200,"total_amount":1000},
         {"dia":"2026-09-02","cost":50,"clicks":5,"prints":500,"direct_amount":0,"indirect_amount":0,"total_amount":0}]')
     is distinct from true then raise exception 'não gravou com a rodada dona'; end if;
  if (select conta_cobertura_desde from public.ml_ads_sync where org_id = '96000000-0000-0000-0000-000000000001')
     is distinct from '2026-09-01'::date then raise exception 'conta_cobertura_desde'; end if;
  perform public.gravar_ads_conta_dias('96000000-0000-0000-0000-000000000001', '2026-10-01 10:00+00', '2026-10-01 12:00+00',
       '[{"dia":"2026-09-01","cost":1,"clicks":0,"prints":0,"direct_amount":0,"indirect_amount":0,"total_amount":0}]');
  if (select cost from public.ml_ads_conta_dia where org_id = '96000000-0000-0000-0000-000000000001' and dia = '2026-09-01')
     is distinct from 100::numeric then raise exception 'coleta antiga sobrescreveu'; end if;
end $$;
reset role;

-- Outra org com o MESMO ad_group_id e membro próprio: nada dela pode vazar nas subconsultas.
insert into public.ml_ads_conta_dia (org_id, dia, cost, clicks, prints, direct_amount, indirect_amount, total_amount, coletado_em) values
  ('96000000-0000-0000-0000-000000000002', '2026-09-01', 999, 0, 0, 0, 0, 0, now());
insert into public.ml_ads_grupo (org_id, ad_group_id, tipo, status, atualizado_em) values
  ('96000000-0000-0000-0000-000000000001', 9601, 'FAMILY', 'ACTIVE', now()),
  ('96000000-0000-0000-0000-000000000001', 9602, 'FAMILY', 'PAUSED', now()),   -- sem membro
  ('96000000-0000-0000-0000-000000000001', 9603, 'ITEM', 'ACTIVE', now()),     -- gasto só fora do período
  ('96000000-0000-0000-0000-000000000002', 9601, 'FAMILY', 'ACTIVE', now()),
  ('96000000-0000-0000-0000-000000000002', 9602, 'FAMILY', 'ACTIVE', now());   -- antes dos membros (FK)
insert into public.ml_ads_grupo_item (org_id, ad_group_id, ml_item_id, visto_em) values
  ('96000000-0000-0000-0000-000000000001', 9601, 'MLB1', now()),
  ('96000000-0000-0000-0000-000000000001', 9601, 'MLB2', now()),
  ('96000000-0000-0000-0000-000000000002', 9601, 'MLB9', now()),
  ('96000000-0000-0000-0000-000000000002', 9602, 'MLB8', now());
insert into public.ml_ads_grupo_dia (org_id, ad_group_id, dia, cost, clicks, prints, direct_amount, indirect_amount, total_amount, direct_units, units, coletado_em) values
  ('96000000-0000-0000-0000-000000000001', 9601, '2026-09-01', 90, 9, 900, 800, 100, 900, 3, 4, now()),
  ('96000000-0000-0000-0000-000000000001', 9601, '2026-09-02', 40, 4, 400, 0, 0, 0, 0, 0, now()),
  ('96000000-0000-0000-0000-000000000001', 9602, '2026-09-01', 10, 1, 100, 0, 0, 0, 0, 0, now()),
  ('96000000-0000-0000-0000-000000000001', 9603, '2026-08-01', 7, 1, 1, 0, 0, 0, 0, 0, now()),
  ('96000000-0000-0000-0000-000000000002', 9601, '2026-09-01', 500, 0, 0, 0, 0, 0, 0, 0, now()),
  ('96000000-0000-0000-0000-000000000002', 9602, '2026-09-01', 300, 0, 0, 0, 0, 0, 0, 0, now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"96000000-0000-0000-0000-000000000101","role":"authenticated"}';

do $$
declare r jsonb := public.ads_painel('2026-09-01', '2026-09-02');
        s jsonb := public.ads_resumo_periodo('2026-09-01', '2026-09-02');
        g jsonb;
begin
  if r ? 'sync' is distinct from true or r ? 'conta' is distinct from true or r ? 'grupos' is distinct from true
     then raise exception 'chaves ausentes %', r; end if;
  if jsonb_array_length(r->'conta') is distinct from 2 then raise exception 'conta: só os 2 dias da própria org %', r->'conta'; end if;
  if (select sum((e->>'cost')::numeric) from jsonb_array_elements(r->'conta') e) is distinct from 150::numeric
     then raise exception 'conta: soma (vazou a outra org?) %', r->'conta'; end if;
  if (r->'sync'->>'conta_cobertura_desde') is distinct from '2026-09-01' then raise exception 'sync %', r->'sync'; end if;
  if jsonb_array_length(r->'grupos') is distinct from 2 then raise exception 'grupos com gasto no período (9601, 9602) %', r->'grupos'; end if;
  select e into g from jsonb_array_elements(r->'grupos') e where (e->>'ad_group_id')::bigint = 9601;
  if g is null then raise exception 'grupo 9601 ausente'; end if;
  if (g->>'cost')::numeric is distinct from 130::numeric or (g->>'total_amount')::numeric is distinct from 900::numeric
     or (g->>'direct_amount')::numeric is distinct from 800::numeric
     then raise exception 'soma do grupo 9601 (vazou o 9601 da outra org?) %', g; end if;
  if g->'membros' is distinct from '["MLB1","MLB2"]'::jsonb then raise exception 'membros (MLB9 é da outra org) %', g; end if;
  select e into g from jsonb_array_elements(r->'grupos') e where (e->>'ad_group_id')::bigint = 9602;
  if g is null or g->'membros' is distinct from '[]'::jsonb then raise exception 'grupo sem membro (MLB8 é da outra org) %', g; end if;
  if (s->>'custo_conta')::numeric is distinct from 150::numeric or (s->>'dias_conta')::int is distinct from 2
     or (s->>'custo_grupos_com_membro')::numeric is distinct from 130::numeric
     then raise exception 'resumo %', s; end if;
  -- limites: 90 dias inclusivos passam; 91 não; nulo/invertido não
  perform public.ads_painel('2026-07-05', '2026-10-02');
  begin perform public.ads_painel('2026-07-04', '2026-10-02'); raise exception 'aceitou 91 dias';
  exception when others then if sqlerrm not like 'ads_painel: período inválido%' then raise; end if; end;
  begin perform public.ads_painel('2026-09-02', '2026-09-01'); raise exception 'aceitou período invertido';
  exception when others then if sqlerrm not like 'ads_painel: período inválido%' then raise; end if; end;
  begin perform public.ads_painel(null, '2026-09-01'); raise exception 'painel aceitou nulo';
  exception when others then if sqlerrm not like 'ads_painel: período inválido%' then raise; end if; end;
  -- resumo: 366 dias inclusivos passam; 367 não; nulo/invertido não
  perform public.ads_resumo_periodo('2025-09-02', '2026-09-02');
  begin perform public.ads_resumo_periodo('2025-09-01', '2026-09-02'); raise exception 'resumo aceitou 367 dias';
  exception when others then if sqlerrm not like 'ads_resumo_periodo: período inválido%' then raise; end if; end;
  begin perform public.ads_resumo_periodo(null, '2026-09-01'); raise exception 'aceitou nulo';
  exception when others then if sqlerrm not like 'ads_resumo_periodo: período inválido%' then raise; end if; end;
  begin perform public.ads_resumo_periodo('2026-09-02', '2026-09-01'); raise exception 'resumo aceitou invertido';
  exception when others then if sqlerrm not like 'ads_resumo_periodo: período inválido%' then raise; end if; end;
  begin
    perform public.gravar_ads_conta_dias('96000000-0000-0000-0000-000000000001', '2026-10-01 10:00+00', now(), '[]');
    raise exception 'authenticated executou RPC de escrita';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.ml_ads_conta_dia where org_id = '96000000-0000-0000-0000-000000000002')
     then raise exception 'RLS: viu a conta de outra org'; end if;
end $$;

-- Sentido inverso: a outra org não vê a primeira.
set local request.jwt.claims = '{"sub":"96000000-0000-0000-0000-000000000102","role":"authenticated"}';
do $$
declare r jsonb := public.ads_painel('2026-09-01', '2026-09-02');
begin
  if (select sum((e->>'cost')::numeric) from jsonb_array_elements(r->'conta') e) is distinct from 999::numeric
     then raise exception 'org 2: conta %', r->'conta'; end if;
  if (select string_agg(e->>'ad_group_id', ',' order by e->>'ad_group_id') from jsonb_array_elements(r->'grupos') e)
     is distinct from '9601,9602' then raise exception 'org 2: grupos %', r->'grupos'; end if;
  if r->'grupos'->0->'membros' is distinct from '["MLB9"]'::jsonb then raise exception 'org 2: membros %', r->'grupos'; end if;
  raise notice 'TESTE_OK';
end $$;
rollback;
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run (Postgres local): `psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -f supabase/tests/ads_painel.sql`
Se o Docker não subir: receita da memória `reference_teste_sql_sem_docker` (uma requisição `database/query` com `begin; set local lock_timeout='2s'; set local statement_timeout='30s'; <migration>; <corpo do teste sem \set>; do $$ begin raise exception 'TESTE_OK'; end $$; rollback;` — sucesso = `P0001: TESTE_OK`; avisar o Diego que foi DDL desfeito).
Expected: FAIL com `relation "public.ml_ads_conta_dia" does not exist`.

- [ ] **Step 4: Escrever a migration**

```sql
-- I2 Painel de Ads (ADR-0179, spike 054): série diária do anunciante, leitura do painel e menu `ads`.

create table public.ml_ads_conta_dia (
  org_id          uuid not null references public.organizations(id) on delete cascade,
  dia             date not null,
  cost            numeric not null check (cost >= 0),
  clicks          integer not null check (clicks >= 0),
  prints          integer not null check (prints >= 0),
  direct_amount   numeric not null check (direct_amount >= 0),
  indirect_amount numeric not null check (indirect_amount >= 0),
  total_amount    numeric not null check (total_amount >= 0),
  coletado_em     timestamptz not null,
  primary key (org_id, dia)
);
alter table public.ml_ads_sync add column conta_cobertura_desde date;  -- 1º dia da série da conta

alter table public.ml_ads_conta_dia enable row level security;
create policy "ml_ads_conta_dia: select org" on public.ml_ads_conta_dia for select to authenticated
  using (org_id = (select public.current_org_id()));
revoke all on public.ml_ads_conta_dia from anon;
revoke insert, update, delete, truncate, references, trigger on public.ml_ads_conta_dia from authenticated;
grant select on public.ml_ads_conta_dia to authenticated;

-- Só a rodada dona grava (mesmo lock de gravar_ads_lote). A série é densa (spike 054): cada dia vem com zero
-- explícito. A 1ª gravação define conta_cobertura_desde; depois a janela relida sempre encosta no último ok.
create function public.gravar_ads_conta_dias(p_org uuid, p_rodada timestamptz, p_coletado_em timestamptz, p_dias jsonb)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.ml_ads_sync s where s.org_id = p_org and s.rodada = p_rodada for update;
  if not found then return false; end if;
  insert into public.ml_ads_conta_dia as a (org_id, dia, cost, clicks, prints, direct_amount, indirect_amount,
                                             total_amount, coletado_em)
  select distinct on (x.dia) p_org, x.dia, x.cost, x.clicks, x.prints, x.direct_amount, x.indirect_amount,
         x.total_amount, p_coletado_em
    from jsonb_to_recordset(coalesce(p_dias, '[]'::jsonb)) as x(dia date, cost numeric, clicks integer, prints integer,
         direct_amount numeric, indirect_amount numeric, total_amount numeric)
   order by x.dia
  on conflict (org_id, dia) do update
    set cost = excluded.cost, clicks = excluded.clicks, prints = excluded.prints,
        direct_amount = excluded.direct_amount, indirect_amount = excluded.indirect_amount,
        total_amount = excluded.total_amount, coletado_em = excluded.coletado_em
    where excluded.coletado_em >= a.coletado_em;
  update public.ml_ads_sync
     set conta_cobertura_desde = coalesce(conta_cobertura_desde,
           (select min((e->>'dia')::date) from jsonb_array_elements(p_dias) e))
   where org_id = p_org;
  return true;
end $$;

-- Retenção: mesma regra de 13 meses, agora também para a série da conta.
create or replace function public.limpar_ads_retencao(p_corte date)
returns void
language sql security definer set search_path = '' as $$
  delete from public.ml_ads_grupo_dia where dia < p_corte;
  update public.ml_ads_sync set cobertura_desde = p_corte where cobertura_desde < p_corte;
  delete from public.ml_ads_grupo g
   where g.atualizado_em < p_corte
     and not exists (select 1 from public.ml_ads_grupo_dia d where d.org_id = g.org_id and d.ad_group_id = g.ad_group_id);
  delete from public.ml_ads_conta_dia where dia < p_corte;
  update public.ml_ads_sync set conta_cobertura_desde = p_corte where conta_cobertura_desde < p_corte;
$$;

-- Leitura do painel /ads: tudo somado no servidor (Avil: ~300 grupos × 90 dias passaria do teto de 1.000
-- linhas do PostgREST). Grupo entra se teve gasto ou venda atribuída no período; membros = vínculo atual.
create function public.ads_painel(p_desde date, p_ate date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := public.current_org_id();
begin
  -- 90 dias inclusivos no máximo (presets 7/30/90); org resolvida uma vez.
  if p_desde is null or p_ate is null or p_desde > p_ate or p_ate - p_desde > 89 then
    raise exception 'ads_painel: período inválido (%, %)', p_desde, p_ate;
  end if;
  if v_org is null then raise exception 'ads_painel: sem organização'; end if;
  return jsonb_build_object(
    'sync', (select jsonb_build_object('estado', s.estado, 'erro', s.erro, 'ultimo_ok_em', s.ultimo_ok_em,
               'carga_inicial_ok', s.carga_inicial_ok, 'cobertura_desde', s.cobertura_desde,
               'conta_cobertura_desde', s.conta_cobertura_desde)
               from public.ml_ads_sync s where s.org_id = v_org),
    'conta', coalesce((select jsonb_agg(jsonb_build_object('dia', d.dia, 'cost', d.cost, 'clicks', d.clicks,
               'prints', d.prints, 'direct_amount', d.direct_amount, 'indirect_amount', d.indirect_amount,
               'total_amount', d.total_amount, 'coletado_em', d.coletado_em) order by d.dia)
               from public.ml_ads_conta_dia d where d.org_id = v_org and d.dia between p_desde and p_ate), '[]'::jsonb),
    'grupos', coalesce((select jsonb_agg(jsonb_build_object('ad_group_id', x.ad_group_id, 'tipo', g.tipo,
               'status', g.status, 'cost', x.cost, 'clicks', x.clicks, 'prints', x.prints,
               'direct_amount', x.direct_amount, 'indirect_amount', x.indirect_amount, 'total_amount', x.total_amount,
               'membros', coalesce((select jsonb_agg(i.ml_item_id order by i.ml_item_id) from public.ml_ads_grupo_item i
                                     where i.org_id = v_org and i.ad_group_id = x.ad_group_id), '[]'::jsonb))
               order by x.cost desc, x.ad_group_id)
             from (select d.ad_group_id, sum(d.cost) cost, sum(d.clicks) clicks, sum(d.prints) prints,
                          sum(d.direct_amount) direct_amount, sum(d.indirect_amount) indirect_amount,
                          sum(d.total_amount) total_amount
                     from public.ml_ads_grupo_dia d
                    where d.org_id = v_org and d.dia between p_desde and p_ate
                    group by d.ad_group_id
                   having sum(d.cost) > 0 or sum(d.total_amount) > 0) x
             join public.ml_ads_grupo g on g.org_id = v_org and g.ad_group_id = x.ad_group_id), '[]'::jsonb));
end $$;

-- Aviso do dossiê SKU (D2): só os totais, sem a lista de grupos. O dossiê aceita períodos maiores (até 1 ano).
create function public.ads_resumo_periodo(p_desde date, p_ate date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := public.current_org_id();
begin
  if p_desde is null or p_ate is null or p_desde > p_ate or p_ate - p_desde > 365 then
    raise exception 'ads_resumo_periodo: período inválido (%, %)', p_desde, p_ate;
  end if;
  if v_org is null then raise exception 'ads_resumo_periodo: sem organização'; end if;
  return jsonb_build_object(
    'custo_conta', (select coalesce(sum(d.cost), 0) from public.ml_ads_conta_dia d
                     where d.org_id = v_org and d.dia between p_desde and p_ate),
    'dias_conta', (select count(*) from public.ml_ads_conta_dia d
                     where d.org_id = v_org and d.dia between p_desde and p_ate),
    'custo_grupos_com_membro', (select coalesce(sum(d.cost), 0) from public.ml_ads_grupo_dia d
                     where d.org_id = v_org and d.dia between p_desde and p_ate
                       and exists (select 1 from public.ml_ads_grupo_item i
                                    where i.org_id = v_org and i.ad_group_id = d.ad_group_id)));
end $$;

revoke all on function public.gravar_ads_conta_dias(uuid, timestamptz, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.gravar_ads_conta_dias(uuid, timestamptz, timestamptz, jsonb) to service_role;
revoke all on function public.ads_painel(date, date) from public, anon;
grant execute on function public.ads_painel(date, date) to authenticated;
revoke all on function public.ads_resumo_periodo(date, date) from public, anon;
grant execute on function public.ads_resumo_periodo(date, date) to authenticated;
```

O backfill de `allowed_menus` com `'ads'` **não** entra aqui: a edge `usuarios` atual descarta chaves desconhecidas ao salvar permissões (`supabase/functions/usuarios/index.ts:95`), então ele só vai numa 2ª migration depois do deploy da edge nova (Task 5, achado #11).

- [ ] **Step 5: Rodar o teste e ver passar**

Run: o mesmo comando do Step 3. Expected: `NOTICE: TESTE_OK`. Rodar também sem a migration (prova de vermelho) se usar a receita da Management API.

- [ ] **Step 6: Aplicar e conferir**

Run:
```bash
export SUPABASE_ACCESS_TOKEN="$(grep -m1 '^SUPABASE_ACCESS_TOKEN=' .env.local | cut -d= -f2-)"
supabase link --project-ref txvncrgkoynoxwopfkbp --yes < /dev/null
supabase db push --linked --dry-run --yes < /dev/null   # deve listar só <ts>_ads_painel.sql
supabase db push --linked --yes < /dev/null
npm run db:check
```
Expected: "Migrations alinhadas".

- [ ] **Step 6b: Desempenho com volume real (antes de ligar o módulo)** — pela Management API, numa transação desfeita, como um usuário da Avil:
```sql
begin; set local role authenticated;
set local request.jwt.claims = '{"sub":"<uuid de um usuário ativo da Avil>","role":"authenticated"}';
explain (analyze, buffers) select public.ads_painel(current_date - 90, current_date - 1);
rollback;
```
Na mesma transação: `explain (analyze, buffers) select public.ads_resumo_periodo(current_date - 366, current_date - 1);` (o limite suportado pelo dossiê).
Orçamento: **≤ 300 ms** de execução para cada uma, com o volume da Avil (~300 grupos, 90 dias no painel e 366 no resumo). Acima disso, trocar o subselect de membros por um `left join lateral` agregado e medir de novo; registrar o tempo no ADR-0179.

- [ ] **Step 7: Tipos**

Em `src/lib/database.types.ts`, adicionar `ml_ads_conta_dia` em `Tables` (Row/Insert/Update no padrão de `ml_ads_grupo_dia`), `conta_cobertura_desde: string | null` em `ml_ads_sync.Row` (opcional em Insert/Update) e em `Functions`:
```ts
ads_painel: { Args: { p_desde: string; p_ate: string }; Returns: Json }
ads_resumo_periodo: { Args: { p_desde: string; p_ate: string }; Returns: Json }
gravar_ads_conta_dias: { Args: { p_org: string; p_rodada: string; p_coletado_em: string; p_dias: Json }; Returns: boolean }
```
Run: `pnpm build` → PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/*_ads_painel.sql supabase/tests/ads_painel.sql src/lib/database.types.ts
git commit -m "feat(ads): série diária da conta e RPCs de leitura do painel (ADR-0179)"
```

---

### Task 2: Worker grava a série diária do anunciante

**Files:**
- Modify: `supabase/functions/_shared/ads/parsers.ts`, `supabase/functions/_shared/ads/fiacao.ts`, `supabase/functions/_shared/ads/sincronizar.ts`, `supabase/functions/coletar-ads-ml/deps.ts`
- Test: `supabase/functions/_shared/ads/__tests__/parsers.test.ts`, `supabase/functions/_shared/ads/__tests__/sincronizar.test.ts`

**Interfaces:**
- Consumes: RPC `gravar_ads_conta_dias` e coluna `conta_cobertura_desde` (Task 1).
- Produces:
  - `export interface DiaConta { dia: string; cost: number; clicks: number; prints: number; direct_amount: number; indirect_amount: number; total_amount: number }`
  - `export function parseSerieConta(corpo: unknown, janela: { desde: string; ate: string }): DiaConta[] | null`
  - `export const urlSerieConta = (adv: number, j: JanelaAds) => string`
  - `DepsAds.buscarSerieConta(advertiserId: number, janela: JanelaAds): Promise<RespostaML>`
  - `DepsAds.gravarContaDias(rodada: string, coletadoEm: string, dias: DiaConta[]): Promise<boolean>`
  - `DepsAds.lerEstadoSync(): Promise<{ cargaInicialOk: boolean; ultimoOkEm: string | null; contaCoberturaDesde: string | null }>`

- [ ] **Step 1: Testes do parser (vermelho)** — em `parsers.test.ts`:

```ts
describe('parseSerieConta', () => {
  const janela = { desde: '2026-09-01', ate: '2026-09-02' };
  const linha = (date: string, cost = 10) =>
    ({ date, cost, clicks: 1, prints: 100, direct_amount: 50, indirect_amount: 5, total_amount: 55 });
  it('série densa válida', () => {
    expect(parseSerieConta({ results: [linha('2026-09-02'), linha('2026-09-01', 0)] }, janela)).toEqual([
      { dia: '2026-09-01', cost: 0, clicks: 1, prints: 100, direct_amount: 50, indirect_amount: 5, total_amount: 55 },
      { dia: '2026-09-02', cost: 10, clicks: 1, prints: 100, direct_amount: 50, indirect_amount: 5, total_amount: 55 },
    ]);
  });
  it('dia faltando → null (nunca completa com zero)', () => {
    expect(parseSerieConta({ results: [linha('2026-09-01')] }, janela)).toBeNull();
  });
  it('dia fora da janela, repetido ou campo inválido → null', () => {
    expect(parseSerieConta({ results: [linha('2026-09-01'), linha('2026-09-03')] }, janela)).toBeNull();
    expect(parseSerieConta({ results: [linha('2026-09-01'), linha('2026-09-01')] }, janela)).toBeNull();
    expect(parseSerieConta({ results: [linha('2026-09-01'), { ...linha('2026-09-02'), cost: -1 }] }, janela)).toBeNull();
    expect(parseSerieConta({ nada: 1 }, janela)).toBeNull();
  });
});
```
Run: `pnpm vitest run supabase/functions/_shared/ads/__tests__/parsers.test.ts` → FAIL (`parseSerieConta` não existe).

- [ ] **Step 2: Implementar o parser** — em `parsers.ts`, depois de `parseSerieGrupo`:

```ts
export interface DiaConta {
  dia: string; cost: number; clicks: number; prints: number; direct_amount: number; indirect_amount: number;
  total_amount: number;
}

/** `…/campaigns/search?aggregation_type=DAILY` (total do anunciante, spike 054): densa como a do grupo. */
export function parseSerieConta(corpo: unknown, janela: { desde: string; ate: string }): DiaConta[] | null {
  if (!obj(corpo) || !Array.isArray(corpo.results)) return null;
  const porDia = new Map<string, DiaConta>();
  for (const r of corpo.results) {
    if (!obj(r) || typeof r.date !== 'string') return null;
    const dia = r.date.slice(0, 10);
    if (!DIA_RE.test(dia) || dia < janela.desde || dia > janela.ate || porDia.has(dia)) return null;
    const { cost, clicks, prints, direct_amount: direto, indirect_amount: indireto, total_amount: total } = r;
    if (!naoNeg(cost) || !inteiro(clicks) || !inteiro(prints) || !naoNeg(direto) || !naoNeg(indireto)
      || !naoNeg(total)) return null;
    porDia.set(dia, { dia, cost, clicks, prints, direct_amount: direto, indirect_amount: indireto, total_amount: total });
  }
  if (porDia.size !== diasNaJanela(janela)) return null;
  return [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}
```
Run: mesmo comando → PASS.

- [ ] **Step 3: URL** — em `fiacao.ts`, depois de `urlMembros`:

```ts
// Spike 054: o total do anunciante por dia; sem `error` no filtro some campanha com gasto (spike 053 §3.1).
export const STATUS_CAMPANHAS = 'active,paused,deleted,error';
export const urlSerieConta = (adv: number, j: JanelaAds) =>
  `${BASE}/advertisers/${adv}/product_ads/campaigns/search?limit=50&offset=0&${periodo(j)}`
  + `&metrics=clicks,prints,cost,direct_amount,indirect_amount,total_amount&aggregation_type=DAILY`
  + `&filters[status]=${STATUS_CAMPANHAS}`;
```
Teste em `fiacao.test.ts`: `expect(urlSerieConta(7, { desde: '2026-09-01', ate: '2026-09-02' })).toBe('/marketplace/advertising/MLB/advertisers/7/product_ads/campaigns/search?limit=50&offset=0&date_from=2026-09-01&date_to=2026-09-02&metrics=clicks,prints,cost,direct_amount,indirect_amount,total_amount&aggregation_type=DAILY&filters[status]=active,paused,deleted,error')`.

- [ ] **Step 4: Testes da orquestração (vermelho)** — em `sincronizar.test.ts`:

No topo, junto de `serie`:
```ts
const serieConta = (j: { desde: string; ate: string }) => ok({ results: diasDe(j).map((date) => ({
  date, clicks: 2, prints: 100, cost: 3, direct_amount: 20, indirect_amount: 5, total_amount: 25,
})) });
```
No `fake()`, mudar `lerEstadoSync` e acrescentar os dois métodos:
```ts
    lerEstadoSync: vi.fn(async () => ({ cargaInicialOk: true, ultimoOkEm: '2026-09-26T14:20:00Z', contaCoberturaDesde: '2026-06-29' })),
    buscarSerieConta: vi.fn(async (_adv: number, j: { desde: string; ate: string }) => serieConta(j)),
    gravarContaDias: vi.fn(async () => true),
```
(o teste de carga inicial existente, que sobrescreve `lerEstadoSync`, passa a incluir `contaCoberturaDesde: null`.)

Novos testes no `describe('sincronizarAdsOrg')`:
```ts
  it('série da conta: lida na janela relida e gravada antes de concluir ok', async () => {
    const d = fake();
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.buscarSerieConta).toHaveBeenCalledTimes(1);
    expect(d.buscarSerieConta).toHaveBeenCalledWith(1000001, JANELA_DIARIA);
    const [rodada, coletadoEm, dias] = d.gravarContaDias.mock.calls[0];
    expect([rodada, coletadoEm]).toEqual([RODADA, new Date(T0).toISOString()]);
    expect(dias).toHaveLength(15);
    expect(dias[0]).toEqual({ dia: '2026-09-12', cost: 3, clicks: 2, prints: 100, direct_amount: 20, indirect_amount: 5, total_amount: 25 });
    expect(d.gravarContaDias.mock.invocationCallOrder[0]).toBeLessThan(d.concluir.mock.invocationCallOrder[0]);
  });

  it('série da conta nunca coletada → lê 90 dias', async () => {
    const d = fake({ lerEstadoSync: vi.fn(async () => ({ cargaInicialOk: true, ultimoOkEm: '2026-09-26T14:20:00Z', contaCoberturaDesde: null })) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.buscarSerieConta).toHaveBeenCalledWith(1000001, JANELA_90);
    expect(d.gravarContaDias.mock.calls[0][2]).toHaveLength(90);
  });

  it('série da conta com dia faltando → rodada em erro, nada gravado, nunca ok', async () => {
    const d = fake({ buscarSerieConta: vi.fn(async () => ok({ results: [{ date: '2026-09-12', clicks: 0, prints: 0, cost: 0,
      direct_amount: 0, indirect_amount: 0, total_amount: 0 }] })) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'erro' });
    expect(d.gravarContaDias).not.toHaveBeenCalled();
    expect(d.concluir.mock.calls.some((c) => c[1] === 'ok')).toBe(false);
  });

  it('429 constante na série da conta tem teto de adiamento: presa, a rodada fecha em erro', async () => {
    const d = fake({ buscarGrupos: vi.fn(async () => busca([])), buscarSerieConta: vi.fn(async () => http(429, null, 120_000)) });
    expect(await sincronizarAdsOrg(d, { org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 5 }))
      .toEqual({ resultado: 'erro' });
    expect(d.continuar).not.toHaveBeenCalled();
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'erro', expect.stringContaining('série da conta'),
      { cargaConcluida: false, advertiserId: 1000001, coberturaDesde: null, custoResumo: null, custoListado: null });
  });

  it('429 na série da conta sem estar presa → continua (não conclui)', async () => {
    const d = fake({ buscarGrupos: vi.fn(async () => busca([])), buscarSerieConta: vi.fn(async () => http(429, null, 120_000)) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'continua' });
    expect(d.continuar).toHaveBeenCalledTimes(1);
    expect(d.concluir).not.toHaveBeenCalled();
  });

  it('403 na série da conta → sem_permissao', async () => {
    const d = fake({ buscarSerieConta: vi.fn(async () => http(403, { blocked_by: 'PolicyAgent' })) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'sem_permissao' });
    expect(d.concluir.mock.calls.at(-1)?.[1]).toBe('sem_permissao');
  });

  it('perdeu a posse ao gravar a série da conta → obsoleta, não conclui', async () => {
    const d = fake({ gravarContaDias: vi.fn(async () => false) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'obsoleta' });
    expect(d.concluir).not.toHaveBeenCalled();
  });

  // Armazenamento simulado compartilhado entre entregas: reproduz o estado persistido pela RPC
  // (upsert por dia; conta_cobertura_desde = 1º dia da 1ª gravação, depois não muda).
  function store() {
    const dias = new Map<string, number>();
    let cobertura: string | null = null;
    return {
      dias, get cobertura() { return cobertura; },
      gravar: vi.fn(async (_r: string, _c: string, ds: { dia: string; cost: number }[]) => {
        for (const x of ds) dias.set(x.dia, x.cost);
        cobertura ??= ds.length ? ds.map((x) => x.dia).sort()[0] : null;
        return true;
      }),
    };
  }

  it('backfill: concluir falha depois de gravar a conta; a reentrega relê a janela curta, sem duplicar, e conclui', async () => {
    const s = store();
    const estado = () => ({ cargaInicialOk: true, ultimoOkEm: '2026-09-26T14:20:00Z', contaCoberturaDesde: s.cobertura });
    const d1 = fake({ lerEstadoSync: vi.fn(async () => estado()), gravarContaDias: s.gravar,
      concluir: vi.fn(async () => { throw new Error('rede'); }) });
    expect(await sincronizarAdsOrg(d1, primeira)).toEqual({ resultado: 'erro' });
    expect(d1.buscarSerieConta).toHaveBeenCalledWith(1000001, JANELA_90);
    expect(s.dias.size).toBe(90);
    expect(s.cobertura).toBe('2026-06-29');
    const d2 = fake({ lerEstadoSync: vi.fn(async () => estado()), gravarContaDias: s.gravar });
    expect(await sincronizarAdsOrg(d2, primeira)).toEqual({ resultado: 'ok' });
    expect(d2.buscarSerieConta).toHaveBeenCalledWith(1000001, JANELA_DIARIA);   // cobertura preservada
    expect(s.dias.size).toBe(90);                                               // sem duplicar
    expect(s.cobertura).toBe('2026-06-29');
    expect(d2.concluir).toHaveBeenCalledWith(RODADA, 'ok', null, expect.objectContaining({ cargaConcluida: true }));
  });

  it('concluir devolve false (perdeu a posse ao fechar) → obsoleta, conta já gravada fica', async () => {
    const s = store();
    const d = fake({ gravarContaDias: s.gravar, concluir: vi.fn(async () => false) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'obsoleta' });
    expect(s.dias.size).toBe(15);
  });

  it('cadeia com 2 mensagens (teto de itens): a série da conta é lida só na última, uma vez', async () => {
    const muitos = Array.from({ length: 25 }, (_, i) => grupo(100 + i, 'ITEM'));
    const d = fake({ buscarGrupos: vi.fn(async (_a: number, j: { desde: string }) => (j.desde === JANELA_90.desde ? busca([]) : busca(muitos))) });
    const cfg = { limiteMs: 90_000, lote: 20, concorrencia: 6, maxItens: 20 };
    expect(await sincronizarAdsOrg(d, primeira, cfg)).toEqual({ resultado: 'continua' });
    expect(d.buscarSerieConta).not.toHaveBeenCalled();
    const msg = d.continuar.mock.calls[0][0];
    expect(await sincronizarAdsOrg(d, msg, cfg)).toEqual({ resultado: 'ok' });
    expect(d.buscarSerieConta).toHaveBeenCalledTimes(1);
  });
```
(no teste da cadeia, o `avancarCursor` do fake devolve `true` para qualquer cursor — como nos testes existentes de continuação; se o fake exigir a mesma `rodada`, a `msg` publicada já a carrega.)
Run: `pnpm vitest run supabase/functions/_shared/ads/__tests__/sincronizar.test.ts` → FAIL (os 6 novos). Se o `comRetry` esperar o `Retry-After` dentro do orçamento em vez de devolver `adiar` no teste "sem estar presa", ajustar o `Retry-After` para além do `limiteMs` (120_000 já é > 90_000).

- [ ] **Step 5: Implementar em `sincronizar.ts`**

1. Em `DepsAds` (linhas 39-61): `lerEstadoSync(): Promise<{ cargaInicialOk: boolean; ultimoOkEm: string | null; contaCoberturaDesde: string | null }>;` e os dois métodos novos da seção Interfaces; importar `parseSerieConta`/`DiaConta`.
2. Logo antes do `console.info('[ads] custo da janela'…)` (linha 335), inserir:

```ts
    // Spike 054: total diário do anunciante, que fecha o total da conta em qualquer período. Nunca coletada →
    // 90 dias; depois, a mesma janela relida dos grupos (encosta no último ok, cobre a atribuição em aberto).
    const janelaConta = estado.contaCoberturaDesde == null ? janelaMembros : janela;
    for (;;) {
      if (deps.agora() > fim) return preso() ? await fecharPreso('série da conta') : await continuar(cursor, 0);
      const r = await comRetry(deps, fim, () => deps.buscarSerieConta(adv, janelaConta));
      if ('adiar' in r) return preso() ? await fecharPreso('série da conta') : await continuar(cursor, r.adiar);
      exigir(r, 'campaigns/search (diária)');
      const dias = parseSerieConta(r.corpo, janelaConta);
      if (!dias) throw new Error('campaigns/search (diária): resposta inválida');
      if (!(await deps.gravarContaDias(dona, new Date(deps.agora()).toISOString(), dias))) return { resultado: 'obsoleta' };
      break;
    }
```
(roda na carga inicial também: lá `janela` já é de 90 dias.)

- [ ] **Step 6: `deps.ts`**

```ts
    async lerEstadoSync() {
      const { data, error } = await admin.from('ml_ads_sync')
        .select('carga_inicial_ok, ultimo_ok_em, conta_cobertura_desde').eq('org_id', orgId).maybeSingle();
      falhouRpc('lerEstadoSync', error);
      return {
        cargaInicialOk: data?.carga_inicial_ok === true,
        ultimoOkEm: (data?.ultimo_ok_em as string | null | undefined) ?? null,
        contaCoberturaDesde: (data?.conta_cobertura_desde as string | null | undefined) ?? null,
      };
    },
    buscarSerieConta: (adv, j) => get(urlSerieConta(adv, j), HEADERS_ADS),
    gravarContaDias: async (rodada, coletadoEm, dias) =>
      (await rpc('gravar_ads_conta_dias', { p_org: orgId, p_rodada: rodada, p_coletado_em: coletadoEm, p_dias: dias })) === true,
```
Run: `pnpm vitest run supabase/functions/_shared/ads` → PASS; `pnpm lint:functions && pnpm check:functions` → PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/ads supabase/functions/coletar-ads-ml
git commit -m "feat(ads): worker grava a série diária do anunciante (spike 054)"
```

- [ ] **Step 8: Deploy e prova (depois da Task 1 aplicada)**

Run: `supabase functions deploy coletar-ads-ml --project-ref txvncrgkoynoxwopfkbp < /dev/null` e conferir a versão nova (`supabase functions list`). Disparar o fan-out manual (runbook `docs/runbooks/coletar-ads-ml.md`) e conferir por SQL só-leitura: `select o.nome, s.estado, s.conta_cobertura_desde, count(d.*) from ml_ads_sync s join organizations o on o.id=s.org_id left join ml_ads_conta_dia d on d.org_id=s.org_id group by 1,2,3` → Avil/DSA/Daludi `ok` com 90 dias; Σ `cost` de 30 dias da Avil = valor do spike 054 recalculado para a nova janela (±R$0,01).
CPU (ADR-0173): consultar os logs da edge (endpoint de analytics, memória `reference_ops`) da 1ª execução (backfill de 90 dias) e da seguinte (diária) e registrar, por mensagem, CPU e duração; **toda mensagem < 2 s de CPU** e nenhum `546`/`CPU Time exceeded`. Se a mensagem final passar perto do teto, mover a leitura da série para uma mensagem própria (continuação com `cursor = 'conta'` e dedup `ads:org:rodada:conta:tentativa`) antes de seguir.

---

### Task 3: Regra pura do painel (`src/lib/ads-painel.ts`)

**Files:**
- Create: `src/lib/ads-painel.ts`
- Test: `tests/lib/ads-painel.test.ts`

**Interfaces:**
- Consumes: `atribuicaoFinal` de `src/lib/sku-ads.ts`; `FonteCusto` de `src/lib/vendas-sku.ts`.
- Produces:

```ts
export interface SyncPainel {
  estado: string; erro: string | null; ultimo_ok_em: string | null; carga_inicial_ok: boolean;
  cobertura_desde: string | null; conta_cobertura_desde: string | null;
}
export interface ContaDia { dia: string; cost: number; clicks: number; prints: number; direct_amount: number;
  indirect_amount: number; total_amount: number; coletado_em: string }
export interface GrupoPainel { ad_group_id: number; tipo: 'ITEM' | 'FAMILY' | 'CATALOG'; status: string; cost: number;
  clicks: number; prints: number; direct_amount: number; indirect_amount: number; total_amount: number; membros: string[] }
export interface FontePainelAds { sync: SyncPainel | null; conta: ContaDia[]; grupos: GrupoPainel[] }
export interface LucroFamilia { nome: string | null; lucro: number | null; brutoComCusto: number; fonteCusto: FonteCusto }
export interface MetricasAds { custo: number; vendasDiretas: number; vendasTotais: number; cliques: number;
  impressoes: number; roas: number | null; roasDireto: number | null; acos: number | null }
export type EstadoPainel = 'sem_coleta' | 'sem_permissao' | 'sem_advertiser' | 'sem_acesso' | 'coletando' | 'sem_ads' | 'ok';
export type Semaforo = 'dentro' | 'acima' | 'sem_espaco';
export type MotivoFamilia = 'compartilhado' | 'cobertura' | 'historico' | 'sem_vendas' | 'sem_custo' | 'custo_parcial' | null;
export interface FamiliaPainel extends MetricasAds {
  codigoPai: string; nome: string | null; grupos: number;
  custoCompartilhado: number;           // Σ dos grupos compartilhados que tocam esta família (NÃO somado em `custo`)
  lucroAntes: number | null; resultado: number | null; margemConsumida: number | null;
  acosDireto: number | null;            // custo ÷ vendas diretas — a base do semáforo
  acosEquilibrio: number | null; semaforo: Semaforo | null; motivo: MotivoFamilia;
  fonteCusto: FonteCusto | null;
}
export interface ContaPainel extends MetricasAds {
  lucroAntes: number | null; resultado: number | null; margemConsumida: number | null; fonteCusto: FonteCusto | null;
  emFamilias: number; compartilhado: number;
  naoIdentificado: number | null; naoIdentificadoPct: number | null;   // null quando divergente
  divergente: boolean;                  // Σ grupos com membro > total da conta + R$0,01: decomposição suspensa
  diasAbertos: number;
}
export interface PainelAds {
  estado: EstadoPainel; desatualizado: boolean;
  gruposCobertos: boolean;              // período inteiro dentro da cobertura dos grupos (mesma regra do dossiê)
  semaforoLiberado: boolean;            // = baseAcosValidada
  conta: ContaPainel | null;            // null = série da conta não cobre o período
  contaMotivo: 'cobertura' | null;
  familias: FamiliaPainel[];            // ordenadas por custo desc
  compartilhados: { id: number; custo: number; familias: string[]; semCodigo: number }[];
}
export function montarPainelAds(p: {
  fonte: FontePainelAds; janela: { desde: string; ate: string };   // dias BRT 'YYYY-MM-DD'
  codigosPorMlb: Map<string, string[]>;           // de buscarCodigosMlbs
  familiaDoCodigo: Map<string, string>;           // código → codigoPai (catálogo)
  lucroPorFamilia: Map<string, LucroFamilia>;     // codigoPai → lucro do período (só famílias com linha de venda)
  lucroConta: { lucro: number | null; fonteCusto: FonteCusto };
  historicoDesde: string | null;                  // VendasSku.historicoDesde (ISO) — antes dele não há venda conhecida
  baseAcosValidada: boolean;                      // BASE_ACOS_VALIDADA (spike 055)
  agora: Date;
}): PainelAds
export const BASE_ACOS_VALIDADA = false;          // vira true no commit que registra o spike 055 aprovado
```

Regras (cada uma com teste):
- **Bucket do grupo:** `membros` vazio → **não identificado**. Todo MLB com códigos e todos os códigos na **mesma** família → essa família. Qualquer MLB sem código, código sem família, ou 2+ famílias → **compartilhado** (`semCodigo` = MLBs sem código + códigos sem família); as famílias resolvidas desse grupo recebem o custo dele em `custoCompartilhado`.
- **Família tocada por grupo compartilhado** (`custoCompartilhado > 0`): parte da despesa dela é desconhecida → `resultado`, `margemConsumida` e `semaforo` = `null`, `motivo = 'compartilhado'`. Gasto e métricas dos grupos exclusivos continuam visíveis (rótulo "só dos grupos exclusivos"). Nunca ratear.
- **Conta (em centavos inteiros):** cada valor vira `c = Math.round(x * 100)` antes de somar. `custoC` = Σ `conta[].cost` em centavos; `somaGruposC` = Σ grupos com membro em centavos. Se `somaGruposC > custoC` (**um centavo a mais já é divergência**; não há tolerância além do arredondamento para centavo) → `divergente = true`, `naoIdentificado = null`, `naoIdentificadoPct = null` (valores observados mantidos, aviso; nada é ajustado). Senão `naoIdentificadoC = custoC − emFamiliasC − compartilhadoC` (inclui os grupos sem membro) e a identidade `emFamiliasC + compartilhadoC + naoIdentificadoC === custoC` vale exatamente; os campos expostos são `centavos / 100`. `naoIdentificadoPct = custoC > 0 ? naoIdentificadoC / custoC : null`.
- **Cobertura da conta:** `conta_cobertura_desde == null || > janela.desde || conta.length < diasNaJanela` → `conta = null`, `contaMotivo = 'cobertura'`.
- **Cobertura dos grupos** (mesma regra de `src/lib/sku-ads.ts:126-131`): `ultimoDia = diaBRT(ultimo_ok_em) − 1`; coberto se todo dia da janela ∈ [`cobertura_desde`, `ultimoDia`] e `carga_inicial_ok`. Descoberto → `gruposCobertos = false` e toda família com `resultado/semaforo = null`, `motivo = 'cobertura'` (gasto parcial nunca vira resultado).
- **Histórico de vendas:** o banco não tem marcador de cobertura das vendas; o único marco é `VendasSku.historicoDesde` = primeira venda faturável registrada na org (ADR-0172 D-2, `vendas-sku.ts:459`). Regra: comparar **ISO com ISO** — `historicoDesde == null || Date.parse(historicoDesde) > Date.parse(janelaBRT(janela.desde, janela.ate).desde)` → lucro desconhecido → toda família e a conta com `lucroAntes = null`, `motivo = 'historico'`. Um histórico que começa no meio do 1º dia do período bloqueia (não libera o dia inteiro). Limite assumido e documentado no ADR-0179: dentro do histórico, ausência de venda é tratada como zero (mesma premissa do Vendas SKU).
- **Conta sem nenhuma venda faturável** (histórico coberto): `lucroConta` chega como `{ lucro: 0, fonteCusto: 'real' }` (o hook decide, ver Task 4) → `lucroAntes = 0`, `resultado = −custo`. Distinto de `sem_custo` (null) e de `historico` (null).
- **Base do ACOS validada:** parâmetro `baseAcosValidada: boolean` (constante `BASE_ACOS_VALIDADA` exportada de `ads-painel.ts`, **`false`** até o spike 055 aprovar na Task 7). Com `false`: `acosEquilibrio` é exibido, mas `semaforo = null` em todas as famílias e `PainelAds.semaforoLiberado = false` (a tela diz "semáforo em validação"). Os motivos de família não mudam.
- **Métricas por Σ:** `roas = vendasTotais / custo`, `roasDireto = vendasDiretas / custo`, `acos = custo / vendasTotais`, `acosDireto = custo / vendasDiretas`; denominador 0 → `null`.
- **Lucro da família** (precedência, primeiro que casar): ausente do mapa → `lucroAntes = 0`, `motivo = 'sem_vendas'`; `lucro == null && fonteCusto === 'sem_custo'` → `null`, `'sem_custo'`; `lucro == null` (só canceladas/devolvidas) → `0`, `'sem_vendas'`; `fonteCusto === 'parcial'` → lucro mostrado, mas `acosEquilibrio`/`semaforo = null`, `'custo_parcial'` (base não comparável).
- `resultado = lucroAntes − custo` (null se lucroAntes null). `margemConsumida = lucroAntes > 0 ? custo / lucroAntes : null`.
- **ACOS de equilíbrio e semáforo:** `acosEquilibrio = brutoComCusto > 0 && lucroAntes != null ? lucroAntes / brutoComCusto : null`. O semáforo compara com o **ACOS direto** (venda direta é do próprio anúncio; a indireta é de outros produtos, com outra margem). `acosEquilibrio == null → null`; `≤ 0 → 'sem_espaco'`; `vendasDiretas == 0 → 'acima'`; senão `acosDireto ≤ acosEquilibrio ? 'dentro' : 'acima'`. A tela mostra os dois ACOS.
- **Conta:** `lucroAntes = lucroConta.lucro` (null se `sem_custo` ou histórico); `resultado = lucroAntes − custo da conta` (todo o gasto, inclusive não identificado).
- `diasAbertos` = dias da conta com `!atribuicaoFinal(dia, coletado_em)`.
- **Estado — precedência:** (1) `sync == null` → `sem_coleta`; (2) `sync.estado ∈ {sem_permissao, sem_advertiser, sem_acesso}` → o próprio (vale antes da carga inicial, como `sku-ads.ts:123`); (3) `!carga_inicial_ok` → `coletando`; (4) custo da conta = 0 **com a conta coberta** e nenhum grupo com custo → `sem_ads` (sem cobertura nunca afirma zero); (5) `ok`. `desatualizado = ultimo_ok_em == null || agora − ultimo_ok_em > 48 h`.

- [ ] **Step 1: Testes (vermelho)** — `tests/lib/ads-painel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { montarPainelAds, type FontePainelAds, type GrupoPainel } from '@/lib/ads-painel';

const janela = { desde: '2026-09-01', ate: '2026-09-02' };
const agora = new Date('2026-10-04T15:00:00-03:00');
const dia = (d: string, cost: number, total = 0, direct = 0) =>
  ({ dia: d, cost, clicks: 0, prints: 0, direct_amount: direct, indirect_amount: total - direct, total_amount: total,
     coletado_em: '2026-10-04T12:00:00Z' });
const grupo = (id: number, cost: number, membros: string[], total = 0, direct = 0): GrupoPainel =>
  ({ ad_group_id: id, tipo: 'FAMILY', status: 'ACTIVE', cost, clicks: 0, prints: 0, direct_amount: direct,
     indirect_amount: total - direct, total_amount: total, membros });
const sync = { estado: 'ok', erro: null, ultimo_ok_em: '2026-10-04T14:00:00Z', carga_inicial_ok: true,
  cobertura_desde: '2026-06-29', conta_cobertura_desde: '2026-06-29' };
const base = (f: Partial<FontePainelAds> = {}) => ({
  fonte: { sync, conta: [dia('2026-09-01', 60), dia('2026-09-02', 40)], grupos: [], ...f },
  janela, agora, historicoDesde: '2026-01-01T03:00:00.000Z', baseAcosValidada: true,
  codigosPorMlb: new Map([['MLB1', ['A1']], ['MLB2', ['A2']], ['MLB3', ['B1']], ['MLB4', []]]),
  familiaDoCodigo: new Map([['A1', 'A'], ['A2', 'A'], ['B1', 'B']]),
  lucroPorFamilia: new Map([['A', { nome: 'Fam A', lucro: 250, brutoComCusto: 1000, fonteCusto: 'real' as const }]]),
  lucroConta: { lucro: 300, fonteCusto: 'real' as const },
});

describe('montarPainelAds', () => {
  it('grupo com 2 cores da mesma família vai inteiro para a família; semáforo pelo ACOS direto', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 80, ['MLB1', 'MLB2'], 800, 700)] }));
    expect(p.familias).toHaveLength(1);
    expect(p.familias[0]).toMatchObject({ codigoPai: 'A', custo: 80, vendasTotais: 800, roas: 10, roasDireto: 8.75,
      acos: 0.1, lucroAntes: 250, resultado: 170, margemConsumida: 0.32, acosEquilibrio: 0.25, semaforo: 'dentro',
      custoCompartilhado: 0, motivo: null });
    expect(p.familias[0].acosDireto).toBeCloseTo(80 / 700);
  });
  it('identidade exata: famílias + compartilhado + não identificado = total da conta', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 50, ['MLB1']), grupo(2, 20, ['MLB1', 'MLB3']), grupo(3, 10, [])] }));
    const c = p.conta!;
    expect(c).toMatchObject({ custo: 100, emFamilias: 50, compartilhado: 20, naoIdentificado: 30, naoIdentificadoPct: 0.3,
      divergente: false, resultado: 200 });
    expect(c.emFamilias + c.compartilhado + c.naoIdentificado!).toBe(c.custo);
    expect(p.compartilhados[0]).toMatchObject({ id: 2, familias: ['A', 'B'], semCodigo: 0 });
  });
  it('família tocada por grupo compartilhado: gasto exclusivo visível, resultado bloqueado, sem rateio', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 50, ['MLB1'], 500, 500), grupo(2, 20, ['MLB1', 'MLB3'])] }));
    const a = p.familias.find((f) => f.codigoPai === 'A')!;
    expect(a).toMatchObject({ custo: 50, custoCompartilhado: 20, resultado: null, margemConsumida: null, semaforo: null,
      motivo: 'compartilhado' });
  });
  it('MLB sem código → compartilhado, nunca a família', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 50, ['MLB1', 'MLB4'])] }));
    expect(p.familias.find((f) => f.codigoPai === 'A')?.custo ?? 0).toBe(0);
    expect(p.compartilhados[0]).toMatchObject({ semCodigo: 1 });
  });
  it('grupos acima da conta → divergente: nada ajustado, não identificado indisponível', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 101, ['MLB1'])] }));
    expect(p.conta).toMatchObject({ custo: 100, emFamilias: 101, divergente: true, naoIdentificado: null, naoIdentificadoPct: null });
  });
  it('um centavo acima da conta já é divergência', () => {
    expect(montarPainelAds(base({ grupos: [grupo(1, 100.01, ['MLB1'])] })).conta?.divergente).toBe(true);
  });
  it('ruído de ponto flutuante abaixo do centavo não é divergência, e a identidade fecha em centavos', () => {
    const p = montarPainelAds(base({ conta: [dia('2026-09-01', 0.1), dia('2026-09-02', 0.2)],
      grupos: [grupo(1, 0.1, ['MLB1']), grupo(2, 0.2 + 1e-12, ['MLB3'])] }));
    const c = p.conta!;
    expect(c.divergente).toBe(false);
    expect(Math.round(c.emFamilias * 100) + Math.round(c.compartilhado * 100) + Math.round(c.naoIdentificado! * 100))
      .toBe(Math.round(c.custo * 100));
    expect(c.naoIdentificado).toBe(0);
  });
  it('série da conta sem cobrir o período → conta null, famílias continuam', () => {
    const p = montarPainelAds(base({ conta: [dia('2026-09-02', 40)], grupos: [grupo(1, 50, ['MLB1'])] }));
    expect(p.conta).toBeNull();
    expect(p.contaMotivo).toBe('cobertura');
    expect(p.familias).toHaveLength(1);
  });
  it('grupos sem cobertura do período (coleta ainda não leu ontem) → resultado e semáforo indisponíveis', () => {
    const p = montarPainelAds(base({ sync: { ...sync, ultimo_ok_em: '2026-09-02T14:00:00Z' }, grupos: [grupo(1, 50, ['MLB1'], 500, 500)] }));
    expect(p.gruposCobertos).toBe(false);
    expect(p.familias[0]).toMatchObject({ resultado: null, semaforo: null, motivo: 'cobertura' });
  });
  it('período antes do histórico de vendas → lucro desconhecido, nunca zero', () => {
    const b = base({ grupos: [grupo(1, 30, ['MLB3'])] });
    b.historicoDesde = '2026-09-02T03:00:00.000Z';
    const p = montarPainelAds(b);
    expect(p.familias[0]).toMatchObject({ lucroAntes: null, resultado: null, motivo: 'historico' });
    expect(p.conta?.lucroAntes).toBeNull();
  });
  it('histórico começando no meio do 1º dia do período bloqueia (ISO, não dia)', () => {
    const b = base({ grupos: [grupo(1, 30, ['MLB3'])] });
    b.historicoDesde = '2026-09-01T15:00:00.000Z';   // 12:00 BRT do 1º dia
    expect(montarPainelAds(b).familias[0].motivo).toBe('historico');
    b.historicoDesde = '2026-09-01T03:00:00.000Z';   // 00:00 BRT exato: coberto
    expect(montarPainelAds(b).familias[0].motivo).toBe('sem_vendas');
  });
  it('conta sem nenhuma venda faturável: lucro 0, resultado −despesa', () => {
    const b = base();
    b.lucroConta = { lucro: 0, fonteCusto: 'real' };
    b.lucroPorFamilia = new Map();
    expect(montarPainelAds(b).conta).toMatchObject({ lucroAntes: 0, resultado: -100 });
  });
  it('base do ACOS não validada: equilíbrio exibido, semáforo desligado', () => {
    const b = base({ grupos: [grupo(1, 80, ['MLB1', 'MLB2'], 800, 700)] });
    b.baseAcosValidada = false;
    const p = montarPainelAds(b);
    expect(p.semaforoLiberado).toBe(false);
    expect(p.familias[0]).toMatchObject({ acosEquilibrio: 0.25, semaforo: null, motivo: null });
  });
  it('família com gasto e sem venda: lucro 0, resultado −gasto, sem equilíbrio', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 30, ['MLB3'])] }));
    expect(p.familias[0]).toMatchObject({ codigoPai: 'B', lucroAntes: 0, resultado: -30, acosEquilibrio: null,
      semaforo: null, motivo: 'sem_vendas', roas: 0, acos: null });
  });
  it('família só com canceladas/devolvidas (lucro null, fonte real) → sem vendas', () => {
    const b = base({ grupos: [grupo(1, 10, ['MLB1'])] });
    b.lucroPorFamilia.set('A', { nome: 'Fam A', lucro: null, brutoComCusto: 0, fonteCusto: 'real' });
    expect(montarPainelAds(b).familias[0]).toMatchObject({ lucroAntes: 0, motivo: 'sem_vendas' });
  });
  it('margem ≤ 0 → sem espaço para Ads', () => {
    const b = base({ grupos: [grupo(1, 10, ['MLB1'], 100, 100)] });
    b.lucroPorFamilia.set('A', { nome: 'Fam A', lucro: -5, brutoComCusto: 100, fonteCusto: 'real' });
    expect(montarPainelAds(b).familias[0].semaforo).toBe('sem_espaco');
  });
  it('ACOS direto acima do equilíbrio → acima (mesmo com ACOS total dentro)', () => {
    const f = montarPainelAds(base({ grupos: [grupo(1, 300, ['MLB1'], 2000, 1000)] })).familias[0];
    expect(f.acos).toBe(0.15);
    expect(f.semaforo).toBe('acima');
  });
  it('custo parcial → lucro mostrado, semáforo indisponível', () => {
    const b = base({ grupos: [grupo(1, 10, ['MLB1'], 100, 100)] });
    b.lucroPorFamilia.set('A', { nome: 'Fam A', lucro: 20, brutoComCusto: 80, fonteCusto: 'parcial' });
    expect(montarPainelAds(b).familias[0]).toMatchObject({ lucroAntes: 20, acosEquilibrio: null, semaforo: null, motivo: 'custo_parcial' });
  });
  it('sem custo cadastrado → lucro null com motivo', () => {
    const b = base({ grupos: [grupo(1, 10, ['MLB1'], 100)] });
    b.lucroPorFamilia.set('A', { nome: 'Fam A', lucro: null, brutoComCusto: 0, fonteCusto: 'sem_custo' });
    expect(montarPainelAds(b).familias[0]).toMatchObject({ lucroAntes: null, resultado: null, motivo: 'sem_custo' });
  });
  it('dias com atribuição em aberto contam como provisórios', () => {
    const p = montarPainelAds(base({ conta: [{ ...dia('2026-09-01', 60), coletado_em: '2026-09-05T12:00:00Z' },
      dia('2026-09-02', 40)] }));
    expect(p.conta?.diasAbertos).toBe(1);
  });
  it('estados na ordem de precedência', () => {
    expect(montarPainelAds(base({ sync: null })).estado).toBe('sem_coleta');
    expect(montarPainelAds(base({ sync: { ...sync, estado: 'sem_advertiser', carga_inicial_ok: false } })).estado).toBe('sem_advertiser');
    expect(montarPainelAds(base({ sync: { ...sync, carga_inicial_ok: false } })).estado).toBe('coletando');
    expect(montarPainelAds(base({ conta: [dia('2026-09-01', 0), dia('2026-09-02', 0)] })).estado).toBe('sem_ads');
    expect(montarPainelAds(base({ conta: [dia('2026-09-02', 0)] })).estado).toBe('ok');   // sem cobertura não afirma zero
    expect(montarPainelAds(base({ sync: { ...sync, ultimo_ok_em: '2026-10-01T00:00:00Z' } })).desatualizado).toBe(true);
  });
  it('famílias ordenadas por gasto', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 10, ['MLB1']), grupo(2, 50, ['MLB3'])] }));
    expect(p.familias.map((f) => f.codigoPai)).toEqual(['B', 'A']);
  });
});
```
Run: `pnpm vitest run tests/lib/ads-painel.test.ts` → FAIL (módulo não existe).

Depois da Task 4, acrescentar em `tests/lib/ads-painel.test.ts` um teste de integração **sem mock** que monta `lucroPorFamilia` a partir de `agruparPorFamilia(montarVendasSku(...).linhas)` com 1 kit, 1 devolução e 1 item sem custo (reusar as fixtures de `tests/lib/vendas-sku.test.ts`) e confere `brutoComCusto`, `fonteCusto` e o motivo resultante.

- [ ] **Step 2: Implementar `src/lib/ads-painel.ts`** seguindo as regras acima (funções pequenas: `bucketDoGrupo`, `somarMetricas`, `lucroDaFamilia`, `semaforo`, `estadoDo`; `round2` local; `diaBRT` e a regra `coberto` copiadas de `src/lib/sku-ads.ts` — exportar de lá em vez de duplicar). Toda a conta da reconciliação em **centavos inteiros** (`Math.round(x * 100)`), sem tolerância extra; só a saída volta para reais. Comentário de topo citando ADR-0179 D1–D4 e spikes 053/054.

- [ ] **Step 3: Rodar** → PASS. `pnpm lint` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ads-painel.ts tests/lib/ads-painel.test.ts
git commit -m "feat(ads): regra do painel — conta, famílias, compartilhado e não identificado"
```

---

### Task 4: Dados e hook do painel

**Files:**
- Create: `src/lib/ads-painel-dados.ts`, `src/hooks/useAdsPainel.ts`
- Modify: `src/hooks/useVendasSku.ts` (2º parâmetro opcional `janelaFixa`; os consumidores atuais não mudam)
- Test: `tests/lib/ads-painel-dados.test.ts`, `src/hooks/__tests__/useAdsPainel.test.ts`, `src/hooks/__tests__/useVendasSku.test.ts` (o existente, se houver; senão criar)

Por que `janelaFixa`: `resolverJanela` monta o `range` com `new Date('YYYY-MM-DDT00:00:00')` na hora **local do navegador** (`src/lib/metricas.ts:42`): em Manaus ou UTC o dia BRT sai deslocado (achado #4 do Astra). Em vez de mudar `resolverJanela` para todos, o painel passa a janela ISO BRT pronta.

**Interfaces:**
- Consumes: `montarPainelAds`, tipos (Task 3); `buscarCodigosMlbs(mlbs: string[]): Promise<Map<string, string[]>>` (`src/lib/sku-dossie-dados.ts`); `useVendasSku(periodo: Periodo)`; `agruparPorFamilia`, `somarAcumuladores`, `metricas` (`src/lib/vendas-sku.ts`); `useCatalogoVendasSku`.
- Produces:
  - `export type DiasAds = 7 | 30 | 90;`
  - `export function periodoAds(dias: DiasAds, agora: Date): { desde: string; ate: string }` (datas BRT `YYYY-MM-DD`, `ate` = ontem)
  - `export function janelaBRT(desde: string, ate: string): Janela` (`{ desde: '<desde>T03:00:00.000Z', ate: '<ate+1>T02:59:59.999Z' }`, independente do fuso do navegador)
  - `useVendasSku(periodo: Periodo, janelaFixa?: Janela)` — com `janelaFixa`, usa-a no lugar de `resolverJanela(periodo)`
  - `export async function buscarPainelAds(desde: string, ate: string): Promise<FontePainelAds>`
  - `export function useAdsPainel(dias: DiasAds): { painel: PainelAds | null; janela: { desde: string; ate: string }; isLoading: boolean; isError: boolean; refetch: () => void }`

- [ ] **Step 1: Testes (vermelho)**

`tests/lib/ads-painel-dados.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
import { buscarPainelAds, janelaBRT, periodoAds } from '@/lib/ads-painel-dados';
import { dentroDaJanela } from '@/lib/metricas';   // conferir onde `dentroDaJanela` é exportado (usado em vendas-sku.ts:430)

describe('periodoAds', () => {
  it('30 dias inteiros terminando ontem (BRT), mesmo às 00:30', () => {
    expect(periodoAds(30, new Date('2026-10-04T00:30:00-03:00'))).toEqual({ desde: '2026-09-04', ate: '2026-10-03' });
    expect(periodoAds(7, new Date('2026-10-04T23:50:00-03:00'))).toEqual({ desde: '2026-09-27', ate: '2026-10-03' });
  });
});
describe('janelaBRT', () => {
  it('limites BRT exatos, iguais em qualquer fuso do navegador', () => {
    expect(janelaBRT('2026-09-04', '2026-10-03')).toEqual({ desde: '2026-09-04T03:00:00.000Z', ate: '2026-10-04T02:59:59.999Z' });
  });
  it('vira o mês e o ano', () => {
    expect(janelaBRT('2026-12-31', '2026-12-31')).toEqual({ desde: '2026-12-31T03:00:00.000Z', ate: '2027-01-01T02:59:59.999Z' });
  });
  it('venda às 23:30 BRT de ontem entra; 00:10 BRT de hoje fica fora', () => {
    const j = janelaBRT('2026-09-04', '2026-10-03');
    expect(dentroDaJanela('2026-10-03T23:30:00-03:00', j)).toBe(true);
    expect(dentroDaJanela('2026-10-04T00:10:00-03:00', j)).toBe(false);
  });
});
describe('buscarPainelAds', () => {
  it('converte numeric (string) para number', async () => {
    rpc.mockResolvedValue({ data: { sync: null, conta: [{ dia: '2026-09-01', cost: '1.5', clicks: 1, prints: 2,
      direct_amount: '0', indirect_amount: '0', total_amount: '3', coletado_em: 'x' }], grupos: [] }, error: null });
    const f = await buscarPainelAds('2026-09-01', '2026-09-01');
    expect(rpc).toHaveBeenCalledWith('ads_painel', { p_desde: '2026-09-01', p_ate: '2026-09-01' });
    expect(f.conta[0].cost).toBe(1.5);
    expect(f.conta[0].total_amount).toBe(3);
  });
  it('erro da RPC propaga', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(buscarPainelAds('2026-09-01', '2026-09-01')).rejects.toThrow('boom');
  });
});
```
`src/hooks/__tests__/useAdsPainel.test.ts`: mockar `@/lib/ads-painel-dados` (`buscarPainelAds`), `@/lib/sku-dossie-dados` (`buscarCodigosMlbs`), `@/hooks/useVendasSku` e o hook do catálogo com `vi.hoisted` (padrão de `src/hooks/__tests__/useSkuDossie.test.ts`) e provar: (a) `useVendasSku` recebe `({ tipo: 'range', desde, ate }, janelaBRT(desde, ate))` com os mesmos dias da janela do Ads; (a2) `montarPainelAds` recebe `historicoDesde` de `vendas.dados.historicoDesde`; (a3) em `useVendasSku.test`, com `janelaFixa` a query de vendas usa exatamente aquela janela e sem ela o comportamento atual não muda; (a4) com `vendas.dados.linhas` vazio (`pedidos === 0`), `montarPainelAds` recebe `lucroConta = { lucro: 0, fonteCusto: 'real' }`; com vendas só sem custo, recebe `{ lucro: null, fonteCusto: 'sem_custo' }`; (b) `buscarCodigosMlbs` recebe os MLBs únicos e ordenados de todos os grupos; (c) `painel` fica `null` até vendas, catálogo e códigos chegarem; (d) erro em qualquer fonte → `isError`.

Run: `pnpm vitest run tests/lib/ads-painel-dados.test.ts src/hooks/__tests__/useAdsPainel.test.ts` → FAIL.

- [ ] **Step 2: Implementar `src/lib/ads-painel-dados.ts`**

```ts
import { supabase } from '@/lib/supabase';
import type { FontePainelAds } from '@/lib/ads-painel';
import type { Janela } from '@/lib/metricas';   // conferir onde o tipo Janela é exportado

export type DiasAds = 7 | 30 | 90;
const diaBRT = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const somarDias = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Dias BRT inteiros terminando ontem: o Ads não tem o dia de hoje (spike 053 §3.2), então as vendas também não. */
export function periodoAds(dias: DiasAds, agora: Date): { desde: string; ate: string } {
  const ate = somarDias(diaBRT(agora), -1);
  return { desde: somarDias(ate, -(dias - 1)), ate };
}

/** Dias BRT → janela ISO com offset fixo (Brasil sem horário de verão desde 2019): não depende do fuso do navegador. */
export function janelaBRT(desde: string, ate: string): Janela {
  return { desde: new Date(`${desde}T00:00:00-03:00`).toISOString(), ate: new Date(`${ate}T23:59:59.999-03:00`).toISOString() };
}

const num = (v: unknown) => Number(v ?? 0);
export async function buscarPainelAds(desde: string, ate: string): Promise<FontePainelAds> {
  const { data, error } = await supabase.rpc('ads_painel', { p_desde: desde, p_ate: ate });
  if (error) throw new Error(error.message);
  const r = data as { sync: FontePainelAds['sync']; conta: Record<string, unknown>[]; grupos: Record<string, unknown>[] };
  return {
    sync: r.sync,
    conta: r.conta.map((d) => ({ dia: String(d.dia), cost: num(d.cost), clicks: num(d.clicks), prints: num(d.prints),
      direct_amount: num(d.direct_amount), indirect_amount: num(d.indirect_amount), total_amount: num(d.total_amount),
      coletado_em: String(d.coletado_em) })),
    grupos: r.grupos.map((g) => ({ ad_group_id: num(g.ad_group_id), tipo: g.tipo as 'ITEM' | 'FAMILY' | 'CATALOG',
      status: String(g.status), cost: num(g.cost), clicks: num(g.clicks), prints: num(g.prints),
      direct_amount: num(g.direct_amount), indirect_amount: num(g.indirect_amount), total_amount: num(g.total_amount),
      membros: (g.membros as string[]) ?? [] })),
  };
}
```

- [ ] **Step 3: Implementar `src/hooks/useAdsPainel.ts`**

```ts
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { buscarPainelAds, janelaBRT, periodoAds, type DiasAds } from '@/lib/ads-painel-dados';
import { BASE_ACOS_VALIDADA, montarPainelAds, type LucroFamilia } from '@/lib/ads-painel';
import { buscarCodigosMlbs } from '@/lib/sku-dossie-dados';
import { useVendasSku } from '@/hooks/useVendasSku';
import { useCatalogoVendasSku } from '@/hooks/useCatalogoVendasSku';   // conferir o caminho real do hook
import { agruparPorFamilia, metricas, somarAcumuladores } from '@/lib/vendas-sku';

export function useAdsPainel(dias: DiasAds) {
  const janela = useMemo(() => periodoAds(dias, new Date()), [dias]);
  const periodoRange = useMemo(() => ({ tipo: 'range' as const, ...janela }), [janela]);
  const janelaVendas = useMemo(() => janelaBRT(janela.desde, janela.ate), [janela]);
  const vendas = useVendasSku(periodoRange, janelaVendas);
  const catQ = useCatalogoVendasSku();
  const fonteQ = useQuery({ queryKey: ['ads-painel', janela], queryFn: () => buscarPainelAds(janela.desde, janela.ate),
    staleTime: 5 * 60_000 });
  const mlbs = useMemo(() => [...new Set((fonteQ.data?.grupos ?? []).flatMap((g) => g.membros))].sort(), [fonteQ.data]);
  const codQ = useQuery({ queryKey: ['ads-painel-codigos', mlbs], queryFn: () => buscarCodigosMlbs(mlbs),
    enabled: fonteQ.isSuccess, staleTime: 5 * 60_000 });

  const painel = useMemo(() => {
    if (!fonteQ.data || !codQ.data || !catQ.data || !vendas.dados) return null;
    const lucroPorFamilia = new Map<string, LucroFamilia>(agruparPorFamilia(vendas.dados.linhas).map((f) =>
      [f.codigoPai, { nome: f.nomeFamilia, lucro: f.m.lucro, brutoComCusto: f.acc.brutoComCusto, fonteCusto: f.m.fonteCusto }]));
    const acc = somarAcumuladores(vendas.dados.linhas.map((l) => l.acc));
    const total = metricas(acc);
    // Nenhuma venda faturável no período (com histórico coberto): lucro 0, não "sem custo" (achado #9).
    const lucroConta = acc.pedidos === 0 ? { lucro: 0, fonteCusto: 'real' as const } : { lucro: total.lucro, fonteCusto: total.fonteCusto };
    return montarPainelAds({
      fonte: fonteQ.data, janela, agora: new Date(), codigosPorMlb: codQ.data,
      familiaDoCodigo: new Map(catQ.data.filter((c) => c.codigoPai).map((c) => [c.codigo, c.codigoPai!])),
      lucroPorFamilia, lucroConta,
      historicoDesde: vendas.dados.historicoDesde, baseAcosValidada: BASE_ACOS_VALIDADA,
    });
  }, [fonteQ.data, codQ.data, catQ.data, vendas.dados, janela]);

  return {
    painel, janela,
    isLoading: fonteQ.isLoading || codQ.isLoading || vendas.isLoading,
    isError: fonteQ.isError || codQ.isError || vendas.isError || catQ.isError,
    refetch: () => { void fonteQ.refetch(); void codQ.refetch(); void vendas.refetch(); },
  };
}
```
Em `src/hooks/useVendasSku.ts` (linha 19-20): `export function useVendasSku(periodo: Periodo, janelaFixa?: Janela)` e `const janela = useMemo(() => janelaFixa ?? resolverJanela(periodo), [periodo, janelaFixa]);` — o resto do hook não muda.
Antes de escrever: localizar o arquivo real de `useCatalogoVendasSku` (`grep -rn "export function useCatalogoVendasSku" src/hooks`) e o de `supabase` (`src/lib/supabase.ts`); ajustar os imports.

- [ ] **Step 4: Rodar** os dois testes → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ads-painel-dados.ts src/hooks/useAdsPainel.ts src/hooks/useVendasSku.ts src/hooks/__tests__/useVendasSku.test.ts tests/lib/ads-painel-dados.test.ts src/hooks/__tests__/useAdsPainel.test.ts
git status --short   # nada de src/ pode sobrar fora do commit
pnpm build            # valida o conteúdo commitado (TS2554 se useVendasSku.ts ficasse de fora)
git commit -m "feat(ads): dados e hook do painel com o mesmo recorte de vendas"
```

---

### Task 5: Tela `/ads`, menu e módulo

**Files:**
- Create: `src/pages/Ads.tsx`, `src/components/ads/resumo-conta.tsx`, `src/components/ads/ranking-familias.tsx`
- Modify: `src/lib/modulos.ts`, `src/lib/menus.ts`, `src/components/sidebar.tsx`, `src/App.tsx`, `src/pages/Usuarios.tsx`, `supabase/functions/usuarios/index.ts`
- Test: `tests/pages/Ads.test.tsx`, `tests/lib/menus.test.ts` (ou o teste de menus existente)

**Interfaces:**
- Consumes: `useAdsPainel(dias)` e `PainelAds` (Tasks 3–4).

Conteúdo da tela (D1–D7, sem fila, sem gráfico no MVP — o selo provisório cobre a D3):
- Cabeçalho "Ads" + grupo de botões **7 / 30 / 90 dias** (padrão do grupo de presets de `src/pages/Vitrine.tsx:13-15`, `aria-pressed`), lembrado em `localStorage` (`try/catch`).
- **Resumo da conta** (`resumo-conta.tsx`): Lucro antes de Ads → Despesa de Ads (com as 3 linhas: em famílias, compartilhado entre famílias, **Gasto de Ads não identificado**) → **Resultado após Ads**; % da margem consumida; ROAS total e ROAS direto; ACOS. Selo "provisório — N dias com atribuição em aberto" quando `diasAbertos > 0`. Tooltip do resultado: "Resultado depois da despesa de Ads; não é o lucro causado pelo Ads." Rodapé: "Despesa informada pela API de Ads do Mercado Livre." `conta == null` → cartão "Total da conta indisponível: a coleta ainda não cobre este período."
- **Ranking de famílias** (`ranking-familias.tsx`): linhas por gasto; colunas Família (link `/faturamento/sku/familia/:codigoPai`), Gasto, Vendas atribuídas (direta / total), ROAS (direto / total), ACOS × ACOS de equilíbrio com semáforo (verde "dentro", vermelho "acima", "sem espaço para Ads"), Lucro antes, Resultado após Ads, Margem consumida. Motivo quando indisponível ("sem vendas no período", "sem custo cadastrado"). Marca de custo parcial/estimado igual à do Vendas SKU. Linha final "Compartilhado entre famílias" (expansível com os grupos) e "Gasto de Ads não identificado".
- Estados: `sem_coleta`, `sem_permissao`, `sem_advertiser`, `sem_acesso` com o mesmo texto do dossiê (`src/components/sku-dossie/ads-dossie.tsx`, função `vistaAds`); `sem_ads` "Nenhum gasto de Ads no período"; `desatualizado` aviso no topo; `isError` com "Tentar de novo".
- Celular (360 px): ranking vira cartões; sem rolagem horizontal da página.

- [ ] **Step 1: Teste da tela (vermelho)** — `tests/pages/Ads.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PainelAds } from '@/lib/ads-painel';

const hook = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useAdsPainel', () => ({ useAdsPainel: hook }));
import Ads from '@/pages/Ads';

const metr = { cliques: 0, impressoes: 0 };
const PAINEL: PainelAds = {
  estado: 'ok', desatualizado: false, gruposCobertos: true, semaforoLiberado: true, contaMotivo: null,
  conta: { ...metr, custo: 100, vendasDiretas: 700, vendasTotais: 800, roas: 8, roasDireto: 7, acos: 0.125,
    lucroAntes: 300, resultado: 200, margemConsumida: 1 / 3, fonteCusto: 'real',
    emFamilias: 50, compartilhado: 20, naoIdentificado: 30, naoIdentificadoPct: 0.3, divergente: false, diasAbertos: 0 },
  familias: [
    { ...metr, codigoPai: 'A', nome: 'Fam A', grupos: 1, custoCompartilhado: 0, custo: 50, vendasDiretas: 400,
      vendasTotais: 500, roas: 10, roasDireto: 8, acos: 0.1, acosDireto: 0.125, lucroAntes: 250, resultado: 200,
      margemConsumida: 0.2, acosEquilibrio: 0.25, semaforo: 'dentro', motivo: null, fonteCusto: 'real' },
    { ...metr, codigoPai: 'B', nome: 'Fam B', grupos: 1, custoCompartilhado: 0, custo: 30, vendasDiretas: 0,
      vendasTotais: 0, roas: 0, roasDireto: 0, acos: null, acosDireto: null, lucroAntes: 0, resultado: -30,
      margemConsumida: null, acosEquilibrio: null, semaforo: null, motivo: 'sem_vendas', fonteCusto: null },
  ],
  compartilhados: [{ id: 9, custo: 20, familias: ['A', 'B'], semCodigo: 0 }],
};
const montar = (painel: PainelAds | null = PAINEL) => {
  hook.mockReturnValue({ painel, janela: { desde: '2026-09-04', ate: '2026-10-03' }, isLoading: false, isError: false, refetch: vi.fn() });
  return render(<MemoryRouter><Ads /></MemoryRouter>);
};
beforeEach(() => hook.mockReset());

describe('Ads', () => {
  it('resumo da conta com as 3 parcelas da despesa e o resultado', () => {
    montar();
    expect(screen.getByText('Resultado após Ads')).toBeInTheDocument();
    expect(screen.getByText('Gasto de Ads não identificado')).toBeInTheDocument();
    expect(screen.getAllByText(/R\$\s?200,00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Despesa informada pela API de Ads/)).toBeInTheDocument();
  });
  it('ranking por gasto com semáforo e link para o dossiê da família', () => {
    montar();
    const linhaA = screen.getByRole('row', { name: /Fam A/ });
    expect(within(linhaA).getByText(/dentro/i)).toBeInTheDocument();
    expect(within(linhaA).getByRole('link', { name: /Fam A/ })).toHaveAttribute('href', '/faturamento/sku/familia/A');
    expect(within(screen.getByRole('row', { name: /Fam B/ })).getByText(/sem vendas no período/i)).toBeInTheDocument();
  });
  it('selo provisório quando há dias em atribuição em aberto', () => {
    montar({ ...PAINEL, conta: { ...PAINEL.conta!, diasAbertos: 14 } });
    expect(screen.getByText(/provisório/i)).toBeInTheDocument();
  });
  it('conta indisponível mantém o ranking', () => {
    montar({ ...PAINEL, conta: null, contaMotivo: 'cobertura' });
    expect(screen.getByText(/Total da conta indisponível/)).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Fam A/ })).toBeInTheDocument();
  });
  it('trocar o período chama o hook com os dias', () => {
    montar();
    expect(hook).toHaveBeenLastCalledWith(30);
    fireEvent.click(screen.getByRole('button', { name: '7 dias' }));
    expect(hook).toHaveBeenLastCalledWith(7);
  });
  it('família com gasto compartilhado: resultado indisponível com o motivo', () => {
    montar({ ...PAINEL, familias: [{ ...PAINEL.familias[0], custoCompartilhado: 20, resultado: null, semaforo: null, motivo: 'compartilhado' }] });
    expect(within(screen.getByRole('row', { name: /Fam A/ })).getByText(/gasto compartilhado com outra família/i)).toBeInTheDocument();
  });
  it('semáforo em validação: mostra o ACOS de equilíbrio sem verde/vermelho', () => {
    montar({ ...PAINEL, semaforoLiberado: false, familias: [{ ...PAINEL.familias[0], semaforo: null }] });
    expect(screen.getByText(/semáforo em validação/i)).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Fam A/ })).queryByText(/dentro/i)).not.toBeInTheDocument();
  });
  it('conta divergente: mostra o aviso e não mostra o não identificado', () => {
    montar({ ...PAINEL, conta: { ...PAINEL.conta!, divergente: true, naoIdentificado: null, naoIdentificadoPct: null } });
    expect(screen.getByText(/não fecha com o total da conta/i)).toBeInTheDocument();
  });
  it('sem anunciante: aviso e nenhum número', () => {
    montar({ ...PAINEL, estado: 'sem_advertiser', conta: null, familias: [], compartilhados: [] });
    expect(screen.queryByText('Resultado após Ads')).not.toBeInTheDocument();
    expect(screen.getByText(/anunciante/i)).toBeInTheDocument();
  });
});
```
(se `getByRole('row', { name })` não casar porque o nome acessível da linha junta todas as células, trocar por `screen.getByText('Fam A').closest('tr')!`.)
Run: `pnpm vitest run tests/pages/Ads.test.tsx` → FAIL.

- [ ] **Step 2: Implementar a página e os 2 componentes.** Reusar `fmtBRL` e o padrão visual das tabelas do Vendas SKU (`src/components/faturamento/ranking-sku.tsx`); nada de componente novo de UI. Run → PASS.

- [ ] **Step 3: Menu e módulo (vermelho → verde).** Teste em `tests/lib/menus.test.ts` (criar se não existir): `menuKeyForPath('/ads') === 'ads'`; `menusDeModulosDesabilitados([])` contém `'ads'`; `menusDeModulosDesabilitados(['ads'])` não contém. Depois:
  - `src/lib/menus.ts`: `'ads'` em `MENU_KEYS` entre `'vitrine'` e `'faturamento'`; `ads: 'ads'` em `PREFIX`.
  - `src/lib/modulos.ts`: `ModuloId` ganha `'ads'`; entrada `{ id: 'ads', nome: 'Ads', descricao: 'Painel de Product Ads com o resultado depois da despesa e o ACOS de equilíbrio de cada família (ADR-0179).', menu: 'ads' }`.
  - `supabase/functions/usuarios/index.ts`: `'ads'` em `MENU_KEYS` (linha 11) e em `MODULOS_VALIDOS` (linha 221).
  - `src/pages/Usuarios.tsx`: `ads: 'Ads'` em `MENU_LABEL`.
  - `src/components/sidebar.tsx`: `{ to: '/ads', label: 'Ads', icon: Megaphone, end: false, key: 'ads' }` entre Vitrine e Faturamento (`Megaphone` de `lucide-react`).
  - `src/App.tsx`: `const Ads = lazy(() => import('@/pages/Ads'));` e `<Route path="/ads" element={<Ads />} />` dentro do `MenuGuard`.
  Run: `pnpm vitest run tests/lib/menus.test.ts tests/pages/Ads.test.tsx` → PASS; `pnpm build` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Ads.tsx src/components/ads src/lib/modulos.ts src/lib/menus.ts src/components/sidebar.tsx src/App.tsx src/pages/Usuarios.tsx supabase/functions/usuarios/index.ts tests/pages/Ads.test.tsx tests/lib/menus.test.ts
git commit -m "feat(ads): tela /ads com resumo da conta e ranking de famílias (módulo por org)"
```

---

### Task 6: Dossiê SKU — gasto antigo fora dos grupos deixa de bloquear (D2)

**Files:**
- Modify: `src/lib/sku-ads.ts`, `src/lib/sku-dossie-dados.ts`, `src/lib/sku-dossie.ts`, `src/hooks/useSkuDossie.ts`, `src/components/sku-dossie/ads-dossie.tsx`
- Test: `tests/lib/sku-ads.test.ts`, `tests/lib/sku-dossie-dados.test.ts`, `tests/lib/sku-dossie.test.ts` (ou o teste existente de `montarDossie`), `src/hooks/__tests__/useSkuDossie.test.ts`, `src/components/sku-dossie/__tests__/ads-dossie.test.tsx`, `src/pages/__tests__/SkuDossie.test.tsx`

**Interfaces:**
- Consumes: RPC `ads_resumo_periodo` (Task 1); `janelaBRT` (Task 4).
- Produces:
  - `export async function buscarResumoAds(desde: string, ate: string): Promise<ResumoAds | null>` em `sku-dossie-dados.ts`, com `export interface ResumoAds { custo_conta: number; dias_conta: number; custo_grupos_com_membro: number }`
  - `MotivoSemLucro = 'compartilhado' | 'sem_lucro' | 'cobertura' | null` (sai `'fora_dos_grupos'`)
  - `AdsDossie` ganha `naoIdentificadoPct: number | null` e `naoIdentificadoMotivo: 'periodo_longo' | 'incompleto' | 'divergente' | 'erro' | null` (por que o % não aparece; a tela mostra o motivo — "aviso indisponível para períodos acima de 1 ano", etc.)
  - `montarAds` recebe `resumo: ResumoAds | null | 'carregando' | 'erro' | 'periodo_longo'` e `diasFinanceiros: { desde: string; ate: string }`
  - `useSkuDossie`: com mais de 366 dias financeiros a query do resumo **não** roda e passa `'periodo_longo'` (o intervalo livre do dossiê não tem teto — `src/lib/metricas.ts:114`)
  - `DossieSku` ganha `lucroAds: { lucro: number | null; fonteCusto: FonteCusto } | null` (lucro do alvo só nos dias que o Ads cobre)

Três correções sobre a primeira versão (achado #5 do Astra):
1. `montarAds` recebe a janela em **ISO** (`sku-ads.ts:148` já converte com `diaBRT`); o cálculo de dias usa `desdeDia`/`fimJanela` de lá, nunca `difDias(p.janela…)` (daria `NaN`).
2. O resumo é do **período financeiro** (do 1º dia do período até `min(último dia do período, ontem)`), não da `faixa` do gráfico (`useSkuDossie.ts:103` amplia a faixa conforme Semana/Mês) — o aviso não pode mudar ao trocar o passo.
3. O lucro usado no Lucro após Ads é o desses mesmos dias: hoje o dossiê usa `linhaPeriodo.m.lucro`, que inclui o dia de hoje, enquanto o Ads para em ontem.

- [ ] **Step 1: Testes (vermelho)**

`tests/lib/sku-ads.test.ts` — trocar o teste existente "gasto fora dos grupos listados: … lucro após Ads indisponível" (e o de tolerância de `custo_resumo − custo_listado` perto da linha 183, que deixa de existir) por:
```ts
it('gasto da conta fora dos grupos no período: lucro após Ads aparece, com o % não identificado', () => {
  const a = montarAds({ ...entrada, resumo: { custo_conta: 200, dias_conta: DIAS, custo_grupos_com_membro: 190 } });
  expect(a.motivoSemLucro).toBeNull();
  expect(a.lucroAposAds).not.toBeNull();
  expect(a.naoIdentificadoPct).toBeCloseTo(0.05);
});
it('série da conta incompleta no período financeiro → % null, lucro após Ads continua', () => {
  const a = montarAds({ ...entrada, resumo: { custo_conta: 200, dias_conta: DIAS - 1, custo_grupos_com_membro: 190 } });
  expect(a.naoIdentificadoPct).toBeNull();
  expect(a.lucroAposAds).not.toBeNull();
});
it('resumo carregando ou com erro → % null, sem bloquear', () => {
  expect(montarAds({ ...entrada, resumo: 'erro' }).naoIdentificadoPct).toBeNull();
  expect(montarAds({ ...entrada, resumo: 'carregando' }).lucroAposAds).not.toBeNull();
});
it('período financeiro acima de 366 dias → sem consulta, % null com motivo explícito', () => {
  const a = montarAds({ ...entrada, resumo: 'periodo_longo' });
  expect(a.naoIdentificadoPct).toBeNull();
  expect(a.naoIdentificadoMotivo).toBe('periodo_longo');
  expect(a.lucroAposAds).not.toBeNull();
});
it('grupos acima da conta no período → % null (divergente), nunca negativo', () => {
  expect(montarAds({ ...entrada, resumo: { custo_conta: 100, dias_conta: DIAS, custo_grupos_com_membro: 101 } }).naoIdentificadoPct).toBeNull();
});
```
(`entrada` = a fixture do caso `ok` exclusivo já usada no arquivo, acrescida de `diasFinanceiros`; `DIAS` = número de dias de `diasFinanceiros`.)

`tests/lib/sku-dossie.test.ts` — `montarDossie` com uma venda de hoje e uma de ontem: `lucroAds` inclui só a de ontem; `linhaPeriodo` continua incluindo as duas.

`src/hooks/__tests__/useSkuDossie.test.ts` — com o mock de `buscarResumoAds`: (a) chamado com `(desdeDia, min(fimDia, ontem))` do **período**, igual com passo `semana` e `mes`; (b) `montarAds` recebe `lucroPeriodo = dados.lucroAds.lucro`.

`ads-dossie.test.tsx` — trocar `'gasto fora dos grupos listados: lucro após Ads indisponível, despesa continua'` por: com `naoIdentificadoPct: 0.05` mostra o lucro e "5% do gasto de Ads da conta neste período não tem família identificada"; com `0.004` não mostra aviso.

`tests/lib/sku-dossie-dados.test.ts` — `buscarResumoAds` chama `rpc('ads_resumo_periodo', { p_desde, p_ate })` e converte numeric; erro propaga.

Run: `pnpm vitest run tests/lib/sku-ads.test.ts tests/lib/sku-dossie.test.ts tests/lib/sku-dossie-dados.test.ts src/hooks/__tests__/useSkuDossie.test.ts src/components/sku-dossie` → FAIL.

- [ ] **Step 2: Implementar**
  - `sku-dossie-dados.ts`: `buscarResumoAds` (RPC, `Number()` nos 3 campos, `null` se a RPC devolver null).
  - `sku-dossie.ts` (`montarDossie`, perto da linha 293): receber `janelaAds: Janela` e calcular `lucroAds` com `montarVendasSku({ ...base, janela: p.janelaAds, anterior: p.janelaAds })` + `daChave(...)?.m` → `{ lucro, fonteCusto }` (null sem linha).
  - `useSkuDossie.ts`: `const diasFin = { desde: diaBRT(janela.desde), ate: min(diaBRT(janela.ate), ontemBRT) }`; `janelaAds = janelaBRT(diasFin.desde, diasFin.ate)` passada a `montarDossie`; nova `useQuery(['sku-dossie-ads-resumo', diasFin], () => buscarResumoAds(diasFin.desde, diasFin.ate))` com `enabled: temAds`; `montarAds({ ..., lucroPeriodo: r.dados.lucroAds?.lucro ?? null, fonteCusto: r.dados.lucroAds?.fonteCusto ?? null, resumo: resumoQ.isError ? 'erro' : resumoQ.data ?? 'carregando', diasFinanceiros: diasFin })`.
  - `sku-ads.ts` (linhas 176-182): remover `foraDosGrupos` e o ramo `'fora_dos_grupos'`; a soma dos custos de Ads do alvo e `periodoCoberto` passam a usar os dias de `diasFinanceiros` (conferir que `diasPeriodo` já para em ontem; se não, cortar ali); e
    ```ts
    const nDias = diasEntre(p.diasFinanceiros.desde, p.diasFinanceiros.ate).length;
    const r = typeof p.resumo === 'object' ? p.resumo : null;
    const contaC = r ? Math.round(r.custo_conta * 100) : 0;
    const gruposC = r ? Math.round(r.custo_grupos_com_membro * 100) : 0;
    const naoIdentificadoMotivo = p.resumo === 'periodo_longo' ? 'periodo_longo'
      : p.resumo === 'erro' ? 'erro'
      : !r || r.dias_conta < nDias ? (p.resumo === 'carregando' ? null : 'incompleto')
      : gruposC > contaC ? 'divergente' : null;
    const naoIdentificadoPct = naoIdentificadoMotivo == null && r && contaC > 0 ? (contaC - gruposC) / contaC : null;
    ```
  - `ads-dossie.tsx`: remover o caso `fora_dos_grupos` de `textoSemLucro` (linha 60); com `naoIdentificadoPct > 0.005`, aviso sob o Lucro após Ads com `Math.round(pct * 100)` %.
  Run os testes do Step 1 → PASS; depois `pnpm vitest run src/components/sku-dossie src/hooks src/pages/__tests__/SkuDossie.test.tsx tests/lib` → PASS (ajustar os mocks que agora precisam de `buscarResumoAds`/`lucroAds`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/sku-ads.ts src/lib/sku-dossie-dados.ts src/lib/sku-dossie.ts src/hooks/useSkuDossie.ts src/components/sku-dossie tests/lib src/hooks/__tests__ src/pages/__tests__/SkuDossie.test.tsx
git commit -m "feat(ads): dossiê mostra o lucro após Ads nos mesmos dias do Ads, com aviso do gasto não identificado (ADR-0179 D2)"
```

---

### Task 7: Implantação (docs, deploy na ordem segura, menu, validação técnica)

**Files:**
- Create: `supabase/migrations/<ts>_ads_menu_backfill.sql` (via `supabase migration new ads_menu_backfill`)
- Modify: `docs/decisions/0172-vendas-sku-analise-por-variacao.md` (nota de emenda apontando o ADR-0179 D2), `docs/decisions/0179-painel-de-ads.md` (status/produção, tempo do `EXPLAIN`, CPU do worker), `docs/reference/glossario.md` ("Lucro após Ads": tirar "a implementar"; ACOS de equilíbrio comparado ao **ACOS direto**), `docs/reference/edge-functions.md`, `docs/reference/modelo-de-dados.md` (`ml_ads_conta_dia`, `conta_cobertura_desde`, 2 RPCs), `docs/runbooks/coletar-ads-ml.md`, `docs/TASKS.md`, `docs/project-status.md`, `docs/Roadmap/ROADMAP-MELHORIAS-PUBLIAI.md` (local, gitignored) — seguir a skill `docs-update-checklist`.

Ordem de produção (achado #11): **(1)** migration da Task 1 (já aplicada) → **(2)** deploy `coletar-ads-ml` (Task 2, Step 8) → **(3)** deploy `usuarios` (aceita `'ads'`) → **(4)** merge/deploy do front → **(5)** migration de backfill do menu → **(6)** ligar o módulo (Task 8). O backfill só depois do (3), porque a edge antiga descarta `'ads'` ao salvar permissões.

- [ ] **Step 1: `pnpm preflight`** → tudo verde (docs:links, lint:functions, check:functions, lint, tsc, build, testes).
- [ ] **Step 2: Deploy `usuarios`** — `supabase functions deploy usuarios --project-ref txvncrgkoynoxwopfkbp < /dev/null`; conferir a versão nova. Conferir em `supabase/functions/usuarios/index.ts` se existe lista **padrão** de menus para convite novo; se ela tiver `'faturamento'`, incluir `'ads'` nela (no mesmo commit da Task 5) para convidados novos.
- [ ] **Step 3: Teste de permissões** — com a edge nova, salvar as permissões de um usuário de validação incluindo `'ads'` (chamada `callUsuarios` pela tela Usuários, como admin da org de validação) e conferir por SQL só-leitura que `allowed_menus` manteve `'ads'`.
- [ ] **Step 4: Merge/deploy do front** — revisão pré-merge (Grok 4.7 xhigh) + CI verde + merge fast-forward, conforme o CLAUDE.md. O módulo segue desligado em todas as orgs, então `/ads` não aparece para ninguém ainda.
- [ ] **Step 5: Backfill do menu** — migration:
```sql
-- Menu novo (ADR-0047, como a Vitrine): quem já vê Faturamento passa a ver Ads (o módulo ainda decide se aparece).
-- Só depois do deploy da edge `usuarios` que conhece 'ads' (senão uma edição de permissão apagaria a chave).
update public.profiles set allowed_menus = array_append(allowed_menus, 'ads')
  where 'faturamento' = any(allowed_menus) and not ('ads' = any(allowed_menus));
```
`supabase db push --linked --dry-run` (só ela) → `db push` → `npm run db:check`; conferir por SQL: nenhum perfil com `faturamento` sem `ads`.
- [ ] **Step 6: Validação visual** (skill `playwright-cli`, sessão isolada, nunca o Chrome do Diego): `/ads` em 1440/1920/360 px com a conta de validação e dados injetados (memória `reference_validacao_dados_injetados`); prints reais (não só snapshot de acessibilidade); estados ok, provisório, conta indisponível, divergente, compartilhado, sem anunciante.
- [ ] **Step 7: Prova numérica técnica** — por SQL só-leitura, Avil, últimos 30 dias até ontem: Σ `ml_ads_conta_dia.cost` = soma das 3 parcelas mostradas (identidade exata); nenhum `ad_group_id` em duas famílias; nenhuma família com grupo compartilhado mostrando resultado.
- [ ] **Step 8: Validação da base do ACOS de equilíbrio (achado #8)** — o semáforo nasce **desligado** (`BASE_ACOS_VALIDADA = false`, Task 3) e só liga com este spike aprovado. Registrar em `docs/spikes/055-base-acos-equilibrio.md`, só leitura, Avil, 90 dias:
  1. **Equivalência do preço unitário** (o teste que prova a mesma base monetária): para grupos **ITEM de um único código** com `direct_units > 0`, comparar dia a dia o preço médio atribuído `direct_amount / direct_units` com o preço médio faturável do PubliAI do mesmo MLB no mesmo dia (`bruto / unidades` de `ml_vendas_itens`, itens faturáveis). Critério: diferença ≤ 2 % em ≥ 90 % dos dias com venda dos dois lados.
  2. **Descontos e promoções:** separar os dias com promoção ativa (`ml_promocao_itens`) e repetir o critério 1 — o ML pode atribuir pelo preço com desconto; o PubliAI soma `unit_price` faturado.
  3. **Kits:** um kit vendido por Ads conta como 1 unidade no ML; conferir que `bruto/unidades` do kit no PubliAI usa o mesmo preço do kit (não o dos componentes).
  4. **Devoluções/canceladas:** conferir se a venda atribuída do ML continua contando uma venda depois cancelada/devolvida (o PubliAI tira as canceladas do bruto); medir o tamanho do efeito no período.
  5. **Sanidade agregada:** Σ `direct_amount` ≤ bruto da família (as 6 famílias de maior gasto, 30 dias).
  **Decisão:** critérios 1–3 dentro → commit `BASE_ACOS_VALIDADA = true` + teste do semáforo ligado; algum fora → semáforo segue desligado, achado aberto no ADR-0179 e no `docs/TASKS.md` com os números, e o painel vai ao piloto só com ACOS de equilíbrio como referência. Documentar custo parcial/estimado encontrado.
- [ ] **Step 9: Commit dos docs** (+ spike 055) no fluxo de merge.

### Task 8: Piloto e aceite (D7) — o épico só fecha aqui

- [ ] **Step 1: Ligar o módulo `ads` na Avil** (Central `/admin`, super admin) — **só com o OK explícito do Diego**, depois de ele revisar a tela com os dados reais da Avil numa sessão guiada.
- [ ] **Step 2: Conferência com o Mercado Ads** — o Diego (ou o operador da Avil) abre o painel do Mercado Ads no mesmo período (30 dias até ontem) e compara a despesa total com a do `/ads`; registrar os dois valores e a diferença em `docs/TASKS.md`. Critério: **≤ 1 %**. Acima disso, investigar antes de seguir (não ajustar número).
- [ ] **Step 3: Acompanhamento de 2 semanas** — a cada semana, registrar em `docs/TASKS.md`: total da conta × Mercado Ads, % não identificado, famílias com resultado indisponível (e por quê), e qualquer número que o Diego tenha estranhado.
- [ ] **Step 4: Aceite** — o épico I2 só vira "entregue" (ADR-0179 Aceito, roadmap e `project-status.md`) quando houver, registrados: conferência ≤ 1 %, nenhuma dupla contagem, toda indisponibilidade com motivo, e **≥ 1 decisão concreta** sobre uma família tomada a partir do painel (qual família, o que foi decidido, data). Sem isso, o status fica "em piloto".
