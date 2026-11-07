\set ON_ERROR_STOP on
-- ADR-0197 (migration kit_variacao_rpc): transferência de peças entre SKUs individuais e SKUs de kit.
-- Fixtures só dentro da transação desfeita (scripts/teste-sql-desfeito.py), numa org própria: nenhuma
-- linha real é travada.
--
-- Concorrência real de duas sessões não cabe em transação única. Aqui a segunda transferência roda
-- depois da primeira, e a ordem dos locks é provada pela leitura do corpo das funções.
begin;

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97000000-0000-0000-0000-000000000001', 'Kit RPC', 'kit-rpc-teste', array['kit_variacao'], true),
  ('97000000-0000-0000-0000-000000000002', 'Kit RPC outra', 'kit-rpc-outra', array['kit_variacao'], true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('97000000-0000-0000-0000-000000000101', 'kit-rpc@teste.local',
   '{"org_id":"97000000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('97000000-0000-0000-0000-000000000101', '97000000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('97000000-0000-0000-0000-000000000201', '97000000-0000-0000-0000-000000000101',
   '97000000-0000-0000-0000-000000000001', 'processando', 'manual');
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro) values
  ('97000000-0000-0000-0000-000000000301', '97000000-0000-0000-0000-000000000201',
   '97000000-0000-0000-0000-000000000101', '97000000-0000-0000-0000-000000000001',
   '09700000', 'Blusa teste', 'CREATE', 'nacional', gen_random_uuid()),
  ('97000000-0000-0000-0000-000000000302', '97000000-0000-0000-0000-000000000201',
   '97000000-0000-0000-0000-000000000101', '97000000-0000-0000-0000-000000000001',
   '09710000', 'Kit blusa teste', 'CREATE', 'nacional', gen_random_uuid());
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
select f, '97000000-0000-0000-0000-000000000101', '97000000-0000-0000-0000-000000000001', c, c, c, 'M', 50, 0
from (values
  ('97000000-0000-0000-0000-000000000301'::uuid, '09700001'),   -- preto
  ('97000000-0000-0000-0000-000000000301'::uuid, '09700002'),   -- branco
  ('97000000-0000-0000-0000-000000000301'::uuid, '09700003'),   -- azul
  ('97000000-0000-0000-0000-000000000301'::uuid, '09700004'),   -- fora de qualquer kit
  ('97000000-0000-0000-0000-000000000302'::uuid, '09710001'),   -- kit preto + branco
  ('97000000-0000-0000-0000-000000000302'::uuid, '09710002'),   -- kit preto + 2 azuis
  ('97000000-0000-0000-0000-000000000302'::uuid, '09710003')    -- kit azul + avulsa: disjunto do primeiro
) x(f, c);

create temp table ctx on commit drop as
select '97000000-0000-0000-0000-000000000001'::uuid as org,
       '97000000-0000-0000-0000-000000000002'::uuid as outra_org,
       '97000000-0000-0000-0000-000000000101'::uuid as usuario,
       gen_random_uuid() as kit, gen_random_uuid() as outro_kit,
       gen_random_uuid() as k1, gen_random_uuid() as k2, gen_random_uuid() as k3, gen_random_uuid() as k4;
grant select on ctx to service_role;

-- Total em peças por SKU individual, escrito à parte das RPCs (invariante 2): individual + saldo do
-- kit × composição + trânsito. Trânsito = o que saiu de transferência sem nenhum kit_entrada.
create function pg_temp.total_pecas(p_org uuid, p_codigo text) returns bigint language sql as $$
  select (select v.estoque from public.variacoes v where v.org_id = p_org and v.codigo = p_codigo)
    + coalesce((select sum(v.estoque * c.quantidade)
                from public.kit_variacao_componentes c
                join public.kit_variacao_skus s on s.id = c.kit_sku_id
                join public.variacoes v on v.org_id = s.org_id and v.codigo = s.codigo
                where c.org_id = p_org and c.codigo = p_codigo), 0)
    + coalesce((select sum(-m.quantidade * coalesce(c.quantidade, 1))
                from public.estoque_movimentos m
                left join public.kit_variacao_skus s on s.org_id = m.org_id and s.codigo = m.codigo
                left join public.kit_variacao_componentes c on c.kit_sku_id = s.id and c.codigo = p_codigo
                where m.org_id = p_org and m.motivo = 'kit_saida'
                  and (m.codigo = p_codigo or c.codigo is not null)
                  and not exists (select 1 from public.estoque_movimentos e
                                  where e.transferencia_id = m.transferencia_id and e.motivo = 'kit_entrada')), 0)
$$;

create function pg_temp.afirmar(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALHA: %', p_msg; end if;
end $$;

create function pg_temp.saldo(p_org uuid, p_codigo text) returns integer language sql as $$
  select estoque from public.variacoes where org_id = p_org and codigo = p_codigo
$$;

-- Fotografia dos saldos: prova que uma recusa não gravou nada.
create function pg_temp.saldos(p_org uuid) returns text language sql as $$
  select string_agg(codigo || '=' || estoque, ',' order by codigo) from public.variacoes where org_id = p_org
$$;

create function pg_temp.movs(p_transf uuid) returns bigint language sql as $$
  select count(*) from public.estoque_movimentos where transferencia_id = p_transf
$$;

create function pg_temp.transf(p_org uuid, p_kit uuid, p_tipo text, p_itens jsonb) returns uuid language sql as $$
  insert into public.kit_transferencias (org_id, kit_id, tipo, versao_politica, itens)
  values (p_org, p_kit, p_tipo, 1, p_itens) returning id
$$;

-- Permissões, antes de qualquer chamada: a função fica exposta se o revoke virar no-op.
do $$
declare f text; v_dono text; v_definer boolean; v_cfg text[];
begin
  foreach f in array array[
    'public.kit_reservar_transferencia(uuid, uuid)',
    'public.kit_creditar_transferencia(uuid, uuid)',
    'public.kit_cancelar_transferencia(uuid, uuid)',
    'public.kit_adquirir_exclusao(uuid, text[], text, uuid)',
    'public.kit_soltar_exclusao(uuid, uuid)'
  ] loop
    select pg_get_userbyid(proowner), prosecdef, proconfig into v_dono, v_definer, v_cfg
    from pg_proc where oid = f::regprocedure;
    perform pg_temp.afirmar(v_dono = 'estoque_rpc_executor', f || ' sem dono estoque_rpc_executor: ' || v_dono);
    perform pg_temp.afirmar(v_definer, f || ' não é security definer');
    perform pg_temp.afirmar(v_cfg = array['search_path=""'], f || ' sem search_path vazio');
    perform pg_temp.afirmar(not has_function_privilege('anon', f, 'execute'), f || ' exposta a anon');
    perform pg_temp.afirmar(not has_function_privilege('authenticated', f, 'execute'), f || ' exposta a authenticated');
    perform pg_temp.afirmar(not has_function_privilege('public', f, 'execute'), f || ' exposta a public');
    perform pg_temp.afirmar(has_function_privilege('service_role', f, 'execute'), f || ' sem service_role');
  end loop;

  -- Peças internas: nem o service role chama direto.
  foreach f in array array[
    'public.kit_sku_em_transferencia(uuid, text)',
    'public.kit_transferencia_movimentos(uuid, uuid)',
    'public.kit_sku_travado(uuid, text)',
    'public.kit_aplicar_movimento(uuid, uuid, text, integer, text)'
  ] loop
    perform pg_temp.afirmar(not has_function_privilege('anon', f, 'execute'), f || ' exposta a anon');
    perform pg_temp.afirmar(not has_function_privilege('authenticated', f, 'execute'), f || ' exposta a authenticated');
    perform pg_temp.afirmar(not has_function_privilege('service_role', f, 'execute'), f || ' exposta a service_role');
  end loop;

  -- A troca de corpo não pode mudar dono nem ACL das RPCs existentes.
  foreach f in array array[
    'public.registrar_entrada(uuid, text, integer, numeric, text, text, uuid, text)',
    'public.ajustar_estoque(uuid, text, integer, text, uuid, text)'
  ] loop
    select pg_get_userbyid(proowner) into v_dono from pg_proc where oid = f::regprocedure;
    perform pg_temp.afirmar(v_dono = 'estoque_rpc_executor', f || ' mudou de dono');
    perform pg_temp.afirmar(not has_function_privilege('authenticated', f, 'execute'), f || ' exposta');
  end loop;
end $$;

set local role service_role;
do $$
declare
  c record; r jsonb; t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid; t7 uuid; t8 uuid; t9 uuid;
  P constant text := '09700001'; B constant text := '09700002'; A constant text := '09700003';
  L constant text := '09700004'; K1 constant text := '09710001'; K2 constant text := '09710002';
  K4 constant text := '09710003'; tl bigint; saldos_antes text; l_antes integer;
  custo_p numeric; custo_l numeric; id_nota uuid;
  nota jsonb := jsonb_build_object('chave', '26261011222333000181550010000010521000030324', 'numero', 1052, 'serie', 1,
    'emitente_cnpj', '11222333000181', 'emitente_nome', 'Fornecedor Teste', 'emitida_em', '2026-10-13T15:57:33-03:00',
    'valor_total', 20, 'assinada', false, 'xml_path', 'kit-rpc/x.xml', 'xml_sha256', 'abc');
  -- P antes de L: a recusa em L precisa desfazer o que P já gravou.
  itens_nota jsonb := '[{"n_item":1,"cprod":"REF KIT","xprod":"Blusa","ncm":"62034900","cfop":"5102","gtin":null,
    "ucom":"PC","qcom":2,"fator_conversao":1,"v_prod":20,"v_frete":0,"v_seg":0,"v_desc":0,"v_outro":0,"v_ipi":0,"v_st":0,
    "rateio":{},"orig":0,"codigo_pai":"09700000",
    "distribuicao":[{"codigo":"09700001","quantidade":1,"custo_aquisicao_unit":10,"custo_precificacao_unit":14},
                    {"codigo":"09700004","quantidade":1,"custo_aquisicao_unit":10,"custo_precificacao_unit":14}]}]';
  antes text; tp bigint; tb bigint; ta bigint; dono uuid := gen_random_uuid(); outro uuid := gen_random_uuid();
