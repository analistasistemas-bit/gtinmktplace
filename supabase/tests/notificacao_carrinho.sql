\set ON_ERROR_STOP on
-- ADR-0190 D-4: notificacao_carrinho — PK idempotente (on conflict do nothing), CHECK de status, RLS sem policies.
begin;
insert into public.organizations (id, nome, slug) values
  ('97000000-0000-0000-0000-000000000001', 'Carrinho test', 'carrinho-test');

do $$
declare
  o constant uuid := '97000000-0000-0000-0000-000000000001';
  n integer; r record;
begin
  -- 1) 1º registro: defaults.
  insert into public.notificacao_carrinho (org_id, chave, pack_id, order_id, esperadas)
    values (o, '2000001', 2000001, 11, array[11, 12]::bigint[]);
  select * into r from public.notificacao_carrinho where org_id = o and chave = '2000001';
  if r.status <> 'aguardando' or r.tentativas <> 0 or r.primeiro_em is null or r.esperadas <> array[11, 12]::bigint[]
    then raise exception '1: defaults errados: %', r; end if;

  -- 2) Mesma chave de novo (2ª order paga do pack): on conflict do nothing não insere nem altera.
  insert into public.notificacao_carrinho (org_id, chave, pack_id, order_id, esperadas)
    values (o, '2000001', 2000001, 12, null) on conflict do nothing;
  get diagnostics n = row_count;
  if n <> 0 then raise exception '2: on conflict inseriu % linha(s)', n; end if;
  select * into r from public.notificacao_carrinho where org_id = o and chave = '2000001';
  if r.order_id <> 11 or r.esperadas is null then raise exception '2: linha alterada: %', r; end if;
  select count(*) into n from public.notificacao_carrinho where org_id = o;
  if n <> 1 then raise exception '2: % linhas', n; end if;

  -- 3) Sem on conflict, a PK recusa.
  begin
    insert into public.notificacao_carrinho (org_id, chave, order_id) values (o, '2000001', 13);
    raise exception '3: PK não recusou duplicata';
  exception when unique_violation then null;
  end;

  -- 4) CHECK de status: aceita os 3, recusa outro.
  update public.notificacao_carrinho set status = 'enviado' where org_id = o and chave = '2000001';
  update public.notificacao_carrinho set status = 'descartado' where org_id = o and chave = '2000001';
  begin
    update public.notificacao_carrinho set status = 'enviando' where org_id = o and chave = '2000001';
    raise exception '4: CHECK aceitou status inválido';
  exception when check_violation then null;
  end;

  -- 5) Claim "no máximo uma": update condicional só pega quem ainda está aguardando.
  insert into public.notificacao_carrinho (org_id, chave, order_id, esperadas) values (o, '21', 21, array[21]::bigint[]);
  update public.notificacao_carrinho set status = 'enviado' where org_id = o and chave = '21' and status = 'aguardando';
  get diagnostics n = row_count;
  if n <> 1 then raise exception '5: 1º claim pegou %', n; end if;
  update public.notificacao_carrinho set status = 'enviado' where org_id = o and chave = '21' and status = 'aguardando';
  get diagnostics n = row_count;
  if n <> 0 then raise exception '5: 2º claim pegou %', n; end if;

  -- 6) RLS ligada, nenhuma policy (só service role).
  if not (select relrowsecurity from pg_class where oid = 'public.notificacao_carrinho'::regclass)
    then raise exception '6: RLS desligada'; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'notificacao_carrinho';
  if n <> 0 then raise exception '6: % policies', n; end if;
end $$;
