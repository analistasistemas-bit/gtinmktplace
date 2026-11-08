-- ADR-0200: correções da revisão final do kit com variação (Codex, 08/11).
-- `db push` não roda em transação: cada statement é re-executável.

-- 1. Participantes (achado 2). Códigos distintos já agregados num escalar: a leitura de linhas pelo PostgREST
-- corta em 1.000 e um código omitido viraria "SKU comum", com escrita de quantidade fora da saga.
create or replace function public.kit_skus_participantes(p_org uuid, p_codigos text[])
returns text[] language sql stable set search_path = ''
as $$
  select coalesce(array_agg(distinct codigo order by codigo), '{}')
  from (
    select s.codigo from public.kit_variacao_skus s where s.org_id = p_org and s.codigo = any(p_codigos)
    union
    select c.codigo from public.kit_variacao_componentes c where c.org_id = p_org and c.codigo = any(p_codigos)
  ) t;
$$;
revoke all on function public.kit_skus_participantes(uuid, text[]) from public, anon, authenticated;
grant execute on function public.kit_skus_participantes(uuid, text[]) to service_role;

-- 2. Saldo da variação canônica (achado 1): família mais recente do código na org, a mesma da saga e do ledger.
-- Objeto {codigo: estoque} num escalar; o embed ordenado do PostgREST ordena o conteúdo, não as linhas.
create or replace function public.kit_saldo_canonico(p_org uuid, p_codigos text[])
returns jsonb language sql stable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(codigo, estoque), '{}')
  from (
    select distinct on (v.codigo) v.codigo, v.estoque
    from public.variacoes v join public.familias f on f.id = v.familia_id
    where v.org_id = p_org and v.codigo = any(p_codigos)
    order by v.codigo, f.criado_em desc, f.id desc
  ) t;
$$;
revoke all on function public.kit_saldo_canonico(uuid, text[]) from public, anon, authenticated;
grant execute on function public.kit_saldo_canonico(uuid, text[]) to service_role;

-- 3. Pagos incorporados ao passo 1 (achado 3): pedidos pagos já baixados localmente quando o saldo local fechou
-- com a leitura do ML do passo 1. Estão em `qtd_passo1`: a conciliação não os reserva de novo.
alter table public.kit_transferencia_alvos add column if not exists pagos_passo1 text[];

-- Corpo de 20261108040001 mais `pagos_passo1`.
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
    qtd_passo1 = v.qtd_passo1, passo1_em = v.passo1_em, ids_passo1 = v.ids_passo1, pagos_passo1 = v.pagos_passo1,
    valor_anterior = coalesce(a.valor_anterior, v.valor_anterior), valor_alvo = coalesce(a.valor_alvo, v.valor_alvo), fase = coalesce(a.fase, v.fase),
    marca_ordem = coalesce(a.marca_ordem, v.marca_ordem),
    up_criado = coalesce(a.up_criado, v.up_criado), item_criado = coalesce(a.item_criado, v.item_criado),
    pausado_pela_saga = v.pausado_pela_saga, intencao_escrita_em = v.intencao_escrita_em,
    recusa_definitiva_em = v.recusa_definitiva_em, escrita_em = v.escrita_em, confirmada_em = v.confirmada_em,
    item_escrita = v.item_escrita, recusas = v.recusas, repausar = v.repausar
  where a.transferencia_id = p_transferencia and a.org_id = p_org and a.up_id = p_up;
end $$;

-- 4. Variações do kit na criação (achado 4), serializadas pelo lock da família do kit (a da chave de cadastro).
-- Sob o lock, combinação (cor = rótulo) + tamanho já gravada reaproveita o código existente; só o que falta é
-- inserido. Devolve os códigos finais na ordem de `p_linhas`. Só as colunas enviadas entram (as demais ficam
-- com o default da tabela).
create or replace function public.kit_variacao_gravar_variacoes(p_org uuid, p_familia uuid, p_linhas jsonb)
returns jsonb language plpgsql set search_path = ''
as $$
declare v_l jsonb; v_codigo text; v_cols text; v_out jsonb := '[]';
begin
  perform 1 from public.familias where id = p_familia and org_id = p_org for update;
  if not found then
    raise exception 'kit_variacao_gravar_variacoes: família % não encontrada', p_familia;
  end if;
  for v_l in select * from jsonb_array_elements(p_linhas) loop
    select v.codigo into v_codigo from public.variacoes v
    where v.familia_id = p_familia and v.cor is not distinct from v_l->>'cor'
      and v.tamanho is not distinct from v_l->>'tamanho'
    order by v.codigo limit 1;
    if not found then
      v_l := (v_l || jsonb_build_object('familia_id', p_familia, 'org_id', p_org)) - 'id';
      select string_agg(quote_ident(k), ', ') into v_cols from jsonb_object_keys(v_l) k;
      execute format('insert into public.variacoes (%s) select %s from jsonb_populate_record(null::public.variacoes, $1)',
                     v_cols, v_cols) using v_l;
      v_codigo := v_l->>'codigo';
    end if;
    v_out := v_out || to_jsonb(v_codigo);
  end loop;
  return v_out;
