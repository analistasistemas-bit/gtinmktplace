\set ON_ERROR_STOP on
-- ADR-0189 D-8/D-19 (migration extensao_v1): escrita via service_role, RLS por org, RPCs incrementais.
-- Fixtures só dentro da transação desfeita (scripts/teste-sql-desfeito.py).
begin;

-- Org A = org de uma variação real; usuário A (mesma org) e usuário B (outra org ativa).
create temp table ctx on commit drop as
select v.id as variacao_id, v.org_id as org_a,
  (select p.id from public.profiles p where p.is_active and p.org_id = v.org_id limit 1) as user_a,
  (select p.id from public.profiles p where p.is_active and p.org_id is not null and p.org_id <> v.org_id
     and not p.is_super_admin limit 1) as user_b
from public.variacoes v where v.org_id is not null limit 1;
grant select on ctx to authenticated, service_role;

set local role service_role;
do $$
declare c record; n int;
begin
  select * into c from ctx;
  if c.user_a is null or c.user_b is null then raise exception 'fixtures ausentes: %', c; end if;

  insert into public.extensao_vinculos (org_id, chave_tipo, chave, variacao_id, criado_por)
  values (c.org_a, 'item', 'MLB_TESTE_0189', c.variacao_id, c.user_a);

  perform public.extensao_registrar_uso(c.org_a, c.user_a, 'anuncio');
  perform public.extensao_registrar_uso(c.org_a, c.user_a, 'anuncio');
  select analises into n from public.extensao_uso_diario where org_id = c.org_a and user_id = c.user_a
    and tipo_pagina = 'anuncio' and dia = (now() at time zone 'America/Sao_Paulo')::date;
  if n is distinct from 2 then raise exception 'analises = %, esperado 2', n; end if;

  perform public.extensao_registrar_erro(c.org_a, 'busca', '0.1.0', 'seletor_ausente', 'MLB1');
  perform public.extensao_registrar_erro(c.org_a, 'busca', '0.1.0', 'seletor_ausente', 'MLB2');
  select ocorrencias into n from public.extensao_erros_leitura where org_id = c.org_a and motivo = 'seletor_ausente'
    and versao_extensao = '0.1.0';
  if n is distinct from 2 then raise exception 'ocorrencias = %, esperado 2', n; end if;
  if (select ultimo_ml_item_id from public.extensao_erros_leitura where org_id = c.org_a
      and motivo = 'seletor_ausente') is distinct from 'MLB2' then
    raise exception 'ultimo_ml_item_id não atualizado';
  end if;
end $$;
reset role;

-- Usuário B (outra org): não vê nada da org A, não escreve, não chama as RPCs.
select set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true) from ctx;
set local role authenticated;
do $$
declare c record; n int;
begin
  select * into c from ctx;
  if public.current_org_id() is null or public.current_org_id() = c.org_a then
    raise exception 'current_org_id do usuário B inválido: %', public.current_org_id();
  end if;
  select count(*) into n from public.extensao_vinculos where org_id = c.org_a;
  if n <> 0 then raise exception 'B vê % vínculos da org A', n; end if;
  select count(*) into n from public.extensao_uso_diario where org_id = c.org_a;
  if n <> 0 then raise exception 'B vê % usos da org A', n; end if;
  select count(*) into n from public.extensao_erros_leitura where org_id = c.org_a;
  if n <> 0 then raise exception 'B vê % erros da org A', n; end if;

  begin
    insert into public.extensao_vinculos (org_id, chave_tipo, chave, variacao_id)
    values (public.current_org_id(), 'item', 'MLB_X', c.variacao_id);
    raise exception 'authenticated conseguiu inserir vínculo';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.extensao_registrar_uso(c.org_a, c.user_b, 'anuncio');
    raise exception 'authenticated conseguiu executar extensao_registrar_uso';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.extensao_registrar_erro(c.org_a, 'busca', '0.1.0', 'x', null);
    raise exception 'authenticated conseguiu executar extensao_registrar_erro';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Usuário A (mesma org): controle positivo — vê o que foi gravado.
select set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true) from ctx;
set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.extensao_vinculos where chave = 'MLB_TESTE_0189';
  if n <> 1 then raise exception 'A vê % vínculos, esperado 1', n; end if;
  select count(*) into n from public.extensao_uso_diario;
  if n < 1 then raise exception 'A não vê o próprio uso'; end if;
  select count(*) into n from public.extensao_erros_leitura where motivo = 'seletor_ausente';
  if n <> 1 then raise exception 'A vê % erros, esperado 1', n; end if;
end $$;
reset role;

rollback;
