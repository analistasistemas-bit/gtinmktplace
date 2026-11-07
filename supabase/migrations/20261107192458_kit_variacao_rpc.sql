-- ADR-0197: RPCs de transferência do kit com variação. A saga (Task 4) chama estas funções.
--
-- Contrato de `kit_transferencias.itens`: `[{"codigo": <SKU>, "quantidade": <n>}]`.
--   - montar, repor, desmontar: `codigo` é SKU de kit e `quantidade` é em KITS. Origem e destino saem
--     da composição congelada, para a saga não poder criar peça com um número errado (invariante 2).
--   - entrada, cancelamento, sair_sobra: sem movimento local, `quantidade` é ignorada. O saldo já mudou
--     pela RPC de origem; os SKUs listados só ficam em transferência.
--
-- Ledger: `kit_saida` sai da origem e `kit_entrada` chega ao destino. Unidade em SKU de kit é kit.
-- Cancelar grava `kit_entrada` na própria origem: mesmo código de um `kit_saida`, é devolução. Com o
-- índice único (transferencia_id, codigo, motivo), cada lado ocorre uma vez. `estado` e `passo` são da
-- saga: estas RPCs só mexem em saldo e ledger.
--
-- Ordem de locks em todas: organização (quando trava), transferência, `variacoes` por `codigo`.
--
-- Capacidade: `kits_variacao.meta` limita só `repor`. É o alvo da automação; `montar` e `desmontar` são
-- decisão do operador e não respeitam meta, que nasce 0.
--
-- `db push` não roda em transação: cada statement é re-executável. Se morrer no meio, conferir o
-- membership de postgres em estoque_rpc_executor (ver 20260903002527).

-- Exigidos pelo create or replace das RPCs já de estoque_rpc_executor e pelo alter owner das novas.
grant estoque_rpc_executor to postgres;
grant usage, create on schema public to estoque_rpc_executor;

-- O role não ignora RLS. `for share` e `for update` exigem privilégio de UPDATE e passam pela policy de
-- update, mesmo sem gravar nada: é por isso que organizations ganha update numa coluna só. NOLOGIN e
-- fora de service_role: não há acesso direto.
grant select (id, modulos_habilitados), update (atualizado_em) on public.organizations to estoque_rpc_executor;
grant select on public.kits_variacao, public.kit_variacao_skus, public.kit_variacao_componentes
  to estoque_rpc_executor;
grant select, update on public.kit_transferencias to estoque_rpc_executor;
grant select, insert, delete on public.kit_exclusoes to estoque_rpc_executor;

drop policy if exists "estoque_rpc_executor: select organizations" on public.organizations;
create policy "estoque_rpc_executor: select organizations" on public.organizations
  for select to estoque_rpc_executor using (true);
drop policy if exists "estoque_rpc_executor: trava organizations" on public.organizations;
create policy "estoque_rpc_executor: trava organizations" on public.organizations
  for update to estoque_rpc_executor using (true) with check (true);
drop policy if exists "estoque_rpc_executor: select kits" on public.kits_variacao;
create policy "estoque_rpc_executor: select kits" on public.kits_variacao
  for select to estoque_rpc_executor using (true);
drop policy if exists "estoque_rpc_executor: select kit skus" on public.kit_variacao_skus;
create policy "estoque_rpc_executor: select kit skus" on public.kit_variacao_skus
  for select to estoque_rpc_executor using (true);
drop policy if exists "estoque_rpc_executor: select componentes" on public.kit_variacao_componentes;
create policy "estoque_rpc_executor: select componentes" on public.kit_variacao_componentes
  for select to estoque_rpc_executor using (true);
drop policy if exists "estoque_rpc_executor: select transferencias" on public.kit_transferencias;
create policy "estoque_rpc_executor: select transferencias" on public.kit_transferencias
  for select to estoque_rpc_executor using (true);
