# Etapa "Produtos" da importação de nota — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layout A (cartões enxutos) na etapa 2 da importação de nota e retomada do produto cadastrado a partir do item (`refNota`), sem sugestões sem relação.

**Architecture:** A edge `cadastrar-produto` passa a gravar `familias.mudanca_estrutural.refNota = "nfe:<chave44>:<nItem>"` quando o cadastro vem da nota (e compara no retry). O front consulta essas famílias ao abrir a nota e aplica-as no estado puro (`estado.ts`) com prioridade sobre decisões automáticas. A etapa 2 é redesenhada sobre o mesmo estado, com um predicado único `itemPronto` para contador e trava.

**Tech Stack:** React + TS (Vite), Supabase Edge Functions (Deno), vitest.

**Spec:** `docs/superpowers/specs/2026-10-17-nota-etapa-produtos-ux-design.md`

## Global Constraints

- Formato da referência: `nfe:<chave 44 dígitos>:<nItem 1–3 dígitos>` — regex `^nfe:\d{44}:\d{1,3}$` (a mesma `REF_NOTA` de `adicionar-variacoes-familia/processar.ts:33`; mover para módulo `_shared` e importar dos dois lugares, nunca redigitar).
- `refNota` só é aceito com `origemNota: true`; org sempre do usuário autenticado.
- `vinculos_fornecedor`, a RPC de confirmação, as etapas Distribuição/Resumo: **não mudam**.
- Prioridade de decisão automática por item: `nota` (cadastrado desta nota) > `vinculo` > `gtin` > nada. Escolha `manual` da sessão nunca é sobrescrita.
- Textos (pt-BR, exatos): selo "Cadastrado desta nota"; selo "Cadastrado mais de uma vez — escolha"; selo "Sem produto"; botões "Cadastrar produto novo", "Escolher existente…", "Trocar", "Cancelar", "Tentar novamente"; aviso "Não foi possível conferir produtos já cadastrados desta nota"; vazio da busca sem texto "Digite para buscar"; topo "N de M itens prontos"; progresso "Distribuídas: X de Q · faltam R".
- Sem migration. Sem nova dependência. Componentes de `src/components/ui/` existentes; dark e light.
- Git em worktree: `/usr/bin/git` simples, `commit -F <arquivo>`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Portão: `pnpm preflight`.

## Review Focus

1. Short da NF 1051 cadastrado **antes** desta feature (sem `refNota`) — continua exigindo escolha manual, sem erro — teste em Task 3.
2. Retry da edge com `refNota` diferente da gravada → 409 antes de efeito; payload legado sem `refNota` continua igual — teste em Task 2.
3. Duas versões da mesma família (mesmo `codigo_pai`) com a mesma `refNota` → liga normal (não é ambíguo) — teste em Task 3.
4. "Trocar" e depois "Cancelar" preserva a escolha anterior; candidatos GTIN preservados após escolha manual — teste em Task 3/4.
5. Fator inválido (quantidade convertida não inteira) → item não pronto e "Avançar" travado com a mesma regra — teste em Task 3.

---

### Task 1: Emenda ADR-0181

**Files:** Modify `docs/decisions/0181-entrada-por-nota-de-compra-e-pacote-do-contador.md` (emenda datada 2026-10-17: origem `refNota` também gravada no cadastro pela nota; retomada por item com prioridade sobre vínculo/GTIN; vínculo do fornecedor continua só na confirmação; etapa 2 redesenhada — link para o spec).

- [ ] **Step 1:** Escrever a emenda (pt-BR, curta, no padrão das emendas existentes do arquivo).
- [ ] **Step 2:** `pnpm docs:links` → OK. Commit `docs(adr-0181): emenda refNota no cadastro pela nota`.

### Task 2: Edge `cadastrar-produto` grava e compara `refNota`

