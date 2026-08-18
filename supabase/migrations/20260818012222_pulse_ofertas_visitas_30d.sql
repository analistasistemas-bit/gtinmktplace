-- Pulse Sonar (ADR-0120): visitas dos últimos 30 dias do anúncio do concorrente.
--
-- Fonte: `/items/{id}/visits/time_window?last=30&unit=day`, um dos dois endpoints que a Errata 9 do
-- ADR-0119 mediu vivos para item de TERCEIRO (42 visitas/30d num item de concorrente) — ao
-- contrário de `/items/{id}`, que segue 403. É a única medida de demanda por anúncio que a API
-- oficial entrega.
--
-- Nullable e sem default: `null` significa "não medido" — nunca zero. Zero visitas em 30 dias é uma
-- afirmação forte sobre o concorrente e só pode sair de uma leitura bem-sucedida; a coleta falhando
-- (429, timeout, endpoint mudou) grava null e a tela mostra "—". Um default 0 faria a coluna mentir
-- exatamente no dia em que o ML estivesse fora do ar.
alter table public.pulse_ofertas
  add column if not exists visitas_30d integer;

comment on column public.pulse_ofertas.visitas_30d is
  'Visitas do anúncio nos últimos 30 dias (/items/{id}/visits/time_window). Medido só no baseline diário — o tier quente de 6/6h não remede. null = não medido (nunca zero).';

-- A view enumera colunas (não é `select *`), então a coluna nova não aparece nela sozinha — e é
-- daqui que o front lê o estado atual por item.
--
-- `visitas_30d` vai no FIM da lista de propósito: `create or replace view` só aceita acrescentar
-- coluna no final; inseri-la no meio aborta com "cannot change name of view column". Substituir em
-- vez de dropar também preserva os grants existentes da view. `security_invoker=true` é repetido
-- porque `create or replace` não herda as reloptions — sem ele a view passaria a rodar com os
-- direitos do dono e furaria a RLS por organização.
create or replace view public.pulse_ofertas_atual
  with (security_invoker = true) as
  select distinct on (produto_id, item_id)
    id, org_id, produto_id, item_id, seller_id, preco, tier, frete_gratis, loja_oficial,
    ativo, dia, permalink, visitas_30d
  from public.pulse_ofertas
  order by produto_id, item_id, dia desc;
