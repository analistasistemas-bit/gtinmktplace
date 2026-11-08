\set ON_ERROR_STOP on
-- ADR-0200 (Task 8): identidade de item vendido e pendência obrigatória de crédito.
begin;
insert into public.organizations (id, nome, slug) values
  ('97800000-0000-0000-0000-000000000001', 'Kit venda test', 'kit-venda-test');

set local role service_role;
do $$
declare o constant uuid := '97800000-0000-0000-0000-000000000001'; w record; n integer;
begin
  -- 1) Identidade: primeira resolução vence; a segunda não troca o SKU nem grava outra linha.
  insert into public.kit_venda_identidade (org_id, canal, order_id, ml_item_id, variation_id, codigo)
  values (o, 'mercado_livre', '77', 'MLB1', '', 'KIT-PB-M');
  insert into public.kit_venda_identidade (org_id, canal, order_id, ml_item_id, variation_id, codigo)
  values (o, 'mercado_livre', '77', 'MLB1', '', 'COMUM') on conflict do nothing;
  if (select string_agg(codigo, ',') from public.kit_venda_identidade where org_id = o) <> 'KIT-PB-M'
    then raise exception '1: identidade trocou'; end if;
  begin
    update public.kit_venda_identidade set codigo = 'COMUM' where org_id = o;
    raise exception '1: update passou';
  exception when restrict_violation or insufficient_privilege then null;
  end;

  -- 2) Pendência obrigatória não é descartada no 5º erro e volta a valer se estava descartada.
  insert into public.worker_pendencias (org_id, order_id, tentativas, descartado_em)
  values (o, '88', 4, now() - interval '1 day');
  perform public.registrar_pendencia_kit(o, '88', 'kit_cancelamento: x');
  select * into w from public.worker_pendencias where org_id = o and order_id = '88';
  if not w.obrigatoria or w.descartado_em is not null or w.tentativas <> 5 then raise exception '2: reativação: %', w; end if;
  select descartados into n from public.registrar_pendencias_pedido(o, '{}', now(), '{88}', 'falhou de novo');
  select * into w from public.worker_pendencias where org_id = o and order_id = '88';
  if n <> 0 or w.descartado_em is not null or w.tentativas <> 6 then raise exception '2: obrigatória descartada (n=%): %', n, w; end if;
  -- Comum segue descartando na 5ª.
  insert into public.worker_pendencias (org_id, order_id, tentativas) values (o, '99', 4);
  select descartados into n from public.registrar_pendencias_pedido(o, '{}', now(), '{99}', 'x');
  if n <> 1 or (select descartado_em is null from public.worker_pendencias where org_id = o and order_id = '99')
    then raise exception '2: comum não descartou'; end if;
  -- Sucesso posterior resolve a obrigação.
  perform public.registrar_pendencias_pedido(o, '{88}', clock_timestamp(), '{}', null);
  if exists (select 1 from public.worker_pendencias where org_id = o and order_id = '88') then raise exception '2: sucesso não resolveu'; end if;
end $$;
reset role;

-- 2b) Coluna e índice do aviso de kit zerado (marca só depois do envio).
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'estoque_movimentos' and column_name = 'kit_aviso_enviado_em')
    then raise exception '2b: coluna ausente'; end if;
  if not exists (select 1 from pg_indexes where indexname = 'estoque_movimentos_zerado_sem_aviso_idx')
    then raise exception '2b: índice ausente'; end if;
end $$;

-- 3) Grants.
do $$
begin
  if has_function_privilege('anon', 'public.registrar_pendencia_kit(uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.registrar_pendencia_kit(uuid,text,text)', 'execute')
    then raise exception '3: RPC exposta'; end if;
  if has_table_privilege('authenticated', 'public.kit_venda_identidade', 'select') then raise exception '3: tabela exposta'; end if;
end $$;

rollback;
