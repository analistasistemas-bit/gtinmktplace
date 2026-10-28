# Pós-venda do ML no PubliAI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolver reclamações, devoluções e mensagens do Mercado Livre pelo PubliAI (aba Pós-venda com 3 sub-abas igual ao ML), incluindo revisar devolução com fotos e agir nas reclamações.

**Architecture:** O sync grava em `ml_devolucoes` o que a lista precisa (texto do ML, prazo, vez, revisão pendente, rastreio, reputação), preservando o último valor bom quando uma leitura falha; um enriquecimento único cobre as linhas antigas. O detalhe é lido ao vivo (`posvenda-detalhe`). Toda escrita passa por `posvenda-acao`, com **duas travas**: idempotência por operação (`operacao_id` gerado pelo cliente) e exclusão por recurso de negócio (índice parcial). **Regra de ouro: o PubliAI nunca reenvia uma ação de resultado incerto** — ela fica travada até a releitura do ML provar o efeito específico (confirmada) ou o próprio ML deixar de aceitar a ação (inconclusiva, liberada sem risco de duplicar).

**Tech Stack:** React 19 + Tailwind v4 + TanStack Query + vitest; Supabase Edge Functions (Deno) + Postgres (migrations via CLI, ADR-0043); API post-purchase do ML.

**Spec:** `docs/superpowers/specs/2026-10-28-posvenda-ml-design.md`
**Revisões do plano:** Codex gpt-6.1-sol high — rodadas 1 (12), 2 (11), 3 (9), 4 (6) e 5 (8 achados) incorporadas.

## Global Constraints

- Nenhuma escrita no ML sem clique + confirmação; a UI mostra o estado **relido do ML**, nunca otimista.
- Qualquer membro autenticado da org executa as ações (`requireUserOrg(req, { access: 'write' })`), decisão do Diego.
- **Dono × executor:** escrita em `ml_devolucoes`/`ml_mensagens` usa `user_id` = dono da conexão (`marketplace_connections.criado_por`); quem clicou vai em `ml_posvenda_acoes.user_id`.
- **Player da conta:** ações e papel saem do player cujo `user_id` = `conexao.contaExternaId` (claims de `shipment` usam `sender`/`receiver`; não presumir `type='seller'`).
- Nenhum reenvio automático de POST; nenhum POST quando a última tentativa do mesmo recurso está `reservada|enviada|desconhecido`.
- **A trava de um recurso só é liberada sem confirmação quando o próprio ML não aceita mais a ação** (ela saiu de `available_actions` e, para revisão, nenhum pedido está `pending`) — aí não existe risco de duplicar. Ação ainda liberada + resultado incerto = trava mantida, UI mostra "Conferir no ML".
- Leitura do ML que falha **não** apaga coluna já preenchida (upsert só das colunas lidas com sucesso).
- RLS por `org_id`; token nunca no front; `Select` de `src/components/ui/select.tsx`; migrations por CLI + `npm run db:check`.
- 403 do ML numa ação → "Reconecte a conta do Mercado Livre em Configurações → Conexões (falta permissão de escrita)".
- Anexos: revisão → JPG/PNG; mensagem → JPG/PNG/PDF; até 5 MB cada.
- **Fora da v1:** comprovação de envio (`actions/evidences`) — 100% Mercado Envios nos últimos 90 dias.

## Review Focus

1. **Resposta do servidor perdida depois de confirmar** (rede caiu) → o cliente repete com o mesmo `operacao_id` e recebe o resultado gravado, sem novo POST. Teste SQL + puro na Task 5.
2. **Timeout depois do POST, duas abas clicando "Verificar"** → nenhuma reenvia; ambas só releem o ML. Teste na Task 5.
3. **Revisão expirada vs. feita** (`seller_status='success'` também significa "não revisou a tempo") → a ação só vira `confirmada` se a tentativa foi `enviada` com 2xx **e** o estado mudou de `pending` depois do POST. Teste na Task 5.
4. **Devolução antiga, fechada há mais de 7 dias, com revisão `pending` no ML** → aparece nos Urgentes depois do enriquecimento. Teste nas Tasks 2–3.
5. **429/5xx do ML no sync de uma devolução já enriquecida** → nada some da fila. Teste na Task 3 (`colunasLidas`).

---

### Task 1: ADR-0192 + migration

**Files:** Create `docs/decisions/0192-posvenda-ml-acoes.md`; Modify `docs/decisions/README.md`; Create `supabase/migrations/<ts>_posvenda_ml.sql` (`supabase migration new posvenda_ml`)

