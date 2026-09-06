-- ADR-0154: Kits Virtuais do Mercado Livre — anúncio que combina de 2 a 6 produtos DISTINTOS
-- já publicados, referenciados por `user_product_id`. Estoque e preço são calculados pelo ML.
--
-- Estrutura própria por construção (D-2), não filtro em tabela compartilhada: o kit não é
-- `familias` (arrastaria lote/Revisão/process-familia/UPDATE) nem `anuncios_externos`
-- (`codigo_pai not null` e todo leitor daquela tabela trata a linha como partição de produto —
-- o kit cairia no fan-out de push de estoque por acidente, e o ML nem aceita `quantity` em kit).
--
-- `db push` NÃO roda em transação: cada statement abaixo é re-executável isoladamente
-- (`if not exists` / `create or replace` / `drop trigger if exists`), de modo que repetir o push
-- depois de uma falha no meio do arquivo converge em vez de estourar. NÃO há bloco de
-- `grant`/`revoke` de role aqui (ao contrário de `20260903002527_kit_vinculado_guards.sql`):
-- aquele existia só porque a migration redefinia RPCs cujo owner é `estoque_rpc_executor`.
-- Esta migration cria objetos novos, e um membership pendurado seria puro risco.

-- ---------------------------------------------------------------------------
-- kits_virtuais: o anúncio de combinação. Uma linha por kit.
-- Escrita só por service_role (edge functions); app só lê.
-- ---------------------------------------------------------------------------
create table if not exists public.kits_virtuais (
  id     uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),

  -- Idempotência do CREATE: chave gerada pelo front ao abrir o diálogo. Mesmo PAPEL de
  -- `familias.chave_cadastro` (ADR-0096) — reenvio da mesma submissão devolve o kit original —
  -- mas TIPO diferente: lá é `uuid` nullable com índice parcial, aqui é `text` `not null` em
  -- unique total, porque o kit só nasce pelo diálogo (não existe caminho de planilha que a
  -- deixe vazia). Não passe um `uuid` cru esperando o mesmo tipo dos dois lados.
  chave_cadastro text not null,

  -- Resultado no ML. Nulos até o CREATE responder.
  ml_item_id         text,
  ml_user_product_id text,
  ml_permalink       text,

  -- Título por template do operador (D-4) — o ML o expande sozinho com os dados dos
  -- componentes. Descrição gerada por IA uma vez no preview.
  titulo    text not null,
  descricao text,

  -- D-3: o kit é publicado com `automatic_price`; `price` nunca é enviado. Este é o desconto
  -- percentual idêntico aplicado a todos os componentes.
  desconto_pct numeric not null check (desconto_pct >= 0 and desconto_pct < 1),

  -- Task 7/8: o ML exige `listing_type_id` no payload do POST /items/kits (Clássico/Premium),
  -- mas o valor só sobrevive se persistido — "Refazer kit" (D-8) reabre o diálogo pré-preenchido
  -- com os componentes antigos, e sem esta coluna a escolha do operador entre Clássico/Premium
  -- se perderia a cada refação.
  listing_type_id text not null default 'gold_pro',

  -- D-5: foto própria obrigatória, subida ao ML no upload do diálogo (não no publicar) porque
  -- a propagação de foto no ML é assíncrona (ADR-0033). Nuláveis no schema: a linha nasce
  -- antes do upload terminar; a obrigatoriedade é gate de publicação, não `not null`.
  foto_storage_path  text,
  foto_ml_picture_id text,

  status text not null
    check (status in ('publicando','publicado','erro','encerrado')),
  erro_mensagem text,

  criado_por   uuid,
  publicado_em timestamptz,
  encerrado_em timestamptz,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint kits_virtuais_org_chave_cadastro_key unique (org_id, chave_cadastro),

  -- Alvo referenciável da FK composta da tabela filha (mesmo padrão de
  -- `anuncios_externos_id_org_id_key`, migration 20260722145236).
  constraint kits_virtuais_id_org_id_key unique (id, org_id)
);

