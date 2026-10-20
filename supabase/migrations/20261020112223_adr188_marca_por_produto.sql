-- ADR-0188 — marca por produto. A marca que vai ao ML como BRAND/MANUFACTURER passa a ficar gravada no
-- produto (familias.marca). Cadastro pelo Estoque numa org com marca própria nasce com a marca da org;
-- planilha nasce sem (vale o FORNECEDOR); snapshot de UPDATE herda a marca do produto (a marca vence a
-- planilha — decisão do Diego, 20/10). Troca depois só pelo "Editar marca" (RPC abaixo + worker).

alter table public.familias add column marca text;
comment on column public.familias.marca is
  'ADR-0188: marca enviada ao ML (BRAND/MANUFACTURER). null = vale o fornecedor. Só muda pelo backend.';

alter table public.anuncios_externos
  add column marca_sync_status text check (marca_sync_status in ('pendente', 'ok', 'erro')),
  add column marca_sync_erro text,
  add column marca_sync_em timestamptz,
  add column marca_sync_versao int not null default 0,
  add column marca_sync_lease_ate timestamptz;
comment on column public.anuncios_externos.marca_sync_versao is
  'ADR-0188: versão da última edição de marca (raiz particao=0); job com versão antiga não escreve.';

-- BRAND/MANUFACTURER de uma lista de atributos (para comparar sem olhar o resto).
create or replace function public.marca_dos_atributos(p_attrs jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(e order by e->>'id', e::text), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_attrs) = 'array' then p_attrs else '[]'::jsonb end) e
  where e->>'id' in ('BRAND', 'MANUFACTURER');
$$;

-- Reescreve BRAND/MANUFACTURER para p_marca. Mantém o elemento cujo nome já é a marca (com o value_id do
-- ML — trocá-lo por texto cru desagrupa a família UP, lote 54). Sem o atributo, devolve igual.
create or replace function public.atributos_com_marca(p_attrs jsonb, p_marca text)
returns jsonb language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(p_attrs) is distinct from 'array'
      or not exists (select 1 from jsonb_array_elements(p_attrs) e where e->>'id' in ('BRAND', 'MANUFACTURER'))
      then p_attrs
    else (select jsonb_agg(
            case when e->>'id' in ('BRAND', 'MANUFACTURER')
                  and lower(btrim(coalesce(e->>'value_name', ''))) <> lower(btrim(p_marca))
                 then jsonb_build_object('id', e->>'id', 'value_name', p_marca)
                 else e end
            order by o)
          from jsonb_array_elements(p_attrs) with ordinality x(e, o))
  end;
$$;

-- Proteção: o membro (PostgREST) não muda a marca do produto nem a BRAND dentro de atributos_ml.
-- Molde ADR-0135: SECURITY INVOKER + current_user; dentro de RPC SECURITY DEFINER o usuário é o dono.
create or replace function public.familias_proteger_marca()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.marca is distinct from old.marca
     or public.marca_dos_atributos(new.atributos_ml) is distinct from public.marca_dos_atributos(old.atributos_ml) then
    raise exception 'familias: a marca só muda pelo "Editar marca" (ADR-0188)' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger familias_proteger_marca before update on public.familias
  for each row execute function public.familias_proteger_marca();

create or replace function public.organizations_proteger_marca()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.marca_propria, new.marca_padrao) is distinct from (old.marca_propria, old.marca_padrao) then
    raise exception 'organizations: marca própria só pela Central de Organizações (ADR-0188)' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger organizations_proteger_marca before update on public.organizations
  for each row execute function public.organizations_proteger_marca();

-- Default e herança no INSERT (fecha a janela de rollout e a corrida com a planilha):
-- (a) já existe família do mesmo produto → herda a marca da mais recente, lida com FOR SHARE (espera uma
--     edição em andamento), e impõe a BRAND; (b) senão, cadastro manual em org com marca própria → marca da org.
create or replace function public.familias_marca_default()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_marca text;
begin
  if new.marca is not null then
    return new;
  end if;
  select f.marca into v_marca from public.familias f
   where f.org_id = new.org_id and f.codigo_pai = new.codigo_pai and f.id <> new.id
   order by f.criado_em desc limit 1 for share;
  if found then
    new.marca := v_marca;
    if v_marca is not null then
      new.atributos_ml := public.atributos_com_marca(new.atributos_ml, v_marca);
    end if;
    return new;
  end if;
  if (select l.origem from public.lotes l where l.id = new.lote_id) = 'manual' then
    select nullif(btrim(o.marca_padrao), '') into v_marca
      from public.organizations o where o.id = new.org_id and o.marca_propria;
    new.marca := v_marca;
  end if;
  return new;
