# CREATE com preços divergentes em categoria User Products — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** família NOVA com cores a preços diferentes em categoria User Products (ex.: MLB277368, PAI 02994283 da Avil) publica pela saga UP — um item por cor, cada uma com seu preço — em vez de cair no split e morrer com `FORMATO_INCOMPATIVEL`.

**Architecture:** (1) `publicar-familias` consulta o cache `ml_formato_publicacao` no CREATE: categoria já `user_products` → alvo `publish` (que já roteia para a saga via cache, `publish-familia-ml/processar.ts:255-259`). (2) `publicar-split-ml`, em família sem nada no ar: pré-check do cache antes de qualquer efeito colateral; e, no CREATE, tenta primeiro uma faixa com ≥2 cores — `FORMATO_INCOMPATIVEL` nela semeia o cache e reenfileira o mesmo job no `publish`. Cobre categoria nunca publicada (MLB277368 não está no cache hoje).

**Tech Stack:** Deno edge functions (Supabase), vitest, QStash (`_shared/queue.ts`).

**Spec:** causa raiz da investigação de 09/11 + ADR-0160 dívida nº 9 (`docs/decisions/0160-preco-por-variacao-sob-user-products.md:222-225`) e §"Categoria nunca publicada + preços divergentes = bloqueio" (`:189-191`). Revisão Grok 4.7 xhigh (rodada 1: REVISE, 10 achados; rodada 2: REVISE, 3 achados — todos incorporados abaixo).

## Contexto (causa raiz, verificada)

- `publicar-familias/index.ts:150-195` → `decidirSplit`. Família nova não tem `anuncios_externos_itens` → `ehUP=false`; 3 preços → `split`.
- `publicar-split-ml/index.ts:331` → `criarAnuncioParticao` (`:46-55`) → conector devolve `FORMATO_INCOMPATIVEL` (`_shared/canais/mercado-livre.ts:32-40`, **sem `status`**, só com `variacoes.length > 1`: `:112`, `:167`) → `throw` sem `codigo` → `decidirRetryPorErro` trata status ausente como retentável (`_shared/publicacao/retry.ts:27`) → 10 retries → `status='erro'` (`:555-558`).
- Faixa de **1 cor** não dá `FORMATO_INCOMPATIVEL`: o conector cai no retry plano (`mercado-livre.ts:168`) e **cria** o item.
- `publish-familia-ml/processar.ts:255-259`: cache `user_products` → `rotaSagaUP()`. Sem cache, `garantirPrecoUniforme` (`:270`) barra divergência — por isso a Parte 1 sozinha não resolve a Avil.
- Idempotência do `publish` (não criar trava nova): `processar.ts:125-150` devolve `ja_publicado` com `ml_item_id`; saga reusa item por SKU (`_shared/user-products/publicar-grupo.ts:152`) e adota órfão (`:157-166`); fila serial `publish-ml-${userId}` (`queue.ts:91-93`).
- "Reenviar" na Revisão chama `reprocessar-familia` (status → `pendente` → `process-familia`), **não** `publicar-familias`.

## Global Constraints

- Família já publicada não muda de rota: cache de formato só no CREATE (`novos`). Ramo `updates` intocado (ADR-0160).
- **"Nada no ar"** = `familia.ml_item_id` nulo **e** nenhuma linha em `anuncios_externos` (org + `codigo_pai`, canal ML) com `item_externo_id` não nulo. Linha com `item_externo_id` nulo (raiz da saga, `publicar-familia-up.ts:231-236`) **não** conta como no ar.
- Reenfileirar só se: nada no ar **e** `qtdCores ≤ MAX_VARIACOES_ML` (`_shared/split/particionar.ts`). >100 cores segue no split (ADR-0048).
- Reenfileirar = o **objeto do body parseado inteiro** (inclui `versoes_kit`, `listing_type_id`), via `enfileirarPublicacoes([{ job, alvo: 'publish' }], familia.user_id)`. Status continua `publicando`. Worker devolve 200; **não** chama `talvezFinalizarLote`.
- `FORMATO_INCOMPATIVEL` no split nunca retenta: tratado antes de `decidirRetryTransitorio`.
- Falha do enqueue: capturada no próprio ramo (não cai no catch genérico) → `status='erro'`, mensagem "Categoria {cat} identificada como User Products. Selecione a família e publique de novo." e 200. Com o cache semeado, publicar de novo cai na Parte 1.
- **Todo ramo novo que grava `status='erro'` e responde 200 chama `talvezFinalizarLote(admin, job.lote_id)`** (hoje só o catch chama, `publicar-split-ml/index.ts:580`); sem isso o lote fica `publicando` para sempre.
- Emenda ao ADR-0160 **antes** do código.
- Deploy: `publicar-familias` e `publicar-split-ml` (nenhum `_shared/` alterado; se o executor alterar, redeployar consumidores e conferir versão).

