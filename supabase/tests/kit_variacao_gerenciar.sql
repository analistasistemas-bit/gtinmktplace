\set ON_ERROR_STOP on
-- ADR-0199 (Task 13, fix round 1): `kit_variacao_gerenciar`. CAS de `kits_variacao.versao` e efeito na mesma transação;
-- montar/desmontar com chave estável por operação; desmontar + desligar "Vender só em kit" muda a política ANTES de a
-- transferência capturar a soma de versões (a mesma soma que a saga confere em `politicaMudou`), então não aborta.
-- Fixtures só dentro da transação desfeita (scripts/teste-sql-desfeito.py), em org própria.
begin;

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97400000-0000-0000-0000-000000000001', 'Kit gerenciar', 'kit-gerenciar-teste', array['kit_variacao'], true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('97400000-0000-0000-0000-000000000101', 'kit-gerenciar@teste.local',
   '{"org_id":"97400000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('97400000-0000-0000-0000-000000000101', '97400000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('97400000-0000-0000-0000-000000000201', '97400000-0000-0000-0000-000000000101',
   '97400000-0000-0000-0000-000000000001', 'processando', 'manual');
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro) values
  ('97400000-0000-0000-0000-000000000301', '97400000-0000-0000-0000-000000000201',
   '97400000-0000-0000-0000-000000000101', '97400000-0000-0000-0000-000000000001',
   '09700000', 'Blusa gerenciar', 'CREATE', 'nacional', gen_random_uuid()),
  ('97400000-0000-0000-0000-000000000302', '97400000-0000-0000-0000-000000000201',
   '97400000-0000-0000-0000-000000000101', '97400000-0000-0000-0000-000000000001',
   '09710000', 'Kit blusa gerenciar', 'CREATE', 'nacional', gen_random_uuid());
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
select f, '97400000-0000-0000-0000-000000000101', '97400000-0000-0000-0000-000000000001', c, c, c, 'M', 50, 0
from (values
  ('97400000-0000-0000-0000-000000000301'::uuid, '09700001'),
  ('97400000-0000-0000-0000-000000000301'::uuid, '09700002'),
  ('97400000-0000-0000-0000-000000000302'::uuid, '09710001')
) x(f, c);

create temp table ctx on commit drop as
select '97400000-0000-0000-0000-000000000001'::uuid as org,
       '97400000-0000-0000-0000-000000000101'::uuid as usuario,
       gen_random_uuid() as chave_kit;
grant select on ctx to service_role;

create function pg_temp.afirmar(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALHA: %', p_msg; end if;
end $$;

-- Mesma conta de `politicaMudou` (worker kit-transferencia: soma de `sku_politica_kit.versao` dos códigos dos alvos).
create function pg_temp.saga_aborta(p_org uuid, p_t uuid) returns boolean language sql as $$
  select coalesce((select sum(p.versao) from public.sku_politica_kit p
                   where p.org_id = p_org and p.codigo in (select a.codigo from public.kit_transferencia_alvos a
                                                           where a.transferencia_id = p_t)), 0)
         <> (select versao_politica from public.kit_transferencias where id = p_t)
$$;

do $$
declare f text := 'public.kit_variacao_gerenciar(uuid, uuid, text, integer, uuid, text, integer, jsonb, jsonb, boolean)';
begin
  perform pg_temp.afirmar(not has_function_privilege('anon', f, 'execute'), f || ' exposta a anon');
  perform pg_temp.afirmar(not has_function_privilege('authenticated', f, 'execute'), f || ' exposta a authenticated');
  perform pg_temp.afirmar(not has_function_privilege('public', f, 'execute'), f || ' exposta a public');
  perform pg_temp.afirmar(has_function_privilege('service_role', f, 'execute'), f || ' sem service_role');
end $$;

-- Kit existente (RPC da Task 10), montagem inicial concluída.
set local role service_role;
do $$
declare c record; r jsonb;
begin
  select * into c from ctx;
  perform public.registrar_entrada(c.org, '09700001', 5, null, null, null, c.usuario, 'kit-gerenciar:p');
  perform public.registrar_entrada(c.org, '09700002', 5, null, null, null, c.usuario, 'kit-gerenciar:b');
  r := public.kit_variacao_criar(c.org, c.chave_kit,
    '{"codigo_pai_base":"09700000","codigo_pai_kit":"09710000","pecas_por_kit":2,"preco":99.9,"meta":0,"pedido_hash":"HK"}',
    '[{"codigo":"09710001","tamanho":"M","cores":["Preto","Branco"],"rotulo_cor":"Preto e Branco","quantidade":1,
       "componentes":[{"codigo":"09700001","quantidade":1},{"codigo":"09700002","quantidade":1}]}]',
    '[{"codigo":"09700001","ml":5},{"codigo":"09700002","ml":5}]',
    '[{"codigo":"09700001","up_id":"UP-P","item_ids":["MLB-P"]},{"codigo":"09700002","up_id":"UP-B","item_ids":["MLB-B"]}]');
  perform pg_temp.afirmar((r->>'ok')::boolean, 'fixture do kit: ' || r::text);
