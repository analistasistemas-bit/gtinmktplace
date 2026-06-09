# Redesign PubliAI — Fase 4 (Telas restantes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Re-skin premium de TODAS as telas restantes (Dashboard, NovoLote, Progresso, Relatório, Publicados, Configurações, RevisaoIndex, auth, NotFound) + `status-badge` com os tokens/componentes das Fases 1–3 — **zero mudança de lógica**.

**Architecture:** Re-skin presentacional. Cada cor hardcoded → `StatusPill`/token semântico (mapa no spec). Headers → `PageHeader`. Vazios → `EmptyState`. Tabela de Publicados → primitivos `Table` do DS. **Todo handler/hook/mutation/useState/efeito/cálculo/query permanece idêntico — muda só markup/classes.**

**Tech Stack:** React 18 + shadcn (`PageHeader`, `EmptyState`, `StatusPill`, `KpiCard`, `Table`, `Progress`, `Input`, `Card` já existem), lucide. Branch `worktree-redesign-fase4`.

**Spec:** `docs/superpowers/specs/2026-06-09-redesign-fase4-telas-restantes-design.md` — **leia o "mapa de tokens" lá; é a regra central.**

**Regra de ouro (todas as tasks):** antes de editar, garantir mentalmente que nenhuma linha de lógica muda. Ao terminar cada arquivo, conferir que todo `useState`, hook, `mutate*`, `on*`, `async function`, cálculo, condicional e query continua **textualmente igual** — só JSX/className/estrutura visual mudou. Rodar os testes (devem passar; se um quebrar por texto/cor, ajustar o seletor SEM afrouxar a asserção).

**Testes que cobrem o escopo (devem seguir verdes):** `tests/components/status-badge.test.tsx`, `tests/components/lote-card.test.tsx`, `tests/lib/publicados.test.ts`, `tests/App.test.tsx`, `tests/components/shell.test.tsx`, `tests/components/ui-components.test.tsx`.

---

## Task 4a: status-badge.tsx + Dashboard.tsx + RevisaoIndex.tsx

**Files:** Modify `src/components/status-badge.tsx`, `src/pages/Dashboard.tsx`, `src/pages/RevisaoIndex.tsx`

- [ ] **Step 1: StatusBadge → StatusPill**
  - Trocar `Badge variant` por `StatusPill tone`. Mapa `LoteStatus`→tone: `importando`/`processando`/`revisao`/`publicando`→`info`, `concluido`→`success`, `erro`→`danger`. **`LABELS` intacto** (testes asseram texto). Assinatura `{ status }` intacta.
- [ ] **Step 2: Dashboard**
  - `PageHeader title="Lotes recentes"` com `actions={<Button asChild><Link to="/novo-lote">…</Link></Button>}` (mover o botão atual). Estado vazio → `EmptyState` (ícone `PackageOpen` de lucide, `action` = botão "Novo lote"). Erro mantém `text-destructive`. **`useLotes` e o `.map(LoteCard)` intactos.**
- [ ] **Step 3: RevisaoIndex** — empty inline com tokens/`EmptyState` leve; `Navigate`/loading intactos.
- [ ] **Step 4: verificar** — `pnpm test -- tests/components/status-badge.test.tsx tests/components/lote-card.test.tsx` verdes; `pnpm exec tsc --noEmit` limpo.
- [ ] **Step 5: Commit** — `feat(redesign): Dashboard + StatusBadge + RevisaoIndex re-skin (Fase 4) — sem mudanca de logica`

---

## Task 4b: NovoLote.tsx + Progresso.tsx

**Files:** Modify `src/pages/NovoLote.tsx`, `src/pages/Progresso.tsx`

- [ ] **Step 1: NovoLote** — `PageHeader title="Novo lote"`. Barra de progresso manual (`div h-2 bg-muted` + inner `bg-primary`) → `Progress value={progresso}` do DS. Banner de erro mantém token destructive. **`useUploadLote`, `handleProcessar`, `podeProcessar`, `enviando`, `Dropzone` intactos.**
- [ ] **Step 2: Progresso** — `PageHeader` (título + subtítulo de status/contadores). Banner amber de anomalias → token `warning` (`border-warning/30 bg-warning/10 text-warning`), emoji ⚠ → ícone `AlertTriangle`. Lista de famílias com tipografia DS. **`useLoteRealtime`, `polling`, `useEffect` de navegação, cálculos (`pct`/`prontas`/`erradas`) intactos.**
- [ ] **Step 3: verificar** — `pnpm exec tsc --noEmit` + `pnpm build` limpos.
- [ ] **Step 4: Commit** — `feat(redesign): NovoLote + Progresso re-skin (Fase 4) — sem mudanca de logica`

---

## Task 4c: Relatorio.tsx

**Files:** Modify `src/pages/Relatorio.tsx`