## Review Focus

1. **Redelivery do QStash após reenfileirar** (200 perdido): split recebe o job de novo com status `publicando`. Esperado: pré-check (cache já `user_products`, nada no ar) reenfileira sem POST, sem foto, sem título. Teste Task 3.
2. **Redelivery quando a saga já gravou a raiz** (`item_externo_id` nulo): continua "nada no ar" → reenfileira; o 2º `publish` cai nos guards citados no Contexto. Teste Task 3.
3. **Faixa de 1 cor antes da de ≥2 cores**: esperado que a de ≥2 seja tentada primeiro; `FORMATO_INCOMPATIVEL` → reenfileira sem ter criado item de 1 cor. Teste Task 3.
4. **Família com >100 cores e cache `user_products`**: continua split (pré-check não reenfileira). Teste Task 3.
5. **Divergente + soma acima do teto (ADR-0195) + cache `user_products`** no `publicar-familias`: `publish`. Teste Task 2.

---

### Task 1: Emenda ao ADR-0160 (dívida nº 9)

**Files:** Modify `docs/decisions/0160-preco-por-variacao-sob-user-products.md` (dívidas, item 9; §"Categoria nunca publicada…").

- [ ] **Step 1:** dívida nº 9 resolvida em 2026-11-09; seção "Emenda 2026-11-09 — CREATE consulta o cache; split descobre UP" com as regras de Architecture + Global Constraints, a ordem ≥2 cores primeiro e os limites declarados: (a) todas as faixas com 1 cor → comportamento atual (N itens planos, um por faixa); (b) estado misto (algo no ar — inclusive item de 1 cor criado pelo worker antigo antes deste fix) → erro explícito, sem reenfileirar; (b2) >100 cores em categoria UP → erro explícito; (c) kit com preço divergente em categoria fora do cache continua barrado no gate do kit (`publicar-split-ml/index.ts:137-149`) antes de descobrir o formato. Atualizar "Categoria nunca publicada…": a descoberta acontece no split sem ação do operador quando há faixa com ≥2 cores.
- [ ] **Step 2:** commit `docs(adr-0160): emenda — CREATE divergente em categoria UP vai pra saga`.

### Task 2: `publicar-familias` roteia CREATE pelo cache de formato

**Files:**
- Modify: `supabase/functions/publicar-familias/formato-legacy.ts`, `supabase/functions/publicar-familias/index.ts:166-195`
- Test: `supabase/functions/publicar-familias/__tests__/handler-teto.test.ts`

**Interfaces:**
- Produces: `formatoPorFamilia(admin: SupabaseClient, orgId: string, familiaIds: string[]): Promise<Map<string, FormatoPublicacaoML>>` (substitui `familiasFormatoLegacy`; mesmo fail-open: erro → `new Map()` + `console.error`). `FormatoPublicacaoML` de `_shared/ml/formato-publicacao.ts`.
- `ehSplit(familiaId, somenteEstoque = false, somaEstoqueCreate?, categoriaUP = false)` → `ehUP: paisUP.has(pai) || categoriaUP`. `decidirSplit` não muda (já cobre >100 cores e `qtdParticoes>1` com `ehUP`: `decidir-split.test.ts:34-41`).

