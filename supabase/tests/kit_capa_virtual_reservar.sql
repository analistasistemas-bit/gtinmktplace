\set ON_ERROR_STOP on
-- ADR-0206 (migration kit_virtual_capa_ia): capa IA do Kit Virtual em kit_variacao_imagens (coluna `composicao` +
-- `pedido`, check de tipo estrito) e teto atômico de 6 tentativas por (org, composição) em 24 h.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/kit_capa_virtual_reservar.sql \
--          supabase/migrations/20261115211040_kit_virtual_capa_ia.sql
-- Concorrência: a garantia vem do pg_advisory_xact_lock sobre (org, composição) tomado antes da contagem. Sem Docker
-- local não há teste de duas sessões (mesmo limite do ADR-0205); o item (h) prova que o lock da chave certa é tomado.
-- Só toca dados do próprio fixture; tudo some no rollback.
begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('98060000-0000-0000-0000-000000000001', 'Capa virtual reservar', 'capa-virtual-reservar-teste', array['imagem_ia'], true);

create or replace function pg_temp.afirmar(c boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FALHA: %', msg; end if; end $$;

-- security invoker (sem elevação), e as reservas rodam COMO service_role (o papel da edge).
select pg_temp.afirmar(not prosecdef, 'RPC é security definer')
  from pg_proc where oid = 'public.kit_capa_virtual_reservar(uuid, uuid, smallint, text, jsonb, text, uuid)'::regprocedure;
set local role service_role;

do $$
declare
  o uuid := '98060000-0000-0000-0000-000000000001';
  base uuid := '98060000-0000-0000-0000-0000000000b1';
  comp text := '98060000-aaaa-0000-0000-000000000001|98060000-aaaa-0000-0000-000000000002';
  outra text := '98060000-aaaa-0000-0000-000000000001|98060000-aaaa-0000-0000-000000000003';
  ped jsonb := '[{"user_product_id":"98060000-aaaa-0000-0000-000000000002","quantidade":2},
                 {"user_product_id":"98060000-aaaa-0000-0000-000000000001","quantidade":1}]';
  m text := 'google/gemini-nano-banana-2.1';
  r uuid;
  res text;
  recusou boolean;
