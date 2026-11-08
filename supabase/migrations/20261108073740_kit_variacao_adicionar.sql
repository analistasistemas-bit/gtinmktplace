-- ADR-0197 (Task 13, ajuste): "Montar mais" num kit existente. Combinação ou tamanho já publicado só aumenta o saldo;
-- combinação ou tamanho nunca publicado vira SKU novo no MESMO kit (e na mesma família do kit), criado pela saga como
-- alvo `criar` (passo `aumentar`), como na criação (spec, "Gerenciar": linha 91).
--
-- Uma transferência `montar` só, com os SKUs novos e os já publicados: duas transferências sobre as mesmas peças
-- disputariam a exclusão. Mesmas garantias de `kit_variacao_criar`: org travada com o módulo, `base_em_kit`, marca
-- inicial sob o lock do saldo, "Vender só em kit" reivindicando as peças novas antes da montagem, e idempotência pela
-- chave com o hash do pedido (aqui em `kit_transferencias`, porque o kit já existe).
--
-- `db push` não roda em transação: cada statement é re-executável.

alter table public.kit_transferencias add column if not exists chave_cadastro uuid;
alter table public.kit_transferencias add column if not exists pedido_hash text;
create unique index if not exists kit_transferencias_chave_idx on public.kit_transferencias (org_id, chave_cadastro);

-- p_novos      = [{"codigo","tamanho","cores":[...],"rotulo_cor","quantidade","componentes":[{"codigo","quantidade"}]}]
--                (as variações já existem na família do kit; a edge as insere antes)
-- p_existentes = [{"codigo","quantidade"}] de SKUs já do kit
-- p_baseline   = [{"codigo","ml"}] das peças (as sem marca precisam estar aqui)
-- p_alvos      = alvos de tudo que não é `criar`: peças e SKUs já publicados ([{"codigo","up_id","item_ids"}])
create or replace function public.kit_variacao_adicionar(
  p_org uuid, p_kit uuid, p_chave uuid, p_hash text, p_novos jsonb, p_existentes jsonb, p_baseline jsonb, p_alvos jsonb
) returns jsonb language plpgsql set search_path = ''
as $$
declare v_kit public.kits_variacao%rowtype; v_sku uuid; v_id uuid; v_estoque integer; v_motivo text; v_comp text[];
        v_t jsonb; v_s jsonb; v_b record; v_ja public.kit_transferencias%rowtype;
