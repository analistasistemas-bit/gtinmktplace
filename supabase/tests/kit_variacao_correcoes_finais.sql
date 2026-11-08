\set ON_ERROR_STOP on
-- ADR-0199 (migration kit_variacao_correcoes_finais): participantes sem truncamento, saldo da canônica e
-- variações do kit sob o lock da família. Fixtures só dentro da transação desfeita, em org própria.
begin;

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97300000-0000-0000-0000-000000000001', 'Kit correções', 'kit-correcoes-teste', array['kit_variacao'], true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('97300000-0000-0000-0000-000000000101', 'kit-correcoes@teste.local',
   '{"org_id":"97300000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('97300000-0000-0000-0000-000000000101', '97300000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('97300000-0000-0000-0000-000000000201', '97300000-0000-0000-0000-000000000101',
   '97300000-0000-0000-0000-000000000001', 'processando', 'manual'),
  ('97300000-0000-0000-0000-000000000200', '97300000-0000-0000-0000-000000000101',
   '97300000-0000-0000-0000-000000000001', 'processando', 'manual');
-- F0 (cópia antiga) e F1 (vigente) do mesmo PAI; K = família do kit.
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, criado_em) values
  ('97300000-0000-0000-0000-000000000300', '97300000-0000-0000-0000-000000000200',
   '97300000-0000-0000-0000-000000000101', '97300000-0000-0000-0000-000000000001',
   '09700000', 'Blusa', 'CREATE', 'nacional', gen_random_uuid(), now() - interval '1 hour'),
  ('97300000-0000-0000-0000-000000000301', '97300000-0000-0000-0000-000000000201',
   '97300000-0000-0000-0000-000000000101', '97300000-0000-0000-0000-000000000001',
   '09700000', 'Blusa', 'CREATE', 'nacional', gen_random_uuid(), now()),
  ('97300000-0000-0000-0000-000000000302', '97300000-0000-0000-0000-000000000201',
   '97300000-0000-0000-0000-000000000101', '97300000-0000-0000-0000-000000000001',
   '09710000', 'Kit blusa', 'CREATE', 'nacional', gen_random_uuid(), now());
-- Saldo 9 na cópia antiga (canônica no momento da entrada); a vigente nasce depois com 0.
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque) values
  ('97300000-0000-0000-0000-000000000300', '97300000-0000-0000-0000-000000000101',
   '97300000-0000-0000-0000-000000000001', '09700001', 'Preto', 'Preto', 'M', 50, 0);
select public.registrar_entrada('97300000-0000-0000-0000-000000000001', '09700001', 9, null, null, null,
  '97300000-0000-0000-0000-000000000101', 'kit-correcoes:f0');
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque) values
  ('97300000-0000-0000-0000-000000000301', '97300000-0000-0000-0000-000000000101',
   '97300000-0000-0000-0000-000000000001', '09700001', 'Preto', 'Preto', 'M', 50, 0);

create function pg_temp.afirmar(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALHA: %', p_msg; end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.kit_skus_participantes(uuid, text[])', 'public.kit_saldo_canonico(uuid, text[])',
                           'public.kit_variacao_gravar_variacoes(uuid, uuid, jsonb)'] loop
    perform pg_temp.afirmar(not has_function_privilege('anon', f, 'execute'), f || ' exposta a anon');
    perform pg_temp.afirmar(not has_function_privilege('authenticated', f, 'execute'), f || ' exposta a authenticated');
    perform pg_temp.afirmar(has_function_privilege('service_role', f, 'execute'), f || ' sem service_role');
  end loop;
end $$;

-- Achado 2: 500 kit-SKUs com A+B e 1 com A+C = 1.002 linhas de componentes; C precisa aparecer.
insert into public.kits_variacao (id, org_id, codigo_pai_base, codigo_pai_kit, pecas_por_kit, preco) values
  ('97300000-0000-0000-0000-000000000401', '97300000-0000-0000-0000-000000000001', '09700000', '09710000', 2, 99);
