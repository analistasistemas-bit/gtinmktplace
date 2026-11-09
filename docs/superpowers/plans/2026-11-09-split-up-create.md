# CREATE com preços divergentes em categoria User Products — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** família NOVA com cores a preços diferentes em categoria User Products (ex.: MLB277368, PAI 02994283 da Avil) publica pela saga UP — um item por cor, cada uma com seu preço — em vez de cair no split e morrer com `FORMATO_INCOMPATIVEL`.

**Architecture:** duas mudanças complementares. (1) `publicar-familias` passa a consultar o cache `ml_formato_publicacao` no CREATE: categoria já conhecida como `user_products` → alvo `publish` (que já roteia para a saga via cache, `publish-familia-ml/processar.ts:255-259`). (2) `publicar-split-ml`, quando o CREATE da partição recebe `FORMATO_INCOMPATIVEL` e **nada da família está no ar**, semeia o cache e reenfileira o mesmo job no alvo `publish` — cobre categoria nunca publicada (caso da Avil hoje: MLB277368 não está no cache).

**Tech Stack:** Deno edge functions (Supabase), vitest, QStash (`_shared/queue.ts`).

**Spec:** causa raiz da investigação de 09/11 + ADR-0160 dívida nº 9 (`docs/decisions/0160-preco-por-variacao-sob-user-products.md:222-225`) e §"Categoria nunca publicada + preços divergentes = bloqueio" (`:189-191`).

## Contexto (causa raiz, verificada)

- `publicar-familias/index.ts:150-195` → `decidirSplit` (`publicar-familias/decidir-split.ts`). Família nova não tem `anuncios_externos_itens` → `ehUP=false`; 3 preços distintos → `split`.
- `publicar-split-ml/index.ts:331` → `criarAnuncioParticao` (`:46-55`) → conector devolve `FORMATO_INCOMPATIVEL` (`_shared/canais/mercado-livre.ts:37`) → vira `throw` → catch (`:545-552`) grava `familias.status='erro'`. O split nunca semeia o cache nem conhece a saga.
- `publish-familia-ml/processar.ts:255-259` já faz: cache `user_products` → `rotaSagaUP()` (aceita preço por cor, I2 do ADR-0160). Sem cache, cai em `garantirPrecoUniforme` (`:270`) e barra a divergência — por isso a Parte 2 é necessária e a Parte 1 sozinha não resolve a Avil.
- Não é regressão (histórico de `decidir-split.ts` nunca cobriu o caso).

## Global Constraints

- Nenhuma família **já publicada** muda de rota: o cache de formato só vale para CREATE (`novos`). UPDATE continua com `ehUP` estrutural (ADR-0160 explica por quê: família Legacy não migrada numa categoria UP).
- Reenfileirar só quando **nada da família está no ar**: nenhuma linha em `anuncios_externos` para o `codigo_pai`/org e `particaoNoAr === false`. Caso contrário: semeia o cache, mantém `status='erro'` com mensagem explícita (estado misto Legacy+UP não é resolvido aqui).
- Reenfileirar = mesmo body do job recebido (preserva `listing_type_id`, `versoes_kit` etc.), alvo `publish`, via `enfileirarPublicacoes([{ job, alvo: 'publish' }], familia.user_id)` — mesma fila serial do vendedor. Worker devolve 200 e **não** chama `talvezFinalizarLote` (o publish finaliza).
- Falha ao reenfileirar = erro visível (`status='erro'`, mensagem "Categoria User Products detectada; clique Reenviar"), nunca silêncio. Com o cache já semeado, o Reenviar cai na Parte 1.
- Fail-open da leitura do cache em `publicar-familias` mantém o comportamento atual (log + segue). Não bloquear publicação por erro de leitura de cache.
- Toda mudança de roteamento de publicação passa por ADR: emenda no ADR-0160 (dívida nº 9 → resolvida) **antes** do código.
- Deploy: `publicar-familias` e `publicar-split-ml` (nenhum `_shared/` alterado — se o executor alterar `_shared/`, redeployar todos os consumidores e conferir versão).

## Review Focus

1. **Redelivery do QStash depois do reenfileiramento** (crash entre enqueue e 200): o split recebe o job de novo. Esperado: não faz POST nenhum — cache já é `user_products` → reenfileira de novo direto. Teste na Task 3.
2. **Dois jobs `publish` para a mesma família** (consequência do item 1). Esperado: o 2º não cria anúncio duplicado. O executor da Task 3 deve localizar e citar (arquivo:linha) o guard de idempotência do `publish-familia-ml`/saga para família já `publicado`/com itens; se não existir, parar e escalar — não inventar guard novo sem ADR.
3. **Partição 0 de 1 cor publicada como Legacy e partição 1 recebendo FORMATO_INCOMPATIVEL** (estado misto). Esperado: sem reenfileirar, cache semeado, erro explícito. Teste na Task 3.
4. **Família com >100 cores ou já dividida (`qtdParticoes>1`) em categoria UP no cache.** Esperado: continua `split` (ordem em `decidirSplit` preserva). Teste na Task 2.
5. **Categoria em cache como `legacy` com preços divergentes.** Esperado: continua `split` (inalterado). Teste na Task 2.

