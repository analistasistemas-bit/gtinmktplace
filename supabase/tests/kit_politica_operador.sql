\set ON_ERROR_STOP on
-- ADR-0197 (migration kit_politica_operador): pausa e reativação do operador na política do SKU.
-- Fixtures só dentro da transação desfeita (scripts/teste-sql-desfeito.py), em org própria.
begin;

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97200000-0000-0000-0000-000000000001', 'Kit operador', 'kit-operador-teste', array['kit_variacao'], true);
insert into public.sku_politica_kit (org_id, codigo, versao) values
  ('97200000-0000-0000-0000-000000000001', 'A', 3);

create function pg_temp.afirmar(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALHA: %', p_msg; end if;
end $$;

create function pg_temp.pol(p_codigo text) returns text language sql as $$
  select coalesce((select versao || '/' || bloqueio_operador from public.sku_politica_kit
    where org_id = '97200000-0000-0000-0000-000000000001' and codigo = p_codigo), 'sem linha')
$$;

do $$
declare o uuid := '97200000-0000-0000-0000-000000000001'; r jsonb;
begin
  -- Pausa: grava o bloqueio e incrementa; SKU sem linha nasce com versão 1 (soma 0 → 1).
  r := public.kit_politica_operador(o, array['A', 'B'], true);
  perform pg_temp.afirmar(r->>'ok' = 'true', 'pausa ok');
  perform pg_temp.afirmar(pg_temp.pol('A') = '4/true', 'A pausado incrementa: ' || pg_temp.pol('A'));
  perform pg_temp.afirmar(pg_temp.pol('B') = '1/true', 'B sem linha nasce bloqueado: ' || pg_temp.pol('B'));

  -- Reentrega da pausa não incrementa de novo.
  perform public.kit_politica_operador(o, array['A'], true);
  perform pg_temp.afirmar(pg_temp.pol('A') = '4/true', 'pausa repetida é idempotente: ' || pg_temp.pol('A'));

  -- Reativar com versão lida diferente da vigente recusa e não muda nada.
  r := public.kit_politica_operador(o, array['A'], false, '{"A": 3}'::jsonb);
  perform pg_temp.afirmar(r->>'ok' = 'false' and r->>'codigo' = 'A', 'versão velha recusa: ' || r::text);
  perform pg_temp.afirmar(pg_temp.pol('A') = '4/true', 'recusa não muda a política');

  -- SKU sem linha: versão esperada 0.
  r := public.kit_politica_operador(o, array['C'], false, '{"C": 1}'::jsonb);
  perform pg_temp.afirmar(r->>'ok' = 'false', 'sem linha com versão 1 recusa');
  r := public.kit_politica_operador(o, array['C'], false, '{"C": 0}'::jsonb);
  -- Fix 1/achado 2: a linha ausente é materializada com versão 0 e travada antes de comparar.
  perform pg_temp.afirmar(r->>'ok' = 'true' and pg_temp.pol('C') = '0/false', 'sem linha vira versão 0: ' || pg_temp.pol('C'));
  r := public.kit_politica_operador(o, array['C'], true);
  perform pg_temp.afirmar(pg_temp.pol('C') = '1/true', 'primeira pausa vai de 0 a 1: ' || pg_temp.pol('C'));

  -- Reativar com a versão certa limpa o bloqueio e incrementa.
  r := public.kit_politica_operador(o, array['A', 'B'], false, '{"A": 4, "B": 1}'::jsonb);
  perform pg_temp.afirmar(r->>'ok' = 'true', 'reativação ok');
  perform pg_temp.afirmar(pg_temp.pol('A') = '5/false', 'A reativado: ' || pg_temp.pol('A'));
  perform pg_temp.afirmar(pg_temp.pol('B') = '2/false', 'B reativado: ' || pg_temp.pol('B'));

  -- Reativar sem bloqueio não incrementa.
  perform public.kit_politica_operador(o, array['A'], false, '{"A": 5}'::jsonb);
  perform pg_temp.afirmar(pg_temp.pol('A') = '5/false', 'reativar sem bloqueio é idempotente');
end $$;

-- Achado 3: a pausa informa se ESTA origem (operação em massa) criou o bloqueio; retry preserva; bloqueio
-- anterior não é atribuído; reativar limpa a origem.
do $$
declare o uuid := '97200000-0000-0000-0000-000000000001'; op uuid := gen_random_uuid(); r jsonb;
begin
  r := public.kit_politica_operador(o, array['A'], true, null, op);
  perform pg_temp.afirmar((r->>'criou')::boolean, 'origem que bloqueou: criou ' || r::text);
  r := public.kit_politica_operador(o, array['A'], true, null, op);
  perform pg_temp.afirmar((r->>'criou')::boolean and pg_temp.pol('A') = '6/true', 'retry da mesma origem preserva: ' || pg_temp.pol('A'));
  r := public.kit_politica_operador(o, array['A'], true, null, gen_random_uuid());
  perform pg_temp.afirmar(not (r->>'criou')::boolean, 'bloqueio anterior não é da outra origem');
  r := public.kit_politica_operador(o, array['A'], true);
  perform pg_temp.afirmar(not (r->>'criou')::boolean, 'sem origem: não criou');
  perform public.kit_politica_operador(o, array['A'], false, '{"A": 6}'::jsonb);
  perform pg_temp.afirmar((select bloqueio_operador_origem is null from public.sku_politica_kit
    where org_id = o and codigo = 'A'), 'reativar limpa a origem');
end $$;

-- Achado 1: intenção de ativação durável, só o service role escreve.
do $$
begin
  perform pg_temp.afirmar(has_table_privilege('service_role', 'public.kit_ativacoes', 'insert,delete'), 'service_role escreve');
  perform pg_temp.afirmar(not has_table_privilege('authenticated', 'public.kit_ativacoes', 'insert'), 'authenticated não escreve');
  perform pg_temp.afirmar((select relrowsecurity from pg_class where oid = 'public.kit_ativacoes'::regclass), 'RLS ligada');
end $$;

-- Só o service role executa. E o embed `organizations(modulos_habilitados)` que as edges acrescentam às leituras
-- de marketplace_connections e operacoes_massa precisa de exatamente uma FK para organizations em cada tabela.
do $$
begin
  perform pg_temp.afirmar((select count(*) from pg_constraint where contype = 'f'
    and conrelid = 'public.marketplace_connections'::regclass and confrelid = 'public.organizations'::regclass) = 1,
    'marketplace_connections: uma FK para organizations');
  perform pg_temp.afirmar((select count(*) from pg_constraint where contype = 'f'
    and conrelid = 'public.operacoes_massa'::regclass and confrelid = 'public.organizations'::regclass) = 1,
    'operacoes_massa: uma FK para organizations');
  perform pg_temp.afirmar(not has_function_privilege('authenticated',
    'public.kit_politica_operador(uuid, text[], boolean, jsonb, uuid)', 'execute'), 'authenticated não executa');
  perform pg_temp.afirmar(has_function_privilege('service_role',
    'public.kit_politica_operador(uuid, text[], boolean, jsonb, uuid)', 'execute'), 'service_role executa');
end $$;

rollback;
