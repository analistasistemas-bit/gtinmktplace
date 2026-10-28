# Pós-venda do ML no PubliAI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolver reclamações, devoluções e mensagens do Mercado Livre pelo PubliAI (aba Pós-venda com 3 sub-abas igual ao ML), incluindo revisar devolução com fotos e agir nas reclamações.

**Architecture:** O sync (`sync-devolucao`, as duas chamadas de `upsertDevolucao` no `reconciliar-faturamento` e a do `backfill-faturamento`) passa a gravar em `ml_devolucoes` o que a lista precisa (texto do ML, prazo, de quem é a vez, revisão pendente, rastreio, reputação). O detalhe da reclamação é lido **ao vivo** por `posvenda-detalhe`. Toda escrita no ML passa por `posvenda-acao`: reserva atômica do **recurso de negócio** em `ml_posvenda_acoes`, releitura do ML **depois** da reserva, execução, confirmação pelo efeito específico, re-sync estrito + financeiro. Fotos sobem por `posvenda-anexo` direto ao ML.

**Tech Stack:** React 19 + Tailwind v4 + TanStack Query + vitest; Supabase Edge Functions (Deno) + Postgres (migrations via CLI, ADR-0043); API post-purchase do ML.

**Spec:** `docs/superpowers/specs/2026-10-28-posvenda-ml-design.md`
**Revisão do plano:** Codex gpt-6.1-sol high, 28/10 — 12 achados incorporados nesta versão.

## Global Constraints

- Nenhuma escrita no ML sem clique + confirmação explícita; depois de agir, a UI mostra o estado **relido do ML**, nunca otimista.
- Qualquer membro autenticado da org executa as ações (`requireUserOrg(req, { access: 'write' })`), decisão do Diego (28/10).
- Ação só é aceita se estiver em `players[type=seller].available_actions` do claim **relido depois da reserva**.
- **Dono × executor:** toda escrita em `ml_devolucoes`/`ml_mensagens` usa como `user_id` o **dono da conexão** (`marketplace_connections.criado_por`, o mesmo do sync); quem clicou vai só em `ml_posvenda_acoes.user_id`.
- RLS por `org_id`; token do ML nunca no front; edges idempotentes.
- Telas novas: `Select` de `src/components/ui/select.tsx`; nunca `<select>` nativo.
- Migrations só por `supabase migration new` + `supabase db push`; `npm run db:check`.
- 403 do ML numa ação → "Reconecte a conta do Mercado Livre em Configurações → Conexões (falta permissão de escrita)".
- Anexos: JPG, PNG ou PDF, até 5 MB cada (doc `gerenciar-evidencias-de-reclamacoes`); revisão de devolução só imagem.
- **Fora da v1 (call do Claude, 28/10):** comprovação de envio (`actions/evidences`, `add_shipping_evidence`) — só serve para envio por conta própria; 100% das vendas dos últimos 90 dias foram Mercado Envios (5.882 `xd_drop_off`, 26 `drop_off`).

## Review Focus

1. **Duas pessoas (ou duas abas) agindo no mesmo recurso com ações diferentes** (uma "Chegou OK", outra "Tem problema") → só a primeira reserva passa; a segunda recebe 409 "Outra ação já está em andamento/feita nesta devolução". Teste de concorrência real na Task 5 (dois inserts simultâneos, não só `chaveRecurso`).
2. **Edge morre ou dá timeout depois do POST no ML** → a tentativa fica `desconhecido`; repetir **não** reenvia às cegas: relê o ML e só libera novo POST se o efeito não existir. Teste na Task 5.
3. **Devolução com revisão pendente cujo claim já está `closed`** (caso real 5597930682) → continua na fila Urgentes e continua sendo relida pelo reconciliar. Testes nas Tasks 2 e 8.
4. **Ação aceita pelo ML mas a releitura ainda não mostra o efeito** → UI "Enviado ao ML; confirmando…" com nova leitura (sem reenviar); confirmação pelo **efeito** (mensagem no histórico, revisão registrada, oferta registrada), não pelo sumiço da ação. Teste na Task 5.
5. **Responder em mediação (`stage=dispute`)** → vai ao mediador (`receiver_role: 'mediator'`), nunca ao comprador. Teste na Task 5.

