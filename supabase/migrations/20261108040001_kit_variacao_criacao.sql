-- ADR-0197 (Task 10): criação do kit com variação e destino sem item na saga.
--
-- 1. Destino sem item: o SKU de kit novo ainda não tem UP. O alvo nasce com `criar = true`, `up_id`
--    sintético `criar:<codigo>` (a PK e a chave de `kit_saga_salvar_alvo` continuam estáveis) e
--    `item_ids` vazio. O passo `aumentar` cria o item (exceção da spec: CREATE com saldo inicial só depois
--    de todas as reduções confirmadas) e grava `up_criado`/`item_criado` uma vez só.
-- 2. `kit_variacao_criar`: grava kit, SKUs, composição, marca d'água inicial e a transferência `montar`
--    numa transação. Sem isso, linhas de kit commitadas sem transferência deixariam o participante
--    disputável (outbox, triagem) e sem marca: a primeira entrada travaria a saga.
--
-- `db push` não roda em transação: cada statement é re-executável.

grant estoque_rpc_executor to postgres;
grant usage, create on schema public to estoque_rpc_executor;

alter table public.kits_variacao add column if not exists chave_cadastro uuid;
create unique index if not exists kits_variacao_chave_idx on public.kits_variacao (org_id, chave_cadastro);

alter table public.kit_transferencia_alvos add column if not exists criar boolean not null default false;
alter table public.kit_transferencia_alvos add column if not exists up_criado text;
alter table public.kit_transferencia_alvos add column if not exists item_criado text;

-- Corpo de 20261107212019 mais o alvo `criar`: só destino de `montar`, sem UP nem itens.
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
    where coalesce(a->>'codigo', '') = ''
      or (coalesce((a->>'criar')::boolean, false) is false and (
        coalesce(a->>'up_id', '') = ''
        or jsonb_typeof(a->'item_ids') is distinct from 'array' or jsonb_array_length(a->'item_ids') = 0))
  ) or (select count(distinct a->>'codigo') <> count(*)
            or count(distinct coalesce(a->>'up_id', 'criar:' || (a->>'codigo'))) <> count(*)
        from jsonb_array_elements(p_alvos) a) then
    return jsonb_build_object('ok', false, 'motivo', 'alvos_invalidos');
  end if;

  v_codigos := array(select a->>'codigo' from jsonb_array_elements(p_alvos) a);
  select coalesce(sum(p.versao), 0) into v_versao
  from public.sku_politica_kit p where p.org_id = p_org and p.codigo = any(v_codigos);

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

    insert into public.kit_transferencia_alvos
      (transferencia_id, org_id, up_id, codigo, item_ids, papel, delta, criar)
    select v_id, p_org,
           case when coalesce((a->>'criar')::boolean, false) then 'criar:' || (a->>'codigo') else a->>'up_id' end,
           a->>'codigo',
           case when coalesce((a->>'criar')::boolean, false) then '{}'::text[]
                else array(select jsonb_array_elements_text(a->'item_ids')) end,
           coalesce(m.papel, 'destino'),
           case m.papel when 'origem' then -m.quantidade when 'destino' then m.quantidade else 0 end,
           coalesce((a->>'criar')::boolean, false)
    from jsonb_array_elements(p_alvos) a
    left join public.kit_transferencia_movimentos(p_org, v_id) m on m.codigo = a->>'codigo';

    -- Item novo só nasce como destino de montagem, com algo a receber: é o CREATE da exceção da spec.
    if exists (select 1 from public.kit_transferencia_alvos
               where transferencia_id = v_id and criar and (p_tipo <> 'montar' or papel <> 'destino' or delta <= 0)) then
      raise exception 'alvos' using errcode = 'KX002';
    end if;

    r := public.kit_adquirir_exclusao(p_org, v_codigos, 'transferencia', v_id);
    if not coalesce((r->>'ok')::boolean, false) then
      raise exception '%', coalesce(r->>'codigo', r->>'motivo') using errcode = 'KX001';
    end if;

    -- Alvo `criar` deixa a exclusão sem UP até o item existir.
    update public.kit_exclusoes x set up_id = a->>'up_id'
    from jsonb_array_elements(p_alvos) a
    where x.org_id = p_org and x.dono_id = v_id and x.codigo = a->>'codigo'
      and coalesce((a->>'criar')::boolean, false) is false;
  exception
    when sqlstate 'KX001' then
      return jsonb_build_object('ok', false, 'motivo', 'up_ocupado', 'codigo', sqlerrm);
    when sqlstate 'KX002' then
      return jsonb_build_object('ok', false, 'motivo', 'alvos_invalidos');
  end;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Corpo de 20261107212019 mais `up_criado`/`item_criado`, gravados uma vez só: o item criado não troca.