begin
  perform 1 from public.organizations where id = p_org and 'kit_variacao' = any(modulos_habilitados) for share;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'modulo_desligado');
  end if;

  select * into v_ja from public.kit_transferencias where org_id = p_org and chave_cadastro = p_chave;
  if found then
    if v_ja.pedido_hash is distinct from p_hash or v_ja.kit_id is distinct from p_kit then
      return jsonb_build_object('ok', false, 'motivo', 'pedido_diferente');
    end if;
    return jsonb_build_object('ok', true, 'existente', true, 'kit_id', p_kit, 'transferencia_id', v_ja.id);
  end if;

  -- Trava o kit: duas adições concorrentes (chaves diferentes) não criam a mesma combinação duas vezes.
  select * into v_kit from public.kits_variacao where id = p_kit and org_id = p_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'kit_nao_encontrado');
  end if;

  if jsonb_typeof(p_novos) is distinct from 'array' or jsonb_typeof(p_existentes) is distinct from 'array'
     or jsonb_array_length(p_novos) + jsonb_array_length(p_existentes) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sem_kit');
  end if;
  if exists (select 1 from jsonb_array_elements(p_existentes) e
             where not exists (select 1 from public.kit_variacao_skus s
                               where s.org_id = p_org and s.kit_id = p_kit and s.codigo = e->>'codigo')) then
    return jsonb_build_object('ok', false, 'motivo', 'sku_inexistente');
  end if;

  -- Combinação como conjunto de cores + tamanho: a ordem em que as cores foram marcadas não cria outra combinação.
  if exists (
    select 1 from jsonb_array_elements(p_novos) n
    where exists (
      select 1 from public.kit_variacao_skus s
      where s.org_id = p_org and s.kit_id = p_kit and s.tamanho = n->>'tamanho'
        and array(select x from unnest(s.cores) x order by x)
          = array(select x from jsonb_array_elements_text(n->'cores') x order by x))
  ) or (
    select count(*) <> count(distinct (n->>'tamanho', array(select x from jsonb_array_elements_text(n->'cores') x order by x)))
    from jsonb_array_elements(p_novos) n
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'combinacao_existente');
  end if;

  v_comp := array(select distinct c->>'codigo' from jsonb_array_elements(p_novos) s
                  cross join lateral jsonb_array_elements(s->'componentes') c);
  v_motivo := public.kit_variacao_base_em_kit(p_org, v_comp);
  if v_motivo is not null then
    return jsonb_build_object('ok', false, 'motivo', 'base_em_kit', 'mensagem', v_motivo);
  end if;
  if exists (select unnest(v_comp)
             except select codigo from public.kit_marca_ml where org_id = p_org
             except select b->>'codigo' from jsonb_array_elements(p_baseline) b) then
    return jsonb_build_object('ok', false, 'motivo', 'baseline_incompleto');
  end if;

  begin
    for v_s in select * from jsonb_array_elements(p_novos) loop
      insert into public.kit_variacao_skus (org_id, kit_id, codigo, tamanho, cores, rotulo_cor)
      values (p_org, p_kit, v_s->>'codigo', v_s->>'tamanho',
              array(select jsonb_array_elements_text(v_s->'cores')), v_s->>'rotulo_cor')
      returning id into v_sku;
      insert into public.kit_variacao_componentes (kit_sku_id, org_id, codigo, quantidade)
      select v_sku, p_org, c->>'codigo', (c->>'quantidade')::integer from jsonb_array_elements(v_s->'componentes') c;
    end loop;

    -- Marca inicial: mesmo laço de `kit_variacao_criar` (SKU novo = 0; peça sem marca exige local == ML).
    for v_b in
      select x.codigo, max(x.ml) as ml from (
        select e->>'codigo' as codigo, (e->>'ml')::integer as ml from jsonb_array_elements(p_baseline) e
        where e->>'codigo' = any(v_comp)
        union all
        select s->>'codigo', 0 from jsonb_array_elements(p_novos) s
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

    -- "Vender só em kit": peça nova vai a Guardado antes da transferência (a soma de versões já inclui a mudança).
    if v_kit.so_em_kit then
      perform public.kit_reposicao_reivindicar(p_org, p_kit);
    end if;

    v_t := public.kit_criar_transferencia(p_org, p_kit, 'montar',
      (select jsonb_agg(x) from (
         select jsonb_build_object('codigo', s->>'codigo', 'quantidade', (s->>'quantidade')::integer) as x
         from jsonb_array_elements(p_novos) s
         union all
         select jsonb_build_object('codigo', e->>'codigo', 'quantidade', (e->>'quantidade')::integer)
         from jsonb_array_elements(p_existentes) e) q),
      p_alvos || coalesce((select jsonb_agg(jsonb_build_object('codigo', s->>'codigo', 'criar', true))
                           from jsonb_array_elements(p_novos) s), '[]'::jsonb));
    if not coalesce((v_t->>'ok')::boolean, false) then
      raise exception '%', coalesce(v_t->>'motivo', 'transferencia') || coalesce(':' || (v_t->>'codigo'), '')
        using errcode = 'KX008';
    end if;
    update public.kit_transferencias set chave_cadastro = p_chave, pedido_hash = p_hash where id = (v_t->>'id')::uuid;
    -- SKU novo: o fim da saga (`fecharCriacao`) devolve o kit a publicado, ou erro se o CREATE travar.
    if jsonb_array_length(p_novos) > 0 then
      update public.kits_variacao set status = 'publicando' where id = p_kit;
    end if;
  exception
    when sqlstate 'KX006' then
      return jsonb_build_object('ok', false, 'motivo', 'baseline_divergente', 'codigo', sqlerrm);
    when sqlstate 'KX007' then
      return jsonb_build_object('ok', false, 'motivo', 'sku_nao_encontrado', 'codigo', sqlerrm);
    when sqlstate 'KX008' then
      return jsonb_build_object('ok', false, 'motivo', split_part(sqlerrm, ':', 1), 'codigo', nullif(split_part(sqlerrm, ':', 2), ''));
    when unique_violation then
      return jsonb_build_object('ok', false, 'motivo', 'combinacao_existente');
  end;

  return jsonb_build_object('ok', true, 'kit_id', p_kit, 'transferencia_id', v_t->>'id');
end $$;

revoke all on function public.kit_variacao_adicionar(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.kit_variacao_adicionar(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) to service_role;