begin
  select * into c from ctx;

  insert into public.kits_variacao (id, org_id, codigo_pai_base, codigo_pai_kit, pecas_por_kit, preco)
  values (c.kit, c.org, '09700000', '09710000', 2, 99.90),
         (c.outro_kit, c.org, '09700000', '09720000', 2, 99.90);
  insert into public.kit_variacao_skus (id, org_id, kit_id, codigo, tamanho, cores, rotulo_cor)
  values (c.k1, c.org, c.kit, K1, 'M', array['Preto','Branco'], 'Preto + Branco'),
         (c.k2, c.org, c.kit, K2, 'M', array['Preto','Azul'], 'Preto + Azul'),
         (c.k3, c.org, c.outro_kit, '09720001', 'M', array['Preto','Branco'], 'Outro kit'),
         (c.k4, c.org, c.kit, K4, 'M', array['Azul','Lilás'], 'Azul + Lilás');
  -- K2 leva 2 azuis: prova a multiplicação pela composição.
  insert into public.kit_variacao_componentes (kit_sku_id, org_id, codigo, quantidade)
  values (c.k1, c.org, P, 1), (c.k1, c.org, B, 1), (c.k2, c.org, P, 1), (c.k2, c.org, A, 2),
         (c.k3, c.org, P, 1), (c.k4, c.org, A, 1), (c.k4, c.org, L, 1);

  perform public.registrar_entrada(c.org, P, 10, null, null, null, c.usuario, 'kit-teste:p');
  perform public.registrar_entrada(c.org, B, 5, null, null, null, c.usuario, 'kit-teste:b');
  perform public.registrar_entrada(c.org, A, 4, null, null, null, c.usuario, 'kit-teste:a');
  perform public.registrar_entrada(c.org, L, 3, null, null, null, c.usuario, 'kit-teste:l');
  tp := pg_temp.total_pecas(c.org, P); tb := pg_temp.total_pecas(c.org, B); ta := pg_temp.total_pecas(c.org, A);
  perform pg_temp.afirmar(tp = 10 and tb = 5 and ta = 4, 'total inicial errado');

  -- Reserva move as N cores juntas, em peças, com a composição. Meta 0: montar não respeita meta.
  t1 := pg_temp.transf(c.org, c.kit, 'montar', jsonb_build_array(
    jsonb_build_object('codigo', K1, 'quantidade', 3), jsonb_build_object('codigo', K2, 'quantidade', 1)));
  r := public.kit_reservar_transferencia(c.org, t1);
  perform pg_temp.afirmar(r = '{"ok": true, "aplicado": true}', 'reserva: ' || r::text);
  perform pg_temp.afirmar(pg_temp.saldo(c.org, P) = 6 and pg_temp.saldo(c.org, B) = 2 and pg_temp.saldo(c.org, A) = 2,
    'origens não baixaram juntas: ' || pg_temp.saldos(c.org));
  perform pg_temp.afirmar(pg_temp.saldo(c.org, K1) = 0 and pg_temp.saldo(c.org, K2) = 0, 'reserva creditou o kit');
  perform pg_temp.afirmar(pg_temp.movs(t1) = 3, 'reserva deveria gravar 3 movimentos');
  perform pg_temp.afirmar((select quantidade = -4 and estoque_anterior = 10 and estoque_resultante = 6
                             and codigo_pai = '09700000' and motivo = 'kit_saida'
                           from public.estoque_movimentos where transferencia_id = t1 and codigo = P),
    'kit_saida com delta, saldos ou codigo_pai errado');
  perform pg_temp.afirmar(pg_temp.total_pecas(c.org, P) = tp and pg_temp.total_pecas(c.org, B) = tb
    and pg_temp.total_pecas(c.org, A) = ta, 'total em peças mudou ao reservar');

  -- Duas chamadas iguais aplicam uma vez.
  antes := pg_temp.saldos(c.org);
  r := public.kit_reservar_transferencia(c.org, t1);
  perform pg_temp.afirmar(r = '{"ok": true, "aplicado": false}', 'reserva repetida: ' || r::text);
  perform pg_temp.afirmar(pg_temp.saldos(c.org) = antes and pg_temp.movs(t1) = 3, 'reserva repetida aplicou de novo');

  -- Crédito sem kit em peças: unidade de kit_entrada em SKU de kit é kit.
  r := public.kit_creditar_transferencia(c.org, t1);
  perform pg_temp.afirmar(r = '{"ok": true, "aplicado": true}', 'crédito: ' || r::text);
  perform pg_temp.afirmar(pg_temp.saldo(c.org, K1) = 3 and pg_temp.saldo(c.org, K2) = 1, 'destino não creditou');
  perform pg_temp.afirmar((select quantidade = 3 and estoque_anterior = 0 and estoque_resultante = 3
                             and codigo_pai = '09710000' and motivo = 'kit_entrada'
                           from public.estoque_movimentos
                           where transferencia_id = t1 and codigo = K1 and motivo = 'kit_entrada'),
    'kit_entrada errado');
  perform pg_temp.afirmar(pg_temp.total_pecas(c.org, P) = tp and pg_temp.total_pecas(c.org, B) = tb
    and pg_temp.total_pecas(c.org, A) = ta, 'total em peças mudou ao creditar');
  antes := pg_temp.saldos(c.org);
  r := public.kit_creditar_transferencia(c.org, t1);
  perform pg_temp.afirmar(r = '{"ok": true, "aplicado": false}', 'crédito repetido: ' || r::text);
  perform pg_temp.afirmar(pg_temp.saldos(c.org) = antes and pg_temp.movs(t1) = 5, 'crédito repetido aplicou de novo');

  -- Cancelar depois de chegar não devolve nada: a peça não pode existir em dois lugares.
  r := public.kit_cancelar_transferencia(c.org, t1);
  perform pg_temp.afirmar(r = '{"ok": true, "aplicado": false}', 'cancelar creditada: ' || r::text);
  perform pg_temp.afirmar(pg_temp.saldos(c.org) = antes and pg_temp.movs(t1) = 5, 'cancelar creditada devolveu');

  -- Outbox: nenhum movimento de kit cai no push genérico (mesmo predicado do índice e de lerPushPendente).
  perform pg_temp.afirmar((select count(*) = 0 from public.estoque_movimentos
                           where org_id = c.org and transferencia_id is not null
                             and push_enfileirado_em is null and codigo_pai <> ''),
    'movimento de kit pendente no outbox');
  update public.kit_transferencias set estado = 'concluida' where id = t1;

  -- Cor sem saldo aborta tudo, sem baixa parcial. Preto tem saldo e vem antes no código.
  t2 := pg_temp.transf(c.org, c.kit, 'montar', jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 3)));
  antes := pg_temp.saldos(c.org);
  r := public.kit_reservar_transferencia(c.org, t2);
  perform pg_temp.afirmar(r = jsonb_build_object('ok', false, 'motivo', 'peca_insuficiente', 'codigo', B), 'insuficiente: ' || r::text);
  perform pg_temp.afirmar(pg_temp.saldos(c.org) = antes and pg_temp.movs(t2) = 0, 'recusa gravou algo');
  r := public.kit_creditar_transferencia(c.org, t2);
  perform pg_temp.afirmar(r = '{"ok": false, "motivo": "sem_reserva"}', 'crédito sem reserva: ' || r::text);
  perform pg_temp.afirmar(pg_temp.saldos(c.org) = antes and pg_temp.movs(t2) = 0, 'crédito sem reserva gravou');
  r := public.kit_cancelar_transferencia(c.org, t2);
  perform pg_temp.afirmar(r = '{"ok": true, "aplicado": false}', 'cancelar sem reserva: ' || r::text);
  update public.kit_transferencias set estado = 'abortada' where id = t2;

  -- Duas transferências no mesmo SKU: a segunda lê o saldo depois da primeira e recebe insuficiente.
  t3 := pg_temp.transf(c.org, c.kit, 'montar', jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 2)));
  t4 := pg_temp.transf(c.org, c.kit, 'montar', jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 1)));
  r := public.kit_reservar_transferencia(c.org, t3);
  perform pg_temp.afirmar((r->>'ok')::boolean, 'primeira concorrente: ' || r::text);
  r := public.kit_reservar_transferencia(c.org, t4);
  perform pg_temp.afirmar(r = jsonb_build_object('ok', false, 'motivo', 'peca_insuficiente', 'codigo', B), 'segunda concorrente: ' || r::text);
  perform pg_temp.afirmar(pg_temp.movs(t4) = 0, 'segunda concorrente gravou');
  update public.kit_transferencias set estado = 'abortada' where id = t4;

  -- Cancelar devolve o que saiu e não chegou, uma vez só, com a peça em trânsito voltando à origem.
  perform pg_temp.afirmar(pg_temp.total_pecas(c.org, P) = tp and pg_temp.total_pecas(c.org, B) = tb, 'total em trânsito');
  antes := pg_temp.saldos(c.org);
  r := public.kit_cancelar_transferencia(c.org, t3);
  perform pg_temp.afirmar(r = '{"ok": true, "aplicado": true}', 'cancelar: ' || r::text);
  perform pg_temp.afirmar(pg_temp.saldo(c.org, P) = 6 and pg_temp.saldo(c.org, B) = 2, 'cancelar não devolveu: ' || pg_temp.saldos(c.org));
  perform pg_temp.afirmar((select quantidade = 2 and motivo = 'kit_entrada' from public.estoque_movimentos
                           where transferencia_id = t3 and codigo = P and motivo = 'kit_entrada'), 'devolução sem kit_entrada');
  perform pg_temp.afirmar(pg_temp.total_pecas(c.org, P) = tp and pg_temp.total_pecas(c.org, B) = tb, 'total mudou ao cancelar');
  antes := pg_temp.saldos(c.org);
  r := public.kit_cancelar_transferencia(c.org, t3);
  perform pg_temp.afirmar(r = '{"ok": true, "aplicado": false}', 'cancelar repetido: ' || r::text);
  -- Cancelada não reserva nem credita: reabriria peça que já voltou.
  r := public.kit_creditar_transferencia(c.org, t3);
  perform pg_temp.afirmar(r = '{"ok": false, "motivo": "transferencia_cancelada"}', 'crédito depois de cancelar: ' || r::text);
  r := public.kit_reservar_transferencia(c.org, t3);
  perform pg_temp.afirmar(r = '{"ok": false, "motivo": "transferencia_cancelada"}', 'reserva depois de cancelar: ' || r::text);
  perform pg_temp.afirmar(pg_temp.saldos(c.org) = antes and pg_temp.movs(t3) = 4, 'depois de cancelar algo foi gravado');
  update public.kit_transferencias set estado = 'abortada' where id = t3;

  -- Capacidade: repor só vai até a meta, contando saldo do kit e o que já está a caminho.
  update public.kits_variacao set meta = 3 where id = c.kit;
  t5 := pg_temp.transf(c.org, c.kit, 'repor', jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 1)));
  antes := pg_temp.saldos(c.org);
  r := public.kit_reservar_transferencia(c.org, t5);
  perform pg_temp.afirmar(r = jsonb_build_object('ok', false, 'motivo', 'acima_da_meta', 'codigo', K1), 'meta: ' || r::text);
  perform pg_temp.afirmar(pg_temp.saldos(c.org) = antes and pg_temp.movs(t5) = 0, 'recusa por meta gravou');
  update public.kits_variacao set meta = 4 where id = c.kit;
  r := public.kit_reservar_transferencia(c.org, t5);
  perform pg_temp.afirmar((r->>'ok')::boolean, 'repor até a meta: ' || r::text);
  t6 := pg_temp.transf(c.org, c.kit, 'repor', jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 1)));
  r := public.kit_reservar_transferencia(c.org, t6);
  perform pg_temp.afirmar(r = jsonb_build_object('ok', false, 'motivo', 'acima_da_meta', 'codigo', K1), 'trânsito fora da capacidade: ' || r::text);
  update public.kit_transferencias set estado = 'abortada' where id = t6;

  -- Durante transferência aberta: entrada e ajuste recusam, sem gravar; SKU fora dela segue igual.
  antes := pg_temp.saldos(c.org);
  begin
    perform public.registrar_entrada(c.org, P, 1, null, null, null, c.usuario, 'kit-teste:recusa-entrada');
    raise exception 'FALHA: entrada passou no componente';
  exception when check_violation then
    if sqlerrm not like 'sku_em_transferencia%' then raise; end if;
  end;
  begin
    perform public.registrar_entrada(c.org, K1, 1, null, null, null, c.usuario, 'kit-teste:recusa-entrada-kit');
    raise exception 'FALHA: entrada passou no SKU do kit';
  exception when check_violation then
    if sqlerrm not like 'sku_em_transferencia%' then raise; end if;
  end;
  begin
    perform public.ajustar_estoque(c.org, B, 0, null, c.usuario, 'kit-teste:recusa-ajuste');
    raise exception 'FALHA: ajuste passou no componente';
  exception when check_violation then
    if sqlerrm not like 'sku_em_transferencia%' then raise; end if;
  end;
  perform pg_temp.afirmar(pg_temp.saldos(c.org) = antes, 'recusa de entrada/ajuste mexeu no saldo');
  perform pg_temp.afirmar((select count(*) = 0 from public.estoque_movimentos
                           where org_id = c.org and referencia_externa like 'kit-teste:recusa%'), 'recusa deixou movimento');
  -- Reenvio de referência já aplicada segue devolvendo null, não vira recusa.
  perform pg_temp.afirmar(public.registrar_entrada(c.org, P, 10, null, null, null, c.usuario, 'kit-teste:p') is null,
    'retry idempotente virou recusa');
  -- Comportamento idêntico para SKU sem kit.
  perform pg_temp.afirmar(public.registrar_entrada(c.org, L, 2, null, null, null, c.usuario, 'kit-teste:l2') = 5, 'entrada livre');
  perform pg_temp.afirmar(public.ajustar_estoque(c.org, L, 4, null, c.usuario, 'kit-teste:l3') = 4, 'ajuste livre');
  perform pg_temp.afirmar((select quantidade = -1 and estoque_anterior = 5 and estoque_resultante = 4
                             and codigo_pai = '09700000' and push_enfileirado_em is null
                           from public.estoque_movimentos where org_id = c.org and referencia_externa = 'kit-teste:l3'),
    'ajuste livre mudou o movimento');
  perform pg_temp.afirmar((select push_enfileirado_em is null from public.estoque_movimentos
                           where org_id = c.org and referencia_externa = 'kit-teste:l2'), 'entrada comum saiu do outbox');

  -- Venda é sagrada: aplica durante a transferência, no componente e no kit, e o estorno também.
  perform pg_temp.afirmar((public.baixar_estoque(c.org, P, 1, 'mercado_livre', 'kit-teste:venda')->>'aplicado')::boolean,
    'venda recusada durante transferência');
  perform pg_temp.afirmar(pg_temp.saldo(c.org, P) = 4, 'venda não baixou: ' || pg_temp.saldos(c.org));
  perform pg_temp.afirmar((public.estornar_estoque(c.org, 'mercado_livre', 'kit-teste:venda', P)->>'aplicado')::boolean,
    'estorno recusado durante transferência');

  -- Travada segue bloqueando; concluída libera.
  update public.kit_transferencias set estado = 'travada' where id = t5;
  begin
    perform public.ajustar_estoque(c.org, B, 0, null, c.usuario, 'kit-teste:recusa-travada');
    raise exception 'FALHA: ajuste passou com transferência travada';
  exception when check_violation then
    if sqlerrm not like 'sku_em_transferencia%' then raise; end if;
  end;
  r := public.kit_creditar_transferencia(c.org, t5);
  perform pg_temp.afirmar(r = '{"ok": true, "aplicado": true}', 'crédito de travada resolvida: ' || r::text);
  perform pg_temp.afirmar(pg_temp.saldo(c.org, K1) = 4, 'repor não creditou');
  update public.kit_transferencias set estado = 'concluida' where id = t5;
  perform pg_temp.afirmar(public.ajustar_estoque(c.org, B, 1, null, c.usuario, 'kit-teste:livre') = 1, 'concluída não liberou');
  tb := pg_temp.total_pecas(c.org, B);

  -- Desmontar: origem é o SKU do kit, em kits; destino são as peças, pela composição.
  t7 := pg_temp.transf(c.org, c.kit, 'desmontar', jsonb_build_array(jsonb_build_object('codigo', K2, 'quantidade', 1)));
  tp := pg_temp.total_pecas(c.org, P); ta := pg_temp.total_pecas(c.org, A);
  r := public.kit_reservar_transferencia(c.org, t7);
  perform pg_temp.afirmar(r = '{"ok": true, "aplicado": true}', 'reserva desmontar: ' || r::text);
  perform pg_temp.afirmar(pg_temp.saldo(c.org, K2) = 0, 'kit não saiu');
  perform pg_temp.afirmar(pg_temp.total_pecas(c.org, P) = tp and pg_temp.total_pecas(c.org, A) = ta, 'total em trânsito de desmontar');
  r := public.kit_creditar_transferencia(c.org, t7);
  perform pg_temp.afirmar((r->>'ok')::boolean, 'crédito desmontar: ' || r::text);
  perform pg_temp.afirmar(pg_temp.saldo(c.org, A) = 4 and pg_temp.total_pecas(c.org, A) = ta
    and pg_temp.total_pecas(c.org, P) = tp, 'desmontar errou as peças: ' || pg_temp.saldos(c.org));
  update public.kit_transferencias set estado = 'concluida' where id = t7;
  t8 := pg_temp.transf(c.org, c.kit, 'desmontar', jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 99)));
  r := public.kit_reservar_transferencia(c.org, t8);
  perform pg_temp.afirmar(r = jsonb_build_object('ok', false, 'motivo', 'peca_insuficiente', 'codigo', K1), 'desmontar acima do saldo: ' || r::text);
  update public.kit_transferencias set estado = 'abortada' where id = t8;

  -- Tipo sem movimento local: reservar é no-op, mas o SKU listado fica em transferência.
  t9 := pg_temp.transf(c.org, null, 'entrada', jsonb_build_array(jsonb_build_object('codigo', A)));
  r := public.kit_reservar_transferencia(c.org, t9);
  perform pg_temp.afirmar(r = '{"ok": true, "aplicado": false}', 'tipo sem movimento: ' || r::text);
  begin
    perform public.ajustar_estoque(c.org, A, 0, null, c.usuario, 'kit-teste:recusa-tipo-entrada');
    raise exception 'FALHA: ajuste passou com transferência tipo entrada';
  exception when check_violation then
    if sqlerrm not like 'sku_em_transferencia%' then raise; end if;
  end;
  update public.kit_transferencias set estado = 'concluida' where id = t9;

  -- Itens inválidos nunca movem: SKU de outro kit, quantidade zero, lista vazia.
  antes := pg_temp.saldos(c.org);
  foreach r in array array[
    jsonb_build_array(jsonb_build_object('codigo', '09720001', 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 0)),
    '[]'::jsonb
  ] loop
    t2 := pg_temp.transf(c.org, c.kit, 'montar', r);
    r := public.kit_reservar_transferencia(c.org, t2);
    perform pg_temp.afirmar(r = '{"ok": false, "motivo": "itens_invalidos"}', 'itens inválidos: ' || r::text);
    update public.kit_transferencias set estado = 'abortada' where id = t2;
  end loop;
  perform pg_temp.afirmar(pg_temp.saldos(c.org) = antes, 'itens inválidos moveram saldo');

  -- Transferência de outra org não existe para esta chamada.
  t2 := pg_temp.transf(c.org, c.kit, 'montar', jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 1)));
  r := public.kit_reservar_transferencia(c.outra_org, t2);
  perform pg_temp.afirmar(r = '{"ok": false, "motivo": "transferencia_nao_encontrada"}', 'outra org: ' || r::text);
  perform pg_temp.afirmar(public.kit_creditar_transferencia(c.outra_org, t2) = '{"ok": false, "motivo": "transferencia_nao_encontrada"}', 'crédito outra org');
  perform pg_temp.afirmar(public.kit_cancelar_transferencia(c.outra_org, t2) = '{"ok": false, "motivo": "transferencia_nao_encontrada"}', 'cancelar outra org');
  perform pg_temp.afirmar(pg_temp.movs(t2) = 0, 'outra org gravou');
  update public.kit_transferencias set estado = 'abortada' where id = t2;

  -- Transferência fora de ativa não reserva.
  r := public.kit_reservar_transferencia(c.org, t2);
  perform pg_temp.afirmar(r = '{"ok": false, "motivo": "transferencia_fechada"}', 'reserva de abortada: ' || r::text);

  -- `itens` alterado depois da reserva: crédito compara origens e ledger nos dois sentidos. Retirar a
  -- combinação disjunta deixaria A e L sem destino, com o trânsito sumindo da conta.
  t2 := pg_temp.transf(c.org, c.kit, 'montar', jsonb_build_array(
    jsonb_build_object('codigo', K1, 'quantidade', 1), jsonb_build_object('codigo', K4, 'quantidade', 1)));
  tp := pg_temp.total_pecas(c.org, P); tb := pg_temp.total_pecas(c.org, B);
  ta := pg_temp.total_pecas(c.org, A); tl := pg_temp.total_pecas(c.org, L);
  saldos_antes := pg_temp.saldos(c.org);
  r := public.kit_reservar_transferencia(c.org, t2);
  perform pg_temp.afirmar(r = '{"ok": true, "aplicado": true}', 'reserva disjunta: ' || r::text);
  perform pg_temp.afirmar(pg_temp.movs(t2) = 4, 'reserva disjunta deveria mover 4 SKUs');
  antes := pg_temp.saldos(c.org);
  update public.kit_transferencias set itens = jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 1)) where id = t2;
  r := public.kit_creditar_transferencia(c.org, t2);
  perform pg_temp.afirmar(r = '{"ok": false, "motivo": "sem_reserva"}', 'crédito sem a combinação retirada: ' || r::text);
  perform pg_temp.afirmar(pg_temp.saldos(c.org) = antes and pg_temp.movs(t2) = 4, 'crédito divergente gravou');
  -- Sentido inverso: itens com combinação a mais do que saiu.
  update public.kit_transferencias set itens = jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 1),
    jsonb_build_object('codigo', K4, 'quantidade', 1), jsonb_build_object('codigo', K2, 'quantidade', 1)) where id = t2;
  r := public.kit_creditar_transferencia(c.org, t2);
  perform pg_temp.afirmar(r = '{"ok": false, "motivo": "sem_reserva"}', 'crédito com combinação a mais: ' || r::text);
  perform pg_temp.afirmar(pg_temp.saldos(c.org) = antes and pg_temp.movs(t2) = 4, 'crédito a mais gravou');
  -- Cancelar lê o ledger, não `itens`: devolve tudo, inclusive o que saiu da lista.
  update public.kit_transferencias set itens = jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 1)) where id = t2;
  r := public.kit_cancelar_transferencia(c.org, t2);
  perform pg_temp.afirmar(r = '{"ok": true, "aplicado": true}', 'cancelar com itens alterados: ' || r::text);
  perform pg_temp.afirmar(pg_temp.movs(t2) = 8, 'cancelar não devolveu os 4 SKUs');
  perform pg_temp.afirmar(pg_temp.saldos(c.org) = saldos_antes, 'saldo das origens não voltou');
  perform pg_temp.afirmar(pg_temp.total_pecas(c.org, P) = tp and pg_temp.total_pecas(c.org, B) = tb
    and pg_temp.total_pecas(c.org, A) = ta and pg_temp.total_pecas(c.org, L) = tl, 'peça sumiu com itens alterados');
  update public.kit_transferencias set estado = 'abortada' where id = t2;

  -- Combinação disjunta acrescentada: tudo que o ledger tem bate; só origens menos ledger acusa.
  t2 := pg_temp.transf(c.org, c.kit, 'montar', jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 1)));
  r := public.kit_reservar_transferencia(c.org, t2);
  perform pg_temp.afirmar((r->>'ok')::boolean, 'reserva antes de acrescentar: ' || r::text);
  antes := pg_temp.saldos(c.org);
  update public.kit_transferencias set itens = jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 1),
    jsonb_build_object('codigo', K4, 'quantidade', 1)) where id = t2;
  r := public.kit_creditar_transferencia(c.org, t2);
  perform pg_temp.afirmar(r = '{"ok": false, "motivo": "sem_reserva"}', 'crédito com combinação disjunta a mais: ' || r::text);
  perform pg_temp.afirmar(pg_temp.saldos(c.org) = antes and pg_temp.movs(t2) = 2, 'crédito disjunto a mais gravou');
  r := public.kit_cancelar_transferencia(c.org, t2);
  perform pg_temp.afirmar(r = '{"ok": true, "aplicado": true}', 'cancelar depois de acrescentar: ' || r::text);
  perform pg_temp.afirmar(pg_temp.saldos(c.org) = saldos_antes, 'cancelar não restaurou');
  update public.kit_transferencias set estado = 'abortada' where id = t2;

  -- Nota de compra com SKU bloqueado: recusa desfaz cabeçalho, itens, distribuição, vínculo, custo e ledger.
  select custo into custo_p from public.variacoes where org_id = c.org and codigo = P;
  select custo into custo_l from public.variacoes where org_id = c.org and codigo = L;
  t3 := pg_temp.transf(c.org, null, 'entrada', jsonb_build_array(jsonb_build_object('codigo', L)));
  antes := pg_temp.saldos(c.org);
  begin
    perform public.importar_nota_compra(c.org, c.usuario, nota, itens_nota);
    raise exception 'FALHA: nota importou com SKU bloqueado';
  exception when check_violation then
    if sqlerrm not like 'sku_em_transferencia%' then raise; end if;
  end;
  perform pg_temp.afirmar(not exists (select 1 from public.notas_compra where org_id = c.org), 'cabeçalho da nota ficou');
  perform pg_temp.afirmar(not exists (select 1 from public.notas_compra_itens where org_id = c.org), 'item da nota ficou');
  perform pg_temp.afirmar(not exists (select 1 from public.notas_compra_distribuicao where org_id = c.org), 'distribuição ficou');
  perform pg_temp.afirmar(not exists (select 1 from public.vinculos_fornecedor where org_id = c.org), 'vínculo de fornecedor ficou');
  perform pg_temp.afirmar(not exists (select 1 from public.estoque_movimentos
    where org_id = c.org and referencia_externa like 'nfe:%'), 'referência da nota ficou no ledger');
  perform pg_temp.afirmar(pg_temp.saldos(c.org) = antes, 'nota recusada mexeu no saldo');
  perform pg_temp.afirmar((select custo is not distinct from custo_p from public.variacoes where org_id = c.org and codigo = P)
    and (select custo is not distinct from custo_l from public.variacoes where org_id = c.org and codigo = L),
    'nota recusada mexeu no custo');
  -- O operador repete depois da transferência: a mesma nota entra inteira.
  update public.kit_transferencias set estado = 'concluida' where id = t3;
  l_antes := pg_temp.saldo(c.org, L);
  id_nota := (public.importar_nota_compra(c.org, c.usuario, nota, itens_nota)->>'nota_id')::uuid;
  perform pg_temp.afirmar(pg_temp.saldo(c.org, L) = l_antes + 1 and (select custo = 14 from public.variacoes
    where org_id = c.org and codigo = L), 'repetir a nota não aplicou');

  -- Desfazer com SKU bloqueado: P vem antes de L, e o ajuste de P precisa voltar.
  t3 := pg_temp.transf(c.org, null, 'entrada', jsonb_build_array(jsonb_build_object('codigo', L)));
  antes := pg_temp.saldos(c.org);
  begin
    perform public.desfazer_nota_compra(c.org, c.usuario, id_nota, 'desfeita');
    raise exception 'FALHA: desfazer passou com SKU bloqueado';
  exception when check_violation then
    if sqlerrm not like 'sku_em_transferencia%' then raise; end if;
  end;
  perform pg_temp.afirmar((select status = 'importada' and desfeita_em is null and desfeita_por is null
    from public.notas_compra where id = id_nota), 'cabeçalho mudou no desfazer recusado');
  perform pg_temp.afirmar(not exists (select 1 from public.estoque_movimentos
    where org_id = c.org and referencia_externa like 'nfe-desfazer:%'), 'referência do desfazer ficou no ledger');
  perform pg_temp.afirmar(pg_temp.saldos(c.org) = antes, 'desfazer recusado mexeu no saldo');
  update public.kit_transferencias set estado = 'concluida' where id = t3;
  perform public.desfazer_nota_compra(c.org, c.usuario, id_nota, 'desfeita');
  perform pg_temp.afirmar((select status = 'desfeita' from public.notas_compra where id = id_nota), 'repetir o desfazer não aplicou');

  -- Exclusão: tudo ou nada, em ordem de código; o dono repete sem conflito.
  r := public.kit_adquirir_exclusao(c.org, array[L, P], 'transferencia', dono);
  perform pg_temp.afirmar(r = '{"ok": true}', 'adquirir: ' || r::text);
  perform pg_temp.afirmar((select count(*) = 2 from public.kit_exclusoes where org_id = c.org and dono_id = dono), 'exclusões não gravadas');
  r := public.kit_adquirir_exclusao(c.org, array[P, L, L], 'transferencia', dono);
  perform pg_temp.afirmar(r = '{"ok": true}', 'dono repetindo: ' || r::text);
  -- B e A vêm antes de L na ordem de código: entram e precisam sair quando L conflita.
  r := public.kit_adquirir_exclusao(c.org, array[L, B, A], 'publicacao', outro);
  perform pg_temp.afirmar(r = jsonb_build_object('ok', false, 'codigo', L), 'conflito: ' || r::text);
  perform pg_temp.afirmar((select count(*) = 0 from public.kit_exclusoes where org_id = c.org and dono_id = outro),
    'conflito deixou exclusão parcial');
  -- Mesmo id com outro tipo não é o mesmo dono.
  r := public.kit_adquirir_exclusao(c.org, array[P], 'publicacao', dono);
  perform pg_temp.afirmar(r = jsonb_build_object('ok', false, 'codigo', P), 'dono de outro tipo: ' || r::text);
  -- Soltar só o próprio, e em qualquer org só a dela.
  perform public.kit_soltar_exclusao(c.outra_org, dono);
  perform pg_temp.afirmar((select count(*) = 2 from public.kit_exclusoes where org_id = c.org and dono_id = dono), 'soltou de outra org');
  perform public.kit_soltar_exclusao(c.org, outro);
  perform pg_temp.afirmar((select count(*) = 2 from public.kit_exclusoes where org_id = c.org and dono_id = dono), 'soltou de outro dono');
  perform public.kit_soltar_exclusao(c.org, dono);
  perform pg_temp.afirmar(not exists (select 1 from public.kit_exclusoes where org_id = c.org), 'não soltou');
  r := public.kit_adquirir_exclusao(c.org, array[L, B, A], 'publicacao', outro);
  perform pg_temp.afirmar(r = '{"ok": true}', 'adquirir depois de soltar: ' || r::text);
  perform public.kit_soltar_exclusao(c.org, outro);

  -- Módulo desligado: reserva e exclusão recusam sem gravar. Cancelar segue, a peça precisa voltar.
  t2 := pg_temp.transf(c.org, c.kit, 'montar', jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 1)));
  r := public.kit_reservar_transferencia(c.org, t2);
  perform pg_temp.afirmar((r->>'ok')::boolean, 'reserva antes de desligar: ' || r::text);
  t3 := pg_temp.transf(c.org, c.kit, 'montar', jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 1)));
  update public.organizations set modulos_habilitados = '{}' where id = c.org;
  antes := pg_temp.saldos(c.org);
  r := public.kit_reservar_transferencia(c.org, t3);
  perform pg_temp.afirmar(r = '{"ok": false, "motivo": "modulo_desligado"}', 'reserva sem módulo: ' || r::text);
  perform pg_temp.afirmar(pg_temp.movs(t3) = 0 and pg_temp.saldos(c.org) = antes, 'reserva sem módulo gravou');
  r := public.kit_adquirir_exclusao(c.org, array[L], 'publicacao', outro);
  perform pg_temp.afirmar(r = '{"ok": false, "motivo": "modulo_desligado"}', 'exclusão sem módulo: ' || r::text);
  perform pg_temp.afirmar(not exists (select 1 from public.kit_exclusoes where org_id = c.org), 'exclusão sem módulo gravou');
  r := public.kit_cancelar_transferencia(c.org, t2);
  perform pg_temp.afirmar(r = '{"ok": true, "aplicado": true}', 'cancelar sem módulo: ' || r::text);
  r := public.kit_reservar_transferencia(gen_random_uuid(), t3);
  perform pg_temp.afirmar(r = '{"ok": false, "motivo": "modulo_desligado"}', 'org inexistente: ' || r::text);

  -- Outbox, varredura final: nenhum movimento de transferência ficou pendente.
  perform pg_temp.afirmar((select count(*) = 0 from public.estoque_movimentos
                           where org_id = c.org and motivo in ('kit_saida', 'kit_entrada')
                             and (push_enfileirado_em is null or transferencia_id is null)),
    'movimento de kit sem push_enfileirado_em');