create or replace function public.kit_saga_salvar_alvo(
  p_org uuid, p_transferencia uuid, p_token uuid, p_up text, p_patch jsonb
) returns void language plpgsql set search_path = ''
as $$
declare v public.kit_transferencia_alvos%rowtype; v_confirmada timestamptz;
begin
  perform public.kit_saga_validar(p_org, p_transferencia, p_token);
  select * into v from public.kit_transferencia_alvos
  where transferencia_id = p_transferencia and org_id = p_org and up_id = p_up for update;
  if not found then
    raise exception 'kit_saga_salvar_alvo: alvo % não encontrado', p_up;
  end if;
  v_confirmada := v.confirmada_em;
  v := jsonb_populate_record(v, p_patch);
  if v_confirmada is null and v.confirmada_em is not null then
    select coalesce(a.marca_ordem, v.marca_ordem) into v.marca_ordem from public.kit_transferencia_alvos a
    where a.transferencia_id = p_transferencia and a.org_id = p_org and a.up_id = p_up;
    if v.marca_ordem is null then
      raise exception 'kit_saga_salvar_alvo: alvo % confirmado sem marca_ordem', p_up;
    end if;
    insert into public.kit_marca_ml (org_id, codigo, ordem) values (p_org, v.codigo, v.marca_ordem)
    on conflict (org_id, codigo) do update
      set ordem = greatest(public.kit_marca_ml.ordem, excluded.ordem), atualizado_em = now();
  end if;
  update public.kit_transferencia_alvos a set
    qtd_passo1 = v.qtd_passo1, passo1_em = v.passo1_em, ids_passo1 = v.ids_passo1,
    valor_anterior = coalesce(a.valor_anterior, v.valor_anterior), valor_alvo = coalesce(a.valor_alvo, v.valor_alvo), fase = coalesce(a.fase, v.fase),
    marca_ordem = coalesce(a.marca_ordem, v.marca_ordem),
    up_criado = coalesce(a.up_criado, v.up_criado), item_criado = coalesce(a.item_criado, v.item_criado),
    pausado_pela_saga = v.pausado_pela_saga, intencao_escrita_em = v.intencao_escrita_em,
    recusa_definitiva_em = v.recusa_definitiva_em, escrita_em = v.escrita_em, confirmada_em = v.confirmada_em,
    item_escrita = v.item_escrita, recusas = v.recusas, repausar = v.repausar
  where a.transferencia_id = p_transferencia and a.org_id = p_org and a.up_id = p_up;
end $$;

-- Criação do kit numa transação: kit, SKUs, composição, marca d'água inicial e a transferência `montar`
-- com os SKUs de kit como alvo `criar`. As variações do kit (estoque 0) já existem; a edge as insere antes.
--
-- Marca inicial (spec "Divergência entre ledger e ML"): todo SKU que vira participante e ainda não tem marca
-- ganha a maior `ordem` do ledger, sob o lock do saldo, desde que o saldo local seja igual ao ML lido pela
-- edge (`p_baseline`, SKU de kit = 0). Diferente recusa sem gravar nada: a saga travaria na primeira entrada.
-- SKU que já tem marca (participante de outro kit) a mantém.
--
-- p_kit      = {"codigo_pai_base","codigo_pai_kit","pecas_por_kit","preco","meta"}
-- p_skus     = [{"codigo","tamanho","cores":[...],"rotulo_cor","quantidade","componentes":[{"codigo","quantidade"}]}]
-- p_baseline = [{"codigo","ml"}] dos componentes
-- p_alvos    = alvos das origens, como `kit_criar_transferencia` ([{"codigo","up_id","item_ids"}])
create or replace function public.kit_variacao_criar(
  p_org uuid, p_chave uuid, p_kit jsonb, p_skus jsonb, p_baseline jsonb, p_alvos jsonb
) returns jsonb language plpgsql set search_path = ''
as $$
declare v_kit uuid; v_sku uuid; v_id uuid; v_estoque integer; v_motivo text; v_comp text[]; v_t jsonb;
        v_s jsonb; v_b record;
