-- Pulse (ADR-0119, Errata 5): situação REAL do nosso anúncio no Mercado Livre.
--
-- O filtro de situação da tela olhava `pulse_produtos.status`, que é o ciclo de vida do produto
-- DENTRO do radar (pausar/reativar pelo menu da linha). Nenhum produto jamais foi pausado ali, e
-- o operador queria justamente o oposto: os anúncios pausados no ML. Medido em 16/08/2026 na org
-- DSA — 3 anúncios `paused`/`out_of_stock` contra 3 `active`.
--
-- Não dá para inferir isso da ausência na ficha: um anúncio some da ficha de catálogo tanto por
-- estar pausado quanto por perder o vínculo, e "sem estoque" e "pausado por moderação" são
-- situações diferentes com a mesma aparência. O status vem do multiget de /items.
alter table public.pulse_produtos
  add column if not exists anuncio_status text,
  add column if not exists anuncio_sub_status text[],
  add column if not exists anuncio_status_em timestamptz;

comment on column public.pulse_produtos.anuncio_status is
  'Situação do NOSSO anúncio no ML (`active`, `paused`, `closed`…), lida do multiget de /items na coleta. Não confundir com `status`, que é a situação do produto dentro do radar.';
comment on column public.pulse_produtos.anuncio_sub_status is
  'Detalhe da situação (`out_of_stock`, `deleted`…). É o que separa "pausado por estoque zerado" de "pausado por moderação".';
comment on column public.pulse_produtos.anuncio_status_em is
  'Quando a situação foi lida do ML. null = ainda não lida — a tela não pode afirmar situação nenhuma.';
