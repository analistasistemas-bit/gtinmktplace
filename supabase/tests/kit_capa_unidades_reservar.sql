\set ON_ERROR_STOP on
-- ADR-0205 §8 (migration kit_capa_unidades_reservar): teto atômico de 6 tentativas por (org, base, n) em 24 h.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/kit_capa_unidades_reservar.sql \
--          supabase/migrations/20261112193715_kit_variacao_imagens_unidades.sql \
--          supabase/migrations/20261112222227_kit_capa_unidades_reservar.sql
-- Concorrência: a garantia vem do pg_advisory_xact_lock sobre (org, base, n) tomado antes da contagem (sem
-- Docker local, sem teste de duas sessões; o padrão supabase/tests/*_concorrencia.sh exige Postgres local).
-- Só toca dados do próprio fixture; tudo some no rollback.
begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97960000-0000-0000-0000-000000000001', 'Capa reservar', 'capa-reservar-teste', array['imagem_ia'], true);

create or replace function pg_temp.afirmar(c boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FALHA: %', msg; end if; end $$;

-- security invoker (sem elevação), e o resto roda COMO service_role (o papel da edge).
select pg_temp.afirmar(not prosecdef, 'RPC é security definer')
  from pg_proc where oid = 'public.kit_capa_unidades_reservar(uuid, uuid, smallint, uuid, smallint, text, uuid)'::regprocedure;
set local role service_role;

do $$
declare
  o uuid := '97960000-0000-0000-0000-000000000001';
  base uuid := '97960000-0000-0000-0000-0000000000b1';
  outra uuid := '97960000-0000-0000-0000-0000000000b2';
  m text := 'google/gemini-nano-banana-2.1';
  r uuid;
  res text;
  recusou boolean;
begin
  -- Ruído que NÃO conta: outro n, outra base, mais de 24 h (todos da mesma org).
  insert into public.kit_variacao_imagens (org_id, request_id, status, familia_base_id, n, modelo, custo_usd, criado_em) values
    (o, gen_random_uuid(), 'recusada', base, 4, m, 0.05, now()),
    (o, gen_random_uuid(), 'recusada', outra, 3, m, 0.05, now()),
    (o, gen_random_uuid(), 'recusada', base, 3, m, 0.05, now() - interval '25 hours'),
    (o, gen_random_uuid(), 'recusada', base, 3, m, 0.05, now() - interval '25 hours');

  -- 1ª reserva: ok, linha pendente de unidades com os campos da edge.
  r := gen_random_uuid();
  res := public.kit_capa_unidades_reservar(o, r, 1::smallint, base, 3::smallint, m, null);
  perform pg_temp.afirmar(res = 'ok', '1ª reserva devia ser ok, veio ' || coalesce(res, 'null'));
  perform pg_temp.afirmar(exists (select 1 from public.kit_variacao_imagens where org_id = o and request_id = r
      and tentativa = 1 and status = 'pendente' and familia_base_id = base and n = 3 and cores is null and rotulo is null
      and modelo = m), 'reserva gravada com campos errados');
  -- Recusada conta: a 1ª vira recusada (custo), como faz a edge.
  update public.kit_variacao_imagens set status = 'recusada', custo_usd = 0.05 where org_id = o and request_id = r;

  -- 2ª a 6ª: ok (pendentes também contam).
  for i in 2..6 loop
    res := public.kit_capa_unidades_reservar(o, gen_random_uuid(), 1::smallint, base, 3::smallint, m, null);
    perform pg_temp.afirmar(res = 'ok', 'reserva ' || i || ' devia ser ok, veio ' || coalesce(res, 'null'));
  end loop;

  -- 7ª: teto, sem inserir.
  r := gen_random_uuid();
  res := public.kit_capa_unidades_reservar(o, r, 1::smallint, base, 3::smallint, m, null);
  perform pg_temp.afirmar(res = 'teto', '7ª reserva devia ser teto, veio ' || coalesce(res, 'null'));
  perform pg_temp.afirmar(not exists (select 1 from public.kit_variacao_imagens where org_id = o and request_id = r),
    'teto inseriu linha');

  -- Outro n e outra base seguem livres (cada um com 1 linha de ruído).
  perform pg_temp.afirmar(public.kit_capa_unidades_reservar(o, gen_random_uuid(), 1::smallint, base, 4::smallint, m, null) = 'ok',
    'outro n contou no teto');
  perform pg_temp.afirmar(public.kit_capa_unidades_reservar(o, gen_random_uuid(), 1::smallint, outra, 3::smallint, m, null) = 'ok',
    'outra base contou no teto');

  -- 23505 preservado: mesma (org, request_id, tentativa) sobe unique_violation.
  r := gen_random_uuid();
  perform public.kit_capa_unidades_reservar(o, r, 1::smallint, base, 5::smallint, m, null);
  begin
    perform public.kit_capa_unidades_reservar(o, r, 1::smallint, base, 5::smallint, m, null);
    recusou := false;
  exception when unique_violation then recusou := true;
  end;
  perform pg_temp.afirmar(recusou, 'reserva repetida não deu 23505');

  -- Só service_role executa.
  perform pg_temp.afirmar(not has_function_privilege('authenticated',
    'public.kit_capa_unidades_reservar(uuid, uuid, smallint, uuid, smallint, text, uuid)', 'execute'), 'authenticated executa');
  perform pg_temp.afirmar(not has_function_privilege('anon',
    'public.kit_capa_unidades_reservar(uuid, uuid, smallint, uuid, smallint, text, uuid)', 'execute'), 'anon executa');
  perform pg_temp.afirmar(has_function_privilege('service_role',
    'public.kit_capa_unidades_reservar(uuid, uuid, smallint, uuid, smallint, text, uuid)', 'execute'), 'service_role não executa');
end $$;
rollback;
