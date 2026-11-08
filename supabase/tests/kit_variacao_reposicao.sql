\set ON_ERROR_STOP on
-- ADR-0199 (migration kit_variacao_reposicao, Task 14): "Vender só em kit", Guardado ↔ Sobra versionado, reposição,
-- pausas da automação e ligar/desligar por reivindicação. Fixtures só dentro da transação desfeita, em org própria.
begin;

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97400000-0000-0000-0000-000000000001', 'Kit reposição', 'kit-reposicao-teste', array['kit_variacao'], true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('97400000-0000-0000-0000-000000000101', 'kit-reposicao@teste.local',
   '{"org_id":"97400000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('97400000-0000-0000-0000-000000000101', '97400000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('97400000-0000-0000-0000-000000000201', '97400000-0000-0000-0000-000000000101',
   '97400000-0000-0000-0000-000000000001', 'processando', 'manual');
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro) values
  ('97400000-0000-0000-0000-000000000301', '97400000-0000-0000-0000-000000000201', '97400000-0000-0000-0000-000000000101',
   '97400000-0000-0000-0000-000000000001', '09900000', 'Blusa base', 'CREATE', 'nacional', gen_random_uuid()),
  ('97400000-0000-0000-0000-000000000302', '97400000-0000-0000-0000-000000000201', '97400000-0000-0000-0000-000000000101',
   '97400000-0000-0000-0000-000000000001', '09910000', 'Kit 1', 'CREATE', 'nacional', gen_random_uuid()),
  ('97400000-0000-0000-0000-000000000303', '97400000-0000-0000-0000-000000000201', '97400000-0000-0000-0000-000000000101',
   '97400000-0000-0000-0000-000000000001', '09920000', 'Kit 2', 'CREATE', 'nacional', gen_random_uuid()),
  ('97400000-0000-0000-0000-000000000304', '97400000-0000-0000-0000-000000000201', '97400000-0000-0000-0000-000000000101',
   '97400000-0000-0000-0000-000000000001', '09930000', 'Kit 3', 'CREATE', 'nacional', gen_random_uuid());
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
select f, '97400000-0000-0000-0000-000000000101', '97400000-0000-0000-0000-000000000001', c, c, c, 'M', 50, 0
from (values
  ('97400000-0000-0000-0000-000000000301'::uuid, '09900001', 0),   -- P
  ('97400000-0000-0000-0000-000000000301'::uuid, '09900002', 2),   -- B
  ('97400000-0000-0000-0000-000000000301'::uuid, '09900003', 3),   -- A
  ('97400000-0000-0000-0000-000000000301'::uuid, '09900004', 2),   -- C1 (kit criado com a opção)
  ('97400000-0000-0000-0000-000000000301'::uuid, '09900005', 2),   -- C2
  ('97400000-0000-0000-0000-000000000302'::uuid, '09910001', 1),   -- KPB
  ('97400000-0000-0000-0000-000000000302'::uuid, '09910002', 0),   -- KPA
  ('97400000-0000-0000-0000-000000000303'::uuid, '09920001', 0),   -- KBA (kit 2)
  ('97400000-0000-0000-0000-000000000304'::uuid, '09930001', 0)    -- KC (kit 3, criado)
) x(f, c, e);
-- Saldo inicial só pelo ledger.
select public.registrar_entrada('97400000-0000-0000-0000-000000000001', c, q, null, null, null,
                                '97400000-0000-0000-0000-000000000101', 'kit-reposicao:' || c)
from (values ('09900002', 2), ('09900003', 3), ('09900004', 2), ('09900005', 2), ('09910001', 1)) x(c, q);
insert into public.anuncios_externos (id, user_id, org_id, canal, codigo_pai) values
  ('97400000-0000-0000-0000-000000000401', '97400000-0000-0000-0000-000000000101',
   '97400000-0000-0000-0000-000000000001', 'mercado_livre', '09900000'),
  ('97400000-0000-0000-0000-000000000402', '97400000-0000-0000-0000-000000000101',
   '97400000-0000-0000-0000-000000000001', 'mercado_livre', '09910000');
