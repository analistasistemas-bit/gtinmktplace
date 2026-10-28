# Pós-venda do ML no PubliAI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolver reclamações, devoluções e mensagens do Mercado Livre pelo PubliAI (aba Pós-venda com 3 sub-abas igual ao ML), incluindo revisar devolução com fotos e agir nas reclamações.

**Architecture:** O sync grava em `ml_devolucoes` o que a lista precisa (texto do ML, prazo, vez, revisão pendente, rastreio, reputação), preservando o último valor bom quando uma leitura falha; um enriquecimento único cobre as linhas antigas. O detalhe é lido ao vivo (`posvenda-detalhe`). Toda escrita passa por `posvenda-acao`, com **duas travas**: idempotência por operação (`operacao_id` gerado pelo cliente) e exclusão por recurso de negócio (índice parcial). **Regra de ouro: o PubliAI nunca reenvia uma ação de resultado incerto** — ela fica travada até a releitura do ML provar o efeito específico (confirmada) ou provar que a janela fechou sem efeito (expirada).

**Tech Stack:** React 19 + Tailwind v4 + TanStack Query + vitest; Supabase Edge Functions (Deno) + Postgres (migrations via CLI, ADR-0043); API post-purchase do ML.

**Spec:** `docs/superpowers/specs/2026-10-28-posvenda-ml-design.md`
**Revisões do plano:** Codex gpt-6.1-sol high — rodada 1 (12 achados) e rodada 2 (11 achados) incorporadas.

## Global Constraints

- Nenhuma escrita no ML sem clique + confirmação; a UI mostra o estado **relido do ML**, nunca otimista.
- Qualquer membro autenticado da org executa as ações (`requireUserOrg(req, { access: 'write' })`), decisão do Diego.
- **Dono × executor:** escrita em `ml_devolucoes`/`ml_mensagens` usa `user_id` = dono da conexão (`marketplace_connections.criado_por`); quem clicou vai em `ml_posvenda_acoes.user_id`.
- **Player da conta:** ações e papel saem do player cujo `user_id` = `conexao.contaExternaId` (claims de `shipment` usam `sender`/`receiver`; não presumir `type='seller'`).
- Nenhum reenvio automático de POST; nenhum POST quando a última tentativa do mesmo recurso está `reservada|enviada|desconhecido`.
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
- `ml_devolucoes` + `return_id bigint`, `detalhe jsonb` (`{title, description, problem, due_date, action_responsible}`), `prazo timestamptz`, `vez_de text check (vez_de in ('vendedor','comprador','ml'))`, `revisao_pendente boolean not null default false`, `revisao_status text` (último `seller_status` lido), `afeta_reputacao text`, `rastreio text`, `pedidos_devolucao jsonb` (order_ids da devolução, para carrinho), `enriquecido_em timestamptz` (null = falta enriquecer).
- `ml_posvenda_acoes`: `id uuid pk`, `org_id uuid not null`, `user_id uuid not null`, `operacao_id uuid not null`, `claim_id bigint not null`, `return_id bigint`, `recurso text not null`, `acao text not null`, `payload jsonb not null`, `payload_hash text not null`, `antes jsonb` (snapshot relido antes do POST), `estado text not null check (estado in ('reservada','enviada','confirmada','recusada','desconhecido','expirada','cancelada'))`, `post_em timestamptz` (gravado **antes** do fetch), `resposta_ml jsonb`, `erro text`, `criado_em`, `atualizado_em`.
- Índices: `unique (org_id, operacao_id)`; **parcial único** `(org_id, recurso) where estado in ('reservada','enviada','desconhecido')`.
- RLS `select` membro da org; sem insert/update para `authenticated`.

- [ ] **Step 1:** `git fetch`; confirmar 0192 livre (senão o próximo).
- [ ] **Step 2:** ADR: decisão (colunas, máquina de estados abaixo, regra de nunca reenviar, enriquecimento, detalhe ao vivo, fotos sem storage, fora da v1), permissão, dono × executor, custo (≈3 GETs a mais por claim processado).
- [ ] **Step 3:** DDL idempotente; `npm run db:check`; `supabase db push`; conferir colunas e índices em `pg_indexes`.
- [ ] **Step 4:** Commit.

### Task 2: Mapeamento puro