---

### Task 1: ADR-0192 + migration

**Files:**
- Create: `docs/decisions/0192-posvenda-ml-acoes.md`; Modify: `docs/decisions/README.md`
- Create: `supabase/migrations/<timestamp>_posvenda_ml.sql` (via `supabase migration new posvenda_ml`)

**Interfaces — produces:**
- `ml_devolucoes` + colunas: `return_id bigint`, `detalhe jsonb` (`{title, description, problem, due_date, action_responsible}`), `prazo timestamptz`, `vez_de text check (vez_de in ('vendedor','comprador','ml'))`, `revisao_pendente boolean not null default false`, `afeta_reputacao text`, `rastreio text`.
- Tabela `ml_posvenda_acoes`: `id uuid pk default gen_random_uuid()`, `org_id uuid not null`, `user_id uuid not null` (executor), `claim_id bigint not null`, `return_id bigint`, `recurso text not null` (chave de exclusão de negócio, ver Task 5), `acao text not null`, `payload jsonb not null default '{}'`, `estado text not null check (estado in ('reservada','enviada','confirmada','recusada','desconhecido'))`, `erro text`, `resposta_ml jsonb`, `criado_em timestamptz not null default now()`, `atualizado_em timestamptz not null default now()`.
- Índice **parcial único** `(org_id, recurso) where estado in ('reservada','enviada','desconhecido')` — no máximo uma ação em voo por recurso; `confirmada`/`recusada` não bloqueiam a próxima.
- RLS: `select` para membro da org (mesmo predicado por `org_id` das tabelas de faturamento); sem insert/update para `authenticated` (só service role).

- [ ] **Step 1:** `git fetch`; confirmar 0192 livre em `origin/main:docs/decisions/` (senão o próximo).
- [ ] **Step 2:** escrever o ADR: decisão (colunas, tabela/estados, reserva por recurso, edge única com allowlist, detalhe ao vivo, fotos sem storage, comprovação de envio fora da v1), permissão (qualquer membro), dono × executor, consequências (≈3 GETs a mais por claim processado; 403 = reconectar).
- [ ] **Step 3:** DDL idempotente (`add column if not exists`, `create table if not exists`, `create unique index if not exists`).
- [ ] **Step 4:** `npm run db:check`; `supabase db push`; conferir colunas e o índice parcial em `pg_indexes`.
- [ ] **Step 5:** Commit `feat(posvenda): ADR-0192 + colunas de pós-venda e ml_posvenda_acoes`.

### Task 2: Mapeamento puro do claim para a lista

**Files:** Modify `supabase/functions/_shared/faturamento/devolucao.ts`, `reconciliar-filtros.ts`; Test `__tests__/devolucao.test.ts`, `__tests__/reconciliar-filtros.test.ts`

**Interfaces — produces:**
- `export interface DetalheClaimML { title?: string|null; description?: string|null; problem?: string|null; due_date?: string|null; action_responsible?: string|null }`
- `ReturnML` + `id?: number|null; tracking?: string|null`
- `export interface RevisaoML { seller_status?: string|null; stage?: string|null }` (de `returns/{id}/reviews` → `reviews[].resource_reviews[]`)
- `export interface ExtrasClaim { detalhe?: DetalheClaimML|null; afetaReputacao?: string|null; revisoes?: RevisaoML[]|null }`
- `mapearDevolucao(claim, ret?, extras?): DevolucaoRow` — `DevolucaoRow` + `return_id, detalhe, prazo, vez_de, revisao_pendente, afeta_reputacao, rastreio`.
- `export function acoesDoVendedor(claim: ClaimML): AcaoPendente[]` — só o player `type === 'seller'`; `acoes_pendentes` passa a usar isto.
- `export function vezDe(r): 'vendedor'|'comprador'|'ml'|null` — `respondent|seller`→vendedor, `complainant|buyer`→comprador, `mediator|internal`→ml.
- `export function revisaoPendente(acoes: AcaoPendente[], revisoes: RevisaoML[]|null|undefined): boolean` — true se há `return_review_ok`/`return_review_fail` nas ações **ou** alguma revisão com `seller_status` nulo/`pending` (independe de o claim estar `closed`).
- `DevolucaoLocal` + `revisao_pendente`; `claimPrecisaProcessar` retorna `true` se `local.revisao_pendente` (antes da carência).

