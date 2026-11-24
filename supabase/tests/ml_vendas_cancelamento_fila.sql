-- ADR-0211: trigger que só arma e as 3 RPCs da fila de cancelamento, no ESQUEMA DE ENSAIO.
-- Nenhuma tabela real é lida para fixture, escrita ou alterada. Ver o plano, Task 1:
--   sed 's/public\./ensaio_adr0211./g' supabase/migrations/20261124091308_ml_vendas_cancelamento_fila.sql > /tmp/mig_ensaio.sql
--   python3 scripts/teste-sql-desfeito.py supabase/tests/ml_vendas_cancelamento_fila.sql \
--     supabase/tests/ml_vendas_cancelamento_fila.preludio.sql /tmp/mig_ensaio.sql
-- Vermelho: o mesmo comando só com o prelúdio (sem /tmp/mig_ensaio.sql) tem de falhar.
\set ON_ERROR_STOP on
begin;

-- ── helpers (criados como postgres; chamados como service_role) ─────────────────────────────
create function ensaio_adr0211.v(n int) returns text language sql immutable as
  $$ select format('2026-11-20T10:00:%s.000-04:00', lpad(n::text, 2, '0')) $$;
create function ensaio_adr0211.cru(st text, n int) returns jsonb language sql immutable as
  $$ select jsonb_build_object('status', st, 'last_updated', ensaio_adr0211.v(n)) $$;
create function ensaio_adr0211.org(n int) returns uuid language sql immutable as
  $$ select format('a0211000-0000-0000-0000-%s', lpad(n::text, 12, '0'))::uuid $$;
create function ensaio_adr0211.ok(c boolean, msg text) returns void language plpgsql as
  $$ begin if c is not true then raise exception 'FALHOU %', msg; end if; end $$;
-- Venda nova (insert não arma) e gravação posterior de raw (o trigger decide).
create function ensaio_adr0211.nova(o int, pedido bigint, st text, n int) returns uuid language sql as $$
  insert into ensaio_adr0211.ml_vendas (user_id, org_id, order_id, status, raw)
  values ('a0211000-0000-0000-0000-0000000000a1', ensaio_adr0211.org(o), pedido, st, ensaio_adr0211.cru(st, n))
  returning id $$;
create function ensaio_adr0211.gravar(vid uuid, st text, n int) returns void language sql as $$
  update ensaio_adr0211.ml_vendas set status = st, raw = ensaio_adr0211.cru(st, n) where id = vid $$;
-- Venda paid → cancelled@n (arma), com armado_em envelhecido para passar da carência de 5 min.
create function ensaio_adr0211.armada(o int, pedido bigint, n int default 30) returns uuid language plpgsql as $$
declare vid uuid;
begin
  vid := ensaio_adr0211.nova(o, pedido, 'paid', 1);
  perform ensaio_adr0211.gravar(vid, 'cancelled', n);
  update ensaio_adr0211.ml_vendas set cancelamento_armado_em = clock_timestamp() - interval '10 minutes' where id = vid;
  return vid;
end $$;
create function ensaio_adr0211.rodada(o int, lote text, est text default 'rodando') returns void language sql as $$
  delete from ensaio_adr0211.worker_rodadas where job = 'reconciliar' and org_id = ensaio_adr0211.org(o);
  insert into ensaio_adr0211.worker_rodadas (job, org_id, ciclo, estado, params, iniciado_em)
  values ('reconciliar', ensaio_adr0211.org(o), 'c', est, jsonb_build_object('ate', lote), now()) $$;
create function ensaio_adr0211.reivindicar(o int, lote text, lim int default 20, car interval default '5 minutes')
returns setof uuid language sql as $$
  select r.id from ensaio_adr0211.reivindicar_cancelamentos(ensaio_adr0211.org(o), lote, lim, car) r $$;
create function ensaio_adr0211.no_lote(o int, lote text) returns int language sql as $$
  select count(*)::int from ensaio_adr0211.ml_vendas where org_id = ensaio_adr0211.org(o) and cancelamento_lote = lote $$;
create function ensaio_adr0211.registrar(o int, vid uuid, g uuid, concluir boolean, desfecho text, lido timestamptz)
returns int language sql as $$
  select ensaio_adr0211.registrar_cancelamentos_tratados(ensaio_adr0211.org(o), jsonb_build_array(jsonb_build_object(
    'id', vid, 'geracao', g, 'concluir', concluir, 'desfecho', desfecho, 'lido_em', lido))) $$;
