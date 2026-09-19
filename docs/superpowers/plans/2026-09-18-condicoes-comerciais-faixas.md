# Percentual por Faixa Regressiva de Faturamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o percentual único de cobrança (`revenue_bps`) por 4 faixas fixas por organização
(`revenue_bps_t1..t4`), escolhidas automaticamente pelo faturamento líquido do mês, e travar por
modalidade quais campos cada organização pode cobrar (Sonar só na modalidade 2, infra separada só na
modalidade 1).

**Architecture:** Duas migrations SQL sequenciais (schema+RPC de gravação, depois função de faixa+RPC
de cobrança), seguidas da propagação ao contrato TypeScript compartilhado (`_shared/platform-admin/`)
e aos 4 pontos de UI que leem o percentual. Sem shape legado: a migration corrige o dado de produção
já errado (2 organizações) no mesmo movimento em que troca o schema.

**Tech Stack:** PostgreSQL/PL-pgSQL (Supabase), Deno (Edge Functions), React + TypeScript + Vitest.

**Spec:** [docs/superpowers/specs/2026-09-18-condicoes-comerciais-faixas-design.md](../specs/2026-09-18-condicoes-comerciais-faixas-design.md)
· [ADR-0165](../../decisions/0165-faixas-regressivas-por-organizacao.md)

## Global Constraints

- Cortes de faixa fixos e iguais para toda organização: ≤ R$100.000 / ≤ R$300.000 / ≤ R$500.000 /
  acima — em centavos de faturamento líquido do mês: 10.000.000 / 30.000.000 / 50.000.000.
- Modalidade 1 nunca cobra Sonar do cliente (`sonar_unit_cents = 0`); modalidade 2 nunca tem
  infraestrutura separada (`monthly_fee_cents = 0`). Violação **rejeita** com erro — nunca normaliza
  em silêncio.
- Devolução tardia usa a alíquota **congelada** do fechamento original; nunca recalcula a faixa de um
  mês já fechado.
- Sem trava de monotonia entre as 4 faixas.
- Nenhuma reimplementação da lógica de faixa em TypeScript — o único lugar com os 3 cortes é
  `platform_terms_tier` (SQL).
- Nunca rebaixar para um modelo mais barato nesta entrega (migrations de banco, código financeiro) —
  regra do projeto (CLAUDE.md).

---

### Task 1: Migration 1 — schema de faixas, correção de dado, `platform_save_terms`

**Files:**
- Create: `supabase/migrations/20260918010000_platform_commercial_terms_tiers.sql`
- Modify: `supabase/tests/platform_commercial.sql:353` (adicionar `\ir` da nova migration) e
  `supabase/tests/platform_commercial.sql` (adicionar novos casos de teste ao final do arquivo)
- Modify: `supabase/tests/platform_sonar.sql:24-31` (fixture usa a coluna `revenue_bps`, que deixa de
  existir, e `modality=1` com `sonar_unit_cents>0`, que o novo `CHECK` rejeita)

**Interfaces:**
- Produces: `platform_commercial_terms.revenue_bps_t1..t4` (integer, not null, 0–10000 cada),
  substituindo `revenue_bps` (removida). `CHECK platform_commercial_terms_modality_shape`. RPC
  `platform_save_terms(p_actor uuid, p_input jsonb)` passa a exigir `revenue_bps_t1..t4` no lugar de
  `revenue_bps` e rejeita combinação de modalidade errada.
- Consumes: nada de tarefa anterior (primeira tarefa de código).

- [ ] **Step 1: Escrever a migration**

Crie `supabase/migrations/20260918010000_platform_commercial_terms_tiers.sql`:

```sql
-- ADR-0165: percentual de gestao por faixa regressiva de faturamento, por organizacao.
--
-- platform_commercial_terms grava hoje um unico revenue_bps por contrato. A pagina publica anuncia
-- percentual regressivo por faixa de faturamento mensal (ate 100K / 100-300K / 300-500K / +500K)
-- nas duas modalidades, e nada trava que modalidade 1 nao deveria cobrar Sonar do cliente nem que
-- modalidade 2 nao deveria ter infra separada. Medido em 2026-09-18: Daludi Shop e DSA sao
-- modalidade 1 com sonar_unit_cents = 120 (violam a regra que este ADR passa a travar).
--
-- Troca revenue_bps por 4 colunas fixas (revenue_bps_t1..t4, uma por faixa; os cortes sao fixos e
-- vivem em platform_terms_tier, migration seguinte). O backfill das 3 organizacoes existentes copia
-- o revenue_bps atual para as 4 faixas (comportamento identico ao de hoje ate a proxima
-- renegociacao real) e corrige o Sonar de Daludi Shop/DSA (zera).
--
-- O trigger platform_commercial_terms_no_mutation bloqueia qualquer UPDATE incondicionalmente. E
-- desabilitado so durante os dois UPDATEs de backfill, dentro desta transacao, e reabilitado antes
-- do commit -- com asserção LOUD (raise exception) se o backfill ficar incompleto ou se o numero de
-- organizacoes corrigidas nao bater com o medido, para nunca silenciar uma divergencia entre o dado
-- real e o que esta migration espera.

begin;

alter table public.platform_commercial_terms
  add column revenue_bps_t1 integer,
  add column revenue_bps_t2 integer,
  add column revenue_bps_t3 integer,
  add column revenue_bps_t4 integer;

alter table public.platform_commercial_terms disable trigger platform_commercial_terms_no_mutation;

update public.platform_commercial_terms
  set revenue_bps_t1 = revenue_bps, revenue_bps_t2 = revenue_bps,
      revenue_bps_t3 = revenue_bps, revenue_bps_t4 = revenue_bps;

-- Sem asserção de contagem fixa (ex.: "exatamente 2"): essa migration roda tanto em producao
-- (onde hoje 2 linhas violam) quanto do zero em toda suite de teste local via `\ir` -- um numero
-- hardcoded so seria verdade num dos dois mundos. A rede LOUD real e o CHECK de modalidade logo
-- abaixo: se sobrar qualquer linha violando a regra depois deste UPDATE, o proprio `ALTER TABLE ...
-- ADD CONSTRAINT` (sem `NOT VALID`) falha ao validar as linhas existentes.
with corrigidos as (
  update public.platform_commercial_terms
    set sonar_unit_cents = 0
    where modality = 1 and sonar_unit_cents <> 0
    returning id, org_id
)
insert into public.platform_audit_events (org_id, actor_id, category, action, result, target, reason, details)
select org_id, null, 'admin', 'platform_terms_sonar_corrected', 'success', id::text,
  'ADR-0165: modalidade 1 nao cobra Sonar do cliente', jsonb_build_object('sonar_unit_cents_after', 0)
from corrigidos;

alter table public.platform_commercial_terms enable trigger platform_commercial_terms_no_mutation;

do $$
begin
  if exists (
    select 1 from public.platform_commercial_terms
    where revenue_bps_t1 is null or revenue_bps_t2 is null
       or revenue_bps_t3 is null or revenue_bps_t4 is null
  ) then
    raise exception 'backfill de faixas incompleto' using errcode = '23514';
  end if;
end $$;

alter table public.platform_commercial_terms
  alter column revenue_bps_t1 set not null,
  alter column revenue_bps_t2 set not null,
  alter column revenue_bps_t3 set not null,
  alter column revenue_bps_t4 set not null,
  add constraint platform_commercial_terms_tiers_range check (
    revenue_bps_t1 between 0 and 10000 and revenue_bps_t2 between 0 and 10000
    and revenue_bps_t3 between 0 and 10000 and revenue_bps_t4 between 0 and 10000
  ),
  add constraint platform_commercial_terms_modality_shape check (
    (modality <> 1 or sonar_unit_cents = 0)
    and (modality <> 2 or monthly_fee_cents = 0)
  ),
  drop column revenue_bps;

create or replace function public.platform_save_terms(p_actor uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_starts_on date;
  v_modality smallint;
  v_monthly_fee bigint;
  v_revenue_bps_t1 integer;
  v_revenue_bps_t2 integer;
  v_revenue_bps_t3 integer;
  v_revenue_bps_t4 integer;
  v_sonar_unit bigint;
  v_setup_fee bigint;
  v_setup_due date;
  v_reason text;
  v_modality_text text;
  v_monthly_fee_text text;
  v_revenue_bps_t1_text text;
  v_revenue_bps_t2_text text;
  v_revenue_bps_t3_text text;
  v_revenue_bps_t4_text text;
  v_sonar_unit_text text;
  v_setup_fee_text text;
  v_version integer;
  v_term public.platform_commercial_terms%rowtype;
  v_current_month date;
  v_next_month date;
  v_min_starts date;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor and p.is_super_admin and p.is_active
  ) then
    raise exception 'Active super-admin actor required' using errcode = '42501';
  end if;

  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'Commercial terms input is required' using errcode = '22023';
  end if;

  begin
    v_org_id := (p_input->>'org_id')::uuid;
    v_starts_on := (p_input->>'starts_on')::date;
  exception when others then
    raise exception 'Invalid commercial terms input' using errcode = '22023';
  end;

  v_modality_text := p_input->>'modality';
  v_monthly_fee_text := p_input->>'monthly_fee_cents';
  v_revenue_bps_t1_text := p_input->>'revenue_bps_t1';
  v_revenue_bps_t2_text := p_input->>'revenue_bps_t2';
  v_revenue_bps_t3_text := p_input->>'revenue_bps_t3';
  v_revenue_bps_t4_text := p_input->>'revenue_bps_t4';
  v_sonar_unit_text := p_input->>'sonar_unit_cents';
  v_setup_fee_text := p_input->>'setup_fee_cents';

  if v_org_id is null or v_starts_on is null
    or jsonb_typeof(p_input->'modality') is distinct from 'number'
    or v_modality_text !~ '^(0|[1-9][0-9]*)$'
    or v_modality_text not in ('1', '2')
    or jsonb_typeof(p_input->'revenue_bps_t1') is distinct from 'number'
    or v_revenue_bps_t1_text !~ '^(0|[1-9][0-9]*)$'
    or length(v_revenue_bps_t1_text) > 5
    or jsonb_typeof(p_input->'revenue_bps_t2') is distinct from 'number'
    or v_revenue_bps_t2_text !~ '^(0|[1-9][0-9]*)$'
    or length(v_revenue_bps_t2_text) > 5
    or jsonb_typeof(p_input->'revenue_bps_t3') is distinct from 'number'
    or v_revenue_bps_t3_text !~ '^(0|[1-9][0-9]*)$'
    or length(v_revenue_bps_t3_text) > 5
    or jsonb_typeof(p_input->'revenue_bps_t4') is distinct from 'number'
    or v_revenue_bps_t4_text !~ '^(0|[1-9][0-9]*)$'
    or length(v_revenue_bps_t4_text) > 5
    or jsonb_typeof(p_input->'monthly_fee_cents') is distinct from 'number'
    or v_monthly_fee_text !~ '^(0|[1-9][0-9]*)$'
    or length(v_monthly_fee_text) > 16
    or (length(v_monthly_fee_text) = 16 and v_monthly_fee_text > '9007199254740991')
    or jsonb_typeof(p_input->'sonar_unit_cents') is distinct from 'number'
    or v_sonar_unit_text !~ '^(0|[1-9][0-9]*)$'
    or length(v_sonar_unit_text) > 16
    or (length(v_sonar_unit_text) = 16 and v_sonar_unit_text > '9007199254740991')
    or jsonb_typeof(p_input->'setup_fee_cents') is distinct from 'number'
    or v_setup_fee_text !~ '^(0|[1-9][0-9]*)$'
    or length(v_setup_fee_text) > 16
    or (length(v_setup_fee_text) = 16 and v_setup_fee_text > '9007199254740991')
    or jsonb_typeof(p_input->'reason') is distinct from 'string' then
    raise exception 'Invalid commercial terms input' using errcode = '22023';
  end if;

  v_modality := v_modality_text::smallint;
  v_monthly_fee := v_monthly_fee_text::bigint;
  v_revenue_bps_t1 := v_revenue_bps_t1_text::integer;
  v_revenue_bps_t2 := v_revenue_bps_t2_text::integer;
  v_revenue_bps_t3 := v_revenue_bps_t3_text::integer;
  v_revenue_bps_t4 := v_revenue_bps_t4_text::integer;
  v_sonar_unit := v_sonar_unit_text::bigint;
  v_setup_fee := v_setup_fee_text::bigint;
  v_reason := btrim(p_input->>'reason');

  if v_starts_on <> date_trunc('month', v_starts_on)::date
    or v_revenue_bps_t1 not between 0 and 10000
    or v_revenue_bps_t2 not between 0 and 10000
    or v_revenue_bps_t3 not between 0 and 10000
    or v_revenue_bps_t4 not between 0 and 10000
    or v_reason is null or v_reason = '' then
    raise exception 'Invalid commercial terms input' using errcode = '22023';
  end if;

  if v_modality = 1 and v_sonar_unit <> 0 then
    raise exception 'Modalidade 1 não cobra Sonar do cliente: informe 0,00' using errcode = '22023';
  end if;
  if v_modality = 2 and v_monthly_fee <> 0 then
    raise exception 'Modalidade 2 não tem infraestrutura separada: informe 0,00' using errcode = '22023';
  end if;

  if v_setup_fee = 0 then
    if p_input->>'setup_due_month' is not null then
      raise exception 'setup_due_month is invalid without setup fee' using errcode = '22023';
    end if;
    v_setup_due := null;
  else
    if jsonb_typeof(p_input->'setup_due_month') is distinct from 'string'
      or (p_input->>'setup_due_month') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
      raise exception 'setup_due_month must be YYYY-MM' using errcode = '22023';
    end if;
    v_setup_due := ((p_input->>'setup_due_month') || '-01')::date;
    if v_setup_due < v_starts_on then
      raise exception 'setup_due_month cannot precede starts_on' using errcode = '22023';
    end if;
  end if;

  perform 1 from public.organizations o where o.id = v_org_id for update;
  if not found then
    raise exception 'Organization not found' using errcode = '23503';
  end if;

  v_current_month := date_trunc('month', now() at time zone 'America/Fortaleza')::date;
  v_next_month := (v_current_month + interval '1 month')::date;
  v_min_starts := case
    when exists (select 1 from public.platform_commercial_terms t where t.org_id = v_org_id)
    then v_next_month
    else v_current_month
  end;

  if v_starts_on < v_min_starts then
    raise exception 'Invalid commercial terms input' using errcode = '22023';
  end if;

  select coalesce(max(t.version), 0) + 1 into v_version
  from public.platform_commercial_terms t
  where t.org_id = v_org_id and t.starts_on = v_starts_on;

  if v_setup_fee > 0 and exists (
    select 1 from public.platform_commercial_terms t where t.org_id = v_org_id
  ) then
    raise exception 'Setup fee cannot be reapplied on renegotiation' using errcode = '22023';
  end if;

  -- ADR-0164: a implantacao e obrigacao do contrato, nao da versao. platform_resolve_terms devolve
  -- so a linha mais nova do mes e platform_billing_preview le setup_fee_cents apenas dela -- entao
  -- uma renegociacao gravada com setup zerado no mesmo starts_on apagava a taxa da cobranca em
  -- silencio. Herdar do termo mais recente mantem a taxa viva sem afrouxar a trava acima (que
  -- continua avaliando o input) e sem risco de cobranca dupla (o preview exige
  -- setup_due_month = p_month e nenhum demonstrativo fechado com linha 'setup').
  -- So em renegociacao: `select into` sem linha grava NULL nas variaveis, e no primeiro contrato
  -- isso apagaria a implantacao que o operador acabou de informar.
  if exists (select 1 from public.platform_commercial_terms t where t.org_id = v_org_id) then
    select t.setup_fee_cents, t.setup_due_month into v_setup_fee, v_setup_due
    from public.platform_commercial_terms t
    where t.org_id = v_org_id
    order by t.starts_on desc, t.version desc
    limit 1;
    v_setup_fee := coalesce(v_setup_fee, 0);

    -- A versao nova comeca depois do mes da implantacao: herdar violaria
    -- platform_commercial_terms_setup_once (setup_due_month >= starts_on) e recusaria toda
    -- renegociacao a partir dali. Nao perde a taxa: platform_resolve_terms filtra
    -- starts_on <= p_on, entao o mes da implantacao continua resolvendo para o termo anterior.
    if v_setup_due < v_starts_on then
      v_setup_fee := 0;
      v_setup_due := null;
    end if;
  end if;

  insert into public.platform_commercial_terms (
    org_id, starts_on, modality, monthly_fee_cents,
    revenue_bps_t1, revenue_bps_t2, revenue_bps_t3, revenue_bps_t4,
    sonar_unit_cents, setup_fee_cents, setup_due_month, reason, created_by, version
  ) values (
    v_org_id, v_starts_on, v_modality, v_monthly_fee,
    v_revenue_bps_t1, v_revenue_bps_t2, v_revenue_bps_t3, v_revenue_bps_t4,
    v_sonar_unit, v_setup_fee, v_setup_due, v_reason, p_actor, v_version
  ) returning * into v_term;

  insert into public.platform_audit_events (
    org_id, actor_id, category, action, result, target, reason, details
  ) values (
    v_org_id, p_actor, 'admin', 'platform_terms_saved', 'success', v_term.id::text, v_reason,
    jsonb_build_object('starts_on', v_starts_on, 'version', v_version)
  );

  return to_jsonb(v_term);
end;
$$;

revoke all on function public.platform_save_terms(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.platform_save_terms(uuid, jsonb) to service_role;

commit;
```

