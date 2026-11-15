-- ADR-0206: kit_variacao_imagens também guarda a capa IA do Kit Virtual (edge gerar-capa-kit-virtual).
--
-- Uma linha é de exatamente um tipo:
--   * cores (ADR-0200): `cores`, `rotulo` e `familia_base_id` preenchidos; `n`, `composicao` e `pedido` nulos;
--   * unidades (ADR-0205): `n` e `familia_base_id` preenchidos; `cores`, `rotulo`, `composicao` e `pedido` nulos;
--   * composição (ADR-0206): `composicao` e `pedido` preenchidos; `cores`, `rotulo`, `n` e `familia_base_id` nulos.
-- `familia_base_id` passa a aceitar NULL (o Kit Virtual não tem família base); o check exige a base nos outros dois
-- tipos. O check novo substitui `kit_variacao_imagens_cores_ou_unidades_check` (linhas existentes continuam válidas).
-- `composicao` = chave do teto: `user_product_id` dos componentes ordenados e separados por `|`, SEM quantidades
-- (trocar 2x por 3x não zera o teto). `pedido` = `[{user_product_id, quantidade}]` na ordem do kit (idempotência).
-- NÃO mudam: trigger de cobrança `kit_variacao_imagens_cobranca` (platform_image_delivery_on_generated lê só org_id,
-- request_id e custo_usd, nunca familia_base_id), índices únicos (org, request_id, tentativa) e (org, request_id)
-- vivo, RLS sem policy e revoke de anon/authenticated.
-- RPC `kit_capa_virtual_reservar`: espelho da `kit_capa_unidades_reservar` (ADR-0205 §8) com a chave (org,
-- composição): lock transacional → conta as linhas das últimas 24 h (qualquer status) → >= 6 devolve 'teto' sem
-- inserir; senão insere a reserva `pendente` e devolve 'ok'. 23505 sobe para a edge. Só service_role executa
-- (security invoker, sem elevação).
-- Re-executável (`db push` não roda em transação: cada statement pode ser reaplicado, `if exists`/`if not exists`).

alter table public.kit_variacao_imagens alter column familia_base_id drop not null;
alter table public.kit_variacao_imagens add column if not exists composicao text;
alter table public.kit_variacao_imagens add column if not exists pedido jsonb;

alter table public.kit_variacao_imagens drop constraint if exists kit_variacao_imagens_cores_ou_unidades_check;
alter table public.kit_variacao_imagens drop constraint if exists kit_variacao_imagens_tipo_check;
alter table public.kit_variacao_imagens
  add constraint kit_variacao_imagens_tipo_check check (
    (cores is not null and rotulo is not null and familia_base_id is not null
      and n is null and composicao is null and pedido is null)
    or (n is not null and familia_base_id is not null
      and cores is null and rotulo is null and composicao is null and pedido is null)
    or (composicao is not null and pedido is not null
      and cores is null and rotulo is null and n is null and familia_base_id is null)
  );

-- Parcial: só linhas de composição entram no teto; `composicao = $1` na consulta implica `is not null`.
create index if not exists kit_variacao_imagens_teto_composicao_idx
  on public.kit_variacao_imagens (org_id, composicao, criado_em) where composicao is not null;

comment on column public.kit_variacao_imagens.composicao is
  'ADR-0206: chave da capa IA do Kit Virtual e do teto (6/24 h por org): user_product_id dos componentes ordenados, '
  'separados por |, sem quantidades. Nulo = linha de cores (ADR-0200) ou de unidades (ADR-0205).';
comment on column public.kit_variacao_imagens.pedido is
  'ADR-0206: [{user_product_id, quantidade}] na ordem do kit (idempotência do request_id). Nulo fora do Kit Virtual.';
comment on column public.kit_variacao_imagens.familia_base_id is
  'Família base do kit (ADR-0200 cores, ADR-0205 unidades). Nulo só em linha de composição (ADR-0206, Kit Virtual).';

create or replace function public.kit_capa_virtual_reservar(
  p_org_id uuid, p_request_id uuid, p_tentativa smallint, p_composicao text, p_pedido jsonb, p_modelo text,
  p_criado_por uuid
) returns text
language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'kit_capa_virtual:' || p_org_id::text || ':' || p_composicao, 0));
  if (select count(*) from public.kit_variacao_imagens
      where org_id = p_org_id and composicao = p_composicao
        and criado_em >= pg_catalog.now() - interval '24 hours') >= 6 then
    return 'teto';
  end if;
  insert into public.kit_variacao_imagens
    (org_id, request_id, tentativa, status, familia_base_id, cores, rotulo, n, composicao, pedido, modelo, criado_por)
  values (p_org_id, p_request_id, p_tentativa, 'pendente', null, null, null, null, p_composicao, p_pedido, p_modelo,
    p_criado_por);
  return 'ok';
end;
$$;
revoke all on function public.kit_capa_virtual_reservar(uuid, uuid, smallint, text, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.kit_capa_virtual_reservar(uuid, uuid, smallint, text, jsonb, text, uuid) to service_role;
