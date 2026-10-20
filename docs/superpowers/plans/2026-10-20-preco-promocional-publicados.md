# Preço promocional em Publicados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anúncio ML em promoção → coluna "Preço atual" de Publicados mostra o preço promocional (o que o comprador paga), o preço "de" riscado e a badge "Em promoção"; a análise/margem da linha usa o promocional; a primeira carga mostra a logo PubliAI pulsando até o status ao vivo chegar.

**Architecture:** A edge `status-publicados` passa a ler, para TODO anúncio ML não-kit, `GET /items/{id}/sale_price?context=channel_marketplace` (pool limitado, timeout por chamada), em paralelo ao `lerStatus` em lote. `amount` vira `preco`; `regular_amount` não nulo vira `precoOriginal` (= está em promoção). O front já usa `precoAtual` (= `preco`) na célula, na ordenação e no `PainelAnalise` (`precoOverride` → tarifa e margem), então a margem segue o promocional sem mudança extra.

**Tech Stack:** Supabase Edge Function (Deno/TS), React + TS, TanStack Query, Vitest.

**Spec:** desenho aprovado no chat em 2026-10-20 + revisão Codex gpt-6.1-sol (APROVADO COM AJUSTES, 5 itens incorporados abaixo). Decisões:
- **Diego:** margem/análise usa o preço promocional.
- **Diego:** consultar `/sale_price` de TODOS os anúncios ML (promoção aparece na hora, inclusive em org sem a Central de Promoções, ex. Avil); custo aceito ≈ +3–4 s na Avil por carga (cache 5 min).
- **Diego:** enquanto carrega, logo PubliAI pulsando (`CarregandoMarca`).
- **Agente:** `CarregandoMarca` só na 1ª carga (sem `statusData`); refetch ("Atualizar") mantém a tabela + spinner como hoje.
- **Agente:** "Criar kit" usa o preço de venda sem promoção (`precoOriginal ?? precoAtual`) — kit não herda desconto temporário.
- **Agente (fora de escopo, pré-existente):** em família multicor/UP o `precoOverride` é o da 1ª cor e o custo vem da variação de menor preço (`painel-analise.tsx:82`, `analise-viabilidade.ts:31`). Não piora com esta mudança; fica documentado, sem correção aqui.

Fato medido (spike 052 §3, 270 MLBs Avil, 27/09): `/sale_price` sempre 200 com `amount`; sem promoção `regular_amount: null`; com promoção `regular_amount` = preço "de", `amount` = "por". Latência mediana 250 ms, máx 300 ms. Pausado/encerrado também devolvem preço.

## Global Constraints

- Reusar `parseSalePrice` (`supabase/functions/_shared/trafego/parsers.ts:87`) e `pool` (`supabase/functions/_shared/concorrencia/pool.ts`). Não reusar `lerPrecoKitML` (descarta `regular_amount`, sem timeout).
- Concorrência do pool: **10**. Timeout por chamada: **5 s** (`AbortSignal.timeout(5_000)`).
- Falha/timeout/shape inválido de UM item → aquele item mantém `preco` do `/items` e fica sem `precoOriginal`. Nunca derruba a resposta.
- Promoção = `precoRegular != null && precoRegular > preco`. Qualquer outro caso → sem `precoOriginal`.
- Kit Virtual: fora (já lê `/sale_price` em `enriquecerKits`).
- Badge: `StatusPill` tone `success`, texto exato `Em promoção`. Preço "de": `line-through`, `text-xs text-muted-foreground`.
- Sem migration, sem tabela nova, sem escrita no ML.
- Edge alterada → após merge, `supabase functions deploy status-publicados` + conferir versão.

## Review Focus

