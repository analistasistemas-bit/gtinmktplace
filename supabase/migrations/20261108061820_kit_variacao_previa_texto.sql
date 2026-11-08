-- ADR-0199 (Task 11, rodada 1): registro durável do consumo de IA da prévia do texto do kit.
-- Cada chamada de `gerar-texto-kit` grava uma linha ANTES de interpretar a resposta da IA (prévia
-- descartada ou com JSON inválido também consumiu tokens). O cliente nunca informa tokens nem custo.
-- Na criação, `kit_variacao_consumir_previa` associa a prévia ao kit uma vez só e soma o custo na
-- família do kit. Escrita só por service role. Re-executável (`db push` não roda em transação).

create table if not exists public.kit_variacao_previas (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  familia_base_id uuid not null,
  pecas           smallint not null check (pecas between 2 and 6),
  modelo          text not null,
  tokens_input    integer not null default 0,
  tokens_output   integer not null default 0,
  custo_centavos  integer not null default 0 check (custo_centavos >= 0),
  kit_id          uuid,
  criado_em       timestamptz not null default now()
);
create index if not exists kit_variacao_previas_org_idx on public.kit_variacao_previas (org_id, criado_em desc);
alter table public.kit_variacao_previas enable row level security;
revoke all on public.kit_variacao_previas from anon, authenticated;

-- Associa a prévia ao kit e soma o custo em `familias.custo_centavos` do kit, numa transação.
-- Idempotente: a mesma prévia com o mesmo kit repete sem somar de novo; com outro kit recusa.
create or replace function public.kit_variacao_consumir_previa(
  p_org uuid, p_previa uuid, p_base uuid, p_pecas integer, p_kit uuid, p_chave uuid
) returns jsonb language plpgsql set search_path = public as $$
declare v public.kit_variacao_previas%rowtype;
begin
  select * into v from public.kit_variacao_previas where id = p_previa and org_id = p_org for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'previa_invalida'); end if;
  if v.familia_base_id <> p_base or v.pecas <> p_pecas then
    return jsonb_build_object('ok', false, 'motivo', 'previa_divergente');
  end if;
  if v.kit_id is not null then
    if v.kit_id = p_kit then return jsonb_build_object('ok', true, 'existente', true); end if;
    return jsonb_build_object('ok', false, 'motivo', 'previa_usada');
  end if;
  update public.familias
     set custo_centavos = coalesce(custo_centavos, 0) + v.custo_centavos,
         tokens_input   = coalesce(tokens_input, 0) + v.tokens_input,
         tokens_output  = coalesce(tokens_output, 0) + v.tokens_output
   where org_id = p_org and chave_cadastro = p_chave;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'familia_nao_encontrada'); end if;
  update public.kit_variacao_previas set kit_id = p_kit where id = p_previa;
  return jsonb_build_object('ok', true, 'existente', false);
end $$;
revoke all on function public.kit_variacao_consumir_previa(uuid, uuid, uuid, integer, uuid, uuid) from public, anon, authenticated;
grant execute on function public.kit_variacao_consumir_previa(uuid, uuid, uuid, integer, uuid, uuid) to service_role;