**Interfaces — produces:**
- `ml_devolucoes` + `return_id bigint`, `detalhe jsonb` (`{title, description, problem, due_date, action_responsible}`), `prazo timestamptz`, `vez_de text check (vez_de in ('vendedor','comprador','ml'))`, `revisao_pendente boolean not null default false`, `revisao_status text` (último `seller_status` lido), `afeta_reputacao text`, `rastreio text`, `pedidos_devolucao jsonb` (order_ids da devolução, para carrinho), `enriquecido_em timestamptz` (null = falta enriquecer), `lido_em timestamptz` (versão do snapshot, Task 3).
- `ml_posvenda_acoes`: `id uuid pk`, `org_id uuid not null`, `user_id uuid not null`, `operacao_id uuid not null`, `claim_id bigint not null`, `return_id bigint`, `recurso text not null`, `acao text not null`, `payload jsonb not null`, `payload_hash text not null`, `antes jsonb` (snapshot relido antes do POST), `estado text not null check (estado in ('reservada','enviada','confirmada','recusada','desconhecido','inconclusiva','cancelada'))`, `post_em timestamptz` (gravado **antes** do fetch), `http_status int` (status do POST, null se não houve resposta), `resposta_ml jsonb`, `sync_pendente boolean not null default false`, `erro text`, `criado_em`, `atualizado_em`.
- Índices: `unique (org_id, operacao_id)`; **parcial único** `(org_id, recurso) where estado in ('reservada','enviada','desconhecido')`.
- RLS `select` membro da org; `revoke all on ml_posvenda_acoes from anon, authenticated; grant select on ml_posvenda_acoes to authenticated;` (default privileges do projeto concedem TRUNCATE, que RLS não cobre — precedente `20260924184220_central_promocoes.sql:58`). Teste: `has_table_privilege('authenticated','ml_posvenda_acoes','TRUNCATE')` = false.
- `ml_mensagens` + `lida_ml_em timestamptz` — recibo de leitura no ML, **monotônico** (só sai de null; nunca volta): escrito por `update ... set lida_ml_em = coalesce(lida_ml_em, $1)`, nunca pelo upsert de `raw`.

- [ ] **Step 1:** `git fetch`; confirmar 0192 livre (senão o próximo).
- [ ] **Step 2:** ADR: decisão (colunas, máquina de estados abaixo, regra de nunca reenviar, enriquecimento, detalhe ao vivo, fotos sem storage, fora da v1), permissão, dono × executor, custo (≈3 GETs a mais por claim processado).
- [ ] **Step 3:** DDL idempotente; `npm run db:check`; `supabase db push`; conferir colunas e índices em `pg_indexes`.
- [ ] **Step 4:** Commit.

### Task 2: Mapeamento puro

**Files:** Modify `supabase/functions/_shared/faturamento/devolucao.ts`, `reconciliar-filtros.ts`; Test `__tests__/devolucao.test.ts`, `__tests__/reconciliar-filtros.test.ts`

**Interfaces — produces:**
- `DetalheClaimML`, `ReturnML` + `id`, `tracking`, `pedidos: number[]` (de `orders[].order_id`); `RevisaoML { order_id: number; seller_status: string|null }`.
- `export function normalizarRevisoes(resp: unknown): RevisaoML[]` — envelope real `{ reviews: [{ resource: 'order', resource_id, resource_reviews: [{ seller_status, ... }] }] }`: um item por `resource_id`; com vários `resource_reviews`, `pending` se algum for `pending`, senão o último.
- `export type Leitura<T> = { ok: true; valor: T } | { ok: false }` — distingue "lido e vazio" de "falhou".
- `ExtrasClaim { detalhe: Leitura<DetalheClaimML|null>; reputacao: Leitura<string|null>; revisoes: Leitura<RevisaoML[]> }`
- `export function playerDaConta(claim: ClaimML, contaExternaId: string): ClaimML['players'][number] | null`
- `export function acoesDaConta(claim, contaExternaId): AcaoPendente[]` (substitui o agrupamento de todos os players em `acoes_pendentes`).
- `export function vezDe(responsavel, papelDaConta: string|null): 'vendedor'|'comprador'|'ml'|null` — igual ao papel da conta → vendedor; `mediator|internal` → ml; outro → comprador.
- `export function revisaoPendente(acoes: AcaoPendente[], revisoes: Leitura<RevisaoML[]|'sem_review'>): boolean` — **revisões lidas com sucesso têm precedência**: algum `pending` → true; todas terminais (`success|failed|claimed|''`) → false mesmo com `return_review_*` residual nas ações (o ML mantém ações em claims fechados, ver `src/lib/devolucoes.ts`); `'sem_review'` (404 *return review not found*) ou leitura falha → decide pelas ações.
- `export function colunasLidas(claim, ret: Leitura<ReturnML|null>, extras: ExtrasClaim, contaExternaId): Partial<DevolucaoRow>` — devolve **só** as colunas cujas leituras deram `ok`; `enriquecido_em` só quando as três leituras de `extras` e o return deram `ok`.
- `export function linhaParaUpsert(base: DevolucaoRow, lidas: Partial<DevolucaoRow>, retOk: boolean): Partial<DevolucaoRow>` — parte de `base`, remove as colunas que dependem do return quando `!retOk` e sobrepõe `lidas`.
- `claimPrecisaProcessar`: `true` também se `local.revisao_pendente` ou `local.enriquecido_em == null`.