**Files:**
- Create/Modify: módulo `_shared` que exporta `REF_NOTA` (ex.: `supabase/functions/_shared/nfe/ref-nota.ts`, folha sem imports) e `adicionar-variacoes-familia/processar.ts:33` passa a importar dele
- Modify: `supabase/functions/_shared/produto/validar.ts` (`ProdutoEntrada.refNota?: string`; validação; `montarLinhasProduto` grava `mudanca_estrutural: { refNota }` só quando houver)
- Modify: `supabase/functions/cadastrar-produto/processar.ts` (função pura `refNotaDiverge(gravada: unknown, entrada: string | undefined): boolean`), `cadastrar-produto/index.ts` (retry `:108-153`: selecionar `mudanca_estrutural` e devolver 409 com a mensagem do retry divergente existente quando `refNotaDiverge`)
- Test: `supabase/functions/_shared/produto/__tests__/validar.test.ts`, `supabase/functions/cadastrar-produto/__tests__/processar.test.ts`, teste de `adicionar-variacoes-familia` existente continua verde

**Interfaces — Produces:** payload `refNota?: string` em `ProdutoEntrada`; `REF_NOTA` exportado.

- [ ] **Step 1: testes que falham:**
  - `validarProdutoNovo` com `origemNota: true, refNota: 'nfe:'+44 dígitos+':2'` → sem erro; `refNota` sem `origemNota` → erro campo `refNota`; `refNota: 'nfe:123:2'` → erro campo `refNota`.
  - `montarLinhasProduto` com refNota → linha com `mudanca_estrutural: { refNota }`; sem refNota → sem a chave `mudanca_estrutural` (byte a byte igual a hoje).
  - `refNotaDiverge({ refNota: A }, B)` → true; `(null, undefined)` → false; `({ refNota: A }, A)` → false; `({ refNota: A }, undefined)` → true; `(null, A)` → true.
- [ ] **Step 2:** `pnpm test supabase/functions/_shared/produto supabase/functions/cadastrar-produto supabase/functions/adicionar-variacoes-familia` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** testes → PASS; `pnpm check:functions`; `pnpm lint:functions`.
- [ ] **Step 5:** Commit `feat(adr-0181): cadastro pela nota grava refNota e compara no retry`.

### Task 3: Estado, consulta e prefill (front, sem layout)

**Files:**
- Modify: `src/lib/notas-compra.ts` — `produtosCadastradosDaNota(chave: string): Promise<Array<{ nItem: number; codigosPai: string[] }>>` (select em `familias` com `origem_cadastro = 'nota'` e `mudanca_estrutural->>refNota` com prefixo `nfe:<chave>:`; extrai `nItem`; deduplica `codigo_pai`; RLS faz o escopo da org)
- Modify: `src/components/estoque/importar-nota/estado.ts`:
  - `DecisaoItem.origemVinculo` ganha `'nota'`; `candidatosGtin` é **sempre** calculado em `estadoInicial` (antes dos retornos por vínculo/GTIN único) e preservado em `definirProduto`; novo `candidatosNota: string[]`
  - `definirProduto` passa a marcar **sempre** `origemVinculo: 'manual'` na escolha explícita, inclusive quando o código é o mesmo (aí preserva a distribuição)
  - `aplicarCadastradosDaNota(e: EstadoImportacao, lista: Array<{ nItem: number; codigosPai: string[] }>): EstadoImportacao` — para cada item **não `manual`**: 1 código → `codigoPai` = ele, `origemVinculo: 'nota'` (supera vínculo/GTIN; limpa distribuição não travada se mudou); >1 → `codigoPai: null`, `candidatosNota` = códigos; 0 → inalterado
  - `itemPronto(e: EstadoImportacao, d: DecisaoItem): boolean` = `codigoPai` && `quantidadeEmEstoque(item.qCom, d.fator).ok`; `motivoBloqueioEtapa(e, 1)` passa a usá-lo (mantendo as mesmas mensagens)
  - `contarProntos(e): { prontos: number; total: number }`