- [ ] **Step 2: Corrigir 5 fixtures pré-existentes de `platform_commercial.sql` que violam a nova constraint de modalidade**

O `CHECK platform_commercial_terms_modality_shape` do Step 1 é adicionado SEM `NOT VALID` — ele
valida TODAS as linhas já existentes na tabela no momento do `ALTER TABLE`. Em
`supabase/tests/platform_commercial.sql`, 5 chamadas bem-sucedidas a `platform_save_terms`
(anteriores ao ponto onde esta migration entra) usam `modality: 2` com `monthly_fee_cents`
diferente de zero — fixtures de outras ADRs (implantação, validação de tipos, concorrência via
dblink) sem nenhuma relação com esta feature. `sonar_unit_cents` já é `0` nas 5, então trocar a
modalidade para `1` mantém cada uma legal sob a nova regra sem mudar nada do que esses testes
provam (nenhum deles afirma o valor de `modality` em si). Produção real não tem esse problema
(Avil, a única organização modalidade 2, já está com `monthly_fee_cents = 0`) — a alternativa de
adicionar a constraint com `NOT VALID` foi descartada porque deixaria pra sempre uma linha
potencialmente errada sem revalidação, o que contraria a regra do projeto contra dado financeiro
não verificado.

Troque `'modality', 2, 'monthly_fee_cents', 60000,` por `'modality', 1, 'monthly_fee_cents', 60000,`
nas duas ocorrências abaixo (uma delas é a organização "Org C" `...011`, a outra é a primeira
chamada de "Org A" `...001`):

```sql
      'starts_on', v_current, 'modality', 2, 'monthly_fee_cents', 60000,
      'revenue_bps', 700, 'sonar_unit_cents', 0, 'setup_fee_cents', 0,
      'setup_due_month', null, 'reason', 'primeiro contrato mês corrente'
```

```sql
      'starts_on', v_next, 'modality', 2, 'monthly_fee_cents', 60000,
      'revenue_bps', 700, 'sonar_unit_cents', 0, 'setup_fee_cents', 0,
      'setup_due_month', null, 'reason', 'primeira proposta'
```

Troque (organização "Org A", chamada "renegociação"):

```sql
      'starts_on', v_next, 'modality', 2, 'monthly_fee_cents', 70000,
      'revenue_bps', 700, 'sonar_unit_cents', 0, 'setup_fee_cents', 0,
      'setup_due_month', null, 'reason', 'renegociação'
```

por `'modality', 1, 'monthly_fee_cents', 70000,` no lugar de `'modality', 2, 'monthly_fee_cents', 70000,`.

