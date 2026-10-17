\set ON_ERROR_STOP on
-- ADR-0181 Plano 2b-2, Task 4: foto de 31/12 (tabelas, imutabilidade, privilégios, geração por org,
-- data-base, elegibilidade, leitura JSON). Nunca chama a procedure gerar_fotos_inventario (tem COMMIT):
-- usa gerar_foto_inventario_org e confere só a forma da procedure e o job do cron.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/inventario_foto.sql \
--   supabase/migrations/20261016233218_adr181_inventario_calculo.sql supabase/migrations/20261017000123_adr181_inventario_foto.sql
-- Segura o lock da migration da Task 3 até o rollback: rodar uma vez, não em laço.
begin;
-- A e B: elegíveis. PF, SM (sem módulo), SC (sem CNPJ): não. V: volume (1.200 SKUs).
insert into public.organizations (id, nome, slug, tipo_pessoa, modulos_habilitados) values
  ('93600000-0000-0000-0000-000000000001', 'Inv foto A',  'inv-foto-a',  'pj', '{estoque}'),
  ('93600000-0000-0000-0000-000000000002', 'Inv foto B',  'inv-foto-b',  'pj', '{estoque}'),
  ('93600000-0000-0000-0000-000000000003', 'Inv foto PF', 'inv-foto-pf', 'pf', '{estoque}'),
  ('93600000-0000-0000-0000-000000000004', 'Inv foto SM', 'inv-foto-sm', 'pj', '{}'),
  ('93600000-0000-0000-0000-000000000005', 'Inv foto SC', 'inv-foto-sc', 'pj', '{estoque}'),
  ('93600000-0000-0000-0000-000000000006', 'Inv foto V',  'inv-foto-v',  'pj', '{}');
insert into public.empresa_fiscal (org_id, cnpj, inscricao_estadual, razao_social) values
  ('93600000-0000-0000-0000-000000000001', '11222333000181', '111111111', 'Empresa A Teste'),
  ('93600000-0000-0000-0000-000000000002', '11444777000161', '222222222', 'Empresa B Teste'),
  ('93600000-0000-0000-0000-000000000003', '11222333000181', null, 'Pessoa PF Teste'),
  ('93600000-0000-0000-0000-000000000004', '11444777000161', null, 'Empresa SM Teste'),
  ('93600000-0000-0000-0000-000000000005', null, null, 'Empresa SC Teste');
insert into auth.users (id, email, raw_user_meta_data) values
  ('93600000-0000-0000-0000-000000000101', 'inv-foto-a@test.local', '{"org_id":"93600000-0000-0000-0000-000000000001"}'::jsonb),
  ('93600000-0000-0000-0000-000000000102', 'inv-foto-b@test.local', '{"org_id":"93600000-0000-0000-0000-000000000002"}'::jsonb),
  ('93600000-0000-0000-0000-000000000106', 'inv-foto-v@test.local', '{"org_id":"93600000-0000-0000-0000-000000000006"}'::jsonb);
insert into public.profiles (id, org_id, is_active, email, nome) values
  ('93600000-0000-0000-0000-000000000101', '93600000-0000-0000-0000-000000000001', true, 'inv-foto-a@test.local', ''),
  ('93600000-0000-0000-0000-000000000102', '93600000-0000-0000-0000-000000000002', true, 'inv-foto-b@test.local', 'Operador B'),
  ('93600000-0000-0000-0000-000000000106', '93600000-0000-0000-0000-000000000006', true, 'inv-foto-v@test.local', '')
on conflict (id) do update set org_id = excluded.org_id, is_active = true, email = excluded.email, nome = excluded.nome;

-- Família (lote 'planilha', que aceita saldo no insert) com as variações dadas.
create function pg_temp.fam(p_org uuid, p_user uuid, p_pai text, p_codigos text[], p_estoque int,
  p_ts timestamptz) returns void language plpgsql as $$
