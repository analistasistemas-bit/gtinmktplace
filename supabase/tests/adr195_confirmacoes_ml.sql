-- ADR-0195: rodar com scripts/teste-sql-desfeito.py <este arquivo> <migration>. Transação sempre desfeita.
do $$
declare
  v_lote public.lotes%rowtype;
  v_familia uuid;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.confirmacoes_ml'::regclass) then
    raise exception 'RLS desligada';
  end if;
  if has_table_privilege('authenticated', 'public.confirmacoes_ml', 'INSERT')
     or has_table_privilege('anon', 'public.confirmacoes_ml', 'SELECT') then
    raise exception 'privilégio indevido';
  end if;
  if not has_table_privilege('authenticated', 'public.confirmacoes_ml', 'SELECT') then
    raise exception 'authenticated sem SELECT';
  end if;

  select * into v_lote from public.lotes order by criado_em desc limit 1;
  select id into v_familia from public.familias where lote_id = v_lote.id limit 1;

  insert into public.confirmacoes_ml (org_id, lote_id, familia_id, codigo_pai, item_externo_id, modelo, enviado, enviado_em)
  values (v_lote.org_id, v_lote.id, v_familia, 'X', 'MLB1', 'variacoes', '{}', now());

  begin
    insert into public.confirmacoes_ml (org_id, lote_id, familia_id, codigo_pai, item_externo_id, modelo, enviado, enviado_em)
    values (v_lote.org_id, v_lote.id, v_familia, 'X', 'MLB1', 'variacoes', '{}', now());
    raise exception 'unique não barrou';
  exception when unique_violation then null;
  end;

  begin
    insert into public.confirmacoes_ml (org_id, lote_id, familia_id, codigo_pai, item_externo_id, modelo, enviado, enviado_em, status)
    values (v_lote.org_id, v_lote.id, v_familia, 'X', 'MLB2', 'variacoes', '{}', now(), 'qualquer');
    raise exception 'check de status não barrou';
  exception when check_violation then null;
  end;
end $$;
