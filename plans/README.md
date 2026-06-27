# Implementation Plans

Gerado pela skill `improve` em 2026-06-26 (commit `32897cc`), após validação de uma auditoria
externa. Execute na ordem abaixo, salvo dependências. Cada executor: leia o plano inteiro antes
de começar, honre as STOP conditions e atualize sua linha de status ao terminar.

## Contexto (por que estes planos)

Uma auditoria anterior reportou "106 errors de lint" e priorizou `any`/CORS/vulns. A verificação
mostrou que **os números estavam inflados ~10×**: o ESLint varre `.claude/worktrees/` (cópias do
repo). No código real são **9 errors, 7 warnings**. Os planos abaixo atacam a causa raiz (config
de lint + lixo de worktree) e o único quick win de a11y legítimo. Os findings exagerados foram
rejeitados (ver seção final).

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001  | ESLint deixa de varrer `.claude/` | P1 | S | — | DONE (merged; verificado: probe=0, src 9err/7warn) |
| 002  | Remover worktrees órfãos (~437 MB) | P1 | S | — | DONE (437 MB removidos; e5 intacto, worktree list limpo) |
| 003  | Associar labels aos inputs (a11y) | P2 | S | — | DONE (eslint=0, tsc=0, testes 11/11; verificado) |

Status: TODO | IN PROGRESS | DONE | BLOCKED (motivo) | REJECTED (motivo)

## Dependency notes

- Os três planos são independentes e podem rodar em qualquer ordem.
- Recomendação: **001 primeiro** — depois dele o `npm run lint` reflete só o código real, o que
  facilita verificar o 003. O 002 é ortogonal (deleção de disco).
- 001 e 002 são complementares, não dependentes: 001 conserta a config (vale para worktrees
  futuros também), 002 remove o lixo atual.

## Findings considered and rejected

Registrados para não serem re-auditados:

- **"106 errors / 84 `any`"**: número inflado por `.claude/worktrees/`. `any` reais no código de
  negócio (`src/`): **4** (1 em `usePerguntas.ts`, `devolucoes.ts`, `faturamento.ts`,
  `perguntas.ts`). Mocks de teste já têm a regra desligada de propósito (`eslint.config.js:32-38`).
  Não vale um plano — baixíssimo volume e parte é cast intencional contra a API do Supabase.
- **CORS `*` em `supabase/functions/_shared/cors.ts`**: **não é vulnerabilidade**. Não há
  `Access-Control-Allow-Credentials: true` e a autorização é por Bearer token (não cookie de
  sessão same-origin), então `*` é o padrão aceitável para API token-based. Rejeitado.
- **"12 dependências vulneráveis (hono via shadcn)"**: factualmente errado. `pnpm audit` real =
  **18 vulns `low`**, todas `undici` via `vitest`/`jsdom`/`@vitest/ui` — **devDependencies de
  teste**, não chegam a produção (Edge Functions são Deno; o bundle do frontend não inclui
  vitest). Rejeitado; reavaliar só se subir a `high`/`critical` ou atingir runtime.
- **`preserve-caught-error` em `copywriter.ts`** (re-throw sem `cause`): existe, mas em
  `supabase/functions` (fora do lint do projeto, por decisão Deno) e impacto de DX baixo.
  Não vale plano isolado; encaixar num eventual passe de qualidade das Edge Functions.

## Follow-ups deferred (não viraram plano agora)

- **Lint real das Edge Functions (Deno)**: `eslint.config.js` ignora `supabase/functions` de
  propósito (Deno ≠ browser). O comentário diz "lintadas à parte", mas na prática **nada** as
  linta (`deno` não está instalado, não há `deno.json`). Todo o backend (34 functions: workers,
  ML, tokens) está sem linter. Caminho correto: adotar `deno lint` (não remover o ignore do
  ESLint). É um épico de tooling à parte — decidir antes de planejar.
- **Bug latente real, hoje invisível**: `supabase/functions/_shared/ml/criar-item.ts:36`
  (`sanitizarDescricaoML`) tem `no-misleading-character-class` — um seletor de variação U+FE0F
  solto dentro da char class `[...\u{2B00}-\u{2BFF}️]`. Está em produção (sanitiza descrição pro
  ML). Impacto prático pequeno, mas é um bug de verdade que o follow-up de `deno lint` acima
  exporia. Plano possível quando o lint do backend existir.