comment on column public.kits_virtuais.desconto_pct is
  'ADR-0154 D-3: FRACAO decimal 0-1 (0.15 = 15%). Formato verificado contra a doc oficial do ML '
  'no spike 036 (docs/spikes/036-kits-virtuais-mercado-livre.md): "automatic_price.discount '
  'decimal (0-1), identico em todos os componentes". ATENCAO: NAO e a mesma unidade de '
  'configuracoes/familias/variacoes.desconto_pct, que sao percentuais 0-100 (default 15 = 15%). '
  'Nome igual, unidade diferente - nunca copiar valor de um para o outro sem converter.';

-- Índice de leitura da tela Publicados (kits vivos da org).
create index if not exists kits_virtuais_org_status_idx
  on public.kits_virtuais (org_id, status);

-- Um item_id do ML pertence a um único kit por org.
create unique index if not exists kits_virtuais_org_ml_item_uidx
  on public.kits_virtuais (org_id, ml_item_id)
  where ml_item_id is not null;

drop trigger if exists kits_virtuais_set_updated_at on public.kits_virtuais;
create trigger kits_virtuais_set_updated_at
  before update on public.kits_virtuais
  for each row execute procedure extensions.moddatetime (atualizado_em);

alter table public.kits_virtuais enable row level security;

-- Grupo B (só-leitura no app; escrita = service_role, que ignora RLS). Mesmo padrão de
-- `anuncios_externos_itens` em 20260722145236 e de ml_vendas em 20260705165828_e7_rls_org.sql.
drop policy if exists "kits_virtuais: select org" on public.kits_virtuais;
create policy "kits_virtuais: select org" on public.kits_virtuais
  for select to authenticated using (org_id = (select public.current_org_id()));

-- ---------------------------------------------------------------------------
-- kits_virtuais_componentes: de 2 a 6 produtos distintos por kit.
--
-- A identidade do componente é `user_product_id` — é isso que o ML aceita no nó `bundle` e o
-- único id que sobrevive a um UPDATE de lote. `codigo`/`codigo_pai` são ENRIQUECIMENTO
-- best-effort do catálogo local (D-12: os candidatos vêm do buscador do ML, não de query
-- local) e podem ficar nulos — nunca são a chave.
-- ---------------------------------------------------------------------------
create table if not exists public.kits_virtuais_componentes (
  id     uuid primary key default gen_random_uuid(),
  kit_id uuid not null,
  org_id uuid not null,

  -- 0 = componente principal (o que dá o tom do título e da categoria no ML).
  ordem smallint not null,

  user_product_id text not null,
  item_externo_id text,

  quantidade smallint not null check (quantidade between 1 and 10),

  -- Enriquecimento do catálogo local (D-12), para margem/imposto no preview. Nuláveis:
  -- o banco sequer guarda `user_product_id` de família legada, então nem todo componente
  -- devolvido pelo ML casa com uma linha local.
  codigo     text,
  codigo_pai text,

  criado_em timestamptz not null default now(),

  -- Integridade referencial + herança de org via FK composta real (não trigger, não CHECK:
  -- um CHECK do Postgres não pode consultar outra tabela). Sem a coluna `org_id` no alvo, um
  -- componente poderia apontar para kit de OUTRA org e a RLS de select mentiria.
  constraint kits_virtuais_componentes_kit_fk
    foreign key (kit_id, org_id)
    references public.kits_virtuais (id, org_id) on delete cascade,

  -- O mesmo produto não entra duas vezes no kit (isso é `quantidade`, não linha repetida)…
  constraint kits_virtuais_componentes_produto_key unique (kit_id, user_product_id),
  -- …e a ordem é uma permutação sem buracos duplicados (só um "principal").
  constraint kits_virtuais_componentes_ordem_key unique (kit_id, ordem)
);

