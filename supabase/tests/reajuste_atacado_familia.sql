-- ADR-0196 — edição do % do atacado por família: reserva por entrada `pendente`, confirmação e conclusão.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/reajuste_atacado_familia.sql <migrations 20261107*>
begin;

create function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FALHA: %', msg; end if;
end $$;

create function pg_temp.passos(p_estado text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('tipo', 'faixas', 'anterior', '[]'::jsonb, 'alvo', '[]'::jsonb, 'config', null, 'estado', p_estado))
$$;

create function pg_temp.fid(n int) returns uuid language sql as $$
  select ('95000000-0000-0000-0000-0000000003' || lpad(n::text, 2, '0'))::uuid
$$;

-- Nova operação de edição da família n, com itens MLB<n>A e MLB<n>B em `aplicado` e faixas confirmadas (`rascunho` no rascunho).
create function pg_temp.op(p_id uuid, n int, p_status text default 'executando') returns void language plpgsql as $$
declare v_org uuid := '95000000-0000-0000-0000-000000000001';
begin
  insert into public.operacoes_massa (id, org_id, acao, status, expira_em, atacado_familias) values
    (p_id, v_org, 'reajustar', p_status, case when p_status = 'rascunho' then now() + interval '1 hour' end, jsonb_build_array(jsonb_build_object(
      'familia_id', pg_temp.fid(n), 'novo', '[{"min_unidades":2,"desconto_pct":10}]'::jsonb, 'esperado', '[{"min_unidades":2,"desconto_pct":5}]'::jsonb,
      'status', 'pendente', 'motivo', null)));
  insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, preco, codigo_pai, passos, incluido)
  select p_id, v_org, 'MLB' || n || x, case when p_status = 'rascunho' then 'rascunho' else 'aplicado' end, 100, '095' || lpad(n::text, 5, '0'), pg_temp.passos('confirmado'), true
  from unnest(array['A', 'B']) x;
end $$;

create function pg_temp.fam(n int) returns jsonb language sql as $$
  select f.atacado from public.familias f where f.id = pg_temp.fid(n)
$$;
create function pg_temp.ent(p_op uuid) returns jsonb language sql as $$
  select o.atacado_familias->0 from public.operacoes_massa o where o.id = p_op
$$;

insert into public.organizations (id, nome, slug) values ('95000000-0000-0000-0000-000000000001', 'Atacado', 'reajuste-atacado-test');
insert into auth.users (id, email, raw_user_meta_data) values
  ('95000000-0000-0000-0000-000000000101', 'reajuste-atacado@test.local', '{"org_id":"95000000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('95000000-0000-0000-0000-000000000201', '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', 'processando', 'manual');
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, status, origem, chave_cadastro, ml_item_id, publicado_em, atacado)
select pg_temp.fid(n), '95000000-0000-0000-0000-000000000201', '95000000-0000-0000-0000-000000000101',
       '95000000-0000-0000-0000-000000000001', '095' || lpad(n::text, 5, '0'), 'Produto ' || n, 'UPDATE', 'pronto', 'nacional', gen_random_uuid(), 'MLB' || n || 'A',
       now() - interval '1 day', '[{"min_unidades":2,"desconto_pct":5}]'::jsonb
