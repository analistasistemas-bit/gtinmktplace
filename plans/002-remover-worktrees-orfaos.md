# Plan 002: Remover os worktrees órfãos (`.claude/worktrees.to-delete-1781478878`, ~437 MB)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. This
> plan DELETES files — the STOP conditions are safety gates; honor them
> literally. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git worktree list`
> Confirm the output matches "Current state" below before deleting anything.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (mitigado pelas STOP conditions; é uma deleção, então leia-as)
- **Depends on**: none (complementa o Plan 001, mas independente)
- **Category**: tech-debt
- **Planned at**: commit `32897cc`, 2026-06-26

## Why this matters

A pasta `.claude/worktrees.to-delete-1781478878/` guarda **437 MB** de worktrees de features
já mergeadas na `main` (épicos `e1-abstracao-canais`, `e3-categoria-generica`) e um diretório
órfão (`progresso-exclusao-lote`). As branches correspondentes já foram deletadas e esses
worktrees **não estão mais registrados** no git (não aparecem em `git worktree list`). São lixo
em disco que (a) ocupa 437 MB, (b) era a principal fonte de ruído nas auditorias de lint, e
(c) viola a convenção do projeto de remover worktree/branch após o merge. Removê-los limpa o
disco e o estado do repositório.

## Current state

- `git worktree list` retorna **apenas dois** worktrees registrados (cole e compare):

```
/Users/diego/Desktop/IA/Anuncios MktPlace                                       32897cc [main]
/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/e5-conector-shopee  fae011d [worktree-e5-conector-shopee]
```

- A pasta a remover é `.claude/worktrees.to-delete-1781478878/`, com 3 subpastas:
  `e1-abstracao-canais/`, `e3-categoria-generica/`, `progresso-exclusao-lote/`.
- Nenhuma delas aparece em `git worktree list` → já desregistradas.
- O metadado interno do git pode conter ponteiros mortos; `git worktree prune` os limpa.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Listar worktrees registrados | `git worktree list` | só `main` + `e5-conector-shopee` |
| Tamanho do alvo | `du -sh .claude/worktrees.to-delete-1781478878` | ~437M |
| Checar mudança não commitada num subdir | `git -C <dir> status --porcelain` | (avaliar — ver Step 2) |
| Remover | `rm -rf .claude/worktrees.to-delete-1781478878` | exit 0 |
| Limpar metadado | `git worktree prune -v` | lista ponteiros removidos |

## Scope

**In scope** (a única coisa a deletar):
- A pasta `.claude/worktrees.to-delete-1781478878/` inteira.

**Out of scope** (NÃO tocar — risco de perda de trabalho ativo):
- `.claude/worktrees/e5-conector-shopee/` — worktree **ATIVO** (épico E5 em andamento). Não deletar.
- `.claude/worktrees/` (sem o sufixo `.to-delete`) — diretório dos worktrees ativos.
- Qualquer arquivo fora de `.claude/worktrees.to-delete-1781478878/`.

## Git workflow

- Esta operação não precisa de branch própria — é deleção de arquivos não rastreados/órfãos
  fora do tree versionado (`.claude/` é gitignored). Não gera commit no código.
- NÃO faça push.

## Steps

### Step 1: Confirmar que o alvo não é um worktree registrado

**Verify**: `git worktree list | grep -c 'to-delete'` → `0`
(se for ≥1, o alvo AINDA está registrado — vá para STOP, use `git worktree remove` em vez de `rm`).

### Step 2: Checar trabalho não commitado em cada subdir com `.git`

Rode, para `e1-abstracao-canais` e `e3-categoria-generica` (os que têm `.git`):

```
git -C .claude/worktrees.to-delete-1781478878/e1-abstracao-canais status --porcelain
git -C .claude/worktrees.to-delete-1781478878/e3-categoria-generica status --porcelain
```

Espera-se saída **vazia ou apenas arquivos derivados** (ex.: `node_modules`, `dist`, `.env.local`).
Se aparecer arquivo-fonte modificado/novo (`.ts`, `.tsx`, `.sql`) não commitado, isso pode ser
trabalho perdido — vá para STOP e reporte o que apareceu.

**Verify**: as duas saídas não contêm linhas terminando em `.ts`, `.tsx` ou `.sql` com status `M`/`??`
fora de `node_modules`/`dist`.

### Step 3: Deletar a pasta

```
rm -rf .claude/worktrees.to-delete-1781478878
```

**Verify**: `test -d .claude/worktrees.to-delete-1781478878 && echo EXISTE || echo REMOVIDO` → `REMOVIDO`

### Step 4: Limpar metadados mortos de worktree

```
git worktree prune -v
```

**Verify**: `git worktree list` → continua mostrando **exatamente** `main` + `e5-conector-shopee`
(nada a menos, nada a mais).

## Test plan

Sem testes de código. Verificação é o estado do filesystem e do `git worktree list` (Steps 3–4).

## Done criteria

ALL must hold:

- [ ] `.claude/worktrees.to-delete-1781478878/` não existe mais.
- [ ] `git worktree list` mostra exatamente 2 entradas: `main` e `e5-conector-shopee`.
- [ ] `.claude/worktrees/e5-conector-shopee/` continua intacto (`test -d` → existe).
- [ ] Status row deste plano atualizada em `plans/README.md`.

## STOP conditions

Pare e reporte (não improvise) se:

- `git worktree list` listar qualquer caminho com `to-delete` (está registrado — não use `rm`,
  reporte para usar `git worktree remove --force`).
- O Step 2 revelar arquivo-fonte (`.ts`/`.tsx`/`.sql`) modificado ou não rastreado fora de
  `node_modules`/`dist` em qualquer subdir — pode ser trabalho não salvo.
- O caminho `e5-conector-shopee` aparecer em qualquer comando de deleção — ele é ativo e
  fora de escopo.
- `git worktree list` após o prune não mostrar mais o `e5-conector-shopee` (algo foi longe demais).

## Maintenance notes

- Convenção do projeto: após merge de uma branch de feature, remover o worktree e a branch
  (`git worktree remove` + `git branch -d`). Renomear para `*.to-delete-*` e deixar acumular é o
  anti-padrão que gerou este lixo. Um revisor deve confirmar que o `e5-conector-shopee` segue intacto.