begin
  perform 1 from public.organizations where id = p_org and 'kit_variacao' = any(modulos_habilitados) for share;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'modulo_desligado');
  end if;

  select id into v_kit from public.kits_variacao where org_id = p_org and chave_cadastro = p_chave;
  if found then
    return jsonb_build_object('ok', true, 'existente', true, 'kit_id', v_kit, 'transferencia_id',
      (select id from public.kit_transferencias where org_id = p_org and kit_id = v_kit and tipo = 'montar'
       order by criado_em limit 1));
  end if;

  v_comp := array(select distinct c->>'codigo' from jsonb_array_elements(p_skus) s
                  cross join lateral jsonb_array_elements(s->'componentes') c);
  v_motivo := public.kit_variacao_base_em_kit(p_org, v_comp);
  if v_motivo is not null then
    return jsonb_build_object('ok', false, 'motivo', 'base_em_kit', 'mensagem', v_motivo);
  end if;
  if exists (select unnest(v_comp) except select b->>'codigo' from jsonb_array_elements(p_baseline) b) then
    return jsonb_build_object('ok', false, 'motivo', 'baseline_incompleto');
  end if;

  begin
    insert into public.kits_variacao (org_id, codigo_pai_base, codigo_pai_kit, pecas_por_kit, preco, meta, status, chave_cadastro)
    values (p_org, p_kit->>'codigo_pai_base', p_kit->>'codigo_pai_kit', (p_kit->>'pecas_por_kit')::smallint,
            (p_kit->>'preco')::numeric, coalesce((p_kit->>'meta')::integer, 0), 'publicando', p_chave)
    returning id into v_kit;

    for v_s in select * from jsonb_array_elements(p_skus) loop
      insert into public.kit_variacao_skus (org_id, kit_id, codigo, tamanho, cores, rotulo_cor)
      values (p_org, v_kit, v_s->>'codigo', v_s->>'tamanho',
              array(select jsonb_array_elements_text(v_s->'cores')), v_s->>'rotulo_cor')
      returning id into v_sku;
      insert into public.kit_variacao_componentes (kit_sku_id, org_id, codigo, quantidade)
      select v_sku, p_org, c->>'codigo', (c->>'quantidade')::integer from jsonb_array_elements(v_s->'componentes') c;
    end loop;

    for v_b in
      select x.codigo, max(x.ml) as ml from (
        select e->>'codigo' as codigo, (e->>'ml')::integer as ml from jsonb_array_elements(p_baseline) e
        where e->>'codigo' = any(v_comp)
        union all
        select s->>'codigo', 0 from jsonb_array_elements(p_skus) s
      ) x group by x.codigo order by x.codigo
    loop
      select v.id into v_id from public.variacoes v join public.familias f on f.id = v.familia_id
      where v.org_id = p_org and v.codigo = v_b.codigo order by f.criado_em desc limit 1;
      if v_id is null then
        raise exception '%', v_b.codigo using errcode = 'KX007';
      end if;
      select estoque into v_estoque from public.variacoes where id = v_id for update;
      continue when exists (select 1 from public.kit_marca_ml where org_id = p_org and codigo = v_b.codigo);
      if v_estoque is distinct from v_b.ml then
        raise exception '%', v_b.codigo || ': local ' || v_estoque || ', ML ' || v_b.ml using errcode = 'KX006';
      end if;
      insert into public.kit_marca_ml (org_id, codigo, ordem)
      select p_org, v_b.codigo, coalesce(max(m.ordem), 0) from public.estoque_movimentos m
      where m.org_id = p_org and m.codigo = v_b.codigo;
    end loop;

    v_t := public.kit_criar_transferencia(p_org, v_kit, 'montar',
      (select jsonb_agg(jsonb_build_object('codigo', s->>'codigo', 'quantidade', (s->>'quantidade')::integer))
       from jsonb_array_elements(p_skus) s),
      p_alvos || (select jsonb_agg(jsonb_build_object('codigo', s->>'codigo', 'criar', true))
                  from jsonb_array_elements(p_skus) s));
    if not coalesce((v_t->>'ok')::boolean, false) then
      raise exception '%', coalesce(v_t->>'motivo', 'transferencia') || coalesce(':' || (v_t->>'codigo'), '')
        using errcode = 'KX008';
    end if;
  exception
    when sqlstate 'KX006' then
      return jsonb_build_object('ok', false, 'motivo', 'baseline_divergente', 'codigo', sqlerrm);
    when sqlstate 'KX007' then
      return jsonb_build_object('ok', false, 'motivo', 'sku_nao_encontrado', 'codigo', sqlerrm);
    when sqlstate 'KX008' then
      return jsonb_build_object('ok', false, 'motivo', split_part(sqlerrm, ':', 1), 'codigo', nullif(split_part(sqlerrm, ':', 2), ''));
  end;

  return jsonb_build_object('ok', true, 'kit_id', v_kit, 'transferencia_id', v_t->>'id');
end $$;

revoke all on function public.kit_variacao_criar(uuid, uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.kit_variacao_criar(uuid, uuid, jsonb, jsonb, jsonb, jsonb) to service_role;

revoke create on schema public from estoque_rpc_executor;

do $$
begin
  revoke estoque_rpc_executor from postgres;
exception when others then
  raise warning 'membership de postgres em estoque_rpc_executor nao revogada: %', sqlerrm;
end $$;