begin
  -- Ruído que NÃO conta: outra composição, mais de 24 h, linha de unidades da mesma org.
  insert into public.kit_variacao_imagens (org_id, request_id, status, composicao, pedido, modelo, custo_usd, criado_em) values
    (o, gen_random_uuid(), 'recusada', outra, ped, m, 0.05, now()),
    (o, gen_random_uuid(), 'recusada', comp, ped, m, 0.05, now() - interval '25 hours'),
    (o, gen_random_uuid(), 'recusada', comp, ped, m, 0.05, now() - interval '25 hours');
  insert into public.kit_variacao_imagens (org_id, request_id, status, familia_base_id, n, modelo, custo_usd) values
    (o, gen_random_uuid(), 'recusada', base, 2, m, 0.05);

  -- (a) 1ª reserva: ok, linha pendente de composição com os campos da edge.
  r := gen_random_uuid();
  res := public.kit_capa_virtual_reservar(o, r, 1::smallint, comp, ped, m, null);
  perform pg_temp.afirmar(res = 'ok', '1ª reserva devia ser ok, veio ' || coalesce(res, 'null'));
  perform pg_temp.afirmar(exists (select 1 from public.kit_variacao_imagens where org_id = o and request_id = r
      and tentativa = 1 and status = 'pendente' and composicao = comp and pedido = ped and familia_base_id is null
      and n is null and cores is null and rotulo is null and modelo = m), 'reserva gravada com campos errados');
  -- Recusada conta: a 1ª vira recusada (custo), como faz a edge.
  update public.kit_variacao_imagens set status = 'recusada', custo_usd = 0.05 where org_id = o and request_id = r;

  -- 2ª a 6ª: ok (pendentes também contam). A quantidade não entra na chave: muda o pedido, mesma composição.
  for i in 2..6 loop
    res := public.kit_capa_virtual_reservar(o, gen_random_uuid(), 1::smallint, comp,
      jsonb_build_array(jsonb_build_object('user_product_id', 'x', 'quantidade', i)), m, null);
    perform pg_temp.afirmar(res = 'ok', 'reserva ' || i || ' devia ser ok, veio ' || coalesce(res, 'null'));
  end loop;

  -- 7ª: teto, sem inserir.
  r := gen_random_uuid();
  res := public.kit_capa_virtual_reservar(o, r, 1::smallint, comp, ped, m, null);
  perform pg_temp.afirmar(res = 'teto', '7ª reserva devia ser teto, veio ' || coalesce(res, 'null'));
  perform pg_temp.afirmar(not exists (select 1 from public.kit_variacao_imagens where org_id = o and request_id = r),
    'teto inseriu linha');

  -- (b) Outra composição segue livre (1 linha de ruído).
  perform pg_temp.afirmar(public.kit_capa_virtual_reservar(o, gen_random_uuid(), 1::smallint, outra, ped, m, null) = 'ok',
    'outra composição contou no teto');

  -- 23505 preservado: mesma (org, request_id, tentativa) sobe unique_violation.
  r := gen_random_uuid();
  perform public.kit_capa_virtual_reservar(o, r, 1::smallint, 'c23505', ped, m, null);
  begin
    perform public.kit_capa_virtual_reservar(o, r, 1::smallint, 'c23505', ped, m, null);
    recusou := false;
  exception when unique_violation then recusou := true;
  end;
  perform pg_temp.afirmar(recusou, 'reserva repetida não deu 23505');

  -- (c) composição + cores na mesma linha: viola o check de tipo.
  begin
    insert into public.kit_variacao_imagens (org_id, request_id, composicao, pedido, cores, rotulo, modelo)
      values (o, gen_random_uuid(), comp, ped, array['Preto'], 'Preto', m);
    recusou := false;
  exception when check_violation then recusou := true;
  end;
  perform pg_temp.afirmar(recusou, '(c) composição + cores aceita');

  -- (c2) `pedido` em linha de cores e em linha de unidades: viola o check de tipo.
  begin
    insert into public.kit_variacao_imagens (org_id, request_id, familia_base_id, cores, rotulo, pedido, modelo)
      values (o, gen_random_uuid(), base, array['Preto'], 'Preto', ped, m);
    recusou := false;
  exception when check_violation then recusou := true;
  end;
  perform pg_temp.afirmar(recusou, '(c2) linha de cores com pedido aceita');
  begin
    insert into public.kit_variacao_imagens (org_id, request_id, familia_base_id, n, pedido, modelo)
      values (o, gen_random_uuid(), base, 2, ped, m);
    recusou := false;
  exception when check_violation then recusou := true;
  end;
  perform pg_temp.afirmar(recusou, '(c2) linha de unidades com pedido aceita');

  -- (d) Linha de unidades antiga (n=2, base preenchida) e de cores continuam válidas.
  insert into public.kit_variacao_imagens (org_id, request_id, familia_base_id, n, modelo) values (o, gen_random_uuid(), base, 2, m);
  insert into public.kit_variacao_imagens (org_id, request_id, familia_base_id, cores, rotulo, modelo)
    values (o, gen_random_uuid(), base, array['Preto','Branco'], 'Preto e Branco', m);

  -- (e) Composição com familia_base_id nulo é aceita (insert direto).
  insert into public.kit_variacao_imagens (org_id, request_id, composicao, pedido, modelo) values (o, gen_random_uuid(), 'e', ped, m);

  -- (f) Linha de cores sem familia_base_id é recusada pelo check (a coluna agora aceita NULL).
  begin
    insert into public.kit_variacao_imagens (org_id, request_id, cores, rotulo, modelo)
      values (o, gen_random_uuid(), array['Preto'], 'Preto', m);
    recusou := false;
  exception when check_violation then recusou := true;
  end;
  perform pg_temp.afirmar(recusou, '(f) linha de cores sem base aceita');
  -- Composição sem pedido também é recusada.
  begin
    insert into public.kit_variacao_imagens (org_id, request_id, composicao, modelo) values (o, gen_random_uuid(), comp, m);
    recusou := false;
  exception when check_violation then recusou := true;
  end;
  perform pg_temp.afirmar(recusou, 'composição sem pedido aceita');

  -- (g) Cobrança: reservas para levar a gerada / recusada no bloco seguinte (fora do service_role).
  perform pg_temp.afirmar(public.kit_capa_virtual_reservar(o, '98060000-0000-0000-0000-0000000000c1', 1::smallint, 'g', ped, m, null) = 'ok',
    '(g) reserva gerada');
  perform pg_temp.afirmar(public.kit_capa_virtual_reservar(o, '98060000-0000-0000-0000-0000000000c2', 1::smallint, 'g', ped, m, null) = 'ok',
    '(g) reserva recusada');
  update public.kit_variacao_imagens set status = 'gerada', custo_usd = 0.055,
      storage_path = o || '/kit-virtual-ia/98060000-0000-0000-0000-0000000000c1.png'
    where org_id = o and request_id = '98060000-0000-0000-0000-0000000000c1';
  update public.kit_variacao_imagens set status = 'recusada', custo_usd = 0.05
    where org_id = o and request_id = '98060000-0000-0000-0000-0000000000c2';

  -- Só service_role executa.
  perform pg_temp.afirmar(not has_function_privilege('authenticated',
    'public.kit_capa_virtual_reservar(uuid, uuid, smallint, text, jsonb, text, uuid)', 'execute'), 'authenticated executa');
  perform pg_temp.afirmar(not has_function_privilege('anon',
    'public.kit_capa_virtual_reservar(uuid, uuid, smallint, text, jsonb, text, uuid)', 'execute'), 'anon executa');
  perform pg_temp.afirmar(has_function_privilege('service_role',
    'public.kit_capa_virtual_reservar(uuid, uuid, smallint, text, jsonb, text, uuid)', 'execute'), 'service_role não executa');
