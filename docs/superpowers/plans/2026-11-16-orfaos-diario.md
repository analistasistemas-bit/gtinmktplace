# Conferência diária de órfãos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `varrer-anuncios-orfaos` roda 1×/dia por QStash e avisa o dono do SaaS no Telegram só quando há anúncio `perdido_do_app` (não "provável Remover").

**Architecture:** A edge ganha o modo QStash (assinatura `upstash-signature`) ao lado do modo JWT atual, como o `monitorar-moderados`. Corpo vazio → fan-out `{ orgId }` por org com conexão ML; `{ orgId }` → varre e manda Telegram se houver divergência. Filtro e texto numa função pura testada.

**Tech Stack:** Deno edge (Supabase), QStash (`verificarAssinatura`, `enfileirarEmBlocos`, `qstashClient().batchJSON`), Telegram (`enviarTelegram`), vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-orfaos-diario-design.md`

## Global Constraints
- Somente leitura: nenhuma escrita no ML nem no banco.
- Aviso só para o dono: `enviarTelegram(TELEGRAM_BOT_TOKEN, TELEGRAM_LEADS_CHAT_ID, texto)`.
- Divergência = `classe === 'perdido_do_app' && !provavel_remocao_pelo_app`.
- Sem divergência → nenhuma mensagem. Mensagens em pt-BR.
- Schedule `0 11 * * *` (08:00 BRT), sem body. `deduplicationId: orfaos-diario-${orgId}-${dia}`.
- Modo JWT (app) mantém exatamente a resposta atual.

## Review Focus
- Requisição sem assinatura e sem JWT → 401 (agora `verify_jwt=false`; `requireUserOrg` precisa barrar).
- Assinatura inválida → 401, nada varrido.
- Org cuja conexão sumiu entre o fan-out e o job → 200 sem mensagem (não retry infinito).
- Falha do ML numa org → 500 (retry QStash), sem afetar as outras.
- Telegram falhou (`enviarTelegram` false) → 500 para o QStash tentar de novo.

---

### Task 1: Função pura do alerta

**Files:**
- Create: `supabase/functions/varrer-anuncios-orfaos/alerta.ts`
- Test: `supabase/functions/varrer-anuncios-orfaos/__tests__/alerta.test.ts`

**Interfaces:**
- Produces: `montarAlertaOrfaos(org: string, r: { orfaos: OrfaoBruto[]; total_no_ml: number; truncado: boolean }): string | null` — `OrfaoBruto` = item do JSON atual (`ml_item_id, titulo, status, permalink, classe, provavel_remocao_pelo_app`). `null` = sem divergência.

- [ ] Teste: só `externo`, `catalogo_sem_vinculo` e `perdido_do_app` com `provavel_remocao_pelo_app: true` → `null`.
- [ ] Teste: 2 `perdido_do_app` → texto contém nome da org, "2 anúncios", cada `ml_item_id`, título e permalink; não contém os externos.
- [ ] Teste: `truncado: true` com divergência → texto contém "parcial".
- [ ] Rodar `pnpm test -- supabase/functions/varrer-anuncios-orfaos` → FAIL; implementar com `blocos` de `_shared/notificacoes/telegram.ts`; → PASS.
- [ ] Commit.

### Task 2: Modo QStash na edge + config

**Files:**
- Modify: `supabase/functions/varrer-anuncios-orfaos/index.ts`
- Modify: `supabase/config.toml` (`[functions.varrer-anuncios-orfaos]` → `verify_jwt = false`)

**Interfaces:**
- Consumes: `montarAlertaOrfaos` (Task 1).
- Refactor: corpo atual da varredura vira `varrer(admin, conexao, orgId)` retornando o mesmo JSON; o modo JWT chama e responde como hoje.

- [ ] `upstash-signature` presente → `verificarAssinatura(req, body)`; falso → 401.
- [ ] Corpo vazio → orgs distintas de `marketplace_connections` (`canal='mercado_livre'`, `conta_externa_id` não nulo) → `enfileirarEmBlocos` com URL da própria função, `retries: 3`, dedup por org+dia BRT.
- [ ] `{ orgId }` → `resolverConexao`; sem conexão → 200 `{ ok: true, sem_conexao: true }`; senão `varrer`, nome da org de `organizations`, `montarAlertaOrfaos`; texto → `enviarTelegram`, falha → 500.
- [ ] Erro de varredura no modo QStash → 500.
- [ ] `deno check supabase/functions/varrer-anuncios-orfaos/index.ts`, `pnpm lint`, `pnpm test -- supabase/functions/varrer-anuncios-orfaos`.
- [ ] Commit.

### Task 3: Deploy, schedule e docs

- [ ] Docs: `docs/reference/edge-functions.md` (linha da função: verify_jwt false, HTTP JWT manual ou QStash; tabela de schedules), comentário do cabeçalho da edge e de `src/lib/orfaos.ts` ("nunca em intervalo" → 1×/dia), `docs/TASKS.md`.
- [ ] CI verde → merge ff → `supabase functions deploy varrer-anuncios-orfaos` → conferir versão.
- [ ] Criar schedule QStash `0 11 * * *` → `/functions/v1/varrer-anuncios-orfaos`; registrar scheduleId no doc.
- [ ] Prova: disparar o schedule 1× manualmente e ver resposta `{ publicados: N }` + logs dos jobs.