- [ ] **Step 1: testes que falham** (dados reais de 28/10):
  - 5600661190: `detail.action_responsible='complainant'`, `due_date '2026-11-03T22:08:00.000-04:00'`, seller actions `send_message_to_complainant, refund, open_dispute` → `vez_de 'comprador'`, `prazo` = due_date, `revisao_pendente false`, 3 ações.
  - claim **`closed`** com `revisoes: [{ seller_status: null, stage: 'closed' }]` e sem ações → `revisao_pendente true` (Review Focus 3).
  - `revisoes: [{ seller_status: 'success' }]` → `false` (estado real de 5597930682 após revisar).
  - ações do player `buyer` não entram.
  - `ret = { id: 169980422, status: 'delivered', status_money: 'refunded', tracking: 'J32UIUZHMJM7PNIQNI35ZBHILI' }` → `return_id`, `rastreio`.
  - sem `ret`/`extras` (mediação pura) → campos novos `null`/`false`.
  - `claimPrecisaProcessar` com `local.status='closed'`, `revisao_pendente: true`, fechado há 60 dias → `true`.
- [ ] **Step 2:** `pnpm vitest run supabase/functions/_shared/faturamento` → FAIL nos novos.
- [ ] **Step 3:** implementar; `prazo` = `detalhe.due_date` ?? menor `due_date` das ações do vendedor ?? null.
- [ ] **Step 4:** PASS (incluindo `claim-de-compra` e o resto inalterados). Commit.

### Task 3: Sync grava os campos novos (persistência estrita)

**Files:** Modify `supabase/functions/_shared/faturamento/devolucoes-io.ts`, `supabase/functions/sync-devolucao/index.ts`, `supabase/functions/reconciliar-faturamento/index.ts` (**linhas ~143 do caminho `legado()` e ~353 de `processarClaims`**), `supabase/functions/backfill-faturamento/index.ts` (~165)

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `buscarReturn` preenche `id` e `tracking` (`shipments[type=return].tracking_number`).
  - `export async function buscarExtrasClaim(token: string, claimId: string, returnId: number|null): Promise<ExtrasClaim>` — em paralelo: `/detail`, `/affects-reputation`, e `v1/returns/{returnId}/reviews` quando `returnId`; cada falha vira campo `null`.
  - `upsertDevolucao(admin, userId, orgId, claim, ret, contaExternaId, extras?)` — **lança** em erro do Supabase (hoje ignora) e devolve a linha **lida do banco** após o upsert. Os callers atuais já tratam exceção como falha do claim (`try` no reconciliar; retry QStash no sync).
  - `carregarDevolucoesLocais` seleciona também `revisao_pendente`.

- [ ] **Step 1:** implementar; passar `extras` nos **4** callers (sync, reconciliar legado, reconciliar `processarClaims`, backfill).
- [ ] **Step 2:** `pnpm lint:functions && pnpm check:functions`; `pnpm vitest run supabase/functions` verde.
- [ ] **Step 3:** Commit. (Prova em produção na Task 9.)

### Task 4: Edge `posvenda-detalhe` (leitura ao vivo)

**Files:** Create `supabase/functions/posvenda-detalhe/index.ts` (+ `[functions.posvenda-detalhe] verify_jwt = true` no `config.toml`), `supabase/functions/_shared/faturamento/posvenda.ts` + `__tests__/posvenda.test.ts`, `src/lib/edge.ts` (move `postEdge` de `src/lib/mensagens.ts`), `src/lib/posvenda.ts`