-- Servem o guard de remoção abaixo, que varre "componentes desta org por produto".
create index if not exists kits_virtuais_componentes_user_product_idx
  on public.kits_virtuais_componentes (org_id, user_product_id);
create index if not exists kits_virtuais_componentes_codigo_pai_idx
  on public.kits_virtuais_componentes (org_id, codigo_pai)
  where codigo_pai is not null;

alter table public.kits_virtuais_componentes enable row level security;

drop policy if exists "kits_virtuais_componentes: select org" on public.kits_virtuais_componentes;
create policy "kits_virtuais_componentes: select org" on public.kits_virtuais_componentes
  for select to authenticated using (org_id = (select public.current_org_id()));

-- ---------------------------------------------------------------------------
-- Invariante 2..6 componentes (regra do ML).
--
-- ESCOLHA: a trava vive num trigger em `kits_virtuais`, disparado na TRANSIÇÃO para
-- `status='publicado'` — NÃO num trigger na tabela de componentes.
--
-- Por quê: um `after insert or delete` em `kits_virtuais_componentes` que só valida quando o
-- kit está `publicado` é um NO-OP no caminho real. Os componentes são inseridos enquanto o kit
-- ainda está em `publicando` (a FK exige a linha do kit primeiro, e o status só vira
-- `publicado` depois do CREATE no ML responder), então no momento do INSERT o predicado é
-- sempre falso. Um constraint trigger DEFERIDO tampouco alcança: a edge grava kit, componentes
-- e status em transações separadas (PostgREST), então o COMMIT que ele veria nunca é o que
-- contém as três coisas.
--
-- O momento em que a contagem é a definitiva é exatamente um: quando alguém escreve
-- `status='publicado'`. É um único ponto, no mesmo statement, sem depender de ordem de linhas
-- dentro de um `.insert()` multi-linha nem de visibilidade de transação — as duas fragilidades
-- que o comentário de D-10 do ADR-0151 já documenta.
--
-- Não há exceção para "já estava publicado": revalidar num UPDATE qualquer é uma contagem
-- barata (kits são dezenas por org) e ainda barra o caminho de apagar componente de kit vivo
-- até ficar abaixo de 2.
--
-- ponytail: INSERT direto com `status='publicado'` falha, e isso é o comportamento correto —
-- a FK impede que existam componentes antes da linha do kit, então esse INSERT nunca poderia
-- satisfazer a regra do ML.
-- ---------------------------------------------------------------------------
create or replace function public.validar_componentes_kit_virtual()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if new.status <> 'publicado' then
    return new;
  end if;

  select count(*) into v_n
  from public.kits_virtuais_componentes c
  where c.kit_id = new.id;

  if v_n < 2 or v_n > 6 then
    raise exception 'Kit Virtual precisa de 2 a 6 componentes para ficar publicado (tem %).', v_n
      using errcode = '23514';
  end if;

  return new;
end $$;

drop trigger if exists kits_virtuais_validar_componentes on public.kits_virtuais;
create trigger kits_virtuais_validar_componentes
  before insert or update on public.kits_virtuais
  for each row execute procedure public.validar_componentes_kit_virtual();

