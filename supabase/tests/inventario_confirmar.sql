\set ON_ERROR_STOP on
-- ADR-0181 Plano 2b-2, Task 5: salvar_contagem_inventario e confirmar_inventario sobre uma foto gerada por
-- gerar_foto_inventario_org (nunca pela procedure, que tem COMMIT).
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/inventario_confirmar.sql \
--   supabase/migrations/20261016233218_adr181_inventario_calculo.sql \
--   supabase/migrations/20261017000123_adr181_inventario_foto.sql \
--   supabase/migrations/20261017002438_adr181_inventario_confirmar.sql
-- Segura o lock da migration da Task 3 até o rollback: rodar uma vez, não em laço.
begin;
-- A: falta + sobra + idempotência (service_role). B: recusas. C: guard canônico. X: outra org.
insert into public.organizations (id, nome, slug, tipo_pessoa, modulos_habilitados) values
  ('93700000-0000-0000-0000-000000000001', 'Inv conf A', 'inv-conf-a', 'pj', '{estoque}'),
  ('93700000-0000-0000-0000-000000000002', 'Inv conf B', 'inv-conf-b', 'pj', '{estoque}'),
  ('93700000-0000-0000-0000-000000000003', 'Inv conf C', 'inv-conf-c', 'pj', '{estoque}'),
  ('93700000-0000-0000-0000-000000000004', 'Inv conf X', 'inv-conf-x', 'pj', '{estoque}');
insert into public.empresa_fiscal (org_id, cnpj, inscricao_estadual, razao_social) values
  ('93700000-0000-0000-0000-000000000001', '11222333000181', '111111111', 'Empresa A Teste'),
  ('93700000-0000-0000-0000-000000000002', '11444777000161', '222222222', 'Empresa B Teste'),
  ('93700000-0000-0000-0000-000000000003', '11222333000181', '333333333', 'Empresa C Teste'),
  ('93700000-0000-0000-0000-000000000004', '11444777000161', '444444444', 'Empresa X Teste');
insert into auth.users (id, email, raw_user_meta_data) values
  ('93700000-0000-0000-0000-000000000101', 'inv-conf-a@test.local', '{"org_id":"93700000-0000-0000-0000-000000000001"}'::jsonb),
  ('93700000-0000-0000-0000-000000000102', 'inv-conf-b@test.local', '{"org_id":"93700000-0000-0000-0000-000000000002"}'::jsonb),
  ('93700000-0000-0000-0000-000000000103', 'inv-conf-c@test.local', '{"org_id":"93700000-0000-0000-0000-000000000003"}'::jsonb),
  ('93700000-0000-0000-0000-000000000104', 'inv-conf-x@test.local', '{"org_id":"93700000-0000-0000-0000-000000000004"}'::jsonb);
insert into public.profiles (id, org_id, is_active, email, nome) values
  ('93700000-0000-0000-0000-000000000101', '93700000-0000-0000-0000-000000000001', true, 'inv-conf-a@test.local', 'Operador A'),
  ('93700000-0000-0000-0000-000000000102', '93700000-0000-0000-0000-000000000002', true, 'inv-conf-b@test.local', ''),
  ('93700000-0000-0000-0000-000000000103', '93700000-0000-0000-0000-000000000003', true, 'inv-conf-c@test.local', ''),
  ('93700000-0000-0000-0000-000000000104', '93700000-0000-0000-0000-000000000004', true, 'inv-conf-x@test.local', '')
on conflict (id) do update set org_id = excluded.org_id, is_active = true, email = excluded.email, nome = excluded.nome;

-- Família (lote 'planilha', que aceita saldo no insert) com uma variação (custo de precificação p_custo).
create function pg_temp.fam(p_org uuid, p_user uuid, p_pai text, p_codigo text, p_estoque int, p_custo numeric,
  p_ts timestamptz) returns void language plpgsql as $$
