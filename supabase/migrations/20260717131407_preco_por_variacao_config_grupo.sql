-- ADR-0078 F2: preço por variação + split por faixa de preço.
-- Config de desconto/atacado passa a poder viver NA VARIAÇÃO (por faixa de preço).
-- NULL = herda o família-level (comportamento uniforme de hoje); valor explícito =
-- config da faixa (a UI de grupo grava em TODAS as variações do grupo).
alter table public.variacoes
  add column if not exists exibir_com_desconto boolean null,
  add column if not exists desconto_pct numeric null,
  add column if not exists atacado jsonb null;

comment on column public.variacoes.exibir_com_desconto is
  'Config por faixa de preco (ADR-0078 F2). NULL = herda familias.exibir_com_desconto; explicito = confirmacao da faixa desta variacao.';
comment on column public.variacoes.desconto_pct is
  'Percentual de desconto da faixa (ADR-0078 F2). NULL com exibir explicito = usa o % global de configuracoes.';
comment on column public.variacoes.atacado is
  'Faixas PxQ da faixa de preco (mesmo shape FaixaAtacado[] de familias.atacado). NULL = herda; [] = explicitamente sem atacado.';

-- Atacado por partição (ADR-0078 F2): um produto pode ter N anúncios (ADR-0048) e o
-- escalar familias.atacado_status não representa falha parcial entre eles.
-- familias.atacado_status passa a ser o AGREGADO (algum erro → erro; algum aplicado → aplicado).
alter table public.anuncios_externos
  add column if not exists atacado_status text null,
  add column if not exists atacado_erro text null;

comment on column public.anuncios_externos.atacado_status is
  'Status do PxQ deste anuncio/particao (ADR-0078 F2): aplicado | erro | NULL (sem atacado).';
comment on column public.anuncios_externos.atacado_erro is
  'Mensagem do ultimo erro de PxQ desta particao (NULL quando ok).';
