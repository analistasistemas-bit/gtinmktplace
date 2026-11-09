-- ADR-0201 (Galeria da cor por IA), Task 2: tabelas, saga e cobrança compartilhada.
--
-- 1. Identidade = anúncio/partição: toda tabela galeria_* (exceto galeria_cursores) grava anuncio_externo_id.
--    FK com `on delete cascade`: "Remover" (remover-publicado) e preparar_republicacao apagam
--    anuncios_externos; restrict quebraria esses fluxos. familia_id é só a versão dos dados (sem FK: famílias
--    antigas são apagadas por esses mesmos fluxos). A cobrança não se perde: platform_image_deliveries não
--    referencia a galeria.
-- 2. Trava de escrita por MLB (ml_item_travas) com ml_travar_itens (tudo ou nada; primeira aquisição por
--    insert … on conflict do nothing), ml_estender_trava e ml_soltar_itens; adiamento durável dos escritores
--    comuns em ml_escritas_adiadas.
-- 3. Saga: galeria_confirmar_aplicacao / galeria_iniciar_reversao (ok | item_ocupado | escrita_pendente |
--    desatualizada) e galeria_concluir_item (item terminal + agregação + soltura das travas com a quarentena
--    do último PUT, numa transação).
-- 4. Relógio no banco (pg_cron, 5 min, só SQL): ciclo_ate vencido sem lease vigente → reversao_incompleta;
--    imagem órfã há 60 min → falhou/expirada; escrita adiada órfã há 260 min → família erro + lote recalculado
--    por lote_decidir_status (espelho de decidirStatusLote em _shared/lote/finalizar.ts).
-- 5. Cobrança: o gatilho do kit só troca o trecho de competência pelo helper platform_imagem_competencia
--    (mesmo lock da org + laço de mês fechado); a galeria cobra por galeria_confirmar_exibicao →
--    galeria_registrar_entrega com preço, termos e elegibilidade congelados no pedido. platform_billing_preview
--    não muda.
-- 6. Storage: as três policies de escrita do bucket `imagens` excluem a pasta `galeria-ia` (2º segmento).
--
-- Sem begin/commit: o db push já envolve a migration numa transação.

create extension if not exists "uuid-ossp" with schema extensions;

-- ───────────────────────── 1. Cobrança compartilhada ─────────────────────────

alter table public.platform_image_deliveries
  add column origem text not null default 'kit_variacao'
    constraint platform_image_deliveries_origem_check check (origem in ('kit_variacao', 'galeria'));

-- Extraído de platform_image_delivery_on_generated (20261108094500): mesmo lock da org que
-- platform_billing_close e competência pelo relógio atual, nunca um mês já fechado.
create function public.platform_imagem_competencia(p_org uuid) returns date
language plpgsql security definer set search_path = '' as $$
declare v_month date;
begin
  perform 1 from public.organizations o where o.id = p_org for no key update;
  v_month := date_trunc('month', clock_timestamp() at time zone 'America/Fortaleza')::date;
  while exists (select 1 from public.platform_billing_statements s where s.org_id = p_org and s.month = v_month) loop
    v_month := (v_month + interval '1 month')::date;
  end loop;
  return v_month;
end;
$$;
revoke all on function public.platform_imagem_competencia(uuid) from public, anon, authenticated;

-- Corpo vigente de 20261108094500, trocando só o cálculo da competência pelo helper (que retoma o mesmo
-- lock já obtido na linha anterior: sem efeito na ordem dos locks).
create or replace function public.platform_image_delivery_on_generated() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_month date;
declare v_terms public.platform_commercial_terms%rowtype;
declare v_modulo boolean;
declare v_units smallint;
begin
  -- Mesmo lock da org que platform_billing_close toma (`for update`); `no key update` conflita com ele e
  -- não trava os FKs (key share) das demais tabelas da org. Depois do lock, cada comando enxerga o que
  -- o fechamento concorrente commitou (read committed).
  select 'imagem_ia' = any(o.modulos_habilitados) into v_modulo
    from public.organizations o where o.id = new.org_id for no key update;
  -- Relógio atual (não o início da transação) e nunca uma competência já fechada: vai para a seguinte aberta.
  v_month := public.platform_imagem_competencia(new.org_id);
  select * into v_terms from public.platform_resolve_terms(new.org_id, v_month);
  v_units := case when coalesce(v_modulo, false) and v_terms.id is not null then 1 else 0 end;
  insert into public.platform_image_deliveries (org_id, request_id, terms_id, month, unit_cents, units, total_cents, cost_usd, reason)
  values (new.org_id, new.request_id, v_terms.id, v_month, coalesce(v_terms.image_unit_cents, 0), v_units,
    coalesce(v_terms.image_unit_cents, 0) * v_units, new.custo_usd,
    case when not coalesce(v_modulo, false) then 'modulo_desligado'
      when v_terms.id is null then 'sem_condicao_comercial' end)
  on conflict (org_id, request_id) do nothing;
  return null;
end;
$$;

-- ───────────────────────── 2. Tabelas da galeria ─────────────────────────

create table public.galeria_fatos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  anuncio_externo_id uuid not null references public.anuncios_externos(id) on delete cascade,
  familia_id uuid not null,
  campo text not null,
  valor text,
  origem text not null check (origem in ('planilha', 'confirmado_operador')),
  evidencia jsonb,
  confirmado_por uuid,
  confirmado_em timestamptz,
  descartado boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (org_id, anuncio_externo_id, familia_id, campo)
);

