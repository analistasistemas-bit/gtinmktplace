-- ADR-0181 D-12 (Plano 2b-2, Task 4): foto de 31/12 do inventário — tabelas imutáveis, geração
-- por org, procedure com commit por org, job do pg_cron e leituras JSON (hoje e foto).
-- Spec: docs/superpowers/specs/2026-10-16-pacote-contador-inventario-design.md (§Modelo de dados,
-- §Matriz de privilégios, §Foto de 31/12).

-- ---------------------------------------------------------------------------------------------
-- 1) Tabelas
-- ---------------------------------------------------------------------------------------------
create table public.inventarios (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  data_base          date not null,
  gerado_em          timestamptz not null,           -- instante real da leitura do saldo
  origem             text not null check (origem in ('cron', 'manual')),
  -- congelados de empresa_fiscal no momento da foto
  cnpj               text,
  inscricao_estadual text,
  razao_social       text,
  status             text not null check (status in ('aberto', 'confirmado', 'falhou')),
  erro               text,
  versao             int not null default 0,          -- sobe a cada salvar_contagem_inventario
  -- Sem FK: o cabeçalho confirmado recusa qualquer update, e um `on delete set null` vindo da
  -- exclusão do usuário bateria no trigger e travaria a exclusão. O nome sai na leitura.
  confirmado_por     uuid,
  confirmado_em      timestamptz,
  unique (org_id, data_base),
  unique (id, org_id),
  check ((status = 'falhou') = (erro is not null))
);
comment on table public.inventarios is
  'ADR-0181 D-12: cabeçalho da foto de inventário de 31/12 (imutável por trigger; contagem/confirmação na Task 5).';

create table public.inventarios_itens (
  id                   uuid primary key default gen_random_uuid(),
  inventario_id        uuid not null,
  org_id               uuid not null,
  -- foto (congelada): linha de inventario_calcular
  codigo               text not null,
  codigo_pai           text not null,
  descricao            text,
  ncm                  text,
  unidade              text,
  cor                  text,
  tamanho              text,
  quantidade_sistema   int not null,
  qtd_valorizada       int not null,
  qtd_sem_nota         int not null,
  custo_medio          numeric(14,6),
  valor_total          numeric(14,2) not null,
  marcas               text[] not null default '{}',
  -- contagem (só com o cabeçalho 'aberto'); null = igual ao sistema
  quantidade_contada   int check (quantidade_contada >= 0),
  justificativa        text,
  -- confirmação (só confirmar_inventario, com a flag publiai.inventario_confirmando)
  qtd_final            int,
  qtd_valorizada_final int,
  qtd_sem_nota_final   int,
  valor_final          numeric(14,2),
  foreign key (inventario_id, org_id) references public.inventarios (id, org_id) on delete cascade,
  unique (inventario_id, codigo)
);
comment on table public.inventarios_itens is
  'ADR-0181 D-12: uma linha por SKU canônico da foto (inclusive saldo 0). Foto imutável; contagem e confirmação por trigger.';

-- ---------------------------------------------------------------------------------------------
-- 2) Imutabilidade
-- ---------------------------------------------------------------------------------------------
create or replace function public.inventarios_guardar_cabecalho()
returns trigger language plpgsql security invoker set search_path = public, pg_temp
as $$
begin
  -- 'confirmado' trava tudo; 'falhou' só se apaga e refaz (gerar_foto_inventario_org).
  if old.status <> 'aberto' then
    raise exception 'Inventário não está aberto (status %).', old.status;
  end if;
  if (new.id, new.org_id, new.data_base, new.gerado_em, new.origem, new.cnpj, new.inscricao_estadual,
      new.razao_social, new.erro)
     is distinct from
     (old.id, old.org_id, old.data_base, old.gerado_em, old.origem, old.cnpj, old.inscricao_estadual,
      old.razao_social, old.erro) then
    raise exception 'Cabeçalho do inventário é imutável.';
  end if;
  -- `versao` muda livre com 'aberto' (salvar). Transição e confirmado_por/em: só aberto → confirmado com a flag.
  if (new.status, new.confirmado_por, new.confirmado_em) is distinct from (old.status, old.confirmado_por, old.confirmado_em)
     and not (new.status = 'confirmado'
              and coalesce(current_setting('publiai.inventario_confirmando', true), '') = 'on') then
    raise exception 'Confirmação do inventário só por confirmar_inventario.';
  end if;
  return new;