- [ ] **Step 1: testes** em `handler-teto.test.ts`:
  - novo `'CREATE divergente com categoria user_products no cache → publish'` (3 cores, 13315/14135/15570).
  - novo `'CREATE divergente sem cache → split'` e `'CREATE divergente com cache legacy → split'`.
  - novo `'CREATE divergente acima do teto com cache user_products → publish'` (Review Focus 5).
  - **alterar** `'soma dentro do limite → publish, sem ler o cache'` (`:120-124`) para `'soma dentro do limite e preço uniforme → publish'`, removendo a asserção `not.toContain('ml_formato_publicacao')` (o CREATE agora lê o cache).
  - manter `'UPDATE acima do limite nunca lê o cache…'` (`:126-129`) intacto.
- [ ] **Step 2:** `pnpm test -- supabase/functions/publicar-familias` → o 1º e o 4º novos FALHAM.
- [ ] **Step 3:** `formatoPorFamilia` chamado **uma vez** com os ids de `novos`; `formatoLegacy` = ids de `acimaDoTeto` com `'legacy'` (semântica atual); `categoriaUP = formatos.get(f.id) === 'user_products'` só no ramo `novos`.
- [ ] **Step 4:** `pnpm test -- supabase/functions/publicar-familias` → PASS.
- [ ] **Step 5:** commit `fix(publicar-familias): CREATE em categoria UP no cache vai para a saga (ADR-0160)`.

### Task 3: `publicar-split-ml` descobre UP e reenfileira no publish

**Files:**
- Modify: `supabase/functions/publicar-split-ml/index.ts` (`:36` Job, `:46-55`, logo após `:77-81`, loop `:267`, catch `:545`)
- Test: Create `supabase/functions/publicar-split-ml/__tests__/handler-formato-up.test.ts` (mocks no molde de `handler-teto.test.ts`; mockar `_shared/queue.ts#enfileirarPublicacoes` e `_shared/ml/formato-publicacao.ts`)

**Interfaces:**
- Consumes: `lerFormatoPublicacao(repo, connectionId, categoriaId)`, `confirmarFormatoPublicacao(repo, connectionId, categoriaId, formato)`, `formatoRepoSupabase(admin)`; `enfileirarPublicacoes` (`_shared/queue.ts:131`); `MAX_VARIACOES_ML`.
- `Job` (`:36`) ganha `versoes_kit?: unknown`; o reenfileiramento usa o objeto parseado inteiro, não um subconjunto.
- `criarAnuncioParticao` anexa `err.codigo = e.codigo`; para `FORMATO_INCOMPATIVEL` também `err.status = 400`.

Regra:
1. **Pré-check** logo após o `if (familia.status !== 'publicando')` (`:77-81`), antes do gate de kit (`:137`), fotos (`:168`) e título (`:282`): nada no ar **e** cores ≤ `MAX_VARIACOES_ML` **e** `lerFormatoPublicacao(formatoRepoSupabase(admin), conexao.id, familia.categoria_ml_id) === 'user_products'` → reenfileirar, 200 `{ ok: true, reroteado: 'publish' }`. (`conexao` hoje é resolvida em `:85` — mover a resolução para antes do pré-check ou resolver ali; sem conexão, pula o pré-check.)
2. **Ordem do CREATE:** quando nada no ar, iterar as partições com ≥2 cores antes das de 1 cor (índices `p` intactos — só muda a ordem de iteração do loop `:267`).
3. **Reativo:** erro com `codigo === 'FORMATO_INCOMPATIVEL'`, tratado no catch **antes** de `decidirRetryTransitorio`: `confirmarFormatoPublicacao(..., 'user_products')`; se `particaoNoAr === false` **e** nada no ar no início do job **e** cores ≤ `MAX_VARIACOES_ML` → reenfileirar, 200. Com >100 cores → `status='erro'`, mensagem "Categoria {cat} é User Products e a família tem mais de 100 cores — o ML não aceita mais de 100 itens por família; divida a família na planilha.", 200 (sem retry). Senão → `status='erro'`, mensagem "Categoria {cat} é User Products, mas parte desta família já está no ar como anúncio antigo — não dá para misturar os dois modelos automaticamente (ADR-0160).", 200 (sem retry).
4. Enqueue falhou (pré-check ou reativo) → `status='erro'` com "Categoria {cat} identificada como User Products. Selecione a família e publique de novo.", 200.