create table public.galeria_referencias (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  anuncio_externo_id uuid not null references public.anuncios_externos(id) on delete cascade,
  familia_id uuid not null,
  cor text not null,
  vista text not null check (vista in ('frente', 'costas', 'lateral')),
  path text not null,
  sha256 text not null,
  origem text not null check (origem in ('storage', 'ml', 'upload_operador')),
  criado_em timestamptz not null default now(),
  unique (org_id, anuncio_externo_id, familia_id, cor, vista, sha256)
);

create table public.galeria_roteiros (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  anuncio_externo_id uuid not null references public.anuncios_externos(id) on delete cascade,
  familia_id uuid not null,
  versao integer not null check (versao >= 1),
  conteudo jsonb not null,
  fatos_hash text not null,
  moda boolean not null,
  status text not null default 'rascunho' check (status in ('rascunho', 'aprovado', 'desatualizado')),
  criado_por uuid,
  aprovado_por uuid,
  criado_em timestamptz not null default now(),
  aprovado_em timestamptz,
  unique (org_id, anuncio_externo_id, familia_id, versao)
);
-- Um roteiro aprovado por anúncio (de qualquer família): aprovar outro exige desatualizar o anterior antes.
create unique index galeria_roteiros_um_aprovado_uidx
  on public.galeria_roteiros (org_id, anuncio_externo_id) where status = 'aprovado';

-- Preço, termos e elegibilidade congelados quando o operador confirma o pedido (a cobrança usa só isso).
create table public.galeria_pedidos (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  anuncio_externo_id uuid not null references public.anuncios_externos(id) on delete cascade,
  familia_id uuid not null,
  roteiro_id uuid not null references public.galeria_roteiros(id),
  itens jsonb not null check (jsonb_typeof(itens) = 'array'),
  unit_cents bigint not null check (unit_cents between 0 and 9007199254740991),
  terms_id uuid references public.platform_commercial_terms(id),
  elegivel boolean not null,
  criado_por uuid,
  criado_em timestamptz not null default now()
);

-- Cursor persistido só da retenção (o despachante não usa cursor). Global, só service_role.
create table public.galeria_cursores (
  chave text primary key,
  cursor_em timestamptz,
  cursor_id uuid,
  atualizado_em timestamptz not null default now()
);

create table public.galeria_imagens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  anuncio_externo_id uuid not null references public.anuncios_externos(id) on delete cascade,
  familia_id uuid not null,
  pedido_id uuid not null references public.galeria_pedidos(id),
  roteiro_id uuid not null references public.galeria_roteiros(id),
  cor text not null,
  missao smallint not null check (missao between 1 and 7),
  geracao smallint not null check (geracao >= 1),
  request_id uuid not null,
  origem text not null default 'gerador' check (origem in ('gerador', 'recorte')),
  referencia_id uuid references public.galeria_referencias(id),
  modelo text,
  provedor text,
  provider_request_id text,
  fase integer not null default 0,
  tentativa integer not null default 0,
  despacho_seq integer not null default 0,
  posse uuid,
  lease_ate timestamptz,
  publicado_em timestamptz,
  prazo_ate timestamptz,
  status text not null default 'pendente' check (status in
    ('pendente', 'submetendo', 'gerando', 'gerada', 'falhou', 'aprovada', 'descartada', 'desatualizada')),
  prompt text,
  cena_path text,
  final_path text,
  final_upload_path text,
  final_sha256 text,
  custo_usd numeric(12, 6) check (custo_usd is null or custo_usd >= 0),
  alertas jsonb,
  erro text,
  entregue_em timestamptz,
  aprovado_por uuid,
  aprovado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (org_id, request_id)
);
-- Vaga por (roteiro, cor, missão): falha técnica não ocupa a geração.
create unique index galeria_imagens_vaga_uidx
  on public.galeria_imagens (org_id, roteiro_id, cor, missao, geracao) where status <> 'falhou';
create index galeria_imagens_pedido_idx on public.galeria_imagens (pedido_id);

create table public.galeria_aplicacoes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  anuncio_externo_id uuid not null references public.anuncios_externos(id) on delete cascade,
  familia_id uuid not null,
  cor text not null,
  modo text not null check (modo in ('substituir', 'adicionar')),
  retrato jsonb,
  -- [{imagem_id, missao, final_sha256}] ordenado; imutável (gatilho abaixo).
  manifesto jsonb not null check (jsonb_typeof(manifesto) = 'array'),
  roteiro_id uuid not null references public.galeria_roteiros(id),
  fatos_hash text not null,
  prazo_ate timestamptz,
  -- Relógio do ciclo de execução: now() + 3 h ao confirmar e de novo ao iniciar a reversão; nunca renovado.
  ciclo_ate timestamptz,
  abortar_em timestamptz,
  status text not null default 'preparada' check (status in ('preparada', 'em_andamento', 'aplicada', 'abortando',
    'falhou', 'revertendo', 'revertida', 'reversao_incompleta')),
  aplicado_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.galeria_aplicacao_itens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  anuncio_externo_id uuid not null references public.anuncios_externos(id) on delete cascade,
  aplicacao_id uuid not null references public.galeria_aplicacoes(id),
  item_id text not null,
  fotos_antes jsonb,
  fotos_novas jsonb,
  fotos_depois jsonb,
  status text not null default 'pendente' check (status in ('pendente', 'subindo', 'aplicando', 'aplicado', 'falhou',
    'compensando', 'compensado', 'reversao_incompleta', 'pulado')),
  variacoes_alvo jsonb,
  corpo_planejado jsonb,
  base_esperada jsonb,
  destino jsonb,
  put_em timestamptz,
  compensar_ate timestamptz,
  fase integer not null default 0,
  despacho_seq integer not null default 0,
  posse uuid,
  lease_ate timestamptz,
  publicado_em timestamptz,
  erro text,
  atualizado_em timestamptz not null default now(),
  unique (aplicacao_id, item_id)
);

