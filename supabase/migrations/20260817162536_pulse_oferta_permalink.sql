-- Pulse (ADR-0119): link do anúncio do concorrente na tabela de ofertas.
--
-- Pedido do operador: poder abrir o anúncio do concorrente direto da tela de detalhe. A URL NÃO
-- pode ser derivada do `item_id` — testado em 2026-08-17, `produto.mercadolivre.com.br/MLB-<n>`
-- (com e sem sufixo `-_JM`) não resolve — e `/items/{id}` de terceiro devolve 403 sempre, o que já
-- estava provado no ADR. Sobra uma única fonte possível: o `permalink` que a resposta de
-- `/products/{id}/items` traga, se trouxer.
--
-- Por isso a coluna é nullable e a leitura é oportunista: se a ficha expuser o campo, a tela mostra
-- o link; se não expuser, fica null e a tela não mostra link nenhum. Inventar uma URL provável
-- seria pior do que não linkar — link quebrado gasta o clique do operador e mina a confiança na
-- tela.
--
alter table public.pulse_ofertas
  add column if not exists permalink text;

comment on column public.pulse_ofertas.permalink is
  'URL do anúncio no ML, quando `/products/{id}/items` a expõe. Única fonte possível para anúncio de terceiro (/items/{id} de terceiro é 403) e não é derivável do item_id. null = não veio; a tela não linka.';

-- A view enumera colunas (não é `select *`), então a coluna nova não aparece nela sozinha — e é
-- daqui que o front e o próprio coletor leem o estado atual por item.
--
-- `permalink` vai no FIM da lista de propósito: `create or replace view` só aceita acrescentar
-- coluna no final; inseri-la no meio aborta com "cannot change name of view column". Substituir em
-- vez de dropar também preserva os grants existentes da view. `security_invoker=true` é repetido
-- porque `create or replace` não herda as reloptions — sem ele a view passaria a rodar com os
-- direitos do dono e furaria a RLS por organização.
create or replace view public.pulse_ofertas_atual
  with (security_invoker = true) as
  select distinct on (produto_id, item_id)
    id, org_id, produto_id, item_id, seller_id, preco, tier, frete_gratis, loja_oficial,
    ativo, dia, permalink
  from public.pulse_ofertas
  order by produto_id, item_id, dia desc;
