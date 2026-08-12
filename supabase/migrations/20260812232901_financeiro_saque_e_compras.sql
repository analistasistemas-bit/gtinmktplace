-- ============================================================================
-- Financeiro — compras da própria conta e saque de pedido sem dinheiro.
-- Revisão code-review-v11 (2026-08-12).
--
-- Defeito 1: o webhook `orders_v2` do ML notifica pedidos em que a conta é COMPRADORA, e
-- `sync-venda` gravava todos como venda. 23 linhas na base (R$ 37.118,27), das quais 7 em `paid`
-- contavam como faturamento (R$ 8.810,50). A guarda `ehVendaDaConta` já está em produção
-- (sync-venda v65) — esta migration só limpa o histórico, sem risco de reinserção.
--
-- Defeito 2: `registrar_saque_ml_vendas` nunca olhava o status, então pedido devolvido — cujo
-- dinheiro voltou ao comprador — podia ser marcado como sacado. 46 linhas (R$ 2.849,54).
--
-- Decisões do Diego (2026-08-12): apagar as compras (não flagar), desfazer os saques indevidos,
-- e restringir saque a admin (ADR-0060 já restringe pausar anúncio; movimentação financeira é ao
-- menos tão sensível).
-- ============================================================================

-- 1) Devoluções abertas sobre COMPRAS não são devolução de venda. `ml_devolucoes` não tem FK para
--    `ml_vendas` (só `order_id` solto), então não cai por cascade: apagar ANTES das vendas,
--    enquanto o vínculo para identificá-las ainda existe. 25 linhas.
delete from public.ml_devolucoes d
 where d.order_id in (
   select v.order_id
     from public.ml_vendas v
     join public.ml_credentials c on c.ml_user_id::bigint = v.comprador_id
 );

-- 2) As compras. `ml_vendas_itens` e `venda_item_custo` saem por cascade
--    (FKs `*_venda_id_fkey` com ON DELETE CASCADE, conferidas no banco vivo).
delete from public.ml_vendas v
 using public.ml_credentials c
 where c.ml_user_id::bigint = v.comprador_id;

-- 3) Saque marcado em pedido que não é venda faturável: o dinheiro foi estornado ao comprador.
update public.ml_vendas
   set sacado_em = null,
       sacado_por = null
 where sacado_em is not null
   and status not in ('paid', 'partially_refunded', 'refunded');

-- 4) Travas. Duas condições novas em cada RPC: só venda faturável tem dinheiro a sacar (ADR-0038),
--    e só admin movimenta caixa (mesmo predicado do ADR-0060).
--
-- ATENÇÃO ao recriar (o mesmo aviso de 20260720013021, que continua valendo): a base deste corpo é
-- a migration 20260720013021 — a que está em produção — e NÃO a 20260705200441. A diferença que
-- não pode se perder é `atualizado_em = now()`: sem ela o poll incremental de vendas (ADR-0082)
-- fica cego ao saque e o check só aparece na tela num fetch completo.
create or replace function public.registrar_saque_ml_vendas(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_count integer;
begin
  v_org := public.current_org_id();
  if v_org is null or not public.is_admin() then
    raise exception 'not allowed';
  end if;

  update public.ml_vendas
     set sacado_em = now(),
         sacado_por = auth.uid(),
         atualizado_em = now()   -- ADR-0082: sem isto o saque some do delta do poll
   where id = any(p_ids)
     and org_id = v_org
     and status in ('paid', 'partially_refunded', 'refunded')
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
  v_org   uuid;
  v_count integer;
begin
  v_org := public.current_org_id();
  if v_org is null or not public.is_admin() then
    raise exception 'not allowed';
  end if;

  -- Sem filtro de status de propósito: desfazer é correção de erro e precisa alcançar qualquer
  -- linha marcada, inclusive as que a trava acima passou a recusar.
  update public.ml_vendas
     set sacado_em = null,
         sacado_por = null,
         atualizado_em = now()   -- ADR-0082
   where id = any(p_ids)
     and org_id = v_org
     and sacado_em is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.registrar_saque_ml_vendas(uuid[]) from public;
revoke all on function public.desfazer_saque_ml_vendas(uuid[]) from public;
grant execute on function public.registrar_saque_ml_vendas(uuid[]) to authenticated;
grant execute on function public.desfazer_saque_ml_vendas(uuid[]) to authenticated;