---

### Task 1: Emenda ao ADR-0160 (dívida nº 9)

**Files:**
- Modify: `docs/decisions/0160-preco-por-variacao-sob-user-products.md` (seção "Dívidas declaradas" item 9 e §"Categoria nunca publicada + preços divergentes = bloqueio")

- [ ] **Step 1:** Marcar a dívida nº 9 como resolvida em 2026-11-09 e adicionar seção "Emenda 2026-11-09 — CREATE consulta o cache; split descobre UP" com: as duas regras da Architecture, as Global Constraints de reenfileiramento (nada no ar / mesmo job / alvo publish) e o caso misto que continua bloqueado. Atualizar o parágrafo "Categoria nunca publicada…" dizendo que a descoberta agora acontece no split sem ação do operador.
- [ ] **Step 2:** Commit `docs(adr-0160): emenda — CREATE divergente em categoria UP vai pra saga`.

### Task 2: `publicar-familias` roteia CREATE pelo cache de formato

**Files:**
- Modify: `supabase/functions/publicar-familias/formato-legacy.ts` (generalizar)
- Modify: `supabase/functions/publicar-familias/index.ts:166-195` (uso)
- Test: `supabase/functions/publicar-familias/__tests__/handler-teto.test.ts` (estender — já mocka o handler e o cache) e `__tests__/decidir-split.test.ts`

**Interfaces:**
- Produces: `formatoPorFamilia(admin: SupabaseClient, orgId: string, familiaIds: string[]): Promise<Map<string, FormatoPublicacaoML>>` em `formato-legacy.ts` (substitui `familiasFormatoLegacy`; mesmo fail-open: erro → `new Map()` + `console.error`). `FormatoPublicacaoML` importado de `_shared/ml/formato-publicacao.ts`.
- `ehSplit(familiaId, somenteEstoque = false, somaEstoqueCreate?, categoriaUP = false)` → passa `ehUP: paisUP.has(pai) || categoriaUP` para `decidirSplit`. `decidirSplit` não muda.

- [ ] **Step 1: testes falhando** (em `handler-teto.test.ts`, reaproveitando o mock de `ml_formato_publicacao` existente):
  - `'CREATE com preços divergentes e categoria user_products no cache vai para publish'` → família nova, 3 cores, preços 13315/14135/15570, cache `user_products` → `expect(alvoEnfileirado).toBe('publish')`.
  - `'CREATE com preços divergentes sem cache continua split'` → mesmo cenário sem linha no cache → `'split'`.
  - `'CREATE com preços divergentes e cache legacy continua split'` → `'split'` (Review Focus 5).
  - `'CREATE acima do teto com cache legacy continua split'` (regressão ADR-0195, já deve existir — garantir que segue verde com o helper novo).
  - Em `decidir-split.test.ts`: `'ehUP=true com qtdCores>100 ainda divide'` e `'ehUP=true com qtdParticoes>1 ainda divide'` se ainda não existirem (Review Focus 4).
- [ ] **Step 2:** `pnpm test -- supabase/functions/publicar-familias` → o 1º teste FALHA (recebe `split`).
- [ ] **Step 3:** implementar `formatoPorFamilia`; em `index.ts` chamar **uma vez** com todos os ids de `novos` (não só `acimaDoTeto`); derivar `formatoLegacy` = ids de `acimaDoTeto` com `'legacy'` (mesma semântica de hoje) e passar `categoriaUP = formatos.get(f.id) === 'user_products'` só no ramo `novos`. Ramo `updates` intocado.
- [ ] **Step 4:** `pnpm test -- supabase/functions/publicar-familias` → PASS.
- [ ] **Step 5:** commit `fix(publicar-familias): CREATE em categoria UP no cache vai para a saga (ADR-0160)`.

### Task 3: `publicar-split-ml` descobre UP e reenfileira no publish

**Files:**
- Modify: `supabase/functions/publicar-split-ml/index.ts` (antes do loop de partições + tratamento de `FORMATO_INCOMPATIVEL` no CREATE de partição, `:46-55`, `:331`, catch `:545`)
- Test: Create `supabase/functions/publicar-split-ml/__tests__/handler-formato-up.test.ts` (copiar a estrutura de mocks de `handler-teto.test.ts`; mockar `_shared/queue.ts#enfileirarPublicacoes` e `_shared/ml/formato-publicacao.ts`)