declare v_lote uuid := gen_random_uuid(); v_fam uuid := gen_random_uuid();
begin
  insert into public.lotes (id, user_id, org_id, status, origem) values (v_lote, p_user, p_org, 'processando', 'planilha');
  insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem,
    chave_cadastro, ncm, unidade, criado_em)
  values (v_fam, v_lote, p_user, p_org, p_pai, 'Produto ' || p_pai, 'CREATE', 'nacional', gen_random_uuid(),
    '62034900', 'UN', p_ts);
  insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque, custo)
  values (v_fam, p_user, p_org, p_codigo, 'Azul M', 'Azul', 'M', 50, p_estoque, p_custo);
end $$;

-- Executa p_sql e exige erro cuja mensagem contém p_msg (o bloco desfaz o efeito).
create function pg_temp.deve_falhar(p_sql text, p_msg text) returns void language plpgsql as $$
declare v_falhou boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_msg in sqlerrm) = 0 then
      raise exception 'esperava erro "%" em [%], veio: %', p_msg, p_sql, sqlerrm;
    end if;
    v_falhou := true;
  end;
  if not v_falhou then raise exception 'deveria falhar: %', p_sql; end if;
end $$;

create function pg_temp.inv(p_org uuid) returns uuid language sql as $$
  select id from public.inventarios where org_id = p_org and data_base = '2026-12-31'
$$;
create function pg_temp.saldo(p_org uuid, p_codigo text) returns int language sql as $$
  select v.estoque from public.variacoes v join public.familias f on f.id = v.familia_id
   where v.org_id = p_org and v.codigo = p_codigo order by f.criado_em desc limit 1
$$;

-- A: 09370101 (sistema 10, hoje 9: falta), 09370201 (sistema 2, custo 12.34: sobra), 09370301 (sem contagem).
select pg_temp.fam('93700000-0000-0000-0000-000000000001', '93700000-0000-0000-0000-000000000101',
  '09370100', '09370101', 10, null, '2026-01-01 00:00+00');
select pg_temp.fam('93700000-0000-0000-0000-000000000001', '93700000-0000-0000-0000-000000000101',
  '09370200', '09370201', 2, 12.34, '2026-01-01 00:00+00');
select pg_temp.fam('93700000-0000-0000-0000-000000000001', '93700000-0000-0000-0000-000000000101',
  '09370300', '09370301', 4, null, '2026-01-01 00:00+00');
-- B: 09370401 (sistema 5, hoje 3: falta 5 insuficiente), 09370501 (sistema 1: sobra).
select pg_temp.fam('93700000-0000-0000-0000-000000000002', '93700000-0000-0000-0000-000000000102',
  '09370400', '09370401', 5, null, '2026-01-01 00:00+00');
select pg_temp.fam('93700000-0000-0000-0000-000000000002', '93700000-0000-0000-0000-000000000102',
  '09370500', '09370501', 1, null, '2026-01-01 00:00+00');
-- C: 09370601 (sistema 1: sobra) — uma diferença só.
select pg_temp.fam('93700000-0000-0000-0000-000000000003', '93700000-0000-0000-0000-000000000103',
  '09370600', '09370601', 1, null, '2026-01-01 00:00+00');
-- X: só para ter uma foto de outra org.
select pg_temp.fam('93700000-0000-0000-0000-000000000004', '93700000-0000-0000-0000-000000000104',
  '09370700', '09370701', 1, null, '2026-01-01 00:00+00');

