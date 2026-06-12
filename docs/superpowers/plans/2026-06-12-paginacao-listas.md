# Paginação client-side Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paginar (client-side) as listas das telas Dashboard, Revisão e Publicados, com seletor 5/10/20/50 itens por página (padrão 5).

**Architecture:** Função pura `paginar` (lógica + clamp, TDD) → hook `usePaginacao` (estado em memória) → componente `Pagination` (visual, DS) → aplicado nas 3 telas fatiando só a renderização. Zero backend.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, shadcn/ui (radix-ui), Tailwind, lucide-react.

---

## File Structure

- Create `src/lib/paginacao.ts` — função pura `paginar` + tipos.
- Create `tests/lib/paginacao.test.ts` — testes da função pura.
- Create `src/hooks/usePaginacao.ts` — hook de estado.
- Create `tests/hooks/usePaginacao.test.ts` — testes do hook.
- Create `src/components/ui/pagination.tsx` — componente visual.
- Modify `src/pages/Dashboard.tsx` — paginar lotes.
- Modify `src/pages/Publicados.tsx` — paginar itens exibidos + reset por filtro.
- Modify `src/pages/Revisao.tsx` — paginar renderização de `visiveis` + reset por filtro/busca.

---

### Task 1: Função pura `paginar`

**Files:**
- Create: `src/lib/paginacao.ts`
- Test: `tests/lib/paginacao.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/paginacao.test.ts
import { describe, it, expect } from 'vitest';
import { paginar } from '@/lib/paginacao';

describe('paginar', () => {
  const itens = [1, 2, 3, 4, 5, 6, 7]; // 7 itens

  it('recorta a primeira página', () => {
    const r = paginar(itens, 1, 5);
    expect(r.itensPagina).toEqual([1, 2, 3, 4, 5]);
    expect(r.paginaAtual).toBe(1);
    expect(r.totalPaginas).toBe(2);
    expect(r.inicio).toBe(1);
    expect(r.fim).toBe(5);
    expect(r.total).toBe(7);
  });

  it('recorta a última página parcial', () => {
    const r = paginar(itens, 2, 5);
    expect(r.itensPagina).toEqual([6, 7]);
    expect(r.inicio).toBe(6);
    expect(r.fim).toBe(7);
  });

  it('clampa página acima do range para a última', () => {
    const r = paginar(itens, 99, 5);
    expect(r.paginaAtual).toBe(2);
    expect(r.itensPagina).toEqual([6, 7]);
  });

  it('clampa página 0 ou negativa para 1', () => {
    expect(paginar(itens, 0, 5).paginaAtual).toBe(1);
    expect(paginar(itens, -3, 5).paginaAtual).toBe(1);
  });

  it('lista vazia → 1 página, recorte vazio, inicio/fim 0', () => {
    const r = paginar([], 1, 5);
    expect(r.itensPagina).toEqual([]);
    expect(r.totalPaginas).toBe(1);
    expect(r.paginaAtual).toBe(1);
    expect(r.inicio).toBe(0);
    expect(r.fim).toBe(0);
    expect(r.total).toBe(0);
  });

  it('não muta a entrada', () => {
    const orig = [1, 2, 3];
    const copia = [...orig];
    paginar(orig, 1, 2);
    expect(orig).toEqual(copia);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/lib/paginacao.test.ts`
Expected: FAIL — `paginar` não existe / módulo não encontrado.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/paginacao.ts
export interface ResultadoPaginacao<T> {
  itensPagina: T[];
  paginaAtual: number;
  totalPaginas: number;
  inicio: number;
  fim: number;
  total: number;
}