create function ensaio_adr0211.baixa(o int, pedido bigint, cod text, qtd int, quando timestamptz default now(), cod_col text default null)
returns void language sql as $$
  insert into ensaio_adr0211.estoque_movimentos (org_id, codigo, quantidade, motivo, referencia_externa, criado_em)
  values (ensaio_adr0211.org(o), coalesce(cod_col, cod), -qtd, 'venda', format('mercado_livre:%s:%s', pedido, cod), quando) $$;
create function ensaio_adr0211.estorno(o int, pedido bigint, cod text, qtd int, mot text default 'estorno_venda', quando timestamptz default now())
returns void language sql as $$
  insert into ensaio_adr0211.estoque_movimentos (org_id, codigo, quantidade, motivo, referencia_externa, criado_em)
  values (ensaio_adr0211.org(o), cod, qtd, mot, format('estorno:mercado_livre:%s:%s', pedido, cod), quando) $$;
create function ensaio_adr0211.linha(vid uuid) returns ensaio_adr0211.ml_vendas language sql as
  $$ select * from ensaio_adr0211.ml_vendas where id = vid $$;

grant execute on all functions in schema ensaio_adr0211 to service_role;
set local role service_role;

-- ── Trigger ────────────────────────────────────────────────────────────────────────────────
do $$
declare vid uuid; l ensaio_adr0211.ml_vendas; g uuid;
begin
  -- S1: venda inédita já cancelada não arma (só update).
  vid := ensaio_adr0211.nova(1, 101, 'cancelled', 30);
  perform ensaio_adr0211.ok((ensaio_adr0211.linha(vid)).cancelamento_geracao is null, 'S1 insert cancelado não arma');

  -- S2: paid → cancelled@30 arma.
  vid := ensaio_adr0211.nova(1, 102, 'paid', 1);
  perform ensaio_adr0211.gravar(vid, 'cancelled', 30);
  l := ensaio_adr0211.linha(vid);
  perform ensaio_adr0211.ok(l.cancelamento_geracao is not null and l.cancelamento_versao = ensaio_adr0211.v(30)
    and l.cancelamento_armado_em is not null and l.cancelamento_tentativas = 0 and l.cancelamento_concluido_em is null, 'S2 arma');

  -- S2b: forma do upsertVenda.
  vid := ensaio_adr0211.nova(1, 103, 'paid', 1);
  insert into ensaio_adr0211.ml_vendas (user_id, org_id, order_id, status, raw)
  values ('a0211000-0000-0000-0000-0000000000a1', ensaio_adr0211.org(1), 103, 'cancelled', ensaio_adr0211.cru('cancelled', 30))
  on conflict (user_id, order_id) do update set status = excluded.status, raw = excluded.raw;
  perform ensaio_adr0211.ok((ensaio_adr0211.linha(vid)).cancelamento_geracao is not null, 'S2b upsert arma');

  -- S3: só a coluna status não arma; depois raw arma.
  vid := ensaio_adr0211.nova(1, 104, 'paid', 1);
  update ensaio_adr0211.ml_vendas set status = 'cancelled' where id = vid;
  perform ensaio_adr0211.ok((ensaio_adr0211.linha(vid)).cancelamento_geracao is null, 'S3 só status não arma');
  update ensaio_adr0211.ml_vendas set raw = ensaio_adr0211.cru('cancelled', 30) where id = vid;
  perform ensaio_adr0211.ok((ensaio_adr0211.linha(vid)).cancelamento_geracao is not null, 'S3 raw arma');

  -- S4: cancelled@30 → cancelled@10 → paid@20: geração e versão do @30.
  vid := ensaio_adr0211.nova(1, 105, 'paid', 1);
  perform ensaio_adr0211.gravar(vid, 'cancelled', 30);
  g := (ensaio_adr0211.linha(vid)).cancelamento_geracao;
  perform ensaio_adr0211.gravar(vid, 'cancelled', 10);
  perform ensaio_adr0211.gravar(vid, 'paid', 20);
  l := ensaio_adr0211.linha(vid);
  perform ensaio_adr0211.ok(l.cancelamento_geracao = g and l.cancelamento_versao = ensaio_adr0211.v(30)
    and l.cancelamento_concluido_em is null, 'S4 leitura velha não mexe');

  -- S5: cancelled@30 → paid@10 → paid@40: nunca desarma.
  vid := ensaio_adr0211.nova(1, 106, 'paid', 1);
  perform ensaio_adr0211.gravar(vid, 'cancelled', 30);
  g := (ensaio_adr0211.linha(vid)).cancelamento_geracao;
  perform ensaio_adr0211.gravar(vid, 'paid', 10);
  perform ensaio_adr0211.gravar(vid, 'paid', 40);
  l := ensaio_adr0211.linha(vid);
  perform ensaio_adr0211.ok(l.cancelamento_geracao = g and l.cancelamento_versao = ensaio_adr0211.v(30)
    and l.cancelamento_concluido_em is null, 'S5 nunca desarma');

  -- S6: pendente @30 com tentativas e lote; paid → cancelled@30: nada muda.
  vid := ensaio_adr0211.nova(1, 107, 'paid', 1);
  perform ensaio_adr0211.gravar(vid, 'cancelled', 30);
  update ensaio_adr0211.ml_vendas set cancelamento_tentativas = 3, cancelamento_lote = 'LX' where id = vid;
  g := (ensaio_adr0211.linha(vid)).cancelamento_geracao;
  perform ensaio_adr0211.gravar(vid, 'paid', 30);
  perform ensaio_adr0211.gravar(vid, 'cancelled', 30);
  l := ensaio_adr0211.linha(vid);
  perform ensaio_adr0211.ok(l.cancelamento_geracao = g and l.cancelamento_versao = ensaio_adr0211.v(30)
    and l.cancelamento_tentativas = 3 and l.cancelamento_lote = 'LX', 'S6 mesma versão não muda');

  -- S6b: concluída @30 com lote L1; paid → cancelled@50: geração nova, pendente, lote mantido.
  vid := ensaio_adr0211.nova(1, 108, 'paid', 1);
  perform ensaio_adr0211.gravar(vid, 'cancelled', 30);
  update ensaio_adr0211.ml_vendas set cancelamento_lote = 'L1', cancelamento_tentativas = 2,
    cancelamento_concluido_em = now(), cancelamento_desfecho = 'avisado' where id = vid;
  g := (ensaio_adr0211.linha(vid)).cancelamento_geracao;
  perform ensaio_adr0211.gravar(vid, 'paid', 40);
  perform ensaio_adr0211.gravar(vid, 'cancelled', 50);
  l := ensaio_adr0211.linha(vid);
  perform ensaio_adr0211.ok(l.cancelamento_geracao <> g and l.cancelamento_versao = ensaio_adr0211.v(50)
    and l.cancelamento_concluido_em is null and l.cancelamento_tentativas = 0 and l.cancelamento_lote = 'L1', 'S6b rearma');

  -- S6d: concluída @30; paid@10 → cancelled@30: continua concluída.
  vid := ensaio_adr0211.nova(1, 109, 'paid', 1);
  perform ensaio_adr0211.gravar(vid, 'cancelled', 30);
  update ensaio_adr0211.ml_vendas set cancelamento_concluido_em = now() where id = vid;
  g := (ensaio_adr0211.linha(vid)).cancelamento_geracao;
  perform ensaio_adr0211.gravar(vid, 'paid', 10);
  perform ensaio_adr0211.gravar(vid, 'cancelled', 30);
  l := ensaio_adr0211.linha(vid);
  perform ensaio_adr0211.ok(l.cancelamento_geracao = g and l.cancelamento_concluido_em is not null, 'S6d mesma versão não reabre');

  -- S6c: sem last_updated, ou ilegível: arma e o update não falha.
  vid := ensaio_adr0211.nova(1, 110, 'paid', 1);
  update ensaio_adr0211.ml_vendas set raw = '{"status":"cancelled"}' where id = vid;
  l := ensaio_adr0211.linha(vid);
  perform ensaio_adr0211.ok(l.cancelamento_geracao is not null and l.cancelamento_versao is null, 'S6c sem versão');
  vid := ensaio_adr0211.nova(1, 111, 'paid', 1);
  update ensaio_adr0211.ml_vendas set raw = '{"status":"cancelled","last_updated":"ontem"}' where id = vid;
  l := ensaio_adr0211.linha(vid);
  perform ensaio_adr0211.ok(l.cancelamento_geracao is not null and l.cancelamento_versao = 'ontem', 'S6c versão ilegível');

  -- S17: pendente G1 @30; cancelled → cancelled@50: geração nova, armado/tentativas/lote preservados; registrar G1 = 0.
  vid := ensaio_adr0211.nova(1, 112, 'paid', 1);
  perform ensaio_adr0211.gravar(vid, 'cancelled', 30);
  update ensaio_adr0211.ml_vendas set cancelamento_tentativas = 2, cancelamento_lote = 'LX',
    cancelamento_armado_em = '2026-11-01T00:00:00Z' where id = vid;
  g := (ensaio_adr0211.linha(vid)).cancelamento_geracao;
  perform ensaio_adr0211.gravar(vid, 'cancelled', 50);
  l := ensaio_adr0211.linha(vid);
  perform ensaio_adr0211.ok(l.cancelamento_geracao <> g and l.cancelamento_versao = ensaio_adr0211.v(50)
    and l.cancelamento_armado_em = '2026-11-01T00:00:00Z' and l.cancelamento_tentativas = 2 and l.cancelamento_lote = 'LX', 'S17 renova geração');
  perform ensaio_adr0211.ok(ensaio_adr0211.registrar(1, vid, g, true, 'nao-cancelado', now()) = 0, 'S17 registrar com G1 = 0');
  perform ensaio_adr0211.ok((ensaio_adr0211.linha(vid)).cancelamento_concluido_em is null, 'S17 segue pendente');

  -- S18: pendente @30; cancelled@10: nada muda.
  vid := ensaio_adr0211.nova(1, 113, 'paid', 1);
  perform ensaio_adr0211.gravar(vid, 'cancelled', 30);
  g := (ensaio_adr0211.linha(vid)).cancelamento_geracao;
  perform ensaio_adr0211.gravar(vid, 'cancelled', 10);
  l := ensaio_adr0211.linha(vid);
  perform ensaio_adr0211.ok(l.cancelamento_geracao = g and l.cancelamento_versao = ensaio_adr0211.v(30), 'S18 mais velho não muda');

  -- S19: concluída nao-cancelado @30; cancelled → cancelled@50 sem passar por paid: rearma.
  vid := ensaio_adr0211.nova(1, 114, 'paid', 1);
  perform ensaio_adr0211.gravar(vid, 'cancelled', 30);
  update ensaio_adr0211.ml_vendas set cancelamento_concluido_em = now(), cancelamento_desfecho = 'nao-cancelado' where id = vid;
  g := (ensaio_adr0211.linha(vid)).cancelamento_geracao;
  perform ensaio_adr0211.gravar(vid, 'cancelled', 50);
  l := ensaio_adr0211.linha(vid);
  perform ensaio_adr0211.ok(l.cancelamento_geracao <> g and l.cancelamento_concluido_em is null, 'S19 rearma');

  -- S14: acervo do prelúdio (pedido 7001, cancelado antes da migration) não arma, nem com versão mais nova.
  vid := (select id from ensaio_adr0211.ml_vendas where order_id = 7001);
  perform ensaio_adr0211.ok((ensaio_adr0211.linha(vid)).cancelamento_geracao is null, 'S14 acervo sem geração');
  perform ensaio_adr0211.gravar(vid, 'cancelled', 59);
  perform ensaio_adr0211.ok((ensaio_adr0211.linha(vid)).cancelamento_geracao is null, 'S14 acervo regravado não arma');