do $$
declare o uuid;
begin
  foreach o in array array['93700000-0000-0000-0000-000000000001', '93700000-0000-0000-0000-000000000002',
                           '93700000-0000-0000-0000-000000000003', '93700000-0000-0000-0000-000000000004']::uuid[] loop
    if public.gerar_foto_inventario_org(o, '2026-12-31', 'manual') <> 'gerada' then
      raise exception 'foto não gerada para %', o;
    end if;
  end loop;
  -- O saldo anda depois da foto (fluxo real): A 09370101 10 → 9; B 09370401 5 → 3.
  perform public.ajustar_estoque('93700000-0000-0000-0000-000000000001', '09370101', 9, 'teste',
    '93700000-0000-0000-0000-000000000101', 'teste-inv-conf:a');
  perform public.ajustar_estoque('93700000-0000-0000-0000-000000000002', '09370401', 3, 'teste',
    '93700000-0000-0000-0000-000000000102', 'teste-inv-conf:b');
  if pg_temp.saldo('93700000-0000-0000-0000-000000000001', '09370101') <> 9
     or pg_temp.saldo('93700000-0000-0000-0000-000000000002', '09370401') <> 3 then
    raise exception 'fixture: saldo de hoje não andou';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 1) Privilégios: só service_role executa.
-- ---------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public.salvar_contagem_inventario(uuid, uuid, int, jsonb)',
                           'public.confirmar_inventario(uuid, uuid, int, uuid)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'anon/authenticated executa %', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'service_role sem %', f; end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2) salvar: recusas e caso válido (org A).
-- ---------------------------------------------------------------------------------------------
do $$
declare a uuid := '93700000-0000-0000-0000-000000000001'; v_id uuid := pg_temp.inv(a); v int;
  q text := 'select public.salvar_contagem_inventario(%L, %L, %s, %L::jsonb)';
begin
  perform pg_temp.deve_falhar(format(q, a, v_id, 5, '[{"codigo":"09370101","quantidade_contada":7,"justificativa":"x"}]'),
    'A contagem mudou em outra aba; recarregue.');
  -- versão obsoleta é 40001 (a edge mapeia para 409)
  begin
    perform public.salvar_contagem_inventario(a, v_id, 5, '[]');
    raise exception 'versão obsoleta passou';
  exception when serialization_failure then
    if sqlerrm <> 'A contagem mudou em outra aba; recarregue.' then raise exception 'mensagem: %', sqlerrm; end if;
  end;
  perform pg_temp.deve_falhar(format(q, a, v_id, 0, '[{"codigo":"09370701","quantidade_contada":1,"justificativa":"x"}]'),
    'não pertence à foto');
  perform pg_temp.deve_falhar(format(q, a, v_id, 0, '[{"codigo":"09370101","quantidade_contada":-1,"justificativa":"x"}]'),
    'inteiro >= 0');
  perform pg_temp.deve_falhar(format(q, a, v_id, 0, '[{"codigo":"09370101","quantidade_contada":7.5,"justificativa":"x"}]'),
    'inteiro >= 0');
  perform pg_temp.deve_falhar(format(q, a, v_id, 0, '[{"codigo":"09370101","quantidade_contada":"7","justificativa":"x"}]'),
    'contagem inválida');
  perform pg_temp.deve_falhar(format(q, a, v_id, 0, '[{"codigo":"09370101","quantidade_contada":7}]'),
    'justificativa obrigatória');
  perform pg_temp.deve_falhar(format(q, a, v_id, 0, '[{"codigo":"09370101","quantidade_contada":7,"justificativa":"   "}]'),
    'justificativa obrigatória');
  perform pg_temp.deve_falhar(format(q, a, v_id, 0,
    '[{"codigo":"09370101","quantidade_contada":7,"justificativa":"x"},{"codigo":"09370101","quantidade_contada":8,"justificativa":"y"}]'),
    'código repetido');
  -- p_id de outra org
  perform pg_temp.deve_falhar(format(q, '93700000-0000-0000-0000-000000000004', v_id, 0, '[]'), 'inventário não encontrado');
  if (select versao from public.inventarios where id = v_id) <> 0
     or exists (select 1 from public.inventarios_itens where inventario_id = v_id and quantidade_contada is not null) then
    raise exception 'recusa do salvar gravou algo';
  end if;

  -- Válido: devolve versao + 1. Contada = sistema dispensa justificativa.
  v := public.salvar_contagem_inventario(a, v_id, 0,
    '[{"codigo":"09370101","quantidade_contada":7,"justificativa":"quebra no depósito"},
      {"codigo":"09370201","quantidade_contada":5,"justificativa":"achado no depósito"},
      {"codigo":"09370301","quantidade_contada":4,"justificativa":null}]');
  if v <> 1 or (select versao from public.inventarios where id = v_id) <> 1 then raise exception 'versão após salvar: %', v; end if;
  if (select array_agg(row(codigo, quantidade_contada, justificativa)::text order by codigo)
        from public.inventarios_itens where inventario_id = v_id)
     is distinct from array['(09370101,7,"quebra no depósito")', '(09370201,5,"achado no depósito")', '(09370301,4,)'] then
    raise exception 'contagem gravada: %', (select array_agg(row(codigo, quantidade_contada, justificativa)::text order by codigo)
        from public.inventarios_itens where inventario_id = v_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3) confirmar, recusas na org A (antes da confirmação válida): versão obsoleta e outra org.
