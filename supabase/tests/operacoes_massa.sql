-- ADR-0174 — RLS e anti-duplicidade das tabelas do motor de operações em massa.
-- Run locally after applying the migrations:
-- docker exec -i supabase_db_<project-ref> psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/operacoes_massa.sql
-- Everything is rolled back.
\set ON_ERROR_STOP on

begin;

insert into public.organizations (id, nome, slug) values
  ('91000000-0000-0000-0000-000000000001', 'Operacoes org A', 'operacoes-test-a'),
  ('91000000-0000-0000-0000-000000000002', 'Operacoes org B', 'operacoes-test-b');

-- O trigger de auth.users cria o profile com o org_id do metadata (current_org_id() lê profiles).
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('91000000-0000-0000-0000-000000000101', 'membro-a@test.local',
   '{}'::jsonb, '{"org_id":"91000000-0000-0000-0000-000000000001"}'::jsonb);

insert into public.operacoes_massa (id, org_id, acao, promocao_id, promocao_tipo) values
  ('91000000-0000-0000-0000-000000000201', '91000000-0000-0000-0000-000000000001', 'aderir', 'P-A', 'DEAL'),
  ('91000000-0000-0000-0000-000000000202', '91000000-0000-0000-0000-000000000002', 'aderir', 'P-B', 'DEAL');
insert into public.operacoes_massa_itens (operacao_id, org_id, promocao_id, ml_item_id) values
  ('91000000-0000-0000-0000-000000000201', '91000000-0000-0000-0000-000000000001', 'P-A', 'MLB1'),
  ('91000000-0000-0000-0000-000000000202', '91000000-0000-0000-0000-000000000002', 'P-B', 'MLB2');

-- 1. Membro da org A só enxerga a própria operação e o próprio item.
set local role authenticated;
set local request.jwt.claim.sub = '91000000-0000-0000-0000-000000000101';
do $$
begin
  if public.current_org_id() is distinct from '91000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'fixture: membro A não resolveu a org A';
  end if;
  if (select count(*) from public.operacoes_massa) <> 1 then
    raise exception 'RLS: membro A vê operações de outra org';
  end if;
  if (select count(*) from public.operacoes_massa_itens) <> 1 then
    raise exception 'RLS: membro A vê itens de outra org';
  end if;
end;
$$;

-- 2. Escrita pelo client é barrada (só a edge escreve, via service role).
do $$
begin
  begin
    insert into public.operacoes_massa (org_id, acao, promocao_id, promocao_tipo)
    values ('91000000-0000-0000-0000-000000000001', 'aderir', 'P-A', 'DEAL');
    raise exception 'authenticated conseguiu inserir em operacoes_massa';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.operacoes_massa_itens set status = 'aplicado';
    raise exception 'authenticated conseguiu atualizar operacoes_massa_itens';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- 3. Anti-duplicidade: mesmo anúncio em andamento em duas operações da mesma promoção.
insert into public.operacoes_massa (id, org_id, acao, promocao_id, promocao_tipo) values
  ('91000000-0000-0000-0000-000000000203', '91000000-0000-0000-0000-000000000001', 'aderir', 'P-A', 'DEAL');
do $$
declare
  st text;
begin
  foreach st in array array['pendente','enviando','saida_solicitada'] loop
    update public.operacoes_massa_itens set status = st
    where operacao_id = '91000000-0000-0000-0000-000000000201' and ml_item_id = 'MLB1';
    begin
      insert into public.operacoes_massa_itens (operacao_id, org_id, promocao_id, ml_item_id)
      values ('91000000-0000-0000-0000-000000000203', '91000000-0000-0000-0000-000000000001', 'P-A', 'MLB1');
      raise exception 'índice anti-duplicidade não barrou item com o 1º em %', st;
    exception when unique_violation then null;
    end;
  end loop;
end;
$$;

-- Com o primeiro já concluído (aplicado), o anúncio pode entrar em nova operação.
update public.operacoes_massa_itens set status = 'aplicado'
where operacao_id = '91000000-0000-0000-0000-000000000201' and ml_item_id = 'MLB1';
insert into public.operacoes_massa_itens (operacao_id, org_id, promocao_id, ml_item_id)
values ('91000000-0000-0000-0000-000000000203', '91000000-0000-0000-0000-000000000001', 'P-A', 'MLB1');