**Files:** Modify `supabase/functions/_shared/faturamento/devolucao.ts`, `reconciliar-filtros.ts`; Test `__tests__/devolucao.test.ts`, `__tests__/reconciliar-filtros.test.ts`

**Interfaces — produces:**
- `DetalheClaimML`, `ReturnML` + `id`, `tracking`, `pedidos: number[]` (de `orders[].order_id`); `RevisaoML { resource_id?: number; seller_status?: string|null }`.
- `export type Leitura<T> = { ok: true; valor: T } | { ok: false }` — distingue "lido e vazio" de "falhou".
- `ExtrasClaim { detalhe: Leitura<DetalheClaimML|null>; reputacao: Leitura<string|null>; revisoes: Leitura<RevisaoML[]> }`
- `export function playerDaConta(claim: ClaimML, contaExternaId: string): ClaimML['players'][number] | null`
- `export function acoesDaConta(claim, contaExternaId): AcaoPendente[]` (substitui o agrupamento de todos os players em `acoes_pendentes`).
- `export function vezDe(responsavel, papelDaConta: string|null): 'vendedor'|'comprador'|'ml'|null` — igual ao papel da conta → vendedor; `mediator|internal` → ml; outro → comprador.
- `export function revisaoPendente(acoes: AcaoPendente[], revisoes: RevisaoML[]): boolean` — `return_review_ok|return_review_fail` nas ações **ou** algum `seller_status === 'pending'`. (`null`, `''`, `success`, `failed`, `claimed` → não pendente.)
- `export function colunasLidas(claim, ret: Leitura<ReturnML|null>, extras: ExtrasClaim, contaExternaId): Partial<DevolucaoRow>` — devolve **só** as colunas cujas leituras deram `ok`; `enriquecido_em` só quando as três leituras de `extras` e o return deram `ok`.
- `claimPrecisaProcessar`: `true` também se `local.revisao_pendente` ou `local.enriquecido_em == null`.

- [ ] **Step 1: testes que falham:**
  - 5600661190 real (`action_responsible='complainant'`, conta = respondent) → `vez_de 'comprador'`, `prazo '2026-11-03T22:08:00.000-04:00'`, 3 ações da conta.
  - claim de shipment em que a conta é `receiver` → ações do player `receiver`.
  - `revisoes [{seller_status:'pending'}]`, claim `closed`, sem ações → `revisao_pendente true`; `null`/`''`/`success` → `false`.
  - `colunasLidas` com `reputacao: { ok:false }` → objeto **sem** `afeta_reputacao` e **sem** `enriquecido_em` (Review Focus 5).
  - `claimPrecisaProcessar` para linha legada `closed` há 60 dias com `enriquecido_em: null` → `true` (Review Focus 4).
- [ ] **Step 2:** FAIL → implementar → PASS (demais testes do diretório inalterados). Commit.

### Task 3: Sync e enriquecimento

**Files:** Modify `_shared/faturamento/devolucoes-io.ts`, `sync-devolucao/index.ts`, `reconciliar-faturamento/index.ts` (chamadas em ~143 `legado()` e ~353 `processarClaims`), `backfill-faturamento/index.ts` (~165)

**Interfaces:**
- `buscarReturnLeitura(token, claimId): Promise<Leitura<ReturnML|null>>` — 404 → `{ok:true, valor:null}`; outro erro → `{ok:false}`; `buscarReturn` antigo continua para quem não precisa.
- `buscarExtrasClaim(token, claimId, returnId): Promise<ExtrasClaim>` — `/detail`, `/affects-reputation`, `v1/returns/{returnId}/reviews` (sem return → `revisoes {ok:true, valor:[]}`).
- `upsertDevolucao(admin, userId, orgId, claim, ret, contaExternaId, extras?)` — grava `mapearDevolucao` (colunas de sempre) **+** `colunasLidas` (só as lidas); **lança** em erro do Supabase; devolve a linha lida do banco. Sem `extras` (chamada antiga), não toca nas colunas novas.
- `carregarDevolucoesLocais` seleciona `revisao_pendente, enriquecido_em`.

- [ ] **Step 1:** implementar e passar `extras` nos 4 callers.
- [ ] **Step 2:** `pnpm lint:functions && pnpm check:functions`; `pnpm vitest run supabase/functions` verde. Commit.