-- ---------------------------------------------------------------------------------------------
do $$
declare a uuid := '93700000-0000-0000-0000-000000000001'; v_id uuid := pg_temp.inv(a);
begin
  begin
    perform public.confirmar_inventario(a, v_id, 0, '93700000-0000-0000-0000-000000000101');
    raise exception 'confirmar com versão obsoleta passou';
  exception when serialization_failure then
    if sqlerrm <> 'A contagem mudou em outra aba; recarregue.' then raise exception 'mensagem: %', sqlerrm; end if;
  end;
  perform pg_temp.deve_falhar(format('select public.confirmar_inventario(%L, %L, 1, %L)',
    '93700000-0000-0000-0000-000000000004', v_id, '93700000-0000-0000-0000-000000000104'), 'inventário não encontrado');
  if exists (select 1 from public.estoque_movimentos where referencia_externa like 'inventario:' || v_id || ':%')
     or (select status from public.inventarios where id = v_id) <> 'aberto' then
    raise exception 'recusa do confirmar gravou algo';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4) confirmar, positivo como service_role (org A): falta e sobra.
-- ---------------------------------------------------------------------------------------------
set local role service_role;
do $$
declare v jsonb;
begin
  v := public.confirmar_inventario('93700000-0000-0000-0000-000000000001',
    (select id from public.inventarios where org_id = '93700000-0000-0000-0000-000000000001' and data_base = '2026-12-31'),
    1, '93700000-0000-0000-0000-000000000101');
  if v <> '{"produtos":[{"codigo_pai":"09370100","reativar":false},{"codigo_pai":"09370200","reativar":true}]}'::jsonb then
    raise exception 'retorno do confirmar: %', v;
  end if;
end $$;
reset role;

do $$
declare a uuid := '93700000-0000-0000-0000-000000000001'; v_id uuid := pg_temp.inv(a); m record; it record; h record;
  v jsonb;