- [ ] **Step 1: testes que falham:**
  - 5600661190 real (`action_responsible='complainant'`, conta = respondent) → `vez_de 'comprador'`, `prazo '2026-11-03T22:08:00.000-04:00'`, 3 ações da conta.
  - claim de shipment em que a conta é `receiver` → ações do player `receiver`.
  - `normalizarRevisoes` com o envelope completo da doc (carrinho com 2 `resource_id`, um com 2 `resource_reviews` sendo um `pending`) e com o real de 169980422 (`seller_status:'success'`).
  - `revisoes [{order_id:1, seller_status:'pending'}]`, claim `closed`, sem ações → `revisao_pendente true`; `null`/`''`/`success` → `false`; `success` **com** `return_review_ok` residual nas ações → `false`; `'sem_review'` com `return_review_ok` → `true`.
  - `linhaParaUpsert(mapearDevolucao(...), colunasLidas(...), retOk)` com `ret: {ok:false}` → objeto final **sem** `return_status`, `return_status_money`, `return_id`, `rastreio`; com `reputacao: {ok:false}` → sem `afeta_reputacao` e sem `enriquecido_em` (Review Focus 5). Testar o objeto final, não só `colunasLidas`.
  - `claimPrecisaProcessar` para linha legada `closed` há 60 dias com `enriquecido_em: null` → `true` (Review Focus 4).
- [ ] **Step 2:** FAIL → implementar → PASS (demais testes do diretório inalterados). Commit.

### Task 3: Sync e enriquecimento

**Files:** Modify `_shared/faturamento/devolucoes-io.ts`, `sync-devolucao/index.ts`, `reconciliar-faturamento/index.ts` (chamadas em ~143 `legado()` e ~353 `processarClaims`), `backfill-faturamento/index.ts` (~165)

**Interfaces:**
- `buscarReturnLeitura(token, claimId): Promise<Leitura<ReturnML|null>>` — 404 → `{ok:true, valor:null}`; outro erro → `{ok:false}`; `buscarReturn` antigo continua para quem não precisa.
- `buscarExtrasClaim(token, claimId, returnId): Promise<ExtrasClaim>` — `/detail`, `/affects-reputation`, `v1/returns/{returnId}/reviews` (sem return → `{ok:true, valor:[]}`; 404 *return review not found* → `{ok:true, valor:'sem_review'}`; outro erro → `{ok:false}`).
- `upsertDevolucao(admin, userId, orgId, claim, ret: Leitura<ReturnML|null>|ReturnML|null, contaExternaId, extras?)` — grava `linhaParaUpsert(...)` (nunca sobrescreve com null o que falhou de ler); **lança** em erro do Supabase; devolve a linha lida do banco. Sem `extras` (chamada antiga), não toca nas colunas novas.
- `carregarDevolucoesLocais` seleciona `revisao_pendente, enriquecido_em`.
- **Snapshot antigo não sobrescreve novo:** coluna `ml_devolucoes.lido_em timestamptz` (instante da leitura no ML, capturado **antes** dos GETs). O upsert vira RPC `upsert_ml_devolucao(linha jsonb)` que só aplica se `excluded.lido_em >= ml_devolucoes.lido_em` (ou a linha não existe). Teste SQL: gravar lido_em T2, depois tentar T1 < T2 → linha inalterada.
- Job do `sync-devolucao` aceita `{ user_id, claim_id, org_id?, connection_id? }`; com `org_id`/`connection_id` usa a conexão informada (validando `org_id`) em vez de `resolverOrgPorUserId` (que falha se o mesmo criador tem conexões em duas orgs). O `carregarCatalogo` do `sync-devolucao` passa a receber a org já resolvida (assinatura `carregarCatalogo(admin, userId, orgId?)`; com `orgId`, não chama `resolverOrgPorUserId`) e `memoCatalogo` usa `orgId:userId` como chave. O `ml-webhook` passa a enviar `org_id` (já resolvido por `resolverIdentidade`) nos jobs de `claims` — `ml-webhook` entra nesta task e no deploy.

