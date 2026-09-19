-- Migration: Ajuste de vigência inicial dos primeiros contratos de Avil, DSA e Daludi Shop para setembro/2026
-- Contexto: Contratos cadastrados em setembro/2026 foram salvos com starts_on = 2026-10-01
-- devido ao valor padrão do formulário anterior. Esta migration ajusta especificamente
-- as três organizações para 2026-09-01 para habilitar previsão e fechamento de 2026-09.

create or replace function pg_temp.executar_migracao_vigencia_setembro()
returns void
language plpgsql
as $$
declare
  v_expected_orgs integer;
  v_target_slug text;
  v_org_id uuid;
  v_term_count integer;
  v_term public.platform_commercial_terms%rowtype;
  v_corrigido record;
  v_slug_count integer;
begin
  -- 1. Pré-condição incondicional ANTES de qualquer DDL, lock ou alteração:
  select count(*) into v_expected_orgs
  from public.organizations
  where slug in ('avil', 'diego-souza', 'daludishop');

  -- Em ambiente limpo sem seeds de produção (ex.: suíte de testes isolada ou CI novo):
  if v_expected_orgs = 0 then
    -- No-op absoluto: encerra sem tocar no trigger, na tabela ou em qualquer lock
    return;
  end if;

  -- Se encontrou pelo menos uma organização alvo, EXIGE obrigatoriamente que as 3 existam
  if v_expected_orgs <> 3 then
    raise exception 'Pré-condição violada: esperava exatamente 3 organizações (avil, diego-souza, daludishop) ou nenhuma (ambiente limpo), mas encontrou %', v_expected_orgs
      using errcode = '23514';
  end if;

  -- 2. Somente após a pré-condição ser satisfeita, criar a tabela temporária e desabilitar o trigger:
  create temporary table _migracao_termos_corrigidos (
    id uuid primary key,
    org_id uuid not null,
    slug text not null,
    starts_on_anterior date not null,
    starts_on_atual date not null,
    setup_due_anterior date,
    setup_due_atual date
  ) on commit drop;

  alter table public.platform_commercial_terms disable trigger platform_commercial_terms_no_mutation;

  -- 3. Para cada organização alvo, validar individualmente e atualizar cirurgicamente
  for v_target_slug in select unnest(array['avil', 'diego-souza', 'daludishop']) loop
    select id into strict v_org_id
    from public.organizations
    where slug = v_target_slug;

    -- Validar que possui exatamente 1 termo no histórico total (contrato inaugural)
    select count(*) into strict v_term_count
    from public.platform_commercial_terms
    where org_id = v_org_id;

    if v_term_count <> 1 then
      raise exception 'Organização % possui % termos comerciais no histórico, esperava exatamente 1 (primeiro contrato inaugural)', v_target_slug, v_term_count
        using errcode = '23514';
    end if;

    -- Obter o termo inaugural
    select * into strict v_term
    from public.platform_commercial_terms
    where org_id = v_org_id;

    -- Validar que é versão 1 e estava com vigência em 2026-10-01
    if v_term.version <> 1 or v_term.starts_on <> '2026-10-01'::date then
      raise exception 'Termo da organização % não é o contrato inaugural esperado de 2026-10-01 (versão %, starts_on %)', v_target_slug, v_term.version, v_term.starts_on
        using errcode = '23514';
    end if;

    -- Atualizar especificamente esse termo único
    update public.platform_commercial_terms
    set starts_on = '2026-09-01',
        setup_due_month = case when setup_due_month = '2026-10-01' then '2026-09-01'::date else setup_due_month end
    where id = v_term.id and org_id = v_org_id
    returning id, org_id, starts_on, setup_due_month
    into v_corrigido;

    insert into _migracao_termos_corrigidos (
      id, org_id, slug, starts_on_anterior, starts_on_atual, setup_due_anterior, setup_due_atual
    ) values (
      v_corrigido.id,
      v_corrigido.org_id,
      v_target_slug,
      v_term.starts_on,
      v_corrigido.starts_on,
      v_term.setup_due_month,
      v_corrigido.setup_due_month
    );
  end loop;

  -- 4. Asserção LOUD: exatamente 3 linhas atualizadas no total
  if (select count(*) from _migracao_termos_corrigidos) <> 3 then
    raise exception 'Esperava exatamente 3 linhas em _migracao_termos_corrigidos, mas obteve %', (select count(*) from _migracao_termos_corrigidos)
      using errcode = '23514';
  end if;

  -- 5. Asserção LOUD: exatamente 1 linha por organização
  for v_target_slug in select unnest(array['avil', 'diego-souza', 'daludishop']) loop
    select count(*) into v_slug_count
    from _migracao_termos_corrigidos
    where slug = v_target_slug;

    if v_slug_count <> 1 then
      raise exception 'Esperava exatamente 1 linha corrigida para a organização %, mas obteve %', v_target_slug, v_slug_count
        using errcode = '23514';
    end if;
  end loop;

  -- 6. Asserção LOUD: nenhum termo restante em 2026-10 para as organizações alvo
  if exists (
    select 1
    from public.platform_commercial_terms t
    join public.organizations o on o.id = t.org_id
    where o.slug in ('avil', 'diego-souza', 'daludishop')
      and t.starts_on = '2026-10-01'
  ) then
    raise exception 'Restaram termos em 2026-10 para as organizações alvo' using errcode = '23514';
  end if;

  -- 7. Auditoria completa para cada termo modificado
  insert into public.platform_audit_events (org_id, actor_id, category, action, result, target, reason, details)
  select org_id, null, 'admin', 'platform_terms_vigencia_corrigida', 'success', id::text,
    'Ajuste de vigencia inicial: primeiro contrato inicia no mes do cadastro (2026-09)',
    jsonb_build_object(
      'org_slug', slug,
      'starts_on_anterior', starts_on_anterior,
      'starts_on_atual', starts_on_atual,
      'setup_due_month_anterior', setup_due_anterior,
      'setup_due_month_atual', setup_due_atual
    )
  from _migracao_termos_corrigidos;

  -- 8. Reabilitar o trigger incondicionalmente
  alter table public.platform_commercial_terms enable trigger platform_commercial_terms_no_mutation;
end;
$$;

select pg_temp.executar_migracao_vigencia_setembro();
