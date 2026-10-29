\set ON_ERROR_STOP on
begin;
do $$
begin
  assert not has_function_privilege('anon', 'public.resumo_mensagens_posvenda()', 'execute'), 'anon ainda executa';
  assert has_function_privilege('authenticated', 'public.resumo_mensagens_posvenda()', 'execute'), 'authenticated perdeu execute';
end $$;
rollback;
