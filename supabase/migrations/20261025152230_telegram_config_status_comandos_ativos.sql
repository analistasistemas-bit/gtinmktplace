-- ADR-0190 D-8: a tela de Notificações mostra "✓ Comandos ativos" quando o bot da org está
-- vinculado (webhook registrado por "Ativar comandos no bot"). telegram_bot_id não tem SELECT
-- para authenticated, então o status sai pela RPC como booleano — sem expor o id do bot.
-- Mudar o RETURNS TABLE exige drop + create; os grants voltam iguais aos de antes.
drop function if exists public.telegram_config_status();

create function public.telegram_config_status()
returns table(chat_id text, ativo boolean, tem_token boolean, comandos_ativos boolean)
language sql
security definer
set search_path to 'public'
as $$
  select telegram_chat_id,
         coalesce(telegram_ativo, false),
         (telegram_bot_token is not null and telegram_bot_token <> ''),
         (telegram_bot_id is not null)
  from public.configuracoes
  where org_id = (select public.current_org_id());
$$;

revoke all on function public.telegram_config_status() from public, anon;
grant execute on function public.telegram_config_status() to authenticated;
