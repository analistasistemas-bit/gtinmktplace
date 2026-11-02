-- Emenda ADR-0155 (02/11/2026): valor devolvido de produto vem do ML, sem conciliacao manual.
-- Roda em prod numa transacao desfeita: python3 scripts/teste-sql-desfeito.py <este> <migration>
begin;
do $$
begin
  -- estorno conhecido abate em centavos
  if public.platform_auto_refund_cents('partially_refunded',159.60,null)<>15960 then raise exception 'estorno partial'; end if;
  if public.platform_auto_refund_cents('paid',12.50,null)<>1250 then raise exception 'estorno paid'; end if;
  -- mediacao aberta (paid, estorno 0) abate 0, nao bloqueia
  if public.platform_auto_refund_cents('paid',0,null)<>0 then raise exception 'mediacao'; end if;
  if public.platform_auto_refund_cents('paid',null,null)<>0 then raise exception 'paid sem nada'; end if;
  -- estorno nulo: cai no raw.payments[].transaction_amount_refunded
  if public.platform_auto_refund_cents('partially_refunded',null,
    '{"payments":[{"transaction_amount_refunded":133.59},{"transaction_amount_refunded":null}]}')<>13359 then
    raise exception 'fallback raw'; end if;
  -- partially_refunded sem valor nenhum: desconhecido (continua pendencia)
  if public.platform_auto_refund_cents('partially_refunded',null,'{"payments":[{"transaction_amount_refunded":0}]}') is not null
    or public.platform_auto_refund_cents('partially_refunded',0,null) is not null
    or public.platform_auto_refund_cents('partially_refunded',null,'{"payments":"x"}') is not null then
    raise exception 'partial desconhecido deveria ser null'; end if;
  -- negativo nunca vira cobranca extra
  if public.platform_auto_refund_cents('paid',-5,null)<>0 then raise exception 'negativo'; end if;
end $$;
rollback;