end $$;

reset role;

do $$
declare
  o uuid := '98060000-0000-0000-0000-000000000001';
  comp text := '98060000-aaaa-0000-0000-000000000001|98060000-aaaa-0000-0000-000000000002';
  k bigint := pg_catalog.hashtextextended('kit_capa_virtual:98060000-0000-0000-0000-000000000001:' || comp, 0);
begin
  -- (g) Exatamente 1 entrega para a gerada (custo real copiado); 0 para a recusada.
  perform pg_temp.afirmar((select count(*) from public.platform_image_deliveries
      where org_id = o and request_id = '98060000-0000-0000-0000-0000000000c1' and cost_usd = 0.055) = 1,
    '(g) gerada não gerou exatamente 1 entrega');
  perform pg_temp.afirmar(not exists (select 1 from public.platform_image_deliveries
      where org_id = o and request_id = '98060000-0000-0000-0000-0000000000c2'), '(g) recusada cobrou');
  perform pg_temp.afirmar((select count(*) from public.platform_image_deliveries where org_id = o) = 1,
    '(g) entregas a mais na org');

  -- (h) O advisory lock transacional da chave (org, composição) está preso nesta transação.
  perform pg_temp.afirmar(exists (select 1 from pg_catalog.pg_locks
      where locktype = 'advisory' and pid = pg_backend_pid() and granted and objsubid = 1
        and classid::bigint = (k >> 32) & 4294967295 and objid::bigint = k & 4294967295),
    '(h) advisory lock da composição ausente');
end $$;
rollback;