drop policy if exists "estoque_rpc_executor: trava transferencias" on public.kit_transferencias;
create policy "estoque_rpc_executor: trava transferencias" on public.kit_transferencias
  for update to estoque_rpc_executor using (true) with check (true);
drop policy if exists "estoque_rpc_executor: select exclusoes" on public.kit_exclusoes;
create policy "estoque_rpc_executor: select exclusoes" on public.kit_exclusoes
  for select to estoque_rpc_executor using (true);
drop policy if exists "estoque_rpc_executor: insert exclusoes" on public.kit_exclusoes;
create policy "estoque_rpc_executor: insert exclusoes" on public.kit_exclusoes
  for insert to estoque_rpc_executor with check (true);
drop policy if exists "estoque_rpc_executor: delete exclusoes" on public.kit_exclusoes;
create policy "estoque_rpc_executor: delete exclusoes" on public.kit_exclusoes
  for delete to estoque_rpc_executor using (true);

-- SKU listado em transferência aberta, direto ou como componente de um SKU de kit listado.
-- Org sem transferência aberta para no índice parcial: nada muda para quem não usa kit.
create or replace function public.kit_sku_em_transferencia(p_org uuid, p_codigo text)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1
    from public.kit_transferencias t
    cross join lateral jsonb_array_elements(t.itens) e
    where t.org_id = p_org and t.estado in ('ativa', 'travada')
      and (e->>'codigo' = p_codigo or exists (
        select 1
        from public.kit_variacao_skus s
        join public.kit_variacao_componentes c on c.kit_sku_id = s.id
        where s.org_id = p_org and s.kit_id = t.kit_id
          and s.codigo = e->>'codigo' and c.codigo = p_codigo))
  )
$$;

-- O que a transferência move, por SKU, já somando combinações que usam a mesma peça: o índice único
-- do ledger aceita um movimento por código. Unidade: kit no SKU de kit, peça no componente.
create or replace function public.kit_transferencia_movimentos(p_org uuid, p_transferencia uuid)
returns table (codigo text, papel text, quantidade integer)
language sql stable set search_path = ''
as $$
  with t as (
    select x.tipo, x.kit_id, x.itens
    from public.kit_transferencias x
    where x.id = p_transferencia and x.org_id = p_org and x.tipo in ('montar', 'repor', 'desmontar')
  ), i as (
    select s.id, s.codigo, sum((e->>'quantidade')::integer) as n
    from t
    cross join lateral jsonb_array_elements(t.itens) e
    join public.kit_variacao_skus s on s.org_id = p_org and s.kit_id = t.kit_id and s.codigo = e->>'codigo'
    group by s.id, s.codigo
  )
  select i.codigo,
         case when (select tipo from t) = 'desmontar' then 'origem' else 'destino' end,
         i.n::integer
  from i
  union all
  select c.codigo,
         case when (select tipo from t) = 'desmontar' then 'destino' else 'origem' end,
         sum(i.n * c.quantidade)::integer
  from i
  join public.kit_variacao_componentes c on c.kit_sku_id = i.id and c.org_id = p_org
  group by c.codigo
$$;

-- Trava a variação canônica (família mais recente, âncora de baixar_estoque e do push).
create or replace function public.kit_sku_travado(
  p_org uuid, p_codigo text, out p_id uuid, out p_pai text, out p_estoque integer
) language plpgsql set search_path = ''
as $$
begin
  select v.id, f.codigo_pai into p_id, p_pai
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo
  order by f.criado_em desc
  limit 1;

  if p_id is not null then
    select v.estoque into p_estoque from public.variacoes v where v.id = p_id for update;
  end if;
end $$;

