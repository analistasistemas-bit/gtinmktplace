-- ADR-0109 — backfill do custo congelado das vendas que já existiam.
--
-- Para cada item vendido, o custo da variação cujo LOTE é o mais recente ANTERIOR à data da venda.
-- É a melhor reconstrução disponível: as variações duplicadas por re-ingest (ADR-0108) formam, na
-- prática, um histórico de custo datado pelos lotes.
--
-- Aproximação assumida: não capta uma mudança de custo por recebimento ocorrida ENTRE o lote e a
-- venda. A coluna `fonte` marca estas linhas como 'backfill' para distinguir do que foi capturado
-- ao vivo — o dado diz o que é, em vez de depender da memória de quem rodou.
--
-- Idempotente: `on conflict do nothing`. Rodar de novo insere 0.

insert into public.venda_item_custo
  (org_id, user_id, venda_id, ml_item_id, variation_id, codigo, custo_unitario, fonte)
select
  v.org_id, v.user_id, i.venda_id, i.ml_item_id, i.variation_id, i.codigo, c.custo, 'backfill'
from public.ml_vendas_itens i
join public.ml_vendas v on v.id = i.venda_id
cross join lateral (
  select va.custo
  from public.variacoes va
  join public.familias f on f.id = va.familia_id
  join public.lotes l on l.id = f.lote_id
  where va.user_id = v.user_id
    -- normGtin do frontend remove zeros à esquerda; casar dos dois lados evita que '02841037'
    -- da venda deixe de encontrar '2841037' do catálogo (ou o contrário).
    and ltrim(va.codigo, '0') = ltrim(i.codigo, '0')
    and va.custo > 0
    and l.criado_em <= coalesce(v.date_created, v.date_closed, now())
  -- lote mais recente ANTES da venda; entre variações do mesmo lote, a mais recente (ADR-0108).
  order by l.criado_em desc, va.atualizado_em desc
  limit 1
) c
where i.codigo is not null
on conflict (venda_id, ml_item_id, variation_id) do nothing;
