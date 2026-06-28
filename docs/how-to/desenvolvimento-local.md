# How-to — Rodar o projeto localmente

> **Tipo:** How-to (Diátaxis). Subir o frontend em dev. Conceitos em
> [../explanation/arquitetura.md](../explanation/arquitetura.md).

## Pré-requisitos

- Node 22 + **pnpm 11** (versão usada no CI).
- Acesso ao projeto Supabase (URL + anon key).
- (Opcional, p/ rodar functions/migrations) Supabase CLI e Deno v2.

## 1. Instalar dependências

```bash
pnpm install
```

## 2. Configurar o `.env.local`

O frontend só precisa de duas variáveis (prefixo `VITE_` para serem expostas ao navegador).
Copie o template e preencha:

```bash
cp .env.example .env.local
```

```dotenv
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key-publica>
```

> Sem essas duas, `src/lib/supabase.ts` lança no boot e a app fica em tela branca. As demais
> variáveis comentadas no `.env.example` são **secrets de backend** — configuradas em Supabase
> Secrets, **nunca** no `.env.local`.
>
> **Em git worktree:** `.env.local` é gitignored e não vem junto. Copie-o do checkout principal
> antes de subir o dev, senão a app quebra no boot.

## 3. Subir o dev server

```bash
pnpm dev          # Vite em http://localhost:5173
```

## Scripts disponíveis

| Script | O que faz |
|---|---|
| `pnpm dev` | Vite dev server (`localhost:5173`) |
| `pnpm build` | Build de produção (`tsc -b && vite build`) |
| `pnpm preview` | Serve o build de `dist/` |
| `pnpm test` | Vitest (uma rodada — modo CI) |
| `pnpm test:watch` | Vitest em watch |
| `pnpm lint` | ESLint em todo o repo |
| `pnpm storybook` | Storybook (`localhost:6006`) |
| `pnpm build-storybook` | Build estático do Storybook |
| `pnpm db:check` | Valida alinhamento das migrations (`scripts/db-check.sh`) |
| `pnpm lint:functions` | `deno lint` nas edge functions |
| `pnpm check:functions` | `deno check` (type check) nas edge functions |

## Portão de qualidade antes de commitar

O CI roda `pnpm lint` → `pnpm test` → `pnpm build` (frontend) e `deno lint` (backend), e
**bloqueia o merge** se algo falhar. Rode localmente antes de commitar:

```bash
pnpm lint && pnpm test && pnpm build
pnpm lint:functions
```

> `pnpm test` pode sair com código 1 se faltar `.env.test` (dummy). Confira o exit code, não só
> as asserções.

## Backend local (opcional)

Para rodar Postgres + Edge Functions na máquina:

```bash
supabase start            # stack local
supabase db push          # aplica migrations no Postgres local
supabase functions serve  # functions em localhost:54321
```

Deploy e migrations contra produção: [deploy-e-migrations.md](deploy-e-migrations.md).
