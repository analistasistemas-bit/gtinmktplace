-- ADR-0021 (revisão pós-incidente 2026-06-15): trava de equivalência antes do opt-in.
-- O match por GTIN do ML pode apontar para uma ficha de catálogo de KIT (ex.: "Kit 5 Unidades")
-- ou de dimensão divergente carregando o GTIN da unidade avulsa. Vincular a essas fichas faz
-- o cliente comprar 1 esperando 5. Novo estado 'ficha_divergente' registra a ficha rejeitada
-- pela trava (kit/metragem) sem forçar o opt-in.
alter table public.variacoes drop constraint if exists variacoes_catalog_status_check;
alter table public.variacoes add constraint variacoes_catalog_status_check
  check (catalog_status in ('pendente','vinculado','sem_produto','family_diff','nao_elegivel','erro','ficha_divergente'));
