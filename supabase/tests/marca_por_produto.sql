-- ADR-0188 — marca por produto. Rodar com a migration:
--   python3 scripts/teste-sql-desfeito.py supabase/tests/marca_por_produto.sql \
--     supabase/migrations/<ts>_adr188_marca_por_produto.sql
-- Sem a migration = prova de vermelho.
\set ON_ERROR_STOP on
begin;

-- Bordas criadas como postgres (o trigger de proteção só barra authenticated/anon).
do $$
declare
  zaven constant uuid := 'b95a1c97-8477-4e3a-89b8-04f735549072';
  avil  constant uuid := 'a72ea303-5559-4a35-9aff-daa12cd1de12';
  r jsonb; n int; raiz uuid;
begin
  -- 1. Backfill
  select count(*) into n from public.familias where org_id = zaven and marca is distinct from 'Zaven';
  if n <> 0 then raise exception 'backfill: % famílias da Zaven sem marca Zaven', n; end if;
  select count(*) into n from public.familias where org_id <> zaven and marca is not null;
  if n <> 0 then raise exception 'backfill tocou % famílias de outras orgs', n; end if;

  -- 2. RPC grava marca, reescreve BRAND e marca pendente na raiz
  r := public.gravar_marca_familia(zaven, '00000064', 'Lacoste');
  if not (r->>'publicado')::boolean or (r->>'versao')::int < 1 then raise exception 'retorno RPC: %', r; end if;
  select count(*) into n from public.familias where org_id = zaven and codigo_pai = '00000064' and marca <> 'Lacoste';
  if n <> 0 then raise exception 'RPC não gravou marca em todas as linhas'; end if;
  select count(*) into n from public.familias f, jsonb_array_elements(f.atributos_ml) e
   where f.org_id = zaven and f.codigo_pai = '00000064' and e->>'id' in ('BRAND','MANUFACTURER')
     and (e->>'value_name' <> 'Lacoste' or e ? 'value_id');
  if n <> 0 then raise exception 'RPC não reescreveu BRAND/MANUFACTURER'; end if;
  select count(*) into n from public.anuncios_externos
   where org_id = zaven and codigo_pai = '00000064' and canal = 'mercado_livre'
     and (marca_sync_status is distinct from 'pendente' or marca_sync_versao < 1);
  if n <> 0 then raise exception 'raiz sem status pendente/versão'; end if;

  -- 3. Estados bloqueados → MARCA_OCUPADO e nada muda (rollback do subbloco)
  foreach r in array array['"pendente"','"processando"','"publicando"']::jsonb[] loop
    update public.familias set status = (r #>> '{}')::public.familia_status
     where id = (select id from public.familias where org_id = zaven and codigo_pai = '00000105' order by criado_em desc limit 1);
    begin
      perform public.gravar_marca_familia(zaven, '00000105', 'Lacoste');
      raise exception 'esperava MARCA_OCUPADO com status %', r;
    exception when others then
      if sqlerrm not like '%MARCA_OCUPADO%' then raise; end if;
    end;
    update public.familias set status = 'publicado'
     where org_id = zaven and codigo_pai = '00000105';
  end loop;
  select count(*) into n from public.familias where org_id = zaven and codigo_pai = '00000105' and marca <> 'Zaven';
  if n <> 0 then raise exception 'recusa não fez rollback'; end if;

  update public.anuncios_externos set mudando_composicao = true
   where org_id = zaven and codigo_pai = '00000112' and particao = 0;
  begin
    perform public.gravar_marca_familia(zaven, '00000112', 'Lacoste');
    raise exception 'esperava MARCA_OCUPADO com mudando_composicao';
  exception when others then
    if sqlerrm not like '%MARCA_OCUPADO%' then raise; end if;
  end;

  -- 4. Inexistente e vazia
  begin
    perform public.gravar_marca_familia(zaven, '99999999', 'Lacoste');
    raise exception 'esperava MARCA_INEXISTENTE';
  exception when others then
    if sqlerrm not like '%MARCA_INEXISTENTE%' then raise; end if;
  end;
  begin
    perform public.gravar_marca_familia(zaven, '00000119', '   ');
    raise exception 'esperava recusa de marca vazia';
  exception when others then
    if sqlerrm not like '%MARCA_VAZIA%' then raise; end if;
  end;

  -- 5. Default no INSERT: Zaven manual sem marca → 'Zaven'; atributos [] intactos na RPC
  insert into public.familias
  select (jsonb_populate_record(null::public.familias, to_jsonb(f)
    || jsonb_build_object('id', '88000000-0000-0000-0000-000000000001', 'codigo_pai', '99918801',
         'chave_cadastro', gen_random_uuid(), 'marca', null, 'status', 'publicado', 'atributos_ml', '[]'::jsonb))).*
  from public.familias f where f.org_id = zaven and f.codigo_pai = '00000119' order by f.criado_em desc limit 1;
  if (select marca from public.familias where id = '88000000-0000-0000-0000-000000000001') is distinct from 'Zaven' then
    raise exception 'default manual Zaven falhou';
  end if;
  r := public.gravar_marca_familia(zaven, '99918801', 'Lacoste');
  if (r->>'publicado')::boolean then raise exception 'sem raiz deveria ser publicado=false'; end if;
  if (select atributos_ml from public.familias where id = '88000000-0000-0000-0000-000000000001') <> '[]'::jsonb then
    raise exception 'atributos [] mudaram';
  end if;

  -- Avil → null
  insert into public.familias
  select (jsonb_populate_record(null::public.familias, to_jsonb(f)
    || jsonb_build_object('id', '88000000-0000-0000-0000-000000000002', 'codigo_pai', '99918802',
         'chave_cadastro', gen_random_uuid(), 'marca', null))).*
  from public.familias f where f.org_id = avil order by f.criado_em desc limit 1;
  if (select marca from public.familias where id = '88000000-0000-0000-0000-000000000002') is not null then
    raise exception 'Avil ganhou marca';
  end if;

  -- Planilha na Zaven → null
  insert into public.lotes
  select (jsonb_populate_record(null::public.lotes, to_jsonb(l)
    || jsonb_build_object('id', '88000000-0000-0000-0000-0000000000a1', 'origem', 'planilha', 'numero', 999188, 'numero_org', null))).*
  from public.lotes l where l.org_id = zaven limit 1;
  insert into public.familias
  select (jsonb_populate_record(null::public.familias, to_jsonb(f)
    || jsonb_build_object('id', '88000000-0000-0000-0000-000000000003', 'codigo_pai', '99918803',
         'chave_cadastro', gen_random_uuid(), 'marca', null, 'lote_id', '88000000-0000-0000-0000-0000000000a1'))).*
  from public.familias f where f.org_id = zaven and f.codigo_pai = '00000119' order by f.criado_em desc limit 1;
  if (select marca from public.familias where id = '88000000-0000-0000-0000-000000000003') is not null then
    raise exception 'planilha na Zaven ganhou marca';
  end if;

  -- 6. Herança: snapshot novo do 00000064 (marca Lacoste) com BRAND=STAR da planilha → Lacoste
  insert into public.familias
  select (jsonb_populate_record(null::public.familias, to_jsonb(f)
    || jsonb_build_object('id', '88000000-0000-0000-0000-000000000004', 'chave_cadastro', gen_random_uuid(),
         'marca', null, 'status', 'pendente', 'lote_id', '88000000-0000-0000-0000-0000000000a1',
         'atributos_ml', '[{"id":"BRAND","value_name":"STAR GLAMOUR"},{"id":"MODEL","value_name":"X"}]'::jsonb))).*
  from public.familias f where f.org_id = zaven and f.codigo_pai = '00000064' order by f.criado_em desc limit 1;
  if (select marca from public.familias where id = '88000000-0000-0000-0000-000000000004') is distinct from 'Lacoste' then
    raise exception 'herança da marca falhou';
  end if;
  if (select atributos_ml from public.familias where id = '88000000-0000-0000-0000-000000000004')
     <> '[{"id":"BRAND","value_name":"Lacoste"},{"id":"MODEL","value_name":"X"}]'::jsonb then
    raise exception 'herança não reescreveu BRAND';
  end if;
  begin
    perform public.gravar_marca_familia(zaven, '00000064', 'Zaven');
    raise exception 'esperava MARCA_OCUPADO com snapshot pendente';
  exception when others then
    if sqlerrm not like '%MARCA_OCUPADO%' then raise; end if;
  end;

  -- 7. Lease
  select id into strict raiz from public.anuncios_externos
   where org_id = zaven and codigo_pai = '00000119' and canal = 'mercado_livre' and particao = 0;
  if not public.adquirir_lease_marca(raiz, 300) then raise exception 'lease 1 falhou'; end if;
  if public.adquirir_lease_marca(raiz, 300) then raise exception 'lease 2 deveria falhar'; end if;
  perform public.liberar_lease_marca(raiz);
  if not public.adquirir_lease_marca(raiz, 300) then raise exception 'lease após liberar falhou'; end if;
end $$;

-- 8. Como usuário autenticado da Zaven (admin)
select set_config('request.jwt.claims', '{"sub":"18990deb-c661-4327-8489-83e2c0eb758c","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  if public.marca_da_org() <> '{"marca_propria": true, "marca_padrao": "Zaven"}'::jsonb then
    raise exception 'marca_da_org: %', public.marca_da_org();
  end if;
  begin
    update public.familias set marca = 'X' where codigo_pai = '00000119';
    raise exception 'authenticated mudou marca';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.familias set atributos_ml = '[{"id":"BRAND","value_name":"X"}]'::jsonb where codigo_pai = '00000119';
    raise exception 'authenticated mudou BRAND';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.organizations set marca_padrao = 'X' where id = 'b95a1c97-8477-4e3a-89b8-04f735549072';
    raise exception 'authenticated mudou marca_padrao';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.organizations set marca_propria = false where id = 'b95a1c97-8477-4e3a-89b8-04f735549072';
    raise exception 'authenticated mudou marca_propria';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.gravar_marca_familia('b95a1c97-8477-4e3a-89b8-04f735549072', '00000119', 'X');
    raise exception 'authenticated executou gravar_marca_familia';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.adquirir_lease_marca(gen_random_uuid(), 10);
    raise exception 'authenticated executou adquirir_lease_marca';
  exception when insufficient_privilege then null;
  end;
  -- coluna legítima continua editável pelo membro
  update public.familias set titulo_ml = titulo_ml where codigo_pai = '00000119';
end $$;
reset role;
rollback;
