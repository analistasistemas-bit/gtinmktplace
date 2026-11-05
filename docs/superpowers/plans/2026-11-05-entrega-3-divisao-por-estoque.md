# Entrega 3 — Divisão automática por estoque Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando um anúncio passa de 99.999, o sistema detecta, monta o plano de quais cores mover e, com um clique do operador, move essas cores para outro anúncio, em vez de esconder saldo.

**Architecture:** O sinal vem da Entrega 2 (`confirmacoes_ml.capados > 0`), então a família continua no atalho com teto até a aprovação. Uma função pura monta o plano; a edge `divisao-estoque` mostra a prévia e grava a aprovação; o worker `dividir-estoque-ml` executa uma saga retomável por cor. Publicação nova já nasce dividida por soma.

**Tech Stack:** Deno edge functions, Postgres + RPC, QStash, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-confirmacao-ml-e-divisao-por-estoque-design.md` (Entrega 3)

## Global Constraints

- `LIMITE_ESTOQUE_ML = 99999`, `MAX_VARIACOES_ML = 100`, importados de onde já existem.
- Nada escreve no ML sem aprovação do operador. Anúncio novo passa pela prévia.
- Ordem da saga: zerar a origem e confirmar por leitura → criar no destino → mover vínculos. Nunca o inverso.
- Cor movida fica zerada na origem, nunca excluída. A origem nunca fica com mapa vazio: `alvos.ts:58` mandaria todos os SKUs.
- Durante a saga, nenhum escritor toca nos SKUs ativos: `sincronizar-estoque`, `update-familia-ml`, `publicar-split-ml`.
- Mudança de pertencimento (mapas das duas partições e `variacoes.ml_variation_id`) é atômica, por RPC `service_role`.
- Sem dado de venda, a cor conta como vendida.
- Só a primeira tela de aprovação cria trabalho; retry nunca duplica anúncio: adota por SKU (`buscarPorSku`, padrão da saga UP).
- ML: `preservarPublicadas: true` ao adicionar cor em partição existente, para não mexer nas cores dela.
- Migration só por `supabase migration new` + `db push`. RLS por `org_id`. Admin aprova; demais só veem.

## Protocolo da saga (revisão do Codex)

**Exclusão mútua.** A divisão liga a barreira `anuncios_externos.dividindo_desde` em **todas** as partições da família antes de qualquer escrita. Depois de ligar, espera drenar: nenhuma família do `codigo_pai` em `publicando`. O worker roda na fila serial `estoque-<org>` (`filaEstoque`), a mesma de `sincronizar-estoque`, então push em voo termina antes do zeramento e push novo vem depois. Com barreira ligada, `sincronizar-estoque` adia o produto (mantém a pendência do outbox, sem escrever), e `update-familia-ml`, `publicar-split-ml` e o claim de `publicar-familias` recusam com mensagem.

**Erro.** `erro` mantém a barreira. O índice único parcial cobre `planejado, origem_zerada, destino_criado, erro`. Só sai por **Retomar** na tela (admin), que reexecuta do estado salvo. Nenhuma divisão nova com barreira ligada.

**Identidade.** `mover_sku_particao` faz, numa transação: troca dos mapas das duas partições e `variacoes.ml_variation_id` do SKU apenas na família mais recente publicada e nas famílias em lote aberto (`pronto`, `erro`). Famílias históricas ficam intactas: venda antiga resolve custo pelo ID antigo (`sales-costs.ts:85`), venda nova pelo ID novo. Regressões obrigatórias: lote aberto no meio da saga, próximo ingest herdando o ID novo, UPDATE da cor casada, custo de venda antiga com custos diferentes por cor, fiscal usando item e variação novos.

**Recuperação.** Não usar `buscarPorSku` (exige `family_name`). Usar `GET /users/{id}/items/search?sku=` (medido em 05/11), excluindo os itens conhecidos da família. Destino existente: reler o item e achar a variação por `seller_custom_field`. Partição nova: gravar título e `item_destino` esperado antes do POST; exatamente 1 item desconhecido com o SKU é adotado; 0 cria; mais de 1 vai a `erro`.

**Detecção.** O sinal é `capados > 0` em `confirmacoes_ml`, e a família segue no atalho com teto até a aprovação (o desenho foi ajustado). Depois da divisão, o atalho continua: toda cor ancorada e casada, o split em somente estoque não cria nada. Teste obrigatório: atualizar estoque depois da divisão não cria anúncio nem variação. Teto no push avisa uma vez no sino, chave `teto:<item>`.

**Capacidade.** `publicar-split-ml` passa a `particionarPorPreco` a contagem real de variações por partição, lida do item ao vivo, incluindo as zeradas.

**Push com teto.** Calcula sobre o payload completo do item: variações pedidas com o novo saldo e as demais com o saldo vivo, preservando o zero da cor movida.

## Review Focus

1. Venda no ML entre planejar e zerar: saldo real muda; a cor nasce no destino com o saldo do momento da criação. Teste na Task 4.
2. Crash depois do POST no ML e antes de gravar o ID: retry adota por SKU, sem anúncio duplicado. Teste na Task 4.
3. Cores sem venda não bastam: plano usa as de menor venda, marcadas. Teste na Task 2.
4. Planilha nova durante a saga: família fica recusada com mensagem, sem escrita. Teste na Task 5.
5. Preço diferente entre partições: cor só vai a destino da mesma faixa, senão partição nova. Teste na Task 2.

---

### Task 1: Tabela de movimentação e RPC atômica

**Files:**
- Create: `supabase/migrations/<timestamp>_adr195_divisoes_estoque.sql`, `supabase/tests/adr195_divisoes_estoque.sql`
- Modify: `src/lib/database.types.ts`, `docs/reference/modelo-de-dados.md`

**Interfaces:**
- Produces: tabela `divisoes_estoque_cores`: `id`, `org_id`, `divisao_id uuid`, `codigo_pai`, `sku`, `particao_origem int`, `particao_destino int`, `item_origem text`, `item_destino text null`, `status` check em `planejado, origem_zerada, destino_criado, concluido, erro`, `erro text`, `saldo_movido int null`, `titulo_destino text null`, `aprovado_por uuid`, `criado_em`, `atualizado_em`. Índice único parcial `(org_id, codigo_pai, sku) where status in ('planejado','origem_zerada','destino_criado','erro')`. Coluna `anuncios_externos.dividindo_desde timestamptz null`. RLS select por org; escrita só service role.
- Produces: `public.mover_sku_particao(p_org uuid, p_codigo_pai text, p_sku text, p_origem int, p_destino int, p_variacao_externa jsonb)`, `security definer`, só `service_role`: numa transação, trava as duas linhas de `anuncios_externos`, recusa se a origem ficaria sem SKU, tira o SKU do mapa da origem, o põe no destino e atualiza `variacoes.ml_variation_id` conforme o Protocolo. Recebe também `p_variation_id text`.

- [ ] **Step 1:** Escrever o teste SQL: mover SKU troca os mapas; recusa esvaziar a origem; `authenticated` sem `EXECUTE`; índice parcial barra duas linhas ativas do mesmo SKU.
- [ ] **Step 2:** `python3 scripts/teste-sql-desfeito.py <teste>` sem migration. Expected: falha.
- [ ] **Step 3:** Escrever a migration, com `revoke` antes de qualquer troca de dono.
- [ ] **Step 4:** Rodar com a migration. Expected: `TESTE_OK`. Atualizar tipos. Commit.

### Task 2: Plano de divisão (função pura)

**Files:**
- Create: `supabase/functions/_shared/split/planejar-divisao.ts`
- Test: `supabase/functions/_shared/split/__tests__/planejar-divisao.test.ts`

**Interfaces:**
- Produces:
  - `CorPlano = { sku: string; cor: string | null; estoque: number; vendidoMl: number | null; vendas90d: number | null }`
  - `ParticaoPlano = { particao: number; itemId: string; precoCentavos: number | null; variacoesReais: number; cores: CorPlano[] }`
  - `planejarDivisao(particoes: ParticaoPlano[]): { movimentos: Array<{ sku: string; origem: number; destino: number; estoque: number; comVenda: boolean }>; novasParticoes: number[]; indivisiveis: string[] }`

- [ ] **Step 1: Testes.** Linha real: partição 0 com soma 189.977 e 100 cores, partição 1 com 36.133 e 18 → origem fica ≤ 99.999, destino nenhum acima do limite, total de 3 partições. Só tira de partição acima do limite. Prioridade: sem venda nas duas fontes, depois maior estoque. `null` conta como vendida. Sem-venda insuficiente → completa com menor venda, `comVenda: true`. Destino exige mesma faixa de preço, vaga em `variacoesReais < 100` e saldo. Partição nova com 100 cores no máximo. Cor acima de 99.999 → `indivisiveis`. Nenhuma acima → plano vazio. A origem nunca fica sem cor.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar: guloso, com a ordem acima; destino = partição de menor índice que comporta.
- [ ] **Step 4:** Rodar. Expected: PASS. Commit.

### Task 3: Edge `divisao-estoque` (prévia e aprovação) e tela

**Files:**
- Create: `supabase/functions/divisao-estoque/index.ts`, `processar.ts`, teste
- Create: `src/components/lotes/dialog-divisao-estoque.tsx`, `src/lib/divisao-estoque.ts`, teste
- Modify: `src/components/lotes/resumo-confirmacao-ml.tsx`, `supabase/config.toml` (`verify_jwt = true`)

**Interfaces:**
- Produces: `POST divisao-estoque` `{ acao: 'previa', codigo_pai }` → `{ movimentos, novasParticoes, indivisiveis, somaAtual, tituloSugerido }`, só leitura (`requireUserOrg`; `sold_quantity` por GET do item; 90 dias de `estoque_movimentos`). `{ acao: 'aprovar', codigo_pai, plano_hash }` → recalcula, recusa se o hash mudou (409), exige admin, grava as linhas `planejado`, enfileira o worker.

- [ ] **Step 1: Testes.** Prévia não escreve. Aprovar sem admin → 403. Hash divergente → 409 sem linhas. Divisão ativa → 409. Diálogo mostra cores, de/para, marca as com venda, título do anúncio novo, e confirma uma vez.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar. No resumo da conferência, com `capados > 0`, botão "Ver divisão do anúncio". Copy sem jargão. Dialog no padrão de espera do ADR-0163.
- [ ] **Step 4:** Rodar. Expected: PASS. Commit.

### Task 4: Worker `dividir-estoque-ml`

**Files:**
- Create: `supabase/functions/dividir-estoque-ml/index.ts`, `processar.ts`, teste
- Modify: `supabase/functions/_shared/queue.ts`, `supabase/config.toml` (`verify_jwt = false`)

**Interfaces:**
- Consumes: `conn.atualizarEstoque`, `conn.atualizarAnuncio` com `preservarPublicadas`, `conn.criarAnuncio`, `gerarTituloParticao`, `lerEstoqueItens`, busca por `?sku=`, `mover_sku_particao`, `registrarConfirmacao`, `enfileirarSincronizacaoFiscal(…, { split: true })`, `notificarCategoria`.
- Produces: `enfileirarDivisao(job: { divisao_id: string; org_id: string }, delaySeconds?: number)`, na fila serial `filaEstoque(org)`.

- [ ] **Step 1: Testes.** Estado por estado, com retomada de cada um. Liga a barreira antes de tudo; espera (retry com atraso) enquanto houver família `publicando`. Origem zerada só avança com leitura confirmando 0; divergência → `erro`, sem criar destino. Cria com saldo real lido na hora. Crash depois do POST em partição nova e depois do PUT em destino existente: retry acha pelo item/`seller_custom_field` e adota; 2 itens desconhecidos → `erro`. Falha ao criar: `erro`, barreira ligada, aviso no sino com os SKUs, origem segue zerada, e Retomar reexecuta. Ao concluir: `mover_sku_particao`, `registrarConfirmacao`, fiscal enfileirado, barreira desligada, aviso de conclusão.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar. Reentrega idempotente por status. Saga processa cores em lote por destino.
- [ ] **Step 4:** Rodar. Expected: PASS. Commit.

### Task 5: Escritores respeitam a divisão, teto no push, publicação nova

**Files:**
- Modify: `supabase/functions/_shared/canais/mercado-livre.ts` (`atualizarEstoque`), `supabase/functions/sincronizar-estoque/processar.ts`, `supabase/functions/update-familia-ml/processar.ts`, `supabase/functions/publicar-split-ml/index.ts`, `supabase/functions/vincular-catalogo/index.ts:124`, `supabase/functions/_shared/split/particionar.ts`, `supabase/functions/publicar-familias/decidir-split.ts`, `supabase/functions/publicar-familias/index.ts`
- Test: os `__tests__` de cada um

**Interfaces:**
- Produces: `familiaEmDivisao(admin, orgId, codigoPai): Promise<boolean>`; `decidirSplit` ganha `somaEstoque?: number` e `operacao: 'CREATE' | 'UPDATE'`.

- [ ] **Step 1: Testes.** Push: soma com as variações vivas acima do limite → aplica `caparEstoque`, sem GET extra. `sincronizar-estoque` adia produto com barreira, sem escrever e sem perder a pendência. UPDATE, split e claim recusam família com barreira, com mensagem, sem escrita. `vincular-catalogo` espelha só os SKUs da partição 0 em família dividida. CREATE com soma acima do limite vai ao split, e `particionarPorPreco` abre partição quando a soma estouraria. UPDATE em somente estoque continua sem split por soma. `particionarPorPreco` respeita a contagem real informada pelo split. Teto no push preserva o zero da cor movida, com reposição parcial e outras variações vivas. Regressões do Protocolo em Identidade.
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar os `__tests__` dos módulos alterados. Expected: PASS. Commit.

### Task 6: Revisão, merge, deploy e divisão da Linha

- [ ] **Step 1:** Revisão do diff pelo Codex, rodada única; corrigir. `pnpm preflight:static`.
- [ ] **Step 2:** Sequência, um passo por vez: push, CI verde em todos os checks, `db push`, conferir, `fetch` da main, push fast-forward, só então deploy das funções (`update`, `split`, `sincronizar-estoque` e dependentes de `_shared`), conferindo `verify_jwt`.
- [ ] **Step 3:** Docs, ADR-0195 com o desenho final, `docs/TASKS.md`.
- [ ] **Step 4:** Diego abre a prévia da Linha `02835002` e aprova. Conferir por SKU no ML: origem com as cores zeradas, destino com o saldo, soma de cada anúncio abaixo do limite, e nenhum corte em 1.164.
