# Tarefa 1.5 — Refinamento de design (pós-review Codex)

> Refinos finos sobre a repaginação premium (Tarefa 1) já em produção. Light + dark. Sem reestruturar fluxo (isso é Tarefa 2).

**Goal:** aplicar 6 ajustes de hierarquia/affordance/legibilidade apontados na review adversarial do Codex.

**Branch:** `design/refinamento-1-5` (worktree). Validar local antes de merge.

## Global Constraints
- Regra híbrida mantida: vitrine = gradiente de marca; dados = minimalista.
- Verde (`text-success`) permanece semântico (não trocar por roxo).
- Dark: sombra não aparece → elevação por cor + borda tonal.
- Não inflar densidade (sem subir tudo para 40px — isso é Tarefa 2/UX).

## Tarefas

### T1 — Hierarquia de elevação no Dashboard (carro-chefe)
- **Problema:** KPIs (com sombra) + lista de lotes (cards com sombra+ring+hover:shadow-md) competem.
- **Fix:** achatar `LoteCard` — `shadow-none ring-0 hover:shadow-none`, borda sutil, hover de borda/realce mais claro (`hover:border-primary/30`). KPIs do topo mantêm elevação. Hero KPI (`variant="brand"`) intacto.
- **Arquivo:** `src/components/lote-card.tsx`.

### T2 — Borda tonal mais aparente no dark (#7)
- **Fix:** `.dark --border` de `oklch(1 0 0 / 0.17)` → `0.20`. Cards-chave ganham contorno no dark (onde sombra some).
- **Arquivo:** `src/index.css`.

### T3 — Configurações: colapsar detalhe técnico OAuth (#4)
- **Fix:** topo "Conectado como X · Permissões salvas"; escopo OAuth longo + nota de Pedidos vão para `<details>` "Detalhes técnicos" (mono/truncado).
- **Arquivo:** `src/pages/Configuracoes.tsx`.

### T4 — Financeiro: estado de atualização discreto + timestamp (#6)
- **Fix:** trocar "atualizando…" persistente por: quando `isFetching` linha discreta (`track-indeterminate`); senão "Atualizado às HH:mm" via `dataUpdatedAt` do React Query.
- **Arquivos:** `src/pages/Financeiro.tsx` (desestruturar `dataUpdatedAt`).

### T5 — Revisão: acento lateral por status (#3 parcial)
- **Fix:** `FamiliaRow` ganha `border-l-2` colorido por prioridade: erro→destructive, precisa-ação(incompleta/sem foto/sem cor)→warning, publicado→success, editado→primary, senão transparent. Sem acento por CREATE/UPDATE (já têm pill) p/ evitar carnaval.
- **Arquivo:** `src/components/familia-row.tsx`.

### T6 — Viabilidade: dropzone expressiva (#5)
- **Fix:** dropzone maior (p-12), ícone em chip circular, título + subtítulo, estado drag-active mais forte. Sem gradiente, só affordance.
- **Arquivo:** `src/pages/Viabilidade.tsx`.

## Verificação
- `pnpm build` sem erros.
- Validar no navegador (perfil Default, logado): Dashboard, Financeiro, Configurações, Revisão, Viabilidade — em light e dark.