1. Timeout de uma chamada `/sale_price` não pode segurar a resposta além de ~5 s por item nem derrubar as demais — teste na Task 1.
2. Tela Estoque (`produto-card.tsx:258`) passa a mostrar o promocional como "preço ML" (mesma fonte) — comportamento aceito, coberto por teste na Task 2.
3. Org sem conexão ML / `lerStatus` falhou → nenhuma chamada `/sale_price` (sem token) — teste na Task 1.
4. Família UP: `precoOriginal` sobrevive ao `agregarStatusUP` (spread `...base`) — teste na Task 2.
5. Estoque com envio pendente faz refetch do status a cada 15 s (`produto-card.tsx:251`) → a varredura `/sale_price` inteira se repete enquanto aguarda o ML. Aceito (pool 10, ~4 s na Avil, só com card aberto aguardando); registrar com comentário `ponytail:` no ponto da chamada.
6. Linhas "Publicação incompleta" e Kit Virtual: sem badge (não mudar).

---

### Task 1: Edge lê `/sale_price` de todos os anúncios ML

**Files:**
- Create: `supabase/functions/_shared/ml/sale-price.ts`
- Modify: `supabase/functions/status-publicados/processar.ts`, `supabase/functions/status-publicados/index.ts`
- Test: `supabase/functions/status-publicados/__tests__/processar.test.ts`, `supabase/functions/_shared/ml/__tests__/sale-price.test.ts`

**Interfaces:**
- Produces: `lerSalePriceML(token: string, itemId: string): Promise<PrecoObservado | null>` (nunca lança; `fetch` com `AbortSignal.timeout(5_000)`, resposta via `parseSalePrice`).
- Produces: `DepsStatusPublicados.lerSalePrice: typeof lerSalePriceML`.
- Produces: `ItemStatusPublicados.precoOriginal?: number` — presente só em promoção; aí `preco` = `amount`.

- [ ] **Step 1: Testes que falham.**
  - `sale-price.test.ts` (mock de `fetch`): 200 com promoção → `{preco: 12.69, precoRegular: 14.1, moeda: 'BRL'}`; 500 → `null`; fetch rejeita (timeout/rede) → `null`.
  - `processar.test.ts`, `describe('preço de venda (/sale_price)')`, dep `lerSalePrice` injetada (default do helper `deps`: `vi.fn(async () => null)`):
    - `em promoção: preco = amount e precoOriginal = regular_amount` — MLB-PROMO → `{preco: 19, precoRegular: 29.9}` ⇒ `{preco: 19, precoOriginal: 29.9}`.
    - `sem promoção: preco = amount, sem precoOriginal` — `{preco: 9.9, precoRegular: null}` ⇒ `preco 9.9`, sem a chave `precoOriginal`.
    - `regular_amount não maior que amount: sem precoOriginal` — `{preco: 9.9, precoRegular: 9.9}`.
    - `falha de um item não derruba os outros` — A → null, B → promo ⇒ A `preco 9.9` (do fakeConnector) sem `precoOriginal`; B com promo.
    - `kit não passa pelo /sale_price comum` — kit publicado ⇒ `lerSalePrice` nunca chamado com o id do kit.
    - `sem conexão ML: nenhuma chamada` — `resolverConexao` → null ⇒ `lerSalePrice` não chamado.
    - Atualizar o 1º teste existente (`org sem kit nenhum…`) para o novo dep (default null ⇒ resposta idêntica à de hoje).
- [ ] **Step 2:** `npx vitest run supabase/functions/status-publicados supabase/functions/_shared/ml/__tests__/sale-price.test.ts` → FALHA.
- [ ] **Step 3: Implementar.** `sale-price.ts` como na Interface. Em `montarStatusPublicados`, no canal `mercado_livre`: rodar `pool(10, idsNaoKit, id => deps.lerSalePrice(token, id))` **em paralelo** com `conn.lerStatus` (`Promise.all`); depois, para cada item com observado não nulo: `preco = observado.preco`; se `precoRegular != null && precoRegular > preco` → `precoOriginal = precoRegular`. Falha do token/pool → `console.warn('status_publicados_sale_price_falhou', …)` e segue com o preço do `/items`. `index.ts` injeta `lerSalePrice: lerSalePriceML`.
- [ ] **Step 4:** mesmo comando → PASS (todos).
- [ ] **Step 5: Commit** `feat(publicados): status ao vivo lê /sale_price (preço de venda e preço "de")`.

### Task 2: Tela Publicados — promo, badge, kit no preço sem promoção, logo pulsando