- Enriquecimento das linhas antigas: `export async function enriquecerPendentes(admin, token, org, conexao, limite = 20): Promise<number>` — lê de `ml_devolucoes` da org `where enriquecido_em is null order by claim_id` (paginado pelo `claim_id`, sem depender de `buscarClaimsSeller`, que corta em 2.000 por status), busca cada claim por id e faz o upsert. Vira a etapa `enriquecer` do `reconciliar-faturamento` (cursor = último `claim_id`), antes de `mensagens`.
- [ ] **Step 1:** implementar e passar `extras` nos 4 callers; etapa `enriquecer` com teste no `passo.test.ts` (paginação por `claim_id`; linha com falha de leitura continua `null` e é retentada na próxima rodada sem travar as demais).
- [ ] **Step 2:** `pnpm lint:functions && pnpm check:functions`; `pnpm vitest run supabase/functions` verde. Commit.

### Task 4: Edge `posvenda-detalhe`

**Files:** Create `supabase/functions/posvenda-detalhe/index.ts` (`verify_jwt = true` no `config.toml`), `_shared/faturamento/posvenda.ts` + `__tests__/posvenda.test.ts`, `src/lib/edge.ts` (move `postEdge` de `src/lib/mensagens.ts`), `src/lib/posvenda.ts`

**Interfaces:**
- Body `{ claim_id }`; claim ∈ org (via `ml_devolucoes.org_id`) antes do ML.
- `DetalheReclamacao`:
  ```ts
  { claim_id: number; return_id: number|null; stage: string|null; status: string|null;
    estado: { titulo, descricao, problema, prazo, vez_de };
    comprador_quer: string|null;
    resolucoes: Array<{ papel: string; tipo: string; status: string; detalhes: Array<{ chave: string; valor: string }>; criada_em: string; atualizada_em: string }>;  // expected-resolutions completo (percentual da oferta parcial fica em detalhes)
    resolucao_final: { motivo: string|null; data: string|null } | null;   // claim.resolution
    afeta_reputacao: string|null; custo_devolucao: number|null;
    historico: Array<{ data: string; autor: 'comprador'|'vendedor'|'ml'; destinatario: string|null; texto: string; anexos: string[]; status: string|null; moderacao: string|null }>;  // status/moderação = message_moderation.status
    acoes: string[];                                  // da conta, relidas agora
    revisoes: Array<{ order_id: number; seller_status: string|null }>;
    pedidos_devolucao: number[];                      // carrinho = length > 1
    motivos_falha_revisao: Array<{ id: string; texto: string; exige_foto: boolean; aplica: Array<'order'|'pack'|string> }>;  // preserva `apply`
    reembolso_parcial: { ofertas: Array<{ percentual: number; valor: number }>; minimo: number|null } | null;  // só com 'allow_partial_refund'
  }
  ```
- Puros testados: `montarHistorico`, `normalizarRevisoes` (Task 2), `motivosRevisao` (`exige_foto` = SRF2|SRF4; `aplica` = `apply`), `autorDoPapel(role, papelDaConta)`, `ofertasReembolso` (exclui 100%; `minimo` de `restrictions[type=minimum]`).

- [ ] **Step 1:** testes com dois fixtures de motivos — o **real** de 28/10 (não carrinho: os 6 SRF com `apply:['order']`) e o **da doc** para carrinho (SRF7 `['package']`, SRF5 `['order','package']`); mediator → ml; ofertas `[{90,855},{100,950}]` → só 90 → FAIL → implementar → PASS.
- [ ] **Step 2:** edge + `buscarDetalheReclamacao`; testes de mensagens seguem verdes com `postEdge` movido. Commit.

### Task 5: Edge `posvenda-acao` — máquina de estados

