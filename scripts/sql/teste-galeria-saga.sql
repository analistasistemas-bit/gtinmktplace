\set ON_ERROR_STOP on
-- ADR-0201 (Galeria da cor), Task 14: aborto atômico em galeria_concluir_item, claim de item dentro do ciclo
-- (galeria_assumir_item) e manifesto com sha trocado no confirmar (adendo 8). Rodar:
--   python3 scripts/teste-sql-desfeito.py scripts/sql/teste-galeria-saga.sql \
--     supabase/migrations/20261109093335_galeria_da_cor.sql supabase/migrations/20261110171517_galeria_despacho.sql \
--     supabase/migrations/20261110231651_galeria_saga_aplicar.sql
-- Sem a última migration tem de FALHAR (prova de vermelho). Tudo some no rollback.
begin;
set local lock_timeout = '5s';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97900000-0000-0000-0000-000000000001', 'Galeria saga', 'galeria-saga-teste', array['imagem_ia'], true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('97900000-0000-0000-0000-000000000101', 'galeria-saga@teste.local', '{"org_id":"97900000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('97900000-0000-0000-0000-000000000101', '97900000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;

create or replace function pg_temp.afirmar(c boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FALHA: %', msg; end if; end $$;

do $$
declare
  o constant uuid := '97900000-0000-0000-0000-000000000001';
  u constant uuid := '97900000-0000-0000-0000-000000000101';
  v_lote uuid; v_fam uuid; v_an uuid; v_rot uuid; v_ped uuid := gen_random_uuid(); v_img uuid;
  a uuid; p uuid; m uuid; g uuid; h uuid; s text;
  x uuid := gen_random_uuid(); y uuid := gen_random_uuid(); n integer;
begin
  insert into public.lotes (user_id, org_id, status, origem) values (u, o, 'concluido', 'manual') returning id into v_lote;
  insert into public.familias (lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, status)
  values (v_lote, u, o, '97900001', '97900001', 'CREATE', 'nacional', gen_random_uuid(), 'publicado') returning id into v_fam;
  insert into public.anuncios_externos (user_id, org_id, canal, codigo_pai, particao, status)
  values (u, o, 'mercado_livre', '97900001', 0, 'publicado') returning id into v_an;
  insert into public.galeria_roteiros (org_id, anuncio_externo_id, familia_id, versao, conteudo, fatos_hash, moda, status)
  values (o, v_an, v_fam, 1, '{}'::jsonb, 'h1', false, 'aprovado') returning id into v_rot;

  -- 1. Falha na ida: abortar_em + abortando + pendente|subindo → pulado (mesmo com lease vigente) + aplicado →
  --    compensando, tudo na mesma transação; o item com PUT incerto (aplicando) segue para a reconciliação.
  insert into public.galeria_aplicacoes (org_id, anuncio_externo_id, familia_id, cor, modo, manifesto, roteiro_id,
    fatos_hash, status, prazo_ate, ciclo_ate)
  values (o, v_an, v_fam, 'Rosa', 'substituir', '[]'::jsonb, v_rot, 'h1', 'em_andamento', now() + interval '30 minutes',
    now() + interval '3 hours') returning id into a;
  insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id, status, posse, lease_ate, put_em)
  values (o, v_an, a, 'MLB-P', 'aplicado', null, null, now() - interval '2 minutes') returning id into p;
  insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id, status, posse, lease_ate)
  values (o, v_an, a, 'MLB-M', 'subindo', x, now() + interval '1 minute') returning id into m;
  insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id, status)
  values (o, v_an, a, 'MLB-G', 'pendente') returning id into g;
  insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id, status, posse, lease_ate, put_em)
  values (o, v_an, a, 'MLB-H', 'aplicando', y, now() + interval '1 minute', now()) returning id into h;
  insert into public.ml_item_travas (org_id, item_id, dono_tipo, dono_id)
  select o, i, 'galeria', a from unnest(array['MLB-P', 'MLB-M', 'MLB-G', 'MLB-H']) i;

  s := public.galeria_concluir_item(m, x, 'falhou', '{"erro":"sha_divergente"}'::jsonb);
  perform pg_temp.afirmar(s = 'abortando', 'aplicação abortando: ' || s);
  perform pg_temp.afirmar((select abortar_em is not null from public.galeria_aplicacoes where id = a), 'abortar_em gravado');
  perform pg_temp.afirmar((select status = 'falhou' and erro = 'sha_divergente' from public.galeria_aplicacao_itens where id = m),
    'item com a falha preserva o estado e o motivo');
  perform pg_temp.afirmar((select status = 'pulado' and posse is null and lease_ate is null from public.galeria_aplicacao_itens where id = g),
    'pendente → pulado');
  perform pg_temp.afirmar((select status = 'compensando' and compensar_ate > now() + interval '59 minutes'
    from public.galeria_aplicacao_itens where id = p), 'aplicado → compensando com compensar_ate');
  perform pg_temp.afirmar((select status = 'aplicando' and posse = y from public.galeria_aplicacao_itens where id = h),
    'aplicando (PUT incerto) não é tocado');
  perform pg_temp.afirmar((select count(*) from public.ml_item_travas where dono_id = a) = 4, 'travas mantidas');

  -- 2. Portão de avanço fechado por roteiro novo: item pulado com {"abortar": true} também aborta.
  insert into public.galeria_aplicacoes (org_id, anuncio_externo_id, familia_id, cor, modo, manifesto, roteiro_id,
    fatos_hash, status, prazo_ate, ciclo_ate)
  values (o, v_an, v_fam, 'Azul', 'substituir', '[]'::jsonb, v_rot, 'h1', 'em_andamento', now() + interval '30 minutes',
    now() + interval '3 hours') returning id into a;
  insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id, status)
  values (o, v_an, a, 'MLB-A1', 'aplicado') returning id into p;
  insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id, status, posse)
  values (o, v_an, a, 'MLB-A2', 'pendente', x) returning id into m;
  s := public.galeria_concluir_item(m, x, 'pulado', '{"erro":"roteiro_trocado","abortar":true}'::jsonb);
  perform pg_temp.afirmar(s = 'abortando' and (select status = 'compensando' from public.galeria_aplicacao_itens where id = p),
    'pulado com abortar → abortando e compensa: ' || s);
  -- pulado sem abortar numa aplicação já abortando não muda nada além do item.
  perform pg_temp.afirmar((select status from public.galeria_aplicacao_itens where id = m) = 'pulado', 'item pulado');

  -- 3. Claim de item só dentro do ciclo, na fase da mensagem, com lease livre.
  insert into public.galeria_aplicacoes (org_id, anuncio_externo_id, familia_id, cor, modo, manifesto, roteiro_id,
    fatos_hash, status, prazo_ate, ciclo_ate)
  values (o, v_an, v_fam, 'Verde', 'substituir', '[]'::jsonb, v_rot, 'h1', 'em_andamento', now() + interval '30 minutes',
    now() + interval '3 hours') returning id into a;
  insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id, status, fase)
  values (o, v_an, a, 'MLB-V1', 'pendente', 2) returning id into g;
  select count(*) into n from public.galeria_assumir_item(g, 1, x, 150);
  perform pg_temp.afirmar(n = 0, 'fase errada não assume');
  select count(*) into n from public.galeria_assumir_item(g, 2, x, 150);
  perform pg_temp.afirmar(n = 1 and (select posse = x and lease_ate > now() from public.galeria_aplicacao_itens where id = g),
    'assume com posse e lease');
  select count(*) into n from public.galeria_assumir_item(g, 2, y, 150);
  perform pg_temp.afirmar(n = 0, 'lease vigente não é tomado');
  update public.galeria_aplicacao_itens set lease_ate = now() - interval '1 second' where id = g;
  update public.galeria_aplicacoes set ciclo_ate = now() - interval '1 second' where id = a;
  select count(*) into n from public.galeria_assumir_item(g, 2, y, 150);
  perform pg_temp.afirmar(n = 0 and (select posse = x from public.galeria_aplicacao_itens where id = g),
    'ciclo vencido: nenhum lease novo (nem por mensagem antiga)');
  update public.galeria_aplicacoes set ciclo_ate = now() + interval '1 hour', status = 'preparada' where id = a;
  select count(*) into n from public.galeria_assumir_item(g, 2, y, 150);
  perform pg_temp.afirmar(n = 0, 'aplicação preparada nunca executa');
  update public.galeria_aplicacoes set status = 'revertendo' where id = a;
  update public.galeria_aplicacao_itens set status = 'compensando' where id = g;
  select count(*) into n from public.galeria_assumir_item(g, 2, y, 150);
  perform pg_temp.afirmar(n = 1, 'compensando em revertendo é assumido');
  update public.galeria_aplicacao_itens set status = 'compensado', lease_ate = null where id = g;
  select count(*) into n from public.galeria_assumir_item(g, 2, x, 150);
  perform pg_temp.afirmar(n = 0, 'item terminal não é assumido');

  -- 4. Adendo 8: imagem do manifesto ainda aprovada mas com outro final_sha256 → desatualizada, zero travas.
  insert into public.galeria_pedidos (id, org_id, anuncio_externo_id, familia_id, roteiro_id, itens, unit_cents, elegivel)
  values (v_ped, o, v_an, v_fam, v_rot, '[]'::jsonb, 0, false);
  insert into public.galeria_imagens (org_id, anuncio_externo_id, familia_id, pedido_id, roteiro_id, cor, missao, geracao,
    request_id, status, final_sha256)
  values (o, v_an, v_fam, v_ped, v_rot, 'Rosa', 1, 1, gen_random_uuid(), 'aprovada', 'sha-2') returning id into v_img;
  insert into public.galeria_aplicacoes (org_id, anuncio_externo_id, familia_id, cor, modo, manifesto, roteiro_id,
    fatos_hash, status)
  values (o, v_an, v_fam, 'Rosa', 'substituir',
    jsonb_build_array(jsonb_build_object('imagem_id', v_img, 'missao', 1, 'final_sha256', 'sha-1')), v_rot, 'h1', 'preparada')
  returning id into a;
  insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id) values (o, v_an, a, 'MLB-Z1');
  s := public.galeria_confirmar_aplicacao(o, v_fam, a, v_rot, 'h1');
  perform pg_temp.afirmar(s = 'desatualizada' and not exists (select 1 from public.ml_item_travas where dono_id = a)
    and (select status = 'preparada' from public.galeria_aplicacoes where id = a), 'sha trocado → desatualizada: ' || s);
  update public.galeria_imagens set final_sha256 = 'sha-1' where id = v_img;
  s := public.galeria_confirmar_aplicacao(o, v_fam, a, v_rot, 'h1');
  perform pg_temp.afirmar(s = 'ok', 'mesmo sha → ok: ' || s);

  -- 5. Privilégios.
  perform pg_temp.afirmar(not has_function_privilege('authenticated', 'public.galeria_assumir_item(uuid, integer, uuid, integer)', 'execute'),
    'authenticated não assume item');
end $$;

rollback;
