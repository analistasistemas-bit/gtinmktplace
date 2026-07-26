-- Migration: indice_unico_conta_externa_ml
-- ADR-0091. Uma conta de marketplace não pode pertencer a duas organizações.
--
-- Hoje `marketplace_connections` só tem `unique (org_id, canal)` (20260705171224:23), então a
-- MESMA conta do ML pode acabar em duas orgs. Isso não degrada em silêncio: `resolverIdentidade`
-- (_shared/faturamento/io.ts:16) resolve o vendedor com `.maybeSingle()`, que ERRA com 2 linhas e
-- devolve null — o `ml-webhook` então trata como "vendedor desconhecido", devolve ACK 200 e
-- DESCARTA o evento. Ou seja, uma conta duplicada derruba os webhooks das DUAS orgs, sem erro
-- visível: vendas, perguntas e devoluções param de chegar.
--
-- Consequência de produto, assumida de propósito (ADR-0091): um mesmo vendedor ML deixa de poder
-- estar conectado a duas orgs. Antes isso era tecnicamente permitido e quebrava tudo em silêncio;
-- agora vira falha explícita na hora de conectar, com mensagem clara (o `ml-oauth-claim` traduz o
-- 23505 para "esta conta já está conectada em outra organização").
--
-- Aditivo e independente das mudanças de código — pode ser aplicado antes delas.
-- Verificado em produção em 2026-07-25 (`select conta_externa_id, count(*) ... having count(*) > 1`):
-- nenhuma duplicata, então o índice aplica limpo.
--
-- Não quebra a renovação de token: o refresh (_shared/ml/token.ts:81-91) reescreve
-- `conta_externa_id` com o próprio valor da linha existente, o que não colide consigo mesmo.

create unique index if not exists marketplace_connections_canal_conta_uniq
  on public.marketplace_connections (canal, conta_externa_id)
  where conta_externa_id is not null;
