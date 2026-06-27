# Plan 004: Congelar `verify_jwt` por função em `supabase/config.toml`

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If anything in "STOP
> conditions" occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `ls supabase/config.toml` — esperado: **não existe**
> (arquivo a criar). Se já existir, compare o conteúdo com os Passos abaixo antes de
> prosseguir; divergência = STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (cria arquivo de config; NÃO faz deploy)
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `7222675`, 2026-06-26

## Why this matters

As Edge Functions deste projeto têm `verify_jwt` definido só na plataforma (dashboard /
flag de deploy), porque **não existe `supabase/config.toml`**. Sem config versionada, um
`supabase functions deploy <fn>` sem o flag certo pode flipar o `verify_jwt` de uma função
e mudar seu comportamento de autenticação silenciosamente — já houve incidente de workers
QStash travando lotes por causa disso (memória do projeto + `docs/decisions/0037-modulo-faturamento-webhooks-ml.md`).
Congelar o estado atual (que funciona — webhook e vendas sincronizando em produção hoje) em
`config.toml` torna o deploy determinístico: a config passa a ser a fonte da verdade.

Este plano **só cria o arquivo de config** espelhando o estado de produção. Ele **não faz
deploy** — aplicar a config é passo do operador (Diego), descrito em Maintenance notes.

## Current state

- **Não existe `supabase/config.toml`** no repo (`ls supabase/` mostra só `functions/` e `migrations/`).
- O default do Supabase CLI para `verify_jwt` é `true`.
- Estado **ao vivo** de `verify_jwt` por função (capturado em 2026-06-26 via `supabase functions list`
  no projeto `txvncrgkoynoxwopfkbp` — esta é a fonte da verdade a congelar):

  **`verify_jwt = false`** (16 funções — públicas / QStash / callbacks ML):
  `hello`, `process-familia`, `regenerar-copy-familia`, `ml-oauth-disconnect`, `ml-oauth-start`,
  `ml-oauth-callback`, `publish-familia-ml`, `calcular-tarifa-ml`, `update-familia-ml`,
  `remover-publicado`, `vincular-catalogo`, `reprocessar-familia`, `monitorar-moderados`,
  `sync-pergunta`, `sync-devolucao`, `notificar-liberacao`

  **`verify_jwt = true`** (15 funções — default; chamadas com JWT, frontend ou QStash autenticado):
  `ingest-lote`, `upload-imagens-lote`, `invalidar-cache-cor`, `publicar-familias`, `excluir-lote`,
  `status-publicados`, `definir-categoria-familia`, `analisar-viabilidade`, `metricas-vendas`,
  `ml-webhook`, `sync-venda`, `backfill-faturamento`, `reconciliar-faturamento`,
  `responder-pergunta`, `sugerir-resposta-pergunta`

- **IMPORTANTE — não "consertar" o estado**: a lista acima parece inconsistente (ex.: `sync-venda`
  é `true` mas `sync-pergunta` é `false`; `ml-webhook` é `true` apesar de chamado pelo ML). **Está
  funcionando assim em produção** (webhook recebeu eventos hoje, `ml_vendas` sincronizando). O
  objetivo é **espelhar exatamente** este estado, NÃO normalizá-lo. Mudar qualquer valor é fora de escopo.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Estado ao vivo | `supabase functions list` | tabela com coluna `verify_jwt` por função |
| Validar config | `supabase functions list` (comparar com o toml) | bate 1:1 com o arquivo |

(O CLI Supabase já está autenticado/linkado neste ambiente; ref do projeto `txvncrgkoynoxwopfkbp`.)

## Scope

**In scope** (único arquivo a criar):
- `supabase/config.toml` (criar)

**Out of scope** (NÃO tocar):
- Qualquer `index.ts` de Edge Function — nada de código muda.
- **NÃO rodar `supabase functions deploy`** — aplicar a config é passo manual do operador.
- NÃO alterar nenhum valor de `verify_jwt` em relação ao estado ao vivo da seção "Current state".

## Git workflow

- Branch já isolado (worktree). Commit único; estilo conventional commits, ex.:
  `chore(supabase): versiona verify_jwt por função em config.toml`
- NÃO push nem PR sem o operador pedir.

## Steps

### Step 1: Confirmar o estado ao vivo

Rode `supabase functions list` e confirme que a coluna `verify_jwt` bate com a lista da seção
"Current state". Se QUALQUER função divergir (valor diferente, função nova, função removida),
**STOP e reporte** — a lista a congelar mudou desde 2026-06-26.

**Verify**: a saída casa com as 16 `false` + 15 `true` acima.

### Step 2: Criar `supabase/config.toml`

Crie `supabase/config.toml` declarando **explicitamente as 16 funções `false`** (as `true` são o
default do CLI, mas declare todas as 31 mesmo assim para zero ambiguidade). Formato:

```toml
# Config versionada das Edge Functions. Fonte da verdade do verify_jwt por função
# (congelado do estado de produção em 2026-06-26). NÃO normalizar valores: espelha
# exatamente o que está deployado e funcionando. Ver plans/004 e ADR-0037.
project_id = "txvncrgkoynoxwopfkbp"

# --- verify_jwt = false (públicas / QStash / callbacks ML) ---
[functions.hello]
verify_jwt = false
[functions.process-familia]
verify_jwt = false
[functions.regenerar-copy-familia]
verify_jwt = false
[functions.ml-oauth-disconnect]
verify_jwt = false
[functions.ml-oauth-start]
verify_jwt = false
[functions.ml-oauth-callback]
verify_jwt = false
[functions.publish-familia-ml]
verify_jwt = false
[functions.calcular-tarifa-ml]
verify_jwt = false
[functions.update-familia-ml]
verify_jwt = false
[functions.remover-publicado]
verify_jwt = false
[functions.vincular-catalogo]
verify_jwt = false
[functions.reprocessar-familia]
verify_jwt = false
[functions.monitorar-moderados]
verify_jwt = false
[functions.sync-pergunta]
verify_jwt = false
[functions.sync-devolucao]
verify_jwt = false
[functions.notificar-liberacao]
verify_jwt = false

# --- verify_jwt = true (chamadas com JWT: frontend ou QStash autenticado) ---
[functions.ingest-lote]
verify_jwt = true
[functions.upload-imagens-lote]
verify_jwt = true
[functions.invalidar-cache-cor]
verify_jwt = true
[functions.publicar-familias]
verify_jwt = true
[functions.excluir-lote]
verify_jwt = true
[functions.status-publicados]
verify_jwt = true
[functions.definir-categoria-familia]
verify_jwt = true
[functions.analisar-viabilidade]
verify_jwt = true
[functions.metricas-vendas]
verify_jwt = true
[functions.ml-webhook]
verify_jwt = true
[functions.sync-venda]
verify_jwt = true
[functions.backfill-faturamento]
verify_jwt = true
[functions.reconciliar-faturamento]
verify_jwt = true
[functions.responder-pergunta]
verify_jwt = true
[functions.sugerir-resposta-pergunta]
verify_jwt = true
```

**Verify**: `cat supabase/config.toml` mostra as 31 funções; 16 `false` + 15 `true` casando com Step 1.

### Step 3: Sanidade do TOML

Confirme que o arquivo é TOML válido (sem chave duplicada, sem erro de sintaxe):

**Verify**: `node -e "const fs=require('fs');const t=fs.readFileSync('supabase/config.toml','utf8');const m=[...t.matchAll(/\[functions\.([a-z-]+)\]/g)].map(x=>x[1]);const s=new Set(m);console.log('blocos:',m.length,'unicos:',s.size,m.length===s.size?'OK':'DUPLICADO')"`
→ esperado: `blocos: 31 unicos: 31 OK`

## Test plan

Sem testes de código (é arquivo de config). A verificação é o diff contra `supabase functions list`
(Step 1) e a sanidade TOML (Step 3).

## Done criteria

Todos devem valer:

- [ ] `supabase/config.toml` existe com 31 blocos `[functions.<slug>]`, sem duplicados (Step 3 → `OK`).
- [ ] Os valores de `verify_jwt` batem 1:1 com `supabase functions list` (Step 1).
- [ ] Nenhum arquivo fora de `supabase/config.toml` foi modificado (`git status`).
- [ ] Linha de status deste plano atualizada em `plans/README.md`.

## STOP conditions

Pare e reporte (não improvise) se:

- O `supabase functions list` divergir da lista de "Current state" (estado mudou desde o plano).
- O CLI reclamar que `config.toml` precisa de campos obrigatórios além de `project_id`/`[functions.*]`.
- Você sentir vontade de "corrigir" um valor que parece inconsistente — NÃO; o objetivo é espelhar.

## Maintenance notes

- **Aplicar a config (passo do operador, fora deste plano)**: após merge, deployar lendo a config
  congela o estado. Como os defaults já batem com produção, um redeploy não deve mudar nada — mas
  o operador deve validar com `supabase functions list` antes e depois.
- A partir daqui, **toda função nova** deve ganhar seu bloco em `config.toml` no mesmo PR.
- Há uma assimetria a investigar um dia (não neste plano): `sync-pergunta`/`sync-devolucao` são
  `false` mas `sync-venda` é `true`, e `ml_perguntas` está vazia em produção. Se as perguntas
  pararem de sincronizar, esta é a primeira pista.
- O que um revisor deve checar: que nenhum valor de `verify_jwt` foi alterado vs. a tabela de 2026-06-26.