end $$;

-- ── reivindicar_cancelamentos ──────────────────────────────────────────────────────────────
do $$
declare a uuid[]; b uuid[]; ids uuid[]; vid uuid; n int; g uuid;
begin
  -- S7: org 2, 25 armadas; duas chamadas com L1 devolvem os mesmos 20; 5 sem lote.
  for i in 1..25 loop perform ensaio_adr0211.armada(2, 200 + i); end loop;
  perform ensaio_adr0211.rodada(2, 'L1');
  a := array(select x from ensaio_adr0211.reivindicar(2, 'L1') x order by 1);
  b := array(select x from ensaio_adr0211.reivindicar(2, 'L1') x order by 1);
  perform ensaio_adr0211.ok(cardinality(a) = 20 and a = b, 'S7 mesmos 20');
  perform ensaio_adr0211.ok((select count(*) from ensaio_adr0211.ml_vendas where org_id = ensaio_adr0211.org(2) and cancelamento_lote is null) = 5, 'S7 5 sem lote');

  -- S7b: conclui 3, as outras 17 viram tentadas sem concluir; L1 devolve as 17, nenhuma nova.
  for i in 1..20 loop
    select cancelamento_geracao into g from ensaio_adr0211.ml_vendas where id = a[i];
    perform ensaio_adr0211.registrar(2, a[i], g, i <= 3, case when i <= 3 then 'sem-baixa-aberta' else 'ml: x' end, now());
  end loop;
  b := array(select x from ensaio_adr0211.reivindicar(2, 'L1') x order by 1);
  perform ensaio_adr0211.ok(cardinality(b) = 17 and b <@ a and ensaio_adr0211.no_lote(2, 'L1') = 20, 'S7b 17 restantes');

  -- S7c: L2 devolve 20, com as 5 nunca tentadas.
  perform ensaio_adr0211.rodada(2, 'L2');
  b := array(select x from ensaio_adr0211.reivindicar(2, 'L2') x);
  perform ensaio_adr0211.ok(cardinality(b) = 20, 'S7c 20 no L2');
  perform ensaio_adr0211.ok((select count(*) from ensaio_adr0211.ml_vendas where id = any(b) and cancelamento_tentado_em is null) = 5, 'S7c as 5 nunca tentadas primeiro');

  -- S7d: armada há 1 minuto não é reivindicada.
  vid := ensaio_adr0211.nova(2, 299, 'paid', 1);
  perform ensaio_adr0211.gravar(vid, 'cancelled', 30);
  perform ensaio_adr0211.rodada(2, 'L3');
  b := array(select x from ensaio_adr0211.reivindicar(2, 'L3') x);
  perform ensaio_adr0211.ok(not (vid = any(b)), 'S7d carência');

  -- S8: tentativas = 30 continua reivindicável.
  update ensaio_adr0211.ml_vendas set cancelamento_tentativas = 30, cancelamento_armado_em = clock_timestamp() - interval '1 hour' where id = vid;
  perform ensaio_adr0211.rodada(2, 'L4');
  b := array(select x from ensaio_adr0211.reivindicar(2, 'L4') x);
  perform ensaio_adr0211.ok(vid = any(b), 'S8 sem descarte por tentativas');

  -- S7e: org 3, lote L1 cheio; uma rearmada e outra reaberta por baixa posterior: continua 20, nenhuma 21ª.
  for i in 1..25 loop perform ensaio_adr0211.armada(3, 300 + i); end loop;
  perform ensaio_adr0211.rodada(3, 'L1');
  a := array(select x from ensaio_adr0211.reivindicar(3, 'L1') x order by 1);
  for i in 1..2 loop
    select cancelamento_geracao into g from ensaio_adr0211.ml_vendas where id = a[i];
    perform ensaio_adr0211.registrar(3, a[i], g, true, 'sem-baixa-aberta', now());
  end loop;
  perform ensaio_adr0211.gravar(a[1], 'paid', 40);
  perform ensaio_adr0211.gravar(a[1], 'cancelled', 50);
  perform ensaio_adr0211.baixa(3, (select order_id from ensaio_adr0211.ml_vendas where id = a[2]), 'X', 1, clock_timestamp());
  update ensaio_adr0211.ml_vendas set cancelamento_armado_em = clock_timestamp() - interval '10 minutes' where id = a[1];
  b := array(select x from ensaio_adr0211.reivindicar(3, 'L1') x);
  perform ensaio_adr0211.ok((ensaio_adr0211.linha(a[2])).cancelamento_concluido_em is null, 'S7e reaberta');
  perform ensaio_adr0211.ok(ensaio_adr0211.no_lote(3, 'L1') = 20, 'S7e teto 20');
  perform ensaio_adr0211.ok((select count(*) from ensaio_adr0211.ml_vendas where org_id = ensaio_adr0211.org(3) and cancelamento_lote is null) = 5, 'S7e nenhuma 21ª');

  -- S7f: org 4, 12 no L1; mais 15 passam da carência: entram 8.
  for i in 1..12 loop perform ensaio_adr0211.armada(4, 400 + i); end loop;
  perform ensaio_adr0211.rodada(4, 'L1');
  perform ensaio_adr0211.reivindicar(4, 'L1', 12);
  perform ensaio_adr0211.ok(ensaio_adr0211.no_lote(4, 'L1') = 12, 'S7f 12');
  for i in 13..27 loop perform ensaio_adr0211.armada(4, 400 + i); end loop;
  b := array(select x from ensaio_adr0211.reivindicar(4, 'L1') x);
  perform ensaio_adr0211.ok(cardinality(b) = 20 and ensaio_adr0211.no_lote(4, 'L1') = 20, 'S7f total 20');

  -- S7g: org 5, execução atrasada do L1 depois que a rodada passou ao L2: 0 linhas, nada marcado.
  for i in 1..25 loop perform ensaio_adr0211.armada(5, 500 + i); end loop;
  perform ensaio_adr0211.rodada(5, 'L1');
  perform ensaio_adr0211.reivindicar(5, 'L1');
  perform ensaio_adr0211.rodada(5, 'L2');
  perform ensaio_adr0211.reivindicar(5, 'L2');
  n := ensaio_adr0211.no_lote(5, 'L1');
  b := array(select x from ensaio_adr0211.reivindicar(5, 'L1') x);
  perform ensaio_adr0211.ok(cardinality(b) = 0 and ensaio_adr0211.no_lote(5, 'L1') = n, 'S7g atrasada não marca');

  -- S7h: org 6, rodada não `rodando`, ou sem rodada: 0 linhas, nada marcado.
  perform ensaio_adr0211.armada(6, 601);
  perform ensaio_adr0211.rodada(6, 'L1', 'ok');
  b := array(select x from ensaio_adr0211.reivindicar(6, 'L1') x);
  perform ensaio_adr0211.ok(cardinality(b) = 0 and ensaio_adr0211.no_lote(6, 'L1') = 0, 'S7h rodada ok');
  delete from ensaio_adr0211.worker_rodadas where org_id = ensaio_adr0211.org(6);
  b := array(select x from ensaio_adr0211.reivindicar(6, 'L1') x);
  perform ensaio_adr0211.ok(cardinality(b) = 0 and ensaio_adr0211.no_lote(6, 'L1') = 0, 'S7h sem rodada');
