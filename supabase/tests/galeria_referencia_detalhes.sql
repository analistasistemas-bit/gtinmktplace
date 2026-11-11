\set ON_ERROR_STOP on
-- ADR-0201 (Galeria da cor), adendo "lupa pela caixa do produto": galeria_referencias.detalhes + galeria_gravar_detalhes.
-- Gravação condicional (nula, falhou ou outra versão), relida do banco; escrita só service_role. Rodar com a cadeia
-- inteira da galeria (nada aplicado em produção até a Task 16):
--   python3 scripts/teste-sql-desfeito.py supabase/tests/galeria_referencia_detalhes.sql \
--     supabase/migrations/20261109093335_galeria_da_cor.sql supabase/migrations/20261111102539_galeria_referencia_detalhes.sql
begin;
set local lock_timeout = '5s';
insert into public.organizations (id, nome, slug) values
  ('97700000-0000-0000-0000-000000000001', 'Lupa A', 'lupa-a'),
  ('97700000-0000-0000-0000-000000000002', 'Lupa B', 'lupa-b');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('97700000-0000-0000-0000-000000000101', 'lupa-a@test.local', '{}'::jsonb, '{"org_id":"97700000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.galeria_referencias (id, org_id, familia_id, cor, vista, path, sha256, origem) values
  ('97700000-0000-0000-0000-0000000000a1', '97700000-0000-0000-0000-000000000001', gen_random_uuid(), 'Rosa', 'frente', 'p', 's1', 'storage');

set local role service_role;
do $$
declare
  r constant uuid := '97700000-0000-0000-0000-0000000000a1';
  a constant uuid := '97700000-0000-0000-0000-000000000001';
  v jsonb;
begin
  -- Outra org: nada grava, devolve null.
  if public.galeria_gravar_detalhes('97700000-0000-0000-0000-000000000002', r, '{"estado":"ok","versao":"v1"}') is not null
     or (select detalhes from public.galeria_referencias where id = r) is not null then
    raise exception 'gravou na referência de outra org';
  end if;
  -- Nula → falhou grava; falhou → ok grava.
  v := public.galeria_gravar_detalhes(a, r, '{"estado":"falhou","versao":"v1","tentado_em":"t1"}');
  if v->>'estado' <> 'falhou' then raise exception 'falhou não gravou: %', v; end if;
  v := public.galeria_gravar_detalhes(a, r, '{"estado":"ok","versao":"v1","hash":"h1"}');
  if v->>'hash' <> 'h1' then raise exception 'ok sobre falhou não gravou: %', v; end if;
  -- Corrida: o segundo (ok ou falhou, mesma versão) perde e recebe a do vencedor.
  v := public.galeria_gravar_detalhes(a, r, '{"estado":"ok","versao":"v1","hash":"h2"}');
  if v->>'hash' <> 'h1' then raise exception 'segunda gravação venceu: %', v; end if;
  v := public.galeria_gravar_detalhes(a, r, '{"estado":"falhou","versao":"v1"}');
  if v->>'estado' <> 'ok' then raise exception 'falhou derrubou ok: %', v; end if;
  -- sem_detalhe é definitivo na mesma versão; versão nova relê.
  update public.galeria_referencias set detalhes = '{"estado":"sem_detalhe","versao":"v1"}' where id = r;
  v := public.galeria_gravar_detalhes(a, r, '{"estado":"ok","versao":"v1","hash":"h3"}');
  if v->>'estado' <> 'sem_detalhe' then raise exception 'sem_detalhe foi relido na mesma versão: %', v; end if;
  v := public.galeria_gravar_detalhes(a, r, '{"estado":"ok","versao":"v2","hash":"h4"}');
  if v->>'hash' <> 'h4' then raise exception 'versão nova não regravou: %', v; end if;
  -- Formato: não-objeto ou estado desconhecido ou sem versão → check.
  begin
    update public.galeria_referencias set detalhes = '{"estado":"talvez","versao":"v1"}' where id = r;
    raise exception 'estado desconhecido aceito';
  exception when check_violation then null;
  end;
  begin
    update public.galeria_referencias set detalhes = '{"estado":"ok"}' where id = r;
    raise exception 'detalhes sem versão aceito';
  exception when check_violation then null;
  end;
end $$;
reset role;

-- authenticated (mesma org) lê, mas não grava nem chama a RPC.
set local role authenticated;
set local request.jwt.claims = '{"sub":"97700000-0000-0000-0000-000000000101","role":"authenticated"}';
do $$ begin
  begin
    perform public.galeria_gravar_detalhes('97700000-0000-0000-0000-000000000001', '97700000-0000-0000-0000-0000000000a1', '{"estado":"falhou","versao":"v9"}');
    raise exception 'authenticated chamou galeria_gravar_detalhes';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.galeria_referencias set detalhes = null;
    raise exception 'authenticated alterou detalhes';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
