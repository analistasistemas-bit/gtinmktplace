# Aderir/sair da Relâmpago (LIGHTNING) pelo PubliAI — design

**Data:** 2026-11-02 · **Emenda de:** ADR-0174 (operações em massa) · **Relacionado:** ADR-0170 (Central de Promoções)

## Intenção

Hoje a tela de uma promoção Relâmpago (`/promocoes/LGH-…`) lista os convidados, mas não deixa
selecioná-los: o motor de operações em massa só aceita `DEAL` e `SMART`
(`src/pages/PromocaoDetalhe.tsx:90`, `supabase/functions/_shared/operacoes/validar.ts:23`). Diego precisa ir ao
Seller Center para aderir. Objetivo: aderir e sair da Relâmpago pelo mesmo fluxo da DEAL (selecionar → preview →
confirmar → Operações → Reverter), com as mesmas travas financeiras.

## Spike de escrita (feito em 02/11/2026, autorizado por Diego)

Avil, `MLB5244990621` (anúncio User Product sem variação própria, 0 vendas), Relâmpago `LGH-MLB1000`.

1. **Aderir:** `POST /seller-promotions/items/{id}?app_version=v2` com
   `{promotion_id, promotion_type:'LIGHTNING', deal_price: 24.65, stock: 5}` → **201**
   `{offer_id:'OFFER-…', price, original_price}`.
2. Logo após: visão da campanha (`/seller-promotions/promotions/{pid}/items?promotion_type=LIGHTNING&item_id=`) **e**
   visão por item (`/seller-promotions/items/{id}`) mostram `status:'pending'`, `ref_id` = o `OFFER-…`,
   `start_date`/`finish_date` atribuídos pelo ML (no spike: 06/11 00:00–11:59:59) e `stock.remaining_stock: 5`.
   `/items/{id}.price` segue o normal até a janela começar.
3. **Sair:** `DELETE /seller-promotions/items/{id}?promotion_type=LIGHTNING&promotion_id={pid}&offer_id={OFFER-…}&app_version=v2`
   → **200 corpo vazio**; na hora continua `pending`; em ≤ 5 min as duas visões voltam a `candidate` com o
   `ref_id` `CANDIDATE-…` original. Mesmo padrão assíncrono da SMART.
4. **Dados do convite (candidate):**
   - Visão da campanha traz só `price`, `original_price`, `min_discounted_price`, `stock{min,max}` — **sem**
     `max_discounted_price` nem `suggested_discounted_price`.
   - Visão por item traz `min_discounted_price`, `max_discounted_price`, `suggested_discounted_price`, `stock`.
   - O `min` difere entre as visões (campanha 8,70 × item 5,80 no spike).
   - O `price` do convite (28,13 no spike) **não** é o sugerido nem o preço atual; significado desconhecido.
     Pode ficar acima do máximo aceito (convite 18,43 × máximo 17,10 em outro anúncio).

Não testado: sair de Relâmpago já `started`; adesão de anúncio que já participa de DEAL/SMART; anúncio com
variações (modelo antigo).

## Comportamento

### Tela (PromocaoDetalhe + preview)
- Relâmpago não encerrada passa a ter checkboxes (como DEAL/SMART). Aba Convidados → **Aderir**; aba
  Participando → **Sair**.
- Preview de aderir: **preço editável por item**, padrão = `preco_sugerido`. Quantidade **não** aparece.
- Após aderir, a janela atribuída pelo ML (`start_date`–`finish_date`) aparece para o item participando
  (Central e/ou resultado da operação).
- Reverter disponível (aderir ↔ sair), como DEAL/SMART.

### Travas na validação (criação da operação) e na revalidação (execução)
1. Preço fora de `[preco_min, preco_max]` → recusado.
2. **Preço < R$ 19,00 → recusado** ("Abaixo de R$ 19 o comprador perde o frete grátis"). Regra do Diego.
   Vale só para Relâmpago nesta entrega.
3. Semáforo vermelho/indisponível → só com risco confirmado (igual DEAL).
4. Na execução, leitura fresca: não é mais convidado, faixa mudou e o preço saiu dela, ou já participando →
   item termina sem escrita (`mudou` / `ja_estava`), igual DEAL.
5. Estoque disponível do anúncio < `stock.min` exigido → `bloqueado` com mensagem clara.