-- Id da foto lido no GET depois do PUT, por imagem e por item.
create table public.galeria_imagem_itens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  anuncio_externo_id uuid not null references public.anuncios_externos(id) on delete cascade,
  imagem_id uuid not null references public.galeria_imagens(id),
  aplicacao_id uuid not null references public.galeria_aplicacoes(id),
  item_id text not null,
  upload_id text,
  picture_id text,
  criado_em timestamptz not null default now(),
  unique (imagem_id, item_id, aplicacao_id)
);

-- Trava de escrita por MLB. galeria: nunca expira (expira_em nulo); escritor: TTL; quarentena: até
-- put_em + 15 min do último PUT da galeria, bloqueia qualquer dono (inclusive o próprio).
create table public.ml_item_travas (
  org_id uuid not null references public.organizations(id),
  item_id text not null,
  dono_tipo text not null check (dono_tipo in ('galeria', 'escritor', 'quarentena')),
  dono_id uuid not null,
  expira_em timestamptz,
  criado_em timestamptz not null default now(),
  primary key (org_id, item_id),
  check ((dono_tipo = 'galeria') = (expira_em is null))
);
create index ml_item_travas_dono_idx on public.ml_item_travas (dono_id);

-- Adiamento durável dos escritores comuns (update-familia-ml, publicar-split-ml) que colidiram com a trava.
create table public.ml_escritas_adiadas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  familia_id uuid not null,
  lote_id uuid not null,
  endpoint text not null,
  itens text[] not null check (cardinality(itens) > 0),
  job jsonb not null,
  adiado_desde timestamptz not null default now(),   -- relógio do teto; nunca regravado
  proxima_em timestamptz not null default now(),
  posse uuid,
  assumida_ate timestamptz,
  unique (familia_id, lote_id, endpoint)
);
create index ml_escritas_adiadas_org_itens_idx on public.ml_escritas_adiadas using gin (itens);

-- RLS: leitura pela org, escrita só service_role.
do $$
declare t text;
begin
  foreach t in array array['galeria_fatos', 'galeria_referencias', 'galeria_roteiros', 'galeria_pedidos',
    'galeria_imagens', 'galeria_aplicacoes', 'galeria_aplicacao_itens', 'galeria_imagem_itens',
    'ml_item_travas', 'ml_escritas_adiadas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (org_id = (select public.current_org_id()))',
      t || ': select org', t);
  end loop;
end $$;
alter table public.galeria_cursores enable row level security;
revoke all on public.galeria_cursores from anon, authenticated;

create function public.galeria_manifesto_imutavel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'galeria_aplicacoes.manifesto é imutável' using errcode = '23514';
end;
$$;
revoke all on function public.galeria_manifesto_imutavel() from public, anon, authenticated;
create trigger galeria_aplicacoes_manifesto_imutavel
  before update of manifesto on public.galeria_aplicacoes
  for each row when (old.manifesto is distinct from new.manifesto)
  execute function public.galeria_manifesto_imutavel();

-- ───────────────────────── 3. Trava de escrita por MLB ─────────────────────────