**Files:**
- Modify: `src/lib/queries.ts` (`StatusPublicadoItem.precoOriginal?: number`)
- Modify: `src/lib/publicados.ts` (`PublicadoItem.precoOriginal?: number | null`)
- Modify: `src/pages/Publicados.tsx` — merge (~l.1300), célula "Preço atual" (~l.388), `handleCriarKit` (~l.1276), carregamento (~l.1421)
- Test: `tests/pages/Publicados.test.tsx`, src/components/estoque/__tests__/produto-card.test.tsx (Estoque)

**Interfaces:**
- Consumes: `precoOriginal` da Task 1.

- [ ] **Step 1: Testes que falham** (`tests/pages/Publicados.test.tsx`, padrão `exibe o selo do modo (Premium)`):
  - `em promoção: preço promocional, preço "de" riscado e badge` — status `{ml_item_id:'MLB1', preco: 19, precoOriginal: 29.9, …}` ⇒ `R$ 19,00`; `R$ 29,90` com classe `line-through`; `Em promoção`.
  - `sem promoção: sem badge` ⇒ `queryByText('Em promoção')` null.
  - `UP: precoOriginal do principal sobrevive à agregação dos filhos` — item com `mlItemIdsUP` e status do principal com `precoOriginal` ⇒ badge visível.
  - `primeira carga do status: logo pulsando no lugar da tabela` — `useStatusPublicadosMock` `{data: undefined, isFetching: true}` ⇒ `getByRole('status')` e sem `columnheader` "Preço atual".
  - `refetch com dados: tabela continua visível` — `{data: {...}, isFetching: true}` ⇒ tabela presente, sem o `role=status` do CarregandoMarca.
  - `Criar kit em promoção parte do preço sem promoção` — abre o diálogo com item em promoção ⇒ base de preço 29.9 (mesmo padrão dos testes `botão Criar kit`).
  - Estoque: teste do produto-card com status `preco: 19, precoOriginal: 29.9` ⇒ mostra `R$ 19,00` (documenta que Estoque segue o preço de venda).
- [ ] **Step 2:** `npx vitest run tests/pages/Publicados.test.tsx src/components/estoque/__tests__/produto-card.test.tsx` → FALHA.
- [ ] **Step 3: Implementar.** Merge: `precoOriginal: s.precoOriginal ?? null`. Célula: quando `precoOriginal != null`, abaixo do preço, coluna com o preço "de" riscado + `<StatusPill tone="success">Em promoção</StatusPill>`. `handleCriarKit`: `precoAtual: item.precoOriginal ?? item.precoAtual ?? item.precoPublicacao` + comentário. Carregamento: `loadingPublicados || (!statusData && fetchingStatus)` ⇒ `<CarregandoMarca rotulo="Carregando" mensagem="Lendo preços e status no Mercado Livre…" />` (substitui o texto "Carregando publicados...").
- [ ] **Step 4:** testes PASS + `pnpm preflight:static` verde.
- [ ] **Step 5: Commit** `feat(publicados): preço promocional, preço "de" riscado, badge e logo pulsando na 1ª carga`.

### Task 3: Docs, revisão, entrega

**Files:**
- Modify: `docs/decisions/0170-central-de-promocoes-ml.md` (emenda 2026-10-20: Publicados lê `/sale_price` de todos os anúncios; `regular_amount` define a promoção; Central de Promoções não é fonte)
- Modify: `docs/reference/edge-functions.md` (status-publicados: `/sale_price`, pool 10, timeout 5 s, `precoOriginal`) + itens da skill `docs-update-checklist`

- [ ] **Step 1:** docs conforme `docs-update-checklist`; commit `docs: emenda ADR-0170 — preço promocional em Publicados`.
- [ ] **Step 2:** revisão do diff da branch pelo Codex gpt-6.1-sol high; corrigir achados (rodada única).
- [ ] **Step 3 (só com "atualizar" do Diego):** push → CI verde → ff na main → `supabase functions deploy status-publicados` → conferir versão → validação visual na Hairfly Cosmeticos (Água Micelar: R$ 19,00 + ~~R$ 29,90~~ + "Em promoção"; análise expandida calculando sobre R$ 19; logo pulsando na 1ª carga).
