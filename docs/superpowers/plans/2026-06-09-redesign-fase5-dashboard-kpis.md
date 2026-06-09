# Redesign PubliAI — Fase 5 (Dashboard com KPIs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans para implementar task-a-task. Steps usam checkbox (`- [ ]`).

**Goal:** Transformar o Dashboard num painel com 5 KPIs (via `KpiCard` do DS) acima da lista de lotes, derivando os números de hooks já existentes — sem schema/migration/edge nova.

**Architecture:** Uma função pura testável (`calcularKpisDashboard`) recebe `lotes` (banco), `publicados` (banco) e `statusItens` (status ao vivo do ML) e devolve os 5 números. O `Dashboard.tsx` monta os 3 hooks, chama a função e renderiza 5 `KpiCard`. Os 3 cards de banco são instantâneos; os 2 ao vivo (Ativos / Com problema) mostram skeleton no loading e "—" quando o ML está indisponível. A lista de lotes existente é preservada intacta abaixo.

**Tech Stack:** React 18 + TanStack Query (hooks `useLotes`/`usePublicados`/`useStatusPublicados` já existem), shadcn (`KpiCard`, `PageHeader`, `EmptyState` já existem), lucide, vitest. Branch `worktree-redesign-fase4` (sincronizada com `main`).

**Spec:** `docs/superpowers/specs/2026-06-09-redesign-fase5-dashboard-kpis-design.md`.

**Tipos relevantes (já existentes):**
- `Lote` (`src/lib/tipos-dominio.ts`): `{ status: LoteStatus; totalErros: number; ... }` — `LoteStatus` inclui `'revisao'`.
- `PublicadoItem` (`src/lib/publicados.ts`): 1 por anúncio (`usePublicados()` já agrupa por `mlItemId`).
- `StatusPublicadoItem` (`src/lib/queries.ts`): `{ ml_item_id: string; status: StatusPublicado; motivo: string | null; estoque: number | null; preco: number | null }`.
- `ResultadoStatusPublicados` (`src/lib/queries.ts`): `{ itens: StatusPublicadoItem[]; semCredencialML?: boolean }`.
- `StatusPublicado` (`src/lib/publicados.ts`): `'ativo' | 'pausado' | 'encerrado' | 'moderado' | 'inativo' | 'indisponivel'`.

---

## File Structure

- **Create:** `src/lib/dashboard-kpis.ts` — tipo `KpisDashboard` + função pura `calcularKpisDashboard`. Responsabilidade única: derivar os 5 números. Sem React, sem rede.
- **Create:** `tests/lib/dashboard-kpis.test.ts` — testes da função pura (convenção do projeto: testes em `tests/lib/`).
- **Modify:** `src/pages/Dashboard.tsx` — adiciona a faixa de KPIs acima da lista de lotes (que permanece inalterada).

---

## Task 1: Função pura `calcularKpisDashboard` (TDD)

**Files:**
- Create: `src/lib/dashboard-kpis.ts`
- Test: `tests/lib/dashboard-kpis.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/lib/dashboard-kpis.test.ts
import { describe, it, expect } from 'vitest';
import { calcularKpisDashboard } from '@/lib/dashboard-kpis';
import type { Lote } from '@/lib/tipos-dominio';
import type { PublicadoItem } from '@/lib/publicados';
import type { StatusPublicadoItem } from '@/lib/queries';

function lote(over: Partial<Lote>): Lote {
  return {
    id: 'l', numero: 1, criadoEm: '2026-06-09T00:00:00.000Z', status: 'concluido',
    totalFamilias: 0, totalPublicadas: 0, totalErros: 0,
    anomalias: { codigos_duplicados: [], filhos_orfaos: [], familias_sem_filho: [] },
    ...over,
  };
}
function pub(id: string): PublicadoItem {
  return {
    familiaId: id, codigoPai: id, titulo: id, fornecedor: null, tipo: null,
    precoPublicacao: 0, descricao: null, mlItemId: 'MLB' + id, mlPermalink: null, publicadoEm: null,
  };
}
function st(status: StatusPublicadoItem['status']): StatusPublicadoItem {
  return { ml_item_id: 'x', status, motivo: null, estoque: null, preco: null };
}

describe('calcularKpisDashboard', () => {
  it('tudo zero para entradas vazias', () => {
    expect(calcularKpisDashboard([], [], [])).toEqual({
      publicados: 0, ativos: 0, comProblema: 0, erros: 0, aRevisar: 0,
    });
  });

  it('publicados = nº de anúncios (length de publicados)', () => {
    const r = calcularKpisDashboard([], [pub('a'), pub('b'), pub('c')], []);
    expect(r.publicados).toBe(3);
  });

  it('ativos conta apenas status "ativo"', () => {
    const r = calcularKpisDashboard([], [], [st('ativo'), st('ativo'), st('pausado')]);
    expect(r.ativos).toBe(2);
  });

  it('comProblema conta moderado + inativo + pausado', () => {
    const r = calcularKpisDashboard([], [], [st('moderado'), st('inativo'), st('pausado')]);
    expect(r.comProblema).toBe(3);
  });

  it('comProblema NÃO conta ativo, encerrado nem indisponivel', () => {
    const r = calcularKpisDashboard([], [], [st('ativo'), st('encerrado'), st('indisponivel')]);
    expect(r.comProblema).toBe(0);
  });

  it('erros = soma de totalErros dos lotes', () => {
    const r = calcularKpisDashboard([lote({ totalErros: 2 }), lote({ totalErros: 3 })], [], []);
    expect(r.erros).toBe(5);
  });

  it('aRevisar = nº de lotes em status "revisao"', () => {
    const r = calcularKpisDashboard(
      [lote({ status: 'revisao' }), lote({ status: 'concluido' }), lote({ status: 'revisao' })],
      [], [],
    );
    expect(r.aRevisar).toBe(2);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm exec vitest run tests/lib/dashboard-kpis.test.ts`