declare v_lote uuid := gen_random_uuid(); v_fam uuid := gen_random_uuid();
begin
  insert into public.lotes (id, user_id, org_id, status, origem) values (v_lote, p_user, p_org, 'processando', 'planilha');
  insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem,
    chave_cadastro, ncm, unidade, criado_em)
  values (v_fam, v_lote, p_user, p_org, p_pai, 'Produto ' || p_pai, 'CREATE', 'nacional', gen_random_uuid(),
    '62034900', 'UN', p_ts);
  insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
  select v_fam, p_user, p_org, c, 'Azul M', 'Azul', 'M', 50, p_estoque from unnest(p_codigos) c;
end $$;

-- A: 09360101 (saldo 5) e 09360102 (saldo 0) + família NOVA VAZIA do mesmo pai (Review Focus 1); 09360201.
select pg_temp.fam('93600000-0000-0000-0000-000000000001', '93600000-0000-0000-0000-000000000101',
  '09360100', array['09360101'], 5, '2026-01-01 00:00+00');
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
select v.familia_id, v.user_id, v.org_id, '09360102', 'Azul G', 'Azul', 'G', 50, 0
  from public.variacoes v where v.org_id = '93600000-0000-0000-0000-000000000001' and v.codigo = '09360101';
select pg_temp.fam('93600000-0000-0000-0000-000000000001', '93600000-0000-0000-0000-000000000101',
  '09360100', array[]::text[], 0, '2026-02-01 00:00+00');
select pg_temp.fam('93600000-0000-0000-0000-000000000001', '93600000-0000-0000-0000-000000000101',
  '09360200', array['09360201'], 3, '2026-01-01 00:00+00');
-- B: 09360301 (saldo 7).
select pg_temp.fam('93600000-0000-0000-0000-000000000002', '93600000-0000-0000-0000-000000000102',
  '09360300', array['09360301'], 7, '2026-01-01 00:00+00');
-- V: uma família com 1.200 SKUs. Os triggers de insert de variacoes varrem familias por linha; a fixture
-- é sintética e válida, então pula os triggers só neste insert (como inventario_calculo_volume.sql).
select pg_temp.fam('93600000-0000-0000-0000-000000000006', '93600000-0000-0000-0000-000000000106',
  '09369000', array[]::text[], 0, '2026-01-01 00:00+00');
set local session_replication_role = replica;
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, preco, estoque)
select f.id, f.user_id, f.org_id, 'V' || lpad(g::text, 5, '0'), 'V', 50, 1
  from public.familias f cross join generate_series(1, 1200) g
 where f.org_id = '93600000-0000-0000-0000-000000000006';
set local session_replication_role = origin;

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

