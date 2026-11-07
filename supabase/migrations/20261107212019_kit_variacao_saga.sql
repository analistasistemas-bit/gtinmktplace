-- ADR-0197: saga da transferência de kit (Task 4). Criação atômica, claim da execução e `itens` imutável.
--
-- `kit_criar_transferencia` cumpre o contrato de set_modulos_org_seguro: trava a org com `for share`,
-- revalida o módulo e, na mesma transação, cria transferência, alvos e exclusão. Qualquer recusa
-- desfaz o bloco inteiro: conflito não deixa transferência órfã.
--
-- Alvos: um por UP que recebe escrita. `p_alvos` = `[{"codigo", "up_id", "item_ids": [...]}]`. Em
-- montar, repor e desmontar os códigos precisam ser exatamente os de kit_transferencia_movimentos;
-- papel e delta (peças ou kits, com sinal) saem de lá, nunca do chamador. Nos demais tipos os
-- códigos são os de `itens`, papel `destino` e delta 0: o saldo local já mudou.
--
-- `versao_politica` = soma das `sku_politica_kit.versao` dos códigos dos alvos. Versão só cresce,
-- então qualquer mudança de política em qualquer SKU muda a soma. A saga relê a mesma soma.
--
-- `db push` não roda em transação: cada statement é re-executável.

grant estoque_rpc_executor to postgres;
grant usage, create on schema public to estoque_rpc_executor;

alter table public.kit_transferencia_alvos add column if not exists codigo text;
alter table public.kit_transferencia_alvos add column if not exists papel text
  check (papel in ('origem', 'destino'));
alter table public.kit_transferencia_alvos add column if not exists delta integer;
-- Passo 1 da conciliação (Task 3): instante da leitura que confirmou a pausa e pedidos pendentes nela.
alter table public.kit_transferencia_alvos add column if not exists passo1_em timestamptz;
alter table public.kit_transferencia_alvos add column if not exists ids_passo1 text[];

grant insert on public.kit_transferencias to estoque_rpc_executor;
grant select, insert on public.kit_transferencia_alvos to estoque_rpc_executor;
grant select on public.sku_politica_kit to estoque_rpc_executor;
grant update (up_id) on public.kit_exclusoes to estoque_rpc_executor;

drop policy if exists "estoque_rpc_executor: insert transferencias" on public.kit_transferencias;
create policy "estoque_rpc_executor: insert transferencias" on public.kit_transferencias
  for insert to estoque_rpc_executor with check (true);
drop policy if exists "estoque_rpc_executor: select alvos" on public.kit_transferencia_alvos;
create policy "estoque_rpc_executor: select alvos" on public.kit_transferencia_alvos
  for select to estoque_rpc_executor using (true);
drop policy if exists "estoque_rpc_executor: insert alvos" on public.kit_transferencia_alvos;
create policy "estoque_rpc_executor: insert alvos" on public.kit_transferencia_alvos
  for insert to estoque_rpc_executor with check (true);
drop policy if exists "estoque_rpc_executor: select politica" on public.sku_politica_kit;
create policy "estoque_rpc_executor: select politica" on public.sku_politica_kit
  for select to estoque_rpc_executor using (true);
drop policy if exists "estoque_rpc_executor: update exclusoes" on public.kit_exclusoes;
create policy "estoque_rpc_executor: update exclusoes" on public.kit_exclusoes
  for update to estoque_rpc_executor using (true) with check (true);

