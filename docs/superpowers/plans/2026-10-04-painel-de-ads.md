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
- **ACOS de equilíbrio** = lucro antes de Ads ÷ bruto com custo da família; rótulo "referência pela margem observada"; margem ≤ 0 → "sem espaço para Ads". Semáforo com 2 estados: **dentro** (ACOS ≤ equilíbrio) ou **acima**. Sem meta configurável.
- Rótulos: "Resultado após Ads" (nunca "lucro gerado pelo Ads"); "Despesa informada pela API de Ads" (nunca "fatura").
- Lucro herda `fonteCusto` (`real` / `estimado` / `parcial`); `sem_custo` → lucro `null`.
- Módulo por org `ads`, nasce desligado; menu `ads` entre Vitrine e Faturamento.
- Migrations só por `supabase migration new` + `supabase db push` (ADR-0043); RLS por `org_id`; escrita só `service_role`.
- Teste antes do código (TDD) em toda lógica; `pnpm preflight` verde antes de push.

## Review Focus

1. **Vendas incluindo hoje e Ads só até ontem** → o painel converte o preset em `range` BRT terminando ontem e passa o mesmo `range` a `useVendasSku` (Task 4, teste `periodoAds`).
2. **Σ grupos maior que o total da conta** (série da conta relida em outro momento da rodada) → não identificado fica 0, nunca negativo, e o total exibido é o da conta (Task 3, teste "grupos acima da conta").
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
| `src/lib/sku-ads.ts`, `src/lib/sku-dossie-dados.ts`, `src/components/sku-dossie/ads-dossie.tsx` (mod) | D2 no dossiê |

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

`supabase/tests/ads_painel.sql` (mesmo formato de `supabase/tests/vitrine.sql`: fixtures com UUIDs `9600…`, `set local role authenticated`, asserções em `do $$`, `raise notice 'TESTE_OK'`, `rollback`):

