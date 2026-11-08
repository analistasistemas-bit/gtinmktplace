\set ON_ERROR_STOP on
-- ADR-0197 (migration kit_variacao_criacao): criação do kit numa transação, marca inicial e alvo `criar`.
-- Fixtures só dentro da transação desfeita (scripts/teste-sql-desfeito.py), em org própria.
begin;

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97200000-0000-0000-0000-000000000001', 'Kit criação', 'kit-criacao-teste', array['kit_variacao'], true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('97200000-0000-0000-0000-000000000101', 'kit-criacao@teste.local',
   '{"org_id":"97200000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('97200000-0000-0000-0000-000000000101', '97200000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('97200000-0000-0000-0000-000000000201', '97200000-0000-0000-0000-000000000101',
   '97200000-0000-0000-0000-000000000001', 'processando', 'manual');
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro) values
  ('97200000-0000-0000-0000-000000000301', '97200000-0000-0000-0000-000000000201',
   '97200000-0000-0000-0000-000000000101', '97200000-0000-0000-0000-000000000001',
   '09900000', 'Blusa criação', 'CREATE', 'nacional', gen_random_uuid()),
  ('97200000-0000-0000-0000-000000000302', '97200000-0000-0000-0000-000000000201',
   '97200000-0000-0000-0000-000000000101', '97200000-0000-0000-0000-000000000001',
   '09910000', 'Kit blusa criação', 'CREATE', 'nacional', gen_random_uuid());
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
select f, '97200000-0000-0000-0000-000000000101', '97200000-0000-0000-0000-000000000001', c, c, c, 'M', 50, 0
from (values
  ('97200000-0000-0000-0000-000000000301'::uuid, '09900001'),   -- preto
  ('97200000-0000-0000-0000-000000000301'::uuid, '09900002'),   -- branco
  ('97200000-0000-0000-0000-000000000302'::uuid, '09910001')    -- kit preto e branco
) x(f, c);

create temp table ctx on commit drop as
select '97200000-0000-0000-0000-000000000001'::uuid as org,
       '97200000-0000-0000-0000-000000000101'::uuid as usuario,
       gen_random_uuid() as chave;
grant select on ctx to service_role;

create function pg_temp.afirmar(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALHA: %', p_msg; end if;
end $$;

create function pg_temp.linhas(p_org uuid) returns text language sql as $$
  select (select count(*) from public.kits_variacao where org_id = p_org) || '/'
      || (select count(*) from public.kit_variacao_skus where org_id = p_org) || '/'
      || (select count(*) from public.kit_marca_ml where org_id = p_org) || '/'
      || (select count(*) from public.kit_transferencias where org_id = p_org) || '/'
      || (select count(*) from public.kit_exclusoes where org_id = p_org)
$$;

do $$
declare f text := 'public.kit_variacao_criar(uuid, uuid, jsonb, jsonb, jsonb, jsonb)';
begin
  perform pg_temp.afirmar(not has_function_privilege('anon', f, 'execute'), f || ' exposta a anon');
  perform pg_temp.afirmar(not has_function_privilege('authenticated', f, 'execute'), f || ' exposta a authenticated');
  perform pg_temp.afirmar(not has_function_privilege('public', f, 'execute'), f || ' exposta a public');
  perform pg_temp.afirmar(has_function_privilege('service_role', f, 'execute'), f || ' sem service_role');
end $$;

set local role service_role;
do $$
declare
  c record; r jsonb; r2 jsonb; t uuid; tok uuid := gen_random_uuid(); o bigint;
  P constant text := '09900001'; B constant text := '09900002'; K constant text := '09910001';
  kit jsonb := '{"codigo_pai_base":"09900000","codigo_pai_kit":"09910000","pecas_por_kit":2,"preco":99.9,"meta":0,"listing_type_id":"gold_pro"}';
  skus jsonb := '[{"codigo":"09910001","tamanho":"M","cores":["Preto","Branco"],"rotulo_cor":"Preto e Branco",
                   "quantidade":2,"componentes":[{"codigo":"09900001","quantidade":1},{"codigo":"09900002","quantidade":1}]}]';
  alvos jsonb := '[{"codigo":"09900001","up_id":"UP-P","item_ids":["MLB-P"]},
                   {"codigo":"09900002","up_id":"UP-B","item_ids":["MLB-B","MLB-BC"]}]';
