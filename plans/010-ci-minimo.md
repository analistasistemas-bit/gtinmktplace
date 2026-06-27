# Plan 010: CI mínimo (lint + test + build + deno lint) em `.github/workflows`

> **Executor instructions**: Follow step by step. Run every verification command. If
> anything in "STOP conditions" occurs, stop and report. When done, update the status
> row in `plans/README.md`.
>
> **Drift check (run first)**: `ls .github/workflows/ 2>/dev/null` — esperado: diretório
> **não existe**. Se existir um workflow, compare antes de adicionar; divergência = STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 009 (o job de `deno lint` usa o script `lint:functions` criado no 009)
- **Category**: dx
- **Planned at**: commit `7222675`, 2026-06-26

## Why this matters

App em produção, com caminhos de dinheiro e deploy manual de Edge Functions, **sem nenhum gate
automático**. O `render.yaml:6` só faz `pnpm install && pnpm build` (não roda lint nem test). Nada
garante que `pnpm lint`, `pnpm test` (frontend + ~65 testes de backend) e `pnpm build` passem antes
de mergear/deployar. Combinado com o backend sem análise estática (Plan 009), é o canal por onde os
bugs escapam. Um CI mínimo em push/PR fecha isso.

## Current state

- Não existe diretório `.github/` (nenhum workflow de CI).
- `package.json` (`:6-14`) tem os scripts: `dev`, `build` (`tsc -b && vite build`), `lint` (`eslint .`),
  `test` (`vitest run`), `db:check` (`bash scripts/db-check.sh`). O Plan 009 adiciona `lint:functions`.
- Gerenciador: **pnpm** (há `pnpm-lock.yaml` e `pnpm-workspace.yaml`). Node 22 (ver `@types/node` ^22).
- `db:check` precisa de `SUPABASE_ACCESS_TOKEN` (secret) — por isso fica como job **opcional**.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Validar YAML | `node -e "..."` (Step 2) | parseia sem erro |
| Rodar os mesmos gates local | `pnpm install --frozen-lockfile && pnpm lint && pnpm test && pnpm build` | todos exit 0 |

## Scope

**In scope**:
- `.github/workflows/ci.yml` (criar)

**Out of scope**:
- Não configurar deploy/CD (só CI de verificação).
- Não adicionar secrets no GitHub (passo do operador) — o job que precisa de secret fica condicional.
- Não tocar em `render.yaml` nem em código.

## Git workflow

- Worktree isolado. Commit, ex.: `ci: adiciona workflow mínimo (lint+test+build+deno lint) (#010)`
- NÃO push/PR sem o operador pedir.

## Steps

### Step 1: Criar `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build

  backend-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x
      - run: deno lint supabase/functions
```

(O job `backend-lint` depende do Plan 009 ter criado `supabase/functions/deno.json`. Se 009 ainda não
foi aplicado, **comente o job `backend-lint`** e registre isso no relato — habilitar depois do 009.)

**Verify**: `node -e "const fs=require('fs');const t=fs.readFileSync('.github/workflows/ci.yml','utf8');if(!t.includes('pnpm install --frozen-lockfile'))throw new Error('faltou install');console.log('OK')"` → `OK`.

### Step 2: Validar o YAML

```
node -e "const fs=require('fs');const t=fs.readFileSync('.github/workflows/ci.yml','utf8');const ind=t.split('\n').filter(l=>l.includes('\t'));if(ind.length)throw new Error('YAML com TAB — use espaços');console.log('sem tabs OK')"
```
→ `sem tabs OK` (YAML não aceita tab para indentação).

### Step 3: Confirmar que os gates passam local

Rode `pnpm install --frozen-lockfile && pnpm lint && pnpm test && pnpm build`. Se algum falhar, **NÃO
é problema do CI** — é um problema real do repo; reporte (o CI só está expondo). Para `deno lint`, se
o Plan 009 estiver aplicado: `pnpm lint:functions`.

**Verify**: os 4 comandos saem 0 (baseline atual conhecida: lint 0 errors/7 warnings, tsc limpo, testes verdes, build OK).

## Test plan

Sem testes de código. Verificação = parse do YAML (Step 2) + os gates locais (Step 3). O CI só roda de
fato quando o operador fizer push para o GitHub (Actions habilitado) — isso é passo do operador.

## Done criteria

- [ ] `.github/workflows/ci.yml` existe, sem tabs, com job `frontend` (install --frozen-lockfile, lint, test, build).
- [ ] Job `backend-lint` presente (ativo se 009 aplicado; comentado + anotado se não).
- [ ] `pnpm install --frozen-lockfile && pnpm lint && pnpm test && pnpm build` passam local (Step 3).
- [ ] Nenhum arquivo fora de `.github/workflows/ci.yml` modificado.
- [ ] Linha de status atualizada em `plans/README.md`.

## STOP conditions

Pare e reporte se:

- `pnpm install --frozen-lockfile` falhar (lockfile dessincronizado — é finding à parte, não force).
- Algum gate local (lint/test/build) falhar: reporte o erro real; não relaxe o CI para "passar".
- O Plan 009 não tiver sido aplicado e você não souber se deve comentar o job `backend-lint` — comente e anote.

## Maintenance notes

- **Passo do operador**: habilitar Actions no repo GitHub; opcionalmente adicionar um job `db:check`
  com o secret `SUPABASE_ACCESS_TOKEN` (não incluído aqui por exigir segredo).
- Quando o backlog do `deno check` (Plan 009 follow-up) for resolvido, adicionar `deno check` ao job `backend-lint`.
- Revisor deve checar: o CI roda os MESMOS comandos que o dev roda local (sem divergência de versão de Node/pnpm).
