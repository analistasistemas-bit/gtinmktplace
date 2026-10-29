-- resumo_mensagens_posvenda é security definer: só usuário logado executa (o default do Postgres dá execute a PUBLIC/anon).
revoke execute on function public.resumo_mensagens_posvenda() from public, anon;
grant execute on function public.resumo_mensagens_posvenda() to authenticated;