**Files:** Create `supabase/functions/posvenda-acao/index.ts` (`verify_jwt = true`); Modify `_shared/faturamento/posvenda.ts` (+ testes), `src/lib/posvenda.ts`

**Interfaces:**
- `AcaoPosvenda = 'revisar_ok' | 'revisar_falha' | 'responder' | 'reembolsar' | 'reembolso_parcial' | 'autorizar_devolucao' | 'abrir_disputa'`
- Body: `{ operacao_id: string /* uuid, gerado ao abrir o diálogo */; claim_id: string; acao?: AcaoPosvenda; texto?: string; percentual?: number; revisoes?: Array<{ order_id?: number; motivo_id: string; texto: string; anexos: string[] }>; anexos?: string[]; verificar?: boolean }`
- Puros testados:
  - `ACAO_ML`: `revisar_ok:['return_review_ok']`, `revisar_falha:['return_review_fail']`, `responder:['send_message_to_complainant','send_message_to_mediator']`, `reembolsar:['refund']`, `reembolso_parcial:['allow_partial_refund']`, `autorizar_devolucao:['allow_return','allow_return_label']`, `abrir_disputa:['open_dispute']`.
  - `destinatarioResposta(acoes, stage)`: `dispute` ou só `send_message_to_mediator` → `mediator`; senão `complainant`.
  - `chaveRecurso(acao, claimId, returnId)`: `revisar_*` → `return:{returnId}`; resoluções → `claim:{claimId}:resolucao`; `responder` → `claim:{claimId}:msg`.
  - `validarAcao(acao, body, d: DetalheReclamacao)`: ação ∈ `ACAO_ML[acao]` ∩ `d.acoes`; `revisar_falha`: cada item com `motivo_id` ∈ motivos e escopo ok (revisão **por pedido**: `order_id` ∈ `d.pedidos_devolucao` e motivo com `aplica` ⊇ `order`; revisão **do pacote**: sem `order_id` e motivo com `aplica` ⊇ `package` — no não-carrinho, `aplica:['order']` vale sem `order_id`), `texto` obrigatório, anexo obrigatório se `exige_foto`; `responder`: 1..2000 caracteres; `reembolso_parcial`: `percentual` ∈ ofertas.
  - `montarRequisicao(acao, claimId, returnId, body, receiverRole)` → `{ path, corpo }`: revisão OK `{}`; revisão com falha `revisoes.map(r => ({ reason: r.motivo_id, message: r.texto, attachments: r.anexos, ...(r.order_id ? { order_id: r.order_id } : {}) }))` em `/returns/{returnId}/return-review`; `send-message` `{ receiver_role, message, attachments }`; `refund`/`allow-return`/`open-dispute` `{}`; `partial-refund` `{ percentage }`.
  - `efeitoConfirmado(acao, antes, depois, tentativa: { payload; post_em: string; http_status: number|null }): 'confirmado'|'nao'|'inconclusivo'` — **evidência positiva específica**:
    - `responder`: entrada nova do vendedor com o mesmo texto, mesmo destinatário, mesmos anexos e `data >= post_em`: `moderacao` `clean` → `confirmado`; moderação pendente → `inconclusivo` (mantém trava/"em moderação"); rejeitada → `nao` com a mensagem "O ML bloqueou a mensagem na moderação";
    - `revisar_ok`: pedidos `pending` em `antes` e `success` em `depois` → `confirmado` **só com `http_status` 2xx**; sem 2xx (timeout) → `inconclusivo` (`success` também é "não revisou a tempo");
    - `revisar_falha`: `pending` → `claimed` ou `failed` nos pedidos revisados → `confirmado` (só o vendedor produz `claimed`); sem 2xx e `success` → `inconclusivo`;
    - `reembolsar`: em `depois.resolucoes`, resolução do papel **do vendedor/conta** (`respondent`) com `tipo='refund'`, `status` aceito/aplicado e `criada_em >= post_em`, ausente em `antes`; **ou** `status='closed'` com `resolucao_final.motivo` de reembolso e `data >= post_em`. Resolução `refund` do **comprador** (`complainant`, `pending`) é desejo dele → `nao`;
    - `reembolso_parcial`: resolução parcial nova cujo percentual em `detalhes` = o pedido (outro percentual → `nao`);
    - `autorizar_devolucao`: `return_id` passou a existir;
    - `abrir_disputa`: `stage` `claim` → `dispute`.
