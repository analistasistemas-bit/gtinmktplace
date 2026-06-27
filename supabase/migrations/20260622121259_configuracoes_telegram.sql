-- Configuração do alerta Telegram pela tela de Configurações (ADR-0035).
-- Credenciais ficam na tabela configuracoes (RLS por user_id), editáveis pela UI.
alter table public.configuracoes
  add column if not exists telegram_chat_id   text,
  add column if not exists telegram_bot_token text,
  add column if not exists telegram_ativo     boolean not null default false;

-- Status para a UI SEM devolver o token ao navegador (só se existe). security definer
-- para ler a coluna sob RLS; sempre filtrado por auth.uid().
create or replace function public.telegram_config_status()
returns table(chat_id text, ativo boolean, tem_token boolean)
language sql
security definer
set search_path = public
as $$
  select telegram_chat_id,
         coalesce(telegram_ativo, false),
         (telegram_bot_token is not null and telegram_bot_token <> '')
  from public.configuracoes
  where user_id = auth.uid();
$$;

revoke all on function public.telegram_config_status() from public;
grant execute on function public.telegram_config_status() to authenticated;
