-- ADR-0181 D-12 (Plano 2b-2, Task 5): contagem física sobre a foto de 31/12 e confirmação, que
-- transforma as diferenças em movimentos reais (falta → ajuste relativo; sobra → entrada sem custo).
-- Spec: docs/superpowers/specs/2026-10-16-pacote-contador-inventario-design.md (§Leitura, contagem e
-- confirmação; §Imutabilidade). Triggers e flag de transação: 20261017000123_adr181_inventario_foto.sql.

-- ---------------------------------------------------------------------------------------------
-- 1) salvar_contagem_inventario: grava a contagem (parcial: só os itens enviados) e devolve a versão nova.
--    p_itens = [{codigo, quantidade_contada: int|null, justificativa: text|null}]; null = igual ao sistema.
-- ---------------------------------------------------------------------------------------------
create or replace function public.salvar_contagem_inventario(p_org uuid, p_id uuid, p_versao int, p_itens jsonb)
returns int language plpgsql security invoker set search_path = public, pg_temp
as $$
declare v_status text; v_versao int; e jsonb; v_tipo text; v_qtd numeric; v_just text; v_sist int;
begin
  select status, versao into v_status, v_versao from public.inventarios
   where id = p_id and org_id = p_org for update;
  if not found then
    raise exception 'salvar_contagem_inventario: inventário não encontrado' using errcode = 'P0002';
  end if;
  if v_status <> 'aberto' then
    raise exception 'salvar_contagem_inventario: inventário não está aberto (status %)', v_status using errcode = '23514';
  end if;
  -- Ruling 1: a edge traduz 40001 + esta mensagem em 409.
  if v_versao is distinct from p_versao then
    raise exception 'A contagem mudou em outra aba; recarregue.' using errcode = '40001';
  end if;
  if jsonb_typeof(p_itens) is distinct from 'array' then
    raise exception 'salvar_contagem_inventario: itens devem ser uma lista' using errcode = '22023';
  end if;
  if (select count(x->>'codigo') <> count(distinct x->>'codigo') from jsonb_array_elements(p_itens) x) then
    raise exception 'salvar_contagem_inventario: código repetido na lista' using errcode = '22023';
  end if;

  for e in select value from jsonb_array_elements(p_itens) loop
    v_tipo := jsonb_typeof(e->'quantidade_contada');
    if v_tipo is not null and v_tipo not in ('null', 'number') then
      raise exception 'salvar_contagem_inventario: contagem inválida em %', e->>'codigo' using errcode = '22023';
    end if;
    v_qtd := case when v_tipo = 'number' then (e->>'quantidade_contada')::numeric end;
    if v_qtd < 0 or v_qtd <> trunc(v_qtd) then
      raise exception 'salvar_contagem_inventario: contagem deve ser inteiro >= 0 em % (recebeu %)', e->>'codigo', v_qtd
        using errcode = '22023';
    end if;
    v_just := nullif(btrim(e->>'justificativa'), '');

    update public.inventarios_itens
       set quantidade_contada = v_qtd::int, justificativa = v_just
     where inventario_id = p_id and org_id = p_org and codigo = e->>'codigo'
    returning quantidade_sistema into v_sist;
    if not found then
      raise exception 'salvar_contagem_inventario: código % não pertence à foto', e->>'codigo' using errcode = '22023';
    end if;
    if v_qtd is not null and v_qtd <> v_sist and v_just is null then
      raise exception 'salvar_contagem_inventario: justificativa obrigatória em % (sistema %, contada %)',
        e->>'codigo', v_sist, v_qtd using errcode = '22023';
    end if;
  end loop;

  update public.inventarios set versao = versao + 1 where id = p_id returning versao into v_versao;
  return v_versao;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2) confirmar_inventario: numa transação, aplica as diferenças pelo fluxo normal de estoque, grava
--    as colunas *_final e trava a foto. Já confirmado → só devolve a lista (retry idempotente do push).
--    Retorno: {produtos: [{codigo_pai, reativar}]} — reativar = teve sobra (entrada).
-- ---------------------------------------------------------------------------------------------
create or replace function public.confirmar_inventario(p_org uuid, p_id uuid, p_versao int, p_user uuid)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp
as $$
declare v_status text; v_versao int; v_data date; v_lista text; r record; v_id uuid; v_saldo int; v_ret int;
  v_produtos jsonb;