**Interfaces:**
- Consumes: `lerFormatoPublicacao`, `confirmarFormatoPublicacao`, `formatoRepoSupabase` (`_shared/ml/formato-publicacao.ts`); `enfileirarPublicacoes` (`_shared/queue.ts:131`); `conexao` já resolvida em `index.ts:85`.
- Produces: `criarAnuncioParticao` passa a anexar `codigo` ao erro lançado (`err.codigo = e.codigo`) para o handler distinguir `FORMATO_INCOMPATIVEL`.

Regra (ordem dentro do handler):
1. **Pré-check** (antes de qualquer POST): família sem nenhuma linha em `anuncios_externos` (org + `codigo_pai`) **e** `lerFormatoPublicacao(conexao.id, familia.categoria_ml_id) === 'user_products'` → reenfileirar no `publish` e devolver 200 `{ ok: true, reroteado: 'publish' }`.
2. **Reativo**: CREATE de partição lança com `codigo === 'FORMATO_INCOMPATIVEL'` → `confirmarFormatoPublicacao(..., 'user_products')` sempre; se nada no ar (sem linhas prévias em `anuncios_externos` e `particaoNoAr === false`) → reenfileirar no `publish`, 200. Senão → `status='erro'` com mensagem: "Categoria {cat} é User Products, mas parte desta família já está no ar como anúncio antigo — não dá para misturar os dois modelos automaticamente (ADR-0160)."
3. Enqueue falhou → `status='erro'`, `erro_mensagem` = "Categoria {cat} identificada como User Products. Clique Reenviar para publicar com preço por cor." e 200 (não retentar o split).

- [ ] **Step 1: testes falhando** em `handler-formato-up.test.ts`:
  - `'FORMATO_INCOMPATIVEL na partição 0 sem nada no ar semeia cache e reenfileira no publish'` → `criarAnuncio` mock devolve `{ ok:false, erro:{ codigo:'FORMATO_INCOMPATIVEL', ... } }` → `expect(confirmar).toHaveBeenCalledWith(repo, conexaoId, 'MLB277368', 'user_products')`, `expect(enfileirarPublicacoes).toHaveBeenCalledWith([{ job: expect.objectContaining({ familia_id, lote_id, listing_type_id }), alvo: 'publish' }], userId)`, status 200, nenhum `update` de `familias` com `status:'erro'`, `talvezFinalizarLote` não chamado.
  - `'cache user_products e nada no ar reenfileira sem POST'` → `expect(criarAnuncio).not.toHaveBeenCalled()` (Review Focus 1).
  - `'FORMATO_INCOMPATIVEL com partição já no ar não reenfileira'` → partição 0 (1 cor) cria ok, partição 1 recebe FORMATO_INCOMPATIVEL → cache semeado, `enfileirarPublicacoes` não chamado, `familias.status='erro'` com mensagem contendo "já está no ar" (Review Focus 3).
  - `'falha no enqueue vira erro com instrução de Reenviar'` → `enfileirarPublicacoes` rejeita → `erro_mensagem` contém "Clique Reenviar".
  - `'outros erros de CREATE seguem o caminho atual'` → erro `FOTO` retentável continua 500 (regressão).
- [ ] **Step 2:** `pnpm test -- supabase/functions/publicar-split-ml` → novos FALHAM.
- [ ] **Step 3:** implementar a Regra acima. Antes de fechar, localizar e citar no PR o guard que impede o `publish-familia-ml` de criar de novo família já publicada pela saga (Review Focus 2); se não existir, parar e escalar.
- [ ] **Step 4:** `pnpm test -- supabase/functions/publicar-split-ml supabase/functions/publish-familia-ml` → PASS; depois `pnpm preflight` → verde.
- [ ] **Step 5:** commit `fix(publicar-split-ml): FORMATO_INCOMPATIVEL em CREATE reenfileira na saga UP (ADR-0160)`.

### Task 4: Entrega e desbloqueio da Avil

- [ ] **Step 1:** revisão pré-merge (Grok xhigh no diff da branch), CI verde, merge fast-forward na `main`.
- [ ] **Step 2:** `supabase functions deploy publicar-familias publicar-split-ml` e conferir versão nova ativa (`supabase functions list`).
- [ ] **Step 3:** Diego clica **Reenviar** na família PAI 02994283. Esperado: split → FORMATO_INCOMPATIVEL → cache MLB277368=`user_products` → publish → saga → 8 itens UP, cada cor com seu preço (133,15 / 141,35 / 155,70). Conferir `ml_formato_publicacao` e `familias.status='publicado'` por SELECT.
- [ ] **Step 4:** docs vivos (skill `docs-update-checklist`): `docs/reference/edge-functions.md` (comportamento novo do split) e `docs/project-status.md`.

**Fora do escopo (avisar o Diego):** a tela de revisão ainda diz "Cada faixa será publicada como um anúncio próprio" e oferece atacado por faixa — sob UP isso não vale (atacado por variação recusado, ADR-0160 dívida nº 2). Corrigir a copy é outra fatia.