```sql
\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('96000000-0000-0000-0000-000000000001', 'Ads test', 'ads-test'),
  ('96000000-0000-0000-0000-000000000002', 'Outra org ads', 'outra-org-ads');
insert into auth.users (id, email, raw_user_meta_data) values
  ('96000000-0000-0000-0000-000000000101', 'ads@test.local', '{"org_id":"96000000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;

insert into public.ml_ads_sync (org_id, estado, rodada, posse_ate, carga_inicial_ok, cobertura_desde) values
  ('96000000-0000-0000-0000-000000000001', 'ok', '2026-10-01 10:00+00', now() + interval '5 min', true, '2026-07-01'),
  ('96000000-0000-0000-0000-000000000002', 'ok', null, null, true, '2026-07-01');

-- posse: rodada errada não grava; rodada certa grava e define conta_cobertura_desde
do $$ begin
  if public.gravar_ads_conta_dias('96000000-0000-0000-0000-000000000001', '2026-09-30 10:00+00', now(),
       '[{"dia":"2026-09-01","cost":1,"clicks":1,"prints":1,"direct_amount":1,"indirect_amount":0,"total_amount":1}]')
     then raise exception 'gravou com rodada que não é dona'; end if;
  if not public.gravar_ads_conta_dias('96000000-0000-0000-0000-000000000001', '2026-10-01 10:00+00', '2026-10-02 12:00+00',
       '[{"dia":"2026-09-01","cost":100,"clicks":10,"prints":1000,"direct_amount":800,"indirect_amount":200,"total_amount":1000},
         {"dia":"2026-09-02","cost":50,"clicks":5,"prints":500,"direct_amount":0,"indirect_amount":0,"total_amount":0}]')
     then raise exception 'não gravou com a rodada dona'; end if;
  if (select conta_cobertura_desde from public.ml_ads_sync where org_id = '96000000-0000-0000-0000-000000000001')
     is distinct from '2026-09-01' then raise exception 'conta_cobertura_desde'; end if;
  -- coleta mais velha não sobrescreve
  perform public.gravar_ads_conta_dias('96000000-0000-0000-0000-000000000001', '2026-10-01 10:00+00', '2026-10-01 12:00+00',
       '[{"dia":"2026-09-01","cost":1,"clicks":0,"prints":0,"direct_amount":0,"indirect_amount":0,"total_amount":0}]');
  if (select cost from public.ml_ads_conta_dia where org_id = '96000000-0000-0000-0000-000000000001' and dia = '2026-09-01') <> 100
     then raise exception 'coleta antiga sobrescreveu'; end if;
end $$;

insert into public.ml_ads_conta_dia (org_id, dia, cost, clicks, prints, direct_amount, indirect_amount, total_amount, coletado_em) values
  ('96000000-0000-0000-0000-000000000002', '2026-09-01', 999, 0, 0, 0, 0, 0, now());
insert into public.ml_ads_grupo (org_id, ad_group_id, tipo, status, atualizado_em) values
  ('96000000-0000-0000-0000-000000000001', 9601, 'FAMILY', 'ACTIVE', now()),
  ('96000000-0000-0000-0000-000000000001', 9602, 'FAMILY', 'PAUSED', now()),   -- sem membro
  ('96000000-0000-0000-0000-000000000001', 9603, 'ITEM', 'ACTIVE', now());     -- sem gasto no período
insert into public.ml_ads_grupo_item (org_id, ad_group_id, ml_item_id, visto_em) values
  ('96000000-0000-0000-0000-000000000001', 9601, 'MLB1', now()),
  ('96000000-0000-0000-0000-000000000001', 9601, 'MLB2', now());
insert into public.ml_ads_grupo_dia (org_id, ad_group_id, dia, cost, clicks, prints, direct_amount, indirect_amount, total_amount, direct_units, units, coletado_em) values
  ('96000000-0000-0000-0000-000000000001', 9601, '2026-09-01', 90, 9, 900, 800, 100, 900, 3, 4, now()),
  ('96000000-0000-0000-0000-000000000001', 9601, '2026-09-02', 40, 4, 400, 0, 0, 0, 0, 0, now()),
  ('96000000-0000-0000-0000-000000000001', 9602, '2026-09-01', 10, 1, 100, 0, 0, 0, 0, 0, now()),
  ('96000000-0000-0000-0000-000000000001', 9603, '2026-08-01', 7, 1, 1, 0, 0, 0, 0, 0, now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"96000000-0000-0000-0000-000000000101","role":"authenticated"}';

do $$
declare r jsonb := public.ads_painel('2026-09-01', '2026-09-02');
        s jsonb := public.ads_resumo_periodo('2026-09-01', '2026-09-02');
        g jsonb;
begin
  if jsonb_array_length(r->'conta') <> 2 then raise exception 'conta: só os 2 dias da própria org %', r->'conta'; end if;
  if (r->'sync'->>'conta_cobertura_desde') is distinct from '2026-09-01' then raise exception 'sync %', r->'sync'; end if;
  if jsonb_array_length(r->'grupos') <> 2 then raise exception 'grupos com gasto no período (9601, 9602) %', r->'grupos'; end if;
  select e into g from jsonb_array_elements(r->'grupos') e where (e->>'ad_group_id')::bigint = 9601;
  if (g->>'cost')::numeric <> 130 or (g->>'total_amount')::numeric <> 900 or (g->>'direct_amount')::numeric <> 800
     then raise exception 'soma do grupo 9601 %', g; end if;
  if g->'membros' <> '["MLB1","MLB2"]'::jsonb then raise exception 'membros %', g; end if;
  select e into g from jsonb_array_elements(r->'grupos') e where (e->>'ad_group_id')::bigint = 9602;
  if g->'membros' <> '[]'::jsonb then raise exception 'grupo sem membro %', g; end if;
  if (s->>'custo_conta')::numeric <> 150 or (s->>'dias_conta')::int <> 2 or (s->>'custo_grupos_com_membro')::numeric <> 130
     then raise exception 'resumo %', s; end if;
  begin
    perform public.ads_painel('2026-01-01', '2026-12-31');
    raise exception 'não recusou período longo';
  exception when others then
    if sqlerrm not like 'ads_painel: período inválido%' then raise; end if;
  end;
  begin
    perform public.gravar_ads_conta_dias('96000000-0000-0000-0000-000000000001', '2026-10-01 10:00+00', now(), '[]');
    raise exception 'authenticated executou RPC de escrita';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.ml_ads_conta_dia where org_id = '96000000-0000-0000-0000-000000000002')
     then raise exception 'RLS: viu a conta de outra org'; end if;
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
  if p_desde is null or p_ate is null or p_desde > p_ate or p_ate - p_desde > 92 then
    raise exception 'ads_painel: período inválido (%, %)', p_desde, p_ate;
  end if;
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

-- Aviso do dossiê SKU (D2): só os totais, sem a lista de grupos.
create function public.ads_resumo_periodo(p_desde date, p_ate date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'custo_conta', (select coalesce(sum(d.cost), 0) from public.ml_ads_conta_dia d
                     where d.org_id = public.current_org_id() and d.dia between p_desde and p_ate),
    'dias_conta', (select count(*) from public.ml_ads_conta_dia d
                     where d.org_id = public.current_org_id() and d.dia between p_desde and p_ate),
    'custo_grupos_com_membro', (select coalesce(sum(d.cost), 0) from public.ml_ads_grupo_dia d
                     where d.org_id = public.current_org_id() and d.dia between p_desde and p_ate
                       and exists (select 1 from public.ml_ads_grupo_item i
                                    where i.org_id = d.org_id and i.ad_group_id = d.ad_group_id)));
$$;

revoke all on function public.gravar_ads_conta_dias(uuid, timestamptz, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.gravar_ads_conta_dias(uuid, timestamptz, timestamptz, jsonb) to service_role;
revoke all on function public.ads_painel(date, date) from public, anon;
grant execute on function public.ads_painel(date, date) to authenticated;
revoke all on function public.ads_resumo_periodo(date, date) from public, anon;
grant execute on function public.ads_resumo_periodo(date, date) to authenticated;

-- Menu novo (ADR-0047, como a Vitrine): quem já vê Faturamento passa a ver Ads (o módulo ainda esconde).
update public.profiles set allowed_menus = array_append(allowed_menus, 'ads')
  where 'faturamento' = any(allowed_menus) and not ('ads' = any(allowed_menus));
```