-- Toda escrita de saldo de transferência passa aqui.
create or replace function public.kit_aplicar_movimento(
  p_org uuid, p_transferencia uuid, p_codigo text, p_delta integer, p_motivo text
) returns void language plpgsql set search_path = ''
as $$
declare v_sku record; v_novo integer;
begin
  select * into v_sku from public.kit_sku_travado(p_org, p_codigo);
  if v_sku.p_id is null then
    raise exception 'kit_aplicar_movimento: SKU % não encontrado na organização', p_codigo;
  end if;

  update public.variacoes set estoque = estoque + p_delta
  where id = v_sku.p_id
  returning estoque into v_novo;

  -- `push_enfileirado_em` preenchido já na inserção: com `codigo_pai`, o movimento cairia no outbox
  -- genérico (estoque_movimentos_push_pendente_idx), e o push absoluto é o que a saga proíbe.
  insert into public.estoque_movimentos
    (org_id, codigo, codigo_pai, quantidade, motivo, transferencia_id,
     estoque_anterior, estoque_resultante, push_enfileirado_em)
  values (p_org, p_codigo, v_sku.p_pai, p_delta, p_motivo, p_transferencia,
          v_sku.p_estoque, v_novo, now());
end $$;

-- Grava `kit_saida` nas origens. Insuficiência devolve `{ok:false, motivo, codigo}` sem gravar nada:
-- primeiro trava e confere tudo, só depois escreve.
create or replace function public.kit_reservar_transferencia(p_org uuid, p_transferencia uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_modulos text[]; v_t public.kit_transferencias%rowtype; r record; v_sku record;
        v_meta integer; v_transito bigint;
begin
  -- Contrato de set_modulos_org_seguro: a linha da org trava antes de qualquer gravação.
  select modulos_habilitados into v_modulos from public.organizations where id = p_org for share;
  if not coalesce('kit_variacao' = any(v_modulos), false) then
    return jsonb_build_object('ok', false, 'motivo', 'modulo_desligado');
  end if;

  select * into v_t from public.kit_transferencias
  where id = p_transferencia and org_id = p_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'transferencia_nao_encontrada');
  end if;

  if exists (
    select 1 from public.estoque_movimentos s
    join public.estoque_movimentos e on e.transferencia_id = s.transferencia_id and e.codigo = s.codigo
    where s.transferencia_id = p_transferencia and s.motivo = 'kit_saida' and e.motivo = 'kit_entrada'
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'transferencia_cancelada');
  end if;

  if exists (select 1 from public.estoque_movimentos
             where transferencia_id = p_transferencia and motivo = 'kit_saida') then
    return jsonb_build_object('ok', true, 'aplicado', false);
  end if;

  if v_t.estado <> 'ativa' then
    return jsonb_build_object('ok', false, 'motivo', 'transferencia_fechada');
  end if;

  if v_t.tipo not in ('montar', 'repor', 'desmontar') then
    return jsonb_build_object('ok', true, 'aplicado', false);
  end if;

  if jsonb_array_length(v_t.itens) = 0 or exists (
    select 1 from jsonb_array_elements(v_t.itens) e
    where coalesce((e->>'quantidade')::integer, 0) <= 0 or not exists (
      select 1 from public.kit_variacao_skus s
      join public.kit_variacao_componentes c on c.kit_sku_id = s.id
      where s.org_id = p_org and s.kit_id = v_t.kit_id and s.codigo = e->>'codigo')
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'itens_invalidos');
  end if;

  for r in
    select m.codigo, m.papel, m.quantidade
    from public.kit_transferencia_movimentos(p_org, p_transferencia) m
    order by m.codigo
  loop
    select * into v_sku from public.kit_sku_travado(p_org, r.codigo);
    if v_sku.p_id is null then
      return jsonb_build_object('ok', false, 'motivo', 'sku_nao_encontrado', 'codigo', r.codigo);
    end if;

    -- `estoque` já é líquido das outras reservas: kit_saida baixou na hora.
    if r.papel = 'origem' and v_sku.p_estoque < r.quantidade then
      return jsonb_build_object('ok', false, 'motivo', 'peca_insuficiente', 'codigo', r.codigo);
    end if;

    -- Só `repor`: meta é o alvo da automação, e o padrão 0 recusaria toda montagem manual.
    if v_t.tipo = 'repor' and r.papel = 'destino' then
      select k.meta into v_meta from public.kits_variacao k where k.id = v_t.kit_id;

      -- Kits a caminho deste SKU em outra transferência: saíram da origem e ainda não chegaram.
      select coalesce(sum(m.quantidade), 0) into v_transito
      from public.kit_transferencias o
      cross join lateral public.kit_transferencia_movimentos(p_org, o.id) m
      where o.org_id = p_org and o.estado in ('ativa', 'travada') and o.id <> p_transferencia
        and m.papel = 'destino' and m.codigo = r.codigo
        and exists (select 1 from public.estoque_movimentos s
                    where s.transferencia_id = o.id and s.motivo = 'kit_saida')
        and not exists (select 1 from public.estoque_movimentos e
                        where e.transferencia_id = o.id and e.motivo = 'kit_entrada');

      if v_sku.p_estoque + v_transito + r.quantidade > v_meta then
        return jsonb_build_object('ok', false, 'motivo', 'acima_da_meta', 'codigo', r.codigo);
      end if;
    end if;
  end loop;

  for r in
    select m.codigo, m.quantidade
    from public.kit_transferencia_movimentos(p_org, p_transferencia) m
    where m.papel = 'origem'
    order by m.codigo
  loop
    perform public.kit_aplicar_movimento(p_org, p_transferencia, r.codigo, -r.quantidade, 'kit_saida');
  end loop;

  return jsonb_build_object('ok', true, 'aplicado', true);