from generate_series(1, 20) n;
-- Outros lotes: produto 13 com linha igual e sem config; 14 com cor própria em outra linha; 16 com config diferente;
-- 17 com a linha pedida NULL e o lote antigo com config.
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('95000000-0000-0000-0000-000000000203', '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', 'processando', 'manual'),
  ('95000000-0000-0000-0000-000000000204', '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', 'processando', 'manual'),
  ('95000000-0000-0000-0000-000000000205', '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', 'processando', 'manual');
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, status, origem, chave_cadastro, atacado)
select x.id::uuid, x.lote::uuid, '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', x.pai, 'Outro lote', 'UPDATE', 'pronto', 'nacional', gen_random_uuid(), x.atacado::jsonb
from (values
  ('95000000-0000-0000-0000-000000000351', '95000000-0000-0000-0000-000000000203', '09500013', '[{"min_unidades":2,"desconto_pct":5}]'),
  ('95000000-0000-0000-0000-000000000352', '95000000-0000-0000-0000-000000000204', '09500013', null),
  ('95000000-0000-0000-0000-000000000353', '95000000-0000-0000-0000-000000000205', '09500016', '[{"min_unidades":3,"desconto_pct":7}]'),
  ('95000000-0000-0000-0000-000000000355', '95000000-0000-0000-0000-000000000203', '09500017', '[{"min_unidades":2,"desconto_pct":5}]'),
  ('95000000-0000-0000-0000-000000000354', '95000000-0000-0000-0000-000000000203', '09500014', '[{"min_unidades":2,"desconto_pct":5}]')
) x(id, lote, pai, atacado);
insert into public.variacoes (id, familia_id, user_id, org_id, codigo, nome, preco, atacado)
select '95000000-0000-0000-0000-000000000402', '95000000-0000-0000-0000-000000000354', '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', '09500014', 'A', 10, '[]'::jsonb;

-- UP: produto 19 com os MLBs do rascunho; produto 20 ganha um anúncio depois do preview; um retirado não conta.
insert into public.anuncios_externos (id, user_id, org_id, canal, codigo_pai, particao, item_externo_id) values
  ('95000000-0000-0000-0000-000000000901', '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', 'mercado_livre', '09500019', 0, null),
  ('95000000-0000-0000-0000-000000000902', '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', 'mercado_livre', '09500020', 0, null);
insert into public.anuncios_externos_itens (anuncio_externo_id, org_id, sku, status, item_externo_id, retirado) values
  ('95000000-0000-0000-0000-000000000901', '95000000-0000-0000-0000-000000000001', 'S19A', 'ativo', 'MLB19A', false),
  ('95000000-0000-0000-0000-000000000901', '95000000-0000-0000-0000-000000000001', 'S19B', 'ativo', 'MLB19B', false),
  ('95000000-0000-0000-0000-000000000901', '95000000-0000-0000-0000-000000000001', 'S19C', 'ativo', 'MLB19C', true),
  ('95000000-0000-0000-0000-000000000902', '95000000-0000-0000-0000-000000000001', 'S20A', 'ativo', 'MLB20A', false),
  ('95000000-0000-0000-0000-000000000902', '95000000-0000-0000-0000-000000000001', 'S20B', 'ativo', 'MLB20B', false),
  ('95000000-0000-0000-0000-000000000902', '95000000-0000-0000-0000-000000000001', 'S20C', 'ativo', 'MLB20C', false);

-- Segundo MLB do produto 9: a barreira do claim resolve o produto pelo MLB.
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('95000000-0000-0000-0000-000000000202', '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', 'processando', 'manual');
insert into public.familias (lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, status, origem, chave_cadastro, ml_item_id, publicado_em)
values ('95000000-0000-0000-0000-000000000202', '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', '09500009', 'Produto 9', 'UPDATE', 'publicado', 'nacional', gen_random_uuid(), 'MLB9B', now() - interval '2 days');
insert into public.variacoes (id, familia_id, user_id, org_id, codigo, nome, preco, atacado)
select '95000000-0000-0000-0000-000000000401', pg_temp.fid(12), '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', '09500012', 'A', 10, '[]'::jsonb;

do $$
declare
  v_org uuid := '95000000-0000-0000-0000-000000000001';
  a1 uuid := '95000000-0000-0000-0000-000000000501'; a2 uuid := '95000000-0000-0000-0000-000000000502';
  a3 uuid := '95000000-0000-0000-0000-000000000503'; a4 uuid := '95000000-0000-0000-0000-000000000504';
  a5 uuid := '95000000-0000-0000-0000-000000000505'; a6 uuid := '95000000-0000-0000-0000-000000000506';
  a7 uuid := '95000000-0000-0000-0000-000000000507'; a8 uuid := '95000000-0000-0000-0000-000000000508';
  a9 uuid := '95000000-0000-0000-0000-000000000509'; a12 uuid := '95000000-0000-0000-0000-000000000512';
  b1 uuid := '95000000-0000-0000-0000-000000000601'; b2 uuid := '95000000-0000-0000-0000-000000000602';
  v_cinco jsonb := '[{"min_unidades":2,"desconto_pct":5}]'; v_dez jsonb := '[{"min_unidades":2,"desconto_pct":10}]';
  v_r jsonb; v_t text; v_c jsonb;
