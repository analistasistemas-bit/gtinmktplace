-- ADR-0200: Kit com variação. Cores combinadas × tamanho numa família User Products, com saldo
-- próprio do kit em `variacoes`. Peça muda de lugar só por saga durável (`kit_transferencias`).
--
-- Chave de vínculo é (org_id, codigo), nunca variacoes.id nem familias.id: a família ganha linha
-- nova a cada UPDATE e só o código é estável (mesma razão do ADR-0151).
--
-- `db push` não roda em transação: cada statement é re-executável.
-- Escrita só por service role; o app só lê. Toda filha carrega org_id, com FK composta, para a RLS
-- não depender de join e para nenhuma linha apontar para outra org.

create table if not exists public.kits_variacao (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  codigo_pai_base text not null,
  codigo_pai_kit  text not null,
  pecas_por_kit   smallint not null check (pecas_por_kit between 2 and 6),
  preco           numeric(12,2) not null check (preco > 0),
  so_em_kit       boolean not null default false,   -- "Vender só em kit": restrito a admin (ADR-0060)
  reposicao_auto  boolean not null default false,
  meta            integer not null default 0 check (meta >= 0),
  versao          integer not null default 1,
  -- ponytail: sem check; os valores nascem com o fluxo de criar e publicar kit.
  status          text not null default 'rascunho',
  criado_em       timestamptz not null default now(),
  constraint kits_variacao_org_codigo_pai_kit_key unique (org_id, codigo_pai_kit),
  constraint kits_variacao_id_org_id_key unique (id, org_id)
);
create index if not exists kits_variacao_base_idx on public.kits_variacao (org_id, codigo_pai_base);

create table if not exists public.kit_variacao_skus (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id),
  kit_id     uuid not null,
  codigo     text not null,
  tamanho    text not null,
  cores      text[] not null,
  rotulo_cor text not null,
  constraint kit_variacao_skus_org_codigo_key unique (org_id, codigo),
  constraint kit_variacao_skus_id_org_id_key unique (id, org_id),
  constraint kit_variacao_skus_kit_fk foreign key (kit_id, org_id) references public.kits_variacao (id, org_id)
);
create index if not exists kit_variacao_skus_kit_idx on public.kit_variacao_skus (kit_id);

-- Composição congelada: `quantidade` é peças do SKU individual `codigo` em 1 kit (invariante 2).
-- Sem cascade: SKU de kit com composição não some (contrato de segurança, item 15).
create table if not exists public.kit_variacao_componentes (
  kit_sku_id uuid not null,
  org_id     uuid not null references public.organizations(id),
  codigo     text not null,
  quantidade integer not null check (quantidade > 0),
  primary key (kit_sku_id, codigo),
  constraint kit_variacao_componentes_sku_fk foreign key (kit_sku_id, org_id)
    references public.kit_variacao_skus (id, org_id)
);
create index if not exists kit_variacao_componentes_org_codigo_idx
  on public.kit_variacao_componentes (org_id, codigo);

create or replace function public.kit_variacao_componentes_imutavel()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Composição de kit é imutável (ADR-0200).' using errcode = 'restrict_violation';
end $$;

drop trigger if exists kit_variacao_componentes_imutavel on public.kit_variacao_componentes;
create trigger kit_variacao_componentes_imutavel
  before update or delete on public.kit_variacao_componentes
  for each row execute procedure public.kit_variacao_componentes_imutavel();

-- Política agregada por SKU individual. Bloqueios separados por motivo (contrato, item 14).
create table if not exists public.sku_politica_kit (
  org_id             uuid not null references public.organizations(id),
  codigo             text not null,
  estado             text not null default 'normal' check (estado in ('normal', 'guardado', 'sobra')),
  versao             integer not null default 1,
  bloqueio_operador  boolean not null default false,
  bloqueio_moderacao boolean not null default false,
  bloqueio_retirada  boolean not null default false,
  primary key (org_id, codigo)
);

-- Quais kits em "só em kit" usam o SKU. Desligar um kit remove só a linha dele.
create table if not exists public.sku_reivindicacoes_kit (
  org_id uuid not null references public.organizations(id),
  codigo text not null,
  kit_id uuid not null,
  primary key (org_id, codigo, kit_id),
  constraint sku_reivindicacoes_kit_kit_fk foreign key (kit_id, org_id) references public.kits_variacao (id, org_id)
);
create index if not exists sku_reivindicacoes_kit_kit_idx on public.sku_reivindicacoes_kit (kit_id);