**Interfaces:**
- Body `{ claim_id: string }` (dígitos). Confere `ml_devolucoes` com `org_id` da sessão + `claim_id` antes de chamar o ML.
- Resposta `DetalheReclamacao`:
  ```ts
  { claim_id: number; return_id: number|null; stage: 'claim'|'dispute'|string|null;
    estado: { titulo, descricao, problema, prazo, vez_de };
    comprador_quer: string|null; afeta_reputacao: string|null; custo_devolucao: number|null;
    historico: Array<{ data: string; autor: 'comprador'|'vendedor'|'ml'; texto: string; anexos: string[] }>;
    acoes: string[];                                   // seller available_actions relidas agora
    motivos_falha_revisao: Array<{ id: string; texto: string; exige_foto: boolean }>;  // returns/reasons; exige_foto = id in ['SRF2','SRF4']
    reembolso_parcial: { ofertas: Array<{ percentual: number; valor: number }>; minimo: number|null } | null;  // só se 'allow_partial_refund'
  }
  ```
- Puros testados: `montarHistorico(mensagens, statusHistory)`, `motivosRevisao(resp)`, `autorDoPapel(role)`, `ofertasReembolso(resp)` (exclui 100% — reembolso total usa `refund`; `minimo` de `restrictions[type=minimum]`).

- [ ] **Step 1:** testes com o formato real (`sender_role: 'mediator'` → `ml`; `complainant` → comprador; `respondent` → vendedor; ordenado por data; os 6 SRF2…SRF7 com `exige_foto` só em SRF2/SRF4; ofertas `[{90,855},{100,950}]` → só 90).
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** edge + `buscarDetalheReclamacao(claimId)`; `mensagens.ts` passa a importar `postEdge` de `edge.ts` (testes de mensagens seguem verdes).
- [ ] **Step 4:** `pnpm check:functions`; Commit.

### Task 5: Edge `posvenda-acao` (escrita no ML)

**Files:** Create `supabase/functions/posvenda-acao/index.ts` (+ `verify_jwt = true`); Modify `_shared/faturamento/posvenda.ts` (+ testes), `src/lib/posvenda.ts`

**Interfaces:**
- `type AcaoPosvenda = 'revisar_ok' | 'revisar_falha' | 'responder' | 'reembolsar' | 'reembolso_parcial' | 'autorizar_devolucao' | 'abrir_disputa'`
- Body: `{ claim_id: string; acao: AcaoPosvenda; texto?: string; motivo_id?: string; order_id?: number; percentual?: number; anexos?: string[]; repetir_id?: string }`
- Puros testados:
  - `ACAO_ML`: `revisar_ok:['return_review_ok']`, `revisar_falha:['return_review_fail']`, `responder:['send_message_to_complainant','send_message_to_mediator']`, `reembolsar:['refund']`, `reembolso_parcial:['allow_partial_refund']`, `autorizar_devolucao:['allow_return','allow_return_label']`, `abrir_disputa:['open_dispute']`.
  - `destinatarioResposta(acoesLiberadas: string[], stage: string|null): 'complainant'|'mediator'|null` — `dispute` ou só `send_message_to_mediator` liberado → `mediator`; senão `complainant`.
  - `chaveRecurso(acao, claimId, returnId): string` — `revisar_*` → `return:{returnId}` (uma devolução pode ter vários claims); `reembolsar|reembolso_parcial|autorizar_devolucao|abrir_disputa` → `claim:{claimId}:resolucao`; `responder` → `claim:{claimId}:msg:{sha256(texto)}`.
  - `validarAcao(acao, body, ctx: { acoes: string[]; stage: string|null; ofertas: number[]; motivos: {id:string; exige_foto:boolean}[] }): { ok: true } | { ok: false; erro: string }` — ação fora de `ACAO_ML`∩`acoes`; `revisar_falha`: `motivo_id` ∈ motivos, `texto` obrigatório, anexo obrigatório se `exige_foto`; `responder`: texto 1..2000; `reembolso_parcial`: `percentual` ∈ ofertas.
  - `montarRequisicao(acao, claimId, returnId, body, receiverRole): { path: string; corpo: unknown }`:
    - `revisar_ok` → `/post-purchase/v1/returns/{returnId}/return-review`, `{}`
    - `revisar_falha` → mesmo path, `[{ reason: motivo_id, message: texto, attachments: anexos ?? [], ...(order_id ? { order_id } : {}) }]` (doc `gerenciar-devolucoes`; `order_id` só em revisão individual de carrinho)
    - `responder` → `/post-purchase/v1/claims/{id}/actions/send-message`, `{ receiver_role, message: texto, attachments }`
    - `reembolsar` → `.../expected-resolutions/refund`, `{}`; `reembolso_parcial` → `.../expected-resolutions/partial-refund`, `{ percentage: percentual }`; `autorizar_devolucao` → `.../expected-resolutions/allow-return`, `{}`; `abrir_disputa` → `.../actions/open-dispute`, `{}`
  - `efeitoConfirmado(acao, antes: DetalheReclamacao, depois: DetalheReclamacao, texto?: string): boolean` — `responder`: nova entrada no histórico do vendedor com o texto; `revisar_*`: `revisao_pendente` virou false (reviews com `seller_status` preenchido); resoluções: `expected-resolutions`/status mudou ou ação some.