- **Estados e transições** (todas por `update ... where estado = <esperado>` — atualização condicional; 0 linhas = outra execução ganhou):
  1. Já existe linha com o `operacao_id` → **não executa nada**: se `estado` ∈ {`enviada`,`desconhecido`,`reservada`} e `verificar`, faz só o passo 6; senão devolve a linha como está. `payload_hash` diferente para o mesmo `operacao_id` → 409.
  2. Insert `reservada` (conflito no índice parcial → 409 "Outra ação está em andamento ou aguardando confirmação neste item"; mostra a ação pendente).
  3. Releitura (`posvenda-detalhe` interno) → grava `antes`. Leitura falhou ou `validarAcao` recusou → `cancelada` (libera; nenhum POST aconteceu) + erro.
  4. `update set post_em = now() where id = $id and estado = 'reservada' and post_em is null returning id` — **sem linha retornada, não faz o fetch** (a reserva foi cancelada). Só então fetch com timeout 20 s.
  5. 2xx → `enviada`; 4xx → `recusada` (libera; mensagem do ML; 403 = reconectar); timeout/5xx/rede → `desconhecido`.
  6. Releitura → `efeitoConfirmado`: `confirmado` → `update set estado='confirmada', sync_pendente=true` (mesma escrita); senão mantém. Grava `http_status`/`resposta_ml` no passo 5.
  7. Se `sync_pendente`: re-sync estrito com o **dono** (`upsertDevolucao` com extras) + enfileira `sync-devolucao` com `org_id`/`connection_id`; só após os dois darem certo, `sync_pendente=false`. Repetição do mesmo `operacao_id` (passo 1) com `sync_pendente=true` refaz **só** este passo, nunca o POST.
  Responde `{ ok, estado, pendenteConfirmacao, sincronizacaoPendente: sync_pendente, devolucao }`.
- **Recuperação durável (sem reenviar):** o `reconciliar-faturamento` horário ganha o passo `posvendaPendentes` para a org: (a) `update set estado='cancelada' where id=$id and estado='reservada' and post_em is null and criado_em < now() - interval '2 minutes'` (atômico; perde para o passo 4 se ele marcou antes); (b) `reservada` com `post_em`, `enviada` e `desconhecido` → releitura + `efeitoConfirmado`: `confirmado` → `confirmada` + `sync_pendente`; `inconclusivo` ou `nao` → vira `inconclusiva` (libera) **somente se o ML não aceita mais a ação** (fora de `available_actions` e, para revisão, nenhum pedido `pending`); senão mantém o estado atual e a trava; (c) `sync_pendente=true` → refaz o passo 7. **`claim.status='closed'` sozinho nunca libera.** UI de `inconclusiva`: "O ML não confirmou se foi a sua ação; confira no Mercado Livre."

- [ ] **Step 1: testes puros** — `validarAcao` (ação não liberada; SRF5 sem foto ok; SRF2 sem foto recusa; carrinho com `order_id` fora da devolução recusa), `montarRequisicao` (7 ações + carrinho com 2 pedidos), `destinatarioResposta` (claim → complainant; dispute → mediator), `chaveRecurso` (`revisar_ok`/`revisar_falha` do mesmo return → mesma chave), `efeitoConfirmado` (resposta publicada com a ação ainda liberada → `confirmado`; `pending → success` com 2xx → `confirmado`; `pending → success` após timeout → `inconclusivo` (Review Focus 3); oferta parcial observada com percentual diferente → `nao`; mudança externa de stage → `nao` para `reembolsar`; `refund` pendente do comprador criado após o POST → `nao`).
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3: teste do fluxo** — a edge chama `executarAcao(deps, body)` (orquestrador em `_shared/faturamento/posvenda-fluxo.ts`, deps injetadas: banco e fetch). Teste vitest com banco em memória que impõe as mesmas unicidades/condicionais e fetch controlado: duas execuções simultâneas → **1 POST**; timeout após o POST e duas "Conferir" → 0 POSTs novos; interrupção após `confirmada` → repetir refaz só o sync; claim `closed` com revisão `pending` após timeout → continua travado; `inconclusivo` com a ação ainda liberada → continua travado; intercalação **reconciliador seleciona reserva antiga → passo 4 marca `post_em` → reconciliador tenta cancelar** → cancelamento não acontece e há 1 POST.
- [ ] **Step 4: teste SQL** (`scripts/teste-sql-desfeito.py`, uma transação): mesmo `(org_id, recurso)` ativo → 23505; mesmo `operacao_id` → 23505; após `estado='recusada'` novo insert passa. (Concorrência real fica coberta pelo teste do fluxo + índice único.)
- [ ] **Step 5:** edge + passo `posvendaPendentes` no reconciliar + `executarAcaoPosvenda`/`verificarAcaoPosvenda` no front; `pnpm check:functions`; Commit.

