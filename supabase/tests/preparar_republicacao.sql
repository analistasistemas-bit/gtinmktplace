\set ON_ERROR_STOP on
-- ADR-0185 D-2: preparar_republicacao. Rodar com scripts/teste-sql-desfeito.py (transação desfeita).
begin;
insert into public.organizations (id, nome, slug) values
  ('93000000-0000-0000-0000-000000000001', 'Republicar test', 'republicar-test');
insert into auth.users (id, email, raw_user_meta_data) values
  ('93000000-0000-0000-0000-000000000101', 'republicar@test.local',
   '{"org_id":"93000000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('93000000-0000-0000-0000-000000000201', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 'concluido', 'manual'),
  ('93000000-0000-0000-0000-000000000202', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 'concluido', 'manual'),
  ('93000000-0000-0000-0000-000000000203', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 'concluido', 'manual');

-- Produto 09300100: A (lote 1, publicada, mais antiga), B (lote 2, publicada), C (lote 3, UPDATE
-- ainda não publicado: herda ml_item_id sem publicado_em, a mais nova).
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, ml_item_id, ml_permalink, publicado_em, status, criado_em, capa_ml_picture_id)
values
  ('93000000-0000-0000-0000-000000000301', '93000000-0000-0000-0000-000000000201', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001',
   '09300100', 'Produto A', 'CREATE', 'nacional', gen_random_uuid(), 'MLB-REP-1', 'http://x', now() - interval '3 day', 'publicado', now() - interval '3 day', 'pic'),
  ('93000000-0000-0000-0000-000000000302', '93000000-0000-0000-0000-000000000202', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001',
   '09300100', 'Produto B', 'UPDATE', 'nacional', gen_random_uuid(), 'MLB-REP-1', 'http://x', now() - interval '2 day', 'publicado', now() - interval '2 day', 'pic'),
  ('93000000-0000-0000-0000-000000000303', '93000000-0000-0000-0000-000000000203', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001',
   '09300100', 'Produto C', 'UPDATE', 'nacional', gen_random_uuid(), 'MLB-REP-1', 'http://x', null, 'pronto', now() - interval '1 day', 'pic');
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, preco, estoque, ml_variation_id, preco_publicado_ml, ml_picture_id)
values ('93000000-0000-0000-0000-000000000303', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001',
        '09300101', 'Azul', 'Azul', 50, 3, '123', 49.9, 'pic-v'),
       -- UPDATE parcial: o SKU Rosa só existe nas cópias anteriores (A com estoque 0 — CREATE manual nasce zerado —, B com estoque 9; B é a mais nova).
       ('93000000-0000-0000-0000-000000000301', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001',
        '09300102', 'Rosa', 'Rosa', 50, 0, '456', 49.9, 'pic-r'),
       ('93000000-0000-0000-0000-000000000302', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001',
        '09300102', 'Rosa', 'Rosa', 55, 9, '456', 54.9, 'pic-r'),
       -- Azul também na cópia antiga: a vigente já tem → não duplica.
       ('93000000-0000-0000-0000-000000000302', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001',
        '09300101', 'Azul', 'Azul', 50, 1, '123', 49.9, 'pic-v');
insert into public.anuncios_externos (user_id, org_id, canal, codigo_pai, item_externo_id)
values ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 'mercado_livre', '09300100', 'MLB-REP-1');

