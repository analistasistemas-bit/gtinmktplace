\set ON_ERROR_STOP on
-- ADR-0201 (Galeria da cor), Task 8: consultas do despachante, manutenção da aplicação, recorte já gerado e paridade
-- do idDerivado. Rodar:
--   python3 scripts/teste-sql-desfeito.py scripts/sql/teste-galeria-despacho.sql \
--     supabase/migrations/20261109093335_galeria_da_cor.sql supabase/migrations/20261110171517_galeria_despacho.sql
-- Sem a 2ª migration tem de FALHAR (prova de vermelho). Fixtures só numa org de teste; tudo some no rollback.
-- now() é fixo na transação: "há 1 min" etc. são colunas retrodatadas.
begin;
set local lock_timeout = '5s';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97800000-0000-0000-0000-000000000001', 'Galeria despacho', 'galeria-despacho-teste', array['imagem_ia'], true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('97800000-0000-0000-0000-000000000101', 'galeria-despacho@teste.local', '{"org_id":"97800000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('97800000-0000-0000-0000-000000000101', '97800000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;

create or replace function pg_temp.afirmar(c boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FALHA: %', msg; end if; end $$;

do $$
declare
  o constant uuid := '97800000-0000-0000-0000-000000000001';
  u constant uuid := '97800000-0000-0000-0000-000000000101';
  v_lote uuid; v_fam uuid; v_an uuid; v_rot uuid; v_ped uuid := gen_random_uuid();
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_f uuid; v_g uuid;
  v_n integer; r_total integer; v_txt text; r record;
begin
  insert into public.lotes (user_id, org_id, status, origem) values (u, o, 'concluido', 'manual') returning id into v_lote;
  insert into public.familias (lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, status)
  values (v_lote, u, o, '97800001', '97800001', 'CREATE', 'nacional', gen_random_uuid(), 'publicado') returning id into v_fam;
  insert into public.anuncios_externos (user_id, org_id, canal, codigo_pai, particao, status)
  values (u, o, 'mercado_livre', '97800001', 0, 'publicado') returning id into v_an;
  insert into public.galeria_roteiros (org_id, anuncio_externo_id, familia_id, versao, conteudo, fatos_hash, moda, status)
  values (o, v_an, v_fam, 1, '{}'::jsonb, 'h1', false, 'aprovado') returning id into v_rot;

  -- 1. Paridade do idDerivado (valores do TS / Python uuid5) e recorte que já nasce gerado.
  perform pg_temp.afirmar(extensions.uuid_generate_v5('6f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6'::uuid, 'Preto:7:2')
    = 'a52a863a-eb2d-5c88-b0ed-20aec77a86db'::uuid, 'uuid v5 diverge do idDerivado');
  for r in select * from public.galeria_reservar_pedido(jsonb_build_object('id', '6f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6',
      'org_id', o, 'anuncio_externo_id', v_an, 'familia_id', v_fam, 'roteiro_id', v_rot, 'unit_cents', 50, 'terms_id', null,
      'elegivel', false, 'itens', jsonb_build_array(jsonb_build_object('cor', 'Rosa Bebê', 'missao', 1),
        jsonb_build_object('cor', 'Rosa Bebê', 'missao', 7, 'origem', 'recorte')))) loop
    if r.missao = 1 then
      perform pg_temp.afirmar(r.request_id = 'c4c5cdaa-477b-5040-addd-25d301820034'::uuid, 'request_id da RPC ≠ idDerivado');
      perform pg_temp.afirmar(r.status = 'pendente' and r.alertas is null, 'gerador nasce pendente');
    else
      perform pg_temp.afirmar(r.status = 'gerada' and r.alertas = '[]'::jsonb and r.cena_path is null, 'recorte nasce gerada com alertas []');
    end if;
  end loop;
  perform pg_temp.afirmar((select count(*) from public.galeria_trabalho_pendente(50) t where t.origem = 'recorte') = 0,
    'recorte nunca vai ao worker');
  delete from public.galeria_imagens g where g.org_id = o;

  -- 2. Imagens: 200 gerada (alertas preenchido) + 1 gerando com lease nulo + pendentes com lease vencido/vigente.
  insert into public.galeria_imagens (org_id, anuncio_externo_id, familia_id, pedido_id, roteiro_id, cor, missao, geracao,
    request_id, status, cena_path, alertas)
  select o, v_an, v_fam, '6f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6', v_rot, 'C' || n, 1, 1, gen_random_uuid(), 'gerada', 'x.jpg', '[]'::jsonb
    from generate_series(1, 200) n;
  insert into public.galeria_imagens (org_id, anuncio_externo_id, familia_id, pedido_id, roteiro_id, cor, missao, geracao,
    request_id, status, provedor, lease_ate) values
    (o, v_an, v_fam, '6f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6', v_rot, 'Hx', 1, 1, gen_random_uuid(), 'gerando', 'higgsfield', null),
    (o, v_an, v_fam, '6f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6', v_rot, 'Pv', 1, 1, gen_random_uuid(), 'pendente', 'openrouter', now() - interval '1 minute'),
    (o, v_an, v_fam, '6f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6', v_rot, 'Pa', 1, 1, gen_random_uuid(), 'submetendo', 'openrouter', now() + interval '1 minute'),
    (o, null, v_fam, '6f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6', v_rot, 'Hist', 1, 1, gen_random_uuid(), 'pendente', 'openrouter', null);
  select string_agg(t.cor, ',' order by t.cor) into v_txt from public.galeria_trabalho_pendente(50) t;
  perform pg_temp.afirmar(v_txt = 'Hx,Pv', 'trabalho_pendente: só gerando sem lease e pendente com lease vencido; veio ' || coalesce(v_txt, '∅'));
  perform pg_temp.afirmar((select count(*) from public.galeria_visao_pendente(20)) = 0, 'gerada com alertas não volta à visão');

  -- 60 gerada com alertas nulo: a visão tem cota própria e a gerando continua saindo.
  insert into public.galeria_imagens (org_id, anuncio_externo_id, familia_id, pedido_id, roteiro_id, cor, missao, geracao,
    request_id, status, cena_path, alertas)
  select o, v_an, v_fam, '6f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6', v_rot, 'V' || n, 2, 1, gen_random_uuid(),
         case when n % 2 = 0 then 'gerada' else 'descartada' end, 'x.jpg', null
    from generate_series(1, 60) n;
  perform pg_temp.afirmar((select count(*) from public.galeria_visao_pendente(20)) = 20, 'visão limitada a 20');
  perform pg_temp.afirmar(exists (select 1 from public.galeria_trabalho_pendente(50) t where t.cor = 'Hx'), 'gerando sai com 60 na visão');

  -- 3. Aplicações.
  -- a: em_andamento, prazo +30: itens publicado há 1 min (não), há 4 min (sim), nulo (sim), lease vigente (não), aplicado (não).
  insert into public.galeria_aplicacoes (org_id, anuncio_externo_id, familia_id, cor, modo, manifesto, roteiro_id, fatos_hash,
    status, prazo_ate, ciclo_ate) values (o, v_an, v_fam, 'Rosa', 'substituir', '[]', v_rot, 'h1', 'em_andamento',
    now() + interval '30 minutes', now() + interval '3 hours') returning id into v_a;
  insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id, status, publicado_em, lease_ate) values
    (o, v_an, v_a, 'A1', 'pendente', now() - interval '1 minute', null),
    (o, v_an, v_a, 'A4', 'subindo', now() - interval '4 minutes', null),
    (o, v_an, v_a, 'AN', 'aplicando', null, null),
    (o, v_an, v_a, 'AL', 'pendente', null, now() + interval '1 minute'),
    (o, v_an, v_a, 'AP', 'aplicado', null, null);
  -- b: preparada (nunca); c: abortando com prazo vencido há 20 min e item compensando (cabeça); d: ciclo vencido (nunca).
  insert into public.galeria_aplicacoes (org_id, anuncio_externo_id, familia_id, cor, modo, manifesto, roteiro_id, fatos_hash, status)
  values (o, v_an, v_fam, 'Azul', 'substituir', '[]', v_rot, 'h1', 'preparada') returning id into v_b;
  insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id) values (o, v_an, v_b, 'B1');
  insert into public.galeria_aplicacoes (org_id, anuncio_externo_id, familia_id, cor, modo, manifesto, roteiro_id, fatos_hash,
    status, prazo_ate, ciclo_ate) values (o, v_an, v_fam, 'Verde', 'substituir', '[]', v_rot, 'h1', 'abortando',
    now() - interval '20 minutes', now() + interval '2 hours') returning id into v_c;
  insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id, status) values (o, v_an, v_c, 'C1', 'compensando');
  insert into public.galeria_aplicacoes (org_id, anuncio_externo_id, familia_id, cor, modo, manifesto, roteiro_id, fatos_hash,
    status, prazo_ate, ciclo_ate) values (o, v_an, v_fam, 'Roxo', 'substituir', '[]', v_rot, 'h1', 'em_andamento',
    now() + interval '10 minutes', now() - interval '1 minute') returning id into v_d;
  insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id) values (o, v_an, v_d, 'D1');

  select string_agg(t.tipo || ':' || coalesce(i.item_id, t.aplicacao_status), ',' order by t.prazo_ate nulls last, i.item_id) into v_txt
    from public.galeria_trabalho_pendente_aplicacao(20) t left join public.galeria_aplicacao_itens i on i.id = t.id;
  perform pg_temp.afirmar(v_txt = 'item:C1,item:A4,item:AN', 'pendente_aplicacao (itens): veio ' || coalesce(v_txt, '∅'));
  select t.tipo || ':' || i.item_id into v_txt from public.galeria_trabalho_pendente_aplicacao(20) t
    join public.galeria_aplicacao_itens i on i.id = t.id limit 1;
  perform pg_temp.afirmar(v_txt = 'item:C1', 'cabeça por prazo_ate: compensação atrasada primeiro; veio ' || coalesce(v_txt, '∅'));
  perform pg_temp.afirmar((select t.user_id from public.galeria_trabalho_pendente_aplicacao(20) t limit 1) = u, 'user_id do dono da família');
  perform pg_temp.afirmar((select count(*) from public.galeria_trabalho_pendente_aplicacao(1)) = 1, 'limite respeitado');

  -- 4. Rede de segurança e prazo: e = em_andamento com todos aplicados (+ trava galeria); f = em_andamento com prazo
  -- vencido (aplicado + pendente livre); g = revertendo com tudo compensado.
  insert into public.galeria_aplicacoes (org_id, anuncio_externo_id, familia_id, cor, modo, manifesto, roteiro_id, fatos_hash,
    status, prazo_ate, ciclo_ate) values (o, v_an, v_fam, 'E', 'substituir', '[]', v_rot, 'h1', 'em_andamento',
    now() + interval '40 minutes', now() + interval '3 hours') returning id into v_e;
  insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id, status) values (o, v_an, v_e, 'E1', 'aplicado');
  insert into public.ml_item_travas (org_id, item_id, dono_tipo, dono_id, expira_em) values (o, 'E1', 'galeria', v_e, null);
  insert into public.galeria_aplicacoes (org_id, anuncio_externo_id, familia_id, cor, modo, manifesto, roteiro_id, fatos_hash,
    status, prazo_ate, ciclo_ate) values (o, v_an, v_fam, 'F', 'substituir', '[]', v_rot, 'h1', 'em_andamento',
    now() - interval '1 minute', now() + interval '3 hours') returning id into v_f;
  insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id, status) values
    (o, v_an, v_f, 'F1', 'aplicado'), (o, v_an, v_f, 'F2', 'pendente');
  insert into public.galeria_aplicacoes (org_id, anuncio_externo_id, familia_id, cor, modo, manifesto, roteiro_id, fatos_hash,
    status, prazo_ate, ciclo_ate) values (o, v_an, v_fam, 'G', 'substituir', '[]', v_rot, 'h1', 'revertendo',
    null, now() + interval '3 hours') returning id into v_g;
  insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id, status) values (o, v_an, v_g, 'G1', 'compensado');

  select count(*) into v_n from public.galeria_trabalho_pendente_aplicacao(50) t
   where t.tipo = 'aplicacao' and t.id in (v_e, v_f, v_g);
  perform pg_temp.afirmar(v_n = 3, 'aplicações com ação (agregar/abortar) devolvidas: ' || v_n);
  perform pg_temp.afirmar(not exists (select 1 from public.galeria_trabalho_pendente_aplicacao(50) t where t.id in (v_a, v_b, v_d) and t.tipo = 'aplicacao'),
    'aplicação sem ação, preparada ou fora do ciclo não vem');

  perform pg_temp.afirmar(public.galeria_manter_aplicacao(v_e) = 'aplicada', 'todos aplicados → aplicada');
  perform pg_temp.afirmar(not exists (select 1 from public.ml_item_travas t where t.dono_id = v_e), 'travas da aplicada soltas');
  perform pg_temp.afirmar(public.galeria_manter_aplicacao(v_f) = 'abortando', 'prazo vencido → abortando');
  perform pg_temp.afirmar((select abortar_em is not null from public.galeria_aplicacoes where id = v_f), 'abortar_em gravado');
  perform pg_temp.afirmar((select string_agg(item_id || '=' || status, ',' order by item_id) from public.galeria_aplicacao_itens
    where aplicacao_id = v_f) = 'F1=compensando,F2=pulado', 'aplicado → compensando, pendente → pulado');
  perform pg_temp.afirmar((select compensar_ate > now() from public.galeria_aplicacao_itens where aplicacao_id = v_f and item_id = 'F1'),
    'compensar_ate gravado');
  perform pg_temp.afirmar(public.galeria_manter_aplicacao(v_g) = 'revertida', 'revertendo com tudo compensado → revertida');
  perform pg_temp.afirmar(public.galeria_manter_aplicacao(v_b) = 'preparada', 'preparada nunca é mexida');
  perform pg_temp.afirmar((select status from public.galeria_aplicacao_itens where aplicacao_id = v_b) = 'pendente', 'item da preparada intacto');

  -- 4b. Cota cheia (fix round 1): 7 sagas vencidas com 3 itens cada, mesmo prazo, + 1 saga com tudo aplicado e trava
  -- galeria (queda antes da agregação). As ações saem antes dos itens; manter encerra a última e solta a trava.
  update public.galeria_aplicacoes set status = 'aplicada' where org_id = o and status in ('em_andamento', 'abortando', 'revertendo');
  for v_n in 1..7 loop
    insert into public.galeria_aplicacoes (org_id, anuncio_externo_id, familia_id, cor, modo, manifesto, roteiro_id, fatos_hash,
      status, prazo_ate, ciclo_ate) values (o, v_an, v_fam, 'S' || v_n, 'substituir', '[]', v_rot, 'h1', 'em_andamento',
      now() - interval '5 minutes', now() + interval '3 hours') returning id into v_a;
    insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id, status)
    select o, v_an, v_a, 'S' || v_n || '-' || k, 'subindo' from generate_series(1, 3) k;
  end loop;
  insert into public.galeria_aplicacoes (org_id, anuncio_externo_id, familia_id, cor, modo, manifesto, roteiro_id, fatos_hash,
    status, prazo_ate, ciclo_ate) values (o, v_an, v_fam, 'Fim', 'substituir', '[]', v_rot, 'h1', 'em_andamento',
    now() + interval '5 minutes', now() + interval '3 hours') returning id into v_e;
  insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id, status) values (o, v_an, v_e, 'FIM1', 'aplicado');
  insert into public.ml_item_travas (org_id, item_id, dono_tipo, dono_id, expira_em) values (o, 'FIM1', 'galeria', v_e, null);
  select count(*) filter (where t.tipo = 'aplicacao'), count(*) into v_n, r_total from public.galeria_trabalho_pendente_aplicacao(20) t;
  perform pg_temp.afirmar(v_n = 8 and r_total = 20, 'cota 20: 8 ações antes dos itens; vieram ' || v_n || ' de ' || r_total);
  perform public.galeria_manter_aplicacao(t.id) from public.galeria_trabalho_pendente_aplicacao(20) t where t.tipo = 'aplicacao';
  perform pg_temp.afirmar((select status from public.galeria_aplicacoes where id = v_e) = 'aplicada', 'saga com tudo aplicado encerrada');
  perform pg_temp.afirmar(not exists (select 1 from public.ml_item_travas t where t.dono_id = v_e), 'trava da saga encerrada solta');
  perform pg_temp.afirmar((select count(*) from public.galeria_aplicacoes where org_id = o and cor like 'S%' and status = 'falhou' and abortar_em is not null) = 7,
    'as 7 sagas vencidas abortadas (itens sem PUT → pulado → falhou)');

  -- 5. Escritas adiadas: vencida e livre (sim), assumida (não), futura (não).
  insert into public.ml_escritas_adiadas (org_id, familia_id, lote_id, endpoint, itens, job, proxima_em, assumida_ate) values
    (o, v_fam, v_lote, 'update-familia-ml', array['X1'], '{}'::jsonb, now() - interval '1 minute', null),
    (o, v_fam, v_lote, 'publicar-split-ml', array['X2'], '{}'::jsonb, now() - interval '1 minute', now() + interval '5 minutes'),
    (o, gen_random_uuid(), v_lote, 'update-familia-ml', array['X3'], '{}'::jsonb, now() + interval '1 minute', null);
  select string_agg(e.endpoint, ',') into v_txt from public.galeria_escritas_adiadas_pendentes(20) e where e.org_id = o;
  perform pg_temp.afirmar(v_txt = 'update-familia-ml', 'escritas adiadas pendentes: veio ' || coalesce(v_txt, '∅'));

  -- 6. Privilégios: só service_role.
  perform pg_temp.afirmar(not has_function_privilege('authenticated', 'public.galeria_trabalho_pendente(integer)', 'execute'), 'authenticated não executa');
  perform pg_temp.afirmar(has_function_privilege('service_role', 'public.galeria_manter_aplicacao(uuid)', 'execute'), 'service_role executa');