- [ ] **Step 1: testes** em `handler-formato-up.test.ts`:
  - `'FORMATO_INCOMPATIVEL na faixa de ≥2 cores sem nada no ar semeia cache e reenfileira'` → `confirmar` com `(repo, conexaoId, 'MLB277368', 'user_products')`; `enfileirarPublicacoes` com `[{ job: expect.objectContaining({ familia_id, lote_id, listing_type_id, versoes_kit }), alvo: 'publish' }]` e `userId`; resposta 200; nenhum update `status:'erro'`; `talvezFinalizarLote` não chamado.
  - `'faixa de 1 cor vem depois da de ≥2 cores'` → partição 0 = 1 cor, partição 1 = 6 cores com FORMATO_INCOMPATIVEL → `criarAnuncio` chamado 1 vez, com 6 variações; reenfileirado (Review Focus 3).
  - `'cache user_products e nada no ar reenfileira sem POST, foto nem título'` → `criarAnuncio`, upload de foto e `gerarTituloParticao` não chamados (Review Focus 1).
  - `'raiz da saga com item_externo_id nulo conta como nada no ar'` → reenfileira (Review Focus 2).
  - `'>100 cores com cache user_products não reenfileira'` (Review Focus 4).
  - `'FORMATO_INCOMPATIVEL com partição já no ar não reenfileira e não retenta'` → partição ≥2 cores criada ok, outra com FORMATO_INCOMPATIVEL → cache semeado, sem enqueue, `status='erro'` com "já está no ar", resposta 200.
  - `'>100 cores sem cache: FORMATO_INCOMPATIVEL no reativo não reenfileira'` → cache semeado, sem enqueue, `status='erro'` com "mais de 100 cores", 200.
  - `'falha no enqueue vira erro com instrução de publicar de novo'` → `erro_mensagem` contém "publique de novo", resposta 200, `talvezFinalizarLote` chamado.
  - no teste de estado misto, asserir também `talvezFinalizarLote` chamado.
  - `'erro de foto retentável segue retentando'` → 500 (regressão).
- [ ] **Step 2:** `pnpm test -- supabase/functions/publicar-split-ml` → novos FALHAM.
- [ ] **Step 3:** implementar a Regra. No PR, citar os guards de idempotência do `publish` listados no Contexto (sem trava nova).
- [ ] **Step 4:** `pnpm test -- supabase/functions/publicar-split-ml supabase/functions/publicar-familias supabase/functions/publish-familia-ml` → PASS; `pnpm preflight` → verde.
- [ ] **Step 5:** commit `fix(publicar-split-ml): FORMATO_INCOMPATIVEL em CREATE reenfileira na saga UP (ADR-0160)`.

### Task 4: Entrega e desbloqueio da Avil

- [ ] **Step 1:** revisão pré-merge (Grok xhigh no diff da branch), CI verde, merge fast-forward na `main`.
- [ ] **Step 2:** `supabase functions deploy publicar-familias publicar-split-ml`; conferir versão nova (`supabase functions list`).
- [ ] **Step 3a:** antes de republicar, conferir por SELECT que a família `75250990-97a5-4841-9423-51d7779e713c` segue com `ml_item_id` nulo, `operacao='CREATE'` e nenhuma linha em `anuncios_externos` com `item_externo_id` (investigação de 09/11: nada criado, a partição 0 era a de 6 cores). Se houver resíduo, parar e escalar — não limpar sem o Diego.
- [ ] **Step 3:** Diego seleciona a família PAI 02994283 e publica de novo (não "Reenviar" — esse reprocessa). Esperado: split → faixa de 6 cores → FORMATO_INCOMPATIVEL → cache MLB277368=`user_products` → publish → saga → 8 itens UP com 133,15 / 141,35 / 155,70. Conferir por SELECT `ml_formato_publicacao` e `familias.status='publicado'`. Se a tela não deixar publicar família em `erro`, usar Reenviar e publicar após o reprocessamento.
- [ ] **Step 4:** docs vivos (skill `docs-update-checklist`): `docs/reference/edge-functions.md` e `docs/project-status.md`.

**Fora do escopo (avisar o Diego):** a Revisão ainda diz "Cada faixa será publicada como um anúncio próprio" e oferece atacado por faixa — sob UP não vale (atacado por variação recusado, ADR-0160 dívida nº 2).
