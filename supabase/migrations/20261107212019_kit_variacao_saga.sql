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
-- Item que recebe o PUT de quantidade, escolhido aberto na leitura antes da escrita; nunca muda numa
-- tentativa incerta. `recusas` conta 4xx: na 5ª a saga trava.
alter table public.kit_transferencia_alvos add column if not exists item_escrita text;
alter table public.kit_transferencia_alvos add column if not exists recusas integer not null default 0;
-- Obrigação de conferir/repausar item depois de um PUT `active`, gravada antes dele. Finalizar recusa
-- enquanto houver: a compensação sobrevive a queda, erro e resposta incerta.
alter table public.kit_transferencia_alvos add column if not exists repausar text[] not null default '{}';
-- Fase da escrita pelo sinal de (valor_alvo − ML lido no cálculo), gravada uma vez: redução primeiro,
-- aumento só depois de todas as reduções confirmadas. Local à frente do ML (entrada, ajuste) é aumento.
alter table public.kit_transferencia_alvos add column if not exists fase text
  check (fase in ('reducao', 'aumento', 'nenhuma'));

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

-- Composição congelada desde a criação: alvos, deltas e exclusões saíram de `itens`, `tipo` e `kit_id`.
-- Mudar qualquer um deixaria o destino recebendo um número e o crédito outro.
create or replace function public.kit_transferencias_imutavel()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'itens, tipo e kit_id da transferência % são imutáveis (ADR-0197).', old.id
    using errcode = 'restrict_violation';
end $$;

drop trigger if exists kit_transferencias_imutavel on public.kit_transferencias;
create trigger kit_transferencias_imutavel
  before update of itens, tipo, kit_id on public.kit_transferencias
  for each row when (old.itens is distinct from new.itens or old.tipo is distinct from new.tipo
                     or old.kit_id is distinct from new.kit_id)
  execute procedure public.kit_transferencias_imutavel();

-- `versao_politica` é soma: só prova "nada mudou" se a soma for monotônica. Versão não decresce, e a
-- linha de SKU em transferência aberta não é apagada nem trocada de código.
create or replace function public.sku_politica_kit_monotonica()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.versao < old.versao then
    raise exception 'sku_politica_kit: versão não pode decrescer (% para %).', old.versao, new.versao
      using errcode = 'restrict_violation';
  end if;
  if (tg_op = 'DELETE' or new.org_id <> old.org_id or new.codigo <> old.codigo) and exists (
    select 1 from public.kit_transferencia_alvos a
    join public.kit_transferencias t on t.id = a.transferencia_id and t.org_id = a.org_id
    where a.org_id = old.org_id and a.codigo = old.codigo and t.estado in ('ativa', 'travada')
  ) then
    raise exception 'sku_politica_kit: % está em transferência aberta.', old.codigo using errcode = 'restrict_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists sku_politica_kit_monotonica on public.sku_politica_kit;
create trigger sku_politica_kit_monotonica
  before update or delete on public.sku_politica_kit
  for each row execute procedure public.sku_politica_kit_monotonica();

-- Escritas da saga. Todas exigem transferência `ativa`, token da execução, prazo vigente (relógio real,
-- não o início da transação) e a exclusão de todos os alvos ainda com este dono. Execução vencida, cujo
-- claim outra pegou, não grava nada. Invoker: só service_role executa.
create or replace function public.kit_saga_validar(p_org uuid, p_transferencia uuid, p_token uuid)
returns void language plpgsql set search_path = ''
as $$
begin
  perform 1 from public.kit_transferencias
  where id = p_transferencia and org_id = p_org and estado = 'ativa'
    and execucao_token = p_token and execucao_ate > clock_timestamp()
  for update;
  if not found then
    raise exception 'kit_execucao_vencida: transferência % sem claim vigente para este token', p_transferencia
      using errcode = 'KX003';
  end if;
  if exists (
    select 1 from public.kit_transferencia_alvos a
    where a.transferencia_id = p_transferencia and a.org_id = p_org and not exists (
      select 1 from public.kit_exclusoes x
      where x.org_id = p_org and x.codigo = a.codigo and x.dono_tipo = 'transferencia' and x.dono_id = p_transferencia)
  ) then
    raise exception 'kit_exclusao_perdida: transferência % sem a exclusão de todos os alvos', p_transferencia
      using errcode = 'KX004';
  end if;
end $$;

-- Só as colunas da saga mudam; código, papel, delta, UP e itens nunca. Valor anterior e alvo gravam uma vez.
create or replace function public.kit_saga_salvar_alvo(
  p_org uuid, p_transferencia uuid, p_token uuid, p_up text, p_patch jsonb
) returns void language plpgsql set search_path = ''
as $$
declare v public.kit_transferencia_alvos%rowtype;
begin
  perform public.kit_saga_validar(p_org, p_transferencia, p_token);
  select * into v from public.kit_transferencia_alvos
  where transferencia_id = p_transferencia and org_id = p_org and up_id = p_up for update;
  if not found then
    raise exception 'kit_saga_salvar_alvo: alvo % não encontrado', p_up;
  end if;
  v := jsonb_populate_record(v, p_patch);
  update public.kit_transferencia_alvos a set
    qtd_passo1 = v.qtd_passo1, passo1_em = v.passo1_em, ids_passo1 = v.ids_passo1,
    valor_anterior = coalesce(a.valor_anterior, v.valor_anterior), valor_alvo = coalesce(a.valor_alvo, v.valor_alvo), fase = coalesce(a.fase, v.fase),
    pausado_pela_saga = v.pausado_pela_saga, intencao_escrita_em = v.intencao_escrita_em,
    recusa_definitiva_em = v.recusa_definitiva_em, escrita_em = v.escrita_em, confirmada_em = v.confirmada_em,
    item_escrita = v.item_escrita, recusas = v.recusas, repausar = v.repausar
  where a.transferencia_id = p_transferencia and a.org_id = p_org and a.up_id = p_up;
