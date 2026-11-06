-- ADR-0119 Errata 13: `meu_preco` pode vir do anúncio fora da ficha (/sale_price). Esse preço alimenta
-- a sobra, mas não a posição de mercado, então a tela precisa saber a origem.
alter table public.pulse_produtos
  add column meu_preco_fora_da_ficha boolean not null default false;