begin
  -- Conclusão: 1 item `erro` → configuração intacta, `nao_aplicado`.
  perform pg_temp.op(a1, 1);
  update public.operacoes_massa_itens set status = 'erro', mensagem = 'x' where operacao_id = a1 and ml_item_id = 'MLB1B';
  v_r := public.reajuste_atacado_concluir(v_org, a1);
  perform pg_temp.ok((v_r->>'pendentes')::int = 0, 'erro: nada fica pendente');
  perform pg_temp.ok(pg_temp.fam(1) = v_cinco, 'erro: familias.atacado inalterado');
  perform pg_temp.ok(pg_temp.ent(a1)->>'status' = 'nao_aplicado' and pg_temp.ent(a1)->>'motivo' is not null, 'erro: nao_aplicado com motivo');

  -- `aplicado` com faixas não confirmadas (MSG_FAIXAS_PENDENTES) → `nao_aplicado`.
  perform pg_temp.op(a2, 2);
  update public.operacoes_massa_itens set passos = pg_temp.passos('pendente') where operacao_id = a2 and ml_item_id = 'MLB2B';
  perform public.reajuste_atacado_concluir(v_org, a2);
  perform pg_temp.ok(pg_temp.fam(2) = v_cinco and pg_temp.ent(a2)->>'status' = 'nao_aplicado', 'faixas pendentes: nao_aplicado');

  -- Item sem passo de faixas nunca conta como confirmado.
  perform pg_temp.op(a7, 7);
  update public.operacoes_massa_itens set passos = '[]'::jsonb where operacao_id = a7 and ml_item_id = 'MLB7B';
  perform public.reajuste_atacado_concluir(v_org, a7);
  perform pg_temp.ok(pg_temp.fam(7) = v_cinco and pg_temp.ent(a7)->>'status' = 'nao_aplicado', 'sem passo: nao_aplicado');

  -- Todos confirmados → grava; repetir não muda nada; a reserva é solta na mesma transação.
  perform pg_temp.op(a3, 3);
  perform pg_temp.ok(public.reajuste_ativo_produto(v_org, '09500003') is not null, 'pendente com itens encerrados segue ativo');
  v_t := public.familia_reservar_migracao_pxv(v_org, '09500003', jsonb_build_object('migracao_pxv_status', 'solicitada'));
  perform pg_temp.ok(v_t like 'Há reajuste%', 'migração recusada com entrada pendente');
  perform pg_temp.ok((select r.motivo from public.familia_reservar_publicacao(v_org, array[pg_temp.fid(3)], 'UPDATE') r) like 'Há reajuste%', 'publicação recusada com entrada pendente');
  perform pg_temp.ok((select f.status::text from public.familias f where f.id = pg_temp.fid(3)) = 'pronto', 'publicação recusada não reserva');
  perform public.reajuste_atacado_concluir(v_org, a3);
  perform pg_temp.ok(pg_temp.fam(3) = v_dez and pg_temp.ent(a3)->>'status' = 'aplicado' and pg_temp.ent(a3)->'motivo' = 'null'::jsonb, 'todos confirmados: grava');
  v_c := (select o.atacado_familias from public.operacoes_massa o where o.id = a3);
  update public.familias set atacado = v_cinco where id = pg_temp.fid(3);
  perform public.reajuste_atacado_concluir(v_org, a3);
  perform pg_temp.ok(pg_temp.fam(3) = v_cinco and (select o.atacado_familias from public.operacoes_massa o where o.id = a3) = v_c, 'repetir: idempotente');
  perform pg_temp.ok(public.reajuste_ativo_produto(v_org, '09500003') is null, 'concluir libera');
  perform pg_temp.ok((select r.motivo from public.familia_reservar_publicacao(v_org, array[pg_temp.fid(3)], 'UPDATE') r) is null, 'depois de concluir: publicação aceita');

  -- Configuração mudou → `nao_aplicado` com motivo (compare-and-set).
  perform pg_temp.op(a4, 4);
  update public.familias set atacado = '[{"min_unidades":3,"desconto_pct":7}]' where id = pg_temp.fid(4);
  perform public.reajuste_atacado_concluir(v_org, a4);
  perform pg_temp.ok(pg_temp.fam(4) = '[{"min_unidades":3,"desconto_pct":7}]'::jsonb and pg_temp.ent(a4)->>'status' = 'nao_aplicado'
    and pg_temp.ent(a4)->>'motivo' like '%mudou%', 'configuração mudou: nao_aplicado');

  -- Cor ganhou config própria depois da última revalidação → `nao_aplicado`.
  perform pg_temp.op(a12, 12);
  perform public.reajuste_atacado_concluir(v_org, a12);
  perform pg_temp.ok(pg_temp.fam(12) = v_cinco and pg_temp.ent(a12)->>'status' = 'nao_aplicado' and pg_temp.ent(a12)->>'motivo' = 'Atacado por cor: ajuste na Revisão', 'cor própria: nao_aplicado');

  -- Família sem configuração: `esperado` null casa com a coluna null; `novo` null limpa.
  perform pg_temp.op(a5, 5);
  update public.familias set atacado = null where id = pg_temp.fid(5);
  update public.operacoes_massa set atacado_familias = jsonb_set(atacado_familias, '{0,esperado}', 'null'::jsonb) where id = a5;
  perform public.reajuste_atacado_concluir(v_org, a5);
  perform pg_temp.ok(pg_temp.fam(5) = v_dez, 'esperado null: grava');
  perform pg_temp.op(a8, 8);
  update public.operacoes_massa set atacado_familias = jsonb_set(atacado_familias, '{0,novo}', 'null'::jsonb) where id = a8;
  perform public.reajuste_atacado_concluir(v_org, a8);
  perform pg_temp.ok(pg_temp.fam(8) is null and pg_temp.ent(a8)->>'status' = 'aplicado', 'novo null: volta a null de verdade');

  -- Item ainda em andamento: fica pendente, sem decidir.
  perform pg_temp.op(a6, 6);
  update public.operacoes_massa_itens set status = 'conferindo', proxima_conferencia = now() + interval '1 hour' where operacao_id = a6 and ml_item_id = 'MLB6B';
  v_r := public.reajuste_atacado_concluir(v_org, a6);
  perform pg_temp.ok((v_r->>'pendentes')::int = 1 and pg_temp.ent(a6)->>'status' = 'pendente' and pg_temp.fam(6) = v_cinco, 'item em andamento: segue pendente');

  -- Operação B em MLB já `aplicado` da família de A, com entrada `pendente`: confirmar e reivindicar de B recusam; os de A passam.
  perform pg_temp.op(a9, 9);
  update public.operacoes_massa_itens set status = 'pendente', passos = pg_temp.passos('pendente') where operacao_id = a9 and ml_item_id = 'MLB9B';
  v_t := public.reajuste_reivindicar(v_org, a9, 'MLB9B');
  perform pg_temp.ok(v_t like 'ok:%', 'A reivindica o próprio item: ' || v_t);

  insert into public.operacoes_massa (id, org_id, acao, status, expira_em) values (b1, v_org, 'reajustar', 'rascunho', now() + interval '1 hour');
  insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, preco, codigo_pai, passos, incluido, avaliacao) values
    (b1, v_org, 'MLB9A', 'rascunho', 100, '09500009', pg_temp.passos('pendente'), true, '{}'::jsonb);
  v_t := public.reajuste_confirmar(v_org, b1, '[]'::jsonb);
  perform pg_temp.ok(v_t = 'ocupado:MLB9A', 'B não confirma: ' || v_t);
  perform pg_temp.ok((select status from public.operacoes_massa where id = b1) = 'rascunho', 'B segue rascunho');

  insert into public.operacoes_massa (id, org_id, acao, status) values (b2, v_org, 'reajustar', 'executando');
  insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, preco, codigo_pai, passos) values
    (b2, v_org, 'MLB9A', 'pendente', 100, '09500009', pg_temp.passos('pendente'));
  v_t := public.reajuste_reivindicar(v_org, b2, 'MLB9A');
  perform pg_temp.ok(v_t = 'Família com atacado em edição — tente depois', 'B não reivindica: ' || v_t);
  perform pg_temp.ok((select i.status from public.operacoes_massa_itens i where i.operacao_id = b2) = 'bloqueado', 'B fica bloqueado');