end $$;

create trigger inventarios_guardar_cabecalho
  before update on public.inventarios
  for each row execute function public.inventarios_guardar_cabecalho();

create or replace function public.inventarios_itens_guardar()
returns trigger language plpgsql security invoker set search_path = public, pg_temp
as $$
begin
  if (new.id, new.inventario_id, new.org_id, new.codigo, new.codigo_pai, new.descricao, new.ncm, new.unidade,
      new.cor, new.tamanho, new.quantidade_sistema, new.qtd_valorizada, new.qtd_sem_nota, new.custo_medio,
      new.valor_total, new.marcas)
     is distinct from
     (old.id, old.inventario_id, old.org_id, old.codigo, old.codigo_pai, old.descricao, old.ncm, old.unidade,
      old.cor, old.tamanho, old.quantidade_sistema, old.qtd_valorizada, old.qtd_sem_nota, old.custo_medio,
      old.valor_total, old.marcas) then
    raise exception 'Foto do inventário é imutável.';
  end if;
  if (select i.status from public.inventarios i where i.id = old.inventario_id) is distinct from 'aberto' then
    raise exception 'Inventário não está aberto.';
  end if;
  if (new.qtd_final, new.qtd_valorizada_final, new.qtd_sem_nota_final, new.valor_final)
     is distinct from (old.qtd_final, old.qtd_valorizada_final, old.qtd_sem_nota_final, old.valor_final)
     and coalesce(current_setting('publiai.inventario_confirmando', true), '') <> 'on' then
    raise exception 'Confirmação do inventário só por confirmar_inventario.';
  end if;
  return new;
end $$;

create trigger inventarios_itens_guardar
  before update on public.inventarios_itens
  for each row execute function public.inventarios_itens_guardar();

-- Insert só com a flag que gerar_foto_inventario_org liga e desliga em volta do insert dos itens.
create or replace function public.inventarios_itens_bloquear_insert()
returns trigger language plpgsql security invoker set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('publiai.inventario_gerando', true), '') <> 'on' then
    raise exception 'Itens do inventário só por gerar_foto_inventario_org.';
  end if;
  return null;
end $$;

create trigger inventarios_itens_bloquear_insert
  before insert on public.inventarios_itens
  for each statement execute function public.inventarios_itens_bloquear_insert();

-- ---------------------------------------------------------------------------------------------
-- 3) RLS e grants. Membro lê a própria org; escrita só pela service_role (os default privileges
--    do Supabase dão ALL a anon/authenticated em tabela nova do public — padrão de
--    20260927084615_vendas_sku_trafego.sql). Exclusão: só service_role (cascata da org, limpeza).
-- ---------------------------------------------------------------------------------------------
alter table public.inventarios enable row level security;
alter table public.inventarios_itens enable row level security;
create policy "inventarios: select org" on public.inventarios for select to authenticated
  using (org_id = (select public.current_org_id()));
create policy "inventarios_itens: select org" on public.inventarios_itens for select to authenticated
  using (org_id = (select public.current_org_id()));
revoke all on public.inventarios, public.inventarios_itens from anon;
revoke insert, update, delete, truncate, references, trigger on public.inventarios, public.inventarios_itens
  from authenticated;
grant select on public.inventarios, public.inventarios_itens to authenticated;

revoke all on function public.inventarios_guardar_cabecalho() from public, anon, authenticated;
revoke all on function public.inventarios_itens_guardar() from public, anon, authenticated;
revoke all on function public.inventarios_itens_bloquear_insert() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4) Data-base e orgs elegíveis
-- ---------------------------------------------------------------------------------------------
-- Último 31/12 já encerrado até (agora em America/Sao_Paulo + 1 h): o disparo de 23:59 de 31/12 e um
-- disparo atrasado na madrugada de 01/01 resolvem para o 31/12 que acabou; durante o dia 31/12, para
-- o ano anterior. Nunca current_date (UTC).
create or replace function public.inventario_data_base(p_agora timestamptz)
returns date language sql immutable security invoker set search_path = public, pg_temp
as $$
  select make_date(extract(year from (p_agora at time zone 'America/Sao_Paulo') + interval '1 hour')::int - 1, 12, 31)
