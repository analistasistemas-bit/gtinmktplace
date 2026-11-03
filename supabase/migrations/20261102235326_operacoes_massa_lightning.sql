-- Emenda ADR-0174 (02/11/2026): Relâmpago (LIGHTNING) vira o 3º tipo de promoção do motor de operações em massa.
alter table public.operacoes_massa drop constraint operacoes_massa_promocao_tipo_check;
alter table public.operacoes_massa add constraint operacoes_massa_promocao_tipo_check
  check (promocao_tipo is null or promocao_tipo = any (array['DEAL'::text, 'SMART'::text, 'LIGHTNING'::text]));
