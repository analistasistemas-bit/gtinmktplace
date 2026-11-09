\set ON_ERROR_STOP on
-- Galeria da cor por IA (Task 7): galeria_aprovar_roteiro — aprovar a versão 2 (família B) com a versão 1
-- (família A) aprovada: v1 vai a desatualizado sem estourar o índice; imagens da v1 não aplicadas →
-- desatualizada, aplicadas ficam, pendente → falhou/roteiro_trocado, submetendo|gerando não mudam.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/galeria_aprovar_roteiro.sql \
--   supabase/migrations/20261109153037_galeria_aprovar_roteiro.sql
begin;
set local lock_timeout = '5s';
insert into public.organizations (id, nome, slug) values
  ('97700000-0000-0000-0000-000000000001', 'Roteiro A', 'roteiro-a'),
  ('97700000-0000-0000-0000-000000000002', 'Roteiro B', 'roteiro-b');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('97700000-0000-0000-0000-000000000101', 'rot-a@test.local', '{}'::jsonb, '{"org_id":"97700000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.anuncios_externos (id, user_id, org_id, canal, codigo_pai) values
  ('97700000-0000-0000-0000-0000000000a1', '97700000-0000-0000-0000-000000000101', '97700000-0000-0000-0000-000000000001', 'mercado_livre', '97700001'),
  ('97700000-0000-0000-0000-0000000000a2', '97700000-0000-0000-0000-000000000101', '97700000-0000-0000-0000-000000000001', 'mercado_livre', '97700002');

-- v1 (família A) aprovada; v2 (família B) rascunho; outro anúncio com roteiro aprovado próprio.
insert into public.galeria_roteiros (id, org_id, anuncio_externo_id, familia_id, versao, conteudo, fatos_hash, moda, status) values
  ('97700000-0000-0000-0000-0000000000b1', '97700000-0000-0000-0000-000000000001', '97700000-0000-0000-0000-0000000000a1',
   '97700000-0000-0000-0000-0000000000fa', 1, '{"v":1}', 'h1', false, 'aprovado'),
  ('97700000-0000-0000-0000-0000000000b2', '97700000-0000-0000-0000-000000000001', '97700000-0000-0000-0000-0000000000a1',
   '97700000-0000-0000-0000-0000000000fb', 1, '{"v":2}', 'h-rascunho', false, 'rascunho'),
  ('97700000-0000-0000-0000-0000000000b3', '97700000-0000-0000-0000-000000000001', '97700000-0000-0000-0000-0000000000a2',
   '97700000-0000-0000-0000-0000000000fc', 1, '{"v":1}', 'hx', false, 'aprovado');
insert into public.galeria_pedidos (id, org_id, anuncio_externo_id, familia_id, roteiro_id, itens, unit_cents, elegivel) values
  ('97700000-0000-0000-0000-0000000000c1', '97700000-0000-0000-0000-000000000001', '97700000-0000-0000-0000-0000000000a1',
   '97700000-0000-0000-0000-0000000000fa', '97700000-0000-0000-0000-0000000000b1', '[]', 0, false),
  ('97700000-0000-0000-0000-0000000000c2', '97700000-0000-0000-0000-000000000001', '97700000-0000-0000-0000-0000000000a2',
   '97700000-0000-0000-0000-0000000000fc', '97700000-0000-0000-0000-0000000000b3', '[]', 0, false);
insert into public.galeria_imagens (id, org_id, anuncio_externo_id, familia_id, pedido_id, roteiro_id, cor, missao, geracao, request_id, status)
select ('97700000-0000-0000-0000-0000000000d' || n)::uuid, '97700000-0000-0000-0000-000000000001', an::uuid, fam::uuid, ped::uuid, rot::uuid,
       'Preto', n, 1, gen_random_uuid(), st
from (values
  (1, 'gerada',     '97700000-0000-0000-0000-0000000000a1', '97700000-0000-0000-0000-0000000000fa', '97700000-0000-0000-0000-0000000000c1', '97700000-0000-0000-0000-0000000000b1'),
  (2, 'aprovada',   '97700000-0000-0000-0000-0000000000a1', '97700000-0000-0000-0000-0000000000fa', '97700000-0000-0000-0000-0000000000c1', '97700000-0000-0000-0000-0000000000b1'),
  (3, 'aprovada',   '97700000-0000-0000-0000-0000000000a1', '97700000-0000-0000-0000-0000000000fa', '97700000-0000-0000-0000-0000000000c1', '97700000-0000-0000-0000-0000000000b1'),
  (4, 'pendente',   '97700000-0000-0000-0000-0000000000a1', '97700000-0000-0000-0000-0000000000fa', '97700000-0000-0000-0000-0000000000c1', '97700000-0000-0000-0000-0000000000b1'),
  (5, 'gerando',    '97700000-0000-0000-0000-0000000000a1', '97700000-0000-0000-0000-0000000000fa', '97700000-0000-0000-0000-0000000000c1', '97700000-0000-0000-0000-0000000000b1'),
  (6, 'submetendo', '97700000-0000-0000-0000-0000000000a1', '97700000-0000-0000-0000-0000000000fa', '97700000-0000-0000-0000-0000000000c1', '97700000-0000-0000-0000-0000000000b1'),
  (7, 'gerada',     '97700000-0000-0000-0000-0000000000a2', '97700000-0000-0000-0000-0000000000fc', '97700000-0000-0000-0000-0000000000c2', '97700000-0000-0000-0000-0000000000b3')
) as t(n, st, an, fam, ped, rot);
-- A imagem 2 está no manifesto de uma aplicação `aplicada`.
insert into public.galeria_aplicacoes (org_id, anuncio_externo_id, familia_id, cor, modo, manifesto, roteiro_id, fatos_hash, status) values
  ('97700000-0000-0000-0000-000000000001', '97700000-0000-0000-0000-0000000000a1', '97700000-0000-0000-0000-0000000000fa', 'Preto', 'substituir',
   '[{"imagem_id":"97700000-0000-0000-0000-0000000000d2","missao":2,"final_sha256":"x"}]', '97700000-0000-0000-0000-0000000000b1', 'h1', 'aplicada');

-- authenticated não executa.
set local role authenticated;
set local request.jwt.claims = '{"sub":"97700000-0000-0000-0000-000000000101","role":"authenticated"}';
do $$ begin
  begin
    perform public.galeria_aprovar_roteiro('97700000-0000-0000-0000-000000000001', '97700000-0000-0000-0000-0000000000b2',
      '97700000-0000-0000-0000-0000000000fb', 'h', '{}', '{}', null);
    raise exception 'authenticated executou galeria_aprovar_roteiro';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role service_role;
do $$
declare r text;
begin
  -- Outra org e família não vigente: nada muda.
  if public.galeria_aprovar_roteiro('97700000-0000-0000-0000-000000000002', '97700000-0000-0000-0000-0000000000b2',
       '97700000-0000-0000-0000-0000000000fb', 'h', '{"v":2}', '{}', null) <> 'nao_encontrado' then raise exception 'outra org aprovou'; end if;
  if public.galeria_aprovar_roteiro('97700000-0000-0000-0000-000000000001', '97700000-0000-0000-0000-0000000000b2',
       '97700000-0000-0000-0000-0000000000fa', 'h', '{"v":2}', '{}', null) <> 'familia_nao_vigente' then raise exception 'família errada aprovou'; end if;
  -- Corrida salvar × aprovar: o rascunho mudou desde a leitura da edge → recusa sem gravar.
  if public.galeria_aprovar_roteiro('97700000-0000-0000-0000-000000000001', '97700000-0000-0000-0000-0000000000b2',
       '97700000-0000-0000-0000-0000000000fb', 'h', '{"v":1}', '{"v":9}', null) <> 'conteudo_mudou' then raise exception 'aprovou conteúdo velho'; end if;
  if (select status from public.galeria_roteiros where id = '97700000-0000-0000-0000-0000000000b1') <> 'aprovado' then
    raise exception 'recusa alterou a v1'; end if;
  if (select status <> 'rascunho' or conteudo <> '{"v":2}'::jsonb from public.galeria_roteiros where id = '97700000-0000-0000-0000-0000000000b2') then
    raise exception 'recusa alterou a v2'; end if;

  r := public.galeria_aprovar_roteiro('97700000-0000-0000-0000-000000000001', '97700000-0000-0000-0000-0000000000b2',
         '97700000-0000-0000-0000-0000000000fb', 'h-vigencia', '{"v":2}', '{"v":2,"ok":true}', '97700000-0000-0000-0000-000000000101');
  if r <> 'ok' then raise exception 'aprovar devolveu %', r; end if;

  if (select status from public.galeria_roteiros where id = '97700000-0000-0000-0000-0000000000b1') <> 'desatualizado' then
    raise exception 'v1 não foi a desatualizado'; end if;
  if (select status <> 'aprovado' or fatos_hash <> 'h-vigencia' or conteudo <> '{"v":2,"ok":true}'::jsonb
        or aprovado_por is distinct from '97700000-0000-0000-0000-000000000101'::uuid or aprovado_em is null
      from public.galeria_roteiros where id = '97700000-0000-0000-0000-0000000000b2') then
    raise exception 'v2 não ficou aprovada com hash/conteúdo/autor'; end if;
  if (select status from public.galeria_roteiros where id = '97700000-0000-0000-0000-0000000000b3') <> 'aprovado' then
    raise exception 'roteiro de outro anúncio mudou'; end if;

  if (select string_agg(right(id::text, 2) || '=' || status || coalesce('/' || erro, ''), ',' order by id)
      from public.galeria_imagens where org_id = '97700000-0000-0000-0000-000000000001')
     <> 'd1=desatualizada,d2=aprovada,d3=desatualizada,d4=falhou/roteiro_trocado,d5=gerando,d6=submetendo,d7=gerada' then
    raise exception 'imagens: %', (select string_agg(right(id::text, 2) || '=' || status, ',' order by id) from public.galeria_imagens
      where org_id = '97700000-0000-0000-0000-000000000001');
  end if;

  -- Repetir: a v2 já não é rascunho.
  if public.galeria_aprovar_roteiro('97700000-0000-0000-0000-000000000001', '97700000-0000-0000-0000-0000000000b2',
       '97700000-0000-0000-0000-0000000000fb', 'h2', '{"v":2,"ok":true}', '{}', null) <> 'nao_rascunho' then raise exception 'reaprovou'; end if;
end $$;
reset role;
rollback;