- Fluxo da edge:
  1. auth (write); claim ∈ org; dono da conexão (`criado_por`).
  2. **Reserva:** insert `ml_posvenda_acoes { estado:'reservada', recurso: chaveRecurso(...) }`. Conflito no índice parcial → 409 "Outra ação já está em andamento ou foi feita neste item". Com `repetir_id` de uma tentativa `desconhecido`: retoma essa linha em vez de inserir.
  3. **Releitura depois da reserva:** `buscarDetalhe` (Task 4); `validarAcao`; se a tentativa retomada já tem o efeito (`efeitoConfirmado`) → `confirmada`, sem POST.
  4. POST no ML com timeout 20 s. 2xx → `enviada`; 4xx → `recusada` (+ mensagem do ML; 403 = reconectar); timeout/5xx/rede → `desconhecido` (UI oferece "Verificar de novo", que chama com `repetir_id`).
  5. Releitura + `efeitoConfirmado` → `confirmada` ou mantém `enviada` (`pendenteConfirmacao: true`).
  6. Re-sync **estrito** com o **dono** como `user_id`: `buscarClaim` + `buscarReturn` + `buscarExtrasClaim` + `upsertDevolucao`; para `revisar_*`/resoluções, enfileira `sync-devolucao` via QStash (recalcula líquido/estorno pelo pipeline existente). Falha do re-sync **não** muda o estado da ação nem reenvia; responde com `sincronizacaoPendente: true`.
  7. Resposta `{ ok: true, acao_id, estado, pendenteConfirmacao, sincronizacaoPendente, devolucao }`.

- [ ] **Step 1: testes puros** — `validarAcao` (ação não liberada; SRF5 sem foto ok; SRF2 sem foto recusa; mensagem vazia recusa; percentual fora das ofertas), `montarRequisicao` (as 7 ações; carrinho com `order_id`), `destinatarioResposta` (claim → complainant; dispute → mediator — Review Focus 5), `chaveRecurso` (`revisar_ok` e `revisar_falha` do mesmo return → **mesma** chave), `efeitoConfirmado` (resposta publicada com a ação ainda liberada → true — Review Focus 4).
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3: teste SQL da exclusão** (Review Focus 1), via `scripts/teste-sql-desfeito.py` (memória: teste SQL sem Docker): dois inserts com o mesmo `(org_id, recurso)` e `estado='reservada'` → o segundo dá 23505; após `estado='recusada'`, novo insert passa.
- [ ] **Step 4:** edge + `executarAcaoPosvenda(body)`; `pnpm check:functions`; Commit.

