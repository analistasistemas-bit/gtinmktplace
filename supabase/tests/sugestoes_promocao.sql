\set ON_ERROR_STOP on
-- ADR-0194: sinais por anúncio da aba Sugestões. Datas relativas a hoje (BRT): nunca data fixa na janela.
begin;
insert into public.organizations (id, nome, slug) values
  ('96000000-0000-0000-0000-000000000001', 'Sugestoes test', 'sugestoes-test'),
  ('96000000-0000-0000-0000-000000000002', 'Outra org sugestoes', 'outra-org-sugestoes');
insert into auth.users (id, email, raw_user_meta_data) values
  ('96000000-0000-0000-0000-000000000101', 'sugestoes@test.local', '{"org_id":"96000000-0000-0000-0000-000000000001"}'::jsonb),
  ('96000000-0000-0000-0000-000000000102', 'outra-sugestoes@test.local', '{"org_id":"96000000-0000-0000-0000-000000000002"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', true),
  ('96000000-0000-0000-0000-000000000102', '96000000-0000-0000-0000-000000000002', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;

-- Visitas: 2 dias ok e 1 pendente no MLBS1; outra org com volume alto.
insert into public.ml_item_visitas_dia (org_id, ml_item_id, dia, visitas, estado, coletado_em, rodada)
select '96000000-0000-0000-0000-000000000001', 'MLBS1', (now() at time zone 'America/Sao_Paulo')::date - d, v, e, now(), now()
from (values (2, 100, 'ok'), (3, 50, 'ok'), (1, 70, 'pendente')) x(d, v, e);
insert into public.ml_item_visitas_dia (org_id, ml_item_id, dia, visitas, estado, coletado_em, rodada)
values ('96000000-0000-0000-0000-000000000002', 'MLBO1', (now() at time zone 'America/Sao_Paulo')::date - 2, 999, 'ok', now(), now());

-- Vendas: 2 un. em dia ok, 3 un. em dia pendente, 1 cancelada (não conta), 1 fora da janela.
insert into public.ml_vendas (id, user_id, org_id, order_id, status, date_closed) values
  ('96000000-0000-0000-0000-00000000a001', '96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', 9600001, 'paid', now() - interval '2 days'),
  ('96000000-0000-0000-0000-00000000a002', '96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', 9600002, 'paid', now() - interval '1 day'),
  ('96000000-0000-0000-0000-00000000a003', '96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', 9600003, 'cancelled', now() - interval '2 days'),
  ('96000000-0000-0000-0000-00000000a004', '96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', 9600004, 'paid', now() - interval '40 days');
insert into public.ml_vendas_itens (user_id, org_id, venda_id, ml_item_id, variation_id, codigo, quantity, unit_price) values
  ('96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-00000000a001', 'MLBS1', null, null, 2, 50),
  ('96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-00000000a002', 'MLBS1', null, null, 3, 50),
  ('96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-00000000a003', 'MLBS1', null, null, 9, 50),
  ('96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-00000000a004', 'MLBS1', null, null, 9, 50);

-- Produto via familias.ml_item_id, com variação de estoque 7.
insert into public.lotes (id, user_id, org_id, numero) values
  ('96000000-0000-0000-0000-00000000c001', '96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', 960001);
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, ml_item_id, publicado_em) values
  ('96000000-0000-0000-0000-00000000b001', '96000000-0000-0000-0000-00000000c001', '96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', 'PAI1', 'Produto Teste', 'CREATE', 'MLBS1', now() - interval '90 days');
insert into public.variacoes (id, familia_id, user_id, org_id, codigo, nome, preco, estoque) values
  ('96000000-0000-0000-0000-00000000b101', '96000000-0000-0000-0000-00000000b001', '96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', 'SKU1', 'Variação', 10, 7);

set local role authenticated;
set local request.jwt.claims = '{"sub":"96000000-0000-0000-0000-000000000101","role":"authenticated"}';

do $$
declare s json; n int;
begin
  select count(*) into n from public.sugestoes_promocao_sinais();
  if n is distinct from 1 then raise exception 'linhas (vazou outra org?) %', n; end if;
  select x into s from public.sugestoes_promocao_sinais() x;
  if s->>'ml_item_id' is distinct from 'MLBS1' then raise exception 'mlb %', s; end if;
  if (s->>'visitas_ok')::int is distinct from 150 then raise exception 'visitas_ok (pendente não conta) %', s; end if;
  if (s->>'dias_ok')::int is distinct from 2 then raise exception 'dias_ok %', s; end if;
  if (s->>'unidades_30d')::int is distinct from 5 then raise exception 'unidades_30d (cancelada e fora da janela não contam) %', s; end if;
  if (s->>'unidades_ok')::int is distinct from 2 then raise exception 'unidades_ok (só dias ok) %', s; end if;
  if s->>'codigo_pai' is distinct from 'PAI1' or s->>'nome_produto' is distinct from 'Produto Teste' then raise exception 'produto %', s; end if;
  if (s->>'estoque_produto')::int is distinct from 7 then raise exception 'estoque %', s; end if;
  if (s->>'ativo')::boolean is distinct from true then raise exception 'ativo (status desconhecido) %', s; end if;
  if s->>'criado_em' is null then raise exception 'criado_em %', s; end if;
end $$;

-- Tabela de dispensas: cliente não escreve nem trunca.
do $$
begin
  begin
    insert into public.promocao_sugestoes_dispensadas (org_id, chave, expira_em)
    values ('96000000-0000-0000-0000-000000000001', 'p:PAI1', now());
    raise exception 'insert deveria ser negado';
  exception when insufficient_privilege then null;
  end;
  begin
    truncate public.promocao_sugestoes_dispensadas;
    raise exception 'truncate deveria ser negado';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