### Task 4: Edge `posvenda-detalhe`

**Files:** Create `supabase/functions/posvenda-detalhe/index.ts` (`verify_jwt = true` no `config.toml`), `_shared/faturamento/posvenda.ts` + `__tests__/posvenda.test.ts`, `src/lib/edge.ts` (move `postEdge` de `src/lib/mensagens.ts`), `src/lib/posvenda.ts`

**Interfaces:**
- Body `{ claim_id }`; claim ∈ org (via `ml_devolucoes.org_id`) antes do ML.
- `DetalheReclamacao`:
  ```ts
  { claim_id: number; return_id: number|null; stage: string|null; status: string|null;
    estado: { titulo, descricao, problema, prazo, vez_de };
    comprador_quer: string|null; resolucoes: Array<{ papel: string; tipo: string; status: string }>;  // expected-resolutions cru resumido
    afeta_reputacao: string|null; custo_devolucao: number|null;
    historico: Array<{ data: string; autor: 'comprador'|'vendedor'|'ml'; texto: string; anexos: string[] }>;
    acoes: string[];                                  // da conta, relidas agora
    revisoes: Array<{ order_id: number; seller_status: string|null }>;
    pedidos_devolucao: number[];                      // carrinho = length > 1
    motivos_falha_revisao: Array<{ id: string; texto: string; exige_foto: boolean; aplica: Array<'order'|'pack'|string> }>;  // preserva `apply`
    reembolso_parcial: { ofertas: Array<{ percentual: number; valor: number }>; minimo: number|null } | null;  // só com 'allow_partial_refund'
  }
  ```
- Puros testados: `montarHistorico`, `motivosRevisao` (`exige_foto` = SRF2|SRF4; `aplica` = `apply`), `autorDoPapel(role, papelDaConta)`, `ofertasReembolso` (exclui 100%; `minimo` de `restrictions[type=minimum]`).

- [ ] **Step 1:** testes com formatos reais (mediator → ml; os 6 SRF com `apply:['order']`; ofertas `[{90,855},{100,950}]` → só 90) → FAIL → implementar → PASS.
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
  - `validarAcao(acao, body, d: DetalheReclamacao)`: ação ∈ `ACAO_ML[acao]` ∩ `d.acoes`; `revisar_falha`: cada item com `motivo_id` ∈ motivos e escopo ok (`order_id` ∈ `d.pedidos_devolucao` quando motivo `aplica` inclui `order` e é carrinho; sem `order_id` para revisão do pacote), `texto` obrigatório, anexo obrigatório se `exige_foto`; `responder`: 1..2000 caracteres; `reembolso_parcial`: `percentual` ∈ ofertas.
  - `montarRequisicao(acao, claimId, returnId, body, receiverRole)` → `{ path, corpo }`: revisão OK `{}`; revisão com falha `revisoes.map(r => ({ reason: r.motivo_id, message: r.texto, attachments: r.anexos, ...(r.order_id ? { order_id: r.order_id } : {}) }))` em `/returns/{returnId}/return-review`; `send-message` `{ receiver_role, message, attachments }`; `refund`/`allow-return`/`open-dispute` `{}`; `partial-refund` `{ percentage }`.
  - `efeitoConfirmado(acao, antes: DetalheReclamacao, depois: DetalheReclamacao, tentativa: { payload; post_em: string }): boolean` — **evidência positiva específica**:
    - `responder`: `depois.historico` tem entrada do vendedor com o mesmo texto e `data >= post_em`, ausente em `antes`;
    - `revisar_ok`: o(s) pedido(s) estava(m) `pending` em `antes` e está(ão) `success` em `depois`;
    - `revisar_falha`: `pending` → `claimed` ou `failed` nos pedidos revisados;
    - `reembolsar`: `depois.resolucoes` tem resolução de reembolso aceita/aplicada que não existia em `antes`, ou `status` `closed` com `resolution.reason` de reembolso;
    - `reembolso_parcial`: resolução parcial com o mesmo percentual que não existia em `antes`;
    - `autorizar_devolucao`: `return_id` passou a existir;
    - `abrir_disputa`: `stage` `claim` → `dispute`.