Expected: FAIL — `Failed to resolve import '@/lib/dashboard-kpis'` (módulo não existe ainda).

- [ ] **Step 3: Implementar o mínimo**

```ts
// src/lib/dashboard-kpis.ts
import type { Lote } from '@/lib/tipos-dominio';
import type { PublicadoItem, StatusPublicado } from '@/lib/publicados';
import type { StatusPublicadoItem } from '@/lib/queries';

export interface KpisDashboard {
  publicados: number;
  ativos: number;
  comProblema: number;
  erros: number;
  aRevisar: number;
}

const STATUS_PROBLEMA: ReadonlySet<StatusPublicado> = new Set<StatusPublicado>([
  'moderado',
  'inativo',
  'pausado',
]);

export function calcularKpisDashboard(
  lotes: Lote[],
  publicados: PublicadoItem[],
  statusItens: StatusPublicadoItem[],
): KpisDashboard {
  return {
    publicados: publicados.length,
    ativos: statusItens.filter((s) => s.status === 'ativo').length,
    comProblema: statusItens.filter((s) => STATUS_PROBLEMA.has(s.status)).length,
    erros: lotes.reduce((acc, l) => acc + l.totalErros, 0),
    aRevisar: lotes.filter((l) => l.status === 'revisao').length,
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm exec vitest run tests/lib/dashboard-kpis.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-kpis.ts tests/lib/dashboard-kpis.test.ts
git commit -m "feat(redesign): calcularKpisDashboard puro + testes (Fase 5, TDD)"
```

---

## Task 2: Dashboard.tsx — faixa de 5 KpiCards

**Files:**
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: Reescrever o Dashboard adicionando os KPIs (lista de lotes preservada)**

Substituir TODO o conteúdo de `src/pages/Dashboard.tsx` por:

```tsx
import { Link } from 'react-router-dom';
import {
  Plus,
  PackageOpen,
  Package,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ClipboardList,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { LoteCard } from '@/components/lote-card';
import { useLotes } from '@/hooks/useLotes';
import { usePublicados } from '@/hooks/usePublicados';
import { useStatusPublicados } from '@/hooks/useStatusPublicados';
import { calcularKpisDashboard } from '@/lib/dashboard-kpis';

export default function Dashboard() {
  const { data: lotes = [], isLoading, error } = useLotes();
  const { data: publicados = [] } = usePublicados();
  const { data: statusData, isLoading: loadingStatus, isError: erroStatus } = useStatusPublicados();

  const statusItens = statusData?.itens ?? [];
  // Cards ao vivo indisponíveis quando a conta ML não está conectada OU a chamada falhou.
  const semStatus = (statusData?.semCredencialML ?? false) || erroStatus;
  const kpis = calcularKpisDashboard(lotes, publicados, statusItens);

  const novoLoteBtn = (
    <Button asChild>
      <Link to="/novo-lote">
        <Plus className="mr-1 h-4 w-4" />
        Novo lote
      </Link>
    </Button>
  );

  return (
    <div className="p-6">
      <PageHeader title="Dashboard" actions={novoLoteBtn} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Anúncios publicados" value={kpis.publicados} icon={Package} />
        <KpiCard
          label="Ativos"
          value={semStatus ? '—' : kpis.ativos}
          icon={CheckCircle2}
          loading={loadingStatus}
          hint={semStatus ? 'ML indisponível' : undefined}
        />
        <KpiCard
          label="Com problema"
          value={semStatus ? '—' : kpis.comProblema}
          icon={AlertTriangle}
          loading={loadingStatus}
          hint={semStatus ? 'ML indisponível' : undefined}
        />
        <KpiCard label="Erros de publicação" value={kpis.erros} icon={XCircle} />
        <KpiCard label="A revisar" value={kpis.aRevisar} icon={ClipboardList} />
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando lotes...</div>
      ) : error ? (
        <div className="text-sm text-destructive">
          Erro ao carregar lotes: {(error as Error).message}
        </div>
      ) : lotes.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title="Nenhum lote ainda"
          description='Faça upload de uma planilha para começar. Clique em "Novo lote".'
          action={novoLoteBtn}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {lotes.map((lote) => (
            <LoteCard key={lote.id} lote={lote} />
          ))}
        </div>
      )}
    </div>
  );
}
```

Notas de comportamento (preservar exatamente):
- A lista de lotes (loading/erro/`EmptyState`/`LoteCard`) é a mesma da Fase 4 — só foi reaproveitado o botão "Novo lote" numa const para reuso no header e no empty.
- `loadingStatus` (primeira carga do ML) → `KpiCard loading` exibe skeleton e ignora `value`/`hint`.
- Sem ML conectado (`semCredencialML`) ou erro na chamada → `semStatus` true → cards ao vivo mostram `—` + hint "ML indisponível". Nunca trava a tela.

- [ ] **Step 2: Verificar (tipos + build + suite)**

Run: `pnpm exec tsc --noEmit` → limpo.
Run: `pnpm exec vitest run tests/lib/dashboard-kpis.test.ts` → PASS.
Run: `pnpm build` → limpo.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Dashboard.tsx
git commit -m "feat(redesign): Dashboard com KPIs (5 KpiCards: publicados/ativos/problema/erros/a revisar)"
```

---

## Task 3: Verificação final + doc

**Files:**
- Modify: `CLAUDE.md` (entrada no histórico)

- [ ] **Step 1: Suite + lint + build completos**

Run: `pnpm test` → todos verdes.
Run: `pnpm exec tsc --noEmit` → limpo.
Run: `pnpm lint` → 0 errors.
Run: `pnpm build` → limpo.

- [ ] **Step 2: Registrar no CLAUDE.md**

Adicionar uma linha no histórico (seção "Histórico deste CLAUDE.md") com data 2026-06-09 resumindo a Fase 5 (Dashboard com KPIs; `calcularKpisDashboard` puro+TDD; 5 cards; cards ao vivo com skeleton/fallback; sem schema/edge nova).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: registra Fase 5 (Dashboard com KPIs) no historico"
```

---

## Self-Review

- **Spec coverage:** 5 KPIs (tabela da spec) → Task 1 (cálculo) + Task 2 (render). ✓ | função pura TDD → Task 1. ✓ | skeleton/fallback ML → Task 2 (`loadingStatus`/`semStatus`). ✓ | lista preservada → Task 2 (bloco idêntico). ✓ | layout grid + PageHeader "Dashboard" → Task 2. ✓ | sem schema/migration/edge → nenhuma task cria. ✓ | YAGNI (sem filtro de período/delta/valor) → não implementados. ✓
- **Placeholder scan:** sem TBD/TODO; todo passo de código tem o código completo. ✓
- **Type consistency:** `calcularKpisDashboard(lotes, publicados, statusItens)` e `KpisDashboard {publicados, ativos, comProblema, erros, aRevisar}` idênticos entre Task 1 (def) e Task 2 (uso). `StatusPublicadoItem`/`StatusPublicado` importados dos caminhos reais. ✓
- **Risco:** `usePublicados`/`useStatusPublicados` precisam estar disponíveis no contexto de teste do `Dashboard` — mas não há teste de render do Dashboard nesta fase (só a função pura é testada), então sem risco de quebra de teste. A verificação visual cobre o render.