begin
  select * into c from ctx;
  perform public.registrar_entrada(c.org, P, 5, null, null, null, c.usuario, 'kit-criacao:p');
  perform public.registrar_entrada(c.org, B, 5, null, null, null, c.usuario, 'kit-criacao:b');

  -- Baseline divergente (ML 4 com local 5): recusa e não grava nada.
  r := public.kit_variacao_criar(c.org, c.chave, kit, skus, '[{"codigo":"09900001","ml":4},{"codigo":"09900002","ml":5}]', alvos);
  perform pg_temp.afirmar(r->>'motivo' = 'baseline_divergente' and r->>'codigo' like '09900001%', 'baseline divergente: ' || r::text);
  perform pg_temp.afirmar(pg_temp.linhas(c.org) = '0/0/0/0/0', 'recusa gravou algo: ' || pg_temp.linhas(c.org));

  -- Base com kit vinculado vivo: recusa antes de gravar.
  insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro,
                               kit_base_codigo_pai, kit_multiplicador)
  values ('97200000-0000-0000-0000-000000000303', '97200000-0000-0000-0000-000000000201', c.usuario, c.org,
          '09920000', 'Kit vinculado', 'CREATE', 'nacional', gen_random_uuid(), '09900000', 2);
  r := public.kit_variacao_criar(c.org, c.chave, kit, skus, '[{"codigo":"09900001","ml":5},{"codigo":"09900002","ml":5}]', alvos);
  perform pg_temp.afirmar(r->>'motivo' = 'base_em_kit', 'kit vinculado não recusou: ' || r::text);
  perform pg_temp.afirmar(pg_temp.linhas(c.org) = '0/0/0/0/0', 'recusa (kit vinculado) gravou algo');
  delete from public.familias where id = '97200000-0000-0000-0000-000000000303';

  -- Alvo `criar` em origem é inválido e desfaz o kit inteiro.
  r := public.kit_variacao_criar(c.org, c.chave, kit, skus, '[{"codigo":"09900001","ml":5},{"codigo":"09900002","ml":5}]',
    '[{"codigo":"09900001","criar":true},{"codigo":"09900002","up_id":"UP-B","item_ids":["MLB-B"]}]');
  perform pg_temp.afirmar(r->>'motivo' = 'alvos_invalidos', 'criar em origem passou: ' || r::text);
  perform pg_temp.afirmar(pg_temp.linhas(c.org) = '0/0/0/0/0', 'alvo inválido deixou linhas: ' || pg_temp.linhas(c.org));

  -- Caminho feliz.
  select max(ordem) into o from public.estoque_movimentos where org_id = c.org and codigo = P;
  r := public.kit_variacao_criar(c.org, c.chave, kit, skus, '[{"codigo":"09900001","ml":5},{"codigo":"09900002","ml":5}]', alvos);
  perform pg_temp.afirmar((r->>'ok')::boolean and r->>'transferencia_id' is not null, 'criação falhou: ' || r::text);
  t := (r->>'transferencia_id')::uuid;
  perform pg_temp.afirmar(pg_temp.linhas(c.org) = '1/1/3/1/3', 'linhas da criação: ' || pg_temp.linhas(c.org));
  perform pg_temp.afirmar((select ordem from public.kit_marca_ml where org_id = c.org and codigo = P) = o, 'marca de P');
  perform pg_temp.afirmar((select ordem from public.kit_marca_ml where org_id = c.org and codigo = K) = 0, 'marca do kit');
  perform pg_temp.afirmar((select so_em_kit = false and status = 'publicando' and listing_type_id = 'gold_pro'
                           from public.kits_variacao where org_id = c.org), 'kit nasce publicando, sem só em kit, com o tipo');
  perform pg_temp.afirmar((select criar and up_id = 'criar:' || K and item_ids = '{}' and papel = 'destino' and delta = 2
                           from public.kit_transferencia_alvos where transferencia_id = t and codigo = K), 'alvo criar do kit');
  perform pg_temp.afirmar((select not criar and up_id = 'UP-B' and delta = -2
                           from public.kit_transferencia_alvos where transferencia_id = t and codigo = B), 'alvo da origem');
  perform pg_temp.afirmar((select up_id is null from public.kit_exclusoes where org_id = c.org and codigo = K), 'exclusão do kit sem UP');
  perform pg_temp.afirmar((select up_id = 'UP-P' from public.kit_exclusoes where org_id = c.org and codigo = P), 'exclusão da origem');

  -- Mesma chave: devolve o mesmo kit e a mesma transferência, sem gravar de novo.
  r2 := public.kit_variacao_criar(c.org, c.chave, kit, skus, '[{"codigo":"09900001","ml":0},{"codigo":"09900002","ml":0}]', alvos);
  perform pg_temp.afirmar((r2->>'existente')::boolean and r2->>'kit_id' = r->>'kit_id' and r2->>'transferencia_id' = t::text,
    'idempotência: ' || r2::text);
  perform pg_temp.afirmar(pg_temp.linhas(c.org) = '1/1/3/1/3', 'repetição gravou de novo');

  -- Item criado gravado uma vez só: a segunda gravação não troca o item.
  perform pg_temp.afirmar(public.kit_reivindicar_execucao(c.org, t, tok, 60), 'claim');
  perform public.kit_saga_salvar_alvo(c.org, t, tok, 'criar:' || K, '{"item_criado":"MLB-NOVO","up_criado":"UP-NOVO"}');
  perform public.kit_saga_salvar_alvo(c.org, t, tok, 'criar:' || K, '{"item_criado":"MLB-OUTRO","up_criado":"UP-OUTRO"}');
  perform pg_temp.afirmar((select item_criado = 'MLB-NOVO' and up_criado = 'UP-NOVO'
                           from public.kit_transferencia_alvos where transferencia_id = t and codigo = K), 'item criado trocou');
end $$;