### Escrita
- Aderir: `POST` com `{promotion_id, promotion_type:'LIGHTNING', deal_price: preço, stock: stock.min da leitura fresca}`.
  Guardar o `offer_id` devolvido (como SMART).
- Sair: `DELETE` com `promotion_type=LIGHTNING&promotion_id&offer_id` (offer_id da leitura fresca, `OFFER-…`).
- Conferência assíncrona como SMART: saída confirmada quando a visão volta a `candidate`; espelho na Central
  volta a `candidate` (a linha **não** é apagada — igual DEAL, diferente de SMART).

### Correção na Central (sync, ADR-0170)
- Para itens de Relâmpago, `preco_max` e `preco_sugerido` vêm da **visão por item**; o `preco_min` usado é o
  **maior** entre as duas visões (conservador). Sem isso o semáforo e o "Preço na promoção" da tela são
  calculados sobre o `price` do convite, que não serve.
- Consequência: `preco_avaliado` de um convidado Relâmpago passa a ser o sugerido real; semáforo e
  "Até quanto descer" ficam corretos.

## Decisões minhas (Claude) — Diego pode contestar
- Estoque enviado = **mínimo exigido** pelo ML (`stock.min`), para não prender unidades.
- Regra dos R$ 19 só na Relâmpago (não estendida a DEAL/SMART sem pedido).
- `min` conservador = maior das duas visões.
- Enriquecimento da visão por item só para itens de promoções `LIGHTNING`, dentro dos lotes já existentes do
  sync (respeitar o orçamento de CPU do ADR-0173; usar `emParalelo` com concorrência baixa).

## Respostas do builder check (02/11) — verificadas ou decididas por Claude

1. **Linha duplicada:** com `item_id=` a visão da campanha devolve **1 linha** (medido em 2 itens da Avil +
   o do spike). A leitura fresca segue com `results[0]`. (A duplicação do sync é de paginação sem filtro e
   continua tratada por `umaOfertaPorAnuncio`.)
2. **Id da oferta = `ref_id`** nas duas visões (`CANDIDATE-…` convidado, `OFFER-…` participando). O POST devolve
   `offer_id`. O leitor fresco deve ler `ref_id` quando `offer_id` faltar (LIGHTNING).
3. **Leitura fresca LIGHTNING = as duas visões:** status e `ref_id` da **campanha** (regra do ADR-0174);
   `max`, `suggested` e `min` da **visão por item**; `min` efetivo = maior dos dois; `stock.min` de qualquer
   uma (iguais no spike). 2 GETs por item só em LIGHTNING. Visão por item falhou/ausente → `erro` (sem
   escrita), nunca inventar faixa.
4. **Estoque disponível** = `available_quantity` do `/items` (acrescentar ao multiget que `lerRelacoes` já faz;
   sem chamada extra). Modelo antigo com variações: o ML considera o total do item — usar o do item.
   Checado só na execução (`bloqueado`).
5. **Preview:** mostra por item, informativo, "reserva N un." (N = `estoque_min` da Central). Sem input.
6. **R$ 19** vale sobre o `deal_price` pedido (o que o app envia).
7. **Espelho pós-aderir:** status da campanha (`pending`/`started`), como hoje. **Janela** (`start_date`–
   `finish_date`) vai na `mensagem` do item da operação ("Agendada: 06/11 00:00–11:59"), lida na
   conferência. Sem coluna nova em `ml_promocao_itens` (ponytail: coluna se a Central precisar filtrar por
   janela).
8. **Coluna "Preço na promoção"** do convidado Relâmpago = `preco_sugerido` (via `preco_avaliado`). Sync sem
   visão por item para a linha → `preco_max`/`preco_sugerido` null → semáforo `indisponivel` e a validação
   recusa ("O ML não informou a faixa"), como DEAL hoje.
9. **Sair de `started`:** a UI deixa tentar; a conferência existente decide (saída não confirmada em 24 h).

## Ajustes obrigatórios (revisão Grok 4.7 xhigh, 02/11) — bloqueiam a implementação se ausentes