end $$;

-- ── registrar_cancelamentos_tratados ───────────────────────────────────────────────────────
do $$
declare vid uuid; g uuid; l ensaio_adr0211.ml_vendas; t timestamptz := '2026-11-24T12:00:00Z';
begin
  -- S9: com a geração lida conclui com o instante do ledger.
  vid := ensaio_adr0211.armada(8, 801);
  g := (ensaio_adr0211.linha(vid)).cancelamento_geracao;
  perform ensaio_adr0211.ok(ensaio_adr0211.registrar(8, vid, g, true, 'reposto', t) = 1, 'S9 devolve 1');
  l := ensaio_adr0211.linha(vid);
  perform ensaio_adr0211.ok(l.cancelamento_concluido_em = t and l.cancelamento_desfecho = 'reposto'
    and l.cancelamento_tentativas = 1, 'S9 concluída');

  -- S10: G1 lida; concluída e rearmada (G2); registrar com G1 (true e false) = 0; G2 segue pendente.
  vid := ensaio_adr0211.armada(8, 802);
  g := (ensaio_adr0211.linha(vid)).cancelamento_geracao;
  perform ensaio_adr0211.registrar(8, vid, g, true, 'avisado', t);
  perform ensaio_adr0211.gravar(vid, 'cancelled', 50);
  perform ensaio_adr0211.ok(ensaio_adr0211.registrar(8, vid, g, true, 'avisado', t) = 0, 'S10 G1 true = 0');
  perform ensaio_adr0211.ok(ensaio_adr0211.registrar(8, vid, g, false, 'erro', t) = 0, 'S10 G1 false = 0');
  l := ensaio_adr0211.linha(vid);
  perform ensaio_adr0211.ok(l.cancelamento_geracao <> g and l.cancelamento_concluido_em is null
    and l.cancelamento_tentativas = 0, 'S10 G2 pendente');