insert into public.kit_variacao_skus (id, org_id, kit_id, codigo, tamanho, cores, rotulo_cor)
select ('97300000-0000-0000-0001-' || lpad(i::text, 12, '0'))::uuid, '97300000-0000-0000-0000-000000000001',
       '97300000-0000-0000-0000-000000000401', 'K' || i, 'M', array['x'], 'x'
from generate_series(1, 501) i;
insert into public.kit_variacao_componentes (kit_sku_id, org_id, codigo, quantidade)
select ('97300000-0000-0000-0001-' || lpad(i::text, 12, '0'))::uuid, '97300000-0000-0000-0000-000000000001', p, 1
from generate_series(1, 501) i
cross join lateral (values ('A'), (case when i = 501 then 'C' else 'B' end)) x(p);

set local role service_role;
do $$
declare o constant uuid := '97300000-0000-0000-0000-000000000001'; r jsonb;
        K constant uuid := '97300000-0000-0000-0000-000000000302';
begin
  perform pg_temp.afirmar((select count(*) from public.kit_variacao_componentes where org_id = o) = 1002, 'fixture');
  perform pg_temp.afirmar(public.kit_skus_participantes(o, array['A', 'B', 'C', 'X', 'K501']) = array['A', 'B', 'C', 'K501'],
    'participantes: ' || public.kit_skus_participantes(o, array['A', 'B', 'C', 'X', 'K501'])::text);
  perform pg_temp.afirmar(public.kit_skus_participantes(o, array['X']) = '{}', 'sem participante');
  perform pg_temp.afirmar(public.kit_skus_participantes(gen_random_uuid(), array['A']) = '{}', 'outra org');

  -- Achado 1: a vigente (F1, 0) ganha da cópia antiga (F0, 9), em qualquer ordem física.
  r := public.kit_saldo_canonico(o, array['09700001', 'X']);
  perform pg_temp.afirmar(r = '{"09700001": 0}'::jsonb, 'saldo canônico: ' || r::text);

  -- Achado 4: a segunda chamada (outros códigos, mesmas combinações) reaproveita os da primeira.
  r := public.kit_variacao_gravar_variacoes(o, K, '[
    {"codigo":"09710001","cor":"Preto e Branco","tamanho":"M","nome":"Preto e Branco","preco":99,"estoque":0,"user_id":"97300000-0000-0000-0000-000000000101"},
    {"codigo":"09710002","cor":"Preto e Azul","tamanho":"M","nome":"Preto e Azul","preco":99,"estoque":0,"user_id":"97300000-0000-0000-0000-000000000101"}]');
  perform pg_temp.afirmar(r = '["09710001", "09710002"]'::jsonb, 'primeira: ' || r::text);
  r := public.kit_variacao_gravar_variacoes(o, K, '[
    {"codigo":"09710009","cor":"Preto e Azul","tamanho":"M","nome":"Preto e Azul","preco":99,"estoque":0,"user_id":"97300000-0000-0000-0000-000000000101"},
    {"codigo":"09710008","cor":"Preto e Azul","tamanho":"G","nome":"Preto e Azul","preco":99,"estoque":0,"user_id":"97300000-0000-0000-0000-000000000101"},
    {"codigo":"09710007","cor":"Preto e Branco","tamanho":"M","nome":"Preto e Branco","preco":99,"estoque":0,"user_id":"97300000-0000-0000-0000-000000000101"}]');
  perform pg_temp.afirmar(r = '["09710002", "09710008", "09710001"]'::jsonb, 'repetição: ' || r::text);
  perform pg_temp.afirmar((select count(*) from public.variacoes where familia_id = K) = 3, 'variações órfãs');
  perform pg_temp.afirmar((select org_id = o and estoque = 0 and id is not null from public.variacoes
                           where familia_id = K and codigo = '09710008'), 'linha inserida sem defaults');
  begin
    perform public.kit_variacao_gravar_variacoes(gen_random_uuid(), K, '[]');
    raise exception 'FALHA: família de outra org aceita';
  exception when others then
    perform pg_temp.afirmar(sqlerrm like '%não encontrada%', 'erro inesperado: ' || sqlerrm);
  end;
end $$;

rollback;