end $$;
revoke all on function public.kit_variacao_gravar_variacoes(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.kit_variacao_gravar_variacoes(uuid, uuid, jsonb) to service_role;

-- 5. Canônica única (revisão final, rodada 2): todo ponto que resolve a variação canônica de um código usa o mesmo
-- critério de `kit_saldo_canonico` e `preparar_republicacao` — família mais recente, desempate por `familias.id desc`.
-- Sem o desempate, num empate de `criado_em` o ledger podia baixar uma cópia e a publicação ler outra. Cada função
-- abaixo é o corpo vigente (migration citada) com só o `, f.id desc` acrescentado; dono, grants e assinatura ficam.
-- Leituras só de exibição (produtos_estoque_resumo, skus_estoque_org, variacoes_estoque_produto, vitrine_resumo)
-- ficam como estão: não escrevem saldo.
grant estoque_rpc_executor to postgres;

-- baixar_estoque: corpo vigente de 20260729084329_e6b_estoque_movimentos.sql, só com o desempate `, <familia>.id desc`.
create or replace function public.baixar_estoque(
  p_org uuid, p_codigo text, p_qtd integer, p_canal text, p_ref text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_var uuid; v_pai text; v_antes integer; v_novo integer;
        v_mov uuid; v_aplicado integer;
begin
  if p_qtd is null or p_qtd <= 0 then
    raise exception 'baixar_estoque: quantidade deve ser positiva (recebeu %)', p_qtd;
  end if;
  -- Sem referência não há idempotência: o índice único é PARCIAL (where ref is not null),
  -- então um p_ref nulo permitiria baixar o mesmo pedido infinitas vezes.
  if p_ref is null or btrim(p_ref) = '' then
    raise exception 'baixar_estoque: referência de idempotência é obrigatória';
  end if;

  -- 1) TRAVA COMUM com o estorno. Só o índice único não serializa: venda e tombstone
  --    ocupam referências DIFERENTES, e FOR UPDATE não espera por linha ainda não
  --    commitada. Sem este lock existe o interleaving: baixa insere → consulta
  --    tombstone e não acha → cancelamento insere tombstone → baixa aplica assim mesmo.
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || '|' || p_ref, 0));

  -- 2) Idempotência: a unique parcial rejeita a 2ª aplicação da mesma referência.
  --    O bloco EXCEPTION abre uma subtransação PL/pgSQL — ele NÃO aborta a transação
  --    externa. A quantidade entra 0 e é corrigida ao saber o delta REAL aplicado.
  begin
    insert into public.estoque_movimentos
      (org_id, codigo, quantidade, quantidade_pedida, motivo, canal_origem,
       referencia_externa, push_canal_origem)
    values (p_org, p_codigo, 0, p_qtd, 'venda', p_canal, p_ref, p_canal)
    returning id into v_mov;
  exception when unique_violation then
    return jsonb_build_object('aplicado', false, 'motivo', 'duplicata');
  end;

  -- 3) TOMBSTONE: o cancelamento pode ter chegado ANTES desta baixa existir. Se houver
  --    marca de cancelamento para esta referência, NÃO baixa — senão o saldo cairia e
  --    nunca seria reposto, porque o estorno já rodou e não achou nada.
  if exists (
    select 1 from public.estoque_movimentos
    where org_id = p_org and referencia_externa = 'estorno:' || p_ref
      and motivo = 'cancelamento_sem_baixa'
  ) then
    update public.estoque_movimentos
    set motivo = 'venda_cancelada_antes'
    where id = v_mov;
    return jsonb_build_object('aplicado', false, 'motivo', 'cancelada_antes_da_baixa');
  end if;

  -- 4) Variação canônica = a da família mais recente do produto (âncora ADR-0025).
  select v.id, f.codigo_pai into v_var, v_pai
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo
  order by f.criado_em desc, f.id desc
  limit 1;

  if v_var is null then
    update public.estoque_movimentos set motivo = 'venda_sku_nao_encontrado'
    where id = v_mov;
    return jsonb_build_object('aplicado', false, 'motivo', 'sku_nao_encontrado');
  end if;

  -- 5) FOR UPDATE trava a linha da variação: duas baixas concorrentes do mesmo SKU
  --    não podem ler o MESMO estoque_anterior (a detecção de "vendeu sem saldo" erraria).
  select estoque into v_antes from public.variacoes where id = v_var for update;

  -- 6) Baixa atômica, nunca negativa (D-8).
  update public.variacoes set estoque = greatest(0, estoque - p_qtd)
  where id = v_var
  returning estoque into v_novo;

  -- O delta REAL é o que o estorno vai devolver. Gravar o pedido aqui criaria estoque.
  v_aplicado := v_novo - v_antes;   -- negativo ou zero

  update public.estoque_movimentos
  set codigo_pai = v_pai, quantidade = v_aplicado,
      estoque_anterior = v_antes, estoque_resultante = v_novo
  where id = v_mov;

  return jsonb_build_object(
    'aplicado', true, 'motivo', 'venda', 'movimento_id', v_mov, 'codigo_pai', v_pai,
    'quantidade_aplicada', abs(v_aplicado), 'quantidade_pedida', p_qtd,
    'estoque_anterior', v_antes, 'estoque_resultante', v_novo
  );
end $$;

-- estornar_estoque: corpo vigente de 20260729084329_e6b_estoque_movimentos.sql, só com o desempate `, <familia>.id desc`.
create or replace function public.estornar_estoque(
  p_org uuid, p_canal text, p_ref_venda text, p_codigo text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_qtd integer; v_codigo text; v_var uuid; v_pai text;
        v_antes integer; v_novo integer; v_ref_estorno text; v_mov uuid;
begin
  if p_ref_venda is null or btrim(p_ref_venda) = '' then
    raise exception 'estornar_estoque: referência da venda é obrigatória';
  end if;
  v_ref_estorno := 'estorno:' || p_ref_venda;

  -- MESMA TRAVA da baixa, mesma chave: é o que garante que "consultar o tombstone"
  -- e "inserir o tombstone" nunca se cruzem com "inserir a venda" e "aplicar a baixa".
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || '|' || p_ref_venda, 0));

  -- 1) Só estorna o que foi DE FATO baixado — `quantidade` é o delta aplicado.
  select abs(quantidade), codigo into v_qtd, v_codigo
  from public.estoque_movimentos
  where org_id = p_org and referencia_externa = p_ref_venda and motivo = 'venda'
  for update;

  if v_qtd is null then
    -- TOMBSTONE. Ocupa a MESMA referência do estorno, então é idempotente por construção.
    begin
      insert into public.estoque_movimentos
        (org_id, codigo, codigo_pai, quantidade, motivo, canal_origem,
         referencia_externa, push_canal_origem)
      values (p_org, p_codigo, '', 0, 'cancelamento_sem_baixa',
              p_canal, v_ref_estorno, null);
    exception when unique_violation then
      null;   -- já marcado numa execução anterior
    end;
    return jsonb_build_object('aplicado', false, 'motivo', 'sem_baixa_registrada');
  end if;

  -- 2) Idempotência do próprio estorno.
  begin
    insert into public.estoque_movimentos
      (org_id, codigo, quantidade, motivo, canal_origem, referencia_externa, push_canal_origem)
    values (p_org, v_codigo, v_qtd, 'estorno_venda', p_canal, v_ref_estorno, null)
    returning id into v_mov;
  exception when unique_violation then
    return jsonb_build_object('aplicado', false, 'motivo', 'duplicata');
  end;

  select v.id, f.codigo_pai into v_var, v_pai
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = v_codigo
  order by f.criado_em desc, f.id desc
  limit 1;

  if v_var is null then
    -- Preserva a trilha (espelha 'venda_sku_nao_encontrado') em vez de apagar o
    -- movimento — estorno de SKU sumido é evento que alguém precisa ver.
    update public.estoque_movimentos
    set motivo = 'estorno_sku_nao_encontrado', quantidade = 0
    where id = v_mov;
    return jsonb_build_object('aplicado', false, 'motivo', 'sku_nao_encontrado');
  end if;

  select estoque into v_antes from public.variacoes where id = v_var for update;

  update public.variacoes set estoque = estoque + v_qtd
  where id = v_var
  returning estoque into v_novo;

  update public.estoque_movimentos
  set codigo_pai = v_pai, estoque_anterior = v_antes, estoque_resultante = v_novo
  where id = v_mov;

  return jsonb_build_object(
    'aplicado', true, 'motivo', 'estorno_venda', 'movimento_id', v_mov, 'codigo_pai', v_pai,
    'estoque_anterior', v_antes, 'estoque_resultante', v_novo
  );