end $$;

-- Grava `kit_entrada` no destino. `travada` passa: é o operador resolvendo a saga parada.
create or replace function public.kit_creditar_transferencia(p_org uuid, p_transferencia uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_t public.kit_transferencias%rowtype; r record;
begin
  select * into v_t from public.kit_transferencias
  where id = p_transferencia and org_id = p_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'transferencia_nao_encontrada');
  end if;

  if exists (
    select 1 from public.estoque_movimentos s
    join public.estoque_movimentos e on e.transferencia_id = s.transferencia_id and e.codigo = s.codigo
    where s.transferencia_id = p_transferencia and s.motivo = 'kit_saida' and e.motivo = 'kit_entrada'
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'transferencia_cancelada');
  end if;

  if v_t.tipo not in ('montar', 'repor', 'desmontar') or exists (
    select 1 from public.estoque_movimentos
    where transferencia_id = p_transferencia and motivo = 'kit_entrada'
  ) then
    return jsonb_build_object('ok', true, 'aplicado', false);
  end if;

  if v_t.estado not in ('ativa', 'travada') then
    return jsonb_build_object('ok', false, 'motivo', 'transferencia_fechada');
  end if;

  -- Origens calculadas e ledger precisam ser iguais nos dois sentidos. `itens` alterado depois da
  -- reserva criaria peça (origem a mais) ou deixaria peça sem destino, sumindo do trânsito (a menos).
  if not exists (select 1 from public.estoque_movimentos
                 where transferencia_id = p_transferencia and motivo = 'kit_saida')
    or exists (
      (select m.codigo, m.quantidade
       from public.kit_transferencia_movimentos(p_org, p_transferencia) m where m.papel = 'origem'
       except
       select e.codigo, -e.quantidade
       from public.estoque_movimentos e
       where e.transferencia_id = p_transferencia and e.motivo = 'kit_saida')
      union all
      (select e.codigo, -e.quantidade
       from public.estoque_movimentos e
       where e.transferencia_id = p_transferencia and e.motivo = 'kit_saida'
       except
       select m.codigo, m.quantidade
       from public.kit_transferencia_movimentos(p_org, p_transferencia) m where m.papel = 'origem')
    ) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_reserva');
  end if;

  for r in
    select m.codigo, m.quantidade
    from public.kit_transferencia_movimentos(p_org, p_transferencia) m
    where m.papel = 'destino'
    order by m.codigo
  loop
    perform public.kit_aplicar_movimento(p_org, p_transferencia, r.codigo, r.quantidade, 'kit_entrada');
  end loop;

  return jsonb_build_object('ok', true, 'aplicado', true);