end $$;
reset role;

-- Inventário com SKU bloqueado. Org PJ própria: a foto exige empresa fiscal.
insert into public.organizations (id, nome, slug, tipo_pessoa, modulos_habilitados, is_test) values
  ('97000000-0000-0000-0000-000000000003', 'Kit RPC inv', 'kit-rpc-inv', 'pj', '{estoque,kit_variacao}', true);
insert into public.empresa_fiscal (org_id, cnpj, inscricao_estadual, razao_social) values
  ('97000000-0000-0000-0000-000000000003', '11444777000161', '555555555', 'Empresa Inv Teste');
insert into auth.users (id, email, raw_user_meta_data) values
  ('97000000-0000-0000-0000-000000000103', 'kit-rpc-inv@teste.local', '{"org_id":"97000000-0000-0000-0000-000000000003"}'::jsonb);
insert into public.profiles (id, org_id, is_active, email, nome) values
  ('97000000-0000-0000-0000-000000000103', '97000000-0000-0000-0000-000000000003', true, 'kit-rpc-inv@teste.local', 'Operador')
on conflict (id) do update set org_id = excluded.org_id, is_active = true, email = excluded.email, nome = excluded.nome;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('97000000-0000-0000-0000-000000000203', '97000000-0000-0000-0000-000000000103',
   '97000000-0000-0000-0000-000000000003', 'processando', 'planilha');
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, ncm, unidade, criado_em) values
  ('97000000-0000-0000-0000-000000000303', '97000000-0000-0000-0000-000000000203',
   '97000000-0000-0000-0000-000000000103', '97000000-0000-0000-0000-000000000003',
   '09730000', 'Blusa inv', 'CREATE', 'nacional', gen_random_uuid(), '62034900', 'UN', '2026-01-01 00:00+00');
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque, custo)
select '97000000-0000-0000-0000-000000000303', '97000000-0000-0000-0000-000000000103',
       '97000000-0000-0000-0000-000000000003', c, c, c, 'M', 50, 10, 12.34