end $$;

-- ── cancelamento_baixas ────────────────────────────────────────────────────────────────────
do $$
declare r record; o uuid := ensaio_adr0211.org(9);
begin
  perform ensaio_adr0211.baixa(9, 901, 'A', 1);                              -- (a) aberta
  perform ensaio_adr0211.baixa(9, 902, 'B', 2);                              -- (b) estornada
  perform ensaio_adr0211.estorno(9, 902, 'B', 2);
  perform ensaio_adr0211.baixa(9, 903, 'C', 1);                              -- (c) estorno com quantidade 0
  perform ensaio_adr0211.estorno(9, 903, 'C', 0, 'estorno_sku_nao_encontrado');
  insert into ensaio_adr0211.estoque_movimentos (org_id, codigo, quantidade, motivo, referencia_externa)
  values (o, 'D', 0, 'cancelamento_sem_baixa', 'mercado_livre:904:D');       -- (d) só tombstone
  perform ensaio_adr0211.baixa(9, 905, 'KIT1', 1, now(), 'COMP1');           -- (e) kit: coluna codigo ≠ referência
  perform ensaio_adr0211.baixa(9, 906, 'ABC:01', 1);                         -- (f) código com ':'
  perform ensaio_adr0211.baixa(9, 12, 'P', 1);                               -- (g) 12 × 123
  perform ensaio_adr0211.baixa(9, 123, 'Q', 1);
  perform ensaio_adr0211.baixa(10, 901, 'OUTRA', 1);                         -- outra org, mesmo pedido

  perform ensaio_adr0211.ok((select count(*) from ensaio_adr0211.cancelamento_baixas(o, array['901','902','903','904','905','906','12','123'])
    where lido_em is null) = 0, 'S11 toda linha com lido_em');
  select * into r from ensaio_adr0211.cancelamento_baixas(o, array['901']);
  perform ensaio_adr0211.ok(r.codigo_ref = 'A' and r.quantidade = 1 and not r.estornada, 'S11a aberta');
  perform ensaio_adr0211.ok((select count(*) from ensaio_adr0211.cancelamento_baixas(o, array['901'])) = 1, 'S11 outra org fora');
  select * into r from ensaio_adr0211.cancelamento_baixas(o, array['902']);
  perform ensaio_adr0211.ok(r.codigo_ref = 'B' and r.quantidade = 2 and r.estornada, 'S11b estornada');
  select * into r from ensaio_adr0211.cancelamento_baixas(o, array['903']);
  perform ensaio_adr0211.ok(r.codigo_ref = 'C' and not r.estornada, 'S11c estorno zero não conta');
  perform ensaio_adr0211.ok((select count(*) from ensaio_adr0211.cancelamento_baixas(o, array['904']) where codigo_ref is null) = 1
    and (select count(*) from ensaio_adr0211.cancelamento_baixas(o, array['904'])) = 1, 'S11d sem baixa');
  select * into r from ensaio_adr0211.cancelamento_baixas(o, array['905']);
  perform ensaio_adr0211.ok(r.codigo_ref = 'KIT1', 'S11e código da referência');
  select * into r from ensaio_adr0211.cancelamento_baixas(o, array['906']);
  perform ensaio_adr0211.ok(r.codigo_ref = 'ABC:01', 'S11f código com dois-pontos');
  perform ensaio_adr0211.ok((select array_agg(codigo_ref) from ensaio_adr0211.cancelamento_baixas(o, array['12'])) = array['P'], 'S11g 12 sem o 123');
