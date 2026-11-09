-- Galeria da cor por IA (Task 5): modelo de imagem da galeria escolhido por organização.
-- Slugs = `_shared/galeria/modelos.ts::MODELOS_GALERIA` = `src/lib/ai-modelos.ts::MODELOS_GALERIA_UI`.
-- NULL = padrão (google/gemini-nano-banana-2.1). O Grok é aceito aqui, mas resolverModeloGaleria o troca pelo padrão
-- enquanto o campo de referência não for medido (Task 9 Step 5).
-- Escrita só pelo admin da plataforma (super-admin, em sessão de suporte) ou pelo servidor. Re-executável.

alter table public.configuracoes add column if not exists ai_model_galeria text;

alter table public.configuracoes
  drop constraint if exists configuracoes_ai_model_galeria_check;
alter table public.configuracoes
  add constraint configuracoes_ai_model_galeria_check
    check (ai_model_galeria is null
           or ai_model_galeria in ('google/gemini-nano-banana-2.1', 'xai/grok-imagine-image-2.0', 'alibaba/qwen-image-3/edit'));

comment on column public.configuracoes.ai_model_galeria is
  'Modelo de imagem da galeria da cor por IA. NULL = padrão google/gemini-nano-banana-2.1. Escrita só por super-admin.';

-- SELECT de configuracoes é por coluna desde 20260822131053.
grant select (ai_model_galeria) on public.configuracoes to authenticated;

-- Há UPDATE/INSERT concedido à tabela inteira e a RLS deixa o admin da org escrever: só o trigger restringe a coluna
-- (padrão de configuracoes_proteger_bot_id, 20261025030321).
create or replace function public.configuracoes_proteger_ai_model_galeria()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if ((tg_op = 'INSERT' and new.ai_model_galeria is not null)
      or (tg_op = 'UPDATE' and new.ai_model_galeria is distinct from old.ai_model_galeria))
     and (coalesce(auth.role(), 'service_role') <> 'service_role' or current_user in ('authenticated', 'anon'))
     and not public.is_super_admin() then
    raise exception 'ai_model_galeria só é alterado pelo admin da plataforma' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.configuracoes_proteger_ai_model_galeria() from public, anon, authenticated;

drop trigger if exists configuracoes_proteger_ai_model_galeria on public.configuracoes;
create trigger configuracoes_proteger_ai_model_galeria
  before insert or update on public.configuracoes
  for each row execute function public.configuracoes_proteger_ai_model_galeria();