begin
  if current_setting('publiai.inventario_confirmando', true) = 'on' then
    raise exception 'flag inventario_confirmando ficou ligada';
  end if;
  select * into h from public.inventarios where id = v_id;
  if h.status <> 'confirmado' or h.confirmado_por <> '93700000-0000-0000-0000-000000000101' or h.confirmado_em is null then
    raise exception 'cabeçalho após confirmar: % % %', h.status, h.confirmado_por, h.confirmado_em;
  end if;

  -- Falta: sistema 10, contada 7, hoje 9 → 6.
  if pg_temp.saldo(a, '09370101') <> 6 then raise exception 'falta: saldo %', pg_temp.saldo(a, '09370101'); end if;
  select * into m from public.estoque_movimentos where org_id = a and referencia_externa = 'inventario:' || v_id || ':09370101';
  if m.motivo <> 'ajuste' or m.quantidade <> -3 or m.estoque_anterior <> 9 or m.estoque_resultante <> 6
     or m.criado_por <> '93700000-0000-0000-0000-000000000101' or m.codigo_pai <> '09370100' then
    raise exception 'falta: movimento %', row_to_json(m);
  end if;
  select * into it from public.inventarios_itens where inventario_id = v_id and codigo = '09370101';
  if it.qtd_final <> 7 or it.qtd_valorizada_final <> 0 or it.qtd_sem_nota_final <> 7 or it.valor_final <> 0 then
    raise exception 'falta: finais %', row_to_json(it);
  end if;

  -- Sobra: sistema 2, contada 5, hoje 2 → 5; entrada sem custo, custo de precificação intacto.
  if pg_temp.saldo(a, '09370201') <> 5 then raise exception 'sobra: saldo %', pg_temp.saldo(a, '09370201'); end if;
  select * into m from public.estoque_movimentos where org_id = a and referencia_externa = 'inventario:' || v_id || ':09370201';
  if m.motivo <> 'entrada' or m.quantidade <> 3 or m.custo_unitario is not null or m.estoque_resultante <> 5
     or m.documento <> 'Inventário 31/12/2026' or m.observacao <> 'achado no depósito' then
    raise exception 'sobra: movimento %', row_to_json(m);
  end if;
  if (select v.custo from public.variacoes v where v.org_id = a and v.codigo = '09370201') <> 12.34 then
    raise exception 'sobra: variacoes.custo mudou';
  end if;
  select * into it from public.inventarios_itens where inventario_id = v_id and codigo = '09370201';
  if it.qtd_final <> 5 or it.qtd_sem_nota_final <> it.qtd_sem_nota + 3 or it.qtd_valorizada_final <> it.qtd_valorizada
     or it.valor_final <> it.valor_total then
    raise exception 'sobra: finais %', row_to_json(it);
  end if;

  -- Sem diferença: finais = foto, sem movimento.
  select * into it from public.inventarios_itens where inventario_id = v_id and codigo = '09370301';
  if it.qtd_final <> 4 or it.qtd_valorizada_final <> it.qtd_valorizada or it.qtd_sem_nota_final <> it.qtd_sem_nota
     or it.valor_final <> it.valor_total then
    raise exception 'sem diferença: finais %', row_to_json(it);
  end if;
  if (select count(*) from public.estoque_movimentos where org_id = a and referencia_externa like 'inventario:' || v_id || ':%') <> 2 then
    raise exception 'movimentos do inventário <> 2';
  end if;

  -- Idempotência: mesma lista, nenhum movimento novo (a versão já não importa).
  v := public.confirmar_inventario(a, v_id, 0, '93700000-0000-0000-0000-000000000101');
  if v <> '{"produtos":[{"codigo_pai":"09370100","reativar":false},{"codigo_pai":"09370200","reativar":true}]}'::jsonb then
    raise exception 'retry do confirmar: %', v;
  end if;
  if (select count(*) from public.estoque_movimentos where org_id = a and referencia_externa like 'inventario:' || v_id || ':%') <> 2
     or pg_temp.saldo(a, '09370101') <> 6 or pg_temp.saldo(a, '09370201') <> 5 then
    raise exception 'retry do confirmar mexeu no estoque';
  end if;

  -- Confirmado: salvar recusa.
  perform pg_temp.deve_falhar(format('select public.salvar_contagem_inventario(%L, %L, 1, %L::jsonb)', a, v_id, '[]'),
    'não está aberto');
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5) confirmar, recusas na org B: saldo insuficiente, sem justificativa, 'falhou'.
-- ---------------------------------------------------------------------------------------------
do $$
declare b uuid := '93700000-0000-0000-0000-000000000002'; v_id uuid := pg_temp.inv(b); v_falhou uuid;
  q text := 'select public.confirmar_inventario(%L, %L, %s, %L)';
