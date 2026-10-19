\set ON_ERROR_STOP on
-- ADR-0135 emenda A6/A7 (auditoria fiscal 19/10/2026): membro não grava prontidão/dados fiscais de
-- familias pelo PostgREST nem faz INSERT direto; sessão de suporte read-only não escreve
-- empresa_fiscal. Só fixtures (lote + família sob um perfil real), dentro da transação desfeita.
begin;

do $$
declare v_user uuid; v_org uuid; v_lote uuid; v_id uuid;
begin
  select p.id, p.org_id into v_user, v_org from public.profiles p
  where p.is_active and p.org_id is not null limit 1;
  if v_user is null then raise exception 'nenhum perfil ativo para a fixture'; end if;
  insert into public.lotes (user_id, org_id, numero)
  values (v_user, v_org, (select coalesce(max(numero), 0) + 1 from public.lotes))
  returning id into v_lote;
  insert into public.familias (lote_id, user_id, org_id, codigo_pai, nome_pai, operacao)
  values (v_lote, v_user, v_org, 'TESTE-A6', 'Teste A6', 'CREATE')
  returning id into v_id;
  perform set_config('teste.familia', v_id::text, true);
  perform set_config('teste.lote', v_lote::text, true);
  perform set_config('teste.org', v_org::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
end $$;

set local role authenticated;

do $$
declare v_id uuid := current_setting('teste.familia')::uuid; n int;
  col text;
begin
  -- 1) coluna livre passa (RLS da org + trigger não barra)
  update public.familias set titulo_ml = 'Título editado' where id = v_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'UPDATE de titulo_ml por membro afetou % linhas, esperado 1', n; end if;

  -- 2) cada coluna protegida recusa com 42501
  foreach col in array array['can_invoice', 'can_invoice_causa', 'can_invoice_em', 'fiscal_sincronizado_em',
    'ncm', 'cest', 'origem_nfe', 'fci', 'ex_tipi', 'tributacao_icms', 'tributacao_icms_regime',
    'descricao_fiscal', 'unidade', 'origem'] loop
    begin
      execute format('update public.familias set %I = %s where id = $1', col, case col
        when 'can_invoice' then 'true'
        when 'can_invoice_em' then 'now()'
        when 'fiscal_sincronizado_em' then 'now()'
        when 'ncm' then '''62034900'''
        when 'cest' then '''2806300'''
        when 'origem_nfe' then '1'
        when 'tributacao_icms' then '''102'''
        when 'tributacao_icms_regime' then '''simples'''
        when 'unidade' then '''PC'''
        when 'origem' then '''importado'''
        else '''x''' end) using v_id;
      raise exception 'membro alterou familias.% sem 42501', col;
    exception when insufficient_privilege then null;
    end;
  end loop;

  -- 3) INSERT direto recusa, mesmo sem coluna fiscal informada
  begin
    insert into public.familias (lote_id, user_id, org_id, codigo_pai, nome_pai, operacao)
    values (current_setting('teste.lote')::uuid, (current_setting('request.jwt.claims')::json->>'sub')::uuid,
            current_setting('teste.org')::uuid, 'TESTE-A6-INS', 'Teste A6 insert', 'CREATE');
    raise exception 'membro fez INSERT direto em familias sem 42501';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 4) fora do papel authenticated (backend) grava normalmente
reset role;
do $$
declare n int;
begin
  update public.familias set can_invoice = true, ncm = '62034900'
  where id = current_setting('teste.familia')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'backend não gravou a prontidão (% linhas)', n; end if;
end $$;

-- 5) A7: escrita em empresa_fiscal exige can_write_current_org()
do $$
declare r record;
begin
  for r in select policyname, cmd, qual, with_check from pg_policies
           where schemaname = 'public' and tablename = 'empresa_fiscal' and cmd in ('INSERT', 'UPDATE') loop
    if coalesce(r.with_check, '') not like '%can_write_current_org%' then
      raise exception 'policy % (%) sem can_write_current_org no with_check', r.policyname, r.cmd;
    end if;
    if r.cmd = 'UPDATE' and coalesce(r.qual, '') not like '%can_write_current_org%' then
      raise exception 'policy % sem can_write_current_org no using', r.policyname;
    end if;
  end loop;
  if not found then raise exception 'nenhuma policy de escrita em empresa_fiscal'; end if;
end $$;
rollback;
