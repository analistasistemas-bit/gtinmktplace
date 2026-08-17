-- Pulse (ADR-0119, Errata 6): comissão do ML no PREÇO CERTO.
--
-- `ptw_custos.comissao` vem de /suggestions/items/{id}/details e é a comissão calculada sobre o
-- `suggested_price`, não sobre o preço praticado. O simulador de margem aplicava esse valor ao
-- preço atual e superestimava a sobra sempre que o anúncio estivesse ACIMA da sugestão do ML —
-- exatamente as linhas de "mais caro que o mercado", que são as que o operador reprecifica.
--
-- Medido em 16/08/2026, item MLB5040504553 a R$ 39,90 (sugestão do ML: R$ 32,99):
--   comissão usada  R$ 4,62  → sobra exibida  R$ 5,36 (13,4%)
--   comissão real   R$ 5,59  → sobra real     R$ 4,39 (11,0%)
-- Confirmado em três fontes: /sites/MLB/listing_prices, o painel de anúncios do ML
-- ("A pagar R$ 5,59" / "Você recebe R$ 27,66") e a aritmética 39,90 - 5,59 - 6,65 = 27,66.
--
-- Guardamos a ESTRUTURA da taxa (percentual + parcela fixa) lida para o preço atual, não o valor
-- pronto: assim a margem do preço praticado fica exata e o simulador consegue recalcular.
-- Atenção documentada no código: a estrutura muda por faixa de preço (medido na categoria
-- MLB198494 — R$ 10: 14% + R$ 4,99 fixo; R$ 25 a R$ 100: 14%; R$ 250: 11%), então em preço
-- simulado distante do praticado o resultado é estimativa, e a tela diz isso.
alter table public.pulse_produtos
  add column if not exists comissao_pct numeric(6,3),
  add column if not exists comissao_fixa numeric(12,2),
  add column if not exists comissao_em timestamptz;

comment on column public.pulse_produtos.comissao_pct is
  'Percentual da comissão do ML (`sale_fee_details.percentage_fee`) lido para o preço praticado. Muda por faixa de preço — ver Errata 6 do ADR-0119.';
comment on column public.pulse_produtos.comissao_fixa is
  'Parcela fixa da comissão (`sale_fee_details.fixed_fee`), em R$. Não é zero em preço baixo.';
comment on column public.pulse_produtos.comissao_em is
  'Quando a estrutura da comissão foi lida. null = não lida — a margem não pode ser exibida.';