end $$;

-- registrar_entrada: corpo vigente de 20261107192458_kit_variacao_rpc.sql, só com o desempate `, <familia>.id desc`.
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
  order by f.criado_em desc, f.id desc
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

  -- ADR-0200: a exceção derruba também o insert acima.
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

-- ajustar_estoque: corpo vigente de 20261107192458_kit_variacao_rpc.sql, só com o desempate `, <familia>.id desc`.
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
  order by f.criado_em desc, f.id desc
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

  -- ADR-0200: a exceção derruba também o insert acima.
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

-- kit_sku_travado: corpo vigente de 20261107192458_kit_variacao_rpc.sql, só com o desempate `, <familia>.id desc`.
create or replace function public.kit_sku_travado(
  p_org uuid, p_codigo text, out p_id uuid, out p_pai text, out p_estoque integer
) language plpgsql set search_path = ''
as $$
begin
  select v.id, f.codigo_pai into p_id, p_pai
  from public.variacoes v
  join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo
  order by f.criado_em desc, f.id desc
  limit 1;

  if p_id is not null then
    select v.estoque into p_estoque from public.variacoes v where v.id = p_id for update;
  end if;
end $$;

-- confirmar_inventario: corpo vigente de 20261017002438_adr181_inventario_confirmar.sql, só com o desempate `, <familia>.id desc`.
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
       order by f.criado_em desc, f.id desc limit 1
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
           order by f.criado_em desc, f.id desc limit 1) is distinct from r.id then
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