-- ---------------------------------------------------------------------------------------------
-- 1) Forma da procedure (nunca chamada aqui) e job do cron.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_proc
                  where oid = 'public.gerar_fotos_inventario(date, text, uuid)'::regprocedure
                    and prokind = 'p' and proconfig is null and not prosecdef) then
    raise exception 'gerar_fotos_inventario tem de ser procedure, sem SET e sem security definer';
  end if;
  if (select count(*) from cron.job where jobname = 'inventario-foto-31-12') <> 1
     or not exists (select 1 from cron.job where jobname = 'inventario-foto-31-12'
                     and schedule = '59 2 1 1 *' and command = 'call public.gerar_fotos_inventario()') then
    raise exception 'job do cron errado: %',
      (select json_agg(row_to_json(j)) from cron.job j where jobname = 'inventario-foto-31-12');
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2) Elegibilidade e data-base.
-- ---------------------------------------------------------------------------------------------
do $$
declare v uuid[];
begin
  select array_agg(o order by o) into v from public.inventario_orgs_elegiveis() o
   where o::text like '93600000-0000-0000-0000-00000000000%';
  if v is distinct from array['93600000-0000-0000-0000-000000000001',
                              '93600000-0000-0000-0000-000000000002']::uuid[] then
    raise exception 'elegíveis da fixture: %', v;
  end if;
  if public.inventario_data_base('2026-12-31 23:59-03') <> '2026-12-31'
     or public.inventario_data_base('2027-01-01 01:00-03') <> '2026-12-31'
     or public.inventario_data_base('2026-12-31 10:00-03') <> '2025-12-31'
     or public.inventario_data_base('2027-01-01 02:59+00') <> '2026-12-31' then   -- disparo do cron (GMT)
    raise exception 'data-base: % % % %', public.inventario_data_base('2026-12-31 23:59-03'),
      public.inventario_data_base('2027-01-01 01:00-03'), public.inventario_data_base('2026-12-31 10:00-03'),
      public.inventario_data_base('2027-01-01 02:59+00');
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3) Geração, idempotência, 'falhou' refeita, família nova vazia.
-- ---------------------------------------------------------------------------------------------
do $$
declare r text; h record; n int;
begin
  r := public.gerar_foto_inventario_org('93600000-0000-0000-0000-000000000001', '2026-12-31', 'cron');
  if r <> 'gerada' then raise exception 'primeira geração: %', r; end if;
  if current_setting('publiai.inventario_gerando', true) = 'on' then
    raise exception 'flag inventario_gerando ficou ligada';
  end if;
  select * into h from public.inventarios
   where org_id = '93600000-0000-0000-0000-000000000001' and data_base = '2026-12-31';
  if h.status <> 'aberto' or h.versao <> 0 or h.origem <> 'cron' or h.erro is not null
     or h.cnpj <> '11222333000181' or h.inscricao_estadual <> '111111111' or h.razao_social <> 'Empresa A Teste'
     or h.gerado_em is null or h.confirmado_em is not null then
    raise exception 'cabeçalho: %', row_to_json(h);
  end if;
  select count(*) into n from public.inventarios_itens where inventario_id = h.id;
  if n <> 3 then raise exception 'itens de A: %, esperado 3', n; end if;
  -- Família nova vazia não esconde o SKU; saldo 0 entra (permite sobra na contagem).
  if not exists (select 1 from public.inventarios_itens where inventario_id = h.id and codigo = '09360101'
                  and quantidade_sistema = 5 and qtd_sem_nota = 5 and qtd_valorizada = 0 and custo_medio is null
                  and valor_total = 0 and marcas = '{sem_nota}' and codigo_pai = '09360100' and ncm = '62034900')
     or not exists (select 1 from public.inventarios_itens where inventario_id = h.id and codigo = '09360102'
                     and quantidade_sistema = 0) then
    raise exception 'SKUs de A: %', (select json_agg(row_to_json(i)) from public.inventarios_itens i
                                      where i.inventario_id = h.id);
  end if;

  r := public.gerar_foto_inventario_org('93600000-0000-0000-0000-000000000001', '2026-12-31', 'manual');
  if r <> 'existia' then raise exception 'segunda geração: %', r; end if;
  if (select count(*) from public.inventarios where org_id = '93600000-0000-0000-0000-000000000001'
        and data_base = '2026-12-31') <> 1
     or (select count(*) from public.inventarios_itens where inventario_id = h.id) <> 3 then
    raise exception 'segunda geração duplicou';
  end if;

  -- 'falhou' é refeita.
  insert into public.inventarios (org_id, data_base, gerado_em, origem, status, erro)
  values ('93600000-0000-0000-0000-000000000001', '2025-12-31', now(), 'cron', 'falhou', 'erro antigo');
  r := public.gerar_foto_inventario_org('93600000-0000-0000-0000-000000000001', '2025-12-31', 'manual');
  if r <> 'gerada' then raise exception 'refazer falhou: %', r; end if;
  if (select count(*) from public.inventarios where org_id = '93600000-0000-0000-0000-000000000001'
        and data_base = '2025-12-31' and status = 'aberto' and erro is null and origem = 'manual') <> 1
     or (select count(*) from public.inventarios where org_id = '93600000-0000-0000-0000-000000000001'
           and data_base = '2025-12-31') <> 1 then
    raise exception 'refazer falhou: cabeçalho errado';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4) 1.200 SKUs: JSON único, sem corte de 1000. Duas orgs na mesma data. Sem foto → null. Hoje.
