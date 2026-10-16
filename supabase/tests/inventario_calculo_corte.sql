\set ON_ERROR_STOP on
-- ADR-0181 Plano 2b-2, Task 3: backfill de `ordem` e corte gravados pela migration sobre o
-- histórico existente. Exige a fixture inventario_calculo_corte_pre.sql ANTES da migration:
--   python3 scripts/teste-sql-desfeito.py supabase/tests/inventario_calculo_corte.sql \
--     supabase/tests/inventario_calculo_corte_pre.sql supabase/migrations/<ts>_adr181_inventario_calculo.sql
begin;
do $$
declare v_max bigint; v_next bigint; r record;
begin
  -- Ruling 4: o backfill numera todas as linhas, inclusive o tombstone sem saldo.
  if exists (select 1 from public.estoque_movimentos where ordem is null) then
    raise exception 'backfill deixou movimento sem ordem';
  end if;
  if (select ordem from public.estoque_movimentos where referencia_externa = 'estorno:corte-venda-x') is null then
    raise exception 'tombstone sem ordem';
  end if;
  -- Ordem do backfill = (criado_em, id): nota do 101 < nota do 201 < venda < tombstone.
  if not ((select ordem from public.estoque_movimentos where referencia_externa = 'nfe:93400000000000000000000000000000000000000001:1:09340101')
        < (select ordem from public.estoque_movimentos where referencia_externa = 'nfe:93400000000000000000000000000000000000000001:2:09340201')
      and (select ordem from public.estoque_movimentos where referencia_externa = 'nfe:93400000000000000000000000000000000000000001:2:09340201')
        < (select ordem from public.estoque_movimentos where referencia_externa = 'corte-venda-1')) then
    raise exception 'backfill fora da ordem (criado_em, id)';
  end if;

  -- Corte: só o código com nota E outro movimento, até o último movimento dele.
  if (select array_agg(codigo order by codigo) from public.inventario_corte_backfill
       where org_id = '93400000-0000-0000-0000-000000000001') is distinct from array['09340101'] then
    raise exception 'corte esperado só para 09340101: %', (select array_agg(codigo) from public.inventario_corte_backfill
       where org_id = '93400000-0000-0000-0000-000000000001');
  end if;
  if (select ate_ordem from public.inventario_corte_backfill
       where org_id = '93400000-0000-0000-0000-000000000001' and codigo = '09340101')
     is distinct from (select max(ordem) from public.estoque_movimentos
       where org_id = '93400000-0000-0000-0000-000000000001' and codigo = '09340101') then
    raise exception 'ate_ordem do corte ≠ max(ordem) do código';
  end if;

  -- A sequência continua acima de todo o backfill.
  select max(ordem) into v_max from public.estoque_movimentos;
  v_next := nextval('public.estoque_movimentos_ordem_seq');
  if v_next <= v_max then raise exception 'nextval % <= max(ordem) do backfill %', v_next, v_max; end if;

  -- Efeito no cálculo: 101 perde a nota (corte) → sem nota; 201 (só nota) mantém a camada.
  select * into r from public.inventario_calcular('93400000-0000-0000-0000-000000000001') i where i.codigo = '09340101';
  if r.qtd_valorizada <> 0 or r.qtd_sem_nota <> 7 or r.custo_medio is not null or r.valor_total <> 0
     or r.marcas::text[] is distinct from array['sem_nota', 'historico_incompleto'] then
    raise exception 'corte 09340101: %', row_to_json(r);
  end if;
  select * into r from public.inventario_calcular('93400000-0000-0000-0000-000000000001') i where i.codigo = '09340201';
  if r.qtd_valorizada <> 10 or r.qtd_sem_nota <> 0 or r.custo_medio <> 10 or r.valor_total <> 100
     or r.marcas <> '{}'::text[] then
    raise exception 'sem corte 09340201: %', row_to_json(r);
  end if;
end $$;
rollback;