end $$;

-- Edição e Reverter com herança entre lotes; crash depois de concluir; recusa da volta.
do $$
declare
  v_org uuid := '95000000-0000-0000-0000-000000000001';
  e1 uuid := '95000000-0000-0000-0000-000000000801'; e2 uuid := '95000000-0000-0000-0000-000000000802';
  e3 uuid := '95000000-0000-0000-0000-000000000803'; e4 uuid := '95000000-0000-0000-0000-000000000804';
  e5 uuid := '95000000-0000-0000-0000-000000000805'; e6 uuid := '95000000-0000-0000-0000-000000000806';
  e7 uuid := '95000000-0000-0000-0000-000000000807'; e8 uuid := '95000000-0000-0000-0000-000000000808';
  v_cinco jsonb := '[{"min_unidades":2,"desconto_pct":5}]'; v_dez jsonb := '[{"min_unidades":2,"desconto_pct":10}]';
  v_tok uuid := gen_random_uuid(); v_i public.operacoes_massa_itens;
begin
  perform pg_temp.op(e1, 13);
  perform public.reajuste_atacado_concluir(v_org, e1);
  perform pg_temp.ok(pg_temp.fam(13) = v_dez, 'edição: linha pedida');
  perform pg_temp.ok((select f.atacado from public.familias f where f.id = '95000000-0000-0000-0000-000000000351') = v_dez, 'edição: outro lote igual a esperado acompanha');
  perform pg_temp.ok((select f.atacado from public.familias f where f.id = '95000000-0000-0000-0000-000000000352') = v_dez, 'edição: lote NULL recebe a config nova');
  perform pg_temp.ok(jsonb_array_length(pg_temp.ent(e1)->'anteriores') = 3, 'edição: guarda o valor de cada linha');

  -- Reverter: o inverso, sobre as mesmas linhas.
  insert into public.operacoes_massa (id, org_id, acao, status, origem_id, atacado_familias) values
    (e2, v_org, 'reajustar', 'executando', e1, jsonb_build_array(jsonb_build_object('familia_id', pg_temp.fid(13), 'novo', v_cinco, 'esperado', v_dez, 'status', 'pendente', 'motivo', null,
      'restaurar', pg_temp.ent(e1)->'anteriores')));
  insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, preco, codigo_pai, passos) values
    (e2, v_org, 'MLB13A', 'aplicado', 100, '09500013', pg_temp.passos('confirmado'));
  perform public.reajuste_atacado_concluir(v_org, e2);
  perform pg_temp.ok(pg_temp.fam(13) = v_cinco and (select f.atacado from public.familias f where f.id = '95000000-0000-0000-0000-000000000351') = v_cinco, 'Reverter: as linhas com config voltam');
  perform pg_temp.ok((select f.atacado from public.familias f where f.id = '95000000-0000-0000-0000-000000000352') is null, 'Reverter: a linha NULL volta a NULL');

  -- Revisão desligou o atacado depois do último passo: todas as linhas NULL com `esperado` não nulo → não sobrescreve.
  perform pg_temp.op(e8, 18);
  update public.familias set atacado = null where id = pg_temp.fid(18);
  perform public.reajuste_atacado_concluir(v_org, e8);
  perform pg_temp.ok(pg_temp.fam(18) is null and pg_temp.ent(e8)->>'status' = 'nao_aplicado' and pg_temp.ent(e8)->>'motivo' like '%mudou%', 'atacado desligado: nao_aplicado');

  -- Lote com outra config: nada é escrito.
  perform pg_temp.op(e5, 16);
  perform public.reajuste_atacado_concluir(v_org, e5);
  perform pg_temp.ok(pg_temp.fam(16) = v_cinco and pg_temp.ent(e5)->>'status' = 'nao_aplicado' and pg_temp.ent(e5)->>'motivo' like '%mudou%', 'lote diferente: nao_aplicado');
  perform pg_temp.ok((select f.atacado from public.familias f where f.id = '95000000-0000-0000-0000-000000000353') = '[{"min_unidades":3,"desconto_pct":7}]'::jsonb, 'lote diferente: intacto');

  -- Linha pedida NULL, `esperado` vindo do lote antigo: a edição alcança e grava as duas.
  update public.familias set atacado = null where id = pg_temp.fid(17);
  perform pg_temp.op(e6, 17);
  perform public.reajuste_atacado_concluir(v_org, e6);
  perform pg_temp.ok(pg_temp.fam(17) = v_dez and (select f.atacado from public.familias f where f.id = '95000000-0000-0000-0000-000000000355') = v_dez, 'canônica NULL: grava todas');
  insert into public.operacoes_massa (id, org_id, acao, status, origem_id, atacado_familias) values
    (e7, v_org, 'reajustar', 'executando', e6, jsonb_build_array(jsonb_build_object('familia_id', pg_temp.fid(17), 'novo', v_cinco, 'esperado', v_dez, 'status', 'pendente', 'motivo', null,
      'restaurar', pg_temp.ent(e6)->'anteriores')));
  insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, preco, codigo_pai, passos) values
    (e7, v_org, 'MLB17A', 'aplicado', 100, '09500017', pg_temp.passos('confirmado'));
  perform public.reajuste_atacado_concluir(v_org, e7);
  perform pg_temp.ok(pg_temp.fam(17) is null and (select f.atacado from public.familias f where f.id = '95000000-0000-0000-0000-000000000355') = v_cinco, 'canônica NULL: Reverter restaura cada linha');

  -- Cor própria em outra linha do produto reprova.
  perform pg_temp.op(e3, 14);
  perform public.reajuste_atacado_concluir(v_org, e3);
  perform pg_temp.ok(pg_temp.fam(14) = v_cinco and pg_temp.ent(e3)->>'motivo' = 'Atacado por cor: ajuste na Revisão', 'cor em outra linha: nao_aplicado');

  -- Operação concluída com entrada pendente: segue reservando; o Retomar conclui e solta.
  perform pg_temp.op(e4, 15, 'concluida');
  perform pg_temp.ok(public.reajuste_ativo_produto(v_org, '09500015') is not null, 'concluída com pendente reserva');
  perform public.reajuste_atacado_concluir(v_org, e4);
  perform pg_temp.ok(pg_temp.fam(15) = v_dez and pg_temp.ent(e4)->>'status' = 'aplicado', 'concluída: conclui a família');
  perform pg_temp.ok(public.reajuste_ativo_produto(v_org, '09500015') is null, 'concluída: solta a reserva');

  -- Recusa definitiva na volta soma; sem o sinal, não.
  update public.operacoes_massa_itens set status = 'enviando', lease_token = v_tok, passos = pg_temp.passos('volta_pedida') where operacao_id = e4 and ml_item_id = 'MLB15A';
  perform pg_temp.ok(public.reajuste_passo_marcar(v_org, e4, 'MLB15A', v_tok, 0, 'volta_pendente', true), 'recusa marca');
  perform pg_temp.ok(public.reajuste_passo_marcar(v_org, e4, 'MLB15A', v_tok, 0, 'volta_pedida'), 'volta pedida marca');
  perform pg_temp.ok(public.reajuste_passo_marcar(v_org, e4, 'MLB15A', v_tok, 0, 'volta_pendente'), 'reconciliação marca');
  perform pg_temp.ok(public.reajuste_passo_marcar(v_org, e4, 'MLB15A', v_tok, 0, 'volta_pendente', true), 'segunda recusa marca');
  select * into v_i from public.operacoes_massa_itens i where i.operacao_id = e4 and i.ml_item_id = 'MLB15A';
  perform pg_temp.ok((v_i.passos->0->>'recusas_volta')::int = 2 and v_i.passos->0->>'estado' = 'volta_pendente', 'só a recusa conta');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.reajuste_passo_marcar(uuid, uuid, text, uuid, integer, text, boolean)', 'execute'), 'marcar sem authenticated');
  perform pg_temp.ok(has_function_privilege('service_role', 'public.reajuste_passo_marcar(uuid, uuid, text, uuid, integer, text, boolean)', 'execute'), 'marcar com service_role');
