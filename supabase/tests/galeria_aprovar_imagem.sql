\set ON_ERROR_STOP on
-- ADR-0201 (Galeria da cor), Task 12: aprovação do arquivo final (uma aprovada por cor, missão e roteiro). Rodar com a
-- cadeia inteira da galeria (nada aplicado em produção até a Task 16):
--   python3 scripts/teste-sql-desfeito.py supabase/tests/galeria_aprovar_imagem.sql \
--     supabase/migrations/20261109093335_galeria_da_cor.sql supabase/migrations/20261109122959_configuracoes_ai_model_galeria.sql \
--     supabase/migrations/20261109144013_galeria_leitura_etiqueta.sql supabase/migrations/20261109153037_galeria_aprovar_roteiro.sql \
--     supabase/migrations/20261110171517_galeria_despacho.sql supabase/migrations/20261110182442_galeria_concluir_geracao.sql \
--     supabase/migrations/20261110214652_galeria_aprovar_imagem.sql
-- Sem a última migration tem de FALHAR (prova de vermelho). Fixtures numa org de teste; tudo some no rollback.
begin;
set local lock_timeout = '5s';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97900000-0000-0000-0000-000000000001', 'Galeria aprovar', 'galeria-aprovar-teste', array['imagem_ia'], true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('97900000-0000-0000-0000-000000000101', 'galeria-aprovar@teste.local', '{"org_id":"97900000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('97900000-0000-0000-0000-000000000101', '97900000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;

-- Simula a corrida do índice único (§6b): só existe nesta transação.
create function public.t12_simula_corrida() returns trigger language plpgsql as $f$
begin if new.status = 'aprovada' then raise unique_violation using message = 'simulada'; end if; return new; end $f$;

create or replace function pg_temp.afirmar(c boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FALHA: %', msg; end if; end $$;

do $$
declare
  o constant uuid := '97900000-0000-0000-0000-000000000001';
  u constant uuid := '97900000-0000-0000-0000-000000000101';
  v_lote uuid; v_fam uuid; v_an uuid; v_an2 uuid; v_rot uuid; v_ped uuid := gen_random_uuid();
  v_g1 uuid; v_g2 uuid; v_rec uuid; v_des uuid; v_pend uuid; v_r text; v_ok boolean;
begin
  insert into public.lotes (user_id, org_id, status, origem) values (u, o, 'concluido', 'manual') returning id into v_lote;
  insert into public.familias (lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, status)
  values (v_lote, u, o, '97900001', '97900001', 'CREATE', 'nacional', gen_random_uuid(), 'publicado') returning id into v_fam;
  insert into public.anuncios_externos (user_id, org_id, canal, codigo_pai, particao, status)
  values (u, o, 'mercado_livre', '97900001', 0, 'publicado') returning id into v_an;
  insert into public.anuncios_externos (user_id, org_id, canal, codigo_pai, particao, status)
  values (u, o, 'mercado_livre', '97900001', 1, 'publicado') returning id into v_an2;
  insert into public.galeria_roteiros (org_id, anuncio_externo_id, familia_id, versao, conteudo, fatos_hash, moda, status)
  values (o, v_an, v_fam, 1, '{}'::jsonb, 'h1', false, 'aprovado') returning id into v_rot;
  insert into public.galeria_pedidos (id, org_id, anuncio_externo_id, familia_id, roteiro_id, itens, unit_cents, elegivel)
  values (v_ped, o, v_an, v_fam, v_rot, '[]'::jsonb, 50, false);

  insert into public.galeria_imagens (org_id, anuncio_externo_id, familia_id, pedido_id, roteiro_id, cor, missao, geracao,
    request_id, origem, status, cena_path, alertas, final_upload_path) values
    (o, v_an, v_fam, v_ped, v_rot, 'Rosa', 1, 1, gen_random_uuid(), 'gerador', 'gerada', 'c1.jpg', '[]'::jsonb, 'f/g1-a.jpg')
    returning id into v_g1;
  insert into public.galeria_imagens (org_id, anuncio_externo_id, familia_id, pedido_id, roteiro_id, cor, missao, geracao,
    request_id, origem, status, cena_path, alertas, final_upload_path) values
    (o, v_an, v_fam, v_ped, v_rot, 'Rosa', 1, 2, gen_random_uuid(), 'gerador', 'gerada', 'c2.jpg', '[]'::jsonb, 'f/g2-a.jpg')
    returning id into v_g2;
  insert into public.galeria_imagens (org_id, anuncio_externo_id, familia_id, pedido_id, roteiro_id, cor, missao, geracao,
    request_id, origem, status, alertas, final_upload_path) values
    (o, v_an, v_fam, v_ped, v_rot, 'Rosa', 7, 1, gen_random_uuid(), 'recorte', 'gerada', '[]'::jsonb, 'f/rec-a.jpg')
    returning id into v_rec;
  insert into public.galeria_imagens (org_id, anuncio_externo_id, familia_id, pedido_id, roteiro_id, cor, missao, geracao,
    request_id, origem, status, cena_path, alertas, final_upload_path) values
    (o, v_an, v_fam, v_ped, v_rot, 'Rosa', 2, 1, gen_random_uuid(), 'gerador', 'desatualizada', 'c3.jpg', '[]'::jsonb, 'f/d-a.jpg')
    returning id into v_des;
  insert into public.galeria_imagens (org_id, anuncio_externo_id, familia_id, pedido_id, roteiro_id, cor, missao, geracao,
    request_id, origem, status, cena_path, alertas, final_upload_path) values
    (o, v_an, v_fam, v_ped, v_rot, 'Rosa', 3, 1, gen_random_uuid(), 'gerador', 'gerada', 'c4.jpg', null, 'f/p-a.jpg')
    returning id into v_pend;

  -- 1. Índice único parcial existe e barra duas aprovadas na mesma (cor, missão, roteiro).
  perform pg_temp.afirmar(exists (select 1 from pg_indexes where indexname = 'galeria_imagens_uma_aprovada_uidx'), 'índice uma_aprovada');
  begin
    update public.galeria_imagens set status = 'aprovada' where id in (v_g1, v_g2);
    v_ok := false;
  exception when unique_violation then v_ok := true;
  end;
  perform pg_temp.afirmar(v_ok, 'duas aprovadas da mesma (cor, missão, roteiro) estouram o índice');

  -- 2. Recusas sem efeito.
  perform pg_temp.afirmar(public.galeria_aprovar_imagem(o, v_an, v_des, 'f/d-a.jpg', 's', u) = 'desatualizada', 'desatualizada recusa');
  perform pg_temp.afirmar(public.galeria_aprovar_imagem(o, v_an, v_pend, 'f/p-a.jpg', 's', u) = 'verificacao_pendente', 'alertas nulo recusa');
  perform pg_temp.afirmar(public.galeria_aprovar_imagem(o, v_an, v_g1, 'f/g1-OUTRO.jpg', 's', u) = 'upload_trocado', 'caminho trocado recusa');
  perform pg_temp.afirmar(public.galeria_aprovar_imagem(o, v_an2, v_g1, 'f/g1-a.jpg', 's', u) = 'nao_encontrada', 'outra partição não alcança');
  perform pg_temp.afirmar(public.galeria_aprovar_imagem(gen_random_uuid(), v_an, v_g1, 'f/g1-a.jpg', 's', u) = 'nao_encontrada', 'outra org não alcança');
  perform pg_temp.afirmar((select count(*) from public.galeria_imagens where org_id = o and status = 'aprovada') = 0, 'recusas não gravam');

  -- 3. Aprovar grava final_path, sha, aprovado_em e aprovado_por; repetição idempotente.
  perform pg_temp.afirmar(public.galeria_aprovar_imagem(o, v_an, v_g1, 'f/g1-a.jpg', 'sha1', u) = 'ok', 'aprova g1');
  perform pg_temp.afirmar((select status = 'aprovada' and final_path = 'f/g1-a.jpg' and final_sha256 = 'sha1'
    and aprovado_em is not null and aprovado_por = u from public.galeria_imagens where id = v_g1), 'g1 gravada');
  perform pg_temp.afirmar(public.galeria_aprovar_imagem(o, v_an, v_g1, 'f/g1-a.jpg', 'sha1', u) = 'ok', 'repetição ok');
  perform pg_temp.afirmar(public.galeria_aprovar_imagem(o, v_an, v_g1, 'f/g1-b.jpg', 'sha9', u) = 'nao_aprovavel', 'aprovada com outro arquivo');

  -- 4. Geração 2 da missão 1 com a 1 aprovada → só a 2 fica aprovada; o "manifesto" (aprovadas da cor) tem uma capa.
  perform pg_temp.afirmar(public.galeria_aprovar_imagem(o, v_an, v_g2, 'f/g2-a.jpg', 'sha2', u) = 'ok', 'aprova g2');
  perform pg_temp.afirmar((select status from public.galeria_imagens where id = v_g1) = 'gerada', 'g1 volta a gerada');
  perform pg_temp.afirmar((select final_sha256 from public.galeria_imagens where id = v_g1) = 'sha1', 'g1 mantém o arquivo');
  perform pg_temp.afirmar((select count(*) from public.galeria_imagens where org_id = o and roteiro_id = v_rot and cor = 'Rosa'
    and missao = 1 and status = 'aprovada') = 1, 'uma capa aprovada');

  -- 5. Recorte (alertas []) aprova sem verificação por visão.
  perform pg_temp.afirmar(public.galeria_aprovar_imagem(o, v_an, v_rec, 'f/rec-a.jpg', 'sha3', u) = 'ok', 'recorte aprova');

  -- 6. Roteiro que deixou de ser o aprovado → desatualizada.
  update public.galeria_imagens set status = 'gerada' where id = v_g2;
  update public.galeria_roteiros set status = 'desatualizado' where id = v_rot;
  perform pg_temp.afirmar(public.galeria_aprovar_imagem(o, v_an, v_g2, 'f/g2-a.jpg', 'sha2', u) = 'desatualizada', 'roteiro vencido');

  -- 6b. Corrida: o índice único estoura (aprovação simultânea da mesma cor/missão) → código, sem exceção nem efeito.
  update public.galeria_roteiros set status = 'aprovado' where id = v_rot;
  execute 'create trigger t12_simula_corrida before update on public.galeria_imagens for each row execute function public.t12_simula_corrida()';
  perform pg_temp.afirmar(public.galeria_aprovar_imagem(o, v_an, v_g2, 'f/g2-a.jpg', 'sha2', u) = 'aprovacao_concorrente', 'corrida vira código');
  perform pg_temp.afirmar((select status from public.galeria_imagens where id = v_g2) = 'gerada', 'corrida não grava');
  execute 'drop trigger t12_simula_corrida on public.galeria_imagens';

  -- 7. Privilégios.
  perform pg_temp.afirmar(not has_function_privilege('authenticated',
    'public.galeria_aprovar_imagem(uuid, uuid, uuid, text, text, uuid)', 'execute'), 'authenticated não executa');
  perform pg_temp.afirmar(not has_function_privilege('anon',
    'public.galeria_aprovar_imagem(uuid, uuid, uuid, text, text, uuid)', 'execute'), 'anon não executa');
  perform pg_temp.afirmar(has_function_privilege('service_role',
    'public.galeria_aprovar_imagem(uuid, uuid, uuid, text, text, uuid)', 'execute'), 'service_role executa');
end $$;

rollback;
