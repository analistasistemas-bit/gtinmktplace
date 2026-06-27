# Plan 001: ESLint deixa de varrer `.claude/` (worktrees não contaminam o lint)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> "STOP conditions" item occurs, stop and report — do not improvise. When done,
> update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 32897cc..HEAD -- eslint.config.js`
> If `eslint.config.js` changed since this plan was written, compare the
> "Current state" excerpt against the live file before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `32897cc`, 2026-06-26

## Why this matters

ESLint hoje varre `.claude/worktrees/` — que contém cópias inteiras do repositório
(worktrees ativos e antigos). Isso infla a contagem de problemas em ~10×: `npx eslint .`
reporta **106 errors**, mas no código-fonte real (`src` + `tests`) são apenas **9 errors,
7 warnings**. O ruído torna o `npm run lint` lento e faz qualquer auditoria de qualidade
medir arquivos que não são o projeto (inclusive worktrees já mergeados). Depois deste plano,
o lint reflete só o código real e auditorias futuras passam a ser confiáveis.

## Current state

- `eslint.config.js` — configuração flat do ESLint. O bloco de ignore está na linha 10:

```js
// eslint.config.js:8-10
export default tseslint.config(
  // Edge Functions rodam em Deno (runtime/globals diferentes); são lintadas à parte, não aqui.
  { ignores: ['dist', 'supabase/functions'] },
```

- A pasta `.claude/worktrees/` contém worktrees do git (cópias do repo). O array `ignores`
  não a inclui, então o ESLint entra nela e linta milhares de linhas duplicadas.
- **Importante (não mexer):** `'supabase/functions'` está no ignore **de propósito** — as Edge
  Functions rodam em Deno (globals e imports `*.ts` diferentes do browser), conforme o comentário
  na linha 9. Lintá-las com esta config de browser geraria centenas de falsos positivos.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Lint (raw) | `npx eslint .` | roda; conta de problems muito menor que hoje |
| Contagem de paths de worktree no lint | `npx eslint . 2>&1 \| grep -c 'worktrees'` | `0` |

## Scope

**In scope** (o único arquivo a modificar):
- `eslint.config.js`

**Out of scope** (NÃO tocar):
- `'supabase/functions'` no array de ignore — decisão deliberada (Deno). Mantê-lo.
- Os arquivos dentro de `.claude/` — não editar, não deletar (a remoção dos worktrees órfãos
  é o Plan 002, separado).
- Qualquer um dos 9 errors reais que sobrarão em `src` (any, react-refresh, labels) — não são
  escopo deste plano.

## Git workflow

- Branch: `advisor/001-eslint-ignore-claude` (ou a convenção do operador).
- 1 commit. Estilo de mensagem do repo é conventional commits (ver `git log`), ex.:
  `chore(lint): ignora .claude/ no eslint para não varrer worktrees`.
- NÃO faça push nem abra PR a menos que o operador peça.

## Steps

### Step 1: Adicionar `.claude` ao array de ignore

Em `eslint.config.js`, na linha 10, altere o array de ignore para incluir `'.claude'`:

```js
  { ignores: ['dist', 'supabase/functions', '.claude'] },
```

Não altere mais nada no arquivo.

**Verify**: `npx eslint . 2>&1 | grep -c 'worktrees'` → `0`
(nenhum arquivo dentro de `.claude/worktrees` aparece mais no output)

### Step 2: Confirmar que a contagem caiu para o nível do código real

**Verify**: `npx eslint . 2>&1 | grep -oE '[0-9]+ problems'` → algo como `16 problems`
(esperado: **9 errors, 7 warnings** = 16 problems; o número exato pode variar ±2 se o código
mudou, mas deve ser **uma ordem de grandeza menor que os ~134 de antes**).

Se a contagem ainda estiver na casa das centenas, o ignore não pegou — vá para STOP.

## Test plan

Não há testes de unidade para configuração de lint. A verificação é o próprio output do ESLint
(Steps 1 e 2). Nenhum teste novo a escrever.

## Done criteria

ALL must hold:

- [ ] `eslint.config.js` contém `'.claude'` no array `ignores` (e ainda contém `'dist'` e `'supabase/functions'`).
- [ ] `npx eslint . 2>&1 | grep -c 'worktrees'` retorna `0`.
- [ ] `npx eslint . 2>&1 | grep -oE '[0-9]+ problems'` mostra ~16 problems (não centenas).
- [ ] `git status` mostra apenas `eslint.config.js` modificado, nada mais.
- [ ] Status row deste plano atualizada em `plans/README.md`.

## STOP conditions

Pare e reporte (não improvise) se:

- O conteúdo de `eslint.config.js` não bater com o excerpt de "Current state" (drift).
- Após adicionar `'.claude'`, a contagem de problems continuar nas centenas (o ignore não está
  funcionando — possível diferença de versão do ESLint flat config; reporte a versão de
  `npx eslint --version`).
- Você sentir necessidade de remover `'supabase/functions'` do ignore — isso é explicitamente
  fora de escopo; pare e reporte.

## Maintenance notes

- Se no futuro o time quiser realmente lintar as Edge Functions (Deno), o caminho é `deno lint`
  (ferramenta nativa, hoje **não instalada** e sem `deno.json` no repo), **não** remover o ignore
  do ESLint. Isso é um follow-up deliberadamente fora deste plano (ver `plans/README.md` →
  "Findings considered and rejected").
- Um revisor deve checar que apenas o array de ignore mudou e que `'supabase/functions'`
  continua presente.