- Modify: `src/components/estoque/importar-nota/dialog-importar-nota.tsx` (`lerArquivo`: chamar `produtosCadastradosDaNota` **separado** do `Promise.all` atual; sucesso → `aplicarCadastradosDaNota`; falha → estado `conferirFalhou: true` exposto à etapa, com função `tentarNovamente()` que repete só essa consulta e aplica preservando escolhas manuais). **Toda resposta (sucesso ou falha) só é aplicada se a chave da nota e o contador de leitura ainda forem os atuais** — resposta atrasada após fechar o diálogo ou ler outra nota é descartada
- Modify (caminho completo do `refNota` até a edge): `src/lib/produto-entrada.ts:42` (`ProdutoEntrada.refNota?`), `CadastroInicial` em `src/components/estoque/dialog-cadastro-produto.tsx:45` (`refNota?: string`), `prefill-cadastro.ts` (recebe chave+nItem e preenche `refNota`), `use-cadastro-produto.ts` `montarPayload` (parâmetro/campo `refNota`), e os **dois** chamadores de `montarPayload`: `dialog-cadastro-produto.tsx:185` e `dialog-cadastro-grade.tsx:431` (passam `inicial.refNota`)
- Modify: `src/components/estoque/importar-nota/etapa-itens.tsx` — **só a assinatura** de `EtapaItens` ganha as props novas (`conferirFalhou`, `onTentarNovamente`, `carregandoProdutos`, `erroProdutos`), sem mudar o layout (Task 4), para o typecheck ficar verde
- Modify: `dialog-importar-nota.tsx:45-48` — transportar `isLoading`/`isError` da consulta de produtos (hoje vira `[]`) para `EtapaItens`
- Test: `src/components/estoque/importar-nota/__tests__/estado.test.ts` (ou o arquivo de teste existente de `estado.ts`), teste de `montarPayload`

**Interfaces — Produces:** `aplicarCadastradosDaNota`, `itemPronto`, `contarProntos`, `produtosCadastradosDaNota`, `origemVinculo: 'nota'`, `candidatosNota`, prop `conferirFalhou` + `onTentarNovamente` para a etapa.

- [ ] **Step 1: testes que falham:**
  - item com vínculo A + lista `[{ nItem:1, codigosPai:['B'] }]` → `codigoPai 'B'`, `origemVinculo 'nota'`.
  - item `manual` com C + lista B → continua C.
  - lista `[{ nItem:2, codigosPai:['B','D'] }]` → `codigoPai null`, `candidatosNota ['B','D']`.
  - dois itens com o mesmo cProd e listas diferentes → cada um com o seu.
  - lista vazia (short antigo sem refNota) → estado igual ao de entrada.
  - `definirProduto` preserva `candidatosGtin`; item casado por vínculo **e** por GTIN, e item de GTIN único, também guardam `candidatosGtin` (para o Trocar).
  - automático A → `definirProduto(A)` → `origemVinculo 'manual'`, distribuição preservada → `aplicarCadastradosDaNota` com B → continua A.
  - leitura da nota A em voo, nova leitura da nota B, resposta de A chega → estado de B inalterado (promises controladas).
  - `body.refNota` chega no payload enviado pelos **dois** diálogos (simples e grade) quando abertos pela nota.
  - `itemPronto`: produto + `qCom 35`, fator 1, distribuição vazia → true; `qCom 0.5`, fator 1 → false; e `motivoBloqueioEtapa(e,1)` null ⇔ todos `itemPronto`.
  - `contarProntos` com 1 de 2 → `{ prontos:1, total:2 }`.
  - `montarPayload` com `refNota` → payload com `refNota`; sem → sem a chave.
- [ ] **Step 2:** `pnpm test src/components/estoque src/lib` → FAIL.
- [ ] **Step 3:** Implementar (a consulta: ver o padrão de `entradasPreviasDaNota`/`produtosPorGtin` em `notas-compra.ts`, com paginação se o padrão a usa).
- [ ] **Step 4:** testes → PASS; `tsc -b --force`.
- [ ] **Step 5:** Commit `feat(adr-0181): retomada por refNota e predicado itemPronto na importação de nota`.

### Task 4: Layout A da etapa "Produtos"

**Files:**
- Modify: `src/components/estoque/importar-nota/etapa-itens.tsx`
- Test: `src/components/estoque/importar-nota/__tests__/etapa-itens.test.tsx` (criar se não existir, no padrão dos testes de `src/components/estoque/__tests__`)

