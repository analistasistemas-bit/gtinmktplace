# Implementation Plans

Planos 001–003 gerados pela skill `improve` em 2026-06-26 (commit `32897cc`) após validar uma
auditoria externa. Planos **004–016** gerados em 2026-06-26 (commit `7222675`) por uma auditoria
`improve deep` própria (8 lanes paralelas: bugs front/back, security, perf, tests, tech-debt, deps+dx,
docs+direction), com vetting de todos os findings contra o código real (e contra o banco de produção,
read-only). Cada executor: leia o plano inteiro antes de começar, honre as STOP conditions, e atualize
sua linha de status ao terminar.

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001  | ESLint deixa de varrer `.claude/` | P1 | S | — | DONE |
| 002  | Remover worktrees órfãos (~437 MB) | P1 | S | — | DONE |
| 003  | Associar labels aos inputs (a11y) | P2 | S | — | DONE |
| 004  | Congelar `verify_jwt` por função em `config.toml` | P1 | S | — | DONE (merged+push; **pendente deploy** das edges p/ valer) |
| 005  | Retry do `process-familia` por status, não regex no texto | P1 | S | — | DONE (merged+push; testes verdes; **pendente deploy** do process-familia) |
| 006  | `buscarVendas` sem baixar coluna `raw` | P1 | S | (coord. 013) | DONE (merged+push; validado ao vivo via browser-use) |
| 007  | `.env.example` com secrets de backend faltantes | P1 | S | — | DONE (merged+push) |
| 008  | Higiene de docs (índice ADRs, stack, staleness) | P2 | S | — | DONE (merged+push; índice 0001-0043, OpenRouter, banner ROADMAP, project-status corrigido; renumber dos ADRs dup fica p/ decisão sua) |
| 009  | `deno lint`/`check` nas Edge Functions | P1 | M | — | TODO |
| 010  | CI mínimo (`.github`) | P2 | S | 009 | TODO |
| 011  | Characterization tests de `custos.ts` (dinheiro) | P1 | S | — | TODO |
| 012  | Unique key + upsert idempotente em `ml_vendas_itens` | P1 | M | (ideal após 011, 009) | TODO |
| 013  | Paginar queries de dinheiro (teto ~1000) | P2 | M | coord. 006, 011 | TODO |
| 014  | Lazy-load jspdf/xlsx (dynamic import) | P2 | M | — | TODO |
| 015  | Fonte única de `round2` + BRL sem símbolo | P2 | S | — | TODO |
| 016  | Teste de paridade preço/desconto FE↔BE | P3 | S | — | TODO |

Status: TODO | IN PROGRESS | DONE | BLOCKED (motivo) | REJECTED (motivo)

## Waves recomendadas

1. **Quick wins (P1, S, independentes)**: 004, 005, 006, 007. Risco baixo, ganho imediato.
2. **Docs (P2)**: 008. Zero risco. (Renumerar os ADRs duplicados 0035/0037 fica como **decisão do
   operador** — ver STOP do 008; renumerar viola a regra "nunca renumerar" e toca cross-refs em código/memória.)
3. **Tooling de backend**: 009 → 010. Fecha o buraco de 13,5k LOC sem análise estática; 009 deve revelar
   bugs reais acumulados (incl. `criar-item.ts:36`). 010 usa o script `lint:functions` do 009.
4. **Integridade de dinheiro**: 011 (rede de testes) primeiro; depois 012 (unique key) e 013 (paginação).
   012 idealmente após 009 (deno check valida o `io.ts`) e 011.
5. **Perf + tech-debt (P2/P3)**: 014, 015, 016.

## Dependency notes

- **006 ↔ 013**: ambos editam `buscarVendas` (`src/lib/faturamento.ts`). Faça **006 primeiro** (troca o
  `select *`); 013 rebaseia (adiciona `.range()` mantendo a lista de colunas).