-- ---------------------------------------------------------------------------
-- D-13: componente de kit PUBLICADO não pode ser removido.
--
-- Espelha a Decisão 14 do ADR-0151 (`familias_bloquear_remocao_com_kit`), com um motivo
-- específico: republicar/remover um componente cria um `user_product_id` novo e o kit fica
-- preso ao UP morto — resultado é um kit em `out_of_stock` permanente, sem mensagem de erro
-- nenhuma. A guard fica no banco porque `remover-publicado` faz DELETE direto na tabela.
--
-- Duas diferenças deliberadas em relação ao guard do ADR-0151:
--
-- 1) NÃO existe o early-exit `if old.kit_multiplicador is not null then return old`. Ali ele é
--    correto (a família de kit vinculado nunca é a base de si mesma); aqui seria um buraco
--    exatamente onde a D-9 deste ADR diz que o risco mora — um kit vinculado É elegível como
--    componente de kit virtual.
--
-- 2) O match tem DOIS ramos, porque `componentes.codigo_pai` é enriquecimento best-effort
--    (D-12) e pode ser nulo: casa por `codigo_pai` quando enriquecido, e por `user_product_id`
--    /`item_externo_id` via `anuncios_externos_itens` (o "item UP filho" da família). `familias`
--    não tem coluna `user_product_id` — o único caminho do produto até o UP é esse join.
--
-- Mantido do precedente: só bloqueia quando esta é a ÚLTIMA linha de `familias` daquele
-- `codigo_pai`. Cada lote de UPDATE cria uma linha nova, e apagar uma delas não desfaz o
-- produto — sem isto, a limpeza de rotina de lote quebraria em todo produto que é componente.
-- ---------------------------------------------------------------------------
create or replace function public.bloquear_remocao_componente_kit_virtual()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from public.familias o
    where o.org_id = old.org_id and o.codigo_pai = old.codigo_pai and o.id <> old.id
  ) then
    return old;
  end if;

  if exists (
    select 1
    from public.kits_virtuais k
    join public.kits_virtuais_componentes c on c.kit_id = k.id
    where k.org_id = old.org_id
      -- `publicando` conta como vivo: entre gravar os componentes e o CREATE do ML voltar,
      -- apagar a família do componente deixaria o kit preso a um user product morto — o mesmo
      -- estado que este guard existe para evitar. O guard de kit vinculado (ADR-0151) trata
      -- `publicando` como vivo pela mesma razão.
      and k.status in ('publicando', 'publicado')
      and (
        c.codigo_pai = old.codigo_pai
        or exists (
          select 1
          from public.anuncios_externos_itens i
          join public.anuncios_externos a on a.id = i.anuncio_externo_id
          where a.org_id = old.org_id
            and a.codigo_pai = old.codigo_pai
            and (
              -- `anuncios_externos_itens.user_product_id` é unique GLOBAL, então este ramo
              -- resolve qualquer componente cujo UP exista localmente.
              i.user_product_id = c.user_product_id
              -- Único caso em que o ramo acima não pega: linha de item já criada no ML com
              -- `user_product_id` ainda nulo (a coluna é "nulável até existir no ML"). Mantido
              -- porque o custo de errar aqui é kit órfão em out_of_stock permanente, e
              -- `item_externo_id` é id global do ML — não gera falso positivo.
              or i.item_externo_id = c.item_externo_id
            )
        )
      )
  ) then
    raise exception 'Produto % é componente de um Kit Virtual publicado: encerre o kit antes de remover o produto.', old.codigo_pai
      using errcode = '23514';
  end if;

  return old;
end $$;

drop trigger if exists familias_bloquear_remocao_componente_kit_virtual on public.familias;
create trigger familias_bloquear_remocao_componente_kit_virtual
  before delete on public.familias
  for each row execute procedure public.bloquear_remocao_componente_kit_virtual();

-- ---------------------------------------------------------------------------
-- D-10: badge "Kit" na linha de venda. O ML emite UMA order por componente, ligadas por
-- `pack_id`; o id do kit só aparece em `bundle.parent_item`, nunca em `order_items[]`.
--
-- Só a coluna, sem backfill: `bundle.parent_item` não está nos `raw` já gravados, e o
-- faturamento não muda — os preços rateados dos componentes já somam o preço do kit.
-- ---------------------------------------------------------------------------
alter table public.ml_vendas
  add column if not exists kit_item_id text;

comment on column public.ml_vendas.kit_item_id is
  'ADR-0154 D-10: item_id do Kit Virtual, lido de `bundle.parent_item` do pedido. Só marca a '
  'linha com um badge; as orders NÃO são agrupadas e nenhum cálculo financeiro usa esta coluna.';