$$;

create or replace function public.inventario_orgs_elegiveis()
returns setof uuid language sql stable security invoker set search_path = public, pg_temp
as $$
  select o.id
    from public.organizations o
    join public.empresa_fiscal ef on ef.org_id = o.id
   where 'estoque' = any(o.modulos_habilitados)
     and o.tipo_pessoa = 'pj'
     and nullif(btrim(ef.cnpj), '') is not null
   order by o.id
$$;

-- ---------------------------------------------------------------------------------------------
-- 5) Foto de uma org (sem commit; é o que os testes chamam). 'gerada' | 'existia' | 'falhou'.
-- ---------------------------------------------------------------------------------------------
create or replace function public.gerar_foto_inventario_org(p_org uuid, p_data_base date, p_origem text)
returns text language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_id uuid;
begin
  -- Serializa cron × contingência manual da mesma org/data (a segunda vê a foto e devolve 'existia').
  perform pg_advisory_xact_lock(hashtextextended('inventario_foto:' || p_org || ':' || p_data_base, 0));

  select i.status into v_status from public.inventarios i where i.org_id = p_org and i.data_base = p_data_base;
  if v_status in ('aberto', 'confirmado') then
    return 'existia';
  end if;
  -- 'falhou' é refeita: apaga (itens em cascata) e grava de novo.
  delete from public.inventarios where org_id = p_org and data_base = p_data_base;

  begin
    insert into public.inventarios (org_id, data_base, gerado_em, origem, cnpj, inscricao_estadual, razao_social, status)
    select p_org, p_data_base, clock_timestamp(), p_origem, ef.cnpj, ef.inscricao_estadual, ef.razao_social, 'aberto'
      from (select p_org as org_id) o left join public.empresa_fiscal ef using (org_id)
    returning id into v_id;

    perform set_config('publiai.inventario_gerando', 'on', true);
    insert into public.inventarios_itens (inventario_id, org_id, codigo, codigo_pai, descricao, ncm, unidade, cor,
      tamanho, quantidade_sistema, qtd_valorizada, qtd_sem_nota, custo_medio, valor_total, marcas)
    select v_id, p_org, c.codigo, c.codigo_pai, c.descricao, c.ncm, c.unidade, c.cor, c.tamanho,
           c.quantidade_sistema, c.qtd_valorizada, c.qtd_sem_nota, c.custo_medio, c.valor_total, c.marcas
      from public.inventario_calcular(p_org) c;
    -- set_config local dura até o fim da transação (o `set search_path` da função não a restaura).
    perform set_config('publiai.inventario_gerando', 'off', true);
    return 'gerada';
  exception when others then
    -- O rollback do bloco desfaz cabeçalho, itens e a flag. query_canceled não cai aqui (spec §Foto).
    insert into public.inventarios (org_id, data_base, gerado_em, origem, cnpj, inscricao_estadual, razao_social,
      status, erro)
    select p_org, p_data_base, clock_timestamp(), p_origem, ef.cnpj, ef.inscricao_estadual, ef.razao_social,
           'falhou', sqlerrm
      from (select p_org as org_id) o left join public.empresa_fiscal ef using (org_id)
    on conflict (org_id, data_base) do nothing;
    return 'falhou';
  end;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6) Procedure do cron: uma org por transação. Sem security definer e sem `set` (impediriam o
--    commit); nomes qualificados. Sem bloco exception (commit não roda dentro de um). A
--    contingência passa p_org (fora da elegibilidade) e a data: call public.gerar_fotos_inventario('AAAA-12-31', 'manual', '<org>').
-- ---------------------------------------------------------------------------------------------
create or replace procedure public.gerar_fotos_inventario(p_data_base date default null, p_origem text default 'cron',
  p_org uuid default null)
