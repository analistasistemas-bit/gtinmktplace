-- ADR-0116 — visibilidade do que o pipeline de título descarta.
--
-- validarSlotsAncorados derruba marca, sinônimo e marketing não-ancorado; montarTitulo corta
-- slots inteiros ao estourar 60 caracteres. Tudo em silêncio: não havia como responder "quantos
-- títulos este guard afetaria?" antes de mexer num guard, e por isso toda discussão sobre
-- prioridade de termos era opinião.
--
-- Puramente diagnóstica: nenhuma decisão do pipeline lê esta coluna. Anulável e sem default —
-- família antiga fica NULL, que se lê como "gerada antes do diagnóstico existir", diferente de
-- '[]', que significa "processada e nada foi descartado".
alter table public.familias
  add column if not exists titulo_descartes jsonb;

comment on column public.familias.titulo_descartes is
  'ADR-0116. Diagnóstico do pipeline de título: lista de {slot, etapa, de, para} registrando o '
  'que cada etapa (normalizacao|guards|ancoragem|corte) alterou ou removeu. para="" é descarte '
  'total; outro valor é reescrita. NULL = família anterior ao diagnóstico. Só leitura humana e '
  'censo — nenhum código de produção decide com base nela.';