-- ---------------------------------------------------------------------------------------------
do $$
declare j jsonb; n int;
begin
  if public.gerar_foto_inventario_org('93600000-0000-0000-0000-000000000006', '2026-12-31', 'cron') <> 'gerada' then
    raise exception 'geração de V';
  end if;
  n := jsonb_array_length(public.inventario_hoje_json('93600000-0000-0000-0000-000000000006')->'itens');
  if n <> 1200 then raise exception 'hoje V: % itens', n; end if;
  n := jsonb_array_length(public.inventario_foto_json('93600000-0000-0000-0000-000000000006', '2026-12-31')->'itens');
  if n <> 1200 then raise exception 'foto V: % itens', n; end if;

  if public.gerar_foto_inventario_org('93600000-0000-0000-0000-000000000002', '2026-12-31', 'cron') <> 'gerada' then
    raise exception 'geração de B';
  end if;
  j := public.inventario_foto_json('93600000-0000-0000-0000-000000000001', '2026-12-31');
  if jsonb_array_length(j->'itens') <> 3
     or exists (select 1 from jsonb_array_elements(j->'itens') x
                 where x->>'org_id' <> '93600000-0000-0000-0000-000000000001') then
    raise exception 'foto A: %', j;
  end if;
  if j->'cabecalho'->>'status' <> 'aberto' or (j->'cabecalho'->>'versao')::int <> 0
     or j->'cabecalho'->>'cnpj' <> '11222333000181' or j->'cabecalho'->>'origem' <> 'cron'
     or (j->'cabecalho'->>'id')::uuid <> (select id from public.inventarios
                                         where org_id = '93600000-0000-0000-0000-000000000001'
                                           and data_base = '2026-12-31')
     or not (j->'cabecalho' ?& array['data_base', 'gerado_em', 'erro', 'inscricao_estadual', 'razao_social',
                                     'confirmado_em', 'confirmado_por_nome'])
     or not (j->'itens'->0 ?& array['id', 'inventario_id', 'codigo', 'codigo_pai', 'descricao', 'ncm', 'unidade',
             'cor', 'tamanho', 'quantidade_sistema', 'qtd_valorizada', 'qtd_sem_nota', 'custo_medio', 'valor_total',
             'marcas', 'quantidade_contada', 'justificativa', 'qtd_final', 'qtd_valorizada_final',
             'qtd_sem_nota_final', 'valor_final']) then
    raise exception 'cabeçalho/colunas da foto A: %', j;
  end if;
  j := public.inventario_foto_json('93600000-0000-0000-0000-000000000002', '2026-12-31');
  if jsonb_array_length(j->'itens') <> 1 or j->'itens'->0->>'org_id' <> '93600000-0000-0000-0000-000000000002'
     or j->'itens'->0->>'codigo' <> '09360301' then
    raise exception 'foto B: %', j;
  end if;
  if public.inventario_foto_json('93600000-0000-0000-0000-000000000001', '2024-12-31') is not null then
    raise exception 'sem foto tem de ser null';
  end if;
  j := public.inventario_hoje_json('93600000-0000-0000-0000-000000000001');
  if j->'cabecalho'->>'status' <> 'hoje' or jsonb_array_length(j->'itens') <> 3
     or (j->'cabecalho'->>'data_base')::date <> (now() at time zone 'America/Sao_Paulo')::date
     or j->'cabecalho'->>'cnpj' <> '11222333000181' or j->'cabecalho'->>'razao_social' <> 'Empresa A Teste'
     or not (j->'cabecalho' ? 'gerado_em') or not (j->'cabecalho' ? 'inscricao_estadual')
     or not exists (select 1 from jsonb_array_elements(j->'itens') x
                     where x->>'codigo' = '09360101' and (x->>'quantidade_sistema')::int = 5) then
    raise exception 'hoje A: %', j;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5) Imutabilidade.