### Task 6: Edge `posvenda-anexo`

**Files:** Create `supabase/functions/posvenda-anexo/index.ts` (`verify_jwt = true`); Modify `_shared/faturamento/posvenda.ts` (+ testes), `src/lib/posvenda.ts`

**Interfaces:**
- `multipart/form-data`: `claim_id`, `destino: 'revisao'|'mensagem'`, `file`. `revisao` → `POST /claims/{id}/returns/attachments` (responde `file_name`); `mensagem` → `POST /claims/{id}/attachments` (responde `filename`).
- Puros: `validarArquivoAnexo(tipo, bytes, destino): string|null`; `nomeDoAnexo(resp: unknown, destino): string|null` (lê o campo certo; sem nome → erro "O ML não devolveu o identificador do anexo").
- `enviarAnexoPosvenda(claimId, destino, file): Promise<string>`.

- [ ] **Step 1:** testes (HEIC → erro; 6 MB → erro; PDF em revisão → erro; `{file_name:'a.png'}` revisão → `'a.png'`; `{filename:'b.jpg'}` mensagem → `'b.jpg'`; `{}` → null) → FAIL → implementar → PASS.
- [ ] **Step 2:** edge + helper; Commit.

### Task 7: Mensagens — cards do ML e leitura sincronizada

**Files:** Create `supabase/functions/marcar-mensagens-lidas-ml/index.ts` (`verify_jwt = true`); Modify `_shared/faturamento/mensagens-io.ts`, `src/lib/mensagens.ts`, `src/components/faturamento/aba-mensagens.tsx`; Create `src/lib/mensagens-resumo.ts` + teste

**Interfaces:**
- `ml_mensagens.lida` **segue significando dispensada/tratada localmente**; leitura no ML = `lida_ml_em` (Task 1). Todo escritor de mensagens (`upsertMensagens*`, sync, backfill, reconciliar) depois do upsert faz `update set lida_ml_em = coalesce(lida_ml_em, <message_date.read>)` para as que vieram com `read` preenchido — nunca grava null.
- `buscarMensagensPack(token, pack, seller, marcarLida = false)`.
- Edge `{ pack_id }`: GET `mark_as_read=true`, upsert estrito com o dono; não toca em `lida`.
- `Conversa` + `shipping_status` (de `ml_vendas`, org) e `idsNaoLidosML: string[]` (recebidas com `lida_ml_em` nulo).
- `resumirConversas(conversas)` → `{ naoLidas: { aPreparar, aCaminho, entregues, total }, lidas: { semResponder, respondidas } }` (a preparar `pending|handling|ready_to_ship`; a caminho `shipped`; entregues `delivered`).
- UI: card recolhido igual ao ML ("Venda para preparar · Mensagem recebida há 13 horas · [Conferir mensagem]"); expandir chama a edge **quando `idsNaoLidosML` não é vazio e difere do último conjunto marcado nesta sessão**.

- Migration da Task 1 também faz o preenchimento inicial: `update ml_mensagens set lida_ml_em = (raw->'message_date'->>'read')::timestamptz where lida_ml_em is null and raw->'message_date'->>'read' is not null`.
- Contadores no banco, não no array limitado: RPC `resumo_mensagens_posvenda()` (org da sessão) agrega **por pack sobre todas as mensagens** e devolve os 5 números; `buscarConversas()` segue limitada só para a lista. `resumirConversas` fica como função pura usada pelos testes e pelo filtro local.
- [ ] **Step 1:** teste SQL (`scripts/teste-sql-desfeito.py`): RPC conta um pack pendente cujas mensagens estão fora das 1.000 mais recentes; `lida_ml_em` preenchido + upsert de snapshot antigo com `read=null` + o `coalesce` → continua preenchido. Testes: `resumirConversas` (um por balde); componente: abrir → marca 1×; reabrir sem novidade → não chama; chega mensagem nova (novo id) e reabre → chama de novo; abrir não tira de "Sem responder"; Dispensar tira.
- [ ] **Step 2:** FAIL → implementar → PASS. Commit.

### Task 8: Aba Pós-venda