### Task 6: Edge `posvenda-anexo` (fotos para o ML)

**Files:** Create `supabase/functions/posvenda-anexo/index.ts` (`verify_jwt = true`); Modify `_shared/faturamento/posvenda.ts` (+ teste), `src/lib/posvenda.ts`

**Interfaces:**
- `multipart/form-data`: `claim_id`, `destino: 'revisao'|'mensagem'`, `file`.
- `revisao` → `POST /post-purchase/v1/claims/{id}/returns/attachments`; `mensagem` → `POST .../claims/{id}/attachments`. Resposta do ML `{ user_id, file_name }` → `{ ok: true, anexo: file_name }`.
- Puro `validarArquivoAnexo(tipo: string, bytes: number, destino): string|null` (erro ou null): `revisao` só `image/jpeg|image/png`; `mensagem` também `application/pdf`; máx 5 MB.
- Front: `enviarAnexoPosvenda(claimId, destino, file): Promise<string>`.

- [ ] **Step 1:** teste de `validarArquivoAnexo` (HEIC → erro; 6 MB → erro; PDF em revisão → erro; PNG 1 MB → ok) → FAIL → implementar → PASS.
- [ ] **Step 2:** edge + helper; `pnpm check:functions`; Commit.

### Task 7: Mensagens — cards do ML e leitura sincronizada (sem confundir com dispensa)

**Files:** Create `supabase/functions/marcar-mensagens-lidas-ml/index.ts` (`verify_jwt = true`); Modify `_shared/faturamento/mensagens-io.ts`, `src/lib/mensagens.ts`, `src/components/faturamento/aba-mensagens.tsx`; Create `src/lib/mensagens-resumo.ts` + `src/lib/__tests__/mensagens-resumo.test.ts`

**Interfaces:**
- `ml_mensagens.lida` **continua significando "dispensada/tratada localmente"** (badge, `aguardando`, Dispensar não mudam). A leitura no ML vem de `raw->'message_date'->>'read'`.
- `buscarMensagensPack(token, pack, seller, marcarLida = false)`.
- Edge `marcar-mensagens-lidas-ml` `{ pack_id }`: GET com `mark_as_read=true`, upsert estrito das mensagens com o **dono** como `user_id` (atualiza `raw`); **não** toca em `lida`. Idempotente.
- `Conversa` + `shipping_status: string|null` (de `ml_vendas` por `order_id`, org-scoped) e `naoLidaML: boolean` (alguma recebida com `read` nulo).
- `resumirConversas(conversas): { naoLidas: { aPreparar; aCaminho; entregues; total }; lidas: { semResponder; respondidas } }` — a preparar `pending|handling|ready_to_ship`; a caminho `shipped`; entregues `delivered`; sem responder = `!naoLidaML` e última é do comprador e `aguardando`; respondidas = última é sua.
- UI: card recolhido igual ao ML ("Venda para preparar · Mensagem recebida há 13 horas · [Conferir mensagem]"); expandir mostra o chat WhatsApp atual e chama a edge **uma vez por pack**; cards-resumo filtram.

- [ ] **Step 1:** testes de `resumirConversas` (um caso por balde) e de componente: abrir → `marcarConversaLidaML` chamado 1×, conversa **continua** em "Sem responder"; Dispensar → sai; nova mensagem do comprador → volta para "Não lidas".
- [ ] **Step 2:** FAIL → implementar → PASS. Commit.

### Task 8: Aba Pós-venda (Reclamações + Devoluções + Mensagens)

**Files:** Create `src/components/faturamento/posvenda/{aba-posvenda,lista-reclamacoes,lista-devolucoes,detalhe-reclamacao,dialogo-revisar-devolucao,dialogo-confirmar-acao}.tsx`, `src/lib/posvenda-fila.ts` + `src/lib/__tests__/posvenda-fila.test.ts`, `src/components/faturamento/__tests__/posvenda.test.tsx`; Modify `src/pages/Faturamento.tsx` (abas Devoluções + Mensagens → **Pós-venda**; badge = urgentes + não lidas), `src/lib/devolucoes.ts` (colunas novas)

