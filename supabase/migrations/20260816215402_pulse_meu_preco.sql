-- Pulse (ADR-0119, Errata 4): preço vivo do nosso anúncio na ficha de catálogo.
--
-- A coluna "Seu preço" era derivada de `variacoes.preco_publicado_ml`, que só é escrito quando o
-- app publica ou atualiza — nenhum job reconcilia esse valor com o ML. Resultado medido em
-- 16/08/2026: o anúncio MLB7343600804 estava a R$ 48,90 no ML e o banco dizia R$ 44,60.
--
-- O preço vivo vem da MESMA resposta que já coletamos (`/products/{id}/items`), onde a nossa
-- própria oferta aparece ao lado das concorrentes: mesma fonte, mesmo instante, mesma base de
-- comparação. `/items/{id}` foi descartado de propósito — devolve o preço BASE, sem a promoção
-- ativa (verificado: item a 38,90 no /items e 35,79 em /seller-promotions), o que compararia
-- preço base nosso contra preço efetivo dos concorrentes.
alter table public.pulse_produtos
  add column if not exists meu_item_id text,
  add column if not exists meu_preco numeric(12,2),
  add column if not exists meu_preco_em timestamptz;

comment on column public.pulse_produtos.meu_preco is
  'Preço VIVO da nossa oferta nesta ficha, lido de /products/{id}/items na última coleta. null = não temos oferta ativa na ficha (anúncio pausado, sem estoque ou sem vínculo de catálogo). Nunca preencher com preço local — ver Errata 4 do ADR-0119.';
comment on column public.pulse_produtos.meu_item_id is
  'item_id do nosso anúncio encontrado na ficha. Com anúncio publicado por faixa de preço (split), vence a oferta de MENOR preço — é a comparável com "menor concorrente".';
comment on column public.pulse_produtos.meu_preco_em is
  'Quando meu_preco foi lido do ML. Preço sem data de leitura não é preço atual.';