begin
  select status, versao, data_base into v_status, v_versao, v_data from public.inventarios
   where id = p_id and org_id = p_org for update;
  if not found then
    raise exception 'confirmar_inventario: inventário não encontrado' using errcode = 'P0002';
  end if;

  if v_status = 'aberto' then
    if v_versao is distinct from p_versao then
      raise exception 'A contagem mudou em outra aba; recarregue.' using errcode = '40001';
    end if;

    select string_agg(codigo, ', ' order by codigo) into v_lista from public.inventarios_itens
     where inventario_id = p_id and org_id = p_org
       and quantidade_contada is not null and quantidade_contada <> quantidade_sistema
       and nullif(btrim(justificativa), '') is null;
    if v_lista is not null then
      raise exception 'confirmar_inventario: diferença sem justificativa em %', v_lista using errcode = '23514';
    end if;

    create temp table if not exists _inventario_confirmar (codigo text, id uuid, d int, saldo int, justificativa text)
      on commit drop;
    truncate pg_temp._inventario_confirmar;

    -- Trava a variação CANÔNICA de hoje de cada diferença (ordem determinística) e lê o saldo na linha travada.
    for r in select codigo, quantidade_contada - quantidade_sistema as d, justificativa from public.inventarios_itens
              where inventario_id = p_id and org_id = p_org
                and quantidade_contada is not null and quantidade_contada <> quantidade_sistema
              order by codigo loop
      v_id := null; v_saldo := null;
      select v.id, v.estoque into v_id, v_saldo
        from public.variacoes v join public.familias f on f.id = v.familia_id
       where v.org_id = p_org and v.codigo = r.codigo
       order by f.criado_em desc limit 1
       for update of v;
      if v_id is null then
        raise exception 'confirmar_inventario: SKU % não existe mais na organização', r.codigo using errcode = 'P0002';
      end if;
      insert into pg_temp._inventario_confirmar values (r.codigo, v_id, r.d, v_saldo, r.justificativa);
    end loop;

    -- Falta relativa maior que o saldo de hoje: recusa tudo (sem zerar parcialmente), antes de qualquer movimento.
    select string_agg(codigo || ' (saldo ' || saldo || ', falta ' || -d || ')', ', ' order by codigo) into v_lista
      from pg_temp._inventario_confirmar where d < 0 and saldo < -d;
    if v_lista is not null then
      raise exception 'confirmar_inventario: saldo de hoje insuficiente em %', v_lista using errcode = '23514';
    end if;

    for r in select * from pg_temp._inventario_confirmar order by codigo loop
      if r.d < 0 then
        v_ret := public.ajustar_estoque(p_org, r.codigo, r.saldo + r.d,
          'Inventário ' || to_char(v_data, 'DD/MM/YYYY') || ': ' || r.justificativa,
          p_user, 'inventario:' || p_id || ':' || r.codigo);
      else
        v_ret := public.registrar_entrada(p_org, r.codigo, r.d, null, 'Inventário ' || to_char(v_data, 'DD/MM/YYYY'),
          r.justificativa, p_user, 'inventario:' || p_id || ':' || r.codigo);
      end if;
      -- null = a ref já existia (a RPC engoliu o unique_violation sem mexer no saldo): não confirma sem o movimento.
      if v_ret is null then
        raise exception 'confirmar_inventario: movimento de % já existia; nada aplicado', r.codigo using errcode = '23505';
      end if;
      -- Guard canônico (20261016001451:51-57): a RPC resolve o canônico de novo pelo código; se não for a
      -- linha travada (família nova inserida no meio), aborta tudo em vez de mexer na linha errada.
      if (select v.id from public.variacoes v join public.familias f on f.id = v.familia_id
           where v.org_id = p_org and v.codigo = r.codigo
           order by f.criado_em desc limit 1) is distinct from r.id then
        raise exception 'confirmar_inventario: o produto % mudou durante a confirmação; tente de novo', r.codigo
          using errcode = '40001';
      end if;
    end loop;

    -- Itens antes do cabeçalho: o trigger dos itens exige o cabeçalho ainda 'aberto'.
    -- Convenção: a falta consome "sem nota" primeiro, a sobra entra como "sem nota", o custo médio não muda.
    perform set_config('publiai.inventario_confirmando', 'on', true);
    update public.inventarios_itens it
       set qtd_final = x.qf,
           qtd_valorizada_final = x.vf,
           qtd_sem_nota_final = greatest(x.qf, 0) - x.vf,
           valor_final = case when x.vf = it.qtd_valorizada then it.valor_total
                              when x.vf = 0 then 0
                              else round(x.vf * it.custo_medio, 2) end
      from (select i.id, q.qf, least(i.qtd_valorizada, greatest(q.qf, 0)) as vf
              from public.inventarios_itens i
              cross join lateral (select coalesce(i.quantidade_contada, i.quantidade_sistema) as qf) q
             where i.inventario_id = p_id and i.org_id = p_org) x
     where it.id = x.id;
    update public.inventarios set status = 'confirmado', confirmado_por = p_user, confirmado_em = now()
     where id = p_id;
    perform set_config('publiai.inventario_confirmando', 'off', true);
  elsif v_status <> 'confirmado' then
    raise exception 'confirmar_inventario: inventário não está aberto (status %)', v_status using errcode = '23514';
  end if;

  -- Derivado dos movimentos: o retry idempotente devolve a mesma lista.
  select coalesce(jsonb_agg(jsonb_build_object('codigo_pai', codigo_pai, 'reativar', reativar) order by codigo_pai),
                  '[]'::jsonb)
    into v_produtos
    from (select m.codigo_pai, bool_or(m.motivo = 'entrada') as reativar
            from public.estoque_movimentos m
           where m.org_id = p_org and m.referencia_externa like 'inventario:' || p_id || ':%'
           group by m.codigo_pai) p;
  return jsonb_build_object('produtos', v_produtos);
end $$;

revoke all on function public.salvar_contagem_inventario(uuid, uuid, int, jsonb) from public, anon, authenticated;
revoke all on function public.confirmar_inventario(uuid, uuid, int, uuid) from public, anon, authenticated;
grant execute on function public.salvar_contagem_inventario(uuid, uuid, int, jsonb) to service_role;
grant execute on function public.confirmar_inventario(uuid, uuid, int, uuid) to service_role;
