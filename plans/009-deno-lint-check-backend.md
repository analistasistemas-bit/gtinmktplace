# Plan 009: Introduzir análise estática (deno lint + check) nas Edge Functions

> **Executor instructions**: Follow step by step. Run every verification command. If
> anything in "STOP conditions" occurs, stop and report. When done, update the status
> row in `plans/README.md`.
>
> **Drift check (run first)**: `ls supabase/functions/deno.json` — esperado: **não existe**.
> Se existir, compare com os Passos antes de prosseguir; divergência = STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (adiciona tooling; NÃO corrige o backlog que ele revelar)
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `7222675`, 2026-06-26

## Why this matters

As 34 Edge Functions (~13,5k LOC, Deno) — todo o backend de dinheiro, webhooks e workers — não têm
**nenhuma** análise estática. O ESLint ignora `supabase/functions` de propósito (Deno ≠ browser:
`eslint.config.js:10`) e o `tsc -b` só inclui `src` (`tsconfig.app.json:28` → `"include": ["src"]`).
Os ~65 testes em `supabase/functions/**/__tests__/` rodam no Node via vitest e cobrem só helpers
puros — não tipam nem lintam os `index.ts`. Um erro de tipo, variável não usada, null-flow ou bug de
regex (ex.: `_shared/ml/criar-item.ts:36`, char class com `no-misleading-character-class`) passa
direto pro deploy.

Este plano **introduz o gate** (`deno lint` confiável + `deno check` best-effort) e **registra a
baseline** de problemas. Ele **não** corrige o backlog que o lint revelar — isso vira follow-ups.

## Current state

- Não existe `supabase/functions/deno.json` (nem `deno.json` na raiz) — nenhuma config Deno.
- `deno` provavelmente **não está instalado** no ambiente (confirmar no Step 1).
- `eslint.config.js:9-10`: comentário "Edge Functions rodam em Deno … são lintadas à parte, não aqui"
  + `ignores: ['dist', 'supabase/functions', '.claude']`. Ou seja: o comentário promete lint à parte,
  mas hoje **nada** linta o backend.
- Bug latente já conhecido que o `deno lint` deve pegar: `supabase/functions/_shared/ml/criar-item.ts:36`
  (`no-misleading-character-class` — `️` solto na char class de `sanitizarDescricaoML`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Deno instalado? | `deno --version` | imprime versão (se não, ver Step 1) |
| Lint backend | `deno lint supabase/functions` | roda; lista problemas (pode ser > 0 — é o ponto) |
| Typecheck (best-effort) | `deno check supabase/functions/**/*.ts` | roda; pode falhar por resolução de imports |

## Scope

**In scope**:
- `supabase/functions/deno.json` (criar — config de lint/fmt)
- `package.json` (adicionar scripts `lint:functions` e, se viável, `check:functions`)
- `eslint.config.js` (ajustar **só o comentário** da linha 9 para apontar ao `deno lint` real — opcional)

**Out of scope**:
- **NÃO corrigir** os problemas que o `deno lint`/`deno check` revelar (incluindo `criar-item.ts:36`).
  Cada correção é um follow-up próprio. Este plano só instala o gate e documenta a baseline.
- NÃO remover o `ignores: ['supabase/functions']` do ESLint (Deno ≠ browser; o ignore é correto).
- NÃO tocar em nenhum `index.ts` de função.

## Git workflow

- Worktree isolado. Commit, ex.: `chore(backend): adiciona deno lint/check nas edge functions (#009)`
- NÃO push/PR sem o operador pedir.

## Steps

### Step 1: Garantir o Deno

`deno --version`. Se não existir, instale via o instalador oficial (`curl -fsSL https://deno.land/install.sh | sh`)
ou `brew install deno`. Se não puder instalar no ambiente, **STOP e reporte** (o gate precisa do binário).

**Verify**: `deno --version` → imprime versão.

### Step 2: Criar `supabase/functions/deno.json`

Config mínima de lint/fmt para o diretório (sem regras exóticas; o default do `deno lint` já é bom):

```json
{
  "lint": {
    "include": ["."],
    "exclude": ["**/__tests__/**"]
  },
  "fmt": {
    "useTabs": false,
    "lineWidth": 100,
    "singleQuote": true,
    "semiColons": true
  }
}
```

(`__tests__` rodam no Node via vitest; excluí-los do `deno lint` evita ruído de globals diferentes.)

**Verify**: `node -e "JSON.parse(require('fs').readFileSync('supabase/functions/deno.json','utf8'));console.log('JSON OK')"` → `JSON OK`.

### Step 3: Adicionar scripts no `package.json`

No bloco `scripts`, adicione:
```json
"lint:functions": "deno lint supabase/functions",
"check:functions": "deno check supabase/functions/**/*.ts"
```

**Verify**: `node -e "const s=require('./package.json').scripts;console.log(s['lint:functions']?'OK':'FALTA')"` → `OK`.

### Step 4: Rodar e CAPTURAR a baseline (não corrigir)

Rode `deno lint supabase/functions` e **registre** o resumo (quantos problemas, por regra, e os
arquivos:linha — em especial confirme `_shared/ml/criar-item.ts:36`). Cole esse resumo no campo de
status/relato deste plano e em `plans/README.md` (seção de follow-ups). **Não corrija nada.**

Depois rode `deno check supabase/functions/**/*.ts` (best-effort). Se ele falhar por **resolução de
imports** (npm:/https:/import map), registre isso e siga — `deno check` fica como follow-up; o
`deno lint` (que não precisa resolver imports) é o gate confiável deste plano.

**Verify**: `deno lint supabase/functions` executa até o fim (exit 0 ou 1 com lista de problemas — ambos
contam como "o gate roda"). O comando **existir e rodar** é o critério; zero-problemas **não** é exigido.

## Test plan

Sem novos testes unitários (é tooling). A baseline capturada no Step 4 é o artefato de verificação.

## Done criteria

- [ ] `deno --version` funciona (Step 1).
- [ ] `supabase/functions/deno.json` existe e é JSON válido (Step 2).
- [ ] `package.json` tem `lint:functions` (e `check:functions`) (Step 3).
- [ ] `pnpm lint:functions` roda e a baseline de problemas foi registrada em `plans/README.md` (Step 4).
- [ ] Nenhum `index.ts`/helper de função foi modificado (`git status` — só `deno.json`, `package.json`,
      opcionalmente o comentário do `eslint.config.js`).
- [ ] Linha de status atualizada em `plans/README.md`.

## STOP conditions

Pare e reporte se:

- Não for possível instalar/rodar o `deno` no ambiente.
- Você se vir corrigindo erros que o lint apontou — isso é explicitamente fora de escopo (vira follow-up).
- O `deno lint` apontar **centenas** de problemas (sinal de regra default agressiva): reporte a contagem
  por regra antes de qualquer ajuste de config.

## Maintenance notes

- **Follow-ups que este plano destrava**: (a) corrigir `criar-item.ts:36`; (b) zerar o backlog do
  `deno lint` por regra; (c) fazer `deno check` resolver imports e virar gate de tipo dos handlers
  (hoje ninguém os tipa); (d) habilitar testes de orquestração (`token.ts`, `io.ts`) via `deno test`,
  que destrava o Plan 011 estendido.
- O **Plan 010 (CI)** deve incluir um job rodando `pnpm lint:functions`.
- Revisor deve checar: nenhum `index.ts` mudou; a baseline foi registrada (não escondida).