insert into public.anuncios_externos_itens (anuncio_externo_id, org_id, sku, status, item_externo_id, user_product_id) values
  ('97400000-0000-0000-0000-000000000401', '97400000-0000-0000-0000-000000000001', '09900001', 'ativo', 'MLB-P', 'UP-P'),
  ('97400000-0000-0000-0000-000000000401', '97400000-0000-0000-0000-000000000001', '09900002', 'ativo', 'MLB-B', 'UP-B'),
  ('97400000-0000-0000-0000-000000000401', '97400000-0000-0000-0000-000000000001', '09900003', 'ativo', 'MLB-A', 'UP-A'),
  ('97400000-0000-0000-0000-000000000402', '97400000-0000-0000-0000-000000000001', '09910001', 'ativo', 'MLB-KPB', 'UP-KPB');

create temp table ctx on commit drop as
select '97400000-0000-0000-0000-000000000001'::uuid as org,
       gen_random_uuid() as k1, gen_random_uuid() as k2,
       gen_random_uuid() as kpb, gen_random_uuid() as kpa, gen_random_uuid() as kba;
grant select on ctx to service_role;

create function pg_temp.afirmar(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALHA: %', p_msg; end if;
end $$;

create function pg_temp.pol(p_codigo text) returns text language sql as $$
  select coalesce((select estado || '/' || versao from public.sku_politica_kit
    where org_id = '97400000-0000-0000-0000-000000000001' and codigo = p_codigo), 'sem linha')
$$;

-- Finaliza uma transferência como a saga faria (claim do teste), com as pausas pedidas.
create function pg_temp.finalizar(p_t uuid, p_pausas jsonb) returns void language plpgsql as $$
declare tok uuid := gen_random_uuid();
begin
  update public.kit_transferencias set execucao_token = tok, execucao_ate = clock_timestamp() + interval '1 minute' where id = p_t;
  perform public.kit_saga_finalizar('97400000-0000-0000-0000-000000000001', p_t, tok, 'concluida', null, p_pausas);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.kit_saga_finalizar(uuid, uuid, uuid, text, text, jsonb)',
    'public.kit_reposicao_foto(uuid, uuid)',
    'public.kit_reposicao_sobra(uuid, text[], jsonb)',
    'public.kit_reposicao_guardar(uuid, text[], text[], jsonb, jsonb)',
    'public.kit_reposicao_repor(uuid, uuid, jsonb, jsonb, jsonb)',
    'public.kit_reposicao_reivindicar(uuid, uuid)',
    'public.kit_reposicao_ligar(uuid, uuid, jsonb)',
    'public.kit_reposicao_desligar(uuid, uuid)',
    'public.kit_reposicao_conferir(uuid, jsonb)'
  ] loop
    perform pg_temp.afirmar(not has_function_privilege('anon', f, 'execute'), f || ' exposta a anon');
    perform pg_temp.afirmar(not has_function_privilege('authenticated', f, 'execute'), f || ' exposta a authenticated');
    perform pg_temp.afirmar(has_function_privilege('service_role', f, 'execute'), f || ' sem service_role');
  end loop;
  perform pg_temp.afirmar(not has_table_privilege('authenticated', 'public.kit_pausas_automaticas', 'insert'), 'pausas graváveis pelo app');
  -- A assinatura antiga saiu: só existe a com `p_pausas`.
  perform pg_temp.afirmar(to_regprocedure('public.kit_saga_finalizar(uuid, uuid, uuid, text, text)') is null, 'finalizar antigo ficou');
end $$;

set local role service_role;
do $$
declare
  c record; r jsonb; t uuid; tg uuid; te uuid; v text[]; fo jsonb;
  P constant text := '09900001'; B constant text := '09900002'; A constant text := '09900003';
  alvos jsonb := '[{"codigo":"09900001","up_id":"UP-P","item_ids":["MLB-P"]},
                   {"codigo":"09900002","up_id":"UP-B","item_ids":["MLB-B"]},
                   {"codigo":"09900003","up_id":"UP-A","item_ids":["MLB-A"]},
                   {"codigo":"09910001","up_id":"UP-KPB","item_ids":["MLB-KPB"]}]';