end $$;
reset role;
create function pg_temp.concluir_tudo(p_org uuid) returns void language sql as $$
  update public.kit_transferencias set estado = 'concluida' where org_id = p_org and estado in ('ativa', 'travada');
  delete from public.kit_exclusoes where org_id = p_org;
$$;
select pg_temp.concluir_tudo(org) from ctx;

set local role service_role;
do $$
declare
  c record; r jsonb; r2 jsonb; k uuid; v integer; t uuid; n bigint; ch uuid := gen_random_uuid();
  itens jsonb := '[{"codigo":"09710001","quantidade":1}]';
  alvos jsonb := '[{"codigo":"09700001","up_id":"UP-P","item_ids":["MLB-P"]},{"codigo":"09700002","up_id":"UP-B","item_ids":["MLB-B"]},
                   {"codigo":"09710001","up_id":"UP-K","item_ids":["MLB-K"]}]';
  pecas jsonb := '[{"codigo":"09700001","up_id":"UP-P","item_ids":["MLB-P"]},{"codigo":"09700002","up_id":"UP-B","item_ids":["MLB-B"]}]';
begin
  select * into c from ctx;
  select id, versao into k, v from public.kits_variacao where org_id = c.org;

  -- Versão velha: nada muda.
  r := public.kit_variacao_gerenciar(c.org, k, 'alterar_meta', v - 1, null, null, 7, null, null, false);
  perform pg_temp.afirmar(r->>'motivo' = 'versao' and (r->>'versao_atual')::integer = v, 'versão velha: ' || r::text);
  perform pg_temp.afirmar((select meta = 0 and versao = v from public.kits_variacao where id = k), 'versão velha alterou');

  -- Meta: CAS e efeito juntos, versão + 1.
  r := public.kit_variacao_gerenciar(c.org, k, 'alterar_meta', v, null, null, 4, null, null, false);
  perform pg_temp.afirmar((r->>'ok')::boolean and (select meta = 4 and versao = v + 1 from public.kits_variacao where id = k), 'meta: ' || r::text);
  perform pg_temp.afirmar((r->>'versao')::integer = v + 1, 'meta sem a versão nova: ' || r::text);
  v := v + 1;

  -- Reposição sem "Vender só em kit": recusa sem consumir a versão.
  r := public.kit_variacao_gerenciar(c.org, k, 'ligar_reposicao', v, null, null, null, null, null, false);
  perform pg_temp.afirmar(r->>'motivo' = 'so_em_kit_desligado' and (select versao = v from public.kits_variacao where id = k),
    'reposição sem só em kit: ' || r::text);

  -- Montar: chave estável. A repetição devolve a mesma transferência (mesmo depois de concluída), sem mover de novo.
  r := public.kit_variacao_gerenciar(c.org, k, 'montar', v, ch, 'HM', null, itens, alvos, false);
  perform pg_temp.afirmar((r->>'ok')::boolean and r->>'transferencia_id' is not null, 'montar: ' || r::text);
  t := (r->>'transferencia_id')::uuid;
  perform pg_temp.afirmar((select chave_cadastro = ch and pedido_hash = 'HM' and tipo = 'montar' from public.kit_transferencias where id = t),
    'chave e hash gravados com a transferência');
  v := v + 1;
  perform pg_temp.concluir_tudo(c.org);
  select count(*) into n from public.kit_transferencias where org_id = c.org;
  r2 := public.kit_variacao_gerenciar(c.org, k, 'montar', v - 1, ch, 'HM', null, itens, alvos, false);
  perform pg_temp.afirmar((r2->>'existente')::boolean and r2->>'transferencia_id' = t::text, 'repetição: ' || r2::text);
  -- A repetição devolve a versão autoritativa (a tela adota; nunca presume).
  perform pg_temp.afirmar((r2->>'versao')::integer = (select versao from public.kits_variacao where id = k) and (r2->>'versao')::integer = v,
    'repetição sem a versão atual: ' || r2::text);
  perform pg_temp.afirmar((select count(*) from public.kit_transferencias where org_id = c.org) = n, 'repetição criou outra');
  r2 := public.kit_variacao_gerenciar(c.org, k, 'montar', v, ch, 'OUTRO', null, itens, alvos, false);
  perform pg_temp.afirmar(r2->>'motivo' = 'pedido_diferente', 'outro pedido com a mesma chave: ' || r2::text);

  -- Montar sem chave recusa.
  r := public.kit_variacao_gerenciar(c.org, k, 'montar', v, null, null, null, itens, alvos, false);
  perform pg_temp.afirmar(r->>'motivo' = 'chave_ausente', 'montar sem chave: ' || r::text);

  -- Ligar "Vender só em kit": CAS + reivindicação + sair_sobra numa transação.
  r := public.kit_variacao_gerenciar(c.org, k, 'ligar_so_em_kit', v, null, null, null, null, pecas, false);
  perform pg_temp.afirmar((r->>'ok')::boolean and (r->>'so_em_kit')::boolean and (r->>'reposicao_auto')::boolean, 'ligar: ' || r::text);
  v := v + 1;
  perform pg_temp.concluir_tudo(c.org);

  -- Desmontar com transferência recusada (alvo faltando): nada muda, nem a reposição nem a política.
  r := public.kit_variacao_gerenciar(c.org, k, 'desmontar', v, gen_random_uuid(), 'HX', null, itens,
    '[{"codigo":"09710001","up_id":"UP-K","item_ids":["MLB-K"]}]', true);
  perform pg_temp.afirmar(r->>'motivo' = 'alvos_invalidos', 'desmontar inválido: ' || r::text);
  perform pg_temp.afirmar((select so_em_kit and reposicao_auto and versao = v from public.kits_variacao where id = k),
    'recusa mudou a política');
  perform pg_temp.afirmar((select count(*) from public.sku_reivindicacoes_kit where kit_id = k) = 2, 'recusa soltou as peças');

  -- Desmontar + desligar "Vender só em kit" numa chamada: reposição e política desligadas ANTES da transferência.
  r := public.kit_variacao_gerenciar(c.org, k, 'desmontar', v, gen_random_uuid(), 'HD', null, itens, alvos, true);
  perform pg_temp.afirmar((r->>'ok')::boolean and (r->>'reposicao_desligada')::boolean and not (r->>'so_em_kit')::boolean,
    'desmontar e desligar: ' || r::text);
  t := (r->>'transferencia_id')::uuid;
  perform pg_temp.afirmar(jsonb_array_length(r->'normais') = 2, 'peças de volta a Normal: ' || r::text);
  perform pg_temp.afirmar((select not so_em_kit and not reposicao_auto and versao = v + 1 from public.kits_variacao where id = k),
    'kit depois de desmontar');
  perform pg_temp.afirmar(not pg_temp.saga_aborta(c.org, t), 'a saga abortaria a desmontagem (versão capturada antes da política)');
  perform pg_temp.afirmar((select tipo = 'desmontar' and estado = 'ativa' from public.kit_transferencias where id = t), 'desmontagem ativa');
end $$;
