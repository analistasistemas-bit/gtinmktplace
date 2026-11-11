-- ADR-0174, emenda 2026-11-08 (2): anúncio que participa da Relâmpago num horário e tem convite aberto para outro.
-- A linha segue participando (trava de oferta, contagem, alertas e Revisão não mudam); a faixa do convite fica nela.
alter table public.ml_promocao_itens
  add column if not exists convite_aberto boolean not null default false;
