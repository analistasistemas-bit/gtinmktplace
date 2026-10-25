-- ADR-0190 D-8: telegram_config_status devolve comandos_ativos (bot vinculado), sem expor o id.
-- Roda com scripts/teste-sql-desfeito.py (transação sempre desfeita). Usa o admin da Hairfly
-- Cosmeticos, org com o bot vinculado em 25/10.
do $$
declare r record;
begin
  if has_function_privilege('anon', 'public.telegram_config_status()', 'EXECUTE') then
    raise exception 'anon não pode executar telegram_config_status';
  end if;
  if not has_function_privilege('authenticated', 'public.telegram_config_status()', 'EXECUTE') then
    raise exception 'authenticated precisa executar telegram_config_status';
  end if;

  perform set_config('request.jwt.claims', '{"sub":"710980b8-56ac-452c-810b-88f583dae63c","role":"authenticated"}', true);
  set local role authenticated;

  select * into r from public.telegram_config_status();
  if r.comandos_ativos is distinct from true then raise exception 'bot vinculado deveria dar comandos_ativos = true, veio %', r.comandos_ativos; end if;
  if r.tem_token is distinct from true then raise exception 'tem_token mudou: %', r.tem_token; end if;

  reset role;
  -- Desvincular é coisa do servidor (trigger configuracoes_proteger_bot_id): claims de service_role só aqui.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update public.configuracoes set telegram_bot_id = null where org_id = '23cd3929-418f-4408-adb2-55655e0628c5';
  perform set_config('request.jwt.claims', '{"sub":"710980b8-56ac-452c-810b-88f583dae63c","role":"authenticated"}', true);
  set local role authenticated;

  select * into r from public.telegram_config_status();
  if r.comandos_ativos is distinct from false then raise exception 'sem bot vinculado deveria dar false, veio %', r.comandos_ativos; end if;
  reset role;
end $$;