-- Tudo ou nada: o laço roda num subbloco; item bloqueado → exceção GT409 desfaz o que o laço gravou.
-- Ordem fixa por item_id (sem deadlock). MLB sem linha: insert … on conflict do nothing — a segunda sessão
-- espera a primeira e, se ela gravou, cai no ramo da linha existente (nunca vencem as duas).
create function public.ml_travar_itens(p_org uuid, p_itens text[], p_tipo text, p_dono uuid, p_ttl_seg integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_item text;
  v_trava public.ml_item_travas%rowtype;
  v_expira timestamptz;
begin
  if p_org is null or p_dono is null or p_tipo is null or p_tipo not in ('galeria', 'escritor')
    or coalesce(cardinality(p_itens), 0) = 0 or array_position(p_itens, null) is not null
    or (p_tipo = 'galeria') <> (p_ttl_seg is null) or p_ttl_seg <= 0 then
    raise exception 'ml_travar_itens: argumentos inválidos' using errcode = '22023';
  end if;
  v_expira := case when p_tipo = 'escritor' then now() + make_interval(secs => p_ttl_seg) end;
  begin
    for v_item in select distinct i from unnest(p_itens) i order by 1 loop
      loop
        insert into public.ml_item_travas (org_id, item_id, dono_tipo, dono_id, expira_em)
        values (p_org, v_item, p_tipo, p_dono, v_expira)
        on conflict (org_id, item_id) do nothing;
        exit when found;
        select * into v_trava from public.ml_item_travas t
         where t.org_id = p_org and t.item_id = v_item for update;
        if found then
          -- expira_em nulo nunca é comparado: galeria bloqueia pelo tipo.
          if (v_trava.dono_tipo = 'quarentena' and v_trava.expira_em > now())
            or (v_trava.dono_id <> p_dono and (v_trava.dono_tipo = 'galeria'
              or (v_trava.dono_tipo = 'escritor' and v_trava.expira_em > now()))) then
            raise exception 'ml_item_ocupado' using errcode = 'GT409';
          end if;
          update public.ml_item_travas t set
            dono_tipo = p_tipo,
            dono_id = p_dono,
            expira_em = case when p_tipo = 'escritor' and t.dono_tipo = 'escritor' and t.dono_id = p_dono
              then greatest(t.expira_em, v_expira) else v_expira end,
            criado_em = case when t.dono_id = p_dono then t.criado_em else now() end
          where t.org_id = p_org and t.item_id = v_item;
          exit;
        end if;
        -- Linha apagada entre o insert e o select: tenta de novo.
      end loop;
    end loop;
  exception when sqlstate 'GT409' then
    return false;
  end;
  return true;
end;
$$;

-- Escritor estende a própria trava antes de cada PUT (nunca encurta). Falso → o PUT não sai.
create function public.ml_estender_trava(p_org uuid, p_itens text[], p_dono uuid, p_seg integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if p_seg is null or p_seg <= 0 or coalesce(cardinality(p_itens), 0) = 0 then
    raise exception 'ml_estender_trava: argumentos inválidos' using errcode = '22023';
  end if;
  update public.ml_item_travas t set expira_em = greatest(t.expira_em, now() + make_interval(secs => p_seg))
   where t.org_id = p_org and t.item_id = any(p_itens) and t.dono_id = p_dono and t.dono_tipo = 'escritor';
  get diagnostics v_n = row_count;
  return v_n = (select count(distinct i) from unnest(p_itens) i);
end;
$$;

-- Escritor solta a própria trava (só com resposta definitiva do ML). Nunca apaga quarentena nem trava
-- galeria: essas saem por galeria_concluir_item / relógio, com a quarentena do último PUT.
create function public.ml_soltar_itens(p_org uuid, p_dono uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  delete from public.ml_item_travas t where t.org_id = p_org and t.dono_id = p_dono and t.dono_tipo = 'escritor';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Interno: solta as travas galeria de uma aplicação. Item com PUT da galeria (ida ou compensação) há menos
-- de 15 min vira quarentena até put_em + 15 min; sem PUT recente a linha é apagada.
create function public.galeria_soltar_travas(p_org uuid, p_aplicacao uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.ml_item_travas t set dono_tipo = 'quarentena', expira_em = i.put_em + interval '15 minutes'
    from public.galeria_aplicacao_itens i
   where t.org_id = p_org and t.dono_id = p_aplicacao and t.dono_tipo = 'galeria'
     and i.aplicacao_id = p_aplicacao and i.item_id = t.item_id
     and i.put_em + interval '15 minutes' > now();
  delete from public.ml_item_travas t
   where t.org_id = p_org and t.dono_id = p_aplicacao and t.dono_tipo = 'galeria';
end;
$$;

-- ───────────────────────── 4. Saga ─────────────────────────

-- Interno (o chamador já travou a aplicação): se todos os itens estão terminais para o estado atual,
-- grava o estado terminal pela regra e solta as travas. Devolve o estado depois da agregação.
-- Terminal: em_andamento → aplicado|falhou|pulado|reversao_incompleta;
--           abortando/revertendo → compensado|falhou|pulado|reversao_incompleta (aplicado ainda compensa).
-- Regra, em ordem: algum reversao_incompleta → reversao_incompleta; em_andamento com todos aplicado → aplicada;
-- algum compensado → revertida; só falhou/pulado → falhou.
create function public.galeria_agregar_aplicacao(p_aplicacao uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_apl public.galeria_aplicacoes%rowtype;
  v_terminais text[];
  v_total integer;
  v_abertos integer;
  v_incompletos integer;
  v_aplicados integer;
  v_compensados integer;
  v_novo text;
begin
  select * into v_apl from public.galeria_aplicacoes a where a.id = p_aplicacao;
  if v_apl.status not in ('em_andamento', 'abortando', 'revertendo') then
    return v_apl.status;
  end if;
  v_terminais := case when v_apl.status = 'em_andamento'
    then array['aplicado', 'falhou', 'pulado', 'reversao_incompleta']
    else array['compensado', 'falhou', 'pulado', 'reversao_incompleta'] end;
  select count(*), count(*) filter (where not i.status = any(v_terminais)),
         count(*) filter (where i.status = 'reversao_incompleta'),
         count(*) filter (where i.status = 'aplicado'),
         count(*) filter (where i.status = 'compensado')
    into v_total, v_abertos, v_incompletos, v_aplicados, v_compensados
    from public.galeria_aplicacao_itens i where i.aplicacao_id = p_aplicacao;
  if v_abertos > 0 then
    return v_apl.status;
  end if;
  v_novo := case
    when v_incompletos > 0 then 'reversao_incompleta'
    when v_apl.status = 'em_andamento' and v_aplicados = v_total then 'aplicada'
    when v_compensados > 0 then 'revertida'
    else 'falhou' end;
  update public.galeria_aplicacoes a set status = v_novo, atualizado_em = now() where a.id = p_aplicacao;
  perform public.galeria_soltar_travas(v_apl.org_id, p_aplicacao);
  return v_novo;
end;
$$;

-- Itens da aplicação (para trava e para o predicado de escrita pendente).
create function public.galeria_itens_da_aplicacao(p_aplicacao uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select array_agg(distinct i.item_id order by i.item_id) from public.galeria_aplicacao_itens i where i.aplicacao_id = p_aplicacao
$$;

create function public.galeria_confirmar_aplicacao(p_org uuid, p_familia uuid, p_aplicacao uuid,
  p_roteiro_id uuid, p_fatos_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_apl public.galeria_aplicacoes%rowtype;
  v_itens text[];
begin
  select * into v_apl from public.galeria_aplicacoes a where a.id = p_aplicacao and a.org_id = p_org for update;
  if not found then
    raise exception 'aplicacao_inexistente' using errcode = 'P0002';
  end if;
  if v_apl.status <> 'preparada' then
    raise exception 'aplicacao_nao_preparada' using errcode = '22023';
  end if;
  -- Vigência: família, roteiro e fatos do preparo; roteiro ainda o aprovado do anúncio; todo item do
  -- manifesto ainda é a aprovada daquele roteiro com o mesmo sha. Não muda nada (continua preparada).
  if v_apl.familia_id is distinct from p_familia or v_apl.roteiro_id is distinct from p_roteiro_id
    or v_apl.fatos_hash is distinct from p_fatos_hash
    or not exists (select 1 from public.galeria_roteiros r where r.id = v_apl.roteiro_id and r.org_id = p_org
                    and r.anuncio_externo_id = v_apl.anuncio_externo_id and r.status = 'aprovado')
    or exists (select 1 from jsonb_array_elements(v_apl.manifesto) m
                where not exists (select 1 from public.galeria_imagens g
                                   where g.id = (m->>'imagem_id')::uuid and g.org_id = p_org
                                     and g.anuncio_externo_id = v_apl.anuncio_externo_id
                                     and g.roteiro_id = v_apl.roteiro_id and g.status = 'aprovada'
                                     and g.final_sha256 = m->>'final_sha256')) then
    return 'desatualizada';
  end if;
  v_itens := public.galeria_itens_da_aplicacao(p_aplicacao);
  if exists (select 1 from public.ml_escritas_adiadas e where e.org_id = p_org and e.itens && v_itens) then
    return 'escrita_pendente';
  end if;
  if not public.ml_travar_itens(p_org, v_itens, 'galeria', p_aplicacao, null) then
    return 'item_ocupado';
  end if;
  update public.galeria_aplicacoes a set status = 'em_andamento', prazo_ate = now() + interval '30 minutes',
    ciclo_ate = now() + interval '3 hours', atualizado_em = now()
   where a.id = p_aplicacao;
  return 'ok';
end;
$$;

-- p_familia não filtra: reverter é operação histórica (mesmo anúncio, qualquer família da linha).
create function public.galeria_iniciar_reversao(p_org uuid, p_familia uuid, p_aplicacao uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_apl public.galeria_aplicacoes%rowtype;
  v_itens text[];
begin
  select * into v_apl from public.galeria_aplicacoes a where a.id = p_aplicacao and a.org_id = p_org for update;
  if not found then
    raise exception 'aplicacao_inexistente' using errcode = 'P0002';
  end if;
  if v_apl.status <> 'aplicada' then
    raise exception 'aplicacao_nao_aplicada' using errcode = '22023';
  end if;
  v_itens := public.galeria_itens_da_aplicacao(p_aplicacao);
  if exists (select 1 from public.ml_escritas_adiadas e where e.org_id = p_org and e.itens && v_itens) then
    return 'escrita_pendente';
  end if;
  if not public.ml_travar_itens(p_org, v_itens, 'galeria', p_aplicacao, null) then
    return 'item_ocupado';
  end if;
  update public.galeria_aplicacoes a set status = 'revertendo', ciclo_ate = now() + interval '3 hours',
    atualizado_em = now()
   where a.id = p_aplicacao;
  update public.galeria_aplicacao_itens i set status = 'compensando', compensar_ate = now() + interval '60 minutes',
    atualizado_em = now()
   where i.aplicacao_id = p_aplicacao and i.status = 'aplicado';
  return 'ok';
end;
$$;

-- Encerramento atômico: item terminal (condicionado à posse) + aborto + agregação + soltura das travas.
create function public.galeria_concluir_item(p_item uuid, p_posse uuid, p_status text, p_dados jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_apl uuid;
  v_status text;
begin
  if p_status is null or p_status not in ('aplicado', 'falhou', 'pulado', 'compensado', 'reversao_incompleta') then
    raise exception 'galeria_concluir_item: status inválido' using errcode = '22023';
  end if;
  select i.aplicacao_id into v_apl from public.galeria_aplicacao_itens i where i.id = p_item;
  if not found then
    raise exception 'item_inexistente' using errcode = 'P0002';
  end if;
  select a.status into v_status from public.galeria_aplicacoes a where a.id = v_apl for update;
  update public.galeria_aplicacao_itens i set
    status = p_status,
    fotos_depois = case when coalesce(p_dados, '{}'::jsonb) ? 'fotos_depois' then p_dados->'fotos_depois' else i.fotos_depois end,
    erro = case when coalesce(p_dados, '{}'::jsonb) ? 'erro' then p_dados->>'erro' else i.erro end,
    posse = null, lease_ate = null, publicado_em = null, atualizado_em = now()
   where i.id = p_item and i.posse = p_posse;
  if not found then
    return v_status;   -- posse perdida: nada gravado
  end if;
  if p_status in ('falhou', 'reversao_incompleta') and v_status = 'em_andamento' then
    update public.galeria_aplicacoes a set status = 'abortando', atualizado_em = now() where a.id = v_apl;
    update public.galeria_aplicacao_itens i set status = 'compensando', compensar_ate = now() + interval '60 minutes',
      atualizado_em = now()
     where i.aplicacao_id = v_apl and i.status = 'aplicado';
  end if;
  return public.galeria_agregar_aplicacao(v_apl);
end;
$$;

-- ───────────────────────── 5. Pedido e cobrança ─────────────────────────

-- p_pedido = {id, org_id, anuncio_externo_id, familia_id, roteiro_id, unit_cents, terms_id, elegivel, criado_por,
--   itens: [{cor, missao, origem?, modelo?, provedor?, referencia_id?}]}.
-- request_id = extensions.uuid_generate_v5(<id do pedido>, cor || ':' || missao || ':' || geracao)
-- (idDerivado do TS tem de produzir o mesmo valor). Mesmo id repetido → devolve as linhas existentes.
create function public.galeria_reservar_pedido(p_pedido jsonb)
returns setof public.galeria_imagens language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_org uuid;
  v_anuncio uuid;
  v_familia uuid;
  v_roteiro uuid;
  v_item jsonb;
  v_cor text;
  v_missao smallint;
  v_origem text;
  v_geracao smallint;
  v_linha public.galeria_imagens%rowtype;
begin
  begin
    v_id := (p_pedido->>'id')::uuid;
    v_org := (p_pedido->>'org_id')::uuid;
    v_anuncio := (p_pedido->>'anuncio_externo_id')::uuid;
    v_familia := (p_pedido->>'familia_id')::uuid;
    v_roteiro := (p_pedido->>'roteiro_id')::uuid;
  exception when others then
    raise exception 'pedido inválido' using errcode = '22023';
  end;
  if v_id is null or v_org is null or v_anuncio is null or v_familia is null or v_roteiro is null
    or jsonb_typeof(p_pedido->'itens') is distinct from 'array' or jsonb_array_length(p_pedido->'itens') = 0
    or jsonb_typeof(p_pedido->'elegivel') is distinct from 'boolean'
    or jsonb_typeof(p_pedido->'unit_cents') is distinct from 'number' then
    raise exception 'pedido inválido' using errcode = '22023';
  end if;
  -- Serializa pedidos do mesmo anúncio (vaga e teto sem corrida).
  perform pg_advisory_xact_lock(hashtextextended('galeria_pedido:' || v_anuncio::text, 0));

  if exists (select 1 from public.galeria_pedidos p where p.id = v_id) then
    if not exists (select 1 from public.galeria_pedidos p where p.id = v_id and p.org_id = v_org
                    and p.anuncio_externo_id = v_anuncio) then
      raise exception 'pedido de outro anúncio' using errcode = '42501';
    end if;
    return query select * from public.galeria_imagens g where g.pedido_id = v_id order by g.cor, g.missao, g.geracao;
    return;
  end if;

  if not exists (select 1 from public.galeria_roteiros r where r.id = v_roteiro and r.org_id = v_org
                  and r.anuncio_externo_id = v_anuncio) then
    raise exception 'roteiro de outro anúncio' using errcode = '42501';
  end if;

  insert into public.galeria_pedidos (id, org_id, anuncio_externo_id, familia_id, roteiro_id, itens, unit_cents,
    terms_id, elegivel, criado_por)
  values (v_id, v_org, v_anuncio, v_familia, v_roteiro, p_pedido->'itens', (p_pedido->>'unit_cents')::bigint,
    (p_pedido->>'terms_id')::uuid, (p_pedido->>'elegivel')::boolean, (p_pedido->>'criado_por')::uuid);

  for v_item in select value from jsonb_array_elements(p_pedido->'itens') loop
    v_cor := v_item->>'cor';
    v_missao := (v_item->>'missao')::smallint;
    v_origem := coalesce(v_item->>'origem', 'gerador');
    if v_cor is null or v_missao is null then
      raise exception 'pedido inválido' using errcode = '22023';
    end if;
    if exists (select 1 from public.galeria_imagens g where g.org_id = v_org and g.anuncio_externo_id = v_anuncio
                and g.cor = v_cor and g.missao = v_missao and g.status in ('pendente', 'submetendo', 'gerando')) then
      raise exception 'em_andamento' using errcode = 'P0001';
    end if;
    if v_origem = 'gerador' and (select count(*) from public.galeria_imagens g
        where g.org_id = v_org and g.roteiro_id = v_roteiro and g.cor = v_cor and g.missao = v_missao
          and g.origem = 'gerador' and g.status <> 'falhou') >= 3 then
      raise exception 'teto' using errcode = 'P0001';
    end if;
    select coalesce(max(g.geracao), 0) + 1 into v_geracao from public.galeria_imagens g
     where g.org_id = v_org and g.roteiro_id = v_roteiro and g.cor = v_cor and g.missao = v_missao
       and g.status <> 'falhou';
    insert into public.galeria_imagens (org_id, anuncio_externo_id, familia_id, pedido_id, roteiro_id, cor, missao,
      geracao, request_id, origem, referencia_id, modelo, provedor)
    values (v_org, v_anuncio, v_familia, v_id, v_roteiro, v_cor, v_missao, v_geracao,
      extensions.uuid_generate_v5(v_id, v_cor || ':' || v_missao || ':' || v_geracao), v_origem,
      (v_item->>'referencia_id')::uuid, v_item->>'modelo', v_item->>'provedor')
    returning * into v_linha;
    return next v_linha;
  end loop;
end;
$$;

-- Uma entrega por imagem gerador, com preço, termos e elegibilidade do pedido (sem platform_resolve_terms nem
-- leitura do módulo); só a competência segue o mês da exibição (mesmo lock e regra de mês fechado do kit).
-- Motivo quando não elegível: sem termos no pedido → sem_condicao_comercial; com termos → modulo_desligado.
create function public.galeria_registrar_entrega(p_imagem uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v record;
  v_month date;
  v_units smallint;
begin
  select g.org_id, g.request_id, g.custo_usd, p.unit_cents, p.terms_id, p.elegivel into v
    from public.galeria_imagens g join public.galeria_pedidos p on p.id = g.pedido_id
   where g.id = p_imagem and g.origem = 'gerador';
  if not found then
    raise exception 'imagem não cobrável' using errcode = 'P0002';
  end if;
  v_month := public.platform_imagem_competencia(v.org_id);
  v_units := case when v.elegivel then 1 else 0 end;
  insert into public.platform_image_deliveries (org_id, request_id, terms_id, month, unit_cents, units, total_cents,
    cost_usd, reason, origem)
  values (v.org_id, v.request_id, v.terms_id, v_month, v.unit_cents, v_units, v.unit_cents * v_units, v.custo_usd,
    case when v.elegivel then null when v.terms_id is null then 'sem_condicao_comercial' else 'modulo_desligado' end,
    'galeria')
  on conflict (org_id, request_id) do nothing;
end;
$$;

-- Cobrança da galeria sem gatilho: o navegador confirma a exibição; só imagem gerador já produzida
-- (independente do status editorial) com cena e custo, uma vez.
create function public.galeria_confirmar_exibicao(p_org uuid, p_anuncio uuid, p_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  for v_id in
    update public.galeria_imagens g set entregue_em = now(), atualizado_em = now()
     where g.org_id = p_org and g.anuncio_externo_id = p_anuncio and g.id = any(p_ids) and g.origem = 'gerador'
       and g.status in ('gerada', 'aprovada', 'descartada', 'desatualizada')
       and g.cena_path is not null and g.custo_usd is not null and g.entregue_em is null
    returning g.id
  loop
    perform public.galeria_registrar_entrega(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ───────────────────────── 6. Relógio no banco ─────────────────────────

-- Espelho SQL de decidirStatusLote (_shared/lote/finalizar.ts). null = não mexer.
create function public.lote_decidir_status(p_lote uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when count(*) filter (where f.status = 'publicando') > 0 then null
    when count(*) filter (where f.status = 'pronto') > 0 then 'revisao'
    when count(*) filter (where f.status in ('pendente', 'processando')) > 0 then 'processando'
    when count(*) filter (where f.status = 'erro') > 0 and count(*) filter (where f.status = 'publicado') = 0 then 'revisao'
    else 'concluido' end
  from public.familias f where f.lote_id = p_lote
$$;

-- pg_cron a cada 5 min (só SQL, não publica no QStash).
create function public.galeria_relogio()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_lote text;
  v_apl integer := 0;
  v_img integer := 0;
  v_adiadas integer := 0;
begin
  -- (a) Ciclo vencido e nenhum lease vigente: itens não terminais → reversao_incompleta e agregação
  -- (estado terminal + travas soltas com a quarentena do último PUT), tudo nesta transação.
  for r in select a.id, a.status from public.galeria_aplicacoes a
            where a.status in ('em_andamento', 'abortando', 'revertendo') and a.ciclo_ate < now()
              and not exists (select 1 from public.galeria_aplicacao_itens i
                               where i.aplicacao_id = a.id and i.lease_ate > now())
            for update of a skip locked loop
    update public.galeria_aplicacao_itens i set status = 'reversao_incompleta', erro = coalesce(i.erro, 'ciclo_expirado'),
      posse = null, lease_ate = null, atualizado_em = now()
     where i.aplicacao_id = r.id and not i.status = any(case when r.status = 'em_andamento'
       then array['aplicado', 'falhou', 'pulado', 'reversao_incompleta']
       else array['compensado', 'falhou', 'pulado', 'reversao_incompleta'] end);
    perform public.galeria_agregar_aplicacao(r.id);
    v_apl := v_apl + 1;
  end loop;

  -- (b) Imagem órfã: sem chamada nova nem cobrança.
  update public.galeria_imagens g set status = 'falhou', erro = 'expirada', posse = null, lease_ate = null,
    atualizado_em = now()
   where g.status in ('pendente', 'submetendo', 'gerando') and g.criado_em + interval '60 minutes' < now()
     and (g.lease_ate is null or g.lease_ate < now());
  get diagnostics v_img = row_count;

  -- (c) Escrita adiada órfã (260 min, não assumida, sem trava escritor vigente da posse): erro só sobre
  -- publicando, lote recalculado, linha apagada. Não toca em variacoes.
  for r in select e.id, e.familia_id, e.lote_id from public.ml_escritas_adiadas e
            where e.adiado_desde + interval '260 minutes' < now()
              and (e.assumida_ate is null or e.assumida_ate < now())
              and not exists (select 1 from public.ml_item_travas t where t.org_id = e.org_id
                               and t.dono_tipo = 'escritor' and t.dono_id = e.posse and t.expira_em > now())
            for update of e skip locked loop
    update public.familias f set status = 'erro', erro_mensagem = 'item_reservado_galeria'
     where f.id = r.familia_id and f.status = 'publicando';
    v_lote := public.lote_decidir_status(r.lote_id);
    if v_lote is not null then
      update public.lotes l set status = v_lote::public.lote_status where l.id = r.lote_id;
    end if;
    delete from public.ml_escritas_adiadas e where e.id = r.id;
    v_adiadas := v_adiadas + 1;
  end loop;

  return jsonb_build_object('aplicacoes', v_apl, 'imagens', v_img, 'escritas_adiadas', v_adiadas);
end;
$$;

do $$
declare v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'galeria-relogio' loop
    perform cron.unschedule(v_job_id);
  end loop;
end $$;
select cron.schedule('galeria-relogio', '*/5 * * * *', 'select public.galeria_relogio();');

-- ───────────────────────── 7. Privilégios das funções ─────────────────────────

revoke all on function public.ml_travar_itens(uuid, text[], text, uuid, integer) from public, anon, authenticated;
revoke all on function public.ml_estender_trava(uuid, text[], uuid, integer) from public, anon, authenticated;
revoke all on function public.ml_soltar_itens(uuid, uuid) from public, anon, authenticated;
revoke all on function public.galeria_soltar_travas(uuid, uuid) from public, anon, authenticated;
revoke all on function public.galeria_agregar_aplicacao(uuid) from public, anon, authenticated;
revoke all on function public.galeria_itens_da_aplicacao(uuid) from public, anon, authenticated;
revoke all on function public.galeria_confirmar_aplicacao(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.galeria_iniciar_reversao(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.galeria_concluir_item(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.galeria_reservar_pedido(jsonb) from public, anon, authenticated;
revoke all on function public.galeria_registrar_entrega(uuid) from public, anon, authenticated;
revoke all on function public.galeria_confirmar_exibicao(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.lote_decidir_status(uuid) from public, anon, authenticated;
revoke all on function public.galeria_relogio() from public, anon, authenticated;

grant execute on function public.ml_travar_itens(uuid, text[], text, uuid, integer) to service_role;
grant execute on function public.ml_estender_trava(uuid, text[], uuid, integer) to service_role;
grant execute on function public.ml_soltar_itens(uuid, uuid) to service_role;
grant execute on function public.galeria_confirmar_aplicacao(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.galeria_iniciar_reversao(uuid, uuid, uuid) to service_role;
grant execute on function public.galeria_concluir_item(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.galeria_reservar_pedido(jsonb) to service_role;
grant execute on function public.galeria_confirmar_exibicao(uuid, uuid, uuid[]) to service_role;

-- ───────────────────────── 8. Storage ─────────────────────────

-- Texto de 20260725224000_support_access.sql:337 + exclusão da pasta galeria-ia (só service_role e URL
-- assinada da edge escrevem nela). A leitura (imagens: select org) não muda.
drop policy if exists "imagens: insert org writable" on storage.objects;
drop policy if exists "imagens: update org writable" on storage.objects;
drop policy if exists "imagens: delete org writable" on storage.objects;
create policy "imagens: insert org writable" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'imagens'
    and (select public.can_write_current_org())
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (storage.foldername(name))[1] = (select public.current_org_id())::text
    )
    and (storage.foldername(name))[2] is distinct from 'galeria-ia'
  );
create policy "imagens: update org writable" on storage.objects
  for update to authenticated using (
    bucket_id = 'imagens'
    and (select public.can_write_current_org())
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (storage.foldername(name))[1] = (select public.current_org_id())::text
    )
    and (storage.foldername(name))[2] is distinct from 'galeria-ia'
  ) with check (
    bucket_id = 'imagens'
    and (select public.can_write_current_org())
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (storage.foldername(name))[1] = (select public.current_org_id())::text
    )
    and (storage.foldername(name))[2] is distinct from 'galeria-ia'
  );
create policy "imagens: delete org writable" on storage.objects
  for delete to authenticated using (
    bucket_id = 'imagens'
    and (select public.can_write_current_org())
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (storage.foldername(name))[1] = (select public.current_org_id())::text
    )
    and (storage.foldername(name))[2] is distinct from 'galeria-ia'
  );
