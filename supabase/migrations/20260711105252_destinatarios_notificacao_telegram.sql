-- Destinatários de notificação Telegram por usuário e categoria (ADR-0068).
-- Antes: 1 chat_id por org (configuracoes.telegram_chat_id) recebia tudo.
-- Agora: cada profile pode ter seu telegram_chat_id e assinar categorias específicas.
-- O bot (token) continua único por org (configuracoes); só o DESTINO passa a ser por profile.
alter table public.profiles
  add column if not exists telegram_chat_id   text,
  add column if not exists telegram_categorias text[] not null default '{}';

-- Categorias válidas (mesmo conjunto de _shared/notificacoes/categorias.ts e src/lib/notificacoes-categorias.ts).
alter table public.profiles
  drop constraint if exists profiles_telegram_categorias_validas;
alter table public.profiles
  add constraint profiles_telegram_categorias_validas
  check (telegram_categorias <@ array['vendas','perguntas','pos_venda','financeiro','moderacao']::text[]);

-- Backfill: preserva exatamente quem recebe hoje. A config Telegram foi salva por um usuário
-- (configuracoes.user_id) com o chat_id dele; migra esse chat para o profile correspondente com
-- TODAS as categorias, apenas onde a org tinha Telegram ativo e chat_id preenchido.
-- Verificado (read-only, 2026-07-11): a única org com telegram_ativo tem user_id resolvendo para um
-- profile ativo/admin da mesma org — o join acerta e ninguém perde notificação. Orgs cujo user_id
-- não resolva simplesmente não recebem até o admin configurar os destinatários na tela Usuários.
update public.profiles p
set telegram_chat_id   = c.telegram_chat_id,
    telegram_categorias = array['vendas','perguntas','pos_venda','financeiro','moderacao']::text[]
from public.configuracoes c
where c.user_id = p.id
  and c.telegram_ativo = true
  and c.telegram_chat_id is not null
  and c.telegram_chat_id <> '';