begin
  select * into c from ctx;
  insert into public.kits_variacao (id, org_id, codigo_pai_base, codigo_pai_kit, pecas_por_kit, preco, meta)
  values (c.k1, c.org, '09900000', '09910000', 2, 99.90, 3), (c.k2, c.org, '09900000', '09920000', 2, 99.90, 3);
  insert into public.kit_variacao_skus (id, org_id, kit_id, codigo, tamanho, cores, rotulo_cor)
  values (c.kpb, c.org, c.k1, '09910001', 'M', array['Preto','Branco'], 'Preto e Branco'),
         (c.kpa, c.org, c.k1, '09910002', 'M', array['Preto','Azul'], 'Preto e Azul'),
         (c.kba, c.org, c.k2, '09920001', 'M', array['Branco','Azul'], 'Branco e Azul');
  insert into public.kit_variacao_componentes (kit_sku_id, org_id, codigo, quantidade)
  values (c.kpb, c.org, P, 1), (c.kpb, c.org, B, 1), (c.kpa, c.org, P, 1), (c.kpa, c.org, A, 1),
         (c.kba, c.org, B, 1), (c.kba, c.org, A, 1);

  -- Ligar: reivindica, Normal → Guardado (sem linha: 0 → 1) e transferência sair_sobra que pausa os três.
  r := public.kit_reposicao_ligar(c.org, c.k1, alvos);
  perform pg_temp.afirmar((r->>'ok')::boolean and r->>'transferencia_id' is not null, 'ligar: ' || r::text);
  t := (r->>'transferencia_id')::uuid;
  perform pg_temp.afirmar(pg_temp.pol(P) = 'guardado/1' and pg_temp.pol(B) = 'guardado/1' and pg_temp.pol(A) = 'guardado/1',
    'ligar guarda: ' || pg_temp.pol(P) || ' ' || pg_temp.pol(B) || ' ' || pg_temp.pol(A));
  perform pg_temp.afirmar((select tipo = 'sair_sobra' and kit_id is null and versao_politica = 3
                           and (select count(*) from public.kit_transferencia_alvos a where a.transferencia_id = t) = 3
                           from public.kit_transferencias where id = t), 'ligar: transferência com a versão já incrementada');
  perform pg_temp.afirmar((select so_em_kit and reposicao_auto from public.kits_variacao where id = c.k1), 'ligar liga as opções');
  perform pg_temp.afirmar((select count(*) from public.sku_reivindicacoes_kit where kit_id = c.k1) = 3, 'reivindicações');

  -- Ligar de novo: nada a guardar, sem transferência nova, versões iguais.
  r := public.kit_reposicao_ligar(c.org, c.k1, alvos);
  perform pg_temp.afirmar((r->>'ok')::boolean and r->>'transferencia_id' is null and pg_temp.pol(P) = 'guardado/1', 'ligar idempotente: ' || r::text);

  -- Fotografia: SKUs pendentes enquanto a pausa não termina.
  fo := public.kit_reposicao_foto(c.org, c.k1);
  perform pg_temp.afirmar(jsonb_array_length(fo->'kits') = 1 and fo->'kits'->0->>'soEmKit' = 'true', 'foto kits: ' || (fo->'kits')::text);
  perform pg_temp.afirmar((select bool_and((s->>'pendente')::boolean) from jsonb_array_elements(fo->'skus') s), 'foto: pendentes');
  perform pg_temp.afirmar((select s->>'saldo' = '2' and s->>'estado' = 'guardado' and s->>'versao' = '1'
                           from jsonb_array_elements(fo->'skus') s where s->>'codigo' = B), 'foto: B');
  perform pg_temp.afirmar((select k->>'publicado' = 'true' and k->>'saldo' = '1' and k->>'pendente' = 'false'
                           from jsonb_array_elements(fo->'kits'->0->'skus') k where k->>'codigo' = '09910001'), 'foto: KPB');
  perform pg_temp.afirmar((select k->>'publicado' = 'false' from jsonb_array_elements(fo->'kits'->0->'skus') k
                           where k->>'codigo' = '09910002'), 'foto: KPA sem item');

  -- Finalizar grava só pausa que a saga fez: MLB-P (pausado_pela_saga); MLB-B veio pedido mas já estava pausado.
  update public.kit_transferencia_alvos set pausado_pela_saga = array['MLB-P'] where transferencia_id = t and codigo = P;
  perform pg_temp.finalizar(t, '[{"codigo":"09900001","itemId":"MLB-P"},{"codigo":"09900002","itemId":"MLB-B"}]');
  perform pg_temp.afirmar((select array_agg(item_id) from public.kit_pausas_automaticas where org_id = c.org) = array['MLB-P'],
    'pausa manual anterior não vira pausa da automação');
  fo := public.kit_reposicao_foto(c.org, c.k1);
  perform pg_temp.afirmar(fo->'pausas' = '[{"codigo":"09900001","itemId":"MLB-P"}]' and
    not (select bool_or((s->>'pendente')::boolean) from jsonb_array_elements(fo->'skus') s), 'foto depois: ' || fo::text);

  -- Guardado → Sobra: decisão velha recusa sem mudar nada; atual muda e incrementa.
  r := public.kit_reposicao_sobra(c.org, array[B], '{"09900002":0,"09900001":1}');
  perform pg_temp.afirmar(r->>'motivo' = 'versao' and pg_temp.pol(B) = 'guardado/1', 'sobra velha: ' || r::text);
  perform pg_temp.afirmar(not exists (select 1 from public.kit_avisos_sobra where org_id = c.org), 'decisão velha não avisa');
  r := public.kit_reposicao_sobra(c.org, array[B], '{"09900001":1}');
  perform pg_temp.afirmar(r->>'motivo' = 'versao_ausente', 'sobra sem a versão do próprio: ' || r::text);
  r := public.kit_reposicao_sobra(c.org, array[B], '{"09900002":1,"09900001":1}');
  perform pg_temp.afirmar((r->>'ok')::boolean and pg_temp.pol(B) = 'sobra/2', 'sobra: ' || r::text || ' ' || pg_temp.pol(B));
  -- Fix 1 (P2): a pendência do aviso nasce na mesma transação, com a versão nova, e aparece na fotografia.
  perform pg_temp.afirmar((select count(*) = 1 and bool_and(versao = 2 and resultado is null) from public.kit_avisos_sobra
                           where org_id = c.org and codigo = B), 'aviso de Sobra pendente');
  perform pg_temp.afirmar(public.kit_reposicao_foto(c.org, c.k1)->'avisos' = '[{"codigo":"09900002","versao":2,"resultado":null}]',
    'foto traz o aviso');
  r := public.kit_reposicao_sobra(c.org, array[B], '{"09900002":2}');
  perform pg_temp.afirmar(r->>'motivo' = 'estado', 'sobra de quem já é sobra: ' || r::text);

  -- Não vira Sobra com transferência pendente.
  r := public.kit_criar_transferencia(c.org, null, 'entrada', '[{"codigo":"09900003","quantidade":0}]',
    '[{"codigo":"09900003","up_id":"UP-A","item_ids":["MLB-A"]}]');
  te := (r->>'id')::uuid;
  r := public.kit_reposicao_sobra(c.org, array[A], '{"09900003":1}');
  perform pg_temp.afirmar(r->>'motivo' = 'estado' and r->>'codigo' = A and pg_temp.pol(A) = 'guardado/1', 'pendente não vira sobra: ' || r::text);

  -- Sobra → Guardado: parceiro ocupado (A em transferência) recusa e desfaz tudo, B segue Sobra.
  r := public.kit_reposicao_guardar(c.org, array[B], array[A], '{"09900002":2,"09900003":1}',
    (select jsonb_agg(x) from jsonb_array_elements(alvos) x where x->>'codigo' in (A, B)));
  perform pg_temp.afirmar(r->>'motivo' = 'up_ocupado' and pg_temp.pol(B) = 'sobra/2', 'guardar com parceiro ocupado: ' || r::text);
  perform pg_temp.afirmar(not exists (select 1 from public.kit_exclusoes where org_id = c.org and codigo = B), 'recusa reservou B');
  r := public.kit_reposicao_guardar(c.org, array[B], array[P], '{"09900002":1,"09900001":1}', alvos);
  perform pg_temp.afirmar(r->>'motivo' = 'versao' and pg_temp.pol(B) = 'sobra/2', 'guardar velho: ' || r::text);
  r := public.kit_reposicao_guardar(c.org, array[B], array[P], '{"09900002":2,"09900001":1}',
    (select jsonb_agg(x) from jsonb_array_elements(alvos) x where x->>'codigo' in (P, B)));
  perform pg_temp.afirmar((r->>'ok')::boolean and pg_temp.pol(B) = 'guardado/3', 'guardar: ' || r::text);
  tg := (r->>'transferencia_id')::uuid;
  -- Parceiro reservado na mesma transação: a exclusão é da sair_sobra, com P e B.
  perform pg_temp.afirmar((select array_agg(codigo order by codigo) from public.kit_exclusoes where dono_id = tg) = array[P, B],
    'parceiro reservado');
  perform pg_temp.afirmar((select tipo from public.kit_transferencias where id = tg) = 'sair_sobra', 'tipo sair_sobra');

  -- Repor: SKU ocupado (sair_sobra aberta) recusa; versão velha recusa; kit sem a opção recusa.
  r := public.kit_reposicao_repor(c.org, c.k1, '[{"codigo":"09910001","quantidade":1}]', '{"09900001":1,"09900002":3}',
    (select jsonb_agg(x) from jsonb_array_elements(alvos) x where x->>'codigo' in (P, B, '09910001')));
  perform pg_temp.afirmar(r->>'motivo' = 'up_ocupado', 'repor com SKU ocupado: ' || r::text);
  perform pg_temp.finalizar(tg, '[]');
  r := public.kit_reposicao_repor(c.org, c.k1, '[{"codigo":"09910001","quantidade":1}]', '{"09900001":1,"09900002":2}',
    (select jsonb_agg(x) from jsonb_array_elements(alvos) x where x->>'codigo' in (P, B, '09910001')));
  perform pg_temp.afirmar(r->>'motivo' = 'versao', 'repor velho: ' || r::text);
  r := public.kit_reposicao_repor(c.org, c.k1, '[{"codigo":"09910001","quantidade":1}]', '{"09900001":1}',
    (select jsonb_agg(x) from jsonb_array_elements(alvos) x where x->>'codigo' in (P, B, '09910001')));
  perform pg_temp.afirmar(r->>'motivo' = 'versao_ausente', 'repor sem versão de origem: ' || r::text);
  r := public.kit_reposicao_repor(c.org, c.k2, '[{"codigo":"09920001","quantidade":1}]', '{"09900002":3,"09900003":1}', '[]');
  perform pg_temp.afirmar(r->>'motivo' = 'kit_sem_reposicao', 'repor em kit sem a opção: ' || r::text);
  r := public.kit_reposicao_repor(c.org, c.k1, '[{"codigo":"09910001","quantidade":1}]', '{"09900001":1,"09900002":3}',
    (select jsonb_agg(x) from jsonb_array_elements(alvos) x where x->>'codigo' in (P, B, '09910001')));
  perform pg_temp.afirmar((r->>'ok')::boolean, 'repor: ' || r::text);
  t := (r->>'transferencia_id')::uuid;
  perform pg_temp.afirmar((select tipo = 'repor' and kit_id = c.k1 and versao_politica = 4 from public.kit_transferencias where id = t),
    'repor: tipo, kit e versão');
  perform pg_temp.finalizar(t, '[]');
  perform pg_temp.finalizar(te, '[]');

  -- Fix 1 (P1-2): finalização abortada também grava as pausas da saga (recuperação pela política vigente).
  r := public.kit_criar_transferencia(c.org, null, 'sair_sobra', '[{"codigo":"09900003","quantidade":0}]',
    '[{"codigo":"09900003","up_id":"UP-A","item_ids":["MLB-A"]}]');
  update public.kit_transferencia_alvos set pausado_pela_saga = array['MLB-A'] where transferencia_id = (r->>'id')::uuid;
  update public.kit_transferencias set execucao_token = c.k1, execucao_ate = clock_timestamp() + interval '1 minute'
  where id = (r->>'id')::uuid;
  perform public.kit_saga_finalizar(c.org, (r->>'id')::uuid, c.k1, 'abortada', 'política mudou',
    '[{"codigo":"09900003","itemId":"MLB-A"}]');
  perform pg_temp.afirmar(exists (select 1 from public.kit_pausas_automaticas where org_id = c.org and item_id = 'MLB-A'),
    'abortada registra a pausa');

  -- Origem fora de Guardado recusa: P vira Sobra e a reposição não pode usá-lo.
  perform public.kit_reposicao_sobra(c.org, array[P], jsonb_build_object(P, 1));
  r := public.kit_reposicao_repor(c.org, c.k1, '[{"codigo":"09910001","quantidade":1}]', '{"09900001":2,"09900002":3}',
    (select jsonb_agg(x) from jsonb_array_elements(alvos) x where x->>'codigo' in (P, B, '09910001')));
  perform pg_temp.afirmar(r->>'motivo' = 'origem_nao_guardada' and r->>'codigo' = P, 'repor com Sobra: ' || r::text);

  -- Dois kits: K2 também reivindica B e A. Desligar K1 só devolve P a Normal; B e A seguem Guardados.
  r := public.kit_reposicao_ligar(c.org, c.k2, alvos);
  perform pg_temp.afirmar((r->>'ok')::boolean and r->>'transferencia_id' is null, 'ligar K2 sem nada novo a pausar: ' || r::text);
  v := public.kit_reposicao_desligar(c.org, c.k1);
  perform pg_temp.afirmar(v = array[P], 'desligar K1: ' || v::text);
  perform pg_temp.afirmar(pg_temp.pol(P) = 'normal/3' and pg_temp.pol(B) = 'guardado/3' and pg_temp.pol(A) = 'guardado/1',
    'desligar K1 mantém os de K2: ' || pg_temp.pol(P) || ' ' || pg_temp.pol(B) || ' ' || pg_temp.pol(A));
  perform pg_temp.afirmar(not (select so_em_kit from public.kits_variacao where id = c.k1)
    and (select count(*) from public.sku_reivindicacoes_kit where kit_id = c.k1) = 0
    and (select count(*) from public.sku_reivindicacoes_kit where kit_id = c.k2) = 2, 'só a reivindicação de K1 saiu');
  -- Fotografia do kit desligado ainda traz o kit (para desfazer pausas) e a pausa de P.
  fo := public.kit_reposicao_foto(c.org, c.k1);
  perform pg_temp.afirmar((select count(*) from jsonb_array_elements(fo->'kits') k where k->>'id' = c.k1::text and k->>'soEmKit' = 'false') = 1,
    'foto do kit desligado');
  v := public.kit_reposicao_desligar(c.org, c.k2);
  perform pg_temp.afirmar(v = array[B, A] and pg_temp.pol(A) = 'normal/2' and pg_temp.pol(B) = 'normal/4', 'desligar K2: ' || v::text);