Nota: `p_ate - p_desde > 92` aceita 90 dias com folga de fuso; o teste usa 2026-01-01..12-31 para o vermelho.

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
```
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
export type EstadoPainel = 'sem_coleta' | 'sem_permissao' | 'sem_advertiser' | 'sem_acesso' | 'sem_ads' | 'ok';
export type Semaforo = 'dentro' | 'acima' | 'sem_espaco';
export interface FamiliaPainel extends MetricasAds {
  codigoPai: string; nome: string | null; grupos: number;
  lucroAntes: number | null; resultado: number | null; margemConsumida: number | null;
  acosEquilibrio: number | null; semaforo: Semaforo | null; motivo: 'sem_vendas' | 'sem_custo' | null;
  fonteCusto: FonteCusto | null;
}
export interface ContaPainel extends MetricasAds {
  lucroAntes: number | null; resultado: number | null; margemConsumida: number | null; fonteCusto: FonteCusto | null;
  emFamilias: number; compartilhado: number; naoIdentificado: number; naoIdentificadoPct: number | null;
  diasAbertos: number;
}
export interface PainelAds {
  estado: EstadoPainel; desatualizado: boolean;
  conta: ContaPainel | null;            // null = série da conta não cobre o período (motivo em contaMotivo)
  contaMotivo: 'cobertura' | null;
  familias: FamiliaPainel[];            // ordenadas por custo desc
  compartilhados: { id: number; custo: number; familias: string[]; semCodigo: number }[];
}
export function montarPainelAds(p: {
  fonte: FontePainelAds; janela: { desde: string; ate: string };
  codigosPorMlb: Map<string, string[]>;           // de buscarCodigosMlbs
  familiaDoCodigo: Map<string, string>;           // código → codigoPai (catálogo)
  lucroPorFamilia: Map<string, LucroFamilia>;     // codigoPai → lucro do período
  lucroConta: { lucro: number | null; fonteCusto: FonteCusto };
  agora: Date;
}): PainelAds
```