-- Saga. `kit_id` nulo só em entrada e sair_sobra: esses partem de um SKU individual, que pode
-- estar em mais de um kit.
create table if not exists public.kit_transferencias (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  kit_id          uuid,
  tipo            text not null
    check (tipo in ('montar', 'desmontar', 'repor', 'cancelamento', 'sair_sobra', 'entrada')),
  passo           text not null default 'pausar',
  estado          text not null default 'ativa' check (estado in ('ativa', 'concluida', 'travada', 'abortada')),
  versao_politica integer not null,
  itens           jsonb not null default '[]',
  alerta          text,
  execucao_token  uuid,          -- claim atômico: reentrega simultânea sai sem agir
  execucao_ate    timestamptz,
  criado_em       timestamptz not null default now(),
  passo_em        timestamptz not null default now(),
  constraint kit_transferencias_id_org_id_key unique (id, org_id),
  constraint kit_transferencias_kit_fk foreign key (kit_id, org_id) references public.kits_variacao (id, org_id),
  constraint kit_transferencias_kit_obrigatorio check (kit_id is not null or tipo in ('entrada', 'sair_sobra'))
);
create index if not exists kit_transferencias_abertas_idx
  on public.kit_transferencias (org_id) where estado in ('ativa', 'travada');
create index if not exists kit_transferencias_kit_idx on public.kit_transferencias (kit_id);

create table if not exists public.kit_transferencia_alvos (
  transferencia_id     uuid not null,
  org_id               uuid not null references public.organizations(id),
  up_id                text not null,
  item_ids             text[] not null default '{}',
  qtd_passo1           integer,
  valor_anterior       integer,
  valor_alvo           integer,
  pausado_pela_saga    text[] not null default '{}',
  intencao_escrita_em  timestamptz,   -- gravada antes do PUT: retomada sem recusa é resultado incerto
  recusa_definitiva_em timestamptz,   -- 4xx recebido: só aqui pode repetir
  escrita_em           timestamptz,
  confirmada_em        timestamptz,
  primary key (transferencia_id, up_id),
  constraint kit_transferencia_alvos_transferencia_fk foreign key (transferencia_id, org_id)
    references public.kit_transferencias (id, org_id)
);

-- Exclusão durável única por SKU: transferência, publicação e ativação disputam a mesma linha.
-- `up_id` é nulo enquanto o dono não resolveu o UP (kit_adquirir_exclusao recebe só códigos).
create table if not exists public.kit_exclusoes (
  org_id    uuid not null references public.organizations(id),
  codigo    text not null,
  up_id     text,
  dono_tipo text not null check (dono_tipo in ('transferencia', 'publicacao', 'ativacao')),
  dono_id   uuid not null,
  criado_em timestamptz not null default now(),
  primary key (org_id, codigo)
);
create index if not exists kit_exclusoes_dono_idx on public.kit_exclusoes (org_id, dono_id);

-- Ledger. Check não aceita append: derruba e recria, mantendo os motivos de 20260811201026.
alter table public.estoque_movimentos
  drop constraint if exists estoque_movimentos_motivo_check;
alter table public.estoque_movimentos
  add constraint estoque_movimentos_motivo_check check (motivo in (
    'venda', 'entrada', 'estorno_venda',
    'venda_sku_nao_encontrado', 'estorno_sku_nao_encontrado',
    'cancelamento_sem_baixa', 'venda_cancelada_antes',
    'ajuste',
    -- ADR-0200: peça saindo da origem e chegando ao destino numa transferência de kit.
    'kit_saida', 'kit_entrada'
  ));

alter table public.estoque_movimentos add column if not exists transferencia_id uuid;
alter table public.estoque_movimentos drop constraint if exists estoque_movimentos_transferencia_fk;
alter table public.estoque_movimentos
  add constraint estoque_movimentos_transferencia_fk foreign key (transferencia_id, org_id)
    references public.kit_transferencias (id, org_id);

-- Índice total de propósito: movimento antigo tem transferencia_id nulo e nulos não colidem.
-- Parcial obrigaria todo `on conflict` a repetir o predicado.
create unique index if not exists estoque_movimentos_transferencia_uniq
  on public.estoque_movimentos (transferencia_id, codigo, motivo);

-- Motivo legível para recusar desligar o módulo; null libera. Em SQL, e não na edge, porque a
-- leitura em duas etapas pelo PostgREST corta em max_rows=1000.
-- ponytail: olha qualquer linha de `variacoes` do código, não só a canônica; cópia antiga com
-- saldo recusa a mais, nunca a menos.
create or replace function public.kit_variacao_recusa_desligar(p_org uuid)
returns text language sql stable set search_path = ''
as $$
  select case
    when exists (select 1 from public.kit_transferencias t
                 where t.org_id = p_org and t.estado in ('ativa', 'travada'))
      then 'Há transferência de kit em aberto. Resolva antes de desligar o módulo.'
    when exists (select 1 from public.kit_variacao_skus s
                 join public.variacoes v on v.org_id = s.org_id and v.codigo = s.codigo
                 where s.org_id = p_org and v.estoque > 0)
      then 'Há kit com saldo. Desmonte os kits antes de desligar o módulo.'
  end
$$;

revoke all on function public.kit_variacao_recusa_desligar(uuid) from public, anon, authenticated;
grant execute on function public.kit_variacao_recusa_desligar(uuid) to service_role;