**Interfaces:**
- `classificar(d: Devolucao, agora: Date): 'urgente'|'andamento'|'concluida'` — **`revisao_pendente` → urgente mesmo com `status='closed'`**; `opened` e (`vez_de='vendedor'` ou ação `mandatory` do vendedor) → urgente; `opened` restante → andamento; `closed` sem revisão pendente → concluída. `ordenarFila(ds, agora)`: vencidas, depois `prazo` asc, sem prazo no fim. `agora` sempre injetado.
- Sub-abas: **Reclamações** = `mediations`, `cancel_purchase` e `returns` sem `return_id`; **Devoluções** = `returns` com `return_id` (cards) + botão "Histórico" com a `AbaDevolucoes` atual intacta; **Mensagens** = Task 7.
- Card: título/pedido/comprador; caixa com `detalhe.title`/`description`; prazo ("Último dia para revisar" quando `revisao_pendente`); botão da próxima ação.
- `dialogo-revisar-devolucao`: mockup aprovado; motivo + **mensagem obrigatória** + fotos (obrigatórias só se `exige_foto`); carrinho (pack com vários pedidos): escolher pedido(s) → `order_id`.
- `dialogo-confirmar-acao`: o que acontece no ML + "não dá para desfazer"; desabilita ao enviar; estados `enviada` ("Enviado; confirmando…" + releitura em 10 s), `desconhecido` ("Não sabemos se o ML recebeu" + "Verificar de novo" com `repetir_id`), `recusada` (mensagem do ML).
- Ações fora de `acoes` → botão desabilitado com `title`.

- [ ] **Step 1:** testes de `classificar`/`ordenarFila` (incluindo closed + `revisao_pendente` → urgente).
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** componentes + testes: SRF2 sem foto → enviar desabilitado; SRF5 sem foto e com mensagem → habilitado; duplo clique em confirmar → `executarAcaoPosvenda` 1×; estado `desconhecido` mostra "Verificar de novo"; ação não liberada → desabilitada.
- [ ] **Step 4:** `pnpm preflight:static` exit 0; Commit.

### Task 9: Revisão, deploy na ordem certa, validação real, merge

- [ ] **Step 1:** revisão do diff da branch pelo Codex (`gpt-6.1-sol`, high, read-only); corrigir (rodada única); CI verde na branch.
- [ ] **Step 2 — backend ANTES do front:** migration já aplicada (Task 1; conferir). Listar com grep as funções que importam `_shared/faturamento/{devolucao,devolucoes-io,mensagens-io,posvenda,reconciliar-filtros}.ts` e deployar **todas** + as novas (`posvenda-detalhe`, `posvenda-acao`, `posvenda-anexo`, `marcar-mensagens-lidas-ml`); `functions list` com versão nova e `verify_jwt` = `config.toml`.
- [ ] **Step 3:** prova do sync: re-enfileirar `sync-devolucao` de 5600661190 (receita `reference_ops`) → `vez_de='comprador'`, `prazo`, `detalhe->>'title'='Devolução em preparação'`.
- [ ] **Step 4:** só então merge fast-forward na `main` (Render publica o front) e conferir o CSS/JS novo servido.
- [ ] **Step 5:** validação visual com dados reais (Playwright; screenshot claro/escuro/390px): Pós-venda, 3 sub-abas, detalhe de 5600661190, diálogo de revisão.
- [ ] **Step 6:** com o Diego, primeira ação real pela UI (preferência: **responder** numa reclamação aberta — sem dinheiro); conferir `ml_posvenda_acoes.estado='confirmada'` e o ML.
- [ ] **Step 7:** docs (`edge-functions.md`, `project-status.md`, `TASKS.md`, vault via `docs-update-checklist`); `git pull --ff-only` no checkout principal; remover worktree/branch.
