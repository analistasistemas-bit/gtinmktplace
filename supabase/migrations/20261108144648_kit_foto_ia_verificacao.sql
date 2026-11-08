-- ADR-0200, Adendo 1: foto do kit por IA com ficha estruturada e verificação automática.
--
-- Cada tentativa (1..3) de um mesmo request_id vira uma linha. A reprovada pela verificação fica `recusada` com o
-- custo real e os motivos (`verificacao`), fora da cobrança; a seguinte recebe os motivos no pedido. A cobrança
-- (gatilho da 20261108094500) continua disparando só em `gerada` e é única por (org, request_id) em
-- platform_image_deliveries.
--   * unique (org_id, request_id, tentativa): duas execuções nunca criam a mesma tentativa.
--   * índice único parcial (org_id, request_id) fora de `recusada`: no máximo uma tentativa viva (pendente,
--     pendente_upload ou gerada) por pedido. Duas tentativas em paralelo, ou uma 2ª `gerada`, são impossíveis.
--   * `ficha`: ficha estruturada da peça (visão + hex amostrado em código) e as fotos de origem usadas; calculada na
--     1ª tentativa e copiada para as seguintes.
--   * `verificacao`: resultado item a item da 2ª leitura por visão e os motivos da reprovação.
-- Escrita só por service role (RLS sem policy, como antes). Re-executável.

alter table public.kit_variacao_imagens
  add column if not exists tentativa smallint not null default 1,
  add column if not exists ficha jsonb,
  add column if not exists verificacao jsonb;

alter table public.kit_variacao_imagens drop constraint if exists kit_variacao_imagens_tentativa_check;
alter table public.kit_variacao_imagens
  add constraint kit_variacao_imagens_tentativa_check check (tentativa between 1 and 3);

alter table public.kit_variacao_imagens drop constraint if exists kit_variacao_imagens_org_id_request_id_key;
alter table public.kit_variacao_imagens drop constraint if exists kit_variacao_imagens_org_request_tentativa_key;
alter table public.kit_variacao_imagens
  add constraint kit_variacao_imagens_org_request_tentativa_key unique (org_id, request_id, tentativa);

create unique index if not exists kit_variacao_imagens_viva_uidx
  on public.kit_variacao_imagens (org_id, request_id) where status <> 'recusada';

comment on column public.kit_variacao_imagens.tentativa is
  'ADR-0200 Adendo 1: tentativa 1..3 do mesmo request_id. Só a aprovada pela verificação vira gerada (cobrável).';
comment on column public.kit_variacao_imagens.ficha is
  'ADR-0200 Adendo 1: ficha estruturada da peça por visão + hex amostrado em código + fotos de origem por cor.';
comment on column public.kit_variacao_imagens.verificacao is
  'ADR-0200 Adendo 1: verificação por visão item a item (aprovado calculado em código) e motivos da reprovação.';