end $$;

-- ── Reabertura por baixa posterior ─────────────────────────────────────────────────────────
do $$
declare v1 uuid; v2 uuid; v3 uuid; g uuid; t timestamptz := clock_timestamp() - interval '1 hour';
begin
  perform ensaio_adr0211.rodada(11, 'L1');
  -- S15: concluída sem-baixa-aberta em T; baixa aberta em T + 1 min → reabre.
  v1 := ensaio_adr0211.armada(11, 1101);
  g := (ensaio_adr0211.linha(v1)).cancelamento_geracao;
  perform ensaio_adr0211.registrar(11, v1, g, true, 'sem-baixa-aberta', t);
  perform ensaio_adr0211.baixa(11, 1101, 'S', 1, t + interval '1 minute');
  -- S16: avisado em T com baixa de T − 2 dias → não reabre; com baixa estornada posterior → não reabre.
  v2 := ensaio_adr0211.armada(11, 1102);
  perform ensaio_adr0211.baixa(11, 1102, 'S', 1, t - interval '2 days');
  perform ensaio_adr0211.registrar(11, v2, (ensaio_adr0211.linha(v2)).cancelamento_geracao, true, 'avisado', t);
  v3 := ensaio_adr0211.armada(11, 1103);
  perform ensaio_adr0211.registrar(11, v3, (ensaio_adr0211.linha(v3)).cancelamento_geracao, true, 'reposto', t);
  perform ensaio_adr0211.baixa(11, 1103, 'S', 1, t + interval '1 minute');
  perform ensaio_adr0211.estorno(11, 1103, 'S', 1);

  perform ensaio_adr0211.reivindicar(11, 'L1');
  perform ensaio_adr0211.ok((ensaio_adr0211.linha(v1)).cancelamento_concluido_em is null
    and (ensaio_adr0211.linha(v1)).cancelamento_geracao <> g
    and (ensaio_adr0211.linha(v1)).cancelamento_desfecho = 'reaberto: baixa depois da conclusão'
    and (ensaio_adr0211.linha(v1)).cancelamento_armado_em > t, 'S15 reabre');
  perform ensaio_adr0211.ok((ensaio_adr0211.linha(v2)).cancelamento_concluido_em = t, 'S16 baixa antiga não reabre');
  perform ensaio_adr0211.ok((ensaio_adr0211.linha(v3)).cancelamento_concluido_em = t, 'S16 baixa estornada não reabre');
