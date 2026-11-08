-- ADR-0199: correções da revisão final do kit com variação (Codex, 08/11).
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