end $$;

-- Passo, alerta e trava. Fechar (concluida/abortada) só por kit_saga_finalizar.
create or replace function public.kit_saga_salvar_transferencia(
  p_org uuid, p_transferencia uuid, p_token uuid, p_passo text, p_alerta text, p_travar boolean
) returns void language plpgsql set search_path = ''
as $$
begin
  perform public.kit_saga_validar(p_org, p_transferencia, p_token);
  update public.kit_transferencias
  set passo = coalesce(p_passo, passo), alerta = coalesce(p_alerta, alerta), passo_em = now(),
      estado = case when p_travar then 'travada' else estado end
  where id = p_transferencia and org_id = p_org;
end $$;

-- Estado final e exclusões numa transação: a exclusão nunca sai antes de a saga fechar.
create or replace function public.kit_saga_finalizar(
  p_org uuid, p_transferencia uuid, p_token uuid, p_estado text, p_alerta text
) returns void language plpgsql set search_path = ''
as $$
begin
  if p_estado not in ('concluida', 'abortada') then
    raise exception 'kit_saga_finalizar: estado inválido %', p_estado;
  end if;
  perform public.kit_saga_validar(p_org, p_transferencia, p_token);
  if exists (select 1 from public.kit_transferencia_alvos
             where transferencia_id = p_transferencia and org_id = p_org and cardinality(repausar) > 0) then
    raise exception 'kit_repausa_pendente: transferência % tem item a repausar', p_transferencia using errcode = 'KX005';
  end if;
  delete from public.kit_exclusoes where org_id = p_org and dono_tipo = 'transferencia' and dono_id = p_transferencia;
  update public.kit_transferencias
  set estado = p_estado, passo = 'fim', alerta = coalesce(p_alerta, alerta), passo_em = now(),
      execucao_token = null, execucao_ate = null
  where id = p_transferencia and org_id = p_org;
end $$;

-- Ledger pela saga. Ordem de locks das RPCs da Task 2: org, depois transferência.
create or replace function public.kit_saga_ledger(p_org uuid, p_transferencia uuid, p_token uuid, p_op text)
returns jsonb language plpgsql set search_path = ''
as $$
begin
  perform 1 from public.organizations where id = p_org for share;
  perform public.kit_saga_validar(p_org, p_transferencia, p_token);
  if p_op = 'reservar' then return public.kit_reservar_transferencia(p_org, p_transferencia); end if;
  if p_op = 'creditar' then return public.kit_creditar_transferencia(p_org, p_transferencia); end if;
  if p_op = 'cancelar' then return public.kit_cancelar_transferencia(p_org, p_transferencia); end if;
  raise exception 'kit_saga_ledger: operação inválida %', p_op;
end $$;

-- Autoriza reativar um SKU logo antes do PUT: trava as linhas de política dos alvos e confere a versão
-- somada e os bloqueios do SKU. A saga relê depois do PUT e repausa se a política mudou no meio.
create or replace function public.kit_saga_pode_reativar(p_org uuid, p_transferencia uuid, p_token uuid, p_codigo text)
returns boolean language plpgsql set search_path = ''
as $$
declare v_codigos text[]; v_soma integer; v_versao integer;
begin
  perform public.kit_saga_validar(p_org, p_transferencia, p_token);
  select versao_politica into v_versao from public.kit_transferencias where id = p_transferencia;
  select array_agg(codigo order by codigo) into v_codigos from public.kit_transferencia_alvos
  where transferencia_id = p_transferencia and org_id = p_org;
  perform 1 from public.sku_politica_kit
  where org_id = p_org and codigo = any(v_codigos) order by codigo for update;
  select coalesce(sum(versao), 0) into v_soma from public.sku_politica_kit
  where org_id = p_org and codigo = any(v_codigos);
  return v_soma = v_versao and not exists (
    select 1 from public.sku_politica_kit
    where org_id = p_org and codigo = p_codigo
      and (estado = 'guardado' or bloqueio_operador or bloqueio_moderacao or bloqueio_retirada));
end $$;

-- ACL antes da troca de dono (20260811203500).
revoke all on function public.kit_criar_transferencia(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.kit_criar_transferencia(uuid, uuid, text, jsonb, jsonb) to service_role;
revoke all on function public.kit_reivindicar_execucao(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.kit_reivindicar_execucao(uuid, uuid, uuid, integer) to service_role;
revoke all on function public.kit_transferencias_imutavel() from public, anon, authenticated;
revoke all on function public.sku_politica_kit_monotonica() from public, anon, authenticated;
revoke all on function public.kit_saga_validar(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.kit_saga_salvar_alvo(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.kit_saga_salvar_transferencia(uuid, uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.kit_saga_finalizar(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.kit_saga_ledger(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.kit_saga_pode_reativar(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.kit_saga_validar(uuid, uuid, uuid) to service_role;
grant execute on function public.kit_saga_salvar_alvo(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.kit_saga_salvar_transferencia(uuid, uuid, uuid, text, text, boolean) to service_role;
grant execute on function public.kit_saga_finalizar(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.kit_saga_ledger(uuid, uuid, uuid, text) to service_role;
grant execute on function public.kit_saga_pode_reativar(uuid, uuid, uuid, text) to service_role;

alter function public.kit_criar_transferencia(uuid, uuid, text, jsonb, jsonb) owner to estoque_rpc_executor;

revoke create on schema public from estoque_rpc_executor;

do $$
begin
  revoke estoque_rpc_executor from postgres;
exception when others then
  raise warning 'membership de postgres em estoque_rpc_executor nao revogada: %', sqlerrm;
end $$;
