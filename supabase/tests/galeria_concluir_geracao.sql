\set ON_ERROR_STOP on
-- Galeria da cor por IA (Task 9): galeria_concluir_geracao — conclusão do worker num único update condicionado à
-- posse; status pela vigência do roteiro (gerada × desatualizada); posse perdida → null e nada gravado.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/galeria_concluir_geracao.sql \
--   supabase/migrations/20261110182442_galeria_concluir_geracao.sql
begin;
set local lock_timeout = '5s';
insert into public.organizations (id, nome, slug) values ('97900000-0000-0000-0000-000000000001', 'Worker A', 'worker-a');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('97900000-0000-0000-0000-000000000101', 'worker-a@test.local', '{}'::jsonb, '{"org_id":"97900000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.anuncios_externos (id, user_id, org_id, canal, codigo_pai) values
  ('97900000-0000-0000-0000-0000000000a1', '97900000-0000-0000-0000-000000000101', '97900000-0000-0000-0000-000000000001', 'mercado_livre', '97900001');
insert into public.galeria_roteiros (id, org_id, anuncio_externo_id, familia_id, versao, conteudo, fatos_hash, moda, status) values
  ('97900000-0000-0000-0000-0000000000b1', '97900000-0000-0000-0000-000000000001', '97900000-0000-0000-0000-0000000000a1',
   '97900000-0000-0000-0000-0000000000fa', 1, '{}', 'h1', false, 'desatualizado'),
  ('97900000-0000-0000-0000-0000000000b2', '97900000-0000-0000-0000-000000000001', '97900000-0000-0000-0000-0000000000a1',
   '97900000-0000-0000-0000-0000000000fa', 2, '{}', 'h2', false, 'aprovado');
insert into public.galeria_pedidos (id, org_id, anuncio_externo_id, familia_id, roteiro_id, itens, unit_cents, elegivel) values
  ('97900000-0000-0000-0000-0000000000c1', '97900000-0000-0000-0000-000000000001', '97900000-0000-0000-0000-0000000000a1',
   '97900000-0000-0000-0000-0000000000fa', '97900000-0000-0000-0000-0000000000b2', '[]', 0, false);
-- d1: roteiro vigente (b2), submetendo com posse P1. d2: roteiro antigo (b1), gerando com posse P2. d3: posse P3.
insert into public.galeria_imagens (id, org_id, anuncio_externo_id, familia_id, pedido_id, roteiro_id, cor, missao, geracao,
  request_id, status, posse, lease_ate, fase, tentativa, prompt)
select ('97900000-0000-0000-0000-0000000000d' || n)::uuid, '97900000-0000-0000-0000-000000000001',
       '97900000-0000-0000-0000-0000000000a1', '97900000-0000-0000-0000-0000000000fa', '97900000-0000-0000-0000-0000000000c1',
       rot::uuid, 'Preto', n, 1, gen_random_uuid(), st, ('97900000-0000-0000-0000-0000000000e' || n)::uuid,
       now() + interval '150 seconds', 0, 1, 'prompt hf'
from (values (1, 'submetendo', '97900000-0000-0000-0000-0000000000b2'),
             (2, 'gerando', '97900000-0000-0000-0000-0000000000b1'),
             (3, 'submetendo', '97900000-0000-0000-0000-0000000000b2')) as t(n, st, rot);

-- authenticated não executa.
set local role authenticated;
set local request.jwt.claims = '{"sub":"97900000-0000-0000-0000-000000000101","role":"authenticated"}';
do $$ begin
  begin
    perform public.galeria_concluir_geracao('97900000-0000-0000-0000-0000000000d1', '97900000-0000-0000-0000-0000000000e1', 'x', null, 1);
    raise exception 'authenticated executou galeria_concluir_geracao';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role service_role;
do $$
declare r text;
begin
  r := public.galeria_concluir_geracao('97900000-0000-0000-0000-0000000000d1', '97900000-0000-0000-0000-0000000000e1', 'org/c1.jpg', 'p1', 0.041);
  if r is distinct from 'gerada' then raise exception 'vigente devolveu %', r; end if;
  if (select status <> 'gerada' or cena_path <> 'org/c1.jpg' or prompt <> 'p1' or custo_usd <> 0.041 or posse is not null
        or lease_ate is not null or fase <> 1 or tentativa <> 1
      from public.galeria_imagens where id = '97900000-0000-0000-0000-0000000000d1') then
    raise exception 'd1 mal gravada'; end if;

  -- Roteiro antigo: desatualizada; prompt nulo mantém o gravado na submissão (Higgsfield).
  r := public.galeria_concluir_geracao('97900000-0000-0000-0000-0000000000d2', '97900000-0000-0000-0000-0000000000e2', 'org/c2.jpg', null, 0.04);
  if r is distinct from 'desatualizada' then raise exception 'antigo devolveu %', r; end if;
  if (select status <> 'desatualizada' or prompt <> 'prompt hf' or custo_usd <> 0.04 from public.galeria_imagens
      where id = '97900000-0000-0000-0000-0000000000d2') then raise exception 'd2 mal gravada'; end if;

  -- Posse perdida: null e nada gravado; repetir com a posse antiga depois de concluída também.
  r := public.galeria_concluir_geracao('97900000-0000-0000-0000-0000000000d3', '97900000-0000-0000-0000-0000000000ff', 'org/x.jpg', 'p', 0.5);
  if r is not null then raise exception 'posse errada gravou %', r; end if;
  r := public.galeria_concluir_geracao('97900000-0000-0000-0000-0000000000d1', '97900000-0000-0000-0000-0000000000e1', 'org/y.jpg', 'p', 0.5);
  if r is not null then raise exception 'posse já solta gravou %', r; end if;
  if (select cena_path is not null or custo_usd is not null or status <> 'submetendo' from public.galeria_imagens
      where id = '97900000-0000-0000-0000-0000000000d3') then raise exception 'd3 alterada'; end if;
  if (select cena_path <> 'org/c1.jpg' from public.galeria_imagens where id = '97900000-0000-0000-0000-0000000000d1') then
    raise exception 'd1 sobrescrita'; end if;
end $$;
reset role;
rollback;