**Files:** Create `src/components/faturamento/posvenda/{aba-posvenda,lista-reclamacoes,lista-devolucoes,detalhe-reclamacao,dialogo-revisar-devolucao,dialogo-confirmar-acao}.tsx`, `src/lib/posvenda-fila.ts` + teste, `src/components/faturamento/__tests__/posvenda.test.tsx`; Modify `src/pages/Faturamento.tsx` (Devoluções + Mensagens → **Pós-venda**; badge = urgentes + não lidas), `src/lib/devolucoes.ts`

**Interfaces:**
- `classificar(d, agora)`: `revisao_pendente` → urgente (mesmo `closed`); `opened` e (`vez_de='vendedor'` ou ação `mandatory` da conta) → urgente; `opened` restante → andamento; resto → concluída. `ordenarFila(ds, agora)`: vencidas, `prazo` asc, sem prazo no fim; `agora` injetado.
- Dados: `buscarFilaPosvenda()` em `src/lib/posvenda.ts` lê **só** `ml_devolucoes where status='opened' or revisao_pendente` (conjunto pequeno, paginado com `.range()` até esgotar) — a fila nunca depende do histórico, que segue em `buscarDevolucoes`.
- Sub-abas: Reclamações = `mediations`, `cancel_purchase`, `returns` sem `return_id`; Devoluções = `returns` com `return_id` + "Histórico" (= `AbaDevolucoes` atual intacta); Mensagens = Task 7.
- Itens com tentativa ativa em `ml_posvenda_acoes` mostram "Ação enviada ao ML · aguardando confirmação" e travam os botões daquele recurso.
- `dialogo-revisar-devolucao`: mockup aprovado; motivo + **mensagem obrigatória** + fotos (obrigatórias só com `exige_foto`); carrinho (`pedidos_devolucao.length > 1`): revisar o pacote inteiro ou pedido a pedido, cada um com motivo próprio (motivos filtrados por `aplica`).
- `dialogo-confirmar-acao`: gera `operacao_id` ao abrir; texto do efeito no ML + "não dá para desfazer"; estados `enviada` ("Enviado; confirmando…", releitura em 10 s via `verificar`), `desconhecido` ("Não sabemos se o ML recebeu. Não vamos reenviar; estamos conferindo." + "Conferir agora" = `verificar`), `recusada` (mensagem do ML), `inconclusiva` ("confira no Mercado Livre" + link).

- [ ] **Step 1:** testes de `classificar`/`ordenarFila` (closed + pendente → urgente) → FAIL → implementar → PASS.
- [ ] **Step 2:** componentes + testes: SRF2 sem foto → enviar desabilitado; SRF5 sem foto com mensagem → habilitado; duplo clique → 1 chamada com o mesmo `operacao_id`; repetir após erro de rede → mesmo `operacao_id`; `desconhecido` não oferece "enviar de novo"; item com tentativa ativa → botões travados.
- [ ] **Step 3:** `pnpm preflight:static` exit 0; Commit.

### Task 9: Revisão, deploy na ordem certa, enriquecimento, validação, merge

- [ ] **Step 1:** revisão do diff da branch pelo Codex (gpt-6.1-sol, high, read-only); corrigir (rodada única); CI verde.
- [ ] **Step 2 — backend antes do front:** migration aplicada (conferir); grep das funções que importam `_shared/faturamento/{devolucao,devolucoes-io,mensagens-io,posvenda,reconciliar-filtros}.ts` e deploy de **todas** (inclui `ml-webhook`) + as 4 novas; `functions list` com versão e `verify_jwt` = `config.toml`.
- [ ] **Step 3 — enriquecimento:** deixar a etapa `enriquecer` do `reconciliar-faturamento` rodar (ou disparar a rodada manualmente) até `select count(*) from ml_devolucoes where enriquecido_em is null and org_id in (orgs com ML)` chegar a 0 (ou só restarem falhas registradas); conferir 5600661190 (`vez_de='comprador'`, `detalhe->>'title'='Devolução em preparação'`) e listar as `revisao_pendente = true`.
- [ ] **Step 4:** só então merge fast-forward na `main` (Render publica o front); conferir o bundle novo servido.
- [ ] **Step 5:** validação visual com dados reais (Playwright; claro/escuro/390px).
- [ ] **Step 6:** com o Diego, primeira ação real pela UI (responder numa reclamação aberta); conferir `estado='confirmada'` e o ML.
- [ ] **Step 7:** docs (`edge-functions.md`, `project-status.md`, `TASKS.md`, vault); `git pull --ff-only` no checkout principal; remover worktree/branch.