language plpgsql
as $$
declare
  v_data date := coalesce(p_data_base, public.inventario_data_base(now()));
  v_orgs uuid[] := case when p_org is null then array(select public.inventario_orgs_elegiveis())
                        else array[p_org] end;
  v_org uuid;
begin
  foreach v_org in array v_orgs loop
    perform public.gerar_foto_inventario_org(v_org, v_data, p_origem);
    commit;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7) Leituras JSON (uma instrução cada: escalar único, sem o max_rows=1000 do PostgREST)
-- ---------------------------------------------------------------------------------------------
create or replace function public.inventario_hoje_json(p_org uuid)
returns jsonb language sql stable security invoker set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'cabecalho', jsonb_build_object(
      'data_base', (now() at time zone 'America/Sao_Paulo')::date,
      'gerado_em', now(),
      'cnpj', ef.cnpj, 'inscricao_estadual', ef.inscricao_estadual, 'razao_social', ef.razao_social,
      'status', 'hoje'),
    'itens', coalesce((select jsonb_agg(to_jsonb(c) order by c.codigo_pai, c.codigo)
                         from public.inventario_calcular(p_org) c), '[]'::jsonb))
    from (select p_org as org_id) o left join public.empresa_fiscal ef using (org_id)
$$;

-- null = sem foto nessa data (distinto de erro de leitura).
create or replace function public.inventario_foto_json(p_org uuid, p_data_base date)
returns jsonb language sql stable security invoker set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'cabecalho', jsonb_build_object(
      'id', i.id, 'data_base', i.data_base, 'gerado_em', i.gerado_em, 'origem', i.origem, 'status', i.status,
      'erro', i.erro, 'versao', i.versao, 'cnpj', i.cnpj, 'inscricao_estadual', i.inscricao_estadual,
      'razao_social', i.razao_social, 'confirmado_em', i.confirmado_em,
      -- Ruling 2: nome de exibição do perfil; vazio (default '') → e-mail do perfil.
      'confirmado_por_nome', coalesce(nullif(btrim(p.nome), ''), p.email)),
    'itens', coalesce((select jsonb_agg(to_jsonb(it) order by it.codigo_pai, it.codigo)
                         from public.inventarios_itens it
                        where it.inventario_id = i.id and it.org_id = p_org), '[]'::jsonb))
    from public.inventarios i
    left join public.profiles p on p.id = i.confirmado_por
   where i.org_id = p_org and i.data_base = p_data_base
$$;

revoke all on function public.inventario_data_base(timestamptz) from public, anon, authenticated;
revoke all on function public.inventario_orgs_elegiveis() from public, anon, authenticated;
revoke all on function public.gerar_foto_inventario_org(uuid, date, text) from public, anon, authenticated;
revoke all on procedure public.gerar_fotos_inventario(date, text, uuid) from public, anon, authenticated;
revoke all on function public.inventario_hoje_json(uuid) from public, anon, authenticated;
revoke all on function public.inventario_foto_json(uuid, date) from public, anon, authenticated;
grant execute on function public.inventario_data_base(timestamptz) to service_role;
grant execute on function public.inventario_orgs_elegiveis() to service_role;
grant execute on function public.gerar_foto_inventario_org(uuid, date, text) to service_role;
grant execute on procedure public.gerar_fotos_inventario(date, text, uuid) to service_role;
grant execute on function public.inventario_hoje_json(uuid) to service_role;
grant execute on function public.inventario_foto_json(uuid, date) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 8) pg_cron (padrão de 20260726153552_finalize_support_access.sql). cron.timezone = GMT (medições
--    (d), Ruling 5): 02:59 UTC de 01/01 = 23:59 de 31/12 em America/Sao_Paulo. O comando é uma
--    instrução só: com `set …;` antes vira transação implícita e o commit da procedure falha.
-- ---------------------------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'inventario-foto-31-12' loop
    perform cron.unschedule(v_job_id);
  end loop;
end $$;

select cron.schedule('inventario-foto-31-12', '59 2 1 1 *', 'call public.gerar_fotos_inventario()');
