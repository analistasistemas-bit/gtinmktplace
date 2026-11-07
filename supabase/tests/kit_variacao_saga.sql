\set ON_ERROR_STOP on
-- ADR-0197 (migration kit_variacao_saga): criação da transferência, claim da execução e `itens` imutável.
-- Fixtures só dentro da transação desfeita (scripts/teste-sql-desfeito.py), em org própria.
begin;

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97100000-0000-0000-0000-000000000001', 'Kit saga', 'kit-saga-teste', array['kit_variacao'], true),
  ('97100000-0000-0000-0000-000000000002', 'Kit saga sem módulo', 'kit-saga-sem', array[]::text[], true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('97100000-0000-0000-0000-000000000101', 'kit-saga@teste.local',
   '{"org_id":"97100000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('97100000-0000-0000-0000-000000000101', '97100000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('97100000-0000-0000-0000-000000000201', '97100000-0000-0000-0000-000000000101',
   '97100000-0000-0000-0000-000000000001', 'processando', 'manual');
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro) values
  ('97100000-0000-0000-0000-000000000301', '97100000-0000-0000-0000-000000000201',
   '97100000-0000-0000-0000-000000000101', '97100000-0000-0000-0000-000000000001',
   '09800000', 'Blusa saga', 'CREATE', 'nacional', gen_random_uuid()),
  ('97100000-0000-0000-0000-000000000302', '97100000-0000-0000-0000-000000000201',
   '97100000-0000-0000-0000-000000000101', '97100000-0000-0000-0000-000000000001',
   '09810000', 'Kit blusa saga', 'CREATE', 'nacional', gen_random_uuid());
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
select f, '97100000-0000-0000-0000-000000000101', '97100000-0000-0000-0000-000000000001', c, c, c, t, 50, 0
from (values
  ('97100000-0000-0000-0000-000000000301'::uuid, '09800001', 'M'),   -- preto
  ('97100000-0000-0000-0000-000000000301'::uuid, '09800002', 'M'),   -- branco
  ('97100000-0000-0000-0000-000000000301'::uuid, '09800003', 'M'),   -- azul
  ('97100000-0000-0000-0000-000000000302'::uuid, '09810001', 'M'),   -- kit preto + branco
  ('97100000-0000-0000-0000-000000000302'::uuid, '09810002', 'M'),   -- kit preto + azul
  ('97100000-0000-0000-0000-000000000302'::uuid, '09810003', 'G')    -- mesma composição do 09810001
) x(f, c, t);

create temp table ctx on commit drop as
select '97100000-0000-0000-0000-000000000001'::uuid as org,
       '97100000-0000-0000-0000-000000000002'::uuid as sem_modulo,
       '97100000-0000-0000-0000-000000000101'::uuid as usuario,
       gen_random_uuid() as kit, gen_random_uuid() as k1, gen_random_uuid() as k2, gen_random_uuid() as k3;
grant select on ctx to service_role;

create function pg_temp.afirmar(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALHA: %', p_msg; end if;
end $$;

-- Linhas da saga na org: prova que uma recusa não deixou nada gravado.
create function pg_temp.linhas(p_org uuid) returns text language sql as $$
  select (select count(*) from public.kit_transferencias where org_id = p_org) || '/'
      || (select count(*) from public.kit_transferencia_alvos where org_id = p_org) || '/'
      || (select count(*) from public.kit_exclusoes where org_id = p_org)
$$;

do $$
declare f text; v_dono text; v_definer boolean; v_cfg text[];
begin
  f := 'public.kit_criar_transferencia(uuid, uuid, text, jsonb, jsonb)';
  select pg_get_userbyid(proowner), prosecdef, proconfig into v_dono, v_definer, v_cfg
  from pg_proc where oid = f::regprocedure;
  perform pg_temp.afirmar(v_dono = 'estoque_rpc_executor', f || ' sem dono estoque_rpc_executor: ' || v_dono);
  perform pg_temp.afirmar(v_definer, f || ' não é security definer');
  perform pg_temp.afirmar(v_cfg = array['search_path=""'], f || ' sem search_path vazio');
  -- Contrato de set_modulos_org_seguro, provado pela leitura do corpo (concorrência real exige duas
  -- sessões): a org trava com `for share` antes de qualquer gravação.
  perform pg_temp.afirmar((select position('where id = p_org for share' in prosrc) between 1
                                  and position('insert into public.kit_transferencias' in prosrc)
                           from pg_proc where oid = f::regprocedure), f || ' grava antes de travar a org');

  foreach f in array array[
    'public.kit_criar_transferencia(uuid, uuid, text, jsonb, jsonb)',
    'public.kit_reivindicar_execucao(uuid, uuid, uuid, integer)'
  ] loop
    perform pg_temp.afirmar(not has_function_privilege('anon', f, 'execute'), f || ' exposta a anon');
    perform pg_temp.afirmar(not has_function_privilege('authenticated', f, 'execute'), f || ' exposta a authenticated');
    perform pg_temp.afirmar(not has_function_privilege('public', f, 'execute'), f || ' exposta a public');
    perform pg_temp.afirmar(has_function_privilege('service_role', f, 'execute'), f || ' sem service_role');
  end loop;
end $$;

set local role service_role;
do $$
declare
  c record; r jsonb; t1 uuid; t2 uuid; t3 uuid; antes text; ok boolean; tok uuid := gen_random_uuid();
  P constant text := '09800001'; B constant text := '09800002'; A constant text := '09800003';
  K1 constant text := '09810001'; K2 constant text := '09810002'; K3 constant text := '09810003';
  alvos_k1 jsonb := '[{"codigo":"09800001","up_id":"UP-P","item_ids":["MLB-P"]},
                      {"codigo":"09800002","up_id":"UP-B","item_ids":["MLB-B","MLB-BC"]},
                      {"codigo":"09810001","up_id":"UP-K1","item_ids":["MLB-K1"]}]';
begin
  select * into c from ctx;

  insert into public.kits_variacao (id, org_id, codigo_pai_base, codigo_pai_kit, pecas_por_kit, preco)
  values (c.kit, c.org, '09800000', '09810000', 2, 99.90);
  insert into public.kit_variacao_skus (id, org_id, kit_id, codigo, tamanho, cores, rotulo_cor)
  values (c.k1, c.org, c.kit, K1, 'M', array['Preto','Branco'], 'Preto + Branco'),
         (c.k2, c.org, c.kit, K2, 'M', array['Preto','Azul'], 'Preto + Azul'),
         (c.k3, c.org, c.kit, K3, 'G', array['Preto','Branco'], 'Preto + Branco');
  insert into public.kit_variacao_componentes (kit_sku_id, org_id, codigo, quantidade)
  values (c.k1, c.org, P, 1), (c.k1, c.org, B, 1), (c.k2, c.org, P, 1), (c.k2, c.org, A, 1),
         (c.k3, c.org, P, 1), (c.k3, c.org, B, 1);
  insert into public.sku_politica_kit (org_id, codigo, versao) values (c.org, P, 3), (c.org, B, 2);

  perform public.registrar_entrada(c.org, P, 5, null, null, null, c.usuario, 'kit-saga:p');
  perform public.registrar_entrada(c.org, B, 5, null, null, null, c.usuario, 'kit-saga:b');

  -- Sem módulo: nada gravado.
  r := public.kit_criar_transferencia(c.sem_modulo, null, 'entrada', '[{"codigo":"X","quantidade":1}]',
    '[{"codigo":"X","up_id":"UP-X","item_ids":["MLB-X"]}]');
  perform pg_temp.afirmar(r = '{"ok": false, "motivo": "modulo_desligado"}', 'sem módulo: ' || r::text);
  perform pg_temp.afirmar(pg_temp.linhas(c.sem_modulo) = '0/0/0', 'sem módulo gravou');

  -- Alvos que não cobrem os movimentos: recusa sem gravar.
  r := public.kit_criar_transferencia(c.org, c.kit, 'montar', jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 1)),
    alvos_k1 - 2);
  perform pg_temp.afirmar(r->>'motivo' = 'alvos_invalidos', 'alvo faltando: ' || r::text);
  r := public.kit_criar_transferencia(c.org, c.kit, 'montar', jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 1)),
    alvos_k1 || '[{"codigo":"09800003","up_id":"UP-A","item_ids":["MLB-A"]}]');
  perform pg_temp.afirmar(r->>'motivo' = 'alvos_invalidos', 'alvo a mais: ' || r::text);
  r := public.kit_criar_transferencia(c.org, c.kit, 'montar', jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 1)),
    jsonb_set(alvos_k1, '{0,item_ids}', '[]'));
  perform pg_temp.afirmar(r->>'motivo' = 'alvos_invalidos', 'alvo sem item: ' || r::text);
  perform pg_temp.afirmar(pg_temp.linhas(c.org) = '0/0/0', 'recusa gravou: ' || pg_temp.linhas(c.org));

  -- Criação: transferência, alvos com papel e delta, exclusão com UP, versão somada da política.
  r := public.kit_criar_transferencia(c.org, c.kit, 'montar', jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 2)),
    alvos_k1);
  perform pg_temp.afirmar((r->>'ok')::boolean, 'criar: ' || r::text);
  t1 := (r->>'id')::uuid;
  perform pg_temp.afirmar((select estado = 'ativa' and passo = 'pausar' and versao_politica = 5 and kit_id = c.kit
                           from public.kit_transferencias where id = t1), 'transferência criada errada');
  perform pg_temp.afirmar((select string_agg(codigo || ':' || papel || ':' || delta || ':' || up_id || ':' || array_to_string(item_ids, '+'), ','
                                             order by codigo)
                           from public.kit_transferencia_alvos where transferencia_id = t1 and org_id = c.org)
    = '09800001:origem:-2:UP-P:MLB-P,09800002:origem:-2:UP-B:MLB-B+MLB-BC,09810001:destino:2:UP-K1:MLB-K1',
    'alvos errados');
  perform pg_temp.afirmar((select string_agg(codigo || ':' || up_id, ',' order by codigo) from public.kit_exclusoes
                           where org_id = c.org and dono_id = t1 and dono_tipo = 'transferencia')
    = '09800001:UP-P,09800002:UP-B,09810001:UP-K1', 'exclusões erradas');

  -- Review Focus 4: segunda transferência no mesmo UP recebe up_ocupado e não grava nada.
  antes := pg_temp.linhas(c.org);
  r := public.kit_criar_transferencia(c.org, c.kit, 'montar', jsonb_build_array(jsonb_build_object('codigo', K2, 'quantidade', 1)),
    '[{"codigo":"09800001","up_id":"UP-P","item_ids":["MLB-P"]},
      {"codigo":"09800003","up_id":"UP-A","item_ids":["MLB-A"]},
      {"codigo":"09810002","up_id":"UP-K2","item_ids":["MLB-K2"]}]');
  perform pg_temp.afirmar(r->>'motivo' = 'up_ocupado' and r->>'codigo' = P, 'segunda transferência: ' || r::text);
  perform pg_temp.afirmar(pg_temp.linhas(c.org) = antes, 'conflito gravou: ' || pg_temp.linhas(c.org));

  -- Travada segue ocupada: a exclusão não sai.
  update public.kit_transferencias set estado = 'travada' where id = t1;
  r := public.kit_criar_transferencia(c.org, null, 'entrada', jsonb_build_array(jsonb_build_object('codigo', B, 'quantidade', 1)),
    '[{"codigo":"09800002","up_id":"UP-B","item_ids":["MLB-B"]}]');
  perform pg_temp.afirmar(r->>'motivo' = 'up_ocupado', 'travada liberou o UP: ' || r::text);
  perform pg_temp.afirmar(pg_temp.linhas(c.org) = antes, 'conflito com travada gravou');

  -- Entrada: sem kit, um alvo destino com delta 0.
  r := public.kit_criar_transferencia(c.org, null, 'entrada', jsonb_build_array(jsonb_build_object('codigo', A, 'quantidade', 1)),
    '[{"codigo":"09800003","up_id":"UP-A","item_ids":["MLB-A"]}]');
  perform pg_temp.afirmar((r->>'ok')::boolean, 'entrada: ' || r::text);
  t2 := (r->>'id')::uuid;
  perform pg_temp.afirmar((select papel = 'destino' and delta = 0 from public.kit_transferencia_alvos where transferencia_id = t2),
    'alvo de entrada errado');
  perform pg_temp.afirmar((select versao_politica = 0 from public.kit_transferencias where id = t2), 'versão sem política');

  -- Claim: um token por vez, prazo vencido libera, outra org e transferência fechada não pegam.
  update public.kit_transferencias set estado = 'ativa' where id = t1;
  perform pg_temp.afirmar(public.kit_reivindicar_execucao(c.org, t1, tok, 60), 'primeiro claim recusado');
  perform pg_temp.afirmar((select execucao_token = tok and execucao_ate > now() from public.kit_transferencias where id = t1),
    'claim não gravou o token');
  perform pg_temp.afirmar(not public.kit_reivindicar_execucao(c.org, t1, gen_random_uuid(), 60), 'claim duplo');
  perform pg_temp.afirmar(not public.kit_reivindicar_execucao(c.sem_modulo, t1, gen_random_uuid(), 60), 'claim de outra org');
  update public.kit_transferencias set execucao_ate = now() - interval '1 second' where id = t1;
  perform pg_temp.afirmar(public.kit_reivindicar_execucao(c.org, t1, gen_random_uuid(), 60), 'prazo vencido não liberou');
  update public.kit_transferencias set execucao_ate = null, estado = 'travada' where id = t2;
  perform pg_temp.afirmar(not public.kit_reivindicar_execucao(c.org, t2, gen_random_uuid(), 60), 'claim em travada');

  -- `itens` muda antes da reserva; depois, nem trocando destinos com as mesmas origens.
  update public.kit_transferencias set itens = jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 1)) where id = t1;
  r := public.kit_reservar_transferencia(c.org, t1);
  perform pg_temp.afirmar((r->>'aplicado')::boolean, 'reserva: ' || r::text);
  ok := false;
  begin
    update public.kit_transferencias set itens = jsonb_build_array(jsonb_build_object('codigo', K3, 'quantidade', 1)) where id = t1;
  exception when others then
    ok := sqlerrm like '%imutável%';
  end;
  perform pg_temp.afirmar(ok, 'troca de destino com as mesmas origens passou depois da reserva');
  perform pg_temp.afirmar((select itens->0->>'codigo' = K1 from public.kit_transferencias where id = t1), 'itens mudou');
  -- Passo e estado seguem graváveis.
  update public.kit_transferencias set passo = 'reduzir', estado = 'travada', alerta = 'x' where id = t1;
  perform pg_temp.afirmar((select passo = 'reduzir' from public.kit_transferencias where id = t1), 'passo não gravou');
end $$;
reset role;

rollback;
