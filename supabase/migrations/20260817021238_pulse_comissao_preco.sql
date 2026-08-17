-- Pulse (ADR-0119, Errata 7): guardar o PREÇO em que a estrutura da comissão foi lida.
--
-- A Errata 6 passou a ler `sale_fee_details` "no preço praticado", mas o preço usado na consulta
-- vinha do multiget de `/items` — e a Errata 4 já havia provado, por medição, que esse endpoint
-- devolve o preço BASE, sem a promoção ativa (MLB7391084566: 38,90 no `/items` contra 35,79
-- efetivos). As duas erratas se contradiziam: a 6 pedia o preço praticado e usava o insumo que a 4
-- desqualificou. Com promoção cruzando faixa (o corte da parcela fixa fica perto de R$ 79), a
-- estrutura era gravada na faixa errada e a sobra exibida superestimava — na direção que induz o
-- operador a baixar o preço.
--
-- Duas correções acompanham esta coluna:
--   1. o coletor passa a consultar `listing_prices` no preço EFETIVO (`meu_preco`, lido de
--      `/products/{id}/items` na mesma execução) sempre que ele for conhecido para o MESMO item;
--   2. esta coluna registra em que preço a leitura foi feita, para a tela ancorar o rótulo
--      "estimativa" nela em vez de em `meu_preco`.
--
-- Sem a coluna, o rótulo usava a âncora errada: `margemEstimativa` comparava o preço simulado com
-- `meu_preco`, então no caso com promoção o número saía SEM rótulo, com a mesma confiança de um
-- valor exato — e o dialog de reprecificar, cuja função é justamente digitar outro preço, não
-- rotulava nada em hipótese alguma.
--
-- `null` (linhas anteriores a esta migration) = preço da leitura desconhecido; a tela trata como
-- estimativa, que é a leitura honesta do que não foi registrado.
alter table public.pulse_produtos
  add column if not exists comissao_preco numeric(12,2);

comment on column public.pulse_produtos.comissao_preco is
  'Preço em que `comissao_pct`/`comissao_fixa` foram lidos no ML. A estrutura muda por faixa de preço, então margem calculada em preço diferente deste é estimativa — a tela rotula. null = desconhecido (linha anterior à Errata 7), tratado como estimativa.';