E nas duas chamadas concorrentes via `dblink` (organização "Org A", "concorrência um"/"concorrência
dois"):

```sql
        'modality', 2, 'monthly_fee_cents', 71000, 'revenue_bps', 700,
```
```sql
        'modality', 2, 'monthly_fee_cents', 72000, 'revenue_bps', 700,
```

troque `'modality', 2,` por `'modality', 1,` nas duas (mantendo os `monthly_fee_cents` 71000/72000
intactos — é o valor que o teste de concorrência de versões confere).

Não toque na chamada "renegociação mês corrente" (a que espera a exceção `'renegotiation in current
month was accepted'`) — ela já é rejeitada antes de persistir, por outro motivo, então não precisa
satisfazer o novo `CHECK`.

- [ ] **Step 3: Encaixar a migration na cadeia de testes `platform_commercial.sql`, com uma fixture que exercita o backfill do Sonar de verdade**

A rodada de correção do Step 2 (achado C1) removeu a asserção de contagem, e o Step 2 (achado C2)
tirou toda organização pré-existente com `modality=2 e monthly_fee>0` — mas nenhuma fixture do
arquivo tem hoje `modality=1 e sonar_unit_cents<>0` ANTES do `\ir` desta migration. Sem isso, o
`UPDATE ... where modality = 1 and sonar_unit_cents <> 0` do backfill (Step 1) sempre casa **zero**
linhas na suíte local — o teste passa mesmo que o `UPDATE` esteja quebrado, exatamente a classe de
bug já registrada no projeto ("ramo só alcançado com valor > 0, todo teste usava 0"). Corrija isso
criando uma organização com o defeito medido em produção, usando a API pública (RPC) ANTES da
migration existir — é exatamente como o dado real de Daludi Shop/DSA foi parar lá.

Em `supabase/tests/platform_commercial.sql:353`, logo após a linha
`\ir ../migrations/20260918000000_adr164_implantacao_sobrevive_renegociacao.sql`, adicione:

```sql
-- ADR-0165: fixture com o defeito real medido em producao (modalidade 1 cobrando Sonar do
-- cliente), criada ANTES desta migration existir, pra provar que o backfill corrige de verdade
-- (nao so que a suite nao quebra quando zero linhas violam).
insert into public.organizations (id, nome, slug) values
  ('90000000-0000-0000-0000-000000000094', 'Org Sonar Legado', 'org-sonar-legado');

do $$
declare
  v_current date := date_trunc('month', now() at time zone 'America/Fortaleza')::date;
begin
  perform public.platform_save_terms(
    '80000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000094',
      'starts_on', v_current, 'modality', 1, 'monthly_fee_cents', 60000,
      'revenue_bps', 500, 'sonar_unit_cents', 120, 'setup_fee_cents', 0,
      'setup_due_month', null, 'reason', 'fixture pre-ADR-0165: modalidade 1 com sonar cobrado'
    )
  );
end $$;

\ir ../migrations/20260918010000_platform_commercial_terms_tiers.sql
```

- [ ] **Step 4: Corrigir a fixture de `platform_sonar.sql` (senão o `\ir` acima já quebra o teste de Sonar)**

Em `supabase/tests/platform_sonar.sql:24-31`, troque:

```sql
insert into public.platform_commercial_terms(
  org_id,starts_on,modality,monthly_fee_cents,revenue_bps,sonar_unit_cents,
  setup_fee_cents,setup_due_month,reason,created_by,version
) values
('90000000-0000-0000-0000-000000000001',date_trunc('month',now() at time zone 'America/Fortaleza')::date,
 1,0,0,125,0,null,'sonar fixture','80000000-0000-0000-0000-000000000001',1),
('90000000-0000-0000-0000-000000000002',date_trunc('month',now() at time zone 'America/Fortaleza')::date,
 1,0,0,275,0,null,'sonar fixture','80000000-0000-0000-0000-000000000001',1);
```

por:

```sql
insert into public.platform_commercial_terms(
  org_id,starts_on,modality,monthly_fee_cents,
  revenue_bps_t1,revenue_bps_t2,revenue_bps_t3,revenue_bps_t4,sonar_unit_cents,
  setup_fee_cents,setup_due_month,reason,created_by,version
) values
('90000000-0000-0000-0000-000000000001',date_trunc('month',now() at time zone 'America/Fortaleza')::date,
 2,0,0,0,0,0,125,0,null,'sonar fixture','80000000-0000-0000-0000-000000000001',1),
('90000000-0000-0000-0000-000000000002',date_trunc('month',now() at time zone 'America/Fortaleza')::date,
 2,0,0,0,0,0,275,0,null,'sonar fixture','80000000-0000-0000-0000-000000000001',1);
```

(modalidade vira 2 — já tinham `monthly_fee_cents=0`, então já satisfazem o novo `CHECK`; as 4 faixas
entram como 0 porque este arquivo testa consumo do Sonar, não percentual.)

- [ ] **Step 5: Corrigir 3 chamadas já existentes em `platform_commercial.sql` que ainda usam a chave `revenue_bps`**

Essas chamadas rodam DEPOIS do ponto onde o `\ir` da nova migration foi inserido (Step 2), então
`platform_save_terms` já vai exigir `revenue_bps_t1..t4` quando elas executarem — sem esta correção
as 3 quebram (a terceira quebra de um jeito sutil: a mensagem de erro vira genérica, mascarando o que
o teste original queria provar sobre `setup_due_month`).

Na primeira ocorrência (bloco `do $$` que testa "Org Implantacao", teste "implantacao com mes
valido"), troque as duas chamadas a `platform_save_terms` deste bloco — a primeira:

```sql
      'revenue_bps', 700, 'sonar_unit_cents', 120, 'setup_fee_cents', 300000,
      'setup_due_month', v_mes, 'reason', 'implantacao com mes valido'
```

por:

```sql
      'revenue_bps_t1', 700, 'revenue_bps_t2', 700, 'revenue_bps_t3', 700, 'revenue_bps_t4', 700,
      'sonar_unit_cents', 120, 'setup_fee_cents', 300000,
      'setup_due_month', v_mes, 'reason', 'implantacao com mes valido'
```

e, no mesmo bloco `do $$`, a segunda chamada (a que testa `setup_due_month` com formato errado):

```sql
        'revenue_bps', 700, 'sonar_unit_cents', 120, 'setup_fee_cents', 300000,
        'setup_due_month', '2026-10-01', 'reason', 'mes com dia nao e YYYY-MM'
```

por:

```sql
        'revenue_bps_t1', 700, 'revenue_bps_t2', 700, 'revenue_bps_t3', 700, 'revenue_bps_t4', 700,
        'sonar_unit_cents', 120, 'setup_fee_cents', 300000,
        'setup_due_month', '2026-10-01', 'reason', 'mes com dia nao e YYYY-MM'
```

Na segunda ocorrência (bloco `do $$` seguinte, teste "renegociacao depois da implantacao"):

```sql
      'revenue_bps', 600, 'sonar_unit_cents', 120, 'setup_fee_cents', 0,
      'setup_due_month', null, 'reason', 'renegociacao depois da implantacao'
```

por:

```sql
      'revenue_bps_t1', 600, 'revenue_bps_t2', 600, 'revenue_bps_t3', 600, 'revenue_bps_t4', 600,
      'sonar_unit_cents', 120, 'setup_fee_cents', 0,
      'setup_due_month', null, 'reason', 'renegociacao depois da implantacao'
```

- [ ] **Step 6: Adicionar os novos casos de teste ao final de `supabase/tests/platform_commercial.sql`**

A organização `...092` já existe no arquivo ("Org Heranca", teste de herança de implantação do
ADR-0164, criada mais acima) — use `...093` para não colidir.

Acrescente, ao final do arquivo:

```sql
-- ADR-0165: modalidade 1 nunca cobra Sonar do cliente; modalidade 2 nunca tem infra separada.
insert into public.organizations (id, nome, slug) values
  ('90000000-0000-0000-0000-000000000093', 'Org Faixas', 'org-faixas');

do $$
declare
  v_current date := date_trunc('month', now() at time zone 'America/Fortaleza')::date;
  v_erro text;
begin
  begin
    perform public.platform_save_terms(
      '80000000-0000-0000-0000-000000000001',
      jsonb_build_object(
        'org_id', '90000000-0000-0000-0000-000000000093',
        'starts_on', v_current, 'modality', 1, 'monthly_fee_cents', 60000,
        'revenue_bps_t1', 500, 'revenue_bps_t2', 400, 'revenue_bps_t3', 350, 'revenue_bps_t4', 300,
        'sonar_unit_cents', 120, 'setup_fee_cents', 0, 'setup_due_month', null,
        'reason', 'modalidade 1 tentando cobrar sonar'
      )
    );
    raise exception 'modalidade 1 com sonar deveria ter sido recusada';
  exception when sqlstate '22023' then
    get stacked diagnostics v_erro = message_text;
    if v_erro not like '%Modalidade 1 não cobra Sonar%' then
      raise exception 'mensagem inesperada para modalidade 1 com sonar: %', v_erro;
    end if;
  end;

  begin
    perform public.platform_save_terms(
      '80000000-0000-0000-0000-000000000001',
      jsonb_build_object(
        'org_id', '90000000-0000-0000-0000-000000000093',
        'starts_on', v_current, 'modality', 2, 'monthly_fee_cents', 60000,
        'revenue_bps_t1', 700, 'revenue_bps_t2', 600, 'revenue_bps_t3', 550, 'revenue_bps_t4', 500,
        'sonar_unit_cents', 120, 'setup_fee_cents', 0, 'setup_due_month', null,
        'reason', 'modalidade 2 tentando cobrar infra'
      )
    );
    raise exception 'modalidade 2 com infra deveria ter sido recusada';
  exception when sqlstate '22023' then
    get stacked diagnostics v_erro = message_text;
    if v_erro not like '%Modalidade 2 não tem infraestrutura%' then
      raise exception 'mensagem inesperada para modalidade 2 com infra: %', v_erro;
    end if;
  end;
end $$;

-- A trava de modalidade tambem protege quem grava direto na tabela, contornando a RPC (e o que
-- platform_sonar.sql e platform_billing.sql fazem em algumas fixtures).
do $$
begin
  begin
    insert into public.platform_commercial_terms (
      org_id, starts_on, modality, monthly_fee_cents,
      revenue_bps_t1, revenue_bps_t2, revenue_bps_t3, revenue_bps_t4,
      sonar_unit_cents, setup_fee_cents, setup_due_month, reason, created_by, version
    ) values (
      '90000000-0000-0000-0000-000000000093', date_trunc('month', now() at time zone 'America/Fortaleza')::date,
      1, 0, 500, 400, 350, 300, 120, 0, null, 'insert direto tentando furar a trava',
      '80000000-0000-0000-0000-000000000001', 99
    );
    raise exception 'insert direto com modalidade 1 e sonar deveria ter sido recusado pelo CHECK';
  exception when check_violation then null;
  end;
end $$;

-- Combinação correta: grava as 4 faixas.
do $$
declare
  v_current date := date_trunc('month', now() at time zone 'America/Fortaleza')::date;
  v_term jsonb;
begin
  v_term := public.platform_save_terms(
    '80000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000093',
      'starts_on', v_current, 'modality', 1, 'monthly_fee_cents', 60000,
      'revenue_bps_t1', 500, 'revenue_bps_t2', 400, 'revenue_bps_t3', 350, 'revenue_bps_t4', 300,
      'sonar_unit_cents', 0, 'setup_fee_cents', 0, 'setup_due_month', null,
      'reason', 'modalidade 1 correta'
    )
  );
  if (v_term->>'revenue_bps_t1')::int <> 500 or (v_term->>'revenue_bps_t4')::int <> 300 then
    raise exception 'faixas nao gravadas corretamente: %', v_term;
  end if;
end $$;

-- ADR-0165: prova o CAMINHO DE BACKFILL de verdade — org '...011' ("Org C") tem seu unico termo
-- gravado no TOPO deste arquivo, com o antigo 'revenue_bps' = 700, MUITO ANTES do \ir desta
-- migration. E a organizacao certa pra provar o backfill porque nao foi tocada por nenhuma chamada
-- posterior a platform_save_terms (ao contrario de orgs criadas depois do \ir, que ja gravam as 4
-- faixas diretamente via RPC e passariam neste teste mesmo que o backfill nunca tivesse rodado).
do $$
declare
  v_row public.platform_commercial_terms%rowtype;
begin
  select * into v_row from public.platform_commercial_terms
  where org_id = '90000000-0000-0000-0000-000000000011'
  order by starts_on desc, version desc limit 1;
  if v_row.revenue_bps_t1 is distinct from 700 or v_row.revenue_bps_t2 is distinct from 700
    or v_row.revenue_bps_t3 is distinct from 700 or v_row.revenue_bps_t4 is distinct from 700 then
    raise exception 'backfill nao preservou o revenue_bps antigo (700) nas 4 faixas: %', v_row;
  end if;
end $$;

-- O trigger de imutabilidade precisa continuar ativo depois que a migration o reabilita — a
-- mitigacao inteira do risco de desabilita-lo durante o backfill depende disso.
do $$
begin
  begin
    update public.platform_commercial_terms set monthly_fee_cents = 1
      where org_id = '90000000-0000-0000-0000-000000000011';
    raise exception 'trigger de imutabilidade deveria continuar ativo apos a migration';
  exception when check_violation then null;
  end;
end $$;

-- ADR-0165: prova que o backfill de fato CORRIGE o Sonar de modalidade 1 pre-existente (nao so
-- que a suite nao quebra quando zero linhas violam). Org '...094' foi criada no Step 3, ANTES do
-- \ir desta migration, exatamente com o defeito medido em producao.
do $$
declare
  v_row public.platform_commercial_terms%rowtype;
begin
  select * into v_row from public.platform_commercial_terms
  where org_id = '90000000-0000-0000-0000-000000000094'
  order by starts_on desc, version desc limit 1;
  if v_row.sonar_unit_cents <> 0 then
    raise exception 'backfill nao zerou o sonar de modalidade 1 pre-existente: %', v_row;
  end if;
  if not exists (
    select 1 from public.platform_audit_events
    where org_id = '90000000-0000-0000-0000-000000000094'
      and action = 'platform_terms_sonar_corrected'
  ) then
    raise exception 'correcao do sonar nao gerou evento de auditoria para a organizacao';
  end if;
end $$;
```

- [ ] **Step 7: Rodar a suíte SQL e confirmar verde**

Run: `psql -U supabase_admin -d codex_platform_admin_test_20260906 -f supabase/tests/platform_commercial.sql`

**Não** rode `platform_billing.sql` nesta tarefa — esse arquivo encadeia `platform_sonar.sql` e
depois aplica `platform_billing_preview`/`platform_billing_close` de uma migration anterior
(`20260907102428_platform_terms_contract_fix.sql`) que ainda lê `v_terms.revenue_bps`, coluna
removida por esta migration. Ele só volta a funcionar depois da Task 2. Rodar `platform_commercial.sql`
sozinho é a verificação correta e completa do escopo desta Task 1 (ele já encadeia a fundação e todas
as migrations anteriores relevantes via os `\ir` do próprio arquivo).
Expected: sem `ERROR`, script termina sem lançar exceção.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260918010000_platform_commercial_terms_tiers.sql \
  supabase/tests/platform_commercial.sql supabase/tests/platform_sonar.sql
git commit -m "feat(cobranca): faixas de percentual por organizacao (ADR-0165, migration 1)"
```

---

### Task 2: Migration 2 — função de faixa, `platform_billing_preview`/`close` com `applied_bps`

**Files:**
- Create: `supabase/migrations/20260918010100_platform_billing_tiers.sql`
- Modify: `supabase/tests/platform_billing.sql:22` (adicionar `\ir` da nova migration) e
  `supabase/tests/platform_billing.sql` (novos casos de teste ao final)

**Interfaces:**
- Consumes: `platform_commercial_terms.revenue_bps_t1..t4` (Task 1).
- Produces: `platform_terms_tier(bigint) returns smallint`, `platform_terms_tier_bps(bigint,
  integer, integer, integer, integer) returns integer`. `platform_billing_preview` retorna
  `applied_bps`/`applied_tier` na raiz do jsonb. `platform_billing_close` grava `applied_bps` em
  `platform_billing_statements.revenue_bps`. Linha `sonar` do preview só aparece quando
  `terms.sonar_unit_cents > 0`.

- [ ] **Step 1: Escrever a migration**

Crie `supabase/migrations/20260918010100_platform_billing_tiers.sql`:

```sql
-- ADR-0165: a faixa de faturamento aplicavel e escolhida automaticamente todo mes, pelo
-- faturamento liquido do mes (mesma base ja usada, v_base = greatest(gross - refund, 0)). Os
-- cortes sao fixos e vivem soh aqui.
--
-- platform_billing_close passa a gravar em platform_billing_statements.revenue_bps a aliquota
-- REALMENTE aplicada (applied_bps), nao mais o revenue_bps do termo (que deixou de existir na
-- migration anterior). Isso e o que a CTE `origin` de platform_billing_preview ja usa hoje para
-- recalcular credito de devolucao tardia de meses anteriores (st.revenue_bps) -- sem essa troca o
-- credito sairia errado em silencio.
--
-- A linha 'sonar' do preview so aparece quando o termo cobra Sonar (sonar_unit_cents > 0) -- ADR-
-- 0165 zera esse campo para toda organizacao modalidade 1, e mostrar "Consultas Sonar 0 x R$0,00"
-- seria ruido.

create or replace function public.platform_terms_tier(p_base_cents bigint) returns smallint
language sql immutable set search_path = '' as $$
  select case
    when p_base_cents <= 10000000 then 1::smallint
    when p_base_cents <= 30000000 then 2::smallint
    when p_base_cents <= 50000000 then 3::smallint
    else 4::smallint
  end
$$;

create or replace function public.platform_terms_tier_bps(
  p_base_cents bigint, p_t1 integer, p_t2 integer, p_t3 integer, p_t4 integer
) returns integer
language sql immutable set search_path = '' as $$
  select case public.platform_terms_tier(p_base_cents)
    when 1 then p_t1
    when 2 then p_t2
    when 3 then p_t3
    else p_t4
  end
$$;

revoke all on function public.platform_terms_tier(bigint) from public, anon, authenticated;
revoke all on function public.platform_terms_tier_bps(bigint, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.platform_terms_tier(bigint) to service_role;
grant execute on function public.platform_terms_tier_bps(bigint, integer, integer, integer, integer) to service_role;

create or replace function public.platform_billing_preview(p_actor uuid,p_org uuid,p_month date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_org public.organizations%rowtype;
declare v_terms public.platform_commercial_terms%rowtype;
declare v_start timestamptz;
declare v_end timestamptz;
declare v_sales jsonb := '[]'::jsonb;
declare v_blockers jsonb := '[]'::jsonb;
declare v_adjustments jsonb := '[]'::jsonb;
declare v_gross bigint := 0;
declare v_refund bigint := 0;
declare v_base bigint := 0;
declare v_fee bigint := 0;
declare v_applied_bps integer;
declare v_applied_tier smallint;
declare v_sonar_units integer := 0;
declare v_sonar bigint := 0;
declare v_infra bigint := 0;
declare v_setup bigint := 0;
declare v_late_credit bigint := 0;
declare v_carry bigint := 0;
declare v_credit_pool bigint := 0;
declare v_credit_applied bigint := 0;
declare v_total bigint := 0;
declare v_sources jsonb;
declare v_revision text;
declare v_lines jsonb;
begin
  perform public.platform_assert_admin_actor(p_actor);
  if p_month is null or p_month<>date_trunc('month',p_month)::date then raise exception 'invalid month' using errcode='22023'; end if;
  select * into v_org from public.organizations where id=p_org;
  if not found then raise exception 'organization not found' using errcode='23503'; end if;
  select * into v_terms from public.platform_resolve_terms(p_org,p_month);
  if v_terms.id is null then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','commercial_terms_required','message','Condição comercial ausente'));
  else
    v_infra:=v_terms.monthly_fee_cents;
    if v_terms.setup_due_month=p_month and not exists(
      select 1 from public.platform_billing_statements st
      cross join lateral jsonb_array_elements(st.snapshot->'lines') line
      where st.org_id=p_org and line->>'key'='setup'
    ) then v_setup:=v_terms.setup_fee_cents; end if;
  end if;
  v_start := (p_month::text||' 00:00:00 America/Fortaleza')::timestamptz;
  v_end := v_start+interval '1 month';

  with current_sales as (
    select s.id,s.atualizado_em,s.status,round(s.total_amount*100)::bigint gross_cents,
      case when s.status='refunded' then round(s.total_amount*100)::bigint
        else least(coalesce(r.refunded_product_cents,0),round(s.total_amount*100)::bigint) end refund_cents
    from public.ml_vendas s
    left join public.platform_matching_reconciliation(
      s.org_id, s.id, s.status, round(s.total_amount*100)::bigint
    ) r on true
    where s.org_id=p_org and s.date_closed>=v_start and s.date_closed<v_end
      and s.status in ('paid','partially_refunded','refunded')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'sale_id',s.id,'source_updated_at',s.atualizado_em,'status',s.status,'gross_cents',s.gross_cents,
      'refunded_product_cents',s.refund_cents,
      'recognized_base_cents',greatest(s.gross_cents-s.refund_cents,0)
    ) order by s.id),'[]'::jsonb),coalesce(sum(s.gross_cents),0),coalesce(sum(s.refund_cents),0)
  into v_sales,v_gross,v_refund
  from current_sales s;

  select v_blockers||coalesce(jsonb_agg(jsonb_build_object(
    'code','refund_reconciliation_required','message','Devolução exige conciliação de produto e frete','sale_id',s.id,
    'order_ref',s.order_id::text,'source_updated_at',s.atualizado_em,'gross_cents',round(s.total_amount*100)::bigint,
    'status',s.status,'refunded_product_cents',r.refunded_product_cents
  ) order by s.id),'[]'::jsonb) into v_blockers
  from public.ml_vendas s
  left join public.platform_matching_reconciliation(
    s.org_id, s.id, s.status, round(s.total_amount*100)::bigint
  ) r on true
  where s.org_id=p_org
    and public.platform_sale_needs_refund_reconciliation(s.status, s.tem_devolucao, s.estorno)
    and r.id is null
    and (s.date_closed>=v_start and s.date_closed<v_end
      or exists(select 1 from public.platform_billing_sale_facts f where f.org_id=p_org and f.sale_id=s.id));

  v_base:=greatest(v_gross-v_refund,0);
  if v_terms.id is not null then
    v_applied_bps := public.platform_terms_tier_bps(
      v_base, v_terms.revenue_bps_t1, v_terms.revenue_bps_t2, v_terms.revenue_bps_t3, v_terms.revenue_bps_t4
    );
    v_applied_tier := public.platform_terms_tier(v_base);
    v_fee := round(v_base::numeric * v_applied_bps / 10000)::bigint;
  end if;
  select count(*),coalesce(sum(total_cents),0) into v_sonar_units,v_sonar
    from public.platform_sonar_deliveries where org_id=p_org and month=p_month and units=1;

  select v_blockers||coalesce(jsonb_agg(jsonb_build_object(
    'code',case when s.id is null then 'billing_source_missing'
      when public.platform_sale_needs_refund_reconciliation(s.status, s.tem_devolucao, s.estorno) and r.id is null
        then 'refund_reconciliation_required' else 'billing_source_changed' end,
    'message',case when s.id is null then 'Venda original não está mais disponível'
      when public.platform_sale_needs_refund_reconciliation(s.status, s.tem_devolucao, s.estorno) and r.id is null
        then 'Devolução tardia exige conciliação' else 'Venda original foi alterada após o fechamento' end,
    'sale_id',f.sale_id,'order_ref',s.order_id::text,'source_updated_at',s.atualizado_em,
    'gross_cents',case when s.id is null then f.gross_cents else round(s.total_amount*100)::bigint end,
    'status',s.status,'refunded_product_cents',r.refunded_product_cents
  ) order by f.sale_id),'[]'::jsonb) into v_blockers
  from public.platform_billing_sale_facts f
  left join public.ml_vendas s on s.org_id=f.org_id and s.id=f.sale_id
  left join public.platform_matching_reconciliation(
    s.org_id, s.id, s.status, round(s.total_amount*100)::bigint
  ) r on true
  where f.org_id=p_org and (s.id is null
    or (public.platform_sale_needs_refund_reconciliation(s.status, s.tem_devolucao, s.estorno) and r.id is null)
    or (not public.platform_sale_needs_refund_reconciliation(s.status, s.tem_devolucao, s.estorno)
      and s.status not in ('refunded','cancelled')
      and (s.status is distinct from f.status or round(s.total_amount*100)::bigint<>f.gross_cents)));

  with origin as (
    select st.id,st.fee_cents,st.revenue_bps,
      round(sum(greatest(f.gross_cents-case
        when s.status in ('refunded','cancelled') then f.gross_cents
        when r.id is not null then least(r.refunded_product_cents,f.gross_cents)
        else f.refunded_product_cents end,0))::numeric*st.revenue_bps/10000)::bigint as revised_fee
    from public.platform_billing_statements st
    join public.platform_billing_sale_facts f on f.statement_id=st.id
    left join public.ml_vendas s on s.org_id=f.org_id and s.id=f.sale_id
    left join public.platform_matching_reconciliation(
      s.org_id, s.id, s.status, round(s.total_amount*100)::bigint
    ) r on true
    where st.org_id=p_org and st.month<p_month
    group by st.id,st.fee_cents,st.revenue_bps
  ), credited as (
    select (a->>'origin_statement_id')::uuid origin_id,coalesce(sum((a->>'amount_cents')::bigint),0) amount
    from public.platform_billing_statements st cross join lateral jsonb_array_elements(coalesce(st.snapshot->'adjustments','[]')) a
    where st.org_id=p_org and st.month<p_month group by 1
  ), due as (
    select o.id,greatest(o.fee_cents-o.revised_fee-coalesce(c.amount,0),0)::bigint amount
    from origin o left join credited c on c.origin_id=o.id
  ) select coalesce(jsonb_agg(jsonb_build_object('origin_statement_id',id,'amount_cents',amount) order by id)
      filter(where amount>0),'[]'::jsonb),coalesce(sum(amount) filter(where amount>0),0)
    into v_adjustments,v_late_credit from due;

  select coalesce((snapshot->>'credit_balance_cents')::bigint,0) into v_carry
    from public.platform_billing_statements where org_id=p_org and month<p_month order by month desc limit 1;
  v_carry:=coalesce(v_carry,0);
  v_credit_pool:=v_carry+v_late_credit;
  v_credit_applied:=least(v_credit_pool,v_infra+v_setup+v_fee+v_sonar);
  v_total:=v_infra+v_setup+v_fee+v_sonar-v_credit_applied;
  v_lines:=jsonb_build_array(
    jsonb_build_object('key','infrastructure','label','Infraestrutura','quantity',1,'unit_cents',v_infra,'amount_cents',v_infra,'source_type','commercial_terms','source_id',v_terms.id),
    jsonb_build_object('key','revenue','label','Remuneração ('||trim(trailing '.' from trim(trailing '0' from (coalesce(v_applied_bps,0)::numeric/100)::text))||'%)','quantity',null,'unit_cents',null,'amount_cents',v_fee,'source_type','sales','source_id',null)
  );
  if v_terms.id is not null and v_terms.sonar_unit_cents>0 then
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('key','sonar','label','Consultas Sonar','quantity',v_sonar_units,'unit_cents',v_terms.sonar_unit_cents,'amount_cents',v_sonar,'source_type','sonar_deliveries','source_id',null));
  end if;
  if v_setup>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('key','setup','label','Implantação','quantity',1,'unit_cents',v_setup,'amount_cents',v_setup,'source_type','commercial_terms','source_id',v_terms.id)); end if;
  if v_credit_applied>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('key','credits','label','Créditos de competências anteriores','quantity',null,'unit_cents',null,'amount_cents',-v_credit_applied,'source_type','billing_adjustment','source_id',null)); end if;
  v_sources:=jsonb_build_object('terms',to_jsonb(v_terms),'sales',v_sales,'sonar_units',v_sonar_units,
    'sonar_cents',v_sonar,'adjustments',v_adjustments,'credit_carry_cents',v_carry,'blockers',v_blockers);
  v_revision:=encode(pg_catalog.sha256(convert_to(v_sources::text,'UTF8')),'hex');
  return jsonb_build_object(
    'org_id',p_org,'org_name',v_org.nome,'month',to_char(p_month,'YYYY-MM'),'timezone','America/Fortaleza',
    'terms',case when v_terms.id is null then null else to_jsonb(v_terms) end,'gross_cents',v_gross,'refund_cents',v_refund,
    'base_cents',v_base,'fee_cents',v_fee,'applied_bps',v_applied_bps,'applied_tier',v_applied_tier,
    'sonar_units',v_sonar_units,'sonar_cents',v_sonar,'lines',v_lines,
    'total_cents',v_total,'credit_cents',v_credit_applied,'credit_balance_cents',v_credit_pool-v_credit_applied,
    'adjustments',v_adjustments,'sources',v_sales,'revision',v_revision,'blockers',v_blockers
  );