- [ ] **Step 1** — `PageHeader title={\`Relatório · Lote #${lote.numero}\`}`. Os 3 cards `green-50/blue-50/red-50` → `KpiCard` (ou cards do DS com token): publicadas→`success`, publicando→`info`, erro→`destructive`; emojis → ícones lucide (`CheckCircle2`/`Loader2`/`XCircle`). Link "ver anúncio ↗" `text-blue-600` → `text-primary` (ou `Button variant="link"`). Mensagem de erro `text-red-600` → `text-destructive`. Status por linha → `StatusPill`. **`useLote`/`useFamilias`/`polling`/`nav`/cálculos intactos.**
- [ ] **Step 2: verificar** — `pnpm exec tsc --noEmit` + `pnpm build` limpos.
- [ ] **Step 3: Commit** — `feat(redesign): Relatorio re-skin (KpiCards, tokens semanticos) — sem mudanca de logica`

---

## Task 4d: Publicados.tsx (a mais pesada)

**Files:** Modify `src/pages/Publicados.tsx`

- [ ] **Step 1: BadgeStatus → StatusPill** — mapear `StatusPublicado`→tone (ativo→`success`, pausado/encerrado/indisponivel→`neutral`, moderado→`warning`, inativo→`danger`); `STATUS_LABEL` e o `motivo` de "moderado" preservados (motivo `text-warning`).
- [ ] **Step 2: PageHeader + banners + tabela** — Header → `PageHeader title="Publicados"` com `actions` = botão "Atualizar". Banner "sem credencial ML" amber → token `warning`. Tabela `<table>/<thead>/<tbody>/<tr>/<td>` → primitivos `Table/TableHeader/TableRow/TableHead/TableBody/TableCell` (`@/components/ui/table`); `LinhaTabela` re-escrita com `TableRow`/`TableCell` mantendo TODO o conteúdo (dialogs Descrição/Remover, links, `onRemover`). Empty global → `EmptyState`. "Nenhum resultado" → `TableRow`/`TableCell colSpan`.
- [ ] **Step 3: verificar** — `pnpm test -- tests/lib/publicados.test.ts` verde; `pnpm exec tsc --noEmit` + `pnpm build` limpos. **Conferir que `merged`, `filtrarPublicados`, `handleRemover`, `removendoId`, `fornecedores`, `useMemo`s estão textualmente idênticos.**
- [ ] **Step 4: Commit** — `feat(redesign): Publicados re-skin (Table DS, StatusPill, tokens) — sem mudanca de logica`

---

## Task 4e: Configuracoes.tsx

**Files:** Modify `src/pages/Configuracoes.tsx`

- [ ] **Step 1** — `PageHeader title="Configurações"`. Banners `green-50`/`red-50` → tokens `success`/`destructive`. Badge "Conectado" `green-100` → `StatusPill tone="success"`. `<input type="number">` → `Input` do DS (mantendo `value`/`onChange`/`onBlur`/`min`/`max`/`step`). "✓ Salvo" `text-green-700` → `text-success`. Cards já são `Card`; manter. **`useMlConnection`/`useDescontoPct`/`useSalvarDescontoPct`/`handleConectar`/`handleDesconectar`/`RadioGroup`/efeitos intactos.**
- [ ] **Step 2: verificar** — `pnpm exec tsc --noEmit` + `pnpm build` limpos.
- [ ] **Step 3: Commit** — `feat(redesign): Configuracoes re-skin (tokens, StatusPill, Input DS) — sem mudanca de logica`

---

## Task 4f: Auth (Login/Cadastro/ResetSenha) + NotFound

**Files:** Modify `src/pages/Login.tsx`, `Cadastro.tsx`, `ResetSenha.tsx`, `NotFound.tsx`

- [ ] **Step 1: Auth polish** — marca "PubliAI" com tipografia DS (`text-h1`/`text-display`), `bg-muted/30` mantido ou tom coerente, espaçamento DS. **`signIn`/`signUp`/`sendPasswordReset`, estados (`erro`/`carregando`/`feito`), `onSubmit` intactos.** Mensagens de erro já usam `text-destructive` (ok).
- [ ] **Step 2: NotFound** — 404 cru → layout com tokens/`EmptyState` + link "Voltar ao início".
- [ ] **Step 3: verificar (suite inteira)** — `pnpm test` todos verdes; `pnpm exec tsc --noEmit`, `pnpm lint` (0 errors), `pnpm build` limpos.
- [ ] **Step 4: Commit** — `feat(redesign): auth + NotFound re-skin (Fase 4) — sem mudanca de logica`

---

## Self-Review

- Mapa de tokens aplicado em 4a–4f (badges/banners/cards/links/inputs). ✓
- `PageHeader` em todas as telas internas; `EmptyState` nos vazios. ✓
- `Publicados` com primitivos `Table`; `BadgeStatus`/`StatusBadge` → `StatusPill`. ✓
- Zero mudança de lógica: cada task exige preservação textual de handlers/hooks/queries + testes existentes verdes. ✓
- Risco: testes que asseram texto/cor podem precisar ajuste de seletor (sem afrouxar) — `status-badge`/`lote-card` asseram só texto (seguros). Sinalizado em cada task.
- Review separado (regra OMC): após 4f, dispatch `code-reviewer`/`verifier` antes do merge.