Regras (cada uma com teste):
- Bucket do grupo: `membros` vazio → **não identificado**. Todo MLB com códigos e todos os códigos na **mesma** família → essa família. Qualquer MLB sem código, código sem família, ou 2+ famílias → **compartilhado** (`semCodigo` = MLBs sem código + códigos sem família).
- Conta: `custo` = Σ `conta[].cost`; `naoIdentificado = round2(max(0, custoConta − Σ grupos com membro))` — isto já inclui os grupos sem membro, porque eles não estão no Σ; `emFamilias` + `compartilhado` + `naoIdentificado` = `custo` (o resto de arredondamento vai para `naoIdentificado`). `naoIdentificadoPct = custo > 0 ? naoIdentificado / custo : null`.
- Cobertura da conta: `conta_cobertura_desde == null || > janela.desde || conta.length < diasNaJanela` → `conta = null`, `contaMotivo = 'cobertura'` (famílias continuam).
- Métricas por Σ: `roas = vendasTotais / custo`, `roasDireto = vendasDiretas / custo`, `acos = custo / vendasTotais`; denominador 0 → `null`.
- Família: lucro ausente no mapa → `lucroAntes = 0`, `motivo = 'sem_vendas'`; `fonteCusto === 'sem_custo'` → `lucroAntes = null`, `motivo = 'sem_custo'`. `resultado = lucroAntes − custo` (null se lucroAntes null). `margemConsumida = lucroAntes > 0 ? custo / lucroAntes : null`. `acosEquilibrio = brutoComCusto > 0 && lucroAntes != null ? lucroAntes / brutoComCusto : null`. Semáforo: `acosEquilibrio == null → null`; `≤ 0 → 'sem_espaco'`; `vendasTotais == 0 → 'acima'`; senão `acos ≤ acosEquilibrio ? 'dentro' : 'acima'`.
- Conta: `lucroAntes = lucroConta.lucro` (null se `sem_custo`); `resultado = lucroAntes − custo da conta` (todo o gasto, inclusive não identificado).
- `diasAbertos` = dias da conta com `!atribuicaoFinal(dia, coletado_em)`.
- Estado: `sync == null || !carga_inicial_ok` → `sem_coleta`; `sem_permissao/sem_advertiser/sem_acesso` → o mesmo; custo da conta e dos grupos = 0 → `sem_ads`; senão `ok`. `desatualizado = ultimo_ok_em == null || agora − ultimo_ok_em > 48 h`.

- [ ] **Step 1: Testes (vermelho)** — `tests/lib/ads-painel.test.ts`, com uma fábrica `fonte()` de 2 dias cobertos e:

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
  janela, agora,
  codigosPorMlb: new Map([['MLB1', ['A1']], ['MLB2', ['A2']], ['MLB3', ['B1']], ['MLB4', []]]),
  familiaDoCodigo: new Map([['A1', 'A'], ['A2', 'A'], ['B1', 'B']]),
  lucroPorFamilia: new Map([['A', { nome: 'Fam A', lucro: 250, brutoComCusto: 1000, fonteCusto: 'real' as const }]]),
  lucroConta: { lucro: 300, fonteCusto: 'real' as const },
});