**Interfaces — Consumes:** Task 3 (`itemPronto`, `contarProntos`, `origemVinculo 'nota'`, `candidatosNota`, `conferirFalhou`, `onTentarNovamente`); `ProdutoEstoqueResumo` (`nomePai`, `codigoPai`, `qtdSkus`, `capaStoragePath`, `capaMlPictureId`); `quantidadeEmEstoque`, `custoAquisicaoUnit`, `formatarNomeProduto`, `fmtBRL`.

Comportamento (spec §2.1, textos das Global Constraints): topo "N de M itens prontos"; cartão com produto = foto (mesma resolução de capa usada na tela Estoque), nome, código, "N SKUs", selo (Vinculado / Casou pelo GTIN / Produto escolhido / Cadastrado desta nota), "Trocar" → seletor + "Cancelar" + "Cadastrar produto novo" (mantido acessível durante o Trocar — é a saída indicada pela Distribuição para grade incompleta de produto não publicado; Cancelar preserva a seleção); linha de detalhe `Item N · na nota: "<xProd>" · <qCom> <uCom> [× fator = Q unidades] · R$ <custo>/unidade`; progresso "Distribuídas: X de Q · faltam R" + barra com `aria-valuenow`; sem produto = selo "Sem produto" (ou "Cadastrado mais de uma vez — escolha" com `candidatosNota`) + "Cadastrar produto novo" (primário) e "Escolher existente…" (secundário, foca a busca); com `conferirFalhou`: aviso + "Tentar novamente", e nos itens vazios "Escolher existente…" vira primário; seletor sem texto mostra só candidatos (`candidatosNota` ou `candidatosGtin`) ou "Digite para buscar"; com texto busca em **todos** os produtos; estados carregando/erro/sem resultado do catálogo (props `carregandoProdutos`/`erroProdutos`, distintos de catálogo vazio). Campo "Unidades por …" e a pergunta Grade/Simples mantidos.

- [ ] **Step 1: testes que falham** (render com estado montado à mão):
  - item vinculado mostra nome, código, "32 SKUs", selo e "Distribuídas: 0 de 35 · faltam 35"; não mostra input de busca.
  - item sem produto mostra "Sem produto", os dois botões e **nenhum** produto listado; clicar "Escolher existente…" mostra "Digite para buscar" e foca o input.
  - digitar "short" lista o short mesmo com `candidatosGtin` de 2 outros produtos.
  - "Trocar" → "Cancelar" mantém o produto anterior; "Trocar" mostra também "Cadastrar produto novo".
  - `erroProdutos` mostra erro (não "Digite para buscar"); `carregandoProdutos` mostra carregando.
  - `candidatosNota` de 2 → selo "Cadastrado mais de uma vez — escolha" e os 2 listados sem digitar.
  - `conferirFalhou` → aviso + "Tentar novamente" chama `onTentarNovamente`.
  - topo "1 de 2 itens prontos".
- [ ] **Step 2:** `pnpm test src/components/estoque/importar-nota` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** testes → PASS; `pnpm preflight:static` → OK.
- [ ] **Step 5:** Commit `feat(adr-0181): etapa Produtos da importação em cartões enxutos`.

### Task 5: Validação, deploy e merge

- [ ] **Step 1:** `pnpm preflight` → verde.
- [ ] **Step 2:** Revisão final do diff da branch pelo Codex gpt-6.1-sol high (read-only); corrigir achados (uma rodada de correção + re-revisão escopada).
- [ ] **Step 3:** Deploy das edges que importam os módulos `_shared`/funções alterados (grafo transitivo via `deno info`, como no ADR-0182); conferir versão e `verify_jwt`. Edge antes do front: front atual não manda `refNota` e segue igual.
- [ ] **Step 4:** Browser real em sessão isolada (playwright-cli), sem gravar em produção: etapa 2 com o XML da NF 1051 se disponível (senão XML de teste), rotas injetadas para produtos e para `produtosCadastradosDaNota`; screenshots dos estados (vinculado, sem produto, ambíguo, falha + tentar novamente) e 390px.
- [ ] **Step 5:** Docs vivos (skill `docs-update-checklist`), merge fast-forward com CI verde, Graphify, remover worktree/branch.