- **Estados e transições** (todas por `update ... where estado = <esperado>` — atualização condicional; 0 linhas = outra execução ganhou):
  1. Já existe linha com o `operacao_id` → **não executa nada**: se `estado` ∈ {`enviada`,`desconhecido`,`reservada`} e `verificar`, faz só o passo 6; senão devolve a linha como está. `payload_hash` diferente para o mesmo `operacao_id` → 409.
  2. Insert `reservada` (conflito no índice parcial → 409 "Outra ação está em andamento ou aguardando confirmação neste item"; mostra a ação pendente).
  3. Releitura (`posvenda-detalhe` interno) → grava `antes`. Leitura falhou ou `validarAcao` recusou → `cancelada` (libera; nenhum POST aconteceu) + erro.
  4. `update set post_em = now()` (marca o ponto sem volta) → fetch com timeout 20 s.
  5. 2xx → `enviada`; 4xx → `recusada` (libera; mensagem do ML; 403 = reconectar); timeout/5xx/rede → `desconhecido`.
  6. Releitura → `efeitoConfirmado` → `confirmada`; senão mantém. Responde `{ ok, estado, pendenteConfirmacao, sincronizacaoPendente, devolucao }`.
  7. Re-sync estrito com o **dono** (`upsertDevolucao` com extras) + enfileira `sync-devolucao` (financeiro). Falha aqui só liga `sincronizacaoPendente`.
- **Recuperação durável (sem reenviar):** o `reconciliar-faturamento` horário ganha o passo `posvendaPendentes`: para cada `reservada|enviada|desconhecido` da org — `reservada` sem `post_em` há > 2 min → `cancelada`; demais → releitura + `efeitoConfirmado` → `confirmada`; se a ação deixou de estar liberada **e** não há efeito após 24 h de `post_em`, ou o claim fechou sem efeito → `expirada` (libera; UI avisa "o ML não registrou a ação; confira e tente de novo").

- [ ] **Step 1: testes puros** — `validarAcao` (ação não liberada; SRF5 sem foto ok; SRF2 sem foto recusa; carrinho com `order_id` fora da devolução recusa), `montarRequisicao` (7 ações + carrinho com 2 pedidos), `destinatarioResposta` (claim → complainant; dispute → mediator), `chaveRecurso` (`revisar_ok`/`revisar_falha` do mesmo return → mesma chave), `efeitoConfirmado` (resposta publicada com a ação ainda liberada → true; `success` sem `pending` antes → false (Review Focus 3); mudança externa de stage sem disputa pedida → false para `reembolsar`).
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3: teste SQL** (`scripts/teste-sql-desfeito.py`): dois inserts mesmo `(org_id, recurso)` ativos → 23505; mesmo `operacao_id` → 23505; `update ... where estado='desconhecido'` concorrente → só um retorna linha (Review Focus 1, 2).
- [ ] **Step 4:** edge + passo `posvendaPendentes` no reconciliar + `executarAcaoPosvenda`/`verificarAcaoPosvenda` no front; `pnpm check:functions`; Commit.

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
- `ml_mensagens.lida` **segue significando dispensada/tratada localmente**; leitura no ML = `raw->'message_date'->>'read'`.
- `buscarMensagensPack(token, pack, seller, marcarLida = false)`.
- Edge `{ pack_id }`: GET `mark_as_read=true`, upsert estrito com o dono; não toca em `lida`.
- `Conversa` + `shipping_status` (de `ml_vendas`, org) e `idsNaoLidosML: string[]` (recebidas com `read` nulo).
- `resumirConversas(conversas)` → `{ naoLidas: { aPreparar, aCaminho, entregues, total }, lidas: { semResponder, respondidas } }` (a preparar `pending|handling|ready_to_ship`; a caminho `shipped`; entregues `delivered`).
- UI: card recolhido igual ao ML ("Venda para preparar · Mensagem recebida há 13 horas · [Conferir mensagem]"); expandir chama a edge **quando `idsNaoLidosML` não é vazio e difere do último conjunto marcado nesta sessão**.

- [ ] **Step 1:** testes: `resumirConversas` (um por balde); componente: abrir → marca 1×; reabrir sem novidade → não chama; chega mensagem nova (novo id) e reabre → chama de novo; abrir não tira de "Sem responder"; Dispensar tira.
- [ ] **Step 2:** FAIL → implementar → PASS. Commit.

