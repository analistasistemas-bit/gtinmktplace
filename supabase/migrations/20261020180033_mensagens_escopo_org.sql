-- Mensagens pós-venda passam a ser da organização (emenda ADR-0067), como `ml_perguntas` e
-- `ml_vendas`. O sync grava `user_id` = dono da conexão ML (`criado_por`), então a leitura por
-- `user_id = auth.uid()` escondia todas as conversas dos demais membros da org (Avil: só o dono
-- via; o colega via a aba vazia e o badge zerado, embora `responder-mensagem` já o deixasse
-- responder — ela é org-scoped). `current_org_id()` já resolve a sessão de suporte, então o
-- ramo especial de suporte da policy anterior fica coberto.
-- Linha sem org sumiria da nova policy: o worker sempre grava org_id (0 nulos em 2026-10-20) — trava.
alter table public.ml_mensagens alter column org_id set not null;

drop policy if exists "ml_mensagens: select own or support org" on public.ml_mensagens;
create policy "ml_mensagens: select org" on public.ml_mensagens
  for select to authenticated using (org_id = (select public.current_org_id()));

create or replace function public.contar_conversas_aguardando()
returns integer
language sql
security definer
set search_path = public
as $$
  with ultimas as (
    select distinct on (pack_id) direcao, order_status, lida
    from public.ml_mensagens
    where org_id = public.current_org_id()
    order by pack_id, data_ml desc nulls last, message_id desc
  )
  select count(*)::int
  from ultimas
  where direcao = 'recebida'
    and coalesce(order_status, '') <> 'cancelled'
    and not lida;
$$;

-- Também usada por "Dispensar" (src/lib/mensagens.ts → dispensarConversa).
create or replace function public.marcar_mensagens_lidas(p_pack_id text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  if not public.can_write_current_org() then raise exception 'not allowed'; end if;
  update public.ml_mensagens set lida = true, atualizado_em = now()
  where org_id = public.current_org_id() and pack_id = p_pack_id and direcao = 'recebida' and lida = false;
  get diagnostics n = row_count;
  return n;
end;
$$;
