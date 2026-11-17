\set ON_ERROR_STOP on
-- ADR-0207 (migration reposicao_acoes): ações do pedido atômicas sob o lock do pedido.
-- Rodar com scripts/teste-sql-desfeito.py <este arquivo> <migration reposicao> <migration reposicao_acoes>.
-- Transação sempre desfeita; fixtures numa org própria. A concorrência real (duas sessões) não cabe numa transação:
-- o teste prova (a) que o lock do pedido é o primeiro comando de cada RPC (leitura do corpo) e (b) o estado depois
-- de a "outra sessão" ter vencido (aprovação ou recebimento já gravados antes da chamada).
begin;

create function pg_temp.afirmar(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALHA: %', p_msg; end if;
end $$;
grant execute on function pg_temp.afirmar(boolean, text) to service_role;

do $$
declare f text; v record;
begin
  foreach f in array array['public.reposicao_salvar_rascunho(uuid, uuid, uuid, uuid, date, boolean, jsonb)',
                           'public.reposicao_editar_pedido(uuid, uuid, uuid, date, jsonb, boolean)',
                           'public.reposicao_encerrar_saldo(uuid, uuid, text[])',
                           'public.reposicao_reabrir_saldo(uuid, uuid, text[])'] loop
    select p.prosecdef, p.proconfig, p.prosrc into v from pg_proc p where p.oid = f::regprocedure;
    perform pg_temp.afirmar(v.prosecdef and v.proconfig = array['search_path=""'], f || ': não é definer com search_path vazio');
    perform pg_temp.afirmar(has_function_privilege('service_role', f, 'execute'), f || ': sem service_role');
    perform pg_temp.afirmar(not has_function_privilege('authenticated', f, 'execute')
      and not has_function_privilege('anon', f, 'execute'), f || ': executável por JWT');
    -- Primeiro lock = o pedido, antes de qualquer escrita em itens (mesma ordem das RPCs de recebimento).
    perform pg_temp.afirmar(position('from public.pedidos_compra' in v.prosrc) between 1 and position('for update' in v.prosrc)
      and position('for update' in v.prosrc) < position('public.pedidos_compra_itens' in v.prosrc),
      f || ': o pedido não é o primeiro lock');
  end loop;
end $$;

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97000000-0000-0000-0000-000000000001', 'Reposição ações teste', 'reposicao-acoes-teste', array['estoque','reposicao'], true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('97000000-0000-0000-0000-000000000101', 'reposicao-acoes@teste.local', '{"org_id":"97000000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('97000000-0000-0000-0000-000000000101', '97000000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.fornecedores (id, org_id, nome, nome_normalizado) values
  ('97000000-0000-0000-0000-000000000401', '97000000-0000-0000-0000-000000000001', 'Fornecedor A', 'fornecedor a'),
  ('97000000-0000-0000-0000-000000000402', '97000000-0000-0000-0000-000000000001', 'Fornecedor B', 'fornecedor b');
-- 0601 rascunho que será aprovado · 0602 enviado que recebe · 0603 enviado parcial · 0604 aprovado editável
-- · 0605 enviado com um item encerrado
insert into public.pedidos_compra (id, org_id, fornecedor_id, status, enviado_em) values
  ('97000000-0000-0000-0000-000000000601', '97000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000401', 'rascunho', null),
  ('97000000-0000-0000-0000-000000000602', '97000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000402', 'enviado', now()),
  ('97000000-0000-0000-0000-000000000603', '97000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000402', 'enviado', now()),
  ('97000000-0000-0000-0000-000000000604', '97000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000402', 'aprovado', null),
  ('97000000-0000-0000-0000-000000000605', '97000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000402', 'enviado', now());
insert into public.pedidos_compra_itens (pedido_id, org_id, codigo, codigo_pai, quantidade, sugerida) values
  ('97000000-0000-0000-0000-000000000601', '97000000-0000-0000-0000-000000000001', '09700001', '09700000', 5, 5),
  ('97000000-0000-0000-0000-000000000602', '97000000-0000-0000-0000-000000000001', '09700002', '09700000', 10, 10),
  ('97000000-0000-0000-0000-000000000603', '97000000-0000-0000-0000-000000000001', '09700003', '09700000', 10, 10),
  ('97000000-0000-0000-0000-000000000603', '97000000-0000-0000-0000-000000000001', '09700004', '09700000', 4, 4),
  ('97000000-0000-0000-0000-000000000604', '97000000-0000-0000-0000-000000000001', '09700005', '09700000', 6, 6),
  ('97000000-0000-0000-0000-000000000604', '97000000-0000-0000-0000-000000000001', '09700006', '09700000', 2, 2),
  ('97000000-0000-0000-0000-000000000605', '97000000-0000-0000-0000-000000000001', '09700007', '09700000', 3, 3),
  ('97000000-0000-0000-0000-000000000605', '97000000-0000-0000-0000-000000000001', '09700008', '09700000', 2, 2);

set local role service_role;
do $$
declare
  O constant uuid := '97000000-0000-0000-0000-000000000001';
  U constant uuid := '97000000-0000-0000-0000-000000000101';
  FA constant uuid := '97000000-0000-0000-0000-000000000401';
  P1 constant uuid := '97000000-0000-0000-0000-000000000601';
  P2 constant uuid := '97000000-0000-0000-0000-000000000602';
  P3 constant uuid := '97000000-0000-0000-0000-000000000603';
  P4 constant uuid := '97000000-0000-0000-0000-000000000604';
  P5 constant uuid := '97000000-0000-0000-0000-000000000605';
  v_id uuid; v_id2 uuid; r jsonb; v_ok boolean;
begin
  -- Rascunho: salvar acrescenta/atualiza e tira com 0; sem p_pedido usa o rascunho do fornecedor.
  v_id := public.reposicao_salvar_rascunho(O, FA, null, U, null, false,
    '[{"codigo":"09700001","codigo_pai":"09700000","quantidade":7,"sugerida":5},{"codigo":"09700009","codigo_pai":"09700000","quantidade":2,"sugerida":null}]');
  perform pg_temp.afirmar(v_id = P1, 'rascunho: não usou o rascunho existente');
  perform pg_temp.afirmar((select quantidade from public.pedidos_compra_itens where pedido_id = P1 and codigo = '09700001') = 7
    and (select count(*) from public.pedidos_compra_itens where pedido_id = P1) = 2, 'rascunho: itens');
  perform pg_temp.afirmar((select salvo_por from public.pedidos_compra where id = P1) = U, 'rascunho: salvo_por');
  v_id := public.reposicao_salvar_rascunho(O, FA, P1, U, '2026-12-01', true,
    '[{"codigo":"09700009","codigo_pai":"09700000","quantidade":0,"sugerida":null}]');
  perform pg_temp.afirmar((select count(*) from public.pedidos_compra_itens where pedido_id = P1) = 1
    and (select previsto_para from public.pedidos_compra where id = P1) = '2026-12-01', 'rascunho: quantidade 0 / data');

  -- Salvar depois de aprovar (a outra sessão aprovou entre a tela e o salvar): erro, itens intactos.
  update public.pedidos_compra set status = 'aprovado', ref_aprovacao = 'acoes-ref-1' where id = P1;
  begin
    perform public.reposicao_salvar_rascunho(O, FA, P1, U, null, false,
      '[{"codigo":"09700001","codigo_pai":"09700000","quantidade":99,"sugerida":5}]');
    v_ok := false;
  exception when check_violation then v_ok := sqlerrm like '%deixou de ser rascunho%';
  end;
  perform pg_temp.afirmar(v_ok, 'salvar após aprovar: não recusou');
  perform pg_temp.afirmar((select quantidade from public.pedidos_compra_itens where pedido_id = P1 and codigo = '09700001') = 7
    and (select count(*) from public.pedidos_compra_itens where pedido_id = P1) = 1, 'salvar após aprovar: itens mudaram');
  -- Sem p_pedido, o aprovado não é tocado: nasce rascunho novo.
  v_id2 := public.reposicao_salvar_rascunho(O, FA, null, U, null, false,
    '[{"codigo":"09700001","codigo_pai":"09700000","quantidade":3,"sugerida":3}]');
  perform pg_temp.afirmar(v_id2 is not null and v_id2 <> P1
    and (select status from public.pedidos_compra where id = v_id2) = 'rascunho', 'salvar sem pedido: não criou rascunho novo');
  perform pg_temp.afirmar((select quantidade from public.pedidos_compra_itens where pedido_id = P1 and codigo = '09700001') = 7,
    'salvar sem pedido: mexeu no aprovado');
  -- Tirar o último item apaga o rascunho.
  v_id := public.reposicao_salvar_rascunho(O, FA, v_id2, U, null, false,
    '[{"codigo":"09700001","codigo_pai":"09700000","quantidade":0,"sugerida":3}]');
  perform pg_temp.afirmar(v_id is null and not exists (select 1 from public.pedidos_compra where id = v_id2), 'rascunho vazio não apagado');

  -- Editar aprovado sem a permissão de admin (membro): recusa 42501, nada muda.
  begin
    perform public.reposicao_editar_pedido(O, P4, U, '2026-12-10', '[{"codigo":"09700005","quantidade":99}]');
    raise exception 'FALHA: membro editou pedido aprovado';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
    perform pg_temp.afirmar(sqlstate = '42501' and sqlerrm like '%administrador%', 'editar aprovado sem admin: ' || sqlstate || ' ' || sqlerrm);
  end;
  perform pg_temp.afirmar((select quantidade from public.pedidos_compra_itens where pedido_id = P4 and codigo = '09700005') <> 99
    and (select alterado_por from public.pedidos_compra where id = P4) is null, 'editar aprovado sem admin: mudou');

  -- Editar: aprovado sem recebimento muda quantidade, tira item, grava quem alterou.
  perform public.reposicao_editar_pedido(O, P4, U, '2026-12-10',
    '[{"codigo":"09700005","quantidade":8},{"codigo":"09700006","quantidade":0}]', true);
  perform pg_temp.afirmar((select quantidade from public.pedidos_compra_itens where pedido_id = P4 and codigo = '09700005') = 8
    and not exists (select 1 from public.pedidos_compra_itens where pedido_id = P4 and codigo = '09700006')
    and (select alterado_por = U and previsto_para = '2026-12-10' from public.pedidos_compra where id = P4), 'editar aprovado');
  begin
    perform public.reposicao_editar_pedido(O, P4, U, '2026-12-10', '[{"codigo":"09700005","quantidade":0}]', true);
    v_ok := false;
  exception when invalid_parameter_value then v_ok := true;
  end;
  perform pg_temp.afirmar(v_ok and (select quantidade from public.pedidos_compra_itens where pedido_id = P4 and codigo = '09700005') = 8,
    'editar: pedido vazio aceito');

  -- Editar recalcula o status: P5 enviado com A encerrado (sem recebimento) e B aberto; tirar B → saldo_encerrado.
  update public.pedidos_compra_itens set encerrado = true where pedido_id = P5 and codigo = '09700007';
  perform public.reposicao_editar_pedido(O, P5, U, '2026-12-10', '[{"codigo":"09700008","quantidade":0}]', true);
  perform pg_temp.afirmar((select status from public.pedidos_compra where id = P5) = 'saldo_encerrado',
    'editar: status não recalculado: ' || (select status from public.pedidos_compra where id = P5));
  -- E editar quantidade num aprovado aberto mantém aprovado (P4 já editado acima).
  perform pg_temp.afirmar((select status from public.pedidos_compra where id = P4) = 'aprovado', 'editar: aprovado mudou de status');

  -- Editar depois de recebimento (a outra sessão recebeu antes): erro, quantidade intacta. Desfeito também trava.
  perform public.reposicao_receber(O, P2, '09700002', 3, 'acoes-rec-1');
  begin
    perform public.reposicao_editar_pedido(O, P2, U, '2026-12-10', '[{"codigo":"09700002","quantidade":20}]', true);
    v_ok := false;
  exception when check_violation then v_ok := sqlerrm like '%recebimento%';
  end;
  perform pg_temp.afirmar(v_ok and (select quantidade from public.pedidos_compra_itens where pedido_id = P2) = 10,
    'editar após recebimento: não recusou');
  perform public.reposicao_desfazer_recebimentos(O, array['acoes-rec-1']);
  begin
    perform public.reposicao_editar_pedido(O, P2, U, '2026-12-10', '[{"codigo":"09700002","quantidade":20}]', true);
    v_ok := false;
  exception when check_violation then v_ok := true;
  end;
  perform pg_temp.afirmar(v_ok, 'editar após recebimento desfeito: não recusou');

  -- Encerrar com recebimento parcial: status pelas quantidades atuais (recebida 4 de 10 e 0 de 4).
  perform public.reposicao_receber(O, P3, '09700003', 4, 'acoes-rec-2');
  perform pg_temp.afirmar((select status from public.pedidos_compra where id = P3) = 'parcial', 'encerrar: pré-condição parcial');
  r := public.reposicao_encerrar_saldo(O, P3, array['09700004']);
  perform pg_temp.afirmar(r->>'status' = 'parcial' and r->'codigos' = '["09700004"]'::jsonb
    and (select status from public.pedidos_compra where id = P3) = 'parcial', 'encerrar parte: ' || r::text);
  r := public.reposicao_encerrar_saldo(O, P3, null);
  perform pg_temp.afirmar(r->>'status' = 'saldo_encerrado' and r->'codigos' = '["09700003"]'::jsonb
    and (select status from public.pedidos_compra where id = P3) = 'saldo_encerrado'
    and (select recebida from public.pedidos_compra_itens where pedido_id = P3 and codigo = '09700003') = 4,
    'encerrar tudo: ' || r::text);
  -- Pedido encerrado não recebe mais (regra da Task 1) e reabrir devolve o saldo.
  r := public.reposicao_reabrir_saldo(O, P3, array['09700003']);
  perform pg_temp.afirmar(r->>'status' = 'parcial'
    and not (select encerrado from public.pedidos_compra_itens where pedido_id = P3 and codigo = '09700003')
    and (select encerrado from public.pedidos_compra_itens where pedido_id = P3 and codigo = '09700004'), 'reabrir: ' || r::text);
  -- O restante chega: recebido; e encerrar o que sobrou com tudo recebido do resto → saldo_encerrado.
  perform public.reposicao_receber(O, P3, '09700003', 6, 'acoes-rec-3');
  perform pg_temp.afirmar((select status from public.pedidos_compra where id = P3) = 'recebido', 'recebido após reabrir');
  begin
    perform public.reposicao_encerrar_saldo(O, P3, null);
    v_ok := false;
  exception when check_violation then v_ok := true;
  end;
  perform pg_temp.afirmar(v_ok, 'encerrar pedido recebido aceito');

  -- Outra org não enxerga o pedido.
  begin
    perform public.reposicao_encerrar_saldo('98000000-0000-0000-0000-00000000ffff', P2, null);
    v_ok := false;
  exception when no_data_found then v_ok := true;
  end;
  perform pg_temp.afirmar(v_ok, 'outra org: encontrou o pedido');
end $$;
reset role;

rollback;