- **011 → 013**: 013 usa `montarMapasCusto` extraída no 011; aplicar 011 antes simplifica 013.
- **011 → 012**: aplicar a rede de testes antes do fix de schema/io reduz risco.
- **009 → 010**: o job `backend-lint` do CI usa `pnpm lint:functions` criado no 009 (comente o job se 009 não entrou).
- **009 → 012 (soft)**: `deno check` (009) é a única forma hoje de validar estaticamente o `io.ts` que o 012 edita.
- 015 é behavior-preserving (mesma matemática/formato) — a rede de testes existente é a guarda.

## Findings considered and rejected (não re-auditar)

- **"RLS faltando nas tabelas de domínio"**: **FALSO**. Verificado no banco de produção (read-only): as 12
  tabelas de domínio têm RLS habilitada e policies `auth.uid() = user_id` corretas; **e as migrations
  também contêm** todo o enable-RLS + 38 `create policy` (não há drift migrations↔banco). Um grep inicial
  via Bash deu 0 por interferência do proxy `rtk` — re-checado via Node. Sem finding.
- **CORS `*` em `_shared/cors.ts`**: não é vulnerabilidade (sem `Access-Control-Allow-Credentials`; auth por
  Bearer token). Mantido da auditoria anterior.
- **"deps vulneráveis (hono)"**: factualmente errado; reais = 18 vulns `low` de `undici` via vitest/jsdom
  (devDeps de teste, não chegam a produção). Reavaliar só se subir a high/critical ou atingir runtime.
- **4 casts `(supabase as any)`** e **a11y labels do config-telegram**: já corrigidos em sessões anteriores.
- **"106 errors / 84 `any`"** (auditoria externa anterior): inflado por `.claude/worktrees/`. `any` reais
  eram 4, já resolvidos. Lint real hoje: 0 errors / 7 warnings (react-refresh idiomático do shadcn).

## Findings NÃO selecionados para plano agora (reais, disponíveis se quiser)

- **`telegram_bot_token` em texto puro** (security, HIGH conf, real): token plaintext na `configuracoes`,
  selecionável pelo cliente (RLS row-level, não por coluna). **Declinado pelo operador** (2026-06-26): o fix
  correto (Vault) implica **rotacionar** o token, e ele não quer esse overhead. Não re-auditar como pendente.
- **Devoluções "no escuro"** (direction): `sync-devolucao` + IO existem, mas `devolucoes-io.ts:8-23` engole 403
  de permissão → operador vê "zero devoluções" indistinguível de "permissão bloqueada". Fix barato = distinguir
  403 de vazio na UI.
- **Shopee E5** (direction): a arquitetura (`_shared/canais/registry.ts` + `contrato.ts` + checklist em
  `docs/shopee-open-platform-setup.md`) deixa o 2º conector a ~1 adapter de distância. É um épico (spike primeiro).

## Findings menores / borderline (registrados, não viram plano)

- Selo "Novo" marca pedidos antigos ao trocar período/origem (`aba-vendas.tsx:196`) — cosmético, auto-limpa.
- `resumo-financeiro` usa lookback fixo de 120d (`resumo-financeiro/index.ts:117`) — ignora período custom > 120d; edge case.
- `backfill-faturamento` faz N+1 de shipment por pedido + comentário-cabeçalho stale (`:5` vs `:44`).
- Edge functions devolvem mensagens internas de erro (DB/Redis/ML) no corpo da resposta — ruído de segurança, single-operator.
- `mlFetch` único do ML: URL base + auth + tratamento de erro repetidos em ~14 módulos `_shared/ml` — refactor maior.
- `pnpm-workspace.yaml` com chave inválida `allowBuilds` + sem `packageManager` pinado.
- Sem `.prettierrc`/`.editorconfig`/pre-commit hook.

## Follow-ups destravados pelos planos

- **Plan 009** destrava: corrigir o backlog do `deno lint` (incl. `_shared/ml/criar-item.ts:36`
  `no-misleading-character-class`), fazer `deno check` resolver imports e tipar os handlers, e habilitar
  `deno test` para testar a orquestração de `token.ts` (`getValidAccessToken`) e `io.ts` — o que estende o Plan 011.