from unnest(array['09730001', '09730002', '09730003']) c;
do $$
begin
  if public.gerar_foto_inventario_org('97000000-0000-0000-0000-000000000003', '2026-12-31', 'manual') <> 'gerada' then
    raise exception 'FALHA: foto não gerada';
  end if;
end $$;

set local role service_role;
do $$
declare o constant uuid := '97000000-0000-0000-0000-000000000003';
  u constant uuid := '97000000-0000-0000-0000-000000000103';
  v_id uuid; t uuid; antes text; codigo_bloq text;
begin
  select id into v_id from public.inventarios where org_id = o and data_base = '2026-12-31';
  -- 1: falta, por ajuste. 2: sobra, por entrada. 3: falta, por ajuste.
  perform public.salvar_contagem_inventario(o, v_id, 0,
    '[{"codigo":"09730001","quantidade_contada":8,"justificativa":"quebra"},
      {"codigo":"09730002","quantidade_contada":12,"justificativa":"achado"},
      {"codigo":"09730003","quantidade_contada":7,"justificativa":"quebra"}]');
  antes := pg_temp.saldos(o);

  -- 3 bloqueado: recusa no ajuste, depois de 1 e 2 já aplicados. 2 bloqueado: recusa na entrada.
  foreach codigo_bloq in array array['09730003', '09730002'] loop
    t := pg_temp.transf(o, null, 'entrada', jsonb_build_array(jsonb_build_object('codigo', codigo_bloq)));
    begin
      perform public.confirmar_inventario(o, v_id, 1, u);
      raise exception 'FALHA: inventário confirmou com % bloqueado', codigo_bloq;
    exception when check_violation then
      if sqlerrm not like 'sku_em_transferencia%' then raise; end if;
    end;
    perform pg_temp.afirmar((select status = 'aberto' and confirmado_por is null and confirmado_em is null and versao = 1
      from public.inventarios where id = v_id), 'cabeçalho do inventário mudou com ' || codigo_bloq);
    perform pg_temp.afirmar(not exists (select 1 from public.inventarios_itens
      where inventario_id = v_id and (qtd_final is not null or valor_final is not null)), 'item final gravado com ' || codigo_bloq);
    perform pg_temp.afirmar(not exists (select 1 from public.estoque_movimentos
      where org_id = o and referencia_externa like 'inventario:%'), 'referência do inventário ficou com ' || codigo_bloq);
    perform pg_temp.afirmar(pg_temp.saldos(o) = antes, 'inventário recusado mexeu no saldo com ' || codigo_bloq);
    perform pg_temp.afirmar((select bool_and(custo = 12.34) from public.variacoes where org_id = o),
      'inventário recusado mexeu no custo com ' || codigo_bloq);
    update public.kit_transferencias set estado = 'concluida' where id = t;
  end loop;

  -- Sem transferência, a mesma confirmação passa inteira.
  perform public.confirmar_inventario(o, v_id, 1, u);
  perform pg_temp.afirmar((select status = 'confirmado' from public.inventarios where id = v_id), 'repetir não confirmou');
  perform pg_temp.afirmar(pg_temp.saldos(o) = '09730001=8,09730002=12,09730003=7', 'saldo final: ' || pg_temp.saldos(o));
