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

create function pg_temp.erro(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

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
    'public.kit_reivindicar_execucao(uuid, uuid, uuid, integer)',
    'public.kit_saga_salvar_alvo(uuid, uuid, uuid, text, jsonb)',
    'public.kit_saga_salvar_transferencia(uuid, uuid, uuid, text, text, boolean)',
    'public.kit_saga_finalizar(uuid, uuid, uuid, text, text, jsonb)',
    'public.kit_saga_ledger(uuid, uuid, uuid, text)',
    'public.kit_saga_pode_reativar(uuid, uuid, uuid, text)'
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
  c record; r jsonb; t1 uuid; t2 uuid; t3 uuid; antes text; ok boolean; tok uuid := gen_random_uuid(); tok3 uuid := gen_random_uuid(); o bigint;
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

  -- Composição imutável desde a criação: os alvos e seus deltas saíram dela (achado 3 do Codex).
  perform pg_temp.afirmar(pg_temp.erro(format('update public.kit_transferencias set itens = %L where id = %L',
    jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 1)), t1)) like '%imutáveis%', 'itens mudou antes da reserva');
  perform pg_temp.afirmar(pg_temp.erro(format('update public.kit_transferencias set tipo = %L where id = %L', 'repor', t1))
    like '%imutáveis%', 'tipo mudou');
  perform pg_temp.afirmar(pg_temp.erro(format('update public.kit_transferencias set kit_id = null where id = %L', t1))
    is not null, 'kit_id mudou');
  -- Passo e estado seguem graváveis.
  update public.kit_transferencias set passo = 'pausar', alerta = 'x', execucao_token = null, execucao_ate = null where id = t1;
  perform pg_temp.afirmar(public.kit_reivindicar_execucao(c.org, t1, tok, 60), 'claim de t1');

  -- Toda escrita da saga exige o token vigente (achado 2).
  perform pg_temp.afirmar(pg_temp.erro(format('select public.kit_saga_salvar_alvo(%L, %L, %L, %L, %L)',
    c.org, t1, gen_random_uuid(), 'UP-P', '{"qtd_passo1": 5}')) like '%kit_execucao_vencida%', 'alvo gravado com outro token');
  perform pg_temp.afirmar(pg_temp.erro(format('select public.kit_saga_ledger(%L, %L, %L, %L)',
    c.org, t1, gen_random_uuid(), 'reservar')) like '%kit_execucao_vencida%', 'reserva com outro token');
  perform pg_temp.afirmar(pg_temp.erro(format('select public.kit_saga_salvar_transferencia(%L, %L, %L, %L, null, false)',
    c.org, t1, gen_random_uuid(), 'reduzir')) like '%kit_execucao_vencida%', 'passo gravado com outro token');
  -- Com o token: grava, ignora colunas fora da saga e não regrava o valor final.
  perform public.kit_saga_salvar_alvo(c.org, t1, tok, 'UP-P', '{"qtd_passo1": 5, "valor_anterior": 5, "valor_alvo": 3, "fase": "reducao", "papel": "destino", "delta": 9, "up_id": "X"}');
  perform public.kit_saga_salvar_alvo(c.org, t1, tok, 'UP-P', '{"valor_anterior": 7, "valor_alvo": 1, "fase": "aumento", "recusas": 2, "item_escrita": "MLB-P"}');
  perform pg_temp.afirmar((select qtd_passo1 = 5 and valor_anterior = 5 and valor_alvo = 3 and fase = 'reducao' and papel = 'origem' and delta = -2
                                  and recusas = 2 and item_escrita = 'MLB-P'
                           from public.kit_transferencia_alvos where transferencia_id = t1 and up_id = 'UP-P'), 'alvo gravado errado');
  perform public.kit_saga_salvar_transferencia(c.org, t1, tok, 'reduzir', 'alerta y', false);
  perform pg_temp.afirmar((select passo = 'reduzir' and alerta = 'alerta y' and estado = 'ativa'
                           from public.kit_transferencias where id = t1), 'passo não gravou');

  -- Ledger pela saga: só com o token.
  r := public.kit_saga_ledger(c.org, t1, tok, 'reservar');
  perform pg_temp.afirmar((r->>'aplicado')::boolean, 'reserva: ' || r::text);
  perform pg_temp.afirmar(pg_temp.erro(format('update public.kit_transferencias set itens = %L where id = %L',
    jsonb_build_array(jsonb_build_object('codigo', K3, 'quantidade', 2)), t1)) like '%imutáveis%',
    'troca de destino com as mesmas origens passou depois da reserva');

  -- Exclusão perdida bloqueia qualquer escrita.
  delete from public.kit_exclusoes where org_id = c.org and codigo = B and dono_id = t1;
  perform pg_temp.afirmar(pg_temp.erro(format('select public.kit_saga_salvar_alvo(%L, %L, %L, %L, %L)',
    c.org, t1, tok, 'UP-P', '{"qtd_passo1": 6}')) like '%kit_exclusao_perdida%', 'escreveu sem a exclusão');
  insert into public.kit_exclusoes (org_id, codigo, up_id, dono_tipo, dono_id) values (c.org, B, 'UP-B', 'transferencia', t1);

  -- Reativação: versão e bloqueios vigentes, com a linha travada (achado 6).
  perform pg_temp.afirmar(public.kit_saga_pode_reativar(c.org, t1, tok, P), 'reativar recusado com versão igual');
  update public.sku_politica_kit set bloqueio_operador = true where org_id = c.org and codigo = B;
  perform pg_temp.afirmar(not public.kit_saga_pode_reativar(c.org, t1, tok, B), 'reativou SKU bloqueado');
  perform pg_temp.afirmar(public.kit_saga_pode_reativar(c.org, t1, tok, P), 'bloqueio de outro SKU recusou');
  update public.sku_politica_kit set versao = 4 where org_id = c.org and codigo = P;
  perform pg_temp.afirmar(not public.kit_saga_pode_reativar(c.org, t1, tok, P), 'reativou com versão nova');
  -- Versão só cresce, e a linha de SKU em transferência aberta não some: a soma é monotônica.
  perform pg_temp.afirmar(pg_temp.erro(format('update public.sku_politica_kit set versao = 1 where org_id = %L and codigo = %L', c.org, P))
    like '%versão%', 'versão decresceu');
  perform pg_temp.afirmar(pg_temp.erro(format('delete from public.sku_politica_kit where org_id = %L and codigo = %L', c.org, P))
    like '%transferência%', 'política apagada com transferência aberta');

  -- Prazo vencido: nada grava.
  update public.kit_transferencias set execucao_ate = now() - interval '1 second' where id = t1;
  perform pg_temp.afirmar(pg_temp.erro(format('select public.kit_saga_salvar_alvo(%L, %L, %L, %L, %L)',
    c.org, t1, tok, 'UP-P', '{"qtd_passo1": 6}')) like '%kit_execucao_vencida%', 'gravou com prazo vencido');
  update public.kit_transferencias set execucao_ate = now() + interval '1 minute' where id = t1;

  -- Finalizar: estado e exclusões juntos, só com o token (achado 5).
  perform pg_temp.afirmar(pg_temp.erro(format('select public.kit_saga_finalizar(%L, %L, %L, %L, null)',
    c.org, t1, gen_random_uuid(), 'concluida')) like '%kit_execucao_vencida%', 'finalizou com outro token');
  perform pg_temp.afirmar((select count(*) = 3 from public.kit_exclusoes where dono_id = t1), 'exclusão saiu sem finalizar');
  -- Repausa pendente: finalizar recusa e a exclusão fica (achado 6 da rodada 2).
  perform public.kit_saga_salvar_alvo(c.org, t1, tok, 'UP-K1', '{"repausar": ["MLB-K1"]}');
  perform pg_temp.afirmar(pg_temp.erro(format('select public.kit_saga_finalizar(%L, %L, %L, %L, null)',
    c.org, t1, tok, 'concluida')) like '%kit_repausa_pendente%', 'finalizou com repausa pendente');
  perform pg_temp.afirmar((select count(*) = 3 from public.kit_exclusoes where dono_id = t1), 'repausa pendente soltou a exclusão');
  perform public.kit_saga_salvar_alvo(c.org, t1, tok, 'UP-K1', '{"repausar": []}');
  perform public.kit_saga_finalizar(c.org, t1, tok, 'concluida', 'fim');
  perform pg_temp.afirmar((select estado = 'concluida' and passo = 'fim' and execucao_token is null
                           from public.kit_transferencias where id = t1), 'finalizar não gravou o estado');
  perform pg_temp.afirmar(not exists (select 1 from public.kit_exclusoes where dono_id = t1), 'finalizar não soltou a exclusão');
  -- Fechada, a política volta a poder ser apagada.
  delete from public.sku_politica_kit where org_id = c.org and codigo = P;

  -- Marca d'água e efeito local pendente (Emenda 2).
  perform pg_temp.afirmar((select count(*) > 0 and bool_and(ordem is not null) from public.estoque_movimentos where transferencia_id = t1),
    'movimento de transferência sem ordem');
  perform public.registrar_entrada(c.org, K2, 3, null, null, null, c.usuario, 'kit-saga:k2');
  r := public.kit_criar_transferencia(c.org, null, 'entrada', jsonb_build_array(jsonb_build_object('codigo', K2, 'quantidade', 1)),
    '[{"codigo":"09810002","up_id":"UP-K2","item_ids":["MLB-K2"]}]');
  t3 := (r->>'id')::uuid;
  perform pg_temp.afirmar(public.kit_reivindicar_execucao(c.org, t3, tok3, 60), 'claim t3');
  perform pg_temp.afirmar(pg_temp.erro(format('select public.kit_saga_conferir_saldo(%L, %L, %L, %L)', c.org, t3, gen_random_uuid(), K2))
    like '%kit_execucao_vencida%', 'conferiu com outro token');
  -- Sem marca: só os movimentos desta transferência contam (nenhum); a saga exige local = ML.
  r := public.kit_saga_conferir_saldo(c.org, t3, tok3, K2);
  o := (r->>'ordem')::bigint;
  perform pg_temp.afirmar(r->'marca' = 'null'::jsonb and (r->>'saldo')::int = 3 and (r->>'pendente')::int = 0, 'sem marca: ' || r::text);
  perform pg_temp.afirmar(o = (select max(ordem) from public.estoque_movimentos where org_id = c.org and codigo = K2) and o > 0,
    'ordem lida não é a última do SKU: ' || r::text);
  -- Com marca anterior à entrada: a entrada é o efeito pendente.
  insert into public.kit_marca_ml (org_id, codigo, ordem) values (c.org, K2, 0);
  r := public.kit_saga_conferir_saldo(c.org, t3, tok3, K2);
  perform pg_temp.afirmar((r->>'pendente')::int = 3, 'entrada pendente: ' || r::text);
  -- Confirmar o alvo avança a marca até a ordem lida no cálculo; o mesmo efeito não volta.
  perform public.kit_saga_salvar_alvo(c.org, t3, tok3, 'UP-K2',
    jsonb_build_object('valor_anterior', 0, 'valor_alvo', 3, 'fase', 'aumento', 'marca_ordem', o));
  perform public.kit_saga_salvar_alvo(c.org, t3, tok3, 'UP-K2', jsonb_build_object('confirmada_em', now()));
  perform pg_temp.afirmar((select ordem = o from public.kit_marca_ml where org_id = c.org and codigo = K2), 'marca não avançou');
  r := public.kit_saga_conferir_saldo(c.org, t3, tok3, K2);
  perform pg_temp.afirmar((r->>'pendente')::int = 0, 'efeito aplicado duas vezes: ' || r::text);
  -- Movimento de transferência com o alvo confirmado já está no ML; estorno posterior à marca fica pendente; venda nunca.
  insert into public.estoque_movimentos (org_id, codigo, codigo_pai, quantidade, motivo, transferencia_id, ordem)
  values (c.org, K2, '09810000', 1, 'kit_entrada', t3, o + 1000),
         (c.org, K2, '09810000', 2, 'estorno_venda', null, o + 1001),
         (c.org, K2, '09810000', -1, 'venda', null, o + 1002);
  r := public.kit_saga_conferir_saldo(c.org, t3, tok3, K2);
  perform pg_temp.afirmar((r->>'pendente')::int = 2 and (r->>'ordem')::bigint = o + 1002, 'estorno depois da marca: ' || r::text);
  -- Marca não recua.
  update public.kit_transferencia_alvos set confirmada_em = null where transferencia_id = t3;
  perform public.kit_saga_salvar_alvo(c.org, t3, tok3, 'UP-K2', jsonb_build_object('confirmada_em', now()));
  perform pg_temp.afirmar((select ordem = o from public.kit_marca_ml where org_id = c.org and codigo = K2), 'marca recuou');

  -- Task 5: publicação segura a exclusão durante a chamada remota. Transferência que começa nesse
  -- intervalo recebe up_ocupado; o retry da publicação (mesmo dono) readquire; solta, a transferência entra.
  r := public.kit_adquirir_exclusao(c.org, array[P], 'publicacao', tok);
  perform pg_temp.afirmar((r->>'ok')::boolean, 'publicação não adquiriu: ' || r::text);
  antes := pg_temp.linhas(c.org);
  r := public.kit_criar_transferencia(c.org, null, 'entrada', jsonb_build_array(jsonb_build_object('codigo', P, 'quantidade', 0)),
    '[{"codigo":"09800001","up_id":"UP-P","item_ids":["MLB-P"]}]');
  perform pg_temp.afirmar(r->>'motivo' = 'up_ocupado', 'transferência furou a publicação: ' || r::text);
  perform pg_temp.afirmar(pg_temp.linhas(c.org) = antes, 'conflito com publicação gravou');
  r := public.kit_adquirir_exclusao(c.org, array[P], 'publicacao', tok);
  perform pg_temp.afirmar((r->>'ok')::boolean, 'retry da publicação não readquiriu: ' || r::text);
  perform public.kit_soltar_exclusao(c.org, tok);
  r := public.kit_criar_transferencia(c.org, null, 'entrada', jsonb_build_array(jsonb_build_object('codigo', P, 'quantidade', 0)),
    '[{"codigo":"09800001","up_id":"UP-P","item_ids":["MLB-P"]}]');
  perform pg_temp.afirmar((r->>'ok')::boolean, 'transferência depois da publicação: ' || r::text);

  -- Task 8: cancelamento do kit, como `agendarCancelamentoKit` chama. kit_id obrigatório, alvo só o SKU do
  -- kit (UP + cópia de catálogo), delta 0 (o crédito já veio do estorno), exclusão com o UP.
  r := public.kit_criar_transferencia(c.org, c.kit, 'cancelamento', jsonb_build_array(jsonb_build_object('codigo', K3, 'quantidade', 0)),
    '[{"codigo":"09810003","up_id":"UP-K3","item_ids":["MLB-K3","MLB-K3C"]}]');
  perform pg_temp.afirmar((r->>'ok')::boolean, 'cancelamento: ' || r::text);
  t1 := (r->>'id')::uuid;
  perform pg_temp.afirmar((select tipo = 'cancelamento' and kit_id = c.kit and estado = 'ativa'
                           from public.kit_transferencias where id = t1), 'cancelamento criado errado');
  perform pg_temp.afirmar((select string_agg(codigo || ':' || papel || ':' || delta || ':' || up_id || ':' || array_to_string(item_ids, '+'), ',')
                           from public.kit_transferencia_alvos where transferencia_id = t1)
    = '09810003:destino:0:UP-K3:MLB-K3+MLB-K3C', 'alvo do cancelamento errado');
  perform pg_temp.afirmar((select string_agg(codigo || ':' || up_id, ',') from public.kit_exclusoes
                           where org_id = c.org and dono_id = t1 and dono_tipo = 'transferencia')
    = '09810003:UP-K3', 'exclusão do cancelamento errada');
end $$;
reset role;

rollback;