begin
  -- 09370401: falta 5 (contada 0) com saldo de hoje 3; 09370501: sobra 1.
  perform public.salvar_contagem_inventario(b, v_id, 0,
    '[{"codigo":"09370401","quantidade_contada":0,"justificativa":"perdido"},
      {"codigo":"09370501","quantidade_contada":2,"justificativa":"achado"}]');
  perform pg_temp.deve_falhar(format(q, b, v_id, 1, '93700000-0000-0000-0000-000000000102'),
    'saldo de hoje insuficiente em 09370401 (saldo 3, falta 5)');
  if exists (select 1 from public.estoque_movimentos where org_id = b and referencia_externa like 'inventario:%')
     or pg_temp.saldo(b, '09370401') <> 3 or pg_temp.saldo(b, '09370501') <> 1
     or (select status from public.inventarios where id = v_id) <> 'aberto' then
    raise exception 'saldo insuficiente: algo foi gravado';
  end if;

  -- Diferença sem justificativa (gravada por fora do salvar, que a recusaria).
  update public.inventarios_itens set quantidade_contada = 3, justificativa = ' '
   where inventario_id = v_id and codigo = '09370401';
  perform pg_temp.deve_falhar(format(q, b, v_id, 1, '93700000-0000-0000-0000-000000000102'),
    'diferença sem justificativa em 09370401');

  -- Cabeçalho 'falhou'.
  insert into public.inventarios (org_id, data_base, gerado_em, origem, status, erro)
  values (b, '2025-12-31', now(), 'cron', 'falhou', 'erro de teste') returning id into v_falhou;
  perform pg_temp.deve_falhar(format(q, b, v_falhou, 0, '93700000-0000-0000-0000-000000000102'), 'não está aberto');
  if exists (select 1 from public.estoque_movimentos where org_id = b and referencia_externa like 'inventario:%') then
    raise exception 'recusas da org B gravaram movimento';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6) Guard canônico (org C): família mais nova do código inserida durante a confirmação → 40001.
-- ---------------------------------------------------------------------------------------------
create function pg_temp.familia_no_meio() returns trigger language plpgsql security definer
  set search_path = public, pg_temp as $$
begin
  perform pg_temp.fam(new.org_id, '93700000-0000-0000-0000-000000000103', '09370600', new.codigo, 0, null,
    '2026-06-01 00:00+00');
  return null;
end $$;
create trigger inv_conf_familia_no_meio after insert on public.estoque_movimentos
  for each row when (new.referencia_externa like 'inventario:%') execute function pg_temp.familia_no_meio();

do $$
declare c uuid := '93700000-0000-0000-0000-000000000003'; v_id uuid := pg_temp.inv(c); v_falhou boolean := false;
begin
  perform public.salvar_contagem_inventario(c, v_id, 0,
    '[{"codigo":"09370601","quantidade_contada":3,"justificativa":"achado"}]');
  begin
    perform public.confirmar_inventario(c, v_id, 1, '93700000-0000-0000-0000-000000000103');
  exception when serialization_failure then
    if position('mudou durante a confirmação' in sqlerrm) = 0 then raise exception 'guard: mensagem %', sqlerrm; end if;
    v_falhou := true;
  end;
  if not v_falhou then raise exception 'guard canônico não disparou'; end if;
  if exists (select 1 from public.estoque_movimentos where org_id = c and referencia_externa like 'inventario:%')
     or pg_temp.saldo(c, '09370601') <> 1
     or (select count(*) from public.familias where org_id = c and codigo_pai = '09370600') <> 1
     or (select status from public.inventarios where id = v_id) <> 'aberto' then
    raise exception 'guard canônico: sobrou efeito da confirmação abortada';
  end if;
end $$;
drop trigger inv_conf_familia_no_meio on public.estoque_movimentos;
rollback;