-- importar_nota_compra: corpo vigente de 20261015234006_adr181_rpc_nota_compra.sql, só com o desempate `, <familia>.id desc`.
create or replace function public.importar_nota_compra(
  p_org uuid, p_user uuid, p_nota jsonb, p_itens jsonb
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_chave text := p_nota->>'chave';
  v_nota uuid; v_status text; v_item jsonb; v_item_id uuid; v_d jsonb; v_doc text; v_pais jsonb;
  v_ref text; v_ret integer; v_lancada integer; v_orfas text;
begin
  -- Serializa importações concorrentes da MESMA nota: a segunda espera e cai em "duplicada"
  -- em vez de estourar a unique (org_id, chave).
  perform pg_advisory_xact_lock(hashtextextended('nfe:' || p_org::text || ':' || v_chave, 0));

  select id, status into v_nota, v_status from public.notas_compra
   where org_id = p_org and chave = v_chave;

  if v_nota is not null and v_status <> 'importada' then
    raise exception 'importar_nota_compra: a nota % está %; não pode ser reimportada', v_chave, v_status
      using errcode = '23514';
  end if;

  if v_nota is null then
    insert into public.notas_compra (org_id, chave, numero, serie, emitente_cnpj, emitente_nome,
      emitida_em, valor_total, assinada, xml_path, xml_sha256, divergencia_total_aceita, importada_por)
    values (p_org, v_chave, (p_nota->>'numero')::int, (p_nota->>'serie')::int,
      p_nota->>'emitente_cnpj', p_nota->>'emitente_nome', (p_nota->>'emitida_em')::timestamptz,
      (p_nota->>'valor_total')::numeric, (p_nota->>'assinada')::boolean, p_nota->>'xml_path',
      p_nota->>'xml_sha256', nullif(p_nota->>'divergencia_total_aceita', '')::numeric, p_user)
    returning id into v_nota;

    v_doc := 'NF-e ' || (p_nota->>'numero') || ' · ' || (p_nota->>'emitente_nome');

    for v_item in select * from jsonb_array_elements(p_itens) loop
      insert into public.notas_compra_itens (nota_id, org_id, n_item, cprod, xprod, ncm, cfop, gtin,
        ucom, qcom, fator_conversao, v_prod, v_frete, v_seg, v_desc, v_outro, v_ipi, v_st, v_fcpst, rateio,
        orig, codigo_pai)
      values (v_nota, p_org, (v_item->>'n_item')::smallint, v_item->>'cprod', v_item->>'xprod',
        v_item->>'ncm', v_item->>'cfop', v_item->>'gtin', v_item->>'ucom', (v_item->>'qcom')::numeric,
        (v_item->>'fator_conversao')::int, (v_item->>'v_prod')::numeric, (v_item->>'v_frete')::numeric,
        (v_item->>'v_seg')::numeric, (v_item->>'v_desc')::numeric, (v_item->>'v_outro')::numeric,
        (v_item->>'v_ipi')::numeric, (v_item->>'v_st')::numeric, coalesce((v_item->>'v_fcpst')::numeric, 0),
        coalesce(v_item->'rateio', '{}'::jsonb),
        (v_item->>'orig')::smallint, v_item->>'codigo_pai')
      returning id into v_item_id;

      insert into public.vinculos_fornecedor (org_id, cnpj_fornecedor, cprod, codigo_pai, fator_conversao)
      values (p_org, p_nota->>'emitente_cnpj', v_item->>'cprod', v_item->>'codigo_pai',
        (v_item->>'fator_conversao')::int)
      on conflict (org_id, cnpj_fornecedor, cprod) do update
        set codigo_pai = excluded.codigo_pai, fator_conversao = excluded.fator_conversao,
            atualizado_em = now();

      for v_d in select * from jsonb_array_elements(v_item->'distribuicao') loop
        insert into public.notas_compra_distribuicao (item_id, org_id, codigo, quantidade,
          custo_aquisicao_unit, custo_precificacao_unit)
        values (v_item_id, p_org, v_d->>'codigo', (v_d->>'quantidade')::int,
          (v_d->>'custo_aquisicao_unit')::numeric, (v_d->>'custo_precificacao_unit')::numeric);

        -- Ledger guarda o custo de PRECIFICAÇÃO (D-3); o de aquisição fica na nota.
        v_ref := 'nfe:' || v_chave || ':' || (v_item->>'n_item') || ':' || (v_d->>'codigo');
        v_ret := public.registrar_entrada(p_org, v_d->>'codigo', (v_d->>'quantidade')::int,
          (v_d->>'custo_precificacao_unit')::numeric, v_doc, null, p_user, v_ref);
        if v_ret is null then
          -- Ref já aplicada: a variação nasceu pelo fluxo existente com a referência da nota (D-8).
          -- A quantidade lançada tem de ser a da nota, senão a nota e o ledger divergem.
          select m.quantidade into v_lancada from public.estoque_movimentos m
           where m.org_id = p_org and m.referencia_externa = v_ref;
          if v_lancada is distinct from (v_d->>'quantidade')::int then
            raise exception 'importar_nota_compra: % já recebeu % unidades por esta nota; a distribuição diz %',
              v_d->>'codigo', v_lancada, v_d->>'quantidade' using errcode = '23514';
          end if;
          -- R5-I1: registrar_entrada não atualiza o custo quando a ref é duplicada. O custo confirmado
          -- na nota vai para a variação canônica (só custo; saldo e ledger intocados).
          update public.variacoes v set custo = (v_d->>'custo_precificacao_unit')::numeric
           where v.id = (select v2.id from public.variacoes v2 join public.familias f on f.id = v2.familia_id
                          where v2.org_id = p_org and v2.codigo = v_d->>'codigo' order by f.criado_em desc, f.id desc limit 1);
        end if;
      end loop;
    end loop;

    -- R3-B1: toda entrada já lançada com a ref desta nota (ex.: variação criada pela D-8) tem de
    -- estar na distribuição confirmada. Senão a nota de 35 viraria 40 no estoque.
    select string_agg(m.codigo, ', ' order by m.codigo) into v_orfas
      from public.estoque_movimentos m
     where m.org_id = p_org and m.referencia_externa like 'nfe:' || v_chave || ':%'
       and not exists (
         select 1 from public.notas_compra_distribuicao d
           join public.notas_compra_itens i on i.id = d.item_id
          where i.nota_id = v_nota
            and m.referencia_externa = 'nfe:' || v_chave || ':' || i.n_item || ':' || d.codigo);
    if v_orfas is not null then
      raise exception 'importar_nota_compra: já houve entrada por esta nota em % fora da distribuição', v_orfas
        using errcode = '23514';
    end if;
  end if;

  -- Produtos tocados lidos do LEDGER (distribuição pode cair em outro produto, D-7).
  select coalesce(jsonb_agg(distinct m.codigo_pai), '[]'::jsonb) into v_pais
    from public.estoque_movimentos m
   where m.org_id = p_org and m.referencia_externa like 'nfe:' || v_chave || ':%';

  return jsonb_build_object('nota_id', v_nota, 'duplicada', v_status is not null, 'codigos_pai', v_pais);
end $$;

-- desfazer_nota_compra: corpo vigente de 20261016001451_adr181_desfazer_guard_canonico.sql, só com o desempate `, <familia>.id desc`.
create or replace function public.desfazer_nota_compra(
  p_org uuid, p_user uuid, p_nota_id uuid, p_status text
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare v_chave text; v_numero int; v_status text; r record; v_faltas text; v_pais jsonb;
  v_id uuid; v_saldo int;
begin
  if p_status not in ('desfeita','cancelada') then
    raise exception 'desfazer_nota_compra: status inválido %', p_status using errcode = '22023';
  end if;
  select chave into v_chave from public.notas_compra where id = p_nota_id and org_id = p_org;
  if v_chave is null then raise exception 'desfazer_nota_compra: nota não encontrada' using errcode = 'P0002'; end if;

  perform pg_advisory_xact_lock(hashtextextended('nfe:' || p_org::text || ':' || v_chave, 0));

  select numero, status into v_numero, v_status from public.notas_compra
   where id = p_nota_id and org_id = p_org for update;

  if v_status = 'importada' then
    create temp table if not exists _nfe_desfazer (codigo text, id uuid, qtd int, saldo int) on commit drop;
    truncate _nfe_desfazer;

    -- Trava a variação CANÔNICA de cada SKU (ordem determinística) e lê o saldo na mesma linha travada.
    for r in select d.codigo, sum(d.quantidade)::int as qtd
               from public.notas_compra_distribuicao d join public.notas_compra_itens i on i.id = d.item_id
              where i.nota_id = p_nota_id group by d.codigo order by d.codigo loop
      v_id := null; v_saldo := null;
      select v.id, v.estoque into v_id, v_saldo
        from public.variacoes v join public.familias f on f.id = v.familia_id
       where v.org_id = p_org and v.codigo = r.codigo
       order by f.criado_em desc, f.id desc limit 1
       for update of v;
      insert into _nfe_desfazer values (r.codigo, v_id, r.qtd, v_saldo);
    end loop;

    select string_agg(codigo || ' (saldo ' || saldo || ', nota ' || qtd || ')', ', ' order by codigo)
      into v_faltas from _nfe_desfazer where saldo < qtd;
    if v_faltas is not null then
      raise exception 'desfazer_nota_compra: saldo insuficiente em %', v_faltas using errcode = '23514';
    end if;

    for r in select * from _nfe_desfazer order by codigo loop
      perform public.ajustar_estoque(p_org, r.codigo, r.saldo - r.qtd,
        case p_status when 'desfeita' then 'Desfazer NF-e ' else 'NF-e cancelada ' end || v_numero,
        p_user, 'nfe-desfazer:' || v_chave || ':' || r.codigo);
      -- ajustar_estoque resolve o canônico de novo pelo código; se não for a linha travada
      -- (família nova inserida no meio), aborta tudo em vez de ajustar a linha errada.
      if (select v.id from public.variacoes v join public.familias f on f.id = v.familia_id
           where v.org_id = p_org and v.codigo = r.codigo
           order by f.criado_em desc, f.id desc limit 1) is distinct from r.id then
        raise exception 'desfazer_nota_compra: o produto % mudou durante o desfazer; tente de novo', r.codigo
          using errcode = '40001';
      end if;
    end loop;

    update public.notas_compra set status = p_status, desfeita_por = p_user, desfeita_em = now()
     where id = p_nota_id;
  end if;

  -- Já desfeita/cancelada: no-op financeiro. Devolve os produtos para o retry reenfileirar o push.
  select coalesce(jsonb_agg(distinct m.codigo_pai), '[]'::jsonb) into v_pais
    from public.estoque_movimentos m
   where m.org_id = p_org and m.referencia_externa like 'nfe:' || v_chave || ':%';
  return jsonb_build_object('codigos_pai', v_pais, 'ja_estava', v_status <> 'importada');
end $$;

-- kit_saga_conferir_saldo: corpo vigente de 20261107212019_kit_variacao_saga.sql, só com o desempate `, <familia>.id desc`.
create or replace function public.kit_saga_conferir_saldo(p_org uuid, p_transferencia uuid, p_token uuid, p_codigo text)
returns jsonb language plpgsql set search_path = ''
as $$
declare v_id uuid; v_saldo integer; v_marca bigint; v_ordem bigint; v_pendente bigint;
begin
  perform public.kit_saga_validar(p_org, p_transferencia, p_token);
  select v.id into v_id from public.variacoes v join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo order by f.criado_em desc, f.id desc limit 1;
  if v_id is null then
    raise exception 'kit_saga_conferir_saldo: SKU % não encontrado', p_codigo;
  end if;
  select estoque into v_saldo from public.variacoes where id = v_id for update;
  select ordem into v_marca from public.kit_marca_ml where org_id = p_org and codigo = p_codigo;
  select coalesce(max(ordem), 0) into v_ordem from public.estoque_movimentos
  where org_id = p_org and codigo = p_codigo;
  select coalesce(sum(m.quantidade), 0) into v_pendente from public.estoque_movimentos m
  where m.org_id = p_org and m.codigo = p_codigo
    and m.motivo in ('entrada', 'ajuste', 'estorno_venda', 'kit_saida', 'kit_entrada')
    and (m.transferencia_id = p_transferencia or (v_marca is not null and m.ordem > v_marca))
    and not exists (
      select 1 from public.kit_transferencia_alvos a
      where a.transferencia_id = m.transferencia_id and a.org_id = p_org and a.codigo = p_codigo
        and a.confirmada_em is not null);
  return jsonb_build_object('saldo', v_saldo, 'marca', v_marca, 'pendente', v_pendente, 'ordem', v_ordem);
end $$;

-- kit_variacao_saldo_copia: corpo vigente de 20261108004705_kit_variacao_guards.sql, só com o desempate `, <familia>.id desc`.
create or replace function public.kit_variacao_saldo_copia()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_modulos text[]; v_sku record; v_canonica uuid;
begin
  if not exists (select 1 from public.kit_variacao_skus s where s.org_id = new.org_id and s.codigo = new.codigo)
     and not exists (select 1 from public.kit_variacao_componentes c where c.org_id = new.org_id and c.codigo = new.codigo) then
    return new;
  end if;

  select modulos_habilitados into v_modulos from public.organizations where id = new.org_id;
  if not coalesce('kit_variacao' = any(v_modulos), false) then
    return new;
  end if;

  -- `kit_sku_travado` resolve o id antes de esperar o lock. Se outra cópia commitou (ou a canônica foi
  -- apagada) nessa espera, a linha travada já não é a canônica: recusa com o erro retentável, sem pegar
  -- outro lock — travar a nova aqui segurando a velha faria ciclo com o transporte de saldo da exclusão
  -- (que trava a apagada e depois a próxima). Sem a recusa, a cópia copiaria o saldo velho e, sendo a mais
  -- recente, apagaria uma venda já baixada na cópia intermediária. Os chamadores do INSERT repetem.
  select * into v_sku from public.kit_sku_travado(new.org_id, new.codigo);
  if v_sku.p_id is not null then
    select v.id into v_canonica from public.variacoes v join public.familias f on f.id = v.familia_id
    where v.org_id = new.org_id and v.codigo = new.codigo order by f.criado_em desc, f.id desc limit 1;
    if v_canonica is distinct from v_sku.p_id then
      raise exception 'canonica_trocou: a cópia canônica de % mudou durante a operação. Repita.', new.codigo
        using errcode = '40001';
    end if;
  end if;
  if public.kit_sku_em_transferencia(new.org_id, new.codigo) then
    raise exception 'sku_em_transferencia: % está em transferência de kit com variação. Repita depois que ela terminar.', new.codigo
      using errcode = '23514';
  end if;

  new.estoque := coalesce(v_sku.p_estoque, 0);
  return new;
end $$;

-- kit_variacao_conferir_update: corpo vigente de 20261108004705_kit_variacao_guards.sql, só com o desempate `, <familia>.id desc`.
create or replace function public.kit_variacao_conferir_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_modulos text[]; v_canonica uuid;
begin
  if coalesce(current_setting('kit.carregando_saldo', true), '') = '1' then
    return new;
  end if;
  if not exists (select 1 from public.kit_variacao_skus s where s.org_id = new.org_id and s.codigo = new.codigo)
     and not exists (select 1 from public.kit_variacao_componentes c where c.org_id = new.org_id and c.codigo = new.codigo) then
    return new;
  end if;
  select modulos_habilitados into v_modulos from public.organizations where id = new.org_id;
  if not coalesce('kit_variacao' = any(v_modulos), false) then
    return new;
  end if;

  if new.excluida_da_publicacao and not old.excluida_da_publicacao then
    raise exception 'SKU % está em kit com variação e não pode sair da publicação.', new.codigo
      using errcode = '23514';
  end if;

  if new.estoque is distinct from old.estoque then
    select v.id into v_canonica from public.variacoes v join public.familias f on f.id = v.familia_id
    where v.org_id = new.org_id and v.codigo = new.codigo order by f.criado_em desc, f.id desc limit 1;
    if v_canonica is distinct from new.id then
      raise exception 'canonica_trocou: a cópia canônica de % mudou durante a operação. Repita.', new.codigo
        using errcode = '40001';
    end if;
  end if;
  return new;
end $$;

-- kit_variacao_sair: corpo vigente de 20261108004705_kit_variacao_guards.sql, só com o desempate `, <familia>.id desc`.
create or replace function public.kit_variacao_sair(p_org uuid, p_codigo text, p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_estoque integer; v_canonica uuid; v_prox uuid;
begin
  select estoque into v_estoque from public.variacoes where id = p_id for update;

  select v.id into v_canonica from public.variacoes v join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo order by f.criado_em desc, f.id desc limit 1;
  select v.id into v_prox from public.variacoes v join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo and v.id <> p_id order by f.criado_em desc, f.id desc limit 1;

  if v_prox is null then
    raise exception 'SKU % está na composição de kit com variação e não pode ser excluído.', p_codigo
      using errcode = '23514';
  end if;

  if v_canonica = p_id then
    perform set_config('kit.carregando_saldo', '1', true);
    update public.variacoes set estoque = v_estoque where id = v_prox;
    perform set_config('kit.carregando_saldo', '', true);
  end if;
end $$;

-- inventario_calcular: corpo vigente de 20261108031720_kit_variacao_inventario.sql, só com o desempate `, <familia>.id desc`.
create or replace function public.inventario_calcular(p_org uuid)
returns table (
  codigo text, codigo_pai text, descricao text, ncm text, unidade text, cor text, tamanho text,
  quantidade_sistema int, qtd_valorizada int, qtd_sem_nota int, custo_medio numeric(14,6),
  valor_total numeric(14,2), marcas text[]
)
language sql stable security invoker set search_path = public, pg_temp
as $$
  with recursive
  canonica as (
    select distinct on (f.codigo_pai) f.id, f.codigo_pai, coalesce(f.descricao_fiscal, f.nome_pai) as descricao,
           f.ncm, f.unidade
      from public.familias f
     where f.org_id = p_org and f.kit_multiplicador is null
       and exists (select 1 from public.variacoes v where v.familia_id = f.id)
     order by f.codigo_pai, f.criado_em desc, f.id desc
  ),
  -- ADR-0200: componente C → membros do grupo (o próprio C com peso 1 e cada SKU de kit com C, com o
  -- número de peças de C por kit). Org sem kit: vazio.
  grupo as (
    select c.codigo as alvo, s.codigo as membro, c.quantidade as w
      from public.kit_variacao_componentes c
      join public.kit_variacao_skus s on s.id = c.kit_sku_id and s.org_id = c.org_id
     where c.org_id = p_org
    union all
    select distinct c.codigo, c.codigo, 1
      from public.kit_variacao_componentes c where c.org_id = p_org
  ),
  -- Saldo de hoje de cada membro na variação canônica (mesma âncora de kit_sku_travado).
  saldo_membro as (
    select distinct on (v.codigo) v.codigo, v.estoque
      from public.variacoes v join public.familias f on f.id = v.familia_id
     where v.org_id = p_org and v.codigo in (select g.membro from grupo g)
     order by v.codigo, f.criado_em desc, f.id desc
  ),
  -- Peças de C fora do individual hoje: dentro de kits + em trânsito (o que transferência tirou de um lado
  -- e ainda não pôs no outro = −Σ dos movimentos kit_* do grupo, com peso).
  fora as (
    select g.alvo,
           coalesce(sum(g.w * sm.estoque) filter (where g.membro <> g.alvo), 0)
           - coalesce(sum((select sum(m.quantidade) from public.estoque_movimentos m
                            where m.org_id = p_org and m.codigo = g.membro
                              and m.motivo in ('kit_saida', 'kit_entrada')) * g.w), 0) as pecas
      from grupo g left join saldo_membro sm on sm.codigo = g.membro
     group by g.alvo
  ),
  sku as (
    select v.codigo, c.codigo_pai, c.descricao, c.ncm, c.unidade, v.cor, v.tamanho,
           v.estoque + coalesce(fo.pecas, 0)::int as saldo
      from canonica c join public.variacoes v on v.familia_id = c.id
      left join fora fo on fo.alvo = v.codigo
     where not exists (select 1 from public.kit_variacao_skus ks where ks.org_id = p_org and ks.codigo = v.codigo)
  ),
  marco as (
    select v.codigo, max(f.criado_em) as marco
      from public.variacoes v
      join public.familias f on f.id = v.familia_id
      join public.lotes l on l.id = f.lote_id
     where v.org_id = p_org and l.origem = 'planilha' and v.codigo in (select s.codigo from sku s)
     group by v.codigo
  ),
  -- Entradas com custo: distribuição de nota importada (desfazer só muda o status), pela ref que
  -- o ledger grava. unique (item_id, codigo) dá uma linha por ref; a soma é só defensiva.
  nota as (
    select 'nfe:' || n.chave || ':' || i.n_item || ':' || d.codigo as ref, d.codigo,
           sum(d.quantidade)::int as q,
           sum(d.quantidade * d.custo_aquisicao_unit) / sum(d.quantidade) as u
      from public.notas_compra n
      join public.notas_compra_itens i on i.nota_id = n.id
      join public.notas_compra_distribuicao d on d.item_id = i.id
     where n.org_id = p_org and n.status = 'importada' and d.codigo in (select s.codigo from sku s)
     group by 1, 2
  ),
  -- Movimentos do grupo de cada componente. prev_res = nível do membro antes do passo (resultante do
  -- movimento anterior dele; no primeiro, o próprio anterior). Lacuna = ant ≠ prev_res.
  gmov as (
    select g.alvo, g.w, m.codigo as membro, m.ordem, m.id, m.referencia_externa as ref, m.motivo, m.criado_em,
           m.estoque_anterior as ant, m.estoque_resultante as res,
           coalesce(lag(m.estoque_resultante) over (partition by g.alvo, g.membro order by m.ordem, m.id),
                    m.estoque_anterior) as prev_res,
           m.motivo in ('kit_saida', 'kit_entrada') as transf
      from grupo g
      join public.estoque_movimentos m on m.org_id = p_org and m.codigo = g.membro
     where g.alvo in (select s.codigo from sku s)
       and m.estoque_anterior is not null and m.estoque_resultante is not null
  ),
  -- Nível em peças do grupo antes do primeiro passo: anterior do 1º movimento de cada membro, ou o saldo
  -- de hoje de membro sem movimento.
  g0 as (
    select g.alvo, sum(g.w * coalesce(i.ant, sm.estoque, 0)) as nivel
      from grupo g
      left join (select distinct on (x.alvo, x.membro) x.alvo, x.membro, x.ant
                   from gmov x order by x.alvo, x.membro, x.ordem, x.id) i
             on i.alvo = g.alvo and i.membro = g.membro
      left join saldo_membro sm on sm.codigo = g.membro
     group by g.alvo
  ),
  -- Variação do nível do grupo em cada passo: o membro sai de prev_res para res; transferência devolve o
  -- próprio delta ao trânsito (neutra). Acumulada por `ordem` numa janela só: linear no histórico.
  gnivel as (
    select x.*, g0.nivel + coalesce(sum(x.w * (x.res - x.prev_res)
                                        - case when x.transf then x.w * (x.res - x.ant) else 0 end)
                                      over (partition by x.alvo order by x.ordem, x.id
                                            rows between unbounded preceding and 1 preceding), 0) as antes_do_passo
      from gmov x join g0 on g0.alvo = x.alvo
  ),
  gpassos as (
    select gn.alvo, gn.ordem, gn.id, gn.ref,
           (gn.antes_do_passo - gn.w * gn.prev_res + gn.w * gn.ant)::int as ant,
           (gn.antes_do_passo - gn.w * gn.prev_res + gn.w * gn.ant
              + case when gn.transf then 0 else gn.w * (gn.res - gn.ant) end)::int as res,
           nt.q, nt.u,
           coalesce(gn.criado_em <= mc.marco, false) or coalesce(gn.ordem <= cb.ate_ordem, false) as antes
      from gnivel gn
      left join nota nt on nt.ref = gn.ref and nt.codigo = gn.membro and gn.motivo = 'entrada'
      left join marco mc on mc.codigo = gn.alvo
      left join public.inventario_corte_backfill cb on cb.org_id = p_org and cb.codigo = gn.alvo
  ),
  mov as (
    -- SKU comum: corpo de 20261016233218 sem mudança.
    select m.codigo, m.ordem, m.id, m.referencia_externa as ref, m.estoque_anterior as ant,
           m.estoque_resultante as res, nt.q, nt.u,
           coalesce(m.criado_em <= mc.marco, false) or coalesce(m.ordem <= cb.ate_ordem, false) as antes
      from public.estoque_movimentos m
      left join nota nt on nt.ref = m.referencia_externa and nt.codigo = m.codigo and m.motivo = 'entrada'
      left join marco mc on mc.codigo = m.codigo
      left join public.inventario_corte_backfill cb on cb.org_id = m.org_id and cb.codigo = m.codigo
     where m.org_id = p_org and m.codigo in (select s.codigo from sku s)
       and m.codigo not in (select g.alvo from grupo g)
       and m.estoque_anterior is not null and m.estoque_resultante is not null
    union all
    -- Componente de kit: passos do grupo em peças (gpassos).
    select gp.alvo, gp.ordem, gp.id, gp.ref, gp.ant, gp.res, gp.q, gp.u, gp.antes
      from gpassos gp
  ),
  passos as (
    select mv.codigo, row_number() over (partition by mv.codigo order by mv.ordem, mv.id) as n,
           mv.ant, mv.res, mv.q, mv.u
      from mov mv where not mv.antes
  ),
  -- Entrada de nota que não entra no replay: antes do marco/corte, ou sem movimento no ledger.
  perdida as (
    select nt.codigo from nota nt
     where not exists (select 1 from mov mv where mv.ref = nt.ref and mv.q is not null and not mv.antes)
  ),
  replay (codigo, n, k, c, prev, hist) as (
    select s.codigo, 0::bigint, 0, null::numeric(14,6), null::int, false from sku s
    union all
    select r.codigo, p.n, x3.k, x3.c, p.res, r.hist or x1.lacuna
      from replay r
      join passos p on p.codigo = r.codigo and p.n = r.n + 1
      cross join lateral (select (r.prev is not null and p.ant <> r.prev) as lacuna) x1
      cross join lateral (select least(case when x1.lacuna then 0 else r.k end, greatest(p.ant, 0)) as k) x2
      cross join lateral (select
          case when p.q is null then least(x2.k, greatest(p.res, 0))
               else least(x2.k + p.q, greatest(p.res, 0)) end as k,
          case when p.q is null then r.c
               when x2.k = 0 then p.u::numeric(14,6)
               else ((x2.k * r.c + p.q * p.u) / (x2.k + p.q))::numeric(14,6) end as c) x3
  ),
  fim as (
    select distinct on (r.codigo) r.codigo, r.k, r.c, r.prev, r.hist from replay r order by r.codigo, r.n desc
  ),
  calc as (
    select s.*, f.c,
           f.hist or (f.prev is not null and s.saldo <> f.prev)
             or exists (select 1 from perdida pd where pd.codigo = s.codigo) as hist,
           least(case when f.prev is not null and s.saldo <> f.prev then 0 else f.k end, greatest(s.saldo, 0)) as k
      from sku s join fim f on f.codigo = s.codigo
  )
  select c.codigo, c.codigo_pai, c.descricao, c.ncm, c.unidade, c.cor, c.tamanho,
         c.saldo, c.k, greatest(c.saldo, 0) - c.k,
         case when c.k > 0 then c.c end,
         (case when c.k > 0 then round(c.k * c.c, 2) else 0 end)::numeric(14,2),
         array_remove(array[
           case when greatest(c.saldo, 0) - c.k > 0 then 'sem_nota' end,
           case when c.hist then 'historico_incompleto' end,
           case when c.ncm is null then 'ncm_ausente' end,
           case when c.saldo < 0 then 'saldo_negativo' end
         ], null)
    from calc c
   order by c.codigo_pai, c.codigo
$$;

-- kit_variacao_criar: corpo vigente de 20261108052338_kit_variacao_reposicao.sql, só com o desempate `, <familia>.id desc`.
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
    if (select pedido_hash from public.kits_variacao where id = v_kit) is distinct from p_kit->>'pedido_hash' then
      return jsonb_build_object('ok', false, 'motivo', 'pedido_diferente');
    end if;
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
    insert into public.kits_variacao
      (org_id, codigo_pai_base, codigo_pai_kit, pecas_por_kit, preco, meta, status, chave_cadastro, listing_type_id, pedido_hash)
    values (p_org, p_kit->>'codigo_pai_base', p_kit->>'codigo_pai_kit', (p_kit->>'pecas_por_kit')::smallint,
            (p_kit->>'preco')::numeric, coalesce((p_kit->>'meta')::integer, 0), 'publicando', p_chave,
            coalesce(p_kit->>'listing_type_id', 'gold_special'), p_kit->>'pedido_hash')
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
      where v.org_id = p_org and v.codigo = v_b.codigo order by f.criado_em desc, f.id desc limit 1;
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

    -- Task 14: "Vender só em kit" já na criação. Normal → Guardado antes da transferência: a soma de versões dela
    -- inclui a mudança, e a montagem pausa os individuais e os deixa pausados (pausa da automação).
    if coalesce((p_kit->>'so_em_kit')::boolean, false) then
      perform public.kit_reposicao_reivindicar(p_org, v_kit);
    end if;

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

-- kit_reposicao_saldo: corpo vigente de 20261108052338_kit_variacao_reposicao.sql, só com o desempate `, <familia>.id desc`.
create or replace function public.kit_reposicao_saldo(p_org uuid, p_codigo text)
returns integer language sql stable set search_path = ''
as $$
  select v.estoque from public.variacoes v join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo order by f.criado_em desc, f.id desc limit 1
$$;

-- kit_variacao_adicionar: corpo vigente de 20261108073740_kit_variacao_adicionar.sql, só com o desempate `, <familia>.id desc`.
create or replace function public.kit_variacao_adicionar(
  p_org uuid, p_kit uuid, p_versao integer, p_familia uuid, p_chave uuid, p_hash text,
  p_novos jsonb, p_existentes jsonb, p_baseline jsonb, p_alvos jsonb
) returns jsonb language plpgsql set search_path = ''
as $$
declare v_kit public.kits_variacao%rowtype; v_sku uuid; v_id uuid; v_estoque integer; v_motivo text; v_comp text[];
        v_t jsonb; v_s jsonb; v_b record; v_ja public.kit_transferencias%rowtype; v_linha jsonb; v_cols text;
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
    return jsonb_build_object('ok', true, 'existente', true, 'kit_id', p_kit, 'transferencia_id', v_ja.id,
      'versao', (select versao from public.kits_variacao where id = p_kit and org_id = p_org));
  end if;

  -- Trava o kit: duas adições concorrentes (chaves diferentes) não criam a mesma combinação duas vezes.
  select * into v_kit from public.kits_variacao where id = p_kit and org_id = p_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'kit_nao_encontrado');
  end if;
  if p_versao is distinct from v_kit.versao then
    return jsonb_build_object('ok', false, 'motivo', 'versao', 'versao_atual', v_kit.versao);
  end if;
  if p_familia is distinct from (select f.id from public.familias f where f.org_id = p_org and f.codigo_pai = v_kit.codigo_pai_kit
                                 order by f.criado_em desc, f.id desc limit 1) then
    return jsonb_build_object('ok', false, 'motivo', 'familia_divergente');
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
  if exists (select 1 from jsonb_array_elements(p_novos) n where jsonb_typeof(n->'variacao') is distinct from 'object') then
    return jsonb_build_object('ok', false, 'motivo', 'variacao_ausente');
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
      -- A variação nasce aqui, junto da composição e da transferência: nada fica na família publicada sem SKU de kit.
      -- Só as colunas enviadas entram (as demais ficam com o default da tabela).
      v_linha := (v_s->'variacao') || jsonb_build_object('familia_id', p_familia, 'org_id', p_org, 'codigo', v_s->>'codigo',
                                                        'estoque', 0, 'excluida_da_publicacao', false);
      v_linha := v_linha - 'id';
      select string_agg(quote_ident(k), ', ') into v_cols from jsonb_object_keys(v_linha) k;
      execute format('insert into public.variacoes (%s) select %s from jsonb_populate_record(null::public.variacoes, $1)',
                     v_cols, v_cols) using v_linha;

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
      where v.org_id = p_org and v.codigo = v_b.codigo order by f.criado_em desc, f.id desc limit 1;
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
    -- `kit_reposicao_reivindicar` liga a reposição; aqui ela fica como o operador deixou.
    if v_kit.so_em_kit then
      perform public.kit_reposicao_reivindicar(p_org, p_kit);
      update public.kits_variacao set reposicao_auto = v_kit.reposicao_auto where id = p_kit;
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
    update public.kits_variacao set versao = versao + 1,
      status = case when jsonb_array_length(p_novos) > 0 then 'publicando' else status end
    where id = p_kit;
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

  return jsonb_build_object('ok', true, 'kit_id', p_kit, 'transferencia_id', v_t->>'id',
    'versao', (select versao from public.kits_variacao where id = p_kit));
end $$;

do $$
begin
  revoke estoque_rpc_executor from postgres;
exception when others then
  raise warning 'membership de postgres em estoque_rpc_executor nao revogada: %', sqlerrm;
end $$;