1. **Ramo próprio de LIGHTNING no preço (criação e execução).** Hoje todo tipo ≠ DEAL usa `preco_promo`
   (`validar.ts:82-83`), a faixa só roda em DEAL (`validar.ts:73-80`) e na execução faixa nula não barra
   (`decidir.ts:38`). LIGHTNING: preço = o do pedido; faixa **fechada** (min ou max null → recusa na criação /
   `erro` sem POST na execução); piso R$ 19; tudo isso **fora** do atalho de `confirmado_risco`
   (`executar.ts:81-88`). Front: `preview-operacao.tsx:70/:93` (preço editável e enviado só p/ DEAL) e os 3
   lugares que forçam `'DEAL'` (`PromocaoDetalhe.tsx:265`, `lista-participando.tsx:83`, `lista-operacoes.tsx:310`)
   passam a repassar `'LIGHTNING'`.
2. **Conferência nunca confirma saída por leitura incompleta.** Visão por item = lista de promoções do
   anúncio → filtrar `id === promocaoId && type === 'LIGHTNING'`. Visão da campanha: entre linhas do mesmo MLB,
   preferir a participando (`OFFER-…`), defensivo mesmo com `item_id=` devolvendo 1 linha. Status e `ref_id`
   **só da campanha**. Falha da visão por item → conferência **reagenda** (não vira `null`/"saiu"). DELETE só
   com `ref_id` `OFFER-…`; `CANDIDATE-…` → `erro`.
3. **Estoque nunca vazio.** `stock.min` null, ou mins diferentes entre as visões → `erro` sem POST.
   `available_quantity` null → `bloqueado`; `< stock.min` → `bloqueado`. Checagem em `decidir`, alimentada pelo
   mesmo multiget de `lerRelacoes` (`executar.ts:57`).
4. **Semáforo/janela:** no sync, convidado LIGHTNING grava `preco_promo = null` (o `price` do convite não serve)
   para `precoAvaliado` cair no sugerido ou ficar indisponível. Participando segue `price` (= `deal_price`
   gravado, conferido no spike: 24,65). Janela: releitura da campanha **logo após o POST** grava a mensagem
   "Agendada: dd/mm hh:mm–hh:mm" no item `aplicado` (`executar.ts:89`); `executar.ts` entra nas peças.
5. **Sync resiliente e redeploy completo:** GET por item dentro do lote (teto 100/mensagem,
   `sincronizar-promocoes/index.ts:18`), concorrência baixa, falha **degrada a linha** (faixa null), nunca
   `falhar` a rodada. Redeploy: `operacoes-massa`, `sincronizar-promocoes`, `ads-campanhas`, `coletar-ads-ml`,
   `coletar-trafego-ml` (importam `_shared/promocoes`).

## Não-objetivos
- Escolher quantidade ou horário da Relâmpago.
- Sair de Relâmpago `started` (não testado — se a saída não confirmar em 24 h, cai no fluxo de saída não
  confirmada que já existe para DEAL/SMART).
- Mudar comportamento de DEAL/SMART.

## Anti-objetivos (falha mesmo funcionando)
- Enviar ao ML preço < R$ 19,00 ou fora da faixa.
- Reservar estoque além do mínimo sem o Diego pedir.
- Sync da Central estourar CPU (incidente ADR-0173) por causa do enriquecimento.

## Peças afetadas (para o plano)
- Migration: `operacoes_massa_promocao_tipo_check` aceitar `'LIGHTNING'` (`supabase migration new` + `db push`).
- `_shared/operacoes/`: `tipos.ts` (TipoPromocao), `validar.ts` (TIPOS + faixa + R$ 19), `decidir.ts`
  (post/delete LIGHTNING, estoque), `ml.ts` (leitura fresca da visão por item p/ LIGHTNING, `stock`),
  `deps.ts` (espelho: saiu → candidate), testes em `__tests__/`.
- `_shared/promocoes/`: `ml.ts`/`sincronizar.ts`/`deps.ts` (enriquecimento por item p/ LIGHTNING), testes.
- Front: `PromocaoDetalhe.tsx`, `preview-operacao.tsx`, `lib/operacoes.ts` (`montarPreview`), `lib/promocoes.ts`
  (`operavel`), `lista-participando.tsx`, `lista-operacoes.tsx` (tipo no Reverter), testes.
- Deploy: `operacoes-massa` e `sincronizar-promocoes` (e qualquer outra que importe os `_shared` alterados).
- Docs: emenda no ADR-0174 (antes do código), `docs/reference/edge-functions.md` se mudar contrato.
