# Plan 003: Associar labels aos inputs em `config-telegram.tsx` (a11y)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> "STOP conditions" item occurs, stop and report. When done, update this plan's
> status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 32897cc..HEAD -- src/components/config-telegram.tsx`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (mais fácil de verificar depois do Plan 001, que limpa o ruído do lint)
- **Category**: bug (acessibilidade)
- **Planned at**: commit `32897cc`, 2026-06-26

## Why this matters

Dois `<label>` no formulário de configuração do Telegram não estão associados aos seus inputs.
O ESLint acusa `jsx-a11y/label-has-associated-control` (2 errors) em
`src/components/config-telegram.tsx:80` e `:90`. Sem associação: leitores de tela não anunciam
o rótulo ao focar o campo, e clicar no texto do label não foca o input. É um quick win de
acessibilidade e elimina 2 dos 9 errors reais do lint.

## Current state

- `src/components/config-telegram.tsx` — card de configuração do Telegram (Chat ID + Bot token).
- Os dois labels problemáticos (linhas 79–99):

```tsx
// src/components/config-telegram.tsx:79-99
        <div>
          <label className="mb-1 block text-xs font-medium">Chat ID</label>
          <Input
            className="h-8 text-sm"
            value={chatId}
            placeholder="ex.: 123456789"
            onChange={(e) => setChatId(e.target.value)}
            onBlur={() => { if (chatId !== (cfg?.chatId ?? '')) persistir({ chatId }); }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Bot token</label>
          <Input
            type="password"
            className="h-8 text-sm"
            value={botToken}
            placeholder={tokenPlaceholder}
            onChange={(e) => setBotToken(e.target.value)}
            onBlur={() => { if (botToken.trim()) persistir({ botToken }); }}
          />
        </div>
```

- `Input` é o componente shadcn/ui (`src/components/ui/input.tsx`); ele repassa props para o
  `<input>` nativo, então aceitar um `id` funciona sem alteração no componente.
- Convenção: este projeto usa shadcn/ui. A forma idiomática de associar é `htmlFor` no `<label>`
  + `id` igual no controle.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Lint só deste arquivo | `npx eslint src/components/config-telegram.tsx` | `✖ 0 problems` |
| Typecheck | `npx tsc --noEmit` | exit 0, sem erros novos |
| Testes | `npm test` | passam (sem regressão) |

## Scope

**In scope** (o único arquivo a modificar):
- `src/components/config-telegram.tsx`

**Out of scope** (NÃO tocar):
- `src/components/ui/input.tsx` — o componente shadcn não precisa mudar.
- Qualquer outro campo/label fora destes dois `<div>`.
- Estilos/classes Tailwind existentes — manter como estão.

## Git workflow

- Branch: `advisor/003-a11y-labels-telegram` (ou a convenção do operador).
- 1 commit. Conventional commits, ex.: `fix(a11y): associa labels aos inputs em config-telegram`.
- NÃO faça push nem abra PR a menos que o operador peça.

## Steps

### Step 1: Associar o label "Chat ID"

Adicione `htmlFor="telegram-chat-id"` ao `<label>` e `id="telegram-chat-id"` ao `<Input>`
correspondente:

```tsx
          <label htmlFor="telegram-chat-id" className="mb-1 block text-xs font-medium">Chat ID</label>
          <Input
            id="telegram-chat-id"
            className="h-8 text-sm"
            value={chatId}
            ...
```

### Step 2: Associar o label "Bot token"

Mesma técnica, com um id único:

```tsx
          <label htmlFor="telegram-bot-token" className="mb-1 block text-xs font-medium">Bot token</label>
          <Input
            id="telegram-bot-token"
            type="password"
            className="h-8 text-sm"
            value={botToken}
            ...
```

Não altere `value`, `onChange`, `onBlur`, `placeholder` nem as classes.

**Verify (Steps 1–2)**: `npx eslint src/components/config-telegram.tsx` → `✖ 0 problems`

### Step 3: Garantir que nada regrediu

**Verify**: `npx tsc --noEmit` → exit 0 (sem erros novos)
**Verify**: `npm test` → suíte passa

## Test plan

Não há (nem é necessário criar) teste unitário para esta mudança puramente de marcação a11y —
a regra de lint `jsx-a11y/label-has-associated-control` é o gate automático. Nenhum teste novo.
Se o repo já tiver um teste para `config-telegram` (`grep -rl config-telegram src/**/*.test.tsx`),
rode-o e confirme que continua passando.

## Done criteria

ALL must hold:

- [ ] `npx eslint src/components/config-telegram.tsx` → `✖ 0 problems`.
- [ ] Cada `<label>` tem `htmlFor` igual ao `id` do seu `<Input>` (ids únicos no arquivo).
- [ ] `npx tsc --noEmit` exit 0.
- [ ] `npm test` passa.
- [ ] `git status` mostra apenas `src/components/config-telegram.tsx` modificado.
- [ ] Status row deste plano atualizada em `plans/README.md`.

## STOP conditions

Pare e reporte (não improvise) se:

- O código do arquivo não bater com o excerpt de "Current state" (drift).
- Após associar, o ESLint ainda acusar `label-has-associated-control` (pode exigir
  `nesting`/`htmlFor` diferente — reporte a mensagem exata).
- Adicionar `id` ao `Input` gerar erro de TypeScript (significaria que o componente não repassa
  props — reporte; não altere o componente shadcn).

## Maintenance notes

- Padrão a seguir em formulários futuros deste projeto: todo `<label>` com `htmlFor` apontando o
  `id` do controle. Um revisor deve checar que os ids são únicos na página onde o componente é
  renderizado.