-- ---------------------------------------------------------------------------------------------
do $$
declare v_h uuid; v_h25 uuid; v_item uuid; v_item25 uuid; c record; v_falhou uuid; v_item_f uuid; j jsonb;
begin
  select id into v_h from public.inventarios where org_id = '93600000-0000-0000-0000-000000000001' and data_base = '2026-12-31';
  select id into v_h25 from public.inventarios where org_id = '93600000-0000-0000-0000-000000000001' and data_base = '2025-12-31';
  select id into v_item from public.inventarios_itens where inventario_id = v_h and codigo = '09360101';
  select id into v_item25 from public.inventarios_itens where inventario_id = v_h25 and codigo = '09360101';

  -- Itens: cada coluna da foto e o vínculo.
  for c in select * from (values
      ('codigo', 'codigo || ''x'''), ('codigo_pai', 'codigo_pai || ''x'''),
      ('descricao', 'coalesce(descricao, '''') || ''x'''), ('ncm', 'coalesce(ncm, '''') || ''x'''),
      ('unidade', 'coalesce(unidade, '''') || ''x'''), ('cor', 'coalesce(cor, '''') || ''x'''),
      ('tamanho', 'coalesce(tamanho, '''') || ''x'''), ('quantidade_sistema', 'quantidade_sistema + 1'),
      ('qtd_valorizada', 'qtd_valorizada + 1'), ('qtd_sem_nota', 'qtd_sem_nota + 1'),
      ('custo_medio', 'coalesce(custo_medio, 0) + 1'), ('valor_total', 'valor_total + 1'),
      ('marcas', 'marcas || ''{x}''::text[]'), ('inventario_id', quote_literal(v_h25)),
      ('org_id', quote_literal('93600000-0000-0000-0000-000000000002'))) t(col, expr)
  loop
    perform pg_temp.deve_falhar(format('update public.inventarios_itens set %I = %s where id = %L', c.col, c.expr, v_item),
      'Foto do inventário é imutável');
  end loop;
  -- Contagem com o cabeçalho 'aberto' passa (controle positivo).
  update public.inventarios_itens set quantidade_contada = 4, justificativa = 'avaria' where id = v_item;
  if not found then raise exception 'contagem com aberto não gravou'; end if;
  -- *_final sem a flag.
  for c in select unnest(array['qtd_final', 'qtd_valorizada_final', 'qtd_sem_nota_final', 'valor_final']) as col loop
    perform pg_temp.deve_falhar(format('update public.inventarios_itens set %I = 1 where id = %L', c.col, v_item),
      'só por confirmar_inventario');
  end loop;
  -- Insert direto (fora de gerar_foto_inventario_org).
  perform pg_temp.deve_falhar(format('insert into public.inventarios_itens (inventario_id, org_id, codigo, codigo_pai, '
    'quantidade_sistema, qtd_valorizada, qtd_sem_nota, valor_total) values (%L, %L, ''NOVO'', ''X'', 0, 0, 0, 0)',
    v_h, '93600000-0000-0000-0000-000000000001'), 'só por gerar_foto_inventario_org');

  -- Cabeçalho: congelados e transição sem a flag.
  perform pg_temp.deve_falhar(format('update public.inventarios set cnpj = ''11444777000161'' where id = %L', v_h),
    'Cabeçalho do inventário é imutável');
  perform pg_temp.deve_falhar(format('update public.inventarios set data_base = ''2023-12-31'' where id = %L', v_h),
    'Cabeçalho do inventário é imutável');
  perform pg_temp.deve_falhar(format('update public.inventarios set gerado_em = gerado_em + interval ''1 s'' where id = %L', v_h),
    'Cabeçalho do inventário é imutável');
  perform pg_temp.deve_falhar(format('update public.inventarios set status = ''confirmado'', confirmado_em = now() '
    'where id = %L', v_h), 'só por confirmar_inventario');
  perform pg_temp.deve_falhar(format('update public.inventarios set status = ''falhou'', erro = ''x'' where id = %L', v_h),
    'imutável');
  update public.inventarios set versao = versao + 1 where id = v_h;   -- salvar sobe a versão sem flag
  if not found then raise exception 'versao com aberto não gravou'; end if;

  -- Confirmação com a flag (o que confirmar_inventario fará): *_final e transição passam.
  perform set_config('publiai.inventario_confirmando', 'on', true);
  update public.inventarios_itens set qtd_final = quantidade_sistema, qtd_valorizada_final = qtd_valorizada,
         qtd_sem_nota_final = qtd_sem_nota, valor_final = valor_total where inventario_id = v_h25;
  update public.inventarios set status = 'confirmado', confirmado_por = '93600000-0000-0000-0000-000000000101',
         confirmado_em = now() where id = v_h25;
  perform set_config('publiai.inventario_confirmando', 'off', true);
  if (select status from public.inventarios where id = v_h25) <> 'confirmado' then
    raise exception 'confirmação com a flag não gravou';
  end if;
  -- Confirmado: nenhum update, nem com a flag; contagem recusada.
  perform pg_temp.deve_falhar(format('update public.inventarios set versao = versao + 1 where id = %L', v_h25),
    'não está aberto');
  perform set_config('publiai.inventario_confirmando', 'on', true);
  perform pg_temp.deve_falhar(format('update public.inventarios set confirmado_em = now() where id = %L', v_h25),
    'não está aberto');
  perform set_config('publiai.inventario_confirmando', 'off', true);
  perform pg_temp.deve_falhar(format('update public.inventarios_itens set quantidade_contada = 1 where id = %L', v_item25),
    'não está aberto');
  -- Nome de quem confirmou: profiles.nome vazio → e-mail do perfil.
  j := public.inventario_foto_json('93600000-0000-0000-0000-000000000001', '2025-12-31');
  if j->'cabecalho'->>'status' <> 'confirmado' or j->'cabecalho'->>'confirmado_por_nome' <> 'inv-foto-a@test.local'
     or j->'cabecalho'->>'confirmado_em' is null then
    raise exception 'foto confirmada: %', j->'cabecalho';
  end if;

  -- Cabeçalho 'falhou' com um item: contagem e update do cabeçalho recusados.
  insert into public.inventarios (org_id, data_base, gerado_em, origem, status, erro)
  values ('93600000-0000-0000-0000-000000000001', '2024-12-31', now(), 'cron', 'falhou', 'x') returning id into v_falhou;
  perform set_config('publiai.inventario_gerando', 'on', true);
  insert into public.inventarios_itens (inventario_id, org_id, codigo, codigo_pai, quantidade_sistema, qtd_valorizada,
    qtd_sem_nota, valor_total) values (v_falhou, '93600000-0000-0000-0000-000000000001', 'F1', 'F', 1, 0, 1, 0)
  returning id into v_item_f;
  perform set_config('publiai.inventario_gerando', 'off', true);
  perform pg_temp.deve_falhar(format('update public.inventarios_itens set quantidade_contada = 1 where id = %L', v_item_f),
    'não está aberto');
  perform pg_temp.deve_falhar(format('update public.inventarios set versao = 1 where id = %L', v_falhou), 'não está aberto');
  delete from public.inventarios where id = v_falhou;   -- exclusão (service_role/postgres) não é barrada
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6) Privilégios.
-- ---------------------------------------------------------------------------------------------
do $$
declare t text; p text; f text;
begin
  foreach t in array array['public.inventarios', 'public.inventarios_itens', 'public.inventario_corte_backfill'] loop
    foreach p in array array['insert', 'update', 'delete', 'truncate'] loop
      if has_table_privilege('authenticated', t, p) then raise exception 'authenticated tem % em %', p, t; end if;
    end loop;
    foreach p in array array['select', 'insert', 'update', 'delete', 'truncate'] loop
      if has_table_privilege('anon', t, p) then raise exception 'anon tem % em %', p, t; end if;
    end loop;
  end loop;
  if not has_table_privilege('authenticated', 'public.inventarios', 'select')
     or not has_table_privilege('authenticated', 'public.inventarios_itens', 'select') then
    raise exception 'authenticated sem select (RLS) nas tabelas da foto';
  end if;
  foreach f in array array[
      'public.gerar_foto_inventario_org(uuid, date, text)', 'public.inventario_data_base(timestamptz)',
      'public.gerar_fotos_inventario(date, text, uuid)', 'public.inventario_hoje_json(uuid)',
      'public.inventario_foto_json(uuid, date)', 'public.inventario_orgs_elegiveis()',
      'public.inventarios_guardar_cabecalho()', 'public.inventarios_itens_guardar()',
      'public.inventarios_itens_bloquear_insert()'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'anon/authenticated executa %', f;
    end if;
  end loop;
  foreach f in array array[
      'public.gerar_foto_inventario_org(uuid, date, text)', 'public.gerar_fotos_inventario(date, text, uuid)',
      'public.inventario_hoje_json(uuid)', 'public.inventario_foto_json(uuid, date)'] loop
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'service_role sem %', f; end if;
  end loop;
end $$;

-- RLS: authenticated da org B só enxerga a org B.
set local role authenticated;
set local request.jwt.claims = '{"sub":"93600000-0000-0000-0000-000000000102","role":"authenticated"}';
do $$
begin
  if (select count(*) from public.inventarios) <> 1
     or exists (select 1 from public.inventarios where org_id <> '93600000-0000-0000-0000-000000000002')
     or (select count(*) from public.inventarios_itens) <> 1
     or exists (select 1 from public.inventarios_itens where org_id <> '93600000-0000-0000-0000-000000000002') then
    raise exception 'RLS: authenticated de B viu outra org';
  end if;
end $$;
reset role;

-- Positivo: service_role gera e lê.
set local role service_role;
do $$
begin
  if public.gerar_foto_inventario_org('93600000-0000-0000-0000-000000000002', '2025-12-31', 'manual') <> 'gerada' then
    raise exception 'service_role não gerou a foto';
  end if;
  if jsonb_array_length(public.inventario_foto_json('93600000-0000-0000-0000-000000000002', '2025-12-31')->'itens') <> 1
     or jsonb_array_length(public.inventario_hoje_json('93600000-0000-0000-0000-000000000002')->'itens') <> 1 then
    raise exception 'service_role não gerou/leu a foto';
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------------------------
-- 7) Falha isolada (por último: troca inventario_calcular até o rollback). Erro do cálculo na org A
--    → 'falhou' com erro; a org B logo em seguida → 'gerada' com os itens reais.
-- ---------------------------------------------------------------------------------------------
alter function public.inventario_calcular(uuid) rename to inventario_calcular_real;
create function public.inventario_calcular(p_org uuid)
returns table (
  codigo text, codigo_pai text, descricao text, ncm text, unidade text, cor text, tamanho text,
  quantidade_sistema int, qtd_valorizada int, qtd_sem_nota int, custo_medio numeric(14,6),
  valor_total numeric(14,2), marcas text[]
) language plpgsql as $$
begin
  if p_org = '93600000-0000-0000-0000-000000000001' then raise exception 'falha simulada do cálculo'; end if;
  return query select * from public.inventario_calcular_real(p_org);