end $$;

-- Revisão geral (bloqueador 2): `reportar_invalida` (edge galeria-imagens: `falhou` + erro `imagem_invalida`) não
-- devolve a vaga — a geração foi paga ao provedor. 3 reportes → 4ª reserva `teto`; falha técnica não conta.
do $$
declare
  o constant uuid := '97800000-0000-0000-0000-000000000001';
  u constant uuid := '97800000-0000-0000-0000-000000000101';
  v_lote uuid; v_fam uuid; v_an uuid; v_rot uuid; k int; r record; v_ok boolean;
  pedir constant text := 'select * from public.galeria_reservar_pedido(jsonb_build_object(''id'', gen_random_uuid(),
    ''org_id'', $1, ''anuncio_externo_id'', $2, ''familia_id'', $3, ''roteiro_id'', $4, ''unit_cents'', 50, ''terms_id'', null,
    ''elegivel'', false, ''itens'', jsonb_build_array(jsonb_build_object(''cor'', $5, ''missao'', 2))))';
begin
  insert into public.lotes (user_id, org_id, status, origem) values (u, o, 'concluido', 'manual') returning id into v_lote;
  insert into public.familias (lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, status)
  values (v_lote, u, o, '97800002', '97800002', 'CREATE', 'nacional', gen_random_uuid(), 'publicado') returning id into v_fam;
  insert into public.anuncios_externos (user_id, org_id, canal, codigo_pai, particao, status)
  values (u, o, 'mercado_livre', '97800002', 0, 'publicado') returning id into v_an;
  insert into public.galeria_roteiros (org_id, anuncio_externo_id, familia_id, versao, conteudo, fatos_hash, moda, status)
  values (o, v_an, v_fam, 1, '{}'::jsonb, 'h1', false, 'aprovado') returning id into v_rot;

  -- Falha técnica não gasta vaga: 3 seguidas e a próxima ainda é a geração 1.
  for k in 1..3 loop
    execute pedir into r using o, v_an, v_fam, v_rot, 'Tecnica';
    perform pg_temp.afirmar(r.geracao = 1, 'falha técnica gastou vaga');
    update public.galeria_imagens set status = 'falhou', erro = 'provedor_falhou' where id = r.id;
  end loop;

  -- 3 reportadas inválidas → a 4ª é recusada `teto`; numeração 1, 2, 3.
  for k in 1..3 loop
    execute pedir into r using o, v_an, v_fam, v_rot, 'Invalida';
    perform pg_temp.afirmar(r.geracao = k, format('reportada inválida não ocupou a geração %s', k));
    update public.galeria_imagens set status = 'falhou', erro = 'imagem_invalida' where id = r.id;
  end loop;
  begin
    execute pedir into r using o, v_an, v_fam, v_rot, 'Invalida';
    v_ok := false;
  exception when raise_exception then
    if sqlerrm <> 'teto' then raise; end if;
    v_ok := true;
  end;
  perform pg_temp.afirmar(v_ok, '4ª geração após 3 reportes aceita (vaga devolvida)');
end $$;

rollback;