end $$;

reset role;

-- ── Catálogo e permissões ──────────────────────────────────────────────────────────────────
do $$
declare corpo text; f record;
begin
  -- S12: o trigger só atribui; sem escrita, sem conversão de tipo, security invoker.
  select lower(p.prosrc) into corpo from pg_proc p
   where p.pronamespace = 'ensaio_adr0211'::regnamespace and p.proname = 'ml_vendas_cancelamento_fila';
  perform ensaio_adr0211.ok(corpo is not null and position('insert' in corpo) = 0 and position('update ' in corpo) = 0
    and position('delete' in corpo) = 0 and position('perform' in corpo) = 0 and position('::' in corpo) = 0
    and position('cast' in corpo) = 0, 'S12 corpo do trigger');
  perform ensaio_adr0211.ok((select not prosecdef from pg_proc where pronamespace = 'ensaio_adr0211'::regnamespace
    and proname = 'ml_vendas_cancelamento_fila'), 'S12 invoker');

  -- S13: sem coluna de descarte; RPCs definer, search_path vazio, dono postgres, execute só service_role.
  perform ensaio_adr0211.ok(not exists (select 1 from information_schema.columns where table_schema = 'ensaio_adr0211'
    and table_name = 'ml_vendas' and column_name like 'cancelamento%descart%'), 'S13 sem descarte');
  perform ensaio_adr0211.ok((select count(*) from information_schema.columns where table_schema = 'ensaio_adr0211'
    and table_name = 'ml_vendas' and column_name like 'cancelamento\_%') = 8, 'S13 oito colunas');
  for f in select p.oid, p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) dono from pg_proc p
            where p.pronamespace = 'ensaio_adr0211'::regnamespace
              and p.proname in ('reivindicar_cancelamentos', 'cancelamento_baixas', 'registrar_cancelamentos_tratados') loop
    perform ensaio_adr0211.ok(f.prosecdef and f.proconfig @> array['search_path=""'] and f.dono = 'postgres', 'S13 ' || f.proname);
    perform ensaio_adr0211.ok(has_function_privilege('service_role', f.oid, 'execute')
      and not has_function_privilege('anon', f.oid, 'execute')
      and not has_function_privilege('authenticated', f.oid, 'execute'), 'S13 grants ' || f.proname);
  end loop;
  perform ensaio_adr0211.ok((select count(*) from pg_proc where pronamespace = 'ensaio_adr0211'::regnamespace
    and proname in ('reivindicar_cancelamentos', 'cancelamento_baixas', 'registrar_cancelamentos_tratados')) = 3, 'S13 três RPCs');
end $$;

rollback;