end $$;
do $$
declare h record;
begin
  if public.gerar_foto_inventario_org('93600000-0000-0000-0000-000000000001', '2023-12-31', 'cron') <> 'falhou' then
    raise exception 'org A deveria falhar';
  end if;
  if current_setting('publiai.inventario_gerando', true) = 'on' then
    raise exception 'flag inventario_gerando ficou ligada após a falha';
  end if;
  select * into h from public.inventarios where org_id = '93600000-0000-0000-0000-000000000001' and data_base = '2023-12-31';
  if h.status <> 'falhou' or position('falha simulada do cálculo' in h.erro) = 0
     or h.cnpj <> '11222333000181'
     or exists (select 1 from public.inventarios_itens where inventario_id = h.id) then
    raise exception 'cabeçalho da falha: %', row_to_json(h);
  end if;
  -- Chamada e leitura em instruções separadas: a mesma instrução não vê o que a função gravou.
  if public.gerar_foto_inventario_org('93600000-0000-0000-0000-000000000002', '2023-12-31', 'cron') <> 'gerada' then
    raise exception 'org B deveria ser gerada depois da falha de A';
  end if;
  if (select count(*) from public.inventarios_itens i join public.inventarios c on c.id = i.inventario_id
       where c.org_id = '93600000-0000-0000-0000-000000000002' and c.data_base = '2023-12-31') <> 1 then
    raise exception 'foto de B depois da falha de A sem o item';
  end if;
end $$;

rollback;
