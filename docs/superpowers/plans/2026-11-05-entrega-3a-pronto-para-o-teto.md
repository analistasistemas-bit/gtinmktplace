# Entrega 3a — Sistema pronto para o teto do ML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicação nova acima de 99.999 nasce dividida por soma de estoque; o push passa a respeitar o teto; anúncio publicado que passa do limite avisa uma vez.

**Architecture:** Três mudanças pequenas no que já existe: `decidirSplit` e `particionarPorPreco`, `atualizarEstoque` do conector, aviso por `notificarCategoria`. Nenhuma cor muda de anúncio.

**Tech Stack:** Deno edge functions, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-confirmacao-ml-e-divisao-por-estoque-design.md`. Diego escolheu em 05/11 esta opção; a movimentação de cores de `2026-11-05-entrega-3-divisao-por-estoque.md` fica adiada, com 4 riscos abertos registrados no ADR-0195.

## Global Constraints

- `LIMITE_ESTOQUE_ML` de `capar-estoque.ts`. Sem mudança de banco.
- UPDATE em somente estoque nunca passa a dividir por soma; só CREATE.
- Só divide por soma com `ml_formato_publicacao.formato = 'legacy'` confirmado para a conexão e a categoria. `user_products` ou cache vazio segue para o `publish` de hoje: o split não tem a saga UP (`FORMATO_INCOMPATIVEL`). Se esse CREATE sair cortado pelo teto, o publish avisa.
- Cor publicada não muda de partição (ADR-0048 intacto).
- Soma dentro do limite: comportamento do push byte a byte igual ao de hoje.
- Cor com zero continua zero: `caparEstoque` preserva.
- Aviso é best-effort e nunca derruba push ou conferência. Chave `teto:<item>`: uma vez por anúncio.

## Review Focus

1. Família CREATE com 2+ cores e soma acima do limite, preço único: vira 2+ anúncios, títulos distintos, cada um abaixo do limite. Teste na Task 1.
2. Cor sozinha acima de 99.999: fica em partição própria, com teto do conector, sem laço. Teste na Task 1.
3. Push de uma cor em item acima do limite com outras variações vivas: payload completo sob o limite. Teste na Task 2.
4. Variação viva sem `seller_custom_field`: entra na soma, sem colidir chave. Teste na Task 2.
5. Reentrega do push: aviso não repete. Teste na Task 3.

---

### Task 1: Publicação nova dividida por soma

**Files:**
- Modify: `supabase/functions/publicar-familias/decidir-split.ts`, `supabase/functions/publicar-familias/index.ts:80-95,130-150`, `supabase/functions/_shared/split/particionar.ts`, `supabase/functions/publicar-split-ml/index.ts:203-210`
- Test: `supabase/functions/publicar-familias/__tests__/decidir-split.test.ts`, `supabase/functions/_shared/split/__tests__/` (particionar)

**Interfaces:**
- Produces: `decidirSplit({ ..., somaEstoqueCreate?: number })`, avaliada depois de `ehUP`/`temTamanho` e só com `qtdCores > 1`; quem chama só passa a soma com formato `legacy` confirmado. `CorComPreco.estoque?: number`. `montarAncoragem` determinística: linhas por `particao` crescente, e a partição maior vence SKU duplicado (o espelho antigo do catálogo só poluiu a partição 0).

- [ ] **Step 1: Testes.** `decidirSplit`: soma 100.000 com 2 cores → true; 99.999 → false; UP → false; 1 cor → false; ausente → comportamento atual. Handler: CREATE acima do limite com formato `legacy` → alvo `split`; `user_products` ou sem cache → alvo `publish`; UPDATE nunca lê o cache. `montarAncoragem`: SKU em 0 e 1 → 1, em qualquer ordem de entrada. `particionarPorPreco`: cores novas com 60.000 + 60.000 → partições 0 e 1; ancorada conta na soma; cor de 150.000 em partição vazia cabe sozinha; sem `estoque` → resultado atual.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar. Em `particionarPorPreco`, o alvo exige `soma + estoque <= LIMITE_ESTOQUE_ML` ou partição sem cor. `publicar-familias` lê `estoque` e passa a soma só no claim CREATE. `publicar-split-ml` passa `estoque: v.estoque`.
- [ ] **Step 4:** Rodar. Expected: PASS. Commit.

### Task 2: Teto no push

**Files:**
- Modify: `supabase/functions/_shared/ml/atualizar.ts` se preciso, `supabase/functions/_shared/canais/mercado-livre.ts:360-395`, `supabase/functions/_shared/canais/contrato.ts:250`, `supabase/functions/_shared/canais/fake.ts`
- Test: teste do conector em `_shared/canais/__tests__/`

**Interfaces:**
- Produces: `atualizarEstoque` devolve `ResultadoCanal<{ capados?: number }>`.

- [ ] **Step 1: Testes.** Item com variações somando acima do limite: payload total ≤ 99.999, `capados` = SKUs pedidos cortados, variação zerada segue 0, variação fora do pedido também entra no teto. Soma dentro do limite: payload igual ao de hoje, sem `capados`. Variação sem SKU conta na soma. Item plano com 120.000 → 99.999, `capados: 1`.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar sobre `atual.variations`, já lido; chave `id:<id>` para variação sem SKU. Com a soma acima do limite, o teto é aplicado **por id no payload completo** (`{ id, available_quantity }` de toda variação), inclusive a sem SKU. Dentro do limite, nenhum caminho muda.
- [ ] **Step 4:** Rodar. Expected: PASS. Commit.

### Task 3: Aviso de anúncio acima do limite

**Files:**
- Modify: `supabase/functions/_shared/notificacoes/estoque.ts`, `supabase/functions/sincronizar-estoque/processar.ts:409`, `supabase/functions/confirmar-publicacao-ml/processar.ts`, `supabase/functions/publicar-split-ml/index.ts:314-325` (CREATE), `supabase/functions/publish-familia-ml/processar.ts` (depois do CREATE), `supabase/functions/vincular-catalogo/index.ts:124`
- Test: `__tests__` dos dois workers

**Interfaces:**
- Produces: `montarMensagemTetoAnuncio(a: { codigoPai: string; itemExternoId: string; capados: number }): string`.

- [ ] **Step 1: Testes.** Push com `capados` chama `notificarCategoria` com `'estoque'` e `{ chave: 'teto:<item>' }`; falha ao notificar não vira retentável. Conferência fechada com `capados > 0` usa a mesma chave; versão superada não avisa. CREATE do split registra `confirmacoes_ml` com o enviado depois do teto (`caparEstoque`, `anterior: null`, `variacao_id` de `ref.variacoesExternas`), inclusive `capados`. `publish-familia-ml`: CREATE com soma acima do limite avisa com a mesma chave. `vincular-catalogo`: família com 2+ partições espelha na partição 0 só os SKUs do mapa dela; família de 1 partição segue igual.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar. Texto: `📦 Anúncio acima do limite do Mercado Livre: produto <codigoPai>, anúncio <item>.` e `<n> cor(es) aparecem com menos estoque no anúncio. O saldo real segue no PubliAI.`
- [ ] **Step 4:** Rodar. Expected: PASS. Commit.

### Task 4: Docs, revisão, merge e deploy

- [ ] **Step 1:** ADR-0195: decisão 3 passa a "publicação nova divide por soma; publicado segue com teto e aviso; movimentação adiada, com os 4 riscos". Desenho e `docs/TASKS.md` alinhados.
- [ ] **Step 2:** Revisão do diff pelo Codex, rodada única; corrigir. `pnpm preflight:static`.
- [ ] **Step 3:** Um passo por vez: push, todos os checks verdes, `fetch` da main, push fast-forward confirmado, só então deploy de todas as funções que importam `_shared` tocado, conferindo `verify_jwt`.
