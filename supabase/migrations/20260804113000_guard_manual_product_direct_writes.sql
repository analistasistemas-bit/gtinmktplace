-- Incidente 2026-08-03: um produto de lote manual foi inserido diretamente com
-- service_role, contornando RLS, cadastrar-produto, a chave idempotente e o ledger.
-- Estes guards são invariantes de banco e também valem para roles que ignoram RLS.

-- Capacidade sem login: somente as RPCs SECURITY DEFINER de estoque assumem este
-- papel. `service_role`, SQL do dashboard e Management API não conseguem gravar
-- estoque diretamente sem antes alterar deliberadamente o schema de segurança.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'estoque_rpc_executor') then
    create role estoque_rpc_executor nologin;
  end if;
end;
$$;

grant estoque_rpc_executor to postgres;
-- PostgreSQL exige CREATE no schema apenas durante ALTER OWNER. A migration é
-- transacional e revoga o privilégio logo após as três transferências.
grant usage, create on schema public to estoque_rpc_executor;
grant select, update on table public.variacoes to estoque_rpc_executor;
grant select on table public.familias to estoque_rpc_executor;
grant select, insert, update on table public.estoque_movimentos to estoque_rpc_executor;

-- O Supabase gerenciado não permite criar BYPASSRLS em migrations. As policies
-- abaixo concedem somente as operações usadas pelas três RPCs; como o papel é
-- NOLOGIN e não é concedido a service_role, não existe acesso direto por JWT.
create policy "estoque_rpc_executor: select familias" on public.familias
  for select to estoque_rpc_executor using (true);
create policy "estoque_rpc_executor: select variacoes" on public.variacoes
  for select to estoque_rpc_executor using (true);
create policy "estoque_rpc_executor: update variacoes" on public.variacoes
  for update to estoque_rpc_executor using (true) with check (true);
create policy "estoque_rpc_executor: select movimentos" on public.estoque_movimentos
  for select to estoque_rpc_executor using (true);
create policy "estoque_rpc_executor: insert movimentos" on public.estoque_movimentos
  for insert to estoque_rpc_executor with check (true);
create policy "estoque_rpc_executor: update movimentos" on public.estoque_movimentos
  for update to estoque_rpc_executor using (true) with check (true);

alter function public.baixar_estoque(uuid, text, integer, text, text)
  owner to estoque_rpc_executor;
alter function public.estornar_estoque(uuid, text, text, text)
  owner to estoque_rpc_executor;
alter function public.registrar_entrada(uuid, text, integer, numeric, text, text, uuid, text)
  owner to estoque_rpc_executor;
revoke create on schema public from estoque_rpc_executor;
revoke estoque_rpc_executor from postgres cascade;

create or replace function public.bloquear_escrita_direta_estoque()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.estoque is distinct from old.estoque
     and current_user <> 'estoque_rpc_executor' then
    raise exception
      'Estoque não pode ser alterado diretamente. Use a RPC de estoque (ADR-0094, D-15).'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.bloquear_troca_identidade_lote()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.origem is distinct from old.origem
     or new.org_id is distinct from old.org_id then
    raise exception 'A organização e a origem do lote são imutáveis depois do cadastro.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger lotes_bloquear_troca_identidade
  before update of origem, org_id on public.lotes
  for each row execute procedure public.bloquear_troca_identidade_lote();

create or replace function public.validar_familia_no_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lote_org uuid;
  v_lote_origem text;
begin
  select l.org_id, l.origem
    into v_lote_org, v_lote_origem
  from public.lotes l
  where l.id = new.lote_id;

  if v_lote_org is distinct from new.org_id then
    raise exception 'Família e lote precisam pertencer à mesma organização.'
      using errcode = '23514';
  end if;

  if v_lote_origem = 'manual' then
    if new.chave_cadastro is null then
      raise exception 'Família de lote manual exige chave de cadastro.'
        using errcode = '23514';
    end if;
    if new.codigo_pai !~ '^[0-9]{8}$' then
      raise exception 'Código de família manual precisa ter 8 dígitos.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger familias_validar_tenant_insert
  before insert on public.familias
  for each row execute procedure public.validar_familia_no_tenant();

create trigger familias_validar_tenant_update
  before update of lote_id, org_id, codigo_pai, chave_cadastro on public.familias
  for each row execute procedure public.validar_familia_no_tenant();

create or replace function public.validar_variacao_no_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_familia_org uuid;
  v_lote_org uuid;
  v_lote_origem text;
begin
  select f.org_id, l.org_id, l.origem
    into v_familia_org, v_lote_org, v_lote_origem
  from public.familias f
  join public.lotes l on l.id = f.lote_id
  where f.id = new.familia_id;

  if v_familia_org is distinct from new.org_id
     or v_lote_org is distinct from new.org_id then
    raise exception 'Variação, família e lote precisam pertencer à mesma organização.'
      using errcode = '23514';
  end if;

  if v_lote_origem = 'manual' then
    if new.codigo !~ '^[0-9]{8}$' then
      raise exception 'Código de variação manual precisa ter 8 dígitos.'
        using errcode = '23514';
    end if;
    if tg_op = 'INSERT' and new.estoque <> 0 then
      raise exception 'Estoque inicial de produto manual deve ser registrado pelo ledger.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger variacoes_validar_tenant_insert
  before insert on public.variacoes
  for each row execute procedure public.validar_variacao_no_tenant();

create trigger variacoes_validar_tenant_update
  before update of familia_id, org_id, codigo on public.variacoes
  for each row execute procedure public.validar_variacao_no_tenant();

-- Falhar a implantação se já houver vínculo cruzado. Registros manuais legados
-- fora do contrato são reportados, mas não impedem instalar os guards que evitam
-- novos casos; a limpeza exige autorização separada por ser destrutiva.
do $$
declare
  v_manuais_invalidas bigint;
begin
  if exists (
    select 1 from public.familias f
    join public.lotes l on l.id = f.lote_id
    where f.org_id is distinct from l.org_id
  ) or exists (
    select 1 from public.variacoes v
    join public.familias f on f.id = v.familia_id
    join public.lotes l on l.id = f.lote_id
    where v.org_id is distinct from f.org_id
       or v.org_id is distinct from l.org_id
  ) then
    raise exception 'Existem vínculos de produto cruzados entre organizações.';
  end if;

  select count(*) into v_manuais_invalidas
  from public.familias f
  join public.lotes l on l.id = f.lote_id
  where l.origem = 'manual'
    and (f.chave_cadastro is null or f.codigo_pai !~ '^[0-9]{8}$');

  if v_manuais_invalidas > 0 then
    raise warning '% família(s) manual(is) legada(s) exigem remediação.', v_manuais_invalidas;
  end if;
end;
$$;