end $$;
reset role;

-- Ordem dos locks, pela leitura do corpo.
do $$
declare v text;
begin
  select lower(pg_get_functiondef('public.kit_reservar_transferencia(uuid, uuid)'::regprocedure)) into v;
  perform pg_temp.afirmar(position('for share' in v) > 0
    and position('for share' in v) < position('from public.kit_transferencias' in v)
    and position('kit_variacao' in v) > 0
    and position('from public.kit_transferencias' in v) < position('kit_sku_travado' in v)
    and position('order by m.codigo' in v) < position('kit_sku_travado' in v),
    'reservar fora da ordem org, transferência, SKUs em ordem de código');
  perform pg_temp.afirmar(position('greatest' in v) = 0, 'greatest em reservar');
  select lower(pg_get_functiondef('public.kit_adquirir_exclusao(uuid, text[], text, uuid)'::regprocedure)) into v;
  perform pg_temp.afirmar(position('for share' in v) > 0
    and position('for share' in v) < position('insert into public.kit_exclusoes' in v)
    and position('order by' in v) < position('insert into public.kit_exclusoes' in v),
    'adquirir fora da ordem org, códigos ordenados');
  -- `baixar_estoque` e `estornar_estoque` nunca recusam: o guard não pode chegar neles.
  perform pg_temp.afirmar(position('kit_sku_em_transferencia' in lower(prosrc)) = 0, proname || ' ganhou o guard')
  from pg_proc where oid in ('public.baixar_estoque(uuid, text, integer, text, text)'::regprocedure,
                             'public.estornar_estoque(uuid, text, text, text)'::regprocedure);
end $$;

rollback;
