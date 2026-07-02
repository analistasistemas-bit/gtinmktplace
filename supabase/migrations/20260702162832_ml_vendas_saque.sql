-- Marcação manual de saque no detalhe financeiro.
-- ml_vendas segue read-only via RLS para o app; as escritas ficam restritas às RPCs abaixo.

alter table public.ml_vendas
  add column if not exists sacado_em timestamptz,
  add column if not exists sacado_por uuid references public.profiles(id) on delete set null;

comment on column public.ml_vendas.sacado_em is
  'Quando o recebimento desta venda foi marcado manualmente como sacado no Financeiro.';

comment on column public.ml_vendas.sacado_por is
  'Usuário que marcou o recebimento desta venda como sacado.';

create or replace function public.registrar_saque_ml_vendas(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_membro_operacao() then
    raise exception 'not allowed';
  end if;

  update public.ml_vendas
     set sacado_em = now(),
         sacado_por = auth.uid()
   where id = any(p_ids)
     and money_release_date is not null
     and money_release_date <= now()
     and sacado_em is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.desfazer_saque_ml_vendas(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_membro_operacao() then
    raise exception 'not allowed';
  end if;

  update public.ml_vendas
     set sacado_em = null,
         sacado_por = null
   where id = any(p_ids)
     and sacado_em is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.registrar_saque_ml_vendas(uuid[]) from public;
revoke all on function public.desfazer_saque_ml_vendas(uuid[]) from public;
grant execute on function public.registrar_saque_ml_vendas(uuid[]) to authenticated;
grant execute on function public.desfazer_saque_ml_vendas(uuid[]) to authenticated;