-- Única escrita de `modulos_habilitados` pela edge `usuarios`: trava, valida e grava numa transação,
-- para nenhuma transferência abrir entre a validação e a gravação.
--
-- CONTRATO DOS ESCRITORES DE SAGA (criarTransferencia, Tasks 2 e 4): na mesma transação em que criam
-- a transferência, travar esta mesma linha (`select modulos_habilitados from public.organizations
-- where id = p_org for share`) e revalidar que `kit_variacao` segue ligado. O insert sozinho não
-- basta: a FK espera este lock, mas depois grava com o módulo já desligado.
-- `for share` e não `for update`: transferências simultâneas não devem se enfileirar entre si.
create or replace function public.set_modulos_org_seguro(p_org uuid, p_modulos text[])
returns jsonb language plpgsql set search_path = ''
as $$
declare v_recusa text;
begin
  perform 1 from public.organizations where id = p_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'Empresa não encontrada.');
  end if;

  if not ('kit_variacao' = any(p_modulos)) then
    v_recusa := public.kit_variacao_recusa_desligar(p_org);
    if v_recusa is not null then
      return jsonb_build_object('ok', false, 'motivo', v_recusa);
    end if;
  end if;

  update public.organizations
  set modulos_habilitados = p_modulos, atualizado_em = now()
  where id = p_org;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.set_modulos_org_seguro(uuid, text[]) from public, anon, authenticated;
grant execute on function public.set_modulos_org_seguro(uuid, text[]) to service_role;

-- RLS e grants.
alter table public.kits_variacao            enable row level security;
alter table public.kit_variacao_skus        enable row level security;
alter table public.kit_variacao_componentes enable row level security;
alter table public.sku_politica_kit         enable row level security;
alter table public.sku_reivindicacoes_kit   enable row level security;
alter table public.kit_transferencias       enable row level security;
alter table public.kit_transferencia_alvos  enable row level security;
alter table public.kit_exclusoes            enable row level security;

drop policy if exists "kits_variacao: select org" on public.kits_variacao;
create policy "kits_variacao: select org" on public.kits_variacao for select to authenticated
  using (org_id = (select public.current_org_id()));
drop policy if exists "kit_variacao_skus: select org" on public.kit_variacao_skus;
create policy "kit_variacao_skus: select org" on public.kit_variacao_skus for select to authenticated
  using (org_id = (select public.current_org_id()));
drop policy if exists "kit_variacao_componentes: select org" on public.kit_variacao_componentes;
create policy "kit_variacao_componentes: select org" on public.kit_variacao_componentes for select to authenticated
  using (org_id = (select public.current_org_id()));
drop policy if exists "sku_politica_kit: select org" on public.sku_politica_kit;
create policy "sku_politica_kit: select org" on public.sku_politica_kit for select to authenticated
  using (org_id = (select public.current_org_id()));
drop policy if exists "sku_reivindicacoes_kit: select org" on public.sku_reivindicacoes_kit;
create policy "sku_reivindicacoes_kit: select org" on public.sku_reivindicacoes_kit for select to authenticated
  using (org_id = (select public.current_org_id()));
drop policy if exists "kit_transferencias: select org" on public.kit_transferencias;
create policy "kit_transferencias: select org" on public.kit_transferencias for select to authenticated
  using (org_id = (select public.current_org_id()));
drop policy if exists "kit_transferencia_alvos: select org" on public.kit_transferencia_alvos;
create policy "kit_transferencia_alvos: select org" on public.kit_transferencia_alvos for select to authenticated
  using (org_id = (select public.current_org_id()));
drop policy if exists "kit_exclusoes: select org" on public.kit_exclusoes;
create policy "kit_exclusoes: select org" on public.kit_exclusoes for select to authenticated
  using (org_id = (select public.current_org_id()));

revoke all on public.kits_variacao, public.kit_variacao_skus, public.kit_variacao_componentes,
  public.sku_politica_kit, public.sku_reivindicacoes_kit, public.kit_transferencias,
  public.kit_transferencia_alvos, public.kit_exclusoes from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.kits_variacao, public.kit_variacao_skus, public.kit_variacao_componentes,
  public.sku_politica_kit, public.sku_reivindicacoes_kit, public.kit_transferencias,
  public.kit_transferencia_alvos, public.kit_exclusoes from authenticated;
grant select on public.kits_variacao, public.kit_variacao_skus, public.kit_variacao_componentes,
  public.sku_politica_kit, public.sku_reivindicacoes_kit, public.kit_transferencias,
  public.kit_transferencia_alvos, public.kit_exclusoes to authenticated;
grant all on public.kits_variacao, public.kit_variacao_skus, public.kit_variacao_componentes,
  public.sku_politica_kit, public.sku_reivindicacoes_kit, public.kit_transferencias,
  public.kit_transferencia_alvos, public.kit_exclusoes to service_role;
