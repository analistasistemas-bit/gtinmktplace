-- ADR-0200 (adendo 12/11): galeria de fotos das peças no anúncio do kit.
-- Referência, não cópia: `[{ "id": "<picture_id no ML>", "item": "<MLB da peça de origem>" }]`, na ordem do anúncio.
-- Vazio = só a foto do kit. Coluna nova não muda o acesso: valem as policies já existentes de `variacoes`; a edge e o
-- worker escrevem com service role filtrando por org_id. Nenhum trigger de kit olha esta coluna.
alter table public.variacoes
  add column if not exists galeria_ml_fotos jsonb not null default '[]'::jsonb;

alter table public.variacoes
  drop constraint if exists variacoes_galeria_ml_fotos_array;
alter table public.variacoes
  add constraint variacoes_galeria_ml_fotos_array check (jsonb_typeof(galeria_ml_fotos) = 'array');

comment on column public.variacoes.galeria_ml_fotos is
  'Kit com variação: fotos das peças reaproveitadas no anúncio, [{id,item}] (ADR-0200, adendo 12/11). Vazio = só a foto do kit.';
