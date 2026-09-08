-- ADR-0161 — estado da migração "preço por variação" (UPtin) disparada pelo PubliAI.
--
-- Mora na RAIZ `anuncios_externos` (partição 0), não em `familias`: há N linhas em `familias` por
-- `codigo_pai` (uma por lote de ingest), e cada consumidor escolhe uma diferente — a tela Publicados
-- usa a MAIS ANTIGA (`src/lib/publicados.ts:82-101`), enquanto `ingest-lote` e `sincronizar-estoque`
-- usam a MAIS NOVA. Estado gravado na família do botão seria invisível para metade do sistema. A
-- raiz é única por `(org_id, canal, codigo_pai, particao)` e já carrega os marcadores transitórios
-- do ADR-0088 (`estado_desejado`, `mudando_composicao`).
--
-- Colunas novas em vez de reusar `estado_desejado`: aquela coluna tem CHECK `in ('ativando',
-- 'pausando')` e semântica de ativação/pausa em lote; alargá-la erodiria a regra afiada do ADR-0088
-- ("`ativando` que esgota → erro, só `pausando` → pausado").

alter table public.anuncios_externos
  -- Ciclo de vida do episódio. NULL = nenhuma migração em curso (estado normal, inclusive DEPOIS de
  -- concluída: é marcador transitório, não histórico).
  --   solicitada   → gravado ANTES do POST no ML (o disparo pode ter acontecido mesmo se a chamada
  --                  falhou: a idempotência do endpoint não é documentada, então o app nunca
  --                  repete o POST — o worker consulta o status para descobrir).
  --   em_andamento → o ML confirmou que a migração está em curso.
  --   erro         → orçamento esgotado sem `activation_completed`, ou adoção abortada. Exige o
  --                  operador; nunca some sozinho.
  add column if not exists migracao_pxv_status text
    check (migracao_pxv_status in ('solicitada', 'em_andamento', 'erro')),

  add column if not exists migracao_pxv_erro text,
  add column if not exists migracao_pxv_solicitada_em timestamptz,

  -- Orçamento de rodadas do worker. Base do claim atômico por tentativa (o mesmo padrão de
  -- `reconciliacao_tentativas`/`reconciliar_convergencia_claim` do ADR-0088): sem ele, um 500 no
  -- worker faz o QStash retentar enquanto a rodada anterior já se re-enfileirou, e duas cadeias
  -- paralelas chegam ao desfecho — adotando duas vezes e notificando duas vezes.
  add column if not exists migracao_pxv_tentativa integer not null default 0,

  -- Fotografia de `variations[]` tirada ANTES do POST: [{ id, seller_custom_field, cor }].
  --
  -- É o que torna a migração pelo app mais confiável que a manual. Depois que o ML encerra o item
  -- original, `variations[]` pode não estar mais lá (a doc do UPtin diz que "deixa de existir", sem
  -- esclarecer se vale para o original), e a descoberta por título do ADR-0105 pode casar com uma
  -- FAMÍLIA IRMÃ do mesmo vendedor — mesmo título, mesmas cores — e adotar os itens do produto
  -- errado. Com o snapshot, o casamento usa apenas ids que o ML atribuiu a ESTE item.
  --
  -- NÃO é limpo ao concluir: continua servindo o faturamento, que resolve pedido antigo por
  -- `"{ml_item_id_anterior}:{variation_id}" → sku` sem depender do SKU vir no pedido.
  add column if not exists migracao_pxv_snapshot jsonb,

  -- O `ml_item_id` que a família tinha antes da migração. A adoção re-aponta `familias.ml_item_id`
  -- para um dos clones, e o id antigo sumiria do conjunto `idsPubliai`
  -- (`_shared/faturamento/io.ts:82-86`) — um pedido antigo reprocessado (reconciliação, backfill,
  -- webhook atrasado) deixaria de ser reconhecido como venda do PubliAI, ficando sem produto, sem
  -- custo e fora dos números do app. Foi essa classe de falha que, em 2026-08-11, fez 12 unidades
  -- venderem sem baixar estoque. Persistido para sempre.
  add column if not exists ml_item_id_anterior text;

comment on column public.anuncios_externos.migracao_pxv_status is
  'ADR-0161: episódio de migração UPtin (preço por variação) em curso. NULL = nenhum.';
comment on column public.anuncios_externos.migracao_pxv_snapshot is
  'ADR-0161: variations[] do item ANTES da migração ([{id, seller_custom_field, cor}]). Nunca limpo — o faturamento resolve pedido antigo por ele.';
comment on column public.anuncios_externos.ml_item_id_anterior is
  'ADR-0161: ml_item_id anterior à migração. Continua contando como anúncio do PubliAI para vendas antigas.';

-- Só uma migração por vez em toda a org: o índice é o que dá o claim atômico do disparo
-- (`update ... where migracao_pxv_status is null returning`) uma rede de segurança contra clique
-- duplo e dois admins simultâneos. Parcial para não custar nada nas linhas em repouso.
create index if not exists anuncios_externos_migracao_pxv_ativa_idx
  on public.anuncios_externos (org_id, migracao_pxv_status)
  where migracao_pxv_status is not null;