export function paginar<T>(itens: T[], pagina: number, tamanho: number): ResultadoPaginacao<T> {
  const total = itens.length;
  const tam = Math.max(1, Math.floor(tamanho));
  const totalPaginas = Math.max(1, Math.ceil(total / tam));
  const paginaAtual = Math.min(Math.max(1, Math.floor(pagina) || 1), totalPaginas);
  const offset = (paginaAtual - 1) * tam;
  const itensPagina = itens.slice(offset, offset + tam);
  const inicio = total === 0 ? 0 : offset + 1;
  const fim = total === 0 ? 0 : offset + itensPagina.length;
  return { itensPagina, paginaAtual, totalPaginas, inicio, fim, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/lib/paginacao.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/paginacao.ts tests/lib/paginacao.test.ts
git commit -m "feat(paginacao): função pura paginar com clamp (TDD)"
```

---

### Task 2: Hook `usePaginacao`

**Files:**
- Create: `src/hooks/usePaginacao.ts`
- Test: `tests/hooks/usePaginacao.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/hooks/usePaginacao.test.ts
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePaginacao } from '@/hooks/usePaginacao';

describe('usePaginacao', () => {
  const itens = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12

  it('começa na página 1 com tamanho padrão 5', () => {
    const { result } = renderHook(() => usePaginacao(itens));
    expect(result.current.paginaAtual).toBe(1);
    expect(result.current.tamanho).toBe(5);
    expect(result.current.itensPagina).toEqual([1, 2, 3, 4, 5]);
    expect(result.current.totalPaginas).toBe(3);
  });

  it('navega com proxima/anterior/irPara', () => {
    const { result } = renderHook(() => usePaginacao(itens));
    act(() => result.current.proxima());
    expect(result.current.itensPagina).toEqual([6, 7, 8, 9, 10]);
    act(() => result.current.anterior());
    expect(result.current.paginaAtual).toBe(1);
    act(() => result.current.irPara(3));
    expect(result.current.itensPagina).toEqual([11, 12]);
  });

  it('setTamanho volta para a página 1', () => {
    const { result } = renderHook(() => usePaginacao(itens));
    act(() => result.current.irPara(3));
    act(() => result.current.setTamanho(10));
    expect(result.current.paginaAtual).toBe(1);
    expect(result.current.tamanho).toBe(10);
    expect(result.current.itensPagina).toHaveLength(10);
  });

  it('reset volta para a página 1', () => {
    const { result } = renderHook(() => usePaginacao(itens));
    act(() => result.current.irPara(2));
    act(() => result.current.reset());
    expect(result.current.paginaAtual).toBe(1);
  });

  it('respeita tamanhoInicial', () => {
    const { result } = renderHook(() => usePaginacao(itens, { tamanhoInicial: 20 }));
    expect(result.current.tamanho).toBe(20);
    expect(result.current.totalPaginas).toBe(1);
  });

  it('clampa quando a lista encolhe (página fora do range)', () => {
    const { result, rerender } = renderHook(({ data }) => usePaginacao(data), {
      initialProps: { data: itens },
    });
    act(() => result.current.irPara(3));
    expect(result.current.paginaAtual).toBe(3);
    rerender({ data: [1, 2] }); // agora só 1 página
    expect(result.current.paginaAtual).toBe(1);
    expect(result.current.itensPagina).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/hooks/usePaginacao.test.ts`
Expected: FAIL — `usePaginacao` não existe.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/hooks/usePaginacao.ts
import { useCallback, useState } from 'react';
import { paginar, type ResultadoPaginacao } from '@/lib/paginacao';

export interface UsePaginacao<T> extends ResultadoPaginacao<T> {
  tamanho: number;
  irPara: (pagina: number) => void;
  proxima: () => void;
  anterior: () => void;
  setTamanho: (n: number) => void;
  reset: () => void;
}

export function usePaginacao<T>(itens: T[], opts?: { tamanhoInicial?: number }): UsePaginacao<T> {
  const [pagina, setPagina] = useState(1);
  const [tamanho, setTamanhoState] = useState(opts?.tamanhoInicial ?? 5);

  // `paginar` clampa a página; usamos o valor efetivo (paginaAtual) como verdade.
  const r = paginar(itens, pagina, tamanho);

  const irPara = useCallback((p: number) => setPagina(p), []);
  const proxima = useCallback(() => setPagina((p) => p + 1), []);
  const anterior = useCallback(() => setPagina((p) => Math.max(1, p - 1)), []);
  const setTamanho = useCallback((n: number) => {
    setTamanhoState(n);
    setPagina(1);
  }, []);
  const reset = useCallback(() => setPagina(1), []);

  return {
    ...r,
    tamanho,
    irPara,
    proxima,
    anterior,
    setTamanho,
    reset,
  };
}
```

Nota: o teste de encolhimento passa porque `paginar` recalcula a `paginaAtual`
clampada a cada render a partir do `itens` atual; o `proxima` usa `p + 1` sobre o
estado bruto, mas o recorte exibido sempre vem do `paginar` clampado, então o
valor exposto em `paginaAtual` já é o válido. Como `proxima`/`anterior` operam
sobre o estado bruto, no caso de a lista crescer de novo a página volta ao valor
guardado — comportamento aceitável (YAGNI: não sincronizamos o estado bruto).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/hooks/usePaginacao.test.ts`
Expected: PASS (6 testes).

Se o teste de encolhimento falhar porque `proxima()` parte de `pagina` bruto (3)
e não do clampado, ajustar `proxima`/`anterior` para partir do efetivo:

```ts
const proxima = useCallback(() => setPagina(() => r.paginaAtual + 1), [r.paginaAtual]);
const anterior = useCallback(() => setPagina(() => Math.max(1, r.paginaAtual - 1)), [r.paginaAtual]);
```

(usar `r.paginaAtual`, a página efetiva clampada, como base da navegação).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePaginacao.ts tests/hooks/usePaginacao.test.ts
git commit -m "feat(paginacao): hook usePaginacao (estado em memória, TDD)"
```

---

### Task 3: Componente visual `Pagination`

**Files:**
- Create: `src/components/ui/pagination.tsx`

Nenhum teste unitário dedicado (componente presentacional puro; coberto pelo
smoke das telas e pelo build). Segue o padrão dos outros primitivos do DS.

- [ ] **Step 1: Criar o componente**

```tsx
// src/components/ui/pagination.tsx
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface PaginationProps {
  paginaAtual: number;
  totalPaginas: number;
  inicio: number;
  fim: number;
  total: number;
  tamanho: number;
  onIrPara: (pagina: number) => void;
  onTamanho: (n: number) => void;
  rotuloItem?: string;
  tamanhos?: number[];
  className?: string;
}

// Janela de páginas com elipse: primeira, última, atual e vizinhas.
function janelaPaginas(atual: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const paginas: (number | '…')[] = [1];
  const ini = Math.max(2, atual - 1);
  const fim = Math.min(total - 1, atual + 1);
  if (ini > 2) paginas.push('…');
  for (let p = ini; p <= fim; p++) paginas.push(p);
  if (fim < total - 1) paginas.push('…');
  paginas.push(total);
  return paginas;
}

export function Pagination({
  paginaAtual,
  totalPaginas,
  inicio,
  fim,
  total,
  tamanho,
  onIrPara,
  onTamanho,
  rotuloItem = 'item',
  tamanhos = [5, 10, 20, 50],
  className,
}: PaginationProps) {
  const plural = total !== 1 ? 's' : '';
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 py-3 text-sm',
        className,
      )}
    >
      <span className="text-muted-foreground">
        {inicio}–{fim} de {total} {rotuloItem}{plural}
      </span>

      <div className="flex items-center gap-3">
        {totalPaginas > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              onClick={() => onIrPara(paginaAtual - 1)}
              disabled={paginaAtual <= 1}
              aria-label="Página anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {janelaPaginas(paginaAtual, totalPaginas).map((p, i) =>
              p === '…' ? (
                <span key={`e${i}`} className="px-1 text-muted-foreground">…</span>
              ) : (
                <Button
                  key={p}
                  variant={p === paginaAtual ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 min-w-8 px-2"
                  onClick={() => onIrPara(p)}
                  aria-label={`Página ${p}`}
                  aria-current={p === paginaAtual ? 'page' : undefined}
                >
                  {p}
                </Button>
              ),
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              onClick={() => onIrPara(paginaAtual + 1)}
              disabled={paginaAtual >= totalPaginas}
              aria-label="Próxima página"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        <Select value={String(tamanho)} onValueChange={(v) => onTamanho(Number(v))}>
          <SelectTrigger className="h-8 w-[110px] text-sm" aria-label="Itens por página">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tamanhos.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} / página
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `pnpm exec tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/pagination.tsx
git commit -m "feat(paginacao): componente Pagination no design system"
```

---

### Task 4: Aplicar no Dashboard

**Files:**
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: Importar hook e componente**

No topo de `src/pages/Dashboard.tsx`, junto aos outros imports:

```ts
import { usePaginacao } from '@/hooks/usePaginacao';
import { Pagination } from '@/components/ui/pagination';
```

- [ ] **Step 2: Instanciar o hook**

Logo após `const kpis = calcularKpisDashboard(...)` (linha ~29):

```ts
  const pag = usePaginacao(lotes);
```

- [ ] **Step 3: Renderizar página + barra**

Substituir o bloco da lista de cards (atual, linhas ~78-82):

```tsx
        <div className="flex flex-col gap-3">
          {lotes.map((lote) => (
            <LoteCard key={lote.id} lote={lote} />
          ))}
        </div>
```

por:

```tsx
        <div className="flex flex-col gap-3">
          {pag.itensPagina.map((lote) => (
            <LoteCard key={lote.id} lote={lote} />
          ))}
          <Pagination
            rotuloItem="lote"
            paginaAtual={pag.paginaAtual}
            totalPaginas={pag.totalPaginas}
            inicio={pag.inicio}
            fim={pag.fim}
            total={pag.total}
            tamanho={pag.tamanho}
            onIrPara={pag.irPara}
            onTamanho={pag.setTamanho}
          />
        </div>
```

- [ ] **Step 4: Verificar tipos**

Run: `pnpm exec tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Dashboard.tsx
git commit -m "feat(paginacao): paginar lista de lotes no Dashboard"
```

---

### Task 5: Aplicar no Publicados

**Files:**
- Modify: `src/pages/Publicados.tsx`

- [ ] **Step 1: Imports**

Adicionar ao import do React (linha 1) o `useEffect`:

```ts
import { useEffect, useMemo, useState } from 'react';
```

E os novos imports:

```ts
import { usePaginacao } from '@/hooks/usePaginacao';
import { Pagination } from '@/components/ui/pagination';
```

- [ ] **Step 2: Instanciar hook + reset por filtro**

Logo após `const itensExibidos = filtrarPublicados(merged, filtro);` (linha ~254):

```ts
  const pag = usePaginacao(itensExibidos);

  // Mudar qualquer filtro/busca volta para a página 1.
  useEffect(() => {
    pag.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro.busca, filtro.fornecedor, filtro.status, filtro.tipo]);
```

- [ ] **Step 3: Renderizar a página na tabela**

Trocar o `itensExibidos.map(...)` do corpo da tabela (linha ~402) por
`pag.itensPagina.map(...)`. O guard de vazio continua usando `itensExibidos.length`:

```tsx
                {itensExibidos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">
                      Nenhum resultado para os filtros aplicados.
                    </TableCell>
                  </TableRow>
                ) : (
                  pag.itensPagina.map((item) => (
                    <LinhaTabela
                      key={item.familiaId}
                      item={item}
                      onRemover={handleRemover}
                      removendo={removendo && removendoId === item.familiaId}
                    />
                  ))
                )}
```

- [ ] **Step 4: Substituir o rodapé de contagem pela barra**

Trocar o parágrafo atual (linhas ~415-417):

```tsx
          <p className="mt-2 text-xs text-muted-foreground">
            {itensExibidos.length} de {publicados.length} anúncio{publicados.length !== 1 ? 's' : ''}
          </p>
```

por:

```tsx
          <Pagination
            rotuloItem="anúncio"
            className="mt-2"
            paginaAtual={pag.paginaAtual}
            totalPaginas={pag.totalPaginas}
            inicio={pag.inicio}
            fim={pag.fim}
            total={pag.total}
            tamanho={pag.tamanho}
            onIrPara={pag.irPara}
            onTamanho={pag.setTamanho}
          />
```

- [ ] **Step 5: Verificar tipos**

Run: `pnpm exec tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Publicados.tsx
git commit -m "feat(paginacao): paginar tabela de Publicados (reset por filtro)"
```

---

### Task 6: Aplicar na Revisão

**Files:**
- Modify: `src/pages/Revisao.tsx`

- [ ] **Step 1: Imports**

Trocar a linha 1 para incluir `useEffect`:

```ts
import { useEffect, useMemo, useState } from 'react';
```

E adicionar:

```ts
import { usePaginacao } from '@/hooks/usePaginacao';
import { Pagination } from '@/components/ui/pagination';
```

- [ ] **Step 2: Instanciar hook + reset por filtro/busca**

Logo após `const visiveis = useMemo(...)` (linha ~68):

```ts
  const pag = usePaginacao(visiveis);

  // Mudar filtro/busca volta para a página 1. (idsSelecionaveis e counts
  // continuam derivando de `visiveis`/`familias`, lista filtrada inteira.)
  useEffect(() => {
    pag.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro, busca]);
```

- [ ] **Step 3: Renderizar a página em vez de `visiveis`**

Trocar `{visiveis.map((familia) => (` (linha ~328) por
`{pag.itensPagina.map((familia) => (`. O bloco interno (FamiliaRow +
FamiliaExpanded) permanece idêntico. O guard `visiveis.length === 0` (linha ~347)
e o bloco "Selecionar todos" (`visiveis.length > 0`, linha ~313) permanecem
usando `visiveis` (lista filtrada inteira).

- [ ] **Step 4: Adicionar a barra após a lista**

Logo após o fechamento do `{visiveis.length === 0 && (...)}` (linha ~351), ainda
dentro do fragmento, adicionar:

```tsx
            {visiveis.length > 0 && (
              <div className="px-4">
                <Pagination
                  rotuloItem="família"
                  paginaAtual={pag.paginaAtual}
                  totalPaginas={pag.totalPaginas}
                  inicio={pag.inicio}
                  fim={pag.fim}
                  total={pag.total}
                  tamanho={pag.tamanho}
                  onIrPara={pag.irPara}
                  onTamanho={pag.setTamanho}
                />
              </div>
            )}
```

- [ ] **Step 5: Verificar tipos**

Run: `pnpm exec tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Revisao.tsx
git commit -m "feat(paginacao): paginar renderização das famílias na Revisão"
```

---

### Task 7: Verificação final

- [ ] **Step 1: Suíte completa**

Run: `pnpm test`
Expected: todos verdes (incluindo os ~12 novos de paginação).

- [ ] **Step 2: Tipos**

Run: `pnpm exec tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: 0 errors.

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: sucesso.

- [ ] **Step 5: Commit final (se houver ajustes pendentes)**

```bash
git add -A
git commit -m "chore(paginacao): verificação final (test/tsc/lint/build verdes)"
```

---

## Self-Review

- **Spec coverage:** `paginar` (Task 1) ✓, `usePaginacao` (Task 2) ✓, `Pagination`
  (Task 3) ✓, Dashboard (Task 4) ✓, Publicados (Task 5) ✓, Revisão (Task 6) ✓,
  reset por filtro/busca ✓ (Tasks 5/6), seletor 5/10/20/50 ✓ (Task 3), "Selecionar
  todos" sobre lista inteira ✓ (Task 6 mantém `visiveis`).
- **Scroll ao topo:** o spec menciona scroll-to-top ao trocar de página. Em
  Revisão a lista rola no contêiner `overflow-auto` e em Dashboard/Publicados a
  página rola no `window`. Implementação opcional via `onIrPara` que também faz
  `window.scrollTo({ top: 0 })` — **deixado de fora do código das tasks por YAGNI**;
  se o operador reclamar de ficar no meio da lista, adicionar um wrapper no
  `onIrPara`. (Decisão consciente para não acoplar scroll ao componente.)
- **Type consistency:** `ResultadoPaginacao`/`UsePaginacao`/`PaginationProps`
  consistentes entre tasks; `setTamanho` (hook) ligado a `onTamanho` (componente).
- **Placeholder scan:** sem TBD/TODO; todo código completo.