end $$;

-- Devolve à origem o que saiu e não chegou, pelo delta do ledger. Sem checar `estado`, módulo nem
-- `itens`: peça em trânsito precisa conseguir voltar em qualquer situação, e só o ledger diz o que saiu.
create or replace function public.kit_cancelar_transferencia(p_org uuid, p_transferencia uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare r record; v_aplicado boolean := false;
begin
  perform 1 from public.kit_transferencias
  where id = p_transferencia and org_id = p_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'transferencia_nao_encontrada');
  end if;

  -- Qualquer kit_entrada encerra: ou chegou ao destino, ou já voltou.
  if exists (select 1 from public.estoque_movimentos
             where transferencia_id = p_transferencia and motivo = 'kit_entrada') then
    return jsonb_build_object('ok', true, 'aplicado', false);
  end if;

  for r in
    select m.codigo, m.quantidade from public.estoque_movimentos m
    where m.transferencia_id = p_transferencia and m.motivo = 'kit_saida'
    order by m.codigo
  loop
    perform public.kit_aplicar_movimento(p_org, p_transferencia, r.codigo, -r.quantidade, 'kit_entrada');
    v_aplicado := true;
  end loop;

  return jsonb_build_object('ok', true, 'aplicado', v_aplicado);
end $$;

-- Tudo ou nada, em ordem de código: dois donos disputando conjuntos que se cruzam não travam um ao
-- outro. O mesmo dono repetindo passa, porque retry de saga é normal.
create or replace function public.kit_adquirir_exclusao(
  p_org uuid, p_codigos text[], p_dono_tipo text, p_dono_id uuid
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_modulos text[]; v_codigo text;
begin
  select modulos_habilitados into v_modulos from public.organizations where id = p_org for share;
  if not coalesce('kit_variacao' = any(v_modulos), false) then
    return jsonb_build_object('ok', false, 'motivo', 'modulo_desligado');
  end if;

  -- A exceção desfaz a subtransação do bloco: é ela que solta o que entrou antes do conflito.
  begin
    for v_codigo in select distinct c from unnest(p_codigos) c order by 1 loop
      insert into public.kit_exclusoes (org_id, codigo, dono_tipo, dono_id)
      values (p_org, v_codigo, p_dono_tipo, p_dono_id)
      on conflict (org_id, codigo) do nothing;

      if not found and not exists (
        select 1 from public.kit_exclusoes
        where org_id = p_org and codigo = v_codigo and dono_tipo = p_dono_tipo and dono_id = p_dono_id
      ) then
        raise exception '%', v_codigo using errcode = 'KX001';
      end if;
    end loop;
  exception when sqlstate 'KX001' then
    return jsonb_build_object('ok', false, 'codigo', sqlerrm);
  end;

  return jsonb_build_object('ok', true);
end $$;

create or replace function public.kit_soltar_exclusao(p_org uuid, p_dono_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.kit_exclusoes where org_id = p_org and dono_id = p_dono_id;
end $$;

-- Corpo de 20260903002527 mais o guard do ADR-0197. O guard vem depois do insert e do lock: retry de
-- referência já aplicada segue devolvendo null, e a transferência aberta antes do lock é vista.
create or replace function public.registrar_entrada(
  p_org uuid, p_codigo text, p_qtd integer, p_custo numeric,
  p_doc text, p_obs text, p_criado_por uuid, p_ref text
) returns integer language plpgsql security definer set search_path = ''
as $$
declare v_var uuid; v_pai text; v_antes integer; v_novo integer; v_mov uuid; v_kit smallint;
begin
  if p_qtd is null or p_qtd <= 0 then
    raise exception 'registrar_entrada: quantidade deve ser positiva (recebeu %)', p_qtd;
  end if;
  if p_custo is not null and p_custo <= 0 then
    raise exception 'registrar_entrada: custo deve ser positivo quando informado (recebeu %)', p_custo;
  end if;
  if p_ref is null or btrim(p_ref) = '' then
    raise exception 'registrar_entrada: referência de idempotência é obrigatória';
  end if;

  select v.id, f.codigo_pai, f.kit_multiplicador into v_var, v_pai, v_kit
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo
  order by f.criado_em desc
  limit 1;

  if v_var is null then
    raise exception 'registrar_entrada: SKU % não encontrado na organização', p_codigo;
  end if;

  -- ADR-0151 D-9: kit vinculado não tem saldo próprio. Dar entrada aqui criaria um saldo
  -- real que o push, a publicação e a tela ignoram — dessincronização silenciosa.
  if v_kit is not null then
    raise exception 'registrar_entrada: % é um kit vinculado e não tem estoque próprio. Dê entrada no produto-base.', p_codigo
      using errcode = '23514';
  end if;

  begin
    insert into public.estoque_movimentos
      (org_id, codigo, codigo_pai, quantidade, motivo, custo_unitario, documento,
       observacao, criado_por, referencia_externa, push_canal_origem)
    values (p_org, p_codigo, v_pai, p_qtd, 'entrada', p_custo, p_doc,
            p_obs, p_criado_por, p_ref, null)
    returning id into v_mov;
  exception when unique_violation then
    return null;
  end;

  select estoque into v_antes from public.variacoes where id = v_var for update;

  -- ADR-0197: a exceção derruba também o insert acima.
  if public.kit_sku_em_transferencia(p_org, p_codigo) then
    raise exception 'sku_em_transferencia: % está em transferência de kit. Repita a entrada depois.', p_codigo
      using errcode = '23514';
  end if;

  update public.variacoes
  set estoque = estoque + p_qtd,
      custo   = coalesce(p_custo, custo)
  where id = v_var
  returning estoque into v_novo;

  update public.estoque_movimentos
  set estoque_anterior = v_antes, estoque_resultante = v_novo
  where id = v_mov;

  return v_novo;
end $$;

create or replace function public.ajustar_estoque(
  p_org uuid, p_codigo text, p_novo_saldo integer, p_obs text,
  p_criado_por uuid, p_ref text
) returns integer language plpgsql security definer set search_path = ''
as $$
declare v_var uuid; v_pai text; v_antes integer; v_novo integer; v_mov uuid; v_kit smallint;
begin
  if p_novo_saldo is null or p_novo_saldo < 0 then
    raise exception 'ajustar_estoque: novo saldo deve ser inteiro >= 0 (recebeu %)', p_novo_saldo;
  end if;
  if p_novo_saldo > 99999 then
    raise exception 'ajustar_estoque: novo saldo acima do teto do canal (99999): %', p_novo_saldo;
  end if;
  if p_ref is null or btrim(p_ref) = '' then
    raise exception 'ajustar_estoque: referência de idempotência é obrigatória';
  end if;

  select v.id, f.codigo_pai, f.kit_multiplicador into v_var, v_pai, v_kit
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo
  order by f.criado_em desc
  limit 1;

  if v_var is null then
    raise exception 'ajustar_estoque: SKU % não encontrado na organização', p_codigo;
  end if;

  -- ADR-0151 D-9, mesma razão da entrada.
  if v_kit is not null then
    raise exception 'ajustar_estoque: % é um kit vinculado e não tem estoque próprio. Ajuste o produto-base.', p_codigo
      using errcode = '23514';
  end if;

  begin
    insert into public.estoque_movimentos
      (org_id, codigo, codigo_pai, quantidade, motivo, observacao, criado_por,
       referencia_externa, push_canal_origem)
    values (p_org, p_codigo, v_pai, 0, 'ajuste', p_obs, p_criado_por, p_ref, null)
    returning id into v_mov;
  exception when unique_violation then
    return null;
  end;

  select estoque into v_antes from public.variacoes where id = v_var for update;

  -- ADR-0197: a exceção derruba também o insert acima.
  if public.kit_sku_em_transferencia(p_org, p_codigo) then
    raise exception 'sku_em_transferencia: % está em transferência de kit. Repita o ajuste depois.', p_codigo
      using errcode = '23514';
  end if;

  if p_novo_saldo > v_antes then
    raise exception 'ajustar_estoque: ajuste só reduz saldo (atual %, pedido %). Para aumentar, use Entrada de mercadoria.', v_antes, p_novo_saldo;
  end if;

  update public.variacoes set estoque = p_novo_saldo
  where id = v_var
  returning estoque into v_novo;

  update public.estoque_movimentos
  set quantidade = v_novo - v_antes, estoque_anterior = v_antes, estoque_resultante = v_novo
  where id = v_mov;

  return v_novo;
end $$;

-- ACL ANTES da troca de dono: depois dela, revoke e grant viram no-op e a função definer fica
-- exposta a PUBLIC (20260811203500). Peças internas: só o dono executa, nem o service role.
revoke all on function public.kit_sku_em_transferencia(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.kit_transferencia_movimentos(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.kit_sku_travado(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.kit_aplicar_movimento(uuid, uuid, text, integer, text) from public, anon, authenticated, service_role;

revoke all on function public.kit_reservar_transferencia(uuid, uuid) from public, anon, authenticated;
revoke all on function public.kit_creditar_transferencia(uuid, uuid) from public, anon, authenticated;
revoke all on function public.kit_cancelar_transferencia(uuid, uuid) from public, anon, authenticated;
revoke all on function public.kit_adquirir_exclusao(uuid, text[], text, uuid) from public, anon, authenticated;
revoke all on function public.kit_soltar_exclusao(uuid, uuid) from public, anon, authenticated;
grant execute on function public.kit_reservar_transferencia(uuid, uuid) to service_role;
grant execute on function public.kit_creditar_transferencia(uuid, uuid) to service_role;
grant execute on function public.kit_cancelar_transferencia(uuid, uuid) to service_role;
grant execute on function public.kit_adquirir_exclusao(uuid, text[], text, uuid) to service_role;
grant execute on function public.kit_soltar_exclusao(uuid, uuid) to service_role;

alter function public.kit_sku_em_transferencia(uuid, text) owner to estoque_rpc_executor;
alter function public.kit_transferencia_movimentos(uuid, uuid) owner to estoque_rpc_executor;
alter function public.kit_sku_travado(uuid, text) owner to estoque_rpc_executor;
alter function public.kit_aplicar_movimento(uuid, uuid, text, integer, text) owner to estoque_rpc_executor;
alter function public.kit_reservar_transferencia(uuid, uuid) owner to estoque_rpc_executor;
alter function public.kit_creditar_transferencia(uuid, uuid) owner to estoque_rpc_executor;
alter function public.kit_cancelar_transferencia(uuid, uuid) owner to estoque_rpc_executor;
alter function public.kit_adquirir_exclusao(uuid, text[], text, uuid) owner to estoque_rpc_executor;
alter function public.kit_soltar_exclusao(uuid, uuid) owner to estoque_rpc_executor;

revoke create on schema public from estoque_rpc_executor;

-- Tolerante como em 20260811203500: o membership de postgres tem grantor supabase_admin.
do $$
begin
  revoke estoque_rpc_executor from postgres;
exception when others then
  raise warning 'membership de postgres em estoque_rpc_executor nao revogada: %', sqlerrm;
end $$;