end $$;

-- Confirmar: família parcial e dona da edição.
do $$
declare
  v_org uuid := '95000000-0000-0000-0000-000000000001';
  c1 uuid := '95000000-0000-0000-0000-000000000701'; c2 uuid := '95000000-0000-0000-0000-000000000702';
  c3 uuid := '95000000-0000-0000-0000-000000000703';
  v_t text;
begin
  perform pg_temp.op(c1, 10, 'rascunho');
  perform pg_temp.ok(public.reajuste_ativo_produto(v_org, '09500010') is null, 'rascunho não reserva');
  v_t := public.reajuste_confirmar(v_org, c1, '[{"ml_item_id":"MLB10B","incluir":false}]'::jsonb);
  perform pg_temp.ok(v_t = 'familia_parcial:' || pg_temp.fid(10), 'MLB desmarcado → familia_parcial: ' || v_t);
  perform pg_temp.ok((select status from public.operacoes_massa where id = c1) = 'rascunho', 'parcial não confirma');
  v_t := public.reajuste_confirmar(v_org, c1, '[]'::jsonb);
  perform pg_temp.ok(v_t = 'ok', 'família inteira → A confirma: ' || v_t);
  perform pg_temp.ok(public.reajuste_ativo_produto(v_org, '09500010') is not null, 'confirmada: reserva ativa');

  -- Edição recusa produto com reajuste ativo de outra operação, mesmo em MLB que ela não toca.
  perform pg_temp.op(c2, 11, 'rascunho');
  insert into public.operacoes_massa (id, org_id, acao, status) values (c3, v_org, 'reajustar', 'executando');
  insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, preco, codigo_pai, passos) values
    (c3, v_org, 'MLB11C', 'pendente', 100, '09500011', pg_temp.passos('pendente'));
  v_t := public.reajuste_confirmar(v_org, c2, '[]'::jsonb);
  perform pg_temp.ok(v_t = 'ocupado:MLB11C', 'edição espera o outro reajuste do produto: ' || v_t);

  -- Anúncio publicado depois do preview: o rascunho não cobre a família, expira.
  perform pg_temp.op('95000000-0000-0000-0000-000000000704', 19, 'rascunho');
  v_t := public.reajuste_confirmar(v_org, '95000000-0000-0000-0000-000000000704', '[]'::jsonb);
  perform pg_temp.ok(v_t = 'ok', 'rascunho cobre os anúncios atuais: ' || v_t);
  perform pg_temp.op('95000000-0000-0000-0000-000000000705', 20, 'rascunho');
  v_t := public.reajuste_confirmar(v_org, '95000000-0000-0000-0000-000000000705', '[]'::jsonb);
  perform pg_temp.ok(v_t = 'expirado', 'anúncio novo fora do rascunho: ' || v_t);
  perform pg_temp.ok((select status from public.operacoes_massa where id = '95000000-0000-0000-0000-000000000705') = 'rascunho', 'expirado não confirma');

  -- Grants e search_path.
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.reajuste_atacado_concluir(uuid, uuid)', 'execute'), 'concluir sem authenticated');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.reajuste_atacado_dona(uuid, text)', 'execute'), 'dona sem anon');
  perform pg_temp.ok(has_function_privilege('service_role', 'public.reajuste_atacado_concluir(uuid, uuid)', 'execute'), 'concluir com service_role');
  perform pg_temp.ok((select p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'public.reajuste_atacado_concluir(uuid, uuid)'::regprocedure), 'search_path vazio');
end $$;

rollback;