### Task 8: Aba Pós-venda

**Files:** Create `src/components/faturamento/posvenda/{aba-posvenda,lista-reclamacoes,lista-devolucoes,detalhe-reclamacao,dialogo-revisar-devolucao,dialogo-confirmar-acao}.tsx`, `src/lib/posvenda-fila.ts` + teste, `src/components/faturamento/__tests__/posvenda.test.tsx`; Modify `src/pages/Faturamento.tsx` (Devoluções + Mensagens → **Pós-venda**; badge = urgentes + não lidas), `src/lib/devolucoes.ts`

**Interfaces:**
- `classificar(d, agora)`: `revisao_pendente` → urgente (mesmo `closed`); `opened` e (`vez_de='vendedor'` ou ação `mandatory` da conta) → urgente; `opened` restante → andamento; resto → concluída. `ordenarFila(ds, agora)`: vencidas, `prazo` asc, sem prazo no fim; `agora` injetado.
- Sub-abas: Reclamações = `mediations`, `cancel_purchase`, `returns` sem `return_id`; Devoluções = `returns` com `return_id` + "Histórico" (= `AbaDevolucoes` atual intacta); Mensagens = Task 7.
- Itens com tentativa ativa em `ml_posvenda_acoes` mostram "Ação enviada ao ML · aguardando confirmação" e travam os botões daquele recurso.
- `dialogo-revisar-devolucao`: mockup aprovado; motivo + **mensagem obrigatória** + fotos (obrigatórias só com `exige_foto`); carrinho (`pedidos_devolucao.length > 1`): revisar o pacote inteiro ou pedido a pedido, cada um com motivo próprio (motivos filtrados por `aplica`).
- `dialogo-confirmar-acao`: gera `operacao_id` ao abrir; texto do efeito no ML + "não dá para desfazer"; estados `enviada` ("Enviado; confirmando…", releitura em 10 s via `verificar`), `desconhecido` ("Não sabemos se o ML recebeu. Não vamos reenviar; estamos conferindo." + "Conferir agora" = `verificar`), `recusada` (mensagem do ML), `expirada`.

- [ ] **Step 1:** testes de `classificar`/`ordenarFila` (closed + pendente → urgente) → FAIL → implementar → PASS.
- [ ] **Step 2:** componentes + testes: SRF2 sem foto → enviar desabilitado; SRF5 sem foto com mensagem → habilitado; duplo clique → 1 chamada com o mesmo `operacao_id`; repetir após erro de rede → mesmo `operacao_id`; `desconhecido` não oferece "enviar de novo"; item com tentativa ativa → botões travados.
- [ ] **Step 3:** `pnpm preflight:static` exit 0; Commit.

### Task 9: Revisão, deploy na ordem certa, enriquecimento, validação, merge

- [ ] **Step 1:** revisão do diff da branch pelo Codex (gpt-6.1-sol, high, read-only); corrigir (rodada única); CI verde.
- [ ] **Step 2 — backend antes do front:** migration aplicada (conferir); grep das funções que importam `_shared/faturamento/{devolucao,devolucoes-io,mensagens-io,posvenda,reconciliar-filtros}.ts` e deploy de **todas** + as 4 novas; `functions list` com versão e `verify_jwt` = `config.toml`.
- [ ] **Step 3 — enriquecimento:** rodar o `reconciliar-faturamento` (ou o backfill) até `select count(*) from ml_devolucoes where enriquecido_em is null and org_id in (orgs com ML)` chegar a 0 (ou só restarem falhas registradas); conferir 5600661190 (`vez_de='comprador'`, `detalhe->>'title'='Devolução em preparação'`) e listar as `revisao_pendente = true`.
- [ ] **Step 4:** só então merge fast-forward na `main` (Render publica o front); conferir o bundle novo servido.
- [ ] **Step 5:** validação visual com dados reais (Playwright; claro/escuro/390px).
- [ ] **Step 6:** com o Diego, primeira ação real pela UI (responder numa reclamação aberta); conferir `estado='confirmada'` e o ML.
- [ ] **Step 7:** docs (`edge-functions.md`, `project-status.md`, `TASKS.md`, vault); `git pull --ff-only` no checkout principal; remover worktree/branch.