end $$;

-- Criação com "Vender só em kit": os componentes viram Guardado antes da montagem, e a transferência nasce com a
-- versão já incrementada (a saga não aborta por ela).
do $$
declare c record; r jsonb;
begin
  select * into c from ctx;
  r := public.kit_variacao_criar(c.org, gen_random_uuid(),
    '{"codigo_pai_base":"09900000","codigo_pai_kit":"09930000","pecas_por_kit":2,"preco":99.9,"meta":3,"pedido_hash":"h","so_em_kit":true}',
    '[{"codigo":"09930001","tamanho":"M","cores":["C1","C2"],"rotulo_cor":"C1 e C2","quantidade":1,
       "componentes":[{"codigo":"09900004","quantidade":1},{"codigo":"09900005","quantidade":1}]}]',
    '[{"codigo":"09900004","ml":2},{"codigo":"09900005","ml":2}]',
    '[{"codigo":"09900004","up_id":"UP-C1","item_ids":["MLB-C1"]},{"codigo":"09900005","up_id":"UP-C2","item_ids":["MLB-C2"]}]');
  perform pg_temp.afirmar((r->>'ok')::boolean, 'criar com a opção: ' || r::text);
  perform pg_temp.afirmar(pg_temp.pol('09900004') = 'guardado/1' and pg_temp.pol('09900005') = 'guardado/1', 'criar guarda');
  perform pg_temp.afirmar((select versao_politica = 2 and tipo = 'montar' from public.kit_transferencias
                           where id = (r->>'transferencia_id')::uuid), 'montagem com a versão incrementada');
  perform pg_temp.afirmar((select so_em_kit and reposicao_auto from public.kits_variacao where id = (r->>'kit_id')::uuid),
    'kit criado com as opções');
end $$;

rollback;
