# Plan 007: Completar os secrets de backend faltantes no `.env.example`

> **Executor instructions**: Follow step by step. Run every verification command and
> confirm the expected result. If anything in "STOP conditions" occurs, stop and
> report. When done, update the status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7222675..HEAD -- .env.example`
> Se `.env.example` mudou desde `7222675`, compare o excerpt abaixo com o atual; divergência = STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx / docs
- **Planned at**: commit `7222675`, 2026-06-26

## Why this matters

Quem provisiona um ambiente Supabase novo (ou um agente seguindo os docs) configura os secrets a
partir do `.env.example`. Hoje faltam **3 variáveis obrigatórias** que o backend lê via
`Deno.env.get`, e todas falham em silêncio quando ausentes:

- `ML_REDIRECT_URI` → OAuth do Mercado Livre quebra (troca de `code` por token e o start do OAuth).
- `MP_ACCESS_TOKEN` → módulo Financeiro/Mercado Pago fica sem dados (caminho de dinheiro).
- `PUBLIAI_PUBLIC_URL` → links/callbacks gerados pela camada de IA ficam errados.

Além disso, o arquivo documenta `AI_MODEL_CLASSIFIER`, que **o código nunca lê** (drift inverso —
só `AI_MODEL_COPY` e `AI_MODEL_VISION` são usados).

## Current state

`.env.example` (íntegra):

```sh
# Frontend (prefixo VITE_ obrigatório para expor ao navegador)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Backend / Edge Functions (configurar via Supabase secrets, não aqui)
# IA via OpenRouter (gateway compatível com OpenAI SDK) — ver ADR-0010
# OPENROUTER_API_KEY=
# AI_MODEL_COPY=openai/gpt-4o-mini
# AI_MODEL_VISION=openai/gpt-4o
# AI_MODEL_CLASSIFIER=openai/gpt-4o-mini
# UPSTASH_REDIS_REST_URL=
# UPSTASH_REDIS_REST_TOKEN=
# QSTASH_TOKEN=
# QSTASH_CURRENT_SIGNING_KEY=
# QSTASH_NEXT_SIGNING_KEY=
# ML_CLIENT_ID=
# ML_CLIENT_SECRET=
```

Uso real confirmado (via varredura de `Deno.env.get` em `supabase/functions`):
- `ML_REDIRECT_URI` → `_shared/ml/token.ts`, `ml-oauth-start/index.ts`
- `MP_ACCESS_TOKEN` → `_shared/faturamento/enriquecimento.ts`, `_shared/mercadopago/financeiro.ts`, `resumo-financeiro/index.ts`
- `PUBLIAI_PUBLIC_URL` → `_shared/ai/client.ts`
- `AI_MODEL_CLASSIFIER` → **(NÃO USADO em lugar nenhum)**
- `AI_MODEL_COPY` / `AI_MODEL_VISION` → `_shared/ai/modelos.ts` (usados — manter)

**Regra do projeto**: secret nunca vai com valor para o repo. Mantenha as linhas **comentadas e
sem valor** (placeholder), como as já existentes no bloco de backend. NÃO preencher valor algum.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Conferir uso | `node -e "..."` (Step 2) | mostra os arquivos que leem cada var |
| Não há build | — | é só doc; nada compila |

## Scope

**In scope**:
- `.env.example` (única edição)

**Out of scope**:
- `.env.local`, `.env.local.example`, `.env.example` de outros diretórios (não existem/irrelevantes).
- Qualquer código. NÃO adicionar leitura de env nova.

## Git workflow

- Worktree isolado. Commit, ex.: `docs(env): documenta ML_REDIRECT_URI, MP_ACCESS_TOKEN, PUBLIAI_PUBLIC_URL (#007)`
- NÃO push/PR sem o operador pedir.

## Steps

### Step 1: Adicionar as 3 vars e remover a não usada

No bloco "Backend / Edge Functions", adicione as 3 linhas comentadas e **remova** a linha
`# AI_MODEL_CLASSIFIER=...`. Resultado do bloco de backend:

```sh
# Backend / Edge Functions (configurar via Supabase secrets, não aqui)
# IA via OpenRouter (gateway compatível com OpenAI SDK) — ver ADR-0010
# OPENROUTER_API_KEY=
# AI_MODEL_COPY=openai/gpt-4o-mini
# AI_MODEL_VISION=openai/gpt-4o
# UPSTASH_REDIS_REST_URL=
# UPSTASH_REDIS_REST_TOKEN=
# QSTASH_TOKEN=
# QSTASH_CURRENT_SIGNING_KEY=
# QSTASH_NEXT_SIGNING_KEY=
# ML_CLIENT_ID=
# ML_CLIENT_SECRET=
# ML_REDIRECT_URI=        # URL do ml-oauth-callback (troca de code por token)
# MP_ACCESS_TOKEN=        # token Mercado Pago (módulo Financeiro) — secret MP_ACCESS_TOKEN
# PUBLIAI_PUBLIC_URL=     # URL pública do app (links/callbacks gerados no backend)
```

**Verify**: `grep -n "ML_REDIRECT_URI\|MP_ACCESS_TOKEN\|PUBLIAI_PUBLIC_URL\|AI_MODEL_CLASSIFIER" .env.example`
→ mostra as 3 novas, **não** mostra `AI_MODEL_CLASSIFIER`.

### Step 2: Confirmar que não inventou var nem deixou de fora

**Verify**: rode a varredura e confira que toda var comentada no `.env.example` (exceto as do bloco
de exemplo de modelos) realmente é lida no código, e que as 3 novas aparecem:

```
node -e "const fs=require('fs'),p=require('path');function w(d){let r=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){const q=p.join(d,e.name);e.isDirectory()?r=r.concat(w(q)):e.name.endsWith('.ts')&&r.push(q)}return r}const f=w('supabase/functions').map(x=>fs.readFileSync(x,'utf8')).join('');for(const v of ['ML_REDIRECT_URI','MP_ACCESS_TOKEN','PUBLIAI_PUBLIC_URL','AI_MODEL_CLASSIFIER'])console.log(v, f.includes(v)?'USADO':'NAO USADO')"
```
→ esperado: as 3 novas `USADO`, `AI_MODEL_CLASSIFIER` `NAO USADO`.

## Test plan

Sem testes de código. Verificação = os dois greps/varreduras dos Steps 1–2.

## Done criteria

- [ ] `.env.example` lista `ML_REDIRECT_URI`, `MP_ACCESS_TOKEN`, `PUBLIAI_PUBLIC_URL` (comentadas, sem valor).
- [ ] `AI_MODEL_CLASSIFIER` removido.
- [ ] Nenhum valor de secret real foi escrito (todas as linhas de backend seguem `# VAR=` ou placeholder).
- [ ] Nenhum arquivo fora de `.env.example` modificado.
- [ ] Linha de status atualizada em `plans/README.md`.

## STOP conditions

Pare e reporte se:

- A varredura do Step 2 mostrar que alguma das 3 novas vars **não** é usada (o código mudou desde o plano).
- Você for tentado a escrever um valor real — NÃO; o repo só recebe placeholders.

## Maintenance notes

- Idealmente, a lista de secrets do `.env.example` deveria ser derivada de um `grep` de `Deno.env.get`
  para não re-divergir. Fica como melhoria futura (não neste plano).
- Revisor deve checar: nenhuma var com valor real; as 3 novas batem com o uso no backend.