create or replace function public.kit_criar_transferencia(
  p_org uuid, p_kit uuid, p_tipo text, p_itens jsonb, p_alvos jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_modulos text[]; v_id uuid := gen_random_uuid(); v_versao integer; v_codigos text[]; r jsonb;
begin
  select modulos_habilitados into v_modulos from public.organizations where id = p_org for share;
  if not coalesce('kit_variacao' = any(v_modulos), false) then
    return jsonb_build_object('ok', false, 'motivo', 'modulo_desligado');
  end if;

  if jsonb_typeof(p_alvos) is distinct from 'array' or jsonb_array_length(p_alvos) = 0 or exists (
    select 1 from jsonb_array_elements(p_alvos) a
    where coalesce(a->>'codigo', '') = '' or coalesce(a->>'up_id', '') = ''
      or jsonb_typeof(a->'item_ids') is distinct from 'array' or jsonb_array_length(a->'item_ids') = 0
  ) or (select count(distinct a->>'codigo') <> count(*) or count(distinct a->>'up_id') <> count(*)
        from jsonb_array_elements(p_alvos) a) then
    return jsonb_build_object('ok', false, 'motivo', 'alvos_invalidos');
  end if;

  v_codigos := array(select a->>'codigo' from jsonb_array_elements(p_alvos) a);
  select coalesce(sum(p.versao), 0) into v_versao
  from public.sku_politica_kit p where p.org_id = p_org and p.codigo = any(v_codigos);

  -- Recusa dentro do bloco: a exceção desfaz transferência, alvos e exclusões já gravados.
  begin
    insert into public.kit_transferencias (id, org_id, kit_id, tipo, versao_politica, itens)
    values (v_id, p_org, p_kit, p_tipo, v_versao, p_itens);

    if p_tipo in ('montar', 'repor', 'desmontar') then
      if not exists (select 1 from public.kit_transferencia_movimentos(p_org, v_id)) or exists (
        (select m.codigo from public.kit_transferencia_movimentos(p_org, v_id) m
         except select unnest(v_codigos))
        union all
        (select unnest(v_codigos)
         except select m.codigo from public.kit_transferencia_movimentos(p_org, v_id) m)
      ) then
        raise exception 'alvos' using errcode = 'KX002';
      end if;
    elsif exists (
      (select e->>'codigo' from jsonb_array_elements(p_itens) e except select unnest(v_codigos))
      union all
      (select unnest(v_codigos) except select e->>'codigo' from jsonb_array_elements(p_itens) e)
    ) then
      raise exception 'alvos' using errcode = 'KX002';
    end if;

    insert into public.kit_transferencia_alvos (transferencia_id, org_id, up_id, codigo, item_ids, papel, delta)
    select v_id, p_org, a->>'up_id', a->>'codigo', array(select jsonb_array_elements_text(a->'item_ids')),
           coalesce(m.papel, 'destino'),
           case m.papel when 'origem' then -m.quantidade when 'destino' then m.quantidade else 0 end
    from jsonb_array_elements(p_alvos) a
    left join public.kit_transferencia_movimentos(p_org, v_id) m on m.codigo = a->>'codigo';

    r := public.kit_adquirir_exclusao(p_org, v_codigos, 'transferencia', v_id);
    if not coalesce((r->>'ok')::boolean, false) then
      raise exception '%', coalesce(r->>'codigo', r->>'motivo') using errcode = 'KX001';
    end if;

    update public.kit_exclusoes x set up_id = a->>'up_id'
    from jsonb_array_elements(p_alvos) a
    where x.org_id = p_org and x.dono_id = v_id and x.codigo = a->>'codigo';
  exception
    when sqlstate 'KX001' then
      return jsonb_build_object('ok', false, 'motivo', 'up_ocupado', 'codigo', sqlerrm);
    when sqlstate 'KX002' then
      return jsonb_build_object('ok', false, 'motivo', 'alvos_invalidos');
  end;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Claim de uma invocação da saga, no relógio do banco. Reentrega simultânea recebe false e sai sem agir.
-- Prazo vencido libera: invocação que morreu sem soltar não prende a saga.
create or replace function public.kit_reivindicar_execucao(
  p_org uuid, p_transferencia uuid, p_token uuid, p_prazo_s integer
) returns boolean language sql set search_path = ''
as $$
  with u as (
    update public.kit_transferencias
    set execucao_token = p_token, execucao_ate = now() + make_interval(secs => p_prazo_s)
    where id = p_transferencia and org_id = p_org and estado = 'ativa'
      and (execucao_ate is null or execucao_ate < now())
    returning 1
  )
  select exists (select 1 from u)
$$;

-- Depois da reserva, `itens` não muda: trocar destinos mantendo as origens passaria no crédito
-- (ressalva da Task 2) e creditaria SKU de kit diferente do reservado.
create or replace function public.kit_transferencias_itens_imutavel()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if exists (select 1 from public.estoque_movimentos
             where transferencia_id = old.id and motivo = 'kit_saida') then
    raise exception 'itens da transferência % é imutável depois da reserva (ADR-0197).', old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

drop trigger if exists kit_transferencias_itens_imutavel on public.kit_transferencias;
create trigger kit_transferencias_itens_imutavel
  before update of itens on public.kit_transferencias
  for each row when (old.itens is distinct from new.itens)
  execute procedure public.kit_transferencias_itens_imutavel();

-- ACL antes da troca de dono (20260811203500).
revoke all on function public.kit_criar_transferencia(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.kit_criar_transferencia(uuid, uuid, text, jsonb, jsonb) to service_role;
revoke all on function public.kit_reivindicar_execucao(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.kit_reivindicar_execucao(uuid, uuid, uuid, integer) to service_role;
revoke all on function public.kit_transferencias_itens_imutavel() from public, anon, authenticated;

alter function public.kit_criar_transferencia(uuid, uuid, text, jsonb, jsonb) owner to estoque_rpc_executor;

revoke create on schema public from estoque_rpc_executor;

do $$
begin
  revoke estoque_rpc_executor from postgres;
exception when others then
  raise warning 'membership de postgres em estoque_rpc_executor nao revogada: %', sqlerrm;
end $$;