end $$;
create trigger familias_marca_default before insert on public.familias
  for each row execute function public.familias_marca_default();

-- Leitura para o front (org efetiva do usuário).
create or replace function public.marca_da_org()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('marca_propria', coalesce(o.marca_propria, false), 'marca_padrao', o.marca_padrao)
  from public.organizations o where o.id = (select public.current_org_id());
$$;
revoke all on function public.marca_da_org() from public, anon;
grant execute on function public.marca_da_org() to authenticated;

-- Gravação transacional da edição (só backend).
create or replace function public.gravar_marca_familia(p_org_id uuid, p_codigo_pai text, p_marca text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_marca text := btrim(coalesce(p_marca, ''));
  v_raiz uuid;
  v_mudando boolean;
  v_versao int;
  n int;
begin
  if v_marca = '' then
    raise exception 'MARCA_VAZIA';
  end if;
  select a.id, a.mudando_composicao into v_raiz, v_mudando
    from public.anuncios_externos a
   where a.org_id = p_org_id and a.codigo_pai = p_codigo_pai and a.canal = 'mercado_livre' and a.particao = 0
   for update;
  perform 1 from public.familias f where f.org_id = p_org_id and f.codigo_pai = p_codigo_pai for update;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'MARCA_INEXISTENTE';
  end if;
  if coalesce(v_mudando, false) or exists (
       select 1 from public.familias f
        where f.org_id = p_org_id and f.codigo_pai = p_codigo_pai
          and f.status in ('pendente', 'processando', 'publicando')) then
    raise exception 'MARCA_OCUPADO';
  end if;
  update public.familias f
     set marca = v_marca, atributos_ml = public.atributos_com_marca(f.atributos_ml, v_marca)
   where f.org_id = p_org_id and f.codigo_pai = p_codigo_pai;
  if v_raiz is null then
    return jsonb_build_object('publicado', false, 'versao', null);
  end if;
  update public.anuncios_externos set marca_sync_versao = marca_sync_versao + 1
   where id = v_raiz returning marca_sync_versao into v_versao;
  update public.anuncios_externos
     set marca_sync_status = 'pendente', marca_sync_erro = null, marca_sync_em = now()
   where org_id = p_org_id and codigo_pai = p_codigo_pai and canal = 'mercado_livre';
  return jsonb_build_object('publicado', true, 'versao', v_versao);
end $$;
revoke all on function public.gravar_marca_familia(uuid, text, text) from public, anon, authenticated;
grant execute on function public.gravar_marca_familia(uuid, text, text) to service_role;

-- Lease por produto: serializa o worker de sincronização (inclusive reagendamentos).
create or replace function public.adquirir_lease_marca(p_raiz uuid, p_ttl_s int)
returns boolean language sql security definer set search_path = '' as $$
  with u as (
    update public.anuncios_externos
       set marca_sync_lease_ate = now() + make_interval(secs => p_ttl_s)
     where id = p_raiz and (marca_sync_lease_ate is null or marca_sync_lease_ate < now())
    returning 1)
  select exists (select 1 from u);
$$;
create or replace function public.liberar_lease_marca(p_raiz uuid)
returns void language sql security definer set search_path = '' as $$
  update public.anuncios_externos set marca_sync_lease_ate = null where id = p_raiz;
$$;
revoke all on function public.adquirir_lease_marca(uuid, int) from public, anon, authenticated;
revoke all on function public.liberar_lease_marca(uuid) from public, anon, authenticated;
grant execute on function public.adquirir_lease_marca(uuid, int) to service_role;
grant execute on function public.liberar_lease_marca(uuid) to service_role;

-- Backfill: a Zaven só tem produtos do Estoque (conferido 20/10); se surgir outro, para.
do $$
declare n int;
begin
  select count(*) into n from public.familias f join public.lotes l on l.id = f.lote_id
   where f.org_id = 'b95a1c97-8477-4e3a-89b8-04f735549072' and l.origem <> 'manual';
  if n > 0 then
    raise exception 'ADR-0188: % famílias da Zaven fora do Estoque — revisar o backfill', n;
  end if;
  update public.familias set marca = 'Zaven' where org_id = 'b95a1c97-8477-4e3a-89b8-04f735549072';
end $$;
