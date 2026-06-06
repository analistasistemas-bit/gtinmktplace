# ADR-0017 — Selo de desconto ("% OFF") via API de Promoções do ML (estacionado)

**Status:** Aceito (decisão de estacionar) — 2026-06-06
**Relacionado:** ADR-0008 (estratégia de preço), ADR-0016 (publicação UPDATE), ADR-0007 (modelo de dados)
**Spec/plano:** `docs/superpowers/specs/2026-06-06-falso-desconto-marketing-design.md`, `docs/superpowers/plans/2026-06-06-falso-desconto-marketing.md`

## Contexto

Diego quer que os anúncios exibam o selo **"X% OFF"** com o preço cheio riscado (de/para), como gatilho de conversão. Como a Daludi vende abaixo do mercado, o desconto seria de **marketing**: vender no preço-alvo e exibir um "de" inflado.

A 1ª implementação (aprovada e construída) setava `original_price` por variação no payload de `/items` (CREATE e UPDATE), com `%` global em `configuracoes.desconto_pct`, override por família, opt-in por família e toggle por lote.

## Investigação (validada contra a API real, token AVILBV, 2026-06-06)

1. **`original_price` no `/items` foi descontinuado** para exibição. Após o PUT com `original_price`, o item retornou `original_price: null` — o ML **descarta** o campo; nenhum selo aparece. (Doc oficial: API de Preços confirma a descontinuação.)
2. O selo "% OFF" vem do recurso **`/seller-promotions`**, tipo **`PRICE_DISCOUNT`**: `POST /seller-promotions/items/{id}?user_id={uid}` com `{ promotion_type: "PRICE_DISCOUNT", deal_price, start_date, finish_date }`. O desconto incide sobre o **preço atual do item** (o "de"); `deal_price` é o preço de venda exibido. Para preservar margem, o **preço base do item passaria a ser o "de" inflado** e a promoção traria ao preço real.
3. **Bloqueios externos confirmados na API real:**
   - Todos os endpoints `/seller-promotions/*` retornam **403 `PolicyAgent` / "Invalid caller.id"** — a app PubliAI **não tem a permissão/escopo de promoções**.
   - `GET /users/me` da AVILBV: `seller_reputation.level_id: null` e `transactions.completed: 0`. O `PRICE_DISCOUNT` individual exige **reputação verde + ≥1 venda concluída** — a conta **não qualifica** hoje.
4. Há ainda um **teto do ML** (`max_discounted_price`) que limita quão "fundo" o desconto pode parecer (regra anti-desconto-falso) — o `%` exibido não é 100% controlável pelo vendedor.

## Decisão

**Estacionar a integração do selo.** O selo não é alcançável hoje para esta conta — não por código, mas por pré-requisitos externos (permissão da app no portal ML + reputação/vendas do vendedor). Nenhuma reescrita de código contorna isso.

Mantém-se a infraestrutura já construída, **dormente**:
- Tabela `configuracoes` (`desconto_pct`, default 15) e colunas `familias.exibir_com_desconto` / `familias.desconto_pct` (migration aplicada).
- UI: card do % em Configurações, checkbox + % + prévia por família, toggle por lote. A prévia calcula o de/para corretamente (sobre o `preco_publicacao`).
- Workers (`publish-familia-ml` v10, `update-familia-ml` v8) enviam `original_price` — **inofensivo** (o ML ignora), porém é código morto. No UPDATE, com o flag ligado, o worker passou a reenviar `price = preco_publicacao` nas variações existentes (antes só estoque) — sem efeito prático quando `preco_publicacao` == preço publicado.

## Consequências

- O selo "% OFF" **não funciona** até que: (a) a app PubliAI ganhe a permissão de promoções no portal ML Developers (resolve o 403), **e** (b) a AVILBV tenha reputação verde + vendas concluídas.
- Quando os pré-requisitos forem atendidos, ligar via **`PRICE_DISCOUNT`** (endpoint/payload já mapeados acima), validando `max_discounted_price` por item e tratando o **ciclo de vida** da promoção (datas + renovação perpétua; se a promoção lapsar, o item venderia pelo "de" inflado).
- Dívida técnica a limpar quando se retomar ou abandonar: remover o `original_price` dos workers (código morto) e decidir o destino da UI dormente.

## Alternativas consideradas

- **`original_price` no item:** descontinuado/ignorado. Descartado (validado).
- **Histórico de preço real** (subir o preço e baixar para o ML mostrar a queda): perde margem ou é operacionalmente estranho, e provavelmente também sujeito a reputação/regras. Descartado por ora.
