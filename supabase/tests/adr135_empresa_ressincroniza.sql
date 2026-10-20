\set ON_ERROR_STOP on
-- ADR-0135 emenda A3 (auditoria fiscal 19/10/2026): mudar regime_tributario/origin_type em
-- empresa_fiscal marca o push fiscal como pendente nas famílias publicadas da org (e avança
-- atualizado_em, invalidando push em voo). Gravado pelo papel authenticated (como o front faz), o
-- trigger não pode ser barrado pelo guard A6. Fixtures numa org sem empresa_fiscal (nenhuma família
-- real dela tem o marcador), tudo dentro da transação desfeita.
begin;

do $$
declare v_user uuid; v_org uuid; v_lote uuid; v_id uuid;
begin
  select p.id, p.org_id into v_user, v_org from public.profiles p
  where p.is_active and p.is_admin and p.org_id is not null
    and not exists (select 1 from public.empresa_fiscal e where e.org_id = p.org_id)
    and not exists (select 1 from public.familias f
                    where f.org_id = p.org_id and f.fiscal_sincronizado_em is not null)
  limit 1;
  if v_user is null then raise exception 'nenhum admin em org sem empresa_fiscal para a fixture'; end if;
  insert into public.empresa_fiscal (org_id, regime_tributario, origin_type, razao_social)
  values (v_org, 'simples', 'reseller', 'Fixture A3');
  insert into public.lotes (user_id, org_id, numero)
  values (v_user, v_org, (select coalesce(max(numero), 0) + 1 from public.lotes))
  returning id into v_lote;
  insert into public.familias (lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, status,
                               fiscal_sincronizado_em, atualizado_em)
  values (v_lote, v_user, v_org, 'TESTE-A3', 'Teste A3', 'CREATE', 'publicado',
          '2020-01-01', '2020-01-01')
  returning id into v_id;
  perform set_config('teste.familia', v_id::text, true);
  perform set_config('teste.org', v_org::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
end $$;

set local role authenticated;

do $$
declare v_org uuid := current_setting('teste.org')::uuid; n int;
begin
  -- coluna que não entra no payload fiscal: nada muda na família
  update public.empresa_fiscal set razao_social = 'Fixture A3 editada' where org_id = v_org;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin não editou empresa_fiscal (% linhas)', n; end if;
end $$;

reset role;
do $$
declare r record;
begin
  select fiscal_sincronizado_em, atualizado_em into r from public.familias
  where id = current_setting('teste.familia')::uuid;
  if r.fiscal_sincronizado_em is null then
    raise exception 'editar razao_social zerou o marcador do push';
  end if;
end $$;

set local role authenticated;
do $$
declare v_org uuid := current_setting('teste.org')::uuid; n int;
begin
  -- origin_type entra no payload: o admin grava (o guard A6 não pode barrar o trigger)
  update public.empresa_fiscal set origin_type = 'manufacturer' where org_id = v_org;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin não editou origin_type (% linhas)', n; end if;
end $$;

reset role;
do $$
declare r record;
begin
  select fiscal_sincronizado_em, atualizado_em into r from public.familias
  where id = current_setting('teste.familia')::uuid;
  if r.fiscal_sincronizado_em is not null then
    raise exception 'mudar origin_type não marcou o push como pendente';
  end if;
  if r.atualizado_em <= '2020-01-01'::timestamptz then
    raise exception 'atualizado_em não avançou — push em voo não seria invalidado';
  end if;
end $$;

-- regime também dispara (marcador de volta → muda o regime → zera de novo)
update public.familias set fiscal_sincronizado_em = now() where id = current_setting('teste.familia')::uuid;
set local role authenticated;
update public.empresa_fiscal set regime_tributario = 'normal' where org_id = current_setting('teste.org')::uuid;
reset role;
do $$
begin
  if (select fiscal_sincronizado_em from public.familias where id = current_setting('teste.familia')::uuid) is not null then
    raise exception 'mudar regime_tributario não marcou o push como pendente';
  end if;
end $$;
rollback;