do $$
declare r record;
begin
  -- A operação pede pela família da LINHA (a mais antiga); a vigente é a cópia mais nova (C).
  select * into r from public.preparar_republicacao('93000000-0000-0000-0000-000000000001', 'mercado_livre', '09300100', '93000000-0000-0000-0000-000000000301');
  if r.familia_id <> '93000000-0000-0000-0000-000000000303' then raise exception 'vigente errada: %', r.familia_id; end if;
  if r.lote_id <> '93000000-0000-0000-0000-000000000203' then raise exception 'lote errado: %', r.lote_id; end if;
  if not (r.lotes_afetados @> array['93000000-0000-0000-0000-000000000201','93000000-0000-0000-0000-000000000202']::uuid[]
          and cardinality(r.lotes_afetados) = 2) then raise exception 'lotes afetados: %', r.lotes_afetados; end if;

  if exists (select 1 from public.familias where codigo_pai = '09300100' and org_id = '93000000-0000-0000-0000-000000000001' and id <> '93000000-0000-0000-0000-000000000303')
    then raise exception 'cópias antigas não foram apagadas'; end if;
  if not exists (select 1 from public.familias where id = '93000000-0000-0000-0000-000000000303'
                 and ml_item_id is null and ml_permalink is null and publicado_em is null and capa_ml_picture_id is null
                 and operacao = 'CREATE' and status = 'pronto')
    then raise exception 'vigente não preparada'; end if;
  if exists (select 1 from public.variacoes where familia_id = '93000000-0000-0000-0000-000000000303'
             and (ml_variation_id is not null or preco_publicado_ml is not null or ml_picture_id is not null))
    then raise exception 'variações com vínculo'; end if;
  -- SKU só das cópias anteriores foi para a vigente (a linha mais nova: B, estoque 9), sem duplicar o Azul.
  if (select count(*) from public.variacoes where familia_id = '93000000-0000-0000-0000-000000000303') <> 2
    then raise exception 'vigente deveria ter 2 SKUs'; end if;
  if not exists (select 1 from public.variacoes where familia_id = '93000000-0000-0000-0000-000000000303'
                 and codigo = '09300102' and estoque = 9 and preco = 55 and ml_variation_id is null)
    then raise exception 'SKU Rosa não incorporado (ou não pela cópia mais nova)'; end if;
  if exists (select 1 from public.anuncios_externos where codigo_pai = '09300100' and org_id = '93000000-0000-0000-0000-000000000001')
    then raise exception 'anuncios_externos não apagado'; end if;
  if (select status from public.lotes where id = '93000000-0000-0000-0000-000000000203') <> 'revisao'
    then raise exception 'lote não voltou à revisão'; end if;

  -- 2ª chamada (repetida ou concorrente): nada a preparar, nunca um 2º CREATE.
  begin
    perform public.preparar_republicacao('93000000-0000-0000-0000-000000000001', 'mercado_livre', '09300100', '93000000-0000-0000-0000-000000000301');
    raise exception 'segunda chamada deveria recusar';
  exception when others then
    if sqlerrm <> 'republicar:nao_publicada' then raise; end if;
  end;
end $$;

-- Vigente em processamento → recusa (transitório), nada muda.
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, ml_item_id, status)
values ('93000000-0000-0000-0000-000000000304', '93000000-0000-0000-0000-000000000201', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001',
        '09300200', 'Produto D', 'UPDATE', 'nacional', gen_random_uuid(), 'MLB-REP-2', 'processando');
do $$
begin
  begin
    perform public.preparar_republicacao('93000000-0000-0000-0000-000000000001', 'mercado_livre', '09300200', '93000000-0000-0000-0000-000000000304');
    raise exception 'deveria recusar em_processamento';
  exception when others then
    if sqlerrm <> 'republicar:em_processamento' then raise; end if;
  end;
  if not exists (select 1 from public.familias where id = '93000000-0000-0000-0000-000000000304' and ml_item_id = 'MLB-REP-2')
    then raise exception 'recusa alterou a família'; end if;
end $$;

-- UP com saga interrompida: sem ml_item_id, mas a raiz existe → preserva a pedida. Status erro é mantido.
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, status, erro_mensagem)
values ('93000000-0000-0000-0000-000000000305', '93000000-0000-0000-0000-000000000202', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001',
        '09300300', 'Produto E', 'CREATE', 'nacional', gen_random_uuid(), 'erro', 'saga parou');
insert into public.anuncios_externos (user_id, org_id, canal, codigo_pai)
values ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 'mercado_livre', '09300300');
do $$
declare r record;
begin
  select * into r from public.preparar_republicacao('93000000-0000-0000-0000-000000000001', 'mercado_livre', '09300300', '93000000-0000-0000-0000-000000000305');
  if r.familia_id <> '93000000-0000-0000-0000-000000000305' then raise exception 'fallback errado'; end if;
  if not exists (select 1 from public.familias where id = '93000000-0000-0000-0000-000000000305' and status = 'erro' and erro_mensagem = 'saga parou' and operacao = 'CREATE')
    then raise exception 'status erro não preservado'; end if;
end $$;

-- Só service_role executa.
do $$
begin
  if has_function_privilege('authenticated', 'public.preparar_republicacao(uuid, text, text, uuid)', 'execute')
    then raise exception 'authenticated não pode executar'; end if;
end $$;
rollback;