-- 4. Claim (operacoes_massa_reivindicar): pendente → enviando uma vez só; enviando recente não; parado > 2 min sim;
-- outra org nunca; authenticated não executa.
do $$
declare
  org_a constant uuid := '91000000-0000-0000-0000-000000000001';
  op constant uuid := '91000000-0000-0000-0000-000000000203';
begin
  if not public.operacoes_massa_reivindicar(org_a, op, 'MLB1') then raise exception 'claim: pendente não virou enviando'; end if;
  if (select status from public.operacoes_massa_itens where operacao_id = op and ml_item_id = 'MLB1') <> 'enviando' then
    raise exception 'claim: status não é enviando';
  end if;
  if public.operacoes_massa_reivindicar(org_a, op, 'MLB1') then raise exception 'claim: enviando recente reivindicado de novo'; end if;
  if public.operacoes_massa_reivindicar('91000000-0000-0000-0000-000000000002', op, 'MLB1') then raise exception 'claim: outra org'; end if;
  update public.operacoes_massa_itens set atualizado_em = now() - interval '3 minutes' where operacao_id = op and ml_item_id = 'MLB1';
  if not public.operacoes_massa_reivindicar(org_a, op, 'MLB1') then raise exception 'claim: enviando parado não voltou'; end if;
  update public.operacoes_massa_itens set status = 'aplicado', atualizado_em = now() - interval '1 hour' where operacao_id = op and ml_item_id = 'MLB1';
  if public.operacoes_massa_reivindicar(org_a, op, 'MLB1') then raise exception 'claim: item concluído reivindicado'; end if;
  if public.operacoes_massa_reivindicar(org_a, op, 'MLB404') then raise exception 'claim: item inexistente'; end if;
end;
$$;
-- Checagem pelo catálogo: chamar a função sem privilégio derruba (segfault) o Postgres local deste ambiente.
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if has_function_privilege(r, 'public.operacoes_massa_reivindicar(uuid, uuid, text)', 'execute') then
      raise exception '% pode executar operacoes_massa_reivindicar', r;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.operacoes_massa_reivindicar(uuid, uuid, text)', 'execute') then
    raise exception 'service_role não executa operacoes_massa_reivindicar';
  end if;
end;
$$;

-- Emenda 2026-10-04 (pausar/reativar): coerência ação × promoção e anti-duplicidade sem promoção.
reset role;
do $$
declare v_op1 uuid := '91000000-0000-0000-0000-000000000301';
        v_op2 uuid := '91000000-0000-0000-0000-000000000302';
        v_org uuid := '91000000-0000-0000-0000-000000000001';
begin
  insert into public.operacoes_massa (id, org_id, acao) values (v_op1, v_org, 'pausar'), (v_op2, v_org, 'reativar');

  begin
    insert into public.operacoes_massa (org_id, acao) values (v_org, 'aderir');
    raise exception 'CHECK: aderir sem promoção foi aceito';
  exception when check_violation then null; end;

  begin
    insert into public.operacoes_massa (org_id, acao, promocao_id, promocao_tipo) values (v_org, 'pausar', 'P-X', 'DEAL');
    raise exception 'CHECK: pausar com promoção foi aceito';
  exception when check_violation then null; end;

  insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id) values (v_op1, v_org, 'MLB9');
  begin
    insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id) values (v_op2, v_org, 'MLB9');
    raise exception 'ÍNDICE: mesmo anúncio em duas operações de status pendentes';
  exception when unique_violation then null; end;

  -- Terminado libera o anúncio.
  update public.operacoes_massa_itens set status = 'aplicado' where operacao_id = v_op1 and ml_item_id = 'MLB9';
  insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id) values (v_op2, v_org, 'MLB9');

  -- Operação de promoção do mesmo anúncio não é barrada pelo índice de status.
  insert into public.operacoes_massa_itens (operacao_id, org_id, promocao_id, ml_item_id)
    values ('91000000-0000-0000-0000-000000000201', v_org, 'P-A', 'MLB9');
end;
$$;

select 'operacoes_massa: ok' as resultado;

rollback;