end;
$$;

create or replace function public.platform_billing_close(p_actor uuid,p_org uuid,p_month date,p_expected_revision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_existing public.platform_billing_statements%rowtype;
declare v_preview jsonb;
declare v_statement public.platform_billing_statements%rowtype;
declare v_first date;
begin
  perform public.platform_assert_admin_actor(p_actor);
  perform 1 from public.organizations where id=p_org for update;
  if not found then raise exception 'organization not found' using errcode='23503'; end if;
  select * into v_existing from public.platform_billing_statements where org_id=p_org and month=p_month;
  if found then return v_existing.snapshot||jsonb_build_object('id',v_existing.id,'closed_at',v_existing.closed_at,'closed_by',v_existing.closed_by); end if;
  if p_month>=date_trunc('month',now() at time zone 'America/Fortaleza')::date then
    raise exception 'only completed months can be closed' using errcode='22023';
  end if;
  lock table public.ml_vendas in share mode;
  lock table public.platform_revenue_reconciliations in share mode;
  lock table public.platform_sonar_deliveries in share mode;
  v_preview:=public.platform_billing_preview(p_actor,p_org,p_month);
  if v_preview->'terms' is null or jsonb_typeof(v_preview->'terms')='null' then
    raise exception 'commercial terms required' using errcode='23514';
  end if;
  if v_preview->>'revision' is distinct from p_expected_revision then raise exception 'billing revision conflict' using errcode='40001'; end if;
  if jsonb_array_length(v_preview->'blockers')>0 then raise exception 'billing preview has blockers' using errcode='23514'; end if;
  select min(starts_on) into v_first from public.platform_commercial_terms where org_id=p_org and starts_on<=p_month;
  if exists(select 1 from generate_series(v_first,p_month-interval '1 month',interval '1 month') as g(month_value)
    where not exists(select 1 from public.platform_billing_statements s where s.org_id=p_org and s.month=g.month_value::date)) then
    raise exception 'previous billing month must be closed first' using errcode='23514';
  end if;
  insert into public.platform_billing_statements(org_id,month,terms_id,revenue_bps,gross_cents,refund_cents,base_cents,
    fee_cents,sonar_cents,credit_cents,total_cents,revision,snapshot,closed_by)
  values(p_org,p_month,(v_preview->'terms'->>'id')::uuid,(v_preview->>'applied_bps')::integer,
    (v_preview->>'gross_cents')::bigint,(v_preview->>'refund_cents')::bigint,(v_preview->>'base_cents')::bigint,
    (v_preview->>'fee_cents')::bigint,(v_preview->>'sonar_cents')::bigint,(v_preview->>'credit_cents')::bigint,
    (v_preview->>'total_cents')::bigint,v_preview->>'revision',v_preview,p_actor) returning * into v_statement;
  insert into public.platform_billing_sale_facts(statement_id,org_id,sale_id,source_updated_at,status,gross_cents,refunded_product_cents,recognized_base_cents)
    select v_statement.id,p_org,(row->>'sale_id')::uuid,(row->>'source_updated_at')::timestamptz,
      row->>'status',(row->>'gross_cents')::bigint,(row->>'refunded_product_cents')::bigint,(row->>'recognized_base_cents')::bigint
    from jsonb_array_elements(v_preview->'sources') row;
  insert into public.platform_audit_events(org_id,actor_id,category,action,result,target,details)
    values(p_org,p_actor,'billing','billing_closed','success',v_statement.id::text,jsonb_build_object('month',p_month,'revision',v_statement.revision));
  return v_preview||jsonb_build_object('id',v_statement.id,'closed_at',v_statement.closed_at,'closed_by',v_statement.closed_by);
end;
$$;

revoke all on function public.platform_billing_preview(uuid,uuid,date) from public,anon,authenticated;
revoke all on function public.platform_billing_close(uuid,uuid,date,text) from public,anon,authenticated;
grant execute on function public.platform_billing_preview(uuid,uuid,date) to service_role;
grant execute on function public.platform_billing_close(uuid,uuid,date,text) to service_role;
```

- [ ] **Step 2: Encaixar a migration em `platform_billing.sql`**

Em `supabase/tests/platform_billing.sql:22`, logo após
`\ir ../migrations/20260907102428_platform_terms_contract_fix.sql`, adicione:

```sql
\ir ../migrations/20260918010100_platform_billing_tiers.sql
```

- [ ] **Step 3: Dividir a fixture "Org Billing" (`...003`) — ela testa infra + Sonar juntos, combinação que a Task 1 tornou ilegal**

`supabase/tests/platform_billing.sql:40` insere um termo para a organização `...003` com
`modality: 2, monthly_fee_cents: 60000, sonar_unit_cents: 120` — e o bloco de teste em `:76-99`
verifica infra (60000), percentual (45000) e Sonar (1200) na MESMA prévia. Depois da Task 1/2,
nenhuma modalidade permite essa combinação (modalidade 1 não cobra Sonar, modalidade 2 não tem
infra separada). Além disso, esse `insert` usa a coluna `revenue_bps` (singular), removida pela
Task 1 — ele já quebraria só por isso, independente da questão de modalidade.

**Vira `...003` modalidade 1 (fica com a cobertura de infra), e uma organização nova `...014`
modalidade 2 (cobertura de Sonar).**

Troque a linha do `insert` de `...003` (dentro do bloco de `insert into
public.platform_commercial_terms(...)` em `:36-47`):

```sql
  ('90000000-0000-0000-0000-000000000003',(date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date,2,60000,500,120,0,null,'billing fixture','80000000-0000-0000-0000-000000000001',1),
```

por (modalidade 1, sonar zerado, e a lista de colunas do `insert` — compartilhada por todas as
linhas do `values` — também precisa trocar `revenue_bps` pelas 4 colunas novas; ajuste a lista de
colunas em `:37-38` de acordo e repita o mesmo `revenue_bps` antigo (500) nas 4 posições em CADA
linha do `values`, já que nenhuma dessas fixtures testa faixa cruzando corte):

```sql
  ('90000000-0000-0000-0000-000000000003',(date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date,1,60000,500,500,500,500,0,0,null,'billing fixture','80000000-0000-0000-0000-000000000001',1),
```

Remova o loop de entregas do Sonar para `...003` (`:61-74`, o `do $$ declare i integer... for i in
1..10 loop ... insert into public.platform_sonar_deliveries ... values('90000000-0000-0000-0000-000000000003', ...`) — ele inteiro sai, a organização de infra não usa Sonar.

No bloco de teste (`:76-99`), a asserção numérica muda porque não há mais Sonar nessa prévia
(infra 60000 + percentual 45000 + sonar 0 = 105000, não mais 106200):

```sql
  if (v_preview->>'gross_cents')::bigint<>1000000 or (v_preview->>'refund_cents')::bigint<>100000
    or (v_preview->>'base_cents')::bigint<>900000 or (v_preview->>'fee_cents')::bigint<>45000
    or (v_preview->>'sonar_units')::integer<>10 or (v_preview->>'sonar_cents')::bigint<>1200
    or (v_preview->>'total_cents')::bigint<>106200 or jsonb_array_length(v_preview->'blockers')<>0 then
    raise exception 'numeric fixture failed: %',v_preview;
  end if;
```

por:

```sql
  if (v_preview->>'gross_cents')::bigint<>1000000 or (v_preview->>'refund_cents')::bigint<>100000
    or (v_preview->>'base_cents')::bigint<>900000 or (v_preview->>'fee_cents')::bigint<>45000
    or (v_preview->>'sonar_units')::integer<>0 or (v_preview->>'sonar_cents')::bigint<>0
    or (v_preview->>'total_cents')::bigint<>105000 or jsonb_array_length(v_preview->'blockers')<>0 then
    raise exception 'numeric fixture failed: %',v_preview;
  end if;
```

E, mais abaixo no mesmo bloco, `if (v_closed->>'total_cents')::bigint<>106200 then raise exception
'close changed preview'; end if;` vira `<>105000`. Não toque em mais nada desse bloco — o check de
revisão errada (`:88-92`) e os dois testes de imutabilidade (`:95-98`) não dependem de Sonar.

Adicione uma organização nova, só para provar que a linha de Sonar continua funcionando quando é a
modalidade certa que a cobra (insira logo depois do bloco de `...003`, antes do bloco da org
`...004` "Partial"):

```sql
insert into public.organizations(id,nome,slug) values
  ('90000000-0000-0000-0000-000000000014','Org Billing Sonar','org-billing-sonar');
insert into public.platform_commercial_terms(
  org_id,starts_on,modality,monthly_fee_cents,
  revenue_bps_t1,revenue_bps_t2,revenue_bps_t3,revenue_bps_t4,sonar_unit_cents,
  setup_fee_cents,setup_due_month,reason,created_by,version
) values
  ('90000000-0000-0000-0000-000000000014',(date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date,2,0,500,500,500,500,120,0,null,'billing sonar fixture','80000000-0000-0000-0000-000000000001',1);
insert into public.ml_vendas(id,org_id,order_id,date_closed,total_amount,status,atualizado_em,tem_devolucao,estorno) values
  ('50000000-0000-0000-0000-000000000014','90000000-0000-0000-0000-000000000014',300014,date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months'+interval '1 day',9000,'paid','2026-07-02T12:00:00Z',false,0),
  ('50000000-0000-0000-0000-000000000015','90000000-0000-0000-0000-000000000014',300015,date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months'+interval '2 days',1000,'refunded','2026-07-03T12:00:00Z',false,0);

do $$
declare i integer; v_result uuid; v_search uuid;
begin
  for i in 1..10 loop
    insert into public.platform_sonar_results(normalized_query,query_type,schema_version,generation,payload,state,valid_until)
      values('billing-sonar-'||i,'termo',1,1,jsonb_build_object('itens',jsonb_build_array(jsonb_build_object('id',i))),'ready',now()+interval '1 day') returning id into v_result;
    insert into public.platform_sonar_searches(org_id,actor_id,request_id,intent_key,normalized_query,query_type,result_id,state,origin,completed_at)
      values('90000000-0000-0000-0000-000000000014','80000000-0000-0000-0000-000000000001',gen_random_uuid(),'billing-sonar-'||i,'billing-sonar-'||i,'termo',v_result,'completed','cliente',now()) returning id into v_search;
    insert into public.platform_sonar_deliveries(org_id,result_id,search_id,actor_id,terms_id,month,unit_cents,units,total_cents)
      values('90000000-0000-0000-0000-000000000014',v_result,v_search,'80000000-0000-0000-0000-000000000001',
        (select id from public.platform_resolve_terms('90000000-0000-0000-0000-000000000014',(date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date)),
        (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date,120,1,120);
  end loop;
end $$;

do $$
declare v_month date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date;
declare v_preview jsonb; v_closed jsonb;
begin
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000014',v_month);
  if (v_preview->>'fee_cents')::bigint<>45000 or (v_preview->>'sonar_units')::integer<>10
    or (v_preview->>'sonar_cents')::bigint<>1200 or (v_preview->>'total_cents')::bigint<>46200
    or jsonb_array_length(v_preview->'blockers')<>0 then
    raise exception 'org modalidade 2 com sonar: numeric fixture failed: %',v_preview;
  end if;
  v_closed:=public.platform_billing_close('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000014',v_month,v_preview->>'revision');
  if (v_closed->>'total_cents')::bigint<>46200 then raise exception 'close changed preview (org sonar)'; end if;
end $$;
```

- [ ] **Step 4: Novos casos de teste ao final de `supabase/tests/platform_billing.sql`**

Adicione ao final do arquivo:

```sql
-- ADR-0165: platform_terms_tier escolhe a faixa certa nos pontos de borda dos cortes fixos
-- (10.000.000 / 30.000.000 / 50.000.000 centavos).
do $$
begin
  if public.platform_terms_tier(0) <> 1 then raise exception 'esperava faixa 1 para base 0'; end if;
  if public.platform_terms_tier(10000000) <> 1 then raise exception 'esperava faixa 1 no corte de 100K'; end if;
  if public.platform_terms_tier(10000001) <> 2 then raise exception 'esperava faixa 2 logo acima de 100K'; end if;
  if public.platform_terms_tier(30000000) <> 2 then raise exception 'esperava faixa 2 no corte de 300K'; end if;
  if public.platform_terms_tier(30000001) <> 3 then raise exception 'esperava faixa 3 logo acima de 300K'; end if;
  if public.platform_terms_tier(50000000) <> 3 then raise exception 'esperava faixa 3 no corte de 500K'; end if;
  if public.platform_terms_tier(50000001) <> 4 then raise exception 'esperava faixa 4 logo acima de 500K'; end if;
  if public.platform_terms_tier(999999999) <> 4 then raise exception 'esperava faixa 4 bem acima do ultimo corte'; end if;

  if public.platform_terms_tier_bps(30000001, 500, 400, 350, 300) <> 350 then
    raise exception 'platform_terms_tier_bps nao aplicou a faixa 3 corretamente';
  end if;
end $$;
```

**Achado Important da revisão**: toda fixture de billing acima usa `t1=t2=t3=t4` (mesmo percentual
em todas as faixas) com a base sempre caindo na faixa 1 — uma implementação que aplicasse o `gross`
em vez da `base`, ou o `t1` isolado em vez da faixa escolhida, passaria essa suíte inteira em verde.
Adicione a organização abaixo (faixas DISTINTAS, base caindo deliberadamente na faixa 3), que
discrimina isso de verdade — o revisor validou estes números rodando contra Postgres real antes de
propor o teste:

```sql
insert into public.organizations(id,nome,slug) values
  ('90000000-0000-0000-0000-000000000015','Org Tier Frozen','org-tier-frozen');
insert into public.platform_commercial_terms(
  org_id,starts_on,modality,monthly_fee_cents,
  revenue_bps_t1,revenue_bps_t2,revenue_bps_t3,revenue_bps_t4,sonar_unit_cents,
  setup_fee_cents,setup_due_month,reason,created_by,version
) values
  ('90000000-0000-0000-0000-000000000015',(date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date,2,0,500,400,350,300,0,0,null,'tier fixture','80000000-0000-0000-0000-000000000001',1);
insert into public.ml_vendas(id,org_id,order_id,date_closed,total_amount,status,atualizado_em,tem_devolucao,estorno) values
  ('50000000-0000-0000-0000-000000000017','90000000-0000-0000-0000-000000000015',300020,date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months'+interval '1 day',400000,'paid','2026-07-02T12:00:00Z',false,0),
  ('50000000-0000-0000-0000-000000000016','90000000-0000-0000-0000-000000000015',300021,date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months'+interval '2 days',350000,'refunded','2026-07-03T12:00:00Z',false,0);

do $$
declare v_origin date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date;
declare v_next date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '1 month')::date;
declare v_preview jsonb; v_closed jsonb;
begin
  -- gross 75.000.000 (400k pago + 350k devolvido), refund 35.000.000 (o devolvido), base 40.000.000
  -- -- cai na faixa 3 (350 bps), diferente de t1 (500): discrimina faixa real vs t1/media/gross.
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000015',v_origin);
  if (v_preview->>'gross_cents')::bigint<>75000000 or (v_preview->>'refund_cents')::bigint<>35000000
    or (v_preview->>'base_cents')::bigint<>40000000 or (v_preview->>'applied_tier')::int<>3
    or (v_preview->>'applied_bps')::int<>350 or (v_preview->>'fee_cents')::bigint<>1400000 then
    raise exception 'faixa nao discriminada corretamente (esperava tier 3, 350bps, fee 1400000): %',v_preview;
  end if;
  v_closed:=public.platform_billing_close('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000015',v_origin,v_preview->>'revision');
  if (select revenue_bps from public.platform_billing_statements where id=(v_closed->>'id')::uuid)<>350 then
    raise exception 'close nao gravou a faixa 3 (350bps) aplicada';
  end if;

  -- Devolucao tardia empurra a base revisada pra 5.000.000 (faixa 1, 500bps HOJE) -- o credito
  -- tem que usar a aliquota CONGELADA do fechamento (350), atravessando a fronteira de faixa.
  update public.ml_vendas set status='partially_refunded',atualizado_em='2026-08-04T12:00:00Z',tem_devolucao=true
    where id='50000000-0000-0000-0000-000000000017';
  perform public.platform_reconcile_revenue('80000000-0000-0000-0000-000000000001',jsonb_build_object(
    'org_id','90000000-0000-0000-0000-000000000015','sale_id','50000000-0000-0000-0000-000000000017',
    'source_updated_at','2026-08-04T12:00:00Z','refunded_product_cents',35000000,'reason','devolucao tardia atravessando faixa'));
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000015',v_next);
  if v_preview#>>'{adjustments,0,amount_cents}'<>'1225000' or (v_preview->>'credit_balance_cents')::bigint<>1225000 then
    raise exception 'credito de devolucao tardia nao usou a aliquota congelada (esperava 1225000): %',v_preview;
  end if;
end $$;
```

No bloco de teste da organização `...003` (o mesmo que o Step 3 acima já editou — variáveis
`v_preview`/`v_closed`), adicione as duas asserções abaixo logo após a chamada existente a
`platform_billing_preview` (a mesma que agora afirma `total_cents<>105000`):

```sql
  if (v_preview->>'applied_bps') is null then
    raise exception 'preview deveria expor applied_bps quando ha condicao comercial: %', v_preview;
  end if;
  if (v_preview->>'applied_tier') is null then
    raise exception 'preview deveria expor applied_tier quando ha condicao comercial: %', v_preview;
  end if;
```

E, logo após a chamada existente a `platform_billing_close` (a que atribui `v_closed`, mesmo bloco):

```sql
  if (select revenue_bps from public.platform_billing_statements where id = (v_closed->>'id')::uuid)
      <> (v_preview->>'applied_bps')::integer then
    raise exception 'close deveria gravar applied_bps em statements.revenue_bps';
  end if;
```

- [ ] **Step 5: Rodar a suíte SQL de verdade e confirmar verde**

`psql` não está direto no PATH deste ambiente, mas há um container Docker local do Supabase dev
rodando (`docker ps | grep supabase_db`) com o banco de teste dedicado
`codex_platform_admin_test_20260906` já criado dentro dele:

```bash
docker cp supabase/tests <container>:/tmp/sdd-test/supabase/tests
docker cp supabase/migrations <container>:/tmp/sdd-test/supabase/migrations
docker exec -w /tmp/sdd-test/supabase/tests <container> psql -U supabase_admin \
  -d codex_platform_admin_test_20260906 -v ON_ERROR_STOP=1 -f platform_billing.sql
```

(substitua `<container>` pelo nome real do `docker ps`; refaça os dois `docker cp` sempre que os
arquivos locais mudarem — a cópia no container é um snapshot, não um mount.)
Expected: `exit 0`, sem `ERROR`/`EXCEPTION` na saída. Cole a saída real (ou pelo menos confirme
código de saída) no relatório — não é aceitável reportar "não consegui testar" quando esse caminho
existe.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260918010100_platform_billing_tiers.sql supabase/tests/platform_billing.sql
git commit -m "feat(cobranca): faixa automatica na previa/fechamento (ADR-0165, migration 2)"
```

---

### Task 3: `_shared/platform-admin/types.ts`

**Files:**
- Modify: `supabase/functions/_shared/platform-admin/types.ts:4-22`

**Interfaces:**
- Consumes: nada (tipos puros).
- Produces: `CommercialTermsInput`/`CommercialTerms` com `revenue_bps_t1..t4`; `BillingPreview` com
  `applied_bps`/`applied_tier`. Toda tarefa de front consome estes tipos.

- [ ] **Step 1: Editar `types.ts`**

Troque:

```ts
export type CommercialTermsInput = {
  org_id: string;
  starts_on: string;
  modality: 1 | 2;
  monthly_fee_cents: Cents;
  revenue_bps: number;
  sonar_unit_cents: Cents;
  setup_fee_cents: Cents;
  setup_due_month: Month | null;
  reason: string;
};
```

por:

```ts
export type CommercialTermsInput = {
  org_id: string;
  starts_on: string;
  modality: 1 | 2;
  monthly_fee_cents: Cents;
  revenue_bps_t1: number;
  revenue_bps_t2: number;
  revenue_bps_t3: number;
  revenue_bps_t4: number;
  sonar_unit_cents: Cents;
  setup_fee_cents: Cents;
  setup_due_month: Month | null;
  reason: string;
};
```

E, no tipo `BillingPreview` (mesmo arquivo), logo após o campo `fee_cents: Cents;`, adicione:

```ts
  applied_bps: number | null;
  applied_tier: 1 | 2 | 3 | 4 | null;
```

- [ ] **Step 2: `deno check`**

Run: `cd supabase/functions && deno check _shared/platform-admin/types.ts`
Expected: sem erro de tipo neste arquivo isoladamente (os importadores só ficam consistentes depois
das Tasks 4-10 — é esperado que outros arquivos quebrem até lá).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/platform-admin/types.ts
git commit -m "feat(cobranca): tipos de faixas e applied_bps no contrato do platform-admin"
```

---

### Task 4: `_shared/platform-admin/validation.ts`

**Files:**
- Modify: `supabase/functions/_shared/platform-admin/validation.ts:33-34,53`
- Modify: `supabase/functions/_shared/platform-admin/__tests__/validation.test.ts`

**Interfaces:**
- Consumes: `CommercialTermsInput` (Task 3).
- Produces: `validateTerms(input: unknown): CommercialTermsInput` validando `revenue_bps_t1..t4` e
  rejeitando modalidade/campo incompatível.

- [ ] **Step 1: Editar `validation.ts`**

Substitua o bloco:

```ts
  if (typeof value.revenue_bps !== 'number' || !Number.isSafeInteger(value.revenue_bps) || value.revenue_bps < 0 || value.revenue_bps > 10000) {
    fail('revenue_bps deve estar entre 0 e 10000');
  }
```

por:

```ts
  for (const tier of ['revenue_bps_t1', 'revenue_bps_t2', 'revenue_bps_t3', 'revenue_bps_t4'] as const) {
    const tierValue = value[tier];
    if (typeof tierValue !== 'number' || !Number.isSafeInteger(tierValue) || tierValue < 0 || tierValue > 10000) {
      fail(`${tier} deve estar entre 0 e 10000`);
    }
  }
  if (value.modality === 1 && value.sonar_unit_cents !== 0) {
    fail('Modalidade 1 não cobra Sonar do cliente: informe 0');
  }
  if (value.modality === 2 && value.monthly_fee_cents !== 0) {
    fail('Modalidade 2 não tem infraestrutura separada: informe 0');
  }
```

(a checagem de modalidade entra depois da validação de `modality`/`sonar_unit_cents`/
`monthly_fee_cents` já existentes acima no arquivo — mantenha a ordem das checagens anteriores
intacta, só insira este bloco antes do `return`).

E troque o `return` final:

```ts
  return {
    org_id: value.org_id,
    starts_on: value.starts_on,
    modality: value.modality,
    monthly_fee_cents: cents(value.monthly_fee_cents, 'monthly_fee_cents'),
    revenue_bps: value.revenue_bps,
    sonar_unit_cents: cents(value.sonar_unit_cents, 'sonar_unit_cents'),
    setup_fee_cents: setupFee,
    setup_due_month: setupDueMonth,
    reason: value.reason.trim(),
  };
```

por:

```ts
  return {
    org_id: value.org_id,
    starts_on: value.starts_on,
    modality: value.modality,
    monthly_fee_cents: cents(value.monthly_fee_cents, 'monthly_fee_cents'),
    revenue_bps_t1: value.revenue_bps_t1 as number,
    revenue_bps_t2: value.revenue_bps_t2 as number,
    revenue_bps_t3: value.revenue_bps_t3 as number,
    revenue_bps_t4: value.revenue_bps_t4 as number,
    sonar_unit_cents: cents(value.sonar_unit_cents, 'sonar_unit_cents'),
    setup_fee_cents: setupFee,
    setup_due_month: setupDueMonth,
    reason: value.reason.trim(),
  };
```

- [ ] **Step 2: Atualizar `validation.test.ts`**

Troque a fixture `valid`:

```ts
const valid = {
  org_id: ORG,
  starts_on: '2026-10-01',
  modality: 2,
  monthly_fee_cents: 60000,
  revenue_bps: 700,
  sonar_unit_cents: 0,
  setup_fee_cents: 0,
  setup_due_month: null,
  reason: 'Negociação outubro',
};
```

por:

```ts
const valid = {
  org_id: ORG,
  starts_on: '2026-10-01',
  modality: 2,
  monthly_fee_cents: 0,
  revenue_bps_t1: 700,
  revenue_bps_t2: 600,
  revenue_bps_t3: 550,
  revenue_bps_t4: 500,
  sonar_unit_cents: 120,
  setup_fee_cents: 0,
  setup_due_month: null,
  reason: 'Negociação outubro',
};
```

(modalidade 2 exige `monthly_fee_cents: 0`; usei `sonar_unit_cents: 120` para a modalidade 2 ser
realista — ajuste o teste `'preserva valores zero e a infraestrutura da modalidade 2'` de acordo,
trocando as chaves que ele confere em `toMatchObject` de `monthly_fee_cents`/`sonar_unit_cents` para
o que este fixture agora afirma.)

Troque:

```ts
  it('rejeita percentual negativo', () => {
    expect(() => validateTerms({ ...valid, revenue_bps: -1 })).toThrow();
  });
```

por:

```ts
  it('rejeita percentual negativo em qualquer faixa', () => {
    expect(() => validateTerms({ ...valid, revenue_bps_t1: -1 })).toThrow();
    expect(() => validateTerms({ ...valid, revenue_bps_t4: -1 })).toThrow();
  });
```

Troque:

```ts
  it('rejeita modalidade e percentual decimais', () => {
    expect(() => validateTerms({ ...valid, modality: 1.5 })).toThrow();
    expect(() => validateTerms({ ...valid, revenue_bps: 0.5 })).toThrow();
  });
```

por:

```ts
  it('rejeita modalidade e percentual decimais', () => {
    expect(() => validateTerms({ ...valid, modality: 1.5 })).toThrow();
    expect(() => validateTerms({ ...valid, revenue_bps_t1: 0.5 })).toThrow();
  });

  it('rejeita modalidade 1 cobrando Sonar do cliente', () => {
    expect(() => validateTerms({ ...valid, modality: 1, monthly_fee_cents: 60000, sonar_unit_cents: 120 }))
      .toThrow('Modalidade 1 não cobra Sonar do cliente');
  });

  it('rejeita modalidade 2 com infraestrutura separada', () => {
    expect(() => validateTerms({ ...valid, modality: 2, monthly_fee_cents: 60000 }))
      .toThrow('Modalidade 2 não tem infraestrutura separada');
  });
```

- [ ] **Step 3: Rodar os testes**

Run: `pnpm test -- supabase/functions/_shared/platform-admin/__tests__/validation.test.ts`
Expected: todos os testes passam.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/platform-admin/validation.ts \
  supabase/functions/_shared/platform-admin/__tests__/validation.test.ts
git commit -m "feat(cobranca): validation.ts exige as 4 faixas e trava por modalidade"
```

---

### Task 5: Remover `_shared/platform-admin/billing.ts` (código morto)

**Files:**
- Delete: `supabase/functions/_shared/platform-admin/billing.ts`
- Delete: `supabase/functions/_shared/platform-admin/__tests__/billing.test.ts`

**Interfaces:**
- Consumes: nada — confirmado sem importador de produção (Task 3 quebraria o `deno check` deste
  arquivo, já que ele lê `terms.revenue_bps`, removido).

- [ ] **Step 1: Confirmar que nada mais importa este arquivo**

Run: `grep -rln "from './billing'\|from '\.\./billing'" supabase/functions --include=*.ts`
Expected: só o próprio `billing.ts`/`billing.test.ts` aparecem (nenhum outro arquivo).

- [ ] **Step 2: Apagar os dois arquivos**

```bash
git rm supabase/functions/_shared/platform-admin/billing.ts \
  supabase/functions/_shared/platform-admin/__tests__/billing.test.ts
```

- [ ] **Step 3: `deno check` em todo o diretório**

Run: `cd supabase/functions && deno check _shared/platform-admin/*.ts`
Expected: sem erro de import quebrado apontando para `billing.ts`.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(cobranca): remove billing.ts morto (revenue_bps deixou de existir no tipo)"
```

---

### Task 6: `handler.test.ts` — fixture de `save_terms`

**Files:**
- Modify: `supabase/functions/_shared/platform-admin/__tests__/handler.test.ts:66`

**Interfaces:**
- Consumes: `CommercialTermsInput` (Task 3).

- [ ] **Step 1: Editar a linha da tabela `it.each`**

Troque:

```ts
  ['save_terms', 'saveTerms', { org_id: ORG, starts_on: '2026-08-01', modality: 2, monthly_fee_cents: 10, revenue_bps: 500, sonar_unit_cents: 120, setup_fee_cents: 0, setup_due_month: null, reason: 'nova' }, [ACTOR, { org_id: ORG, starts_on: '2026-08-01', modality: 2, monthly_fee_cents: 10, revenue_bps: 500, sonar_unit_cents: 120, setup_fee_cents: 0, setup_due_month: null, reason: 'nova' }]],
```

por:

```ts
  ['save_terms', 'saveTerms', { org_id: ORG, starts_on: '2026-08-01', modality: 2, monthly_fee_cents: 0, revenue_bps_t1: 700, revenue_bps_t2: 600, revenue_bps_t3: 550, revenue_bps_t4: 500, sonar_unit_cents: 120, setup_fee_cents: 0, setup_due_month: null, reason: 'nova' }, [ACTOR, { org_id: ORG, starts_on: '2026-08-01', modality: 2, monthly_fee_cents: 0, revenue_bps_t1: 700, revenue_bps_t2: 600, revenue_bps_t3: 550, revenue_bps_t4: 500, sonar_unit_cents: 120, setup_fee_cents: 0, setup_due_month: null, reason: 'nova' }]],
```

(este teste só confere que o `handler` repassa o input validado para `repository.saveTerms` sem
alterar nada — trocar `monthly_fee_cents: 10` por `0` é necessário porque modalidade 2 agora exige
isso, senão `validateTerms` já rejeita antes de chegar no repositório mockado.)

- [ ] **Step 2: Rodar o teste**

Run: `pnpm test -- supabase/functions/_shared/platform-admin/__tests__/handler.test.ts`
Expected: todos os testes passam.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/platform-admin/__tests__/handler.test.ts
git commit -m "test(cobranca): atualiza fixture de save_terms para as 4 faixas"
```

---

### Task 7: `commercial-terms-form.tsx` — 4 faixas, trava por modalidade, rótulos reais

**Files:**
- Modify: `src/components/platform-admin/commercial-terms-form.tsx`
- Modify: `src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`

**Interfaces:**
- Consumes: `CommercialTerms`/`CommercialTermsInput` (Task 3).
- Produces: formulário com 4 inputs de percentual e campos Sonar/Infraestrutura desabilitados
  conforme modalidade — nenhuma outra tarefa consome a saída deste componente diretamente (é folha
  de UI), mas `org-billing.tsx` (Task 8) o renderiza sem mudança de props.

- [ ] **Step 1: Editar o tipo `FormState` e `initialState`**

Troque:

```ts
type FormState = {
  modality: '1' | '2';
  monthly: string;
  revenue: string;
  sonar: string;
  setup: string;
  setupDueMonth: string;
  reason: string;
};
```

por:

```ts
type FormState = {
  modality: '1' | '2';
  monthly: string;
  revenueT1: string;
  revenueT2: string;
  revenueT3: string;
  revenueT4: string;
  sonar: string;
  setup: string;
  setupDueMonth: string;
  reason: string;
};
```

Troque:

```ts
function initialState(current: CommercialTerms | null, startsOn: string): FormState {
  return {
    modality: String(current?.modality ?? 1) as '1' | '2',
    monthly: formatScaled(current?.monthly_fee_cents ?? 60_000, 2),
    revenue: formatScaled(current?.revenue_bps ?? 500, 2),
    sonar: formatScaled(current?.sonar_unit_cents ?? 120, 2),
    setup: formatScaled(current?.setup_fee_cents ?? 300_000, 2),
    setupDueMonth: current?.setup_due_month ?? startsOn.slice(0, 7),
    reason: '',
  };
}
```

por:

```ts
function initialState(current: CommercialTerms | null, startsOn: string): FormState {
  const modality = String(current?.modality ?? 1) as '1' | '2';
  return {
    modality,
    monthly: formatScaled(current?.monthly_fee_cents ?? (modality === '1' ? 60_000 : 0), 2),
    revenueT1: formatScaled(current?.revenue_bps_t1 ?? (modality === '2' ? 700 : 500), 2),
    revenueT2: formatScaled(current?.revenue_bps_t2 ?? (modality === '2' ? 600 : 400), 2),
    revenueT3: formatScaled(current?.revenue_bps_t3 ?? (modality === '2' ? 550 : 350), 2),
    revenueT4: formatScaled(current?.revenue_bps_t4 ?? (modality === '2' ? 500 : 300), 2),
    sonar: formatScaled(current?.sonar_unit_cents ?? (modality === '2' ? 120 : 0), 2),
    setup: formatScaled(current?.setup_fee_cents ?? 300_000, 2),
    setupDueMonth: current?.setup_due_month ?? startsOn.slice(0, 7),
    reason: '',
  };
}
```

- [ ] **Step 2: Editar o `submit` e o handler de troca de modalidade**

Troque, dentro de `submit`:

```ts
    const monthly = parseScaled(form.monthly, 2);
    const revenue = parseScaled(form.revenue, 2);
    const sonar = parseScaled(form.sonar, 2);
    const setup = parseScaled(form.setup, 2);
    if ([monthly, revenue, sonar, setup].some((value) => value === null)) {
      setError('Use valores positivos ou zero, com no máximo duas casas decimais.');
      return;
    }
```

por:

```ts
    const monthly = parseScaled(form.monthly, 2);
    const revenueT1 = parseScaled(form.revenueT1, 2);
    const revenueT2 = parseScaled(form.revenueT2, 2);
    const revenueT3 = parseScaled(form.revenueT3, 2);
    const revenueT4 = parseScaled(form.revenueT4, 2);
    const sonar = parseScaled(form.sonar, 2);
    const setup = parseScaled(form.setup, 2);
    if ([monthly, revenueT1, revenueT2, revenueT3, revenueT4, sonar, setup].some((value) => value === null)) {
      setError('Use valores positivos ou zero, com no máximo duas casas decimais.');
      return;
    }
```

E troque o corpo do `save.mutateAsync`:

```ts
      await save.mutateAsync({
        org_id: orgId,
        starts_on: effectiveStartsOn,
        modality: Number(form.modality) as 1 | 2,
        monthly_fee_cents: monthly!,
        revenue_bps: revenue!,
        sonar_unit_cents: sonar!,
        setup_fee_cents: isFirstContract ? setup! : 0,
        setup_due_month: isFirstContract ? form.setupDueMonth || null : null,
        reason: form.reason.trim(),
      });
```

por:

```ts
      await save.mutateAsync({
        org_id: orgId,
        starts_on: effectiveStartsOn,
        modality: Number(form.modality) as 1 | 2,
        monthly_fee_cents: form.modality === '2' ? 0 : monthly!,
        revenue_bps_t1: revenueT1!,
        revenue_bps_t2: revenueT2!,
        revenue_bps_t3: revenueT3!,
        revenue_bps_t4: revenueT4!,
        sonar_unit_cents: form.modality === '1' ? 0 : sonar!,
        setup_fee_cents: isFirstContract ? setup! : 0,
        setup_due_month: isFirstContract ? form.setupDueMonth || null : null,
        reason: form.reason.trim(),
      });
```

(o form força `0` no campo travado por modalidade no momento do envio — a UI também desabilita o
campo, ver Step 3, mas é o envio que garante o valor correto mesmo que o usuário tenha digitado algo
antes de trocar de modalidade.)

Troque o `onChange` do `select` de modalidade:

```tsx
                onChange={(event) => {
                  const modality = event.target.value as '1' | '2';
                  setForm((previous) => ({
                    ...previous,
                    modality,
                    revenue: current === null && !revenueTouched.current
                      ? modality === '2' ? '7,00' : '5,00'
                      : previous.revenue,
                  }));
                }}
```

por:

```tsx
                onChange={(event) => {
                  const modality = event.target.value as '1' | '2';
                  setForm((previous) => ({
                    ...previous,
                    modality,
                    ...(current === null && !revenueTouched.current
                      ? modality === '2'
                        ? { revenueT1: '7,00', revenueT2: '6,00', revenueT3: '5,50', revenueT4: '5,00' }
                        : { revenueT1: '5,00', revenueT2: '4,00', revenueT3: '3,50', revenueT4: '3,00' }
                      : {}),
                  }));
                }}
```

- [ ] **Step 3: Trocar o input único de percentual pelos 4, e travar Sonar/Infra por modalidade**

Troque as opções do `select` de modalidade:

```tsx
                <option value="1">1 · mensalidade + percentual</option>
                <option value="2">2 · percentual com infraestrutura</option>
```

por:

```tsx
                <option value="1">Modalidade 1 · Gestão Completa Daludi</option>
                <option value="2">Modalidade 2 · Gestão Completa + Inteligência</option>
```

Troque o bloco do input `terms-monthly` (Infraestrutura mensal) — adicione `disabled`:

```tsx
              <Input
                id="terms-monthly"
                aria-label="Infraestrutura mensal"
                inputMode="decimal"
                value={form.monthly}
                onChange={(event) => set('monthly', event.target.value)}
              />
```

por:

```tsx
              <Input
                id="terms-monthly"
                aria-label="Infraestrutura mensal"
                inputMode="decimal"
                disabled={form.modality === '2'}
                value={form.modality === '2' ? '0,00' : form.monthly}
                onChange={(event) => set('monthly', event.target.value)}
              />
```

Troque o bloco de `terms-revenue` (um único `label`/`Input`) por 4 labels/inputs:

```tsx
            <label className="space-y-1 text-sm" htmlFor="terms-revenue">
              <span className="font-medium">Percentual sobre receita</span>
              <Input
                id="terms-revenue"
                aria-label="Percentual sobre receita"
                inputMode="decimal"
                value={form.revenue}
                onChange={(event) => {
                  revenueTouched.current = true;
                  set('revenue', event.target.value);
                }}
              />
            </label>
```

por (os 4 campos entram AGRUPADOS num único item do grid pai, com `md:col-span-2` — sem isso o
formulário passa a ter um número ímpar de itens de 1 coluna antes do `Motivo` e sobra uma célula
vazia em telas `md+`; o agrupamento visual também deixa claro que são 4 pontos da MESMA escala, não
4 campos soltos que por acaso têm nomes parecidos — achado da revisão, relevante porque esta tela é
usada num painel admin premium):

```tsx
            <div className="space-y-2 md:col-span-2">
              <span className="text-sm font-medium">Percentual por faixa de faturamento</span>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <label className="space-y-1 text-sm" htmlFor="terms-revenue-t1">
                  <span className="text-xs text-muted-foreground">até R$100 mil</span>
                  <Input
                    id="terms-revenue-t1"
                    aria-label="Percentual até R$100 mil"
                    inputMode="decimal"
                    value={form.revenueT1}
                    onChange={(event) => {
                      revenueTouched.current = true;
                      set('revenueT1', event.target.value);
                    }}
                  />
                </label>
                <label className="space-y-1 text-sm" htmlFor="terms-revenue-t2">
                  <span className="text-xs text-muted-foreground">R$100–300 mil</span>
                  <Input
                    id="terms-revenue-t2"
                    aria-label="Percentual R$100–300 mil"
                    inputMode="decimal"
                    value={form.revenueT2}
                    onChange={(event) => {
                      revenueTouched.current = true;
                      set('revenueT2', event.target.value);
                    }}
                  />
                </label>
                <label className="space-y-1 text-sm" htmlFor="terms-revenue-t3">
                  <span className="text-xs text-muted-foreground">R$300–500 mil</span>
                  <Input
                    id="terms-revenue-t3"
                    aria-label="Percentual R$300–500 mil"
                    inputMode="decimal"
                    value={form.revenueT3}
                    onChange={(event) => {
                      revenueTouched.current = true;
                      set('revenueT3', event.target.value);
                    }}
                  />
                </label>
                <label className="space-y-1 text-sm" htmlFor="terms-revenue-t4">
                  <span className="text-xs text-muted-foreground">acima de R$500 mil</span>
                  <Input
                    id="terms-revenue-t4"
                    aria-label="Percentual acima de R$500 mil"
                    inputMode="decimal"
                    value={form.revenueT4}
                    onChange={(event) => {
                      revenueTouched.current = true;
                      set('revenueT4', event.target.value);
                    }}
                  />
                </label>
              </div>
            </div>
```

(os 4 `aria-label` ficam idênticos aos que já existiam — nenhum teste que usa `getByLabelText`
precisa mudar por causa deste agrupamento; só o texto VISÍVEL dentro de cada `label` encurtou, já
que o `aria-label` carrega a descrição completa.

**Atenção — isto sozinho NÃO resta a paridade do grid** (achado da 2ª rodada de revisão: o cálculo
"vira 6 itens, par" da 1ª rodada estava errado. O que decide se sobra buraco não é o número total de
itens, é o tamanho do *run* de itens de largura 1 entre um bloco de largura 2 e o próximo — o wrapper
das faixas é `md:col-span-2`, ocupa a própria linha, e o run seguinte [Sonar, Implantação, Mês da
implantação] tem 3 itens de largura 1, ímpar, sobrando buraco antes do `Motivo`. Corrija isso
também, ver logo abaixo, DEPOIS de editar o bloco do Sonar.)

Troque o bloco `terms-sonar` — adicione `disabled`:

```tsx
              <Input
                id="terms-sonar"
                aria-label="Sonar por consulta"
                inputMode="decimal"
                value={form.sonar}
                onChange={(event) => set('sonar', event.target.value)}
              />
```

por:

```tsx
              <Input
                id="terms-sonar"
                aria-label="Sonar por consulta"
                inputMode="decimal"
                disabled={form.modality === '1'}
                value={form.modality === '1' ? '0,00' : form.sonar}
                onChange={(event) => set('sonar', event.target.value)}
              />
```

**Correção real da paridade do grid** (achado da 2ª rodada): agrupe os 3 campos seguintes — Sonar,
Implantação e Mês da implantação — no MESMO `<label>`/`<Input>` de cada um, só que dentro de um
wrapper `md:col-span-2` com sub-grid de 3 colunas, do mesmo jeito que o grupo de faixas. Sem label de
grupo aqui (não são uma unidade conceitual, é só correção de layout — cada campo já tem seu próprio
rótulo). Troque o trecho (os 3 blocos `<label>` inteiros de `terms-sonar`, `terms-setup` e
`terms-setup-month`, já com a trava do Sonar aplicada acima):

```tsx
            <label className="space-y-1 text-sm" htmlFor="terms-sonar">
              <span className="font-medium">Sonar por consulta</span>
              <Input
                id="terms-sonar"
                aria-label="Sonar por consulta"
                inputMode="decimal"
                disabled={form.modality === '1'}
                value={form.modality === '1' ? '0,00' : form.sonar}
                onChange={(event) => set('sonar', event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm" htmlFor="terms-setup">
              <span className="font-medium">Implantação</span>
              <Input
                id="terms-setup"
                aria-label="Implantação"
                inputMode="decimal"
                disabled={!isFirstContract}
                value={form.setup}
                onChange={(event) => set('setup', event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm" htmlFor="terms-setup-month">
              <span className="font-medium">Mês da implantação</span>
              <Input
                id="terms-setup-month"
                aria-label="Mês da implantação"
                type="month"
                disabled={!isFirstContract}
                value={form.setupDueMonth}
                onChange={(event) => set('setupDueMonth', event.target.value)}
              />
            </label>
```

por:

```tsx
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 md:col-span-2">
              <label className="space-y-1 text-sm" htmlFor="terms-sonar">
                <span className="font-medium">Sonar por consulta</span>
                <Input
                  id="terms-sonar"
                  aria-label="Sonar por consulta"
                  inputMode="decimal"
                  disabled={form.modality === '1'}
                  value={form.modality === '1' ? '0,00' : form.sonar}
                  onChange={(event) => set('sonar', event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm" htmlFor="terms-setup">
                <span className="font-medium">Implantação</span>
                <Input
                  id="terms-setup"
                  aria-label="Implantação"
                  inputMode="decimal"
                  disabled={!isFirstContract}
                  value={form.setup}
                  onChange={(event) => set('setup', event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm" htmlFor="terms-setup-month">
                <span className="font-medium">Mês da implantação</span>
                <Input
                  id="terms-setup-month"
                  aria-label="Mês da implantação"
                  type="month"
                  disabled={!isFirstContract}
                  value={form.setupDueMonth}
                  onChange={(event) => set('setupDueMonth', event.target.value)}
                />
              </label>
            </div>
```

(os 3 `aria-label` continuam idênticos — nenhum teste muda por causa disto. Com isto, TODO item de
nível superior do formulário passa a ser largura 2 depois da primeira linha [Modalidade,
Infraestrutura]: `[Modalidade, Infra]`(preenche a linha 1) → `[Faixas]`(span2, linha própria) →
`[Sonar+Implantação+Mês]`(span2, linha própria) → `[Início da vigência]`(span2, condicional, linha
própria) → `[Motivo]`(span2, linha própria). Nenhum bloco span-2 nunca sobra num resto de linha
parcialmente ocupada — zero buraco possível, independente de quais campos são condicionais.)

- [ ] **Step 4: Card-resumo e histórico — mostrar a faixa, não um número só**

Troque:

```tsx
                <CardDescription>
                  Modalidade {current.modality} · {formatScaled(current.revenue_bps, 2)}% sobre receita
                  {' '}· {current.starts_on > today ? 'a partir de' : 'desde'} {current.starts_on}
                </CardDescription>
```

por:

```tsx
                <CardDescription>
                  Modalidade {current.modality} · {formatScaled(current.revenue_bps_t1, 2)}% a {formatScaled(current.revenue_bps_t4, 2)}% sobre receita
                  {' '}· {current.starts_on > today ? 'a partir de' : 'desde'} {current.starts_on}
                </CardDescription>
```

Troque:

```tsx
                    modalidade {term.modality} · {formatScaled(term.revenue_bps, 2)}%
```

por:

```tsx
                    modalidade {term.modality} · {formatScaled(term.revenue_bps_t1, 2)}% a {formatScaled(term.revenue_bps_t4, 2)}%
```

- [ ] **Step 5: Atualizar `commercial-terms-form.test.tsx`**

Troque a fixture `current`:

```ts
const current: CommercialTerms = {
  id: 'terms-current',
  org_id: 'org-a',
  starts_on: '2026-09-01',
  modality: 1,
  monthly_fee_cents: 0,
  revenue_bps: 0,
  sonar_unit_cents: 0,
  setup_fee_cents: 0,
  setup_due_month: null,
  reason: 'condição atual',
  version: 1,
  timezone: 'America/Fortaleza',
  created_at: '2026-09-01T03:00:00Z',
  created_by: 'admin',
};
```

por:

```ts
const current: CommercialTerms = {
  id: 'terms-current',
  org_id: 'org-a',
  starts_on: '2026-09-01',
  modality: 1,
  monthly_fee_cents: 0,
  revenue_bps_t1: 0,
  revenue_bps_t2: 0,
  revenue_bps_t3: 0,
  revenue_bps_t4: 0,
  sonar_unit_cents: 0,
  setup_fee_cents: 0,
  setup_due_month: null,
  reason: 'condição atual',
  version: 1,
  timezone: 'America/Fortaleza',
  created_at: '2026-09-01T03:00:00Z',
  created_by: 'admin',
};
```

No teste `'salva modalidade 2, infraestrutura e vigência no próximo mês'`, o `expect` continua igual
(não afirma percentual), sem mudança.

No teste `'contrato futuro prefila o formulario e o resumo diz "a partir de"'`, troque:

```ts
    const futuro = { ...current, starts_on: '2026-10-01', revenue_bps: 500, setup_fee_cents: 300_000, setup_due_month: '2026-10-01' };
    render(<CommercialTermsForm orgId="org-zero" current={futuro} onSaved={vi.fn()} />);

    expect(screen.getByText('Modalidade 1 · 5,00% sobre receita · a partir de 2026-10-01')).toBeInTheDocument();
```

por:

```ts
    const futuro = { ...current, starts_on: '2026-10-01', revenue_bps_t1: 500, revenue_bps_t4: 300, setup_fee_cents: 300_000, setup_due_month: '2026-10-01' };
    render(<CommercialTermsForm orgId="org-zero" current={futuro} onSaved={vi.fn()} />);

    expect(screen.getByText('Modalidade 1 · 5,00% a 3,00% sobre receita · a partir de 2026-10-01')).toBeInTheDocument();
```

No teste `'preserva zeros e os valores digitados ao trocar modalidade'`, troque o `expect` final:

```ts
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      org_id: 'org-zero',
      modality: 2,
      monthly_fee_cents: 0,
      revenue_bps: 0,
      sonar_unit_cents: 0,
      setup_fee_cents: 0,
    }));
```

por:

```ts
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      org_id: 'org-zero',
      modality: 2,
      monthly_fee_cents: 0,
      revenue_bps_t1: 0,
      revenue_bps_t2: 0,
      revenue_bps_t3: 0,
      revenue_bps_t4: 0,
      sonar_unit_cents: 0,
      setup_fee_cents: 0,
    }));
```

No teste `'aplica o padrão de 7% da modalidade 2 sem sobrescrever percentual digitado'`, troque
`screen.getByLabelText('Percentual sobre receita')` pelas 4 chamadas por faixa:

```ts
  it('aplica o padrão de 7% da modalidade 2 sem sobrescrever percentual digitado', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CommercialTermsForm orgId="org-a" current={null} onSaved={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Modalidade'), '2');
    expect(screen.getByLabelText('Percentual até R$100 mil')).toHaveValue('7,00');
    await user.clear(screen.getByLabelText('Percentual até R$100 mil'));
    await user.type(screen.getByLabelText('Percentual até R$100 mil'), '4,25');
    await user.selectOptions(screen.getByLabelText('Modalidade'), '1');

    expect(screen.getByLabelText('Percentual até R$100 mil')).toHaveValue('4,25');
  });
```

No teste `'com condição vigente, o card abre recolhido com o resumo e "Renegociar"'`, troque:

```ts
    expect(screen.getByText('Modalidade 1 · 0,00% sobre receita · desde 2026-09-01')).toBeInTheDocument();
```

por:

```ts
    expect(screen.getByText('Modalidade 1 · 0,00% a 0,00% sobre receita · desde 2026-09-01')).toBeInTheDocument();
```

Adicione dois testes novos ao final do `describe`, antes do `});` final:

```ts
  it('trava Sonar em 0,00 na modalidade 1 e Infraestrutura em 0,00 na modalidade 2', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CommercialTermsForm orgId="org-a" current={null} onSaved={vi.fn()} />);

    expect(screen.getByLabelText('Sonar por consulta')).toBeDisabled();
    expect(screen.getByLabelText('Sonar por consulta')).toHaveValue('0,00');

    await user.selectOptions(screen.getByLabelText('Modalidade'), '2');
    expect(screen.getByLabelText('Sonar por consulta')).not.toBeDisabled();
    expect(screen.getByLabelText('Infraestrutura mensal')).toBeDisabled();
    expect(screen.getByLabelText('Infraestrutura mensal')).toHaveValue('0,00');
  });
```

**Achado Important da revisão**: o teste acima só confere o valor EXIBIDO no campo travado, nunca
o que é de fato ENVIADO no `submit` quando o usuário digitou um valor diferente de zero antes de
trocar de modalidade (o critério de aceite nº4 do brief). Sem isso, um refactor que removesse a
ternária de força-zero do `submit` passaria despercebido pela suíte. Adicione mais dois testes,
logo após o de cima:

```ts
  it('envia monthly_fee_cents zerado mesmo se o usuário digitou algo antes de trocar para modalidade 2', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CommercialTermsForm orgId="org-a" current={null} onSaved={vi.fn()} />);

    await user.clear(screen.getByLabelText('Infraestrutura mensal'));
    await user.type(screen.getByLabelText('Infraestrutura mensal'), '999,00');
    await user.selectOptions(screen.getByLabelText('Modalidade'), '2');
    await user.type(screen.getByLabelText('Motivo'), 'trava no envio');
    await user.click(screen.getByRole('button', { name: 'Salvar condições' }));

    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ monthly_fee_cents: 0 }));
  });

  it('envia sonar_unit_cents zerado mesmo se o usuário digitou algo antes de trocar para modalidade 1', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CommercialTermsForm orgId="org-a" current={null} onSaved={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Modalidade'), '2');
    await user.clear(screen.getByLabelText('Sonar por consulta'));
    await user.type(screen.getByLabelText('Sonar por consulta'), '888,00');
    await user.selectOptions(screen.getByLabelText('Modalidade'), '1');
    await user.type(screen.getByLabelText('Motivo'), 'trava no envio');
    await user.click(screen.getByRole('button', { name: 'Salvar condições' }));

    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ sonar_unit_cents: 0 }));
  });
```

- [ ] **Step 6: Rodar os testes do componente**

Run: `pnpm test -- src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`
Expected: todos passam. Se algum `getByLabelText` antigo (`'Percentual sobre receita'`) ainda
aparecer numa asserção não listada acima, ajuste-o para o rótulo de faixa correspondente ao que o
teste pretende exercitar.

- [ ] **Step 7: Commit**

```bash
git add src/components/platform-admin/commercial-terms-form.tsx \
  src/components/platform-admin/__tests__/commercial-terms-form.test.tsx
git commit -m "feat(cobranca): formulario com 4 faixas e travas por modalidade"
```

---

### Task 8: `org-billing.tsx` — exibir `applied_bps`

**Files:**
- Modify: `src/components/platform-admin/org-billing.tsx:81`
- Modify: `src/components/platform-admin/__tests__/org-billing.test.tsx`

**Interfaces:**
- Consumes: `BillingPreview.applied_bps` (Task 3).

- [ ] **Step 1: Editar `Composition`**

Troque:

```tsx
    [`Percentual (${humanPercent(preview.terms?.revenue_bps)})`, preview.fee_cents],
```

por:

```tsx
    [`Percentual (${humanPercent(preview.applied_bps)})`, preview.fee_cents],
```

- [ ] **Step 2: Atualizar a fixture de teste**

Em `src/components/platform-admin/__tests__/org-billing.test.tsx`, troque a fixture `terms`:

```ts
const terms: CommercialTerms = {
  id: 'terms-1',
  org_id: 'org-a',
  starts_on: '2026-08-01',
  modality: 2,
  monthly_fee_cents: 60_000,
  revenue_bps: 500,
  sonar_unit_cents: 120,
  setup_fee_cents: 0,
  setup_due_month: null,
  reason: 'contrato',
  version: 1,
  timezone: 'America/Fortaleza',
  created_at: '2026-08-01T03:00:00Z',
  created_by: 'admin',
};
```

por (modalidade 2 agora exige `monthly_fee_cents: 0`; a linha "Infraestrutura" do `makePreview`
abaixo também precisa ficar `0` para não afirmar um dado que o backend rejeitaria):

```ts
const terms: CommercialTerms = {
  id: 'terms-1',
  org_id: 'org-a',
  starts_on: '2026-08-01',
  modality: 2,
  monthly_fee_cents: 0,
  revenue_bps_t1: 500,
  revenue_bps_t2: 400,
  revenue_bps_t3: 350,
  revenue_bps_t4: 300,
  sonar_unit_cents: 120,
  setup_fee_cents: 0,
  setup_due_month: null,
  reason: 'contrato',
  version: 1,
  timezone: 'America/Fortaleza',
  created_at: '2026-08-01T03:00:00Z',
  created_by: 'admin',
};
```

E em `makePreview`, adicione `applied_bps`/`applied_tier` e zere o `amount_cents` da linha de
infraestrutura (ela continua existindo no array — a migration 2 (Task 2) só torna condicionais as
linhas `sonar`/`setup`/`credits`; `infrastructure` e `revenue` são sempre emitidas, só que agora com
`amount_cents: 0` quando `monthly_fee_cents` é `0`), ajustando `total_cents` de acordo:

```ts
function makePreview(overrides: Partial<BillingPreview> = {}): BillingPreview {
  return {
    org_id: 'org-a',
    org_name: 'Loja Exemplo',
    month: '2026-08',
    timezone: 'America/Fortaleza',
    terms,
    gross_cents: 1_000_000,
    refund_cents: 100_000,
    base_cents: 900_000,
    fee_cents: 45_000,
    applied_bps: 500,
    applied_tier: 1,
    sonar_units: 10,
    sonar_cents: 1_200,
    lines: [
      { key: 'infrastructure', label: 'Infraestrutura', quantity: 1, unit_cents: 0, amount_cents: 0, source_type: 'commercial_terms', source_id: 'terms-1' },
      { key: 'revenue', label: 'Remuneração sobre vendas', quantity: null, unit_cents: null, amount_cents: 45_000, source_type: 'sales', source_id: null },
      { key: 'sonar', label: 'Consultas Sonar', quantity: 10, unit_cents: 120, amount_cents: 1_200, source_type: 'sonar_deliveries', source_id: null },
    ],
    total_cents: 46_200,
    credit_cents: 0,
    credit_balance_cents: 0,
    adjustments: [],
    sources: [],
    revision: 'rev-1',
    blockers: [],
    ...overrides,
  };
}
```

(mantive a linha `infrastructure` no array, só com valor 0 — removê-la seria inventar um formato que
o backend real não produz. Se algum teste específico do arquivo afirma o valor `106_200`, ajuste esse
teste para `46_200` — rode o Step 3 abaixo para achar exatamente quais.)

- [ ] **Step 3: Rodar os testes e corrigir divergências restantes**

Run: `pnpm test -- src/components/platform-admin/__tests__/org-billing.test.tsx`
Expected: falhas remanescentes (se houver) apontam exatamente qual asserção ainda espera
`total_cents: 106_200` ou o texto antigo de percentual — ajuste essas asserções para os valores
derivados do novo `makePreview` acima e rode de novo até verde.

- [ ] **Step 4: Commit**

```bash
git add src/components/platform-admin/org-billing.tsx \
  src/components/platform-admin/__tests__/org-billing.test.tsx
git commit -m "feat(cobranca): org-billing exibe a aliquota efetivamente aplicada"
```

---

### Task 9: `OrganizacaoDetalhe.tsx` — exibir `applied_bps`

**Files:**
- Modify: `src/pages/OrganizacaoDetalhe.tsx:164-169`
- Modify: `src/pages/__tests__/OrganizacaoDetalhe.test.tsx`

**Interfaces:**
- Consumes: `BillingPreview.applied_bps` (Task 3).

- [ ] **Step 1: Editar o subtítulo**

Troque:

```tsx
    } else if (preview.data?.terms) {
      const terms = preview.data.terms;
      subtitleNode = (
        <p className="text-sm text-muted-foreground">
          {org.slug} · Modalidade {terms.modality} · {humanPercent(terms.revenue_bps)} sobre receita
        </p>
      );
```

por:

```tsx
    } else if (preview.data?.terms) {
      const terms = preview.data.terms;
      subtitleNode = (
        <p className="text-sm text-muted-foreground">
          {org.slug} · Modalidade {terms.modality} · {humanPercent(preview.data.applied_bps)} sobre receita
        </p>
      );
```

- [ ] **Step 2: Atualizar a fixture de teste**

Em `src/pages/__tests__/OrganizacaoDetalhe.test.tsx`, troque:

```ts
    terms: { id: 't1', org_id: 'org-avil', starts_on: '2026-01-01', modality: 1, monthly_fee_cents: 0, revenue_bps: 500, sonar_unit_cents: 0, setup_fee_cents: 0, setup_due_month: null, reason: '', version: 1, timezone: 'America/Fortaleza', created_at: '', created_by: '' },
    gross_cents: 0, refund_cents: 0, base_cents: 0, fee_cents: 0, sonar_units: 0, sonar_cents: 0,
```

por (mantendo `monthly_fee_cents: 0` sem mudança — nada nesta tarefa exige alterá-lo, e um `CHECK`
de modalidade 1 aceita tanto `0` quanto um valor positivo; mudar um campo que ninguém pediu seria
edição fora do escopo):

```ts
    terms: { id: 't1', org_id: 'org-avil', starts_on: '2026-01-01', modality: 1, monthly_fee_cents: 0, revenue_bps_t1: 500, revenue_bps_t2: 400, revenue_bps_t3: 350, revenue_bps_t4: 300, sonar_unit_cents: 0, setup_fee_cents: 0, setup_due_month: null, reason: '', version: 1, timezone: 'America/Fortaleza', created_at: '', created_by: '' },
    gross_cents: 0, refund_cents: 0, base_cents: 0, fee_cents: 0, applied_bps: 500, applied_tier: 1, sonar_units: 0, sonar_cents: 0,
```

Se algum teste deste arquivo afirmar o texto antigo `"5,00% sobre receita"` (busque por
`sobre receita` no arquivo), o texto continua idêntico porque `applied_bps: 500` produz o mesmo
`humanPercent` de antes — nenhuma mudança de asserção é esperada além da fixture.

- [ ] **Step 3: Rodar os testes**

Run: `pnpm test -- src/pages/__tests__/OrganizacaoDetalhe.test.tsx`
Expected: todos passam.

- [ ] **Step 4: Commit**

```bash
git add src/pages/OrganizacaoDetalhe.tsx src/pages/__tests__/OrganizacaoDetalhe.test.tsx
git commit -m "feat(cobranca): pagina da organizacao exibe a aliquota efetivamente aplicada"
```

---

### Task 10: `lib/export/platform-billing.ts` — exportação usa `applied_bps`

**Files:**
- Modify: `src/lib/export/platform-billing.ts:19`
- Modify: `src/lib/export/__tests__/platform-billing.test.ts`

**Interfaces:**
- Consumes: `BillingStatement.applied_bps` (Task 3 — `BillingStatement` estende `BillingPreview`).

- [ ] **Step 1: Editar `buildSnapshotBlocks`**

Troque:

```ts
        {
          label: 'Percentual sobre receita',
          valor: formatPercent(terms?.revenue_bps ?? null),
        },
```

por:

```ts
        {
          label: 'Percentual sobre receita',
          valor: formatPercent(statement.applied_bps ?? null),
        },
```

(o parâmetro da função já se chama `statement: BillingStatement`, então `statement.applied_bps` está
disponível no escopo de `buildSnapshotBlocks`.)

- [ ] **Step 2: Atualizar a fixture de teste**

Em `src/lib/export/__tests__/platform-billing.test.ts`, troque:

```ts
  terms: {
    id: 'terms-1',
    org_id: 'org-1',
    starts_on: '2026-08-01',
    modality: 2,
    monthly_fee_cents: 50_000,
    revenue_bps: 500,
    sonar_unit_cents: 120,
    setup_fee_cents: 0,
    setup_due_month: null,
    reason: 'Contrato vigente',
    version: 1,
    timezone: 'America/Fortaleza',
    created_at: '2026-07-15T12:00:00Z',
    created_by: 'admin-1',
  },
  gross_cents: 1_000_000,
  refund_cents: 100_000,
  base_cents: 900_000,
  fee_cents: 45_000,
```

por:

```ts
  terms: {
    id: 'terms-1',
    org_id: 'org-1',
    starts_on: '2026-08-01',
    modality: 2,
    monthly_fee_cents: 0,
    revenue_bps_t1: 500,
    revenue_bps_t2: 400,
    revenue_bps_t3: 350,
    revenue_bps_t4: 300,
    sonar_unit_cents: 120,
    setup_fee_cents: 0,
    setup_due_month: null,
    reason: 'Contrato vigente',
    version: 1,
    timezone: 'America/Fortaleza',
    created_at: '2026-07-15T12:00:00Z',
    created_by: 'admin-1',
  },
  gross_cents: 1_000_000,
  refund_cents: 100_000,
  base_cents: 900_000,
  fee_cents: 45_000,
  applied_bps: 500,
  applied_tier: 1,
```

(troquei `monthly_fee_cents` de `50_000` para `0` — modalidade 2 exige isso; a linha `monthly_fee`
nas `lines` do fixture, mais abaixo no mesmo objeto, é um item independente de `lines[]` e não
precisa mudar, já que `lines` é o snapshot congelado tal como o fechamento gravou, não recalculado
a partir de `terms`.)

Na última asserção do arquivo, que muta `currentTerms` para provar que o relatório exportado não
muda:

```ts
  it('permanece idêntico quando condições atuais mudam fora do snapshot', () => {
    const before = buildBillingReport(statement);
    const currentTerms: CommercialTerms = { ...statement.terms!, revenue_bps: 900, sonar_unit_cents: 250 };
    currentTerms.revenue_bps = 1_000;

    expect(buildBillingReport(statement)).toEqual(before);
  });
```

troque por:

```ts
  it('permanece idêntico quando condições atuais mudam fora do snapshot', () => {
    const before = buildBillingReport(statement);
    const currentTerms: CommercialTerms = { ...statement.terms!, revenue_bps_t1: 900, sonar_unit_cents: 250 };
    currentTerms.revenue_bps_t1 = 1_000;

    expect(buildBillingReport(statement)).toEqual(before);
  });
```

(o teste já não usa `currentTerms` para nada além de provar, por tipo, que mutar uma cópia não afeta
`statement` — o comportamento testado não muda, só os nomes de campo.)

- [ ] **Step 3: Rodar os testes**

Run: `pnpm test -- src/lib/export/__tests__/platform-billing.test.ts`
Expected: todos passam.

- [ ] **Step 4: Commit**

```bash
git add src/lib/export/platform-billing.ts src/lib/export/__tests__/platform-billing.test.ts
git commit -m "feat(cobranca): exportacao do demonstrativo usa a aliquota efetivamente aplicada"
```

---

### Task 11: Verificação completa e ordem de deploy

**Files:** nenhum arquivo novo — só validação e documentação da ordem de entrega.

- [ ] **Step 1: Suíte completa**

Run: `pnpm test`
Expected: verde.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: sem erros nos arquivos alterados.

- [ ] **Step 3: `deno check` em todo o `_shared/platform-admin`**

Run: `cd supabase/functions && deno check _shared/platform-admin/*.ts platform-admin/index.ts materializar-metricas/index.ts`
Expected: sem erro de tipo (confirma que a remoção de `billing.ts` e a troca de `types.ts` não
deixaram nenhum importador quebrado).

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: sucesso.

- [ ] **Step 5: `db:check`**

Run: `npm run db:check`
Expected: as duas migrations novas passam na validação de schema.

- [ ] **Step 6: `preflight`**

Run: `pnpm preflight` (ou `pnpm preflight:static` se for o portão de pré-push vigente — conferir qual
está ativo no momento da execução)
Expected: verde. É o portão real de pré-push deste projeto — não considerar a entrega pronta sem ele.

- [ ] **Step 7: Medir produção ANTES do `db push`** (achado da revisão da Task 1 — a asserção de
contagem foi removida da migration por travar qualquer banco de teste do zero; isso move a
responsabilidade de "nenhuma linha fica sem corrigir/sem satisfazer a constraint" para uma medição
manual, feita uma vez, contra o banco real, antes do `db push` rodar):

Rode contra produção (read-only, via Management API/CLI conforme já é praxe no projeto):

```sql
-- Espera exatamente Daludi Shop e DSA (2 organizações) — são as que a migration corrige.
select org_id, count(*), array_agg(distinct sonar_unit_cents)
  from platform_commercial_terms where modality = 1 and sonar_unit_cents <> 0 group by org_id;

-- Espera 0 — senão o ADD CONSTRAINT platform_commercial_terms_modality_shape (sem NOT VALID)
-- aborta o db push, porque validaria essa linha e ela falharia.
select count(*) from platform_commercial_terms where modality = 2 and monthly_fee_cents <> 0;
```

Se a primeira trouxer qualquer organização além de Daludi Shop/DSA, ou a segunda vier diferente de
0: **pare, não rode o `db push`** — o dado real de produção divergiu do medido em 2026-09-18 quando
este design foi fechado, e a migration precisa ser revisada antes de aplicar (não é situação para
seguir "porque o plano manda").

- [ ] **Step 8: Documentar/lembrar a ordem de deploy em produção** (não é comando local — é o que o
orquestrador roda ao aprovar o merge, por causa da regra do projeto de nunca deixar Edge Functions
defasadas):

1. `supabase db push` (aplica as duas migrations, nesta ordem — `platform_commercial_terms_tiers`
   antes de `platform_billing_tiers`, que é a ordem cronológica dos arquivos).
2. Confirmar a versão aplicada (`supabase migration list` ou equivalente).
3. `supabase functions deploy platform-admin materializar-metricas` (as duas importam
   `_shared/platform-admin/`, então as duas precisam redeployar juntas — regra do CLAUDE.md do
   projeto para mudança em `_shared/`).
4. Só então merge/push do front na `main`.

- [ ] **Step 9: Commit final (se sobrar algo solto de lint/format automático)**

```bash
git add -A
git commit -m "chore(cobranca): ajustes finais de lint/format pos-verificacao" --allow-empty
```

(vazio de propósito se não houver nada para adicionar — não force um commit sem conteúdo real.)

---

## Self-Review

**Cobertura da spec:** os 5 pontos de "Decisões fechadas" do design (faixas fixas, percentuais por
org, cálculo automático, trava por modalidade, rótulos) estão nas Tasks 1, 3, 4, 7. A armadilha do
`applied_bps`/crédito de devolução tardia está na Task 2. As 4 ressalvas do Fable (split de
migrations, remoção de `billing.ts`, backfill LOUD, `begin`/`commit`) estão nas Tasks 1, 2 e 5. A
chamada de esconder a linha "Consultas Sonar" quando zerada está na Task 2. A ordem de deploy está na
Task 11.

**Placeholders:** nenhum "TBD"/"implementar depois" — os únicos pontos que pedem "rode e ajuste"
(Tasks 8, 9 parcialmente) são fixtures de teste cujo valor exato depende de somas que só o test
runner confirma com segurança; cada um desses pontos já vem com o valor recalculado que eu derivei
manualmente (Task 8: `total_cents: 46_200` = 45.000 + 1.200), então "rode e ajuste" é uma rede de
segurança, não uma lacuna.

**Consistência de tipos:** `revenue_bps_t1..t4` e `applied_bps`/`applied_tier` são os mesmos nomes
do primeiro uso (Task 1, SQL) até o último (Task 10, TypeScript) — conferido campo a campo.
