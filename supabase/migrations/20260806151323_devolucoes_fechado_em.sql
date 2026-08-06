-- Data de conclusão da devolução (claim.resolution.date_created), para o card "N devoluções"
-- do Dashboard atribuir o estorno ao período em que o dinheiro saiu — não ao da abertura do
-- claim, que podia cair em outro mês. Ver ADR-0106.
--
-- É o mesmo instante do estorno no Mercado Pago: conferido contra
-- ml_vendas.raw->payments[].date_last_modified em 5 devoluções reais (claim 5553795965 fechou
-- 2026-08-03T17:16:36-04, pagamento 169615860668 estornado 2026-08-03T17:16:41-04).

alter table public.ml_devolucoes add column if not exists fechado_em timestamptz;

comment on column public.ml_devolucoes.fechado_em is
  'Quando o ML resolveu o claim (resolution.date_created) = quando o estorno saiu. Null enquanto aberto.';

-- Backfill a partir do payload já guardado em `raw` — sem depender de re-sincronizar o ML.
-- O ML manda a data com offset (-04:00); o cast para timestamptz normaliza para UTC.
update public.ml_devolucoes
   set fechado_em = (raw -> 'resolution' ->> 'date_created')::timestamptz
 where fechado_em is null
   and raw -> 'resolution' ->> 'date_created' is not null;

create index if not exists ml_devolucoes_fechado_idx
  on public.ml_devolucoes (user_id, fechado_em desc);
