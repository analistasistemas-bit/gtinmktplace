\set ON_ERROR_STOP on
-- ADR-0199 (migration kit_variacao_previa_texto): consumo da prévia associa uma vez e soma o custo.
begin;
insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97300000-0000-0000-0000-000000000001', 'Prévia texto', 'previa-texto-teste', array['kit_variacao'], true),
  ('97300000-0000-0000-0000-000000000002', 'Prévia texto outra', 'previa-texto-outra', array['kit_variacao'], true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('97300000-0000-0000-0000-000000000101', 'previa-texto@teste.local', '{"org_id":"97300000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('97300000-0000-0000-0000-000000000101', '97300000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('97300000-0000-0000-0000-000000000201', '97300000-0000-0000-0000-000000000101', '97300000-0000-0000-0000-000000000001', 'processando', 'manual');
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, custo_centavos, tokens_input) values
  ('97300000-0000-0000-0000-000000000301', '97300000-0000-0000-0000-000000000201', '97300000-0000-0000-0000-000000000101',
   '97300000-0000-0000-0000-000000000001', '09950000', 'Kit', 'CREATE', 'nacional', '97300000-0000-0000-0000-0000000003aa', null, null);
insert into public.kit_variacao_previas (id, org_id, familia_base_id, pecas, modelo, tokens_input, tokens_output, custo_centavos) values
  ('97300000-0000-0000-0000-000000000401', '97300000-0000-0000-0000-000000000001', '97300000-0000-0000-0000-000000000999', 4, 'm', 1000, 500, 3);

create function pg_temp.afirmar(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if p_cond is not true then raise exception 'FALHA: %', p_msg; end if; end $$;

do $$
declare f text := 'public.kit_variacao_consumir_previa(uuid, uuid, uuid, integer, uuid, uuid)';
begin
  perform pg_temp.afirmar(not has_function_privilege('anon', f, 'execute'), 'exposta a anon');
  perform pg_temp.afirmar(not has_function_privilege('authenticated', f, 'execute'), 'exposta a authenticated');
  perform pg_temp.afirmar(has_function_privilege('service_role', f, 'execute'), 'sem service_role');
end $$;

set local role service_role;
do $$
declare
  o constant uuid := '97300000-0000-0000-0000-000000000001'; p constant uuid := '97300000-0000-0000-0000-000000000401';
  b constant uuid := '97300000-0000-0000-0000-000000000999'; ch constant uuid := '97300000-0000-0000-0000-0000000003aa';
  k1 constant uuid := gen_random_uuid(); k2 constant uuid := gen_random_uuid(); r jsonb;
begin
  r := public.kit_variacao_consumir_previa('97300000-0000-0000-0000-000000000002', p, b, 4, k1, ch);
  perform pg_temp.afirmar(r->>'motivo' = 'previa_invalida', 'outra org aceita: ' || r::text);
  r := public.kit_variacao_consumir_previa(o, p, b, 3, k1, ch);
  perform pg_temp.afirmar(r->>'motivo' = 'previa_divergente', 'peças divergentes aceitas: ' || r::text);
  r := public.kit_variacao_consumir_previa(o, p, gen_random_uuid(), 4, k1, ch);
  perform pg_temp.afirmar(r->>'motivo' = 'previa_divergente', 'base divergente aceita: ' || r::text);
  r := public.kit_variacao_consumir_previa(o, p, b, 4, k1, ch);
  perform pg_temp.afirmar((r->>'ok')::boolean and not (r->>'existente')::boolean, 'consumo falhou: ' || r::text);
  perform pg_temp.afirmar((select custo_centavos = 3 and tokens_input = 1000 from public.familias where chave_cadastro = ch), 'custo não somado');
  r := public.kit_variacao_consumir_previa(o, p, b, 4, k1, ch);
  perform pg_temp.afirmar((r->>'ok')::boolean and (r->>'existente')::boolean, 'repetição recusada: ' || r::text);
  perform pg_temp.afirmar((select custo_centavos = 3 from public.familias where chave_cadastro = ch), 'repetição somou de novo');
  r := public.kit_variacao_consumir_previa(o, p, b, 4, k2, ch);
  perform pg_temp.afirmar(r->>'motivo' = 'previa_usada', 'reuso por outro kit aceito: ' || r::text);
end $$;