describe('montarPainelAds', () => {
  it('grupo com 2 cores da mesma família vai inteiro para a família', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 80, ['MLB1', 'MLB2'], 800, 700)] }));
    expect(p.familias).toHaveLength(1);
    expect(p.familias[0]).toMatchObject({ codigoPai: 'A', custo: 80, vendasTotais: 800, roas: 10, roasDireto: 8.75,
      acos: 0.1, lucroAntes: 250, resultado: 170, margemConsumida: 0.32, acosEquilibrio: 0.25, semaforo: 'dentro' });
  });
  it('total da conta fecha: famílias + compartilhado + não identificado', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 50, ['MLB1']), grupo(2, 20, ['MLB1', 'MLB3']), grupo(3, 10, [])] }));
    expect(p.conta).toMatchObject({ custo: 100, emFamilias: 50, compartilhado: 20, naoIdentificado: 30,
      naoIdentificadoPct: 0.3, resultado: 200 });
    expect(p.compartilhados[0]).toMatchObject({ id: 2, familias: ['A', 'B'], semCodigo: 0 });
  });
  it('MLB sem código → compartilhado, nunca a família', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 50, ['MLB1', 'MLB4'])] }));
    expect(p.familias).toHaveLength(0);
    expect(p.compartilhados[0]).toMatchObject({ semCodigo: 1 });
  });
  it('grupos acima da conta → não identificado 0, nunca negativo', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 101, ['MLB1'])] }));
    expect(p.conta?.naoIdentificado).toBe(0);
  });
  it('série da conta sem cobrir o período → conta null, famílias continuam', () => {
    const p = montarPainelAds(base({ conta: [dia('2026-09-02', 40)], grupos: [grupo(1, 50, ['MLB1'])] }));
    expect(p.conta).toBeNull();
    expect(p.contaMotivo).toBe('cobertura');
    expect(p.familias).toHaveLength(1);
  });
  it('família com gasto e sem venda: lucro 0, resultado −gasto, sem equilíbrio', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 30, ['MLB3'])] }));
    expect(p.familias[0]).toMatchObject({ codigoPai: 'B', lucroAntes: 0, resultado: -30, acosEquilibrio: null,
      semaforo: null, motivo: 'sem_vendas', roas: 0, acos: null });
  });
  it('margem ≤ 0 → sem espaço para Ads', () => {
    const b = base({ grupos: [grupo(1, 10, ['MLB1'], 100)] });
    b.lucroPorFamilia.set('A', { nome: 'Fam A', lucro: -5, brutoComCusto: 100, fonteCusto: 'real' });
    expect(montarPainelAds(b).familias[0].semaforo).toBe('sem_espaco');
  });
  it('ACOS acima do equilíbrio → acima', () => {
    expect(montarPainelAds(base({ grupos: [grupo(1, 300, ['MLB1'], 1000)] })).familias[0].semaforo).toBe('acima');
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
  it('estados: sem coleta, sem anunciante, sem ads, desatualizado', () => {
    expect(montarPainelAds(base({ sync: null })).estado).toBe('sem_coleta');
    expect(montarPainelAds(base({ sync: { ...sync, estado: 'sem_advertiser' } })).estado).toBe('sem_advertiser');
    expect(montarPainelAds(base({ conta: [dia('2026-09-01', 0), dia('2026-09-02', 0)] })).estado).toBe('sem_ads');
    expect(montarPainelAds(base({ sync: { ...sync, ultimo_ok_em: '2026-10-01T00:00:00Z' } })).desatualizado).toBe(true);
  });
  it('famílias ordenadas por gasto', () => {
    const p = montarPainelAds(base({ grupos: [grupo(1, 10, ['MLB1']), grupo(2, 50, ['MLB3'])] }));
    expect(p.familias.map((f) => f.codigoPai)).toEqual(['B', 'A']);
  });
});
```
Run: `pnpm vitest run tests/lib/ads-painel.test.ts` → FAIL (módulo não existe).

- [ ] **Step 2: Implementar `src/lib/ads-painel.ts`** seguindo as regras acima (funções pequenas: `bucketDoGrupo`, `somarMetricas`, `semaforo`, `estadoDo`; `round2` local). Comentário de topo citando ADR-0179 D1–D4 e spike 054.

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
- Test: `tests/lib/ads-painel-dados.test.ts`, `src/hooks/__tests__/useAdsPainel.test.ts`

**Interfaces:**
- Consumes: `montarPainelAds`, tipos (Task 3); `buscarCodigosMlbs(mlbs: string[]): Promise<Map<string, string[]>>` (`src/lib/sku-dossie-dados.ts`); `useVendasSku(periodo: Periodo)`; `agruparPorFamilia`, `somarAcumuladores`, `metricas` (`src/lib/vendas-sku.ts`); `useCatalogoVendasSku`.
- Produces:
  - `export type DiasAds = 7 | 30 | 90;`
  - `export function periodoAds(dias: DiasAds, agora: Date): { desde: string; ate: string }` (datas BRT `YYYY-MM-DD`, `ate` = ontem)
  - `export async function buscarPainelAds(desde: string, ate: string): Promise<FontePainelAds>`
  - `export function useAdsPainel(dias: DiasAds): { painel: PainelAds | null; janela: { desde: string; ate: string }; isLoading: boolean; isError: boolean; refetch: () => void }`

- [ ] **Step 1: Testes (vermelho)**

`tests/lib/ads-painel-dados.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
import { buscarPainelAds, periodoAds } from '@/lib/ads-painel-dados';

