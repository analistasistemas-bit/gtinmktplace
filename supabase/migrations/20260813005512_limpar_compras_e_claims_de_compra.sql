-- ============================================================================
-- Segunda limpeza das compras da própria conta (a primeira foi 20260812232901).
--
-- Por que houve uma segunda: a guarda do ADR-0117 ficou no `sync-venda`, mas `upsertVenda` tem
-- QUATRO chamadores. O `sync-devolucao` reprocessa o pedido de cada claim pelo mesmo pipeline, e
-- os claims do ML incluem os que a conta abriu como COMPRADORA — então ele recriou as 23 linhas
-- 27 minutos depois da primeira migration. A trava agora vive dentro do próprio `upsertVenda`
-- (parâmetro `contaExternaId` obrigatório) e as 4 functions já estão deployadas, então esta
-- limpeza não pode ser desfeita pelo próximo webhook.
--
-- Também limpa os claims sobre COMPRAS, que o `upsertDevolucao` passou a recusar via
-- `ehClaimDeCompra` (decide pelos players `buyer`/`seller` do claim).
-- ============================================================================

-- 1) Claims em que a conta é a COMPRADORA (e não a vendedora): não são devolução de venda.
--    Mesmo critério do código — `sender`/`receiver` ficam de fora de propósito: são papéis
--    logísticos e se invertem na devolução (o vendedor recebe o produto de volta).
delete from public.ml_devolucoes d
 where exists (
   select 1 from public.ml_credentials c
    where exists (
      select 1 from jsonb_array_elements(d.raw->'players') p
       where p->>'user_id' = c.ml_user_id and p->>'type' = 'buyer'
    )
      and not exists (
      select 1 from jsonb_array_elements(d.raw->'players') p
       where p->>'user_id' = c.ml_user_id and p->>'type' = 'seller'
    )
 );

-- 2) Claims que apontam para uma compra (pega os que não trazem `players` úteis). Roda ANTES do
--    delete das vendas, enquanto o vínculo ainda existe.
delete from public.ml_devolucoes d
 where d.order_id in (
   select v.order_id
     from public.ml_vendas v
     join public.ml_credentials c on c.ml_user_id::bigint = v.comprador_id
 );

-- 3) As compras. Itens e custos saem por cascade.
delete from public.ml_vendas v
 using public.ml_credentials c
 where c.ml_user_id::bigint = v.comprador_id;