describe('periodoAds', () => {
  it('30 dias inteiros terminando ontem (BRT), mesmo às 00:30', () => {
    expect(periodoAds(30, new Date('2026-10-04T00:30:00-03:00'))).toEqual({ desde: '2026-09-04', ate: '2026-10-03' });
    expect(periodoAds(7, new Date('2026-10-04T23:50:00-03:00'))).toEqual({ desde: '2026-09-27', ate: '2026-10-03' });
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
`src/hooks/__tests__/useAdsPainel.test.ts`: mockar `@/lib/ads-painel-dados` (`buscarPainelAds`), `@/lib/sku-dossie-dados` (`buscarCodigosMlbs`), `@/hooks/useVendasSku` e o hook do catálogo com `vi.hoisted` (padrão de `src/hooks/__tests__/useSkuDossie.test.ts`) e provar: (a) `useVendasSku` recebe `{ tipo: 'range', desde, ate }` igual à janela do Ads; (b) `buscarCodigosMlbs` recebe os MLBs únicos e ordenados de todos os grupos; (c) `painel` fica `null` até vendas, catálogo e códigos chegarem; (d) erro em qualquer fonte → `isError`.

Run: `pnpm vitest run tests/lib/ads-painel-dados.test.ts src/hooks/__tests__/useAdsPainel.test.ts` → FAIL.

- [ ] **Step 2: Implementar `src/lib/ads-painel-dados.ts`**

```ts
import { supabase } from '@/lib/supabase';
import type { FontePainelAds } from '@/lib/ads-painel';

export type DiasAds = 7 | 30 | 90;
const diaBRT = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const somarDias = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Dias BRT inteiros terminando ontem: o Ads não tem o dia de hoje (spike 053 §3.2), então as vendas também não. */
export function periodoAds(dias: DiasAds, agora: Date): { desde: string; ate: string } {
  const ate = somarDias(diaBRT(agora), -1);
  return { desde: somarDias(ate, -(dias - 1)), ate };
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
import { buscarPainelAds, periodoAds, type DiasAds } from '@/lib/ads-painel-dados';
import { montarPainelAds, type LucroFamilia } from '@/lib/ads-painel';
import { buscarCodigosMlbs } from '@/lib/sku-dossie-dados';
import { useVendasSku } from '@/hooks/useVendasSku';
import { useCatalogoVendasSku } from '@/hooks/useCatalogoVendasSku';   // conferir o caminho real do hook
import { agruparPorFamilia, metricas, somarAcumuladores } from '@/lib/vendas-sku';

export function useAdsPainel(dias: DiasAds) {
  const janela = useMemo(() => periodoAds(dias, new Date()), [dias]);
  const vendas = useVendasSku(useMemo(() => ({ tipo: 'range' as const, ...janela }), [janela]));
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
    const total = metricas(somarAcumuladores(vendas.dados.linhas.map((l) => l.acc)));
    return montarPainelAds({
      fonte: fonteQ.data, janela, agora: new Date(), codigosPorMlb: codQ.data,
      familiaDoCodigo: new Map(catQ.data.filter((c) => c.codigoPai).map((c) => [c.codigo, c.codigoPai!])),
      lucroPorFamilia, lucroConta: { lucro: total.lucro, fonteCusto: total.fonteCusto },
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
Antes de escrever: localizar o arquivo real de `useCatalogoVendasSku` (`grep -rn "export function useCatalogoVendasSku" src/hooks`) e o de `supabase` (`src/lib/supabase.ts`); ajustar os imports.

- [ ] **Step 4: Rodar** os dois testes → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ads-painel-dados.ts src/hooks/useAdsPainel.ts tests/lib/ads-painel-dados.test.ts src/hooks/__tests__/useAdsPainel.test.ts
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
  estado: 'ok', desatualizado: false, contaMotivo: null,
  conta: { ...metr, custo: 100, vendasDiretas: 700, vendasTotais: 800, roas: 8, roasDireto: 7, acos: 0.125,
    lucroAntes: 300, resultado: 200, margemConsumida: 1 / 3, fonteCusto: 'real',
    emFamilias: 50, compartilhado: 20, naoIdentificado: 30, naoIdentificadoPct: 0.3, diasAbertos: 0 },
  familias: [
    { ...metr, codigoPai: 'A', nome: 'Fam A', grupos: 1, custo: 50, vendasDiretas: 400, vendasTotais: 500, roas: 10,
      roasDireto: 8, acos: 0.1, lucroAntes: 250, resultado: 200, margemConsumida: 0.2, acosEquilibrio: 0.25,
      semaforo: 'dentro', motivo: null, fonteCusto: 'real' },
    { ...metr, codigoPai: 'B', nome: 'Fam B', grupos: 1, custo: 30, vendasDiretas: 0, vendasTotais: 0, roas: 0,
      roasDireto: 0, acos: null, lucroAntes: 0, resultado: -30, margemConsumida: null, acosEquilibrio: null,
      semaforo: null, motivo: 'sem_vendas', fonteCusto: null },
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
- Modify: `src/lib/sku-ads.ts`, `src/lib/sku-dossie-dados.ts`, `src/components/sku-dossie/ads-dossie.tsx`
- Test: `tests/lib/sku-ads.test.ts`, `tests/lib/sku-dossie-dados.test.ts`, `src/components/sku-dossie/__tests__/ads-dossie.test.tsx`

**Interfaces:**
- Consumes: RPC `ads_resumo_periodo` (Task 1).
- Produces:
  - `FonteAds` ganha `resumo: { custo_conta: number; dias_conta: number; custo_grupos_com_membro: number } | null`
  - `MotivoSemLucro = 'compartilhado' | 'sem_lucro' | 'cobertura' | null` (sai `'fora_dos_grupos'`)
  - `AdsDossie` ganha `naoIdentificadoPct: number | null`

- [ ] **Step 1: Testes (vermelho)** — em `tests/lib/sku-ads.test.ts`, trocar o teste existente "gasto fora dos grupos listados: … lucro após Ads indisponível" por:

```ts
it('gasto da conta fora dos grupos no período: lucro após Ads aparece, com o % não identificado', () => {
  const a = montarAds({ ...entrada, fonte: { ...fonte, resumo: { custo_conta: 200, dias_conta: 30, custo_grupos_com_membro: 190 } } });
  expect(a.motivoSemLucro).toBeNull();
  expect(a.lucroAposAds).not.toBeNull();
  expect(a.naoIdentificadoPct).toBeCloseTo(0.05);
});
it('série da conta incompleta no período → % null, lucro após Ads continua', () => {
  const a = montarAds({ ...entrada, fonte: { ...fonte, resumo: { custo_conta: 200, dias_conta: 10, custo_grupos_com_membro: 190 } } });
  expect(a.naoIdentificadoPct).toBeNull();
  expect(a.lucroAposAds).not.toBeNull();
});
```
(`entrada`/`fonte` = as fixtures já usadas no arquivo para o caso `ok` exclusivo.) Em `ads-dossie.test.tsx`, trocar o teste `'gasto fora dos grupos listados: lucro após Ads indisponível, despesa continua'` por: com `naoIdentificadoPct: 0.05` o painel mostra o lucro e o aviso "5% do gasto de Ads da conta neste período não tem família identificada". Em `sku-dossie-dados.test.ts`: `buscarFonteAds` chama `rpc('ads_resumo_periodo', { p_desde, p_ate })` e converte numeric.
Run os 3 → FAIL.

- [ ] **Step 2: Implementar**
  - `sku-dossie-dados.ts`: em `buscarFonteAds(mlbs, desde, ate)`, buscar `ads_resumo_periodo` junto (`Promise.all`) e devolver `resumo` com `Number()` nos 3 campos (`null` se a RPC devolver null).
  - `sku-ads.ts` (linhas 176-182): remover `foraDosGrupos` e o ramo `'fora_dos_grupos'`; calcular
    ```ts
    const diasJanela = difDias(p.janela.ate, p.janela.desde) + 1;
    const r = fonte.resumo;
    const naoIdentificadoPct = r && r.dias_conta >= diasJanela && r.custo_conta > 0
      ? Math.max(0, r.custo_conta - r.custo_grupos_com_membro) / r.custo_conta : null;
    ```
    (`difDias` já é usada no arquivo para `atribuicaoFinal`; conferir a ordem dos argumentos lá.)
  - `ads-dossie.tsx`: remover o caso `fora_dos_grupos` de `textoSemLucro` (linha 60); quando `naoIdentificadoPct > 0.005`, mostrar sob o Lucro após Ads o aviso com `Math.round(pct * 100)` %.
  Run → PASS. `pnpm vitest run src/components/sku-dossie src/hooks/__tests__/useSkuDossie.test.ts src/pages/__tests__/SkuDossie.test.tsx tests/lib` → PASS (ajustar mocks de `buscarFonteAds` que agora precisam de `resumo`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/sku-ads.ts src/lib/sku-dossie-dados.ts src/components/sku-dossie tests/lib
git commit -m "feat(ads): dossiê mostra o lucro após Ads com aviso do gasto não identificado do período (ADR-0179 D2)"
```

---

### Task 7: Docs, deploy e validação

**Files:**
- Modify: `docs/decisions/0172-vendas-sku-analise-por-variacao.md` (nota de emenda apontando o ADR-0179 D2), `docs/decisions/0179-painel-de-ads.md` (status/produção), `docs/reference/glossario.md` ("Lucro após Ads": tirar "a implementar"), `docs/reference/edge-functions.md` (`coletar-ads-ml` grava a série da conta), `docs/reference/modelo-de-dados.md` (`ml_ads_conta_dia`, `conta_cobertura_desde`), `docs/runbooks/coletar-ads-ml.md`, `docs/TASKS.md`, `docs/project-status.md`, `docs/Roadmap/ROADMAP-MELHORIAS-PUBLIAI.md` (local, gitignored) — seguir a skill `docs-update-checklist`.

- [ ] **Step 1: `pnpm preflight`** → tudo verde (docs:links, lint:functions, check:functions, lint, tsc, build, testes).
- [ ] **Step 2: Deploy** — `supabase functions deploy coletar-ads-ml usuarios --project-ref txvncrgkoynoxwopfkbp < /dev/null`; conferir as versões novas. Migration já aplicada na Task 1.
- [ ] **Step 3: Validação visual** (skill `playwright-cli`, sessão isolada, nunca o Chrome do Diego): `/ads` em 1440/1920/360 px com a conta de validação e dados injetados (memória `reference_validacao_dados_injetados`); prints reais; estados ok, provisório, conta indisponível, sem anunciante.
- [ ] **Step 4: Prova numérica (D7)** — por SQL só-leitura, para a Avil em 30 dias: Σ `ml_ads_conta_dia.cost` = soma das 3 parcelas do painel (±R$0,01); nenhum `ad_group_id` em duas famílias; e anotar o total para o Diego conferir contra o painel do Mercado Ads (≤ 1 %).
- [ ] **Step 5: Ligar o módulo `ads` na Avil** (Central `/admin`, super admin) — só com o OK do Diego.
- [ ] **Step 6: Commit dos docs + revisão pré-merge (Grok 4.7 xhigh) + CI verde + merge fast-forward**, conforme o CLAUDE.md.
