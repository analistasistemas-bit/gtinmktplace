# Paginação de Perguntas e Mensagens (Faturamento) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar as listas soltas (sem paginação, sem filtro, tudo numa página só) das abas Perguntas e Mensagens de Faturamento pelo mesmo padrão já usado em Movimentos de estoque: abas de status + `<Pagination>` + wrapper visual com cabeçalho.

**Architecture:** Perguntas ganha uma busca paginada server-side (`fetchPerguntasPagina`, mesmo padrão `.range()` + `count: 'exact'` de `fetchMovimentosEstoque`). Mensagens mantém a busca atual (`buscarConversas()`, até 1000 mensagens já agrupadas por `pack_id`) e pagina no cliente sobre o array agrupado — paginar no banco exigiria uma view/RPC nova, fora de proporção aqui (débito técnico registrado na spec). As duas abas ganham abas de status (Pendentes/Respondidas/Todas e Aguardando/Todas) que substituem a ordenação implícita "pendente primeiro", e o rodapé `<Pagination>` já existente no projeto.

**Tech Stack:** React 18, TanStack Query v5, Supabase JS (PostgREST), Vitest + Testing Library, Tailwind, shadcn/ui (Tabs, Pagination já existentes).

**Spec:** `docs/superpowers/specs/2026-08-08-paginacao-perguntas-mensagens-design.md`

## Global Constraints

- **Só leitura nova.** Nenhuma task escreve em `ml_perguntas`/`ml_mensagens`; `responderPergunta`/`responderMensagem`/`sugerirResposta*` continuam como estão.
- **Sem migration.** Leitura paginada de `ml_perguntas` não precisa de índice novo além do que RLS por usuário já usa.
- **Exportar (Perguntas) sempre usa a lista inteira filtrada pela aba ativa**, nunca só a página visível (D-6 da spec).
- **Trocar de aba de status ou de tamanho de página sempre reseta para a página 1.**
- **`CardPergunta` e `CardConversa` não mudam** — só a lista ao redor deles muda.
- Comentários e textos de UI em português; comentário explica o *porquê*, não o *o quê* (estilo do arquivo vizinho).
- Rodar `pnpm lint` e `pnpm test` antes de cada commit.

---

### Task 1: Camada de dados — busca paginada de Perguntas

**Files:**
- Modify: `src/lib/perguntas.ts`
- Test: `src/lib/__tests__/perguntas.test.ts` (criar)

**Interfaces:**
- Consumes: `Pergunta`, `nomesPorComprador` (privada, já existe no arquivo).
- Produces:
  - `type FiltroStatusPergunta = 'pendentes' | 'respondidas' | 'todas'`
  - `interface FiltroPerguntas { status?: FiltroStatusPergunta }`
  - `interface PaginaPerguntas { itens: Pergunta[]; total: number }`
  - `function pergCasaStatus(status: string, filtro: FiltroStatusPergunta): boolean`
  - `function fetchPerguntasPagina(pagina?: number, tamanho?: number, filtro?: FiltroPerguntas): Promise<PaginaPerguntas>`

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/lib/__tests__/perguntas.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchPerguntasPagina, pergCasaStatus } from '@/lib/perguntas';
import { supabase } from '@/lib/supabase';

// Duas tabelas envolvidas: ml_perguntas (busca paginada) e ml_vendas (nome civil do comprador,
// via nomesPorComprador). Cada uma tem sua própria cadeia fluente espiada — mesmo padrão do
// mock em tests/lib/movimentos-estoque.test.ts.
const chamadas: Record<string, unknown[][]> = {};
function registrar(nome: string, args: unknown[]) {
  (chamadas[nome] ??= []).push(args);
}

const respostaPerguntas: { data: unknown[]; error: { message: string } | null; count: number } = {
  data: [], error: null, count: 0,
};
const cadeiaPerguntas: Record<string, unknown> = {};
for (const m of ['select', 'eq', 'neq', 'order', 'range']) {
  cadeiaPerguntas[m] = vi.fn((...args: unknown[]) => { registrar(m, args); return cadeiaPerguntas; });
}
cadeiaPerguntas.then = (resolve: (v: typeof respostaPerguntas) => unknown) =>
  Promise.resolve(respostaPerguntas).then(resolve);

const respostaVendas: { data: { comprador_id: number; comprador_nome: string }[] } = { data: [] };
const cadeiaVendas: Record<string, unknown> = {};
for (const m of ['select', 'in', 'not']) {
  cadeiaVendas[m] = vi.fn((...args: unknown[]) => { registrar(`vendas.${m}`, args); return cadeiaVendas; });
}
cadeiaVendas.then = (resolve: (v: typeof respostaVendas) => unknown) =>
  Promise.resolve(respostaVendas).then(resolve);

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((tabela: string) => (tabela === 'ml_vendas' ? cadeiaVendas : cadeiaPerguntas)),
  },
}));

function pergunta(i: number, over: Partial<{ status: string; comprador_id: number | null }> = {}) {
  return {
    id: `p${i}`, question_id: i, item_id: 'MLB1', item_titulo: 'Produto',
    comprador_id: i, comprador_nick: `nick${i}`, texto: `pergunta ${i}`,
    status: 'UNANSWERED', resposta: null, respondida_em: null,
    criada_em: new Date(Date.UTC(2026, 7, 8, 12, 0, 0) - i * 60_000).toISOString(),
    ...over,
  };
}

describe('lib/perguntas — fetchPerguntasPagina', () => {
  beforeEach(() => {
    for (const k of Object.keys(chamadas)) delete chamadas[k];
    respostaPerguntas.count = 0;
    respostaPerguntas.data = [];
    respostaPerguntas.error = null;
    respostaVendas.data = [];
  });

  it('pede o range da página pedida e devolve o total', async () => {
    respostaPerguntas.count = 47;
    const r = await fetchPerguntasPagina(3, 20);
    expect(chamadas.range).toEqual([[40, 59]]);
    expect(r.total).toBe(47);
  });

  it('sem filtro de status não recorta a query', async () => {
    await fetchPerguntasPagina(1, 20);
    expect(chamadas.eq).toBeUndefined();
    expect(chamadas.neq).toBeUndefined();
  });

  it('filtro "pendentes" manda status = UNANSWERED', async () => {
    await fetchPerguntasPagina(1, 20, { status: 'pendentes' });
    expect(chamadas.eq).toEqual([['status', 'UNANSWERED']]);
  });

  it('filtro "respondidas" manda status <> UNANSWERED', async () => {
    await fetchPerguntasPagina(1, 20, { status: 'respondidas' });
    expect(chamadas.neq).toEqual([['status', 'UNANSWERED']]);
  });

  it('filtro "todas" não recorta a query', async () => {
    await fetchPerguntasPagina(1, 20, { status: 'todas' });
    expect(chamadas.eq).toBeUndefined();
    expect(chamadas.neq).toBeUndefined();
  });

  it('ordena por criada_em decrescente', async () => {
    await fetchPerguntasPagina(1, 20);
    expect(chamadas.order).toEqual([['criada_em', { ascending: false }]]);
  });

  it('página zero ou negativa cai na primeira, sem offset negativo', async () => {
    await fetchPerguntasPagina(0, 20);
    expect(chamadas.range).toEqual([[0, 19]]);
  });

  it('propaga o erro do banco em vez de devolver lista vazia', async () => {
    respostaPerguntas.error = { message: 'boom' };
    await expect(fetchPerguntasPagina(1, 20)).rejects.toThrow('boom');
  });

  it('resolve o nome civil só para os compradores da página', async () => {
    respostaPerguntas.data = [pergunta(1, { comprador_id: 10 }), pergunta(2, { comprador_id: 20 })];
    respostaPerguntas.count = 2;
    respostaVendas.data = [{ comprador_id: 10, comprador_nome: 'Maria Silva' }];

    const r = await fetchPerguntasPagina(1, 20);
    expect(chamadas['vendas.in']).toEqual([['comprador_id', [10, 20]]]);
    expect(r.itens.find((p) => p.comprador_id === 10)?.comprador_nome).toBe('Maria Silva');
    expect(r.itens.find((p) => p.comprador_id === 20)?.comprador_nome).toBeNull();
  });

  it('usa o cliente supabase do projeto na tabela certa', async () => {
    await fetchPerguntasPagina(1, 20);
    expect(supabase.from).toHaveBeenCalledWith('ml_perguntas');
  });
});

describe('lib/perguntas — pergCasaStatus', () => {
  it('pendentes só casa com UNANSWERED', () => {
    expect(pergCasaStatus('UNANSWERED', 'pendentes')).toBe(true);
    expect(pergCasaStatus('ANSWERED', 'pendentes')).toBe(false);
  });

  it('respondidas casa com qualquer status diferente de UNANSWERED', () => {
    expect(pergCasaStatus('ANSWERED', 'respondidas')).toBe(true);
    expect(pergCasaStatus('CLOSED_UNANSWERED', 'respondidas')).toBe(true);
    expect(pergCasaStatus('UNANSWERED', 'respondidas')).toBe(false);
  });

  it('todas casa com qualquer status', () => {
    expect(pergCasaStatus('UNANSWERED', 'todas')).toBe(true);
    expect(pergCasaStatus('ANSWERED', 'todas')).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run src/lib/__tests__/perguntas.test.ts`
Expected: FAIL — `fetchPerguntasPagina is not a function`.

- [ ] **Step 3: Implementar**

Em `src/lib/perguntas.ts`, logo depois da função `buscarPerguntas` (mantém como está — segue usada pela Exportar), acrescentar:

```ts
export type FiltroStatusPergunta = 'pendentes' | 'respondidas' | 'todas';

export interface FiltroPerguntas {
  status?: FiltroStatusPergunta;
}

export interface PaginaPerguntas {
  itens: Pergunta[];
  total: number;
}

/** Mesmo recorte do filtro server-side, mas em memória — usado por Exportar, que sempre lê a
 *  lista inteira via buscarPerguntas(), independente da página/aba aberta na tela. */
export function pergCasaStatus(status: string, filtro: FiltroStatusPergunta): boolean {
  if (filtro === 'pendentes') return status === 'UNANSWERED';
  if (filtro === 'respondidas') return status !== 'UNANSWERED';
  return true;
}

const COLUNAS_PERGUNTA =
  'id, question_id, item_id, item_titulo, comprador_id, comprador_nick, texto, status, resposta, respondida_em, criada_em';

/** Uma página de perguntas. A separação por status virou aba (ver AbaPerguntas) — aqui a ordem é
 *  sempre por data, mais recente primeiro. RLS por user. */
export async function fetchPerguntasPagina(
  pagina = 1,
  tamanho = 20,
  filtro: FiltroPerguntas = {},
): Promise<PaginaPerguntas> {
  const de = (Math.max(1, Math.floor(pagina) || 1) - 1) * tamanho;
  let q = supabase.from('ml_perguntas').select(COLUNAS_PERGUNTA, { count: 'exact' });
  if (filtro.status === 'pendentes') q = q.eq('status', 'UNANSWERED');
  else if (filtro.status === 'respondidas') q = q.neq('status', 'UNANSWERED');

  const { data, error, count } = await q
    .order('criada_em', { ascending: false })
    .range(de, de + tamanho - 1);
  if (error) throw new Error(error.message);

  const lista = (data ?? []) as Pergunta[];
  const nomes = await nomesPorComprador(
    [...new Set(lista.map((p) => p.comprador_id).filter((i): i is number => i != null))],
  );
  const itens = lista.map((p) => ({
    ...p,
    comprador_nome: (p.comprador_id != null ? nomes.get(p.comprador_id) : null) ?? null,
  }));
  return { itens, total: count ?? 0 };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run src/lib/__tests__/perguntas.test.ts`
Expected: PASS (13 testes).

- [ ] **Step 5: Commit**

```bash
pnpm lint && pnpm vitest run src/lib/__tests__/perguntas.test.ts
git add src/lib/perguntas.ts src/lib/__tests__/perguntas.test.ts
git commit -m "feat(faturamento): busca paginada de perguntas com filtro de status"
```

---

### Task 2: Aba Perguntas — abas de status + paginação

**Files:**
- Modify: `src/lib/queries.ts` (chave de query)
- Modify: `src/components/faturamento/aba-perguntas.tsx`
- Test: `src/components/faturamento/__tests__/aba-perguntas.test.tsx` (reescrever)

**Interfaces:**
- Consumes: `fetchPerguntasPagina`, `buscarPerguntas`, `pergCasaStatus`, `FiltroStatusPergunta`, `PaginaPerguntas` (Task 1); `<Pagination>`, `<Tabs>`/`<TabsList>`/`<TabsTrigger>` (já existentes); `BotaoExportar`, `buildPerguntasReport` (já existentes).
- Produces: `AbaPerguntas()` — assinatura não muda (sem props).

- [ ] **Step 1: Chave de query**

Em `src/lib/queries.ts`, dentro do objeto `QK`, acrescentar (perto de `movimentosEstoquePagina`):

```ts
  /** Página concreta de perguntas. `['perguntas']` sozinho (usado em invalidateQueries) já é
   *  prefixo desta chave — invalidar o prefixo alcança todas as páginas/abas. */
  perguntasPagina: (
    pagina: number, tamanho: number, filtro: unknown,
  ) => ['perguntas', pagina, tamanho, filtro] as const,
```

- [ ] **Step 2: Escrever os testes que falham**

Substituir `src/components/faturamento/__tests__/aba-perguntas.test.tsx` por:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AbaPerguntas } from '../aba-perguntas';
import type { Pergunta, PaginaPerguntas } from '@/lib/perguntas';

const fetchMock = vi.fn();
const exportarMock = vi.fn();
const montarReportSpy = vi.fn();

vi.mock('@/lib/perguntas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/perguntas')>();
  return {
    ...actual,
    fetchPerguntasPagina: (...args: Parameters<typeof actual.fetchPerguntasPagina>) => fetchMock(...args),
    buscarPerguntas: () => exportarMock(),
  };
});

vi.mock('@/components/export/botao-exportar', () => ({
  BotaoExportar: (props: { montarReport: () => Promise<unknown> }) => {
    montarReportSpy(props.montarReport);
    return null;
  },
}));

const base = {
  item_id: 'MLB123', item_titulo: 'Produto X', texto: 'Tem estoque?', status: 'ANSWERED',
  resposta: 'Temos.', respondida_em: null, criada_em: '2026-07-10T10:00:00Z',
};

const PERGUNTAS: Pergunta[] = [
  { id: 'q-1', question_id: 1, comprador_id: 10, comprador_nick: 'MARIA_01', comprador_nome: null, ...base },
  { id: 'q-2', question_id: 2, comprador_id: 20, comprador_nick: 'OLCA4176283', comprador_nome: 'CARLA FABIANA DE OLIVEIRA PINTO', ...base },
];

function pagina(itens: Pergunta[], total: number): PaginaPerguntas {
  return { itens, total };
}

function renderAba() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><AbaPerguntas /></QueryClientProvider>);
}

describe('AbaPerguntas', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    exportarMock.mockReset();
    montarReportSpy.mockReset();
    fetchMock.mockResolvedValue(pagina(PERGUNTAS, 2));
  });

  it('abre na aba Pendentes, página 1', async () => {
    renderAba();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [pag, tam, filtro] = fetchMock.mock.calls[0];
    expect(pag).toBe(1);
    expect(tam).toBe(20);
    expect(filtro).toEqual({ status: 'pendentes' });
  });

  it('aponta o atalho para as perguntas no ML, não para o anúncio', async () => {
    renderAba();
    expect((await screen.findAllByRole('link', { name: 'Abrir perguntas no Mercado Livre' }))[0])
      .toHaveAttribute('href', 'https://www.mercadolivre.com.br/perguntas/vendedor');
  });

  it('prefere o nome civil ao apelido do ML, como na aba Vendas', async () => {
    renderAba();
    expect(await screen.findByText('· Carla Fabiana')).toBeInTheDocument();
    expect(screen.queryByText('· OLCA4176283')).not.toBeInTheDocument();
  });

  it('cai no apelido quando o comprador nunca comprou', async () => {
    renderAba();
    expect(await screen.findByText('· MARIA_01')).toBeInTheDocument();
  });

  it('navegar de página e trocar de aba refazem a busca e voltam para a página 1', async () => {
    fetchMock.mockResolvedValue(pagina(Array.from({ length: 20 }, (_, i) => PERGUNTAS[i % 2]), 47));
    renderAba();
    await screen.findByText(/de 47 perguntas/i);

    await userEvent.click(screen.getByRole('button', { name: 'Página 3' }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)![0]).toBe(3));

    await userEvent.click(screen.getByRole('tab', { name: 'Respondidas' }));
    await waitFor(() => {
      const [pag, , filtro] = fetchMock.mock.calls.at(-1)!;
      expect(pag).toBe(1);
      expect(filtro).toEqual({ status: 'respondidas' });
    });
  });

  it('mostra o total no rodapé de paginação', async () => {
    fetchMock.mockResolvedValue(pagina(PERGUNTAS, 47));
    renderAba();
    expect(await screen.findByText(/de 47 perguntas/i)).toBeInTheDocument();
  });

  it('aba sem resultado mostra o vazio específico da aba, não o genérico', async () => {
    fetchMock.mockResolvedValue(pagina([], 0));
    renderAba();
    expect(await screen.findByText('Nenhuma pergunta pendente.')).toBeInTheDocument();
  });

  it('exportar puxa a lista inteira filtrada pela aba ativa, não só a página visível', async () => {
    exportarMock.mockResolvedValue(PERGUNTAS); // as duas são ANSWERED
    renderAba();
    await waitFor(() => expect(montarReportSpy).toHaveBeenCalled());

    const montarReport = montarReportSpy.mock.calls.at(-1)![0];
    const report = (await montarReport()) as { linhas: unknown[] };
    // Aba padrão é Pendentes; as duas perguntas mockadas são ANSWERED → relatório vem vazio.
    expect(report.linhas).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `pnpm vitest run src/components/faturamento/__tests__/aba-perguntas.test.tsx`
Expected: FAIL — componente ainda usa `useListaPerguntas`, sem abas nem `QK.perguntasPagina`.

- [ ] **Step 4: Implementar**

Em `src/components/faturamento/aba-perguntas.tsx`, trocar os imports do topo e a função `AbaPerguntas` (o resto do arquivo — `CardPergunta` — **não muda**):

```tsx
import { useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Sparkles, Send, MessageCircleQuestion, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QK } from '@/lib/queries';
import {
  fetchPerguntasPagina, buscarPerguntas, pergCasaStatus, responderPergunta, sugerirResposta,
  type Pergunta, type FiltroStatusPergunta,
} from '@/lib/perguntas';
import { fmtDataCurta, URL_PERGUNTAS_ML } from '@/lib/ml-status';
import { nomeCurtoComprador } from '@/lib/pedidos-faturamento';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/ui/status-pill';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pagination } from '@/components/ui/pagination';
import { BotaoExportar } from '@/components/export/botao-exportar';
import { buildPerguntasReport } from '@/lib/export/adapters';
import { toast } from 'sonner';
```

```tsx
const ABAS_STATUS: { valor: FiltroStatusPergunta; rotulo: string }[] = [
  { valor: 'pendentes', rotulo: 'Pendentes' },
  { valor: 'respondidas', rotulo: 'Respondidas' },
  { valor: 'todas', rotulo: 'Todas' },
];

export function AbaPerguntas() {
  const [pagina, setPagina] = useState(1);
  const [tamanho, setTamanho] = useState(20);
  const [statusFiltro, setStatusFiltro] = useState<FiltroStatusPergunta>('pendentes');

  const { data, isFetching } = useQuery({
    queryKey: QK.perguntasPagina(pagina, tamanho, { status: statusFiltro }),
    queryFn: () => fetchPerguntasPagina(pagina, tamanho, { status: statusFiltro }),
    staleTime: 60_000,
    // Pergunta respondida direto no ML chega por webhook em segundos; sem polling a tela aberta
    // continuaria mostrando "Pendente" até o operador trocar de aba. Só roda com a aba em foco.
    refetchInterval: 60_000,
    // Mantém a página anterior enquanto a próxima carrega: sem isso a lista pisca em branco a
    // cada troca de aba/página.
    placeholderData: keepPreviousData,
  });

  const itens = data?.itens ?? [];
  const total = data?.total ?? 0;
  const inicio = total === 0 ? 0 : (pagina - 1) * tamanho + 1;

  function mudarAba(v: string) {
    setStatusFiltro(v as FiltroStatusPergunta);
    setPagina(1);
  }

  // Exportar sempre lê a lista inteira, filtrada pela aba ativa — não só a página visível
  // (a tela mostra 20 por vez, o relatório é "os dados desta aba", não "esta tela").
  async function montarReport() {
    const todas = await buscarPerguntas();
    return buildPerguntasReport(todas.filter((p) => pergCasaStatus(p.status, statusFiltro)));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={statusFiltro} onValueChange={mudarAba}>
          <TabsList>
            {ABAS_STATUS.map((a) => (
              <TabsTrigger key={a.valor} value={a.valor}>{a.rotulo}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {total > 0 && <BotaoExportar montarReport={montarReport} />}
      </div>

      {isFetching && itens.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : itens.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
          <MessageCircleQuestion className="h-6 w-6" />
          {statusFiltro === 'todas'
            ? 'Nenhuma pergunta. Use "Sincronizar" na aba Vendas para importar do Mercado Livre.'
            : statusFiltro === 'pendentes' ? 'Nenhuma pergunta pendente.' : 'Nenhuma pergunta respondida.'}
        </div>
      ) : (
        <div className="space-y-3">
          {itens.map((p) => <CardPergunta key={p.id} p={p} />)}
        </div>
      )}

      {total > 0 && (
        <Pagination
          paginaAtual={pagina}
          totalPaginas={Math.max(1, Math.ceil(total / tamanho))}
          inicio={inicio}
          fim={inicio === 0 ? 0 : inicio + itens.length - 1}
          total={total}
          tamanho={tamanho}
          onIrPara={setPagina}
          onTamanho={(n) => { setTamanho(n); setPagina(1); }}
          rotuloItem="pergunta"
        />
      )}
    </div>
  );
}
```

Nota: `CardPergunta` continua usando `useQueryClient` e `qc.invalidateQueries({ queryKey: ['perguntas'] })` como já fazia — isso invalida `QK.perguntasPagina(...)` também, porque `['perguntas']` é prefixo de `['perguntas', pagina, tamanho, filtro]`. Nada muda ali.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm vitest run src/components/faturamento/__tests__/aba-perguntas.test.tsx`
Expected: PASS (8 testes).

- [ ] **Step 6: Commit**

```bash
pnpm lint && pnpm vitest run src/components/faturamento/__tests__/aba-perguntas.test.tsx
git add src/lib/queries.ts src/components/faturamento/aba-perguntas.tsx src/components/faturamento/__tests__/aba-perguntas.test.tsx
git commit -m "feat(faturamento): abas de status e paginação em Perguntas"
```

---

### Task 3: Aba Mensagens — abas de status + paginação no cliente

**Files:**
- Modify: `src/components/faturamento/aba-mensagens.tsx`
- Test: `src/components/faturamento/__tests__/aba-mensagens.test.tsx` (reescrever)

**Interfaces:**
- Consumes: `useListaMensagens` (inalterado); `<Pagination>`, `<Tabs>`/`<TabsList>`/`<TabsTrigger>` (já existentes).
- Produces: `AbaMensagens()` — assinatura não muda.

- [ ] **Step 1: Escrever os testes que falham**

Substituir `src/components/faturamento/__tests__/aba-mensagens.test.tsx` por:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AbaMensagens } from '../aba-mensagens';

vi.mock('@/hooks/useMensagens', () => ({
  useListaMensagens: () => ({
    data: [{
      pack_id: 'pack-1', order_id: 'order-1', item_titulo: 'Produto X', item_id: 'MLB123', comprador_nome: null,
      comprador_nick: 'MARIA_01', order_status: 'cancelled', aguardando: false, ultima: '2026-07-10T10:00:00Z',
      mensagens: [{
        id: 'message-1', pack_id: 'pack-1', order_id: 'order-1', message_id: 'm1', direcao: 'recebida', texto: 'Olá',
        item_titulo: 'Produto X', item_id: 'MLB123', comprador_nome: null, comprador_nick: 'MARIA_01',
        order_status: 'cancelled', data_ml: '2026-07-10T10:00:00Z',
      }],
    }],
    isFetching: false,
  }),
}));

function renderAba() {
  render(<QueryClientProvider client={new QueryClient()}><AbaMensagens /></QueryClientProvider>);
}

describe('AbaMensagens', () => {
  it('abre na aba Aguardando; a conversa cancelada (não aguardando) fica fora até trocar para Todas', async () => {
    renderAba();
    expect(screen.getByText('Nenhuma conversa aguardando resposta.')).toBeInTheDocument();
    expect(screen.queryByText(/MARIA_01/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Todas' }));

    expect(screen.getByText(/MARIA_01/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir anúncio no Mercado Livre' }))
      .toHaveAttribute('href', 'https://produto.mercadolivre.com.br/MLB-123');
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: /sugerir resposta/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /responder/i })).toBeDisabled();
    expect(screen.getByText('Pedido cancelado')).toBeInTheDocument();
  });

  it('mostra o total no rodapé de paginação', async () => {
    renderAba();
    await userEvent.click(screen.getByRole('tab', { name: 'Todas' }));
    expect(screen.getByText(/de 1 conversa/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run src/components/faturamento/__tests__/aba-mensagens.test.tsx`
Expected: FAIL — sem abas de status, a conversa aparece direto (lista solta atual).

- [ ] **Step 3: Implementar**

Em `src/components/faturamento/aba-mensagens.tsx`, trocar os imports do topo e a função `AbaMensagens` (o resto do arquivo — `CardConversa` — **não muda**):

```tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles, Send, MessagesSquare, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useListaMensagens } from '@/hooks/useMensagens';
import { responderMensagem, sugerirRespostaMensagem, type Conversa } from '@/lib/mensagens';
import { fmtDataCurta, urlAnuncioML } from '@/lib/ml-status';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/ui/status-pill';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pagination } from '@/components/ui/pagination';
import { toast } from 'sonner';
```

```tsx
type FiltroStatusMensagem = 'aguardando' | 'todas';

const ABAS_STATUS: { valor: FiltroStatusMensagem; rotulo: string }[] = [
  { valor: 'aguardando', rotulo: 'Aguardando' },
  { valor: 'todas', rotulo: 'Todas' },
];

export function AbaMensagens() {
  const { data: conversas, isFetching } = useListaMensagens();
  const lista = conversas ?? [];

  const [pagina, setPagina] = useState(1);
  const [tamanho, setTamanho] = useState(20);
  const [statusFiltro, setStatusFiltro] = useState<FiltroStatusMensagem>('aguardando');

  if (!isFetching && lista.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
        <MessagesSquare className="h-6 w-6" />
        Nenhuma mensagem pós-venda. Use "Sincronizar" na aba Vendas para importar do Mercado Livre.
      </div>
    );
  }

  // Paginado no cliente: conversa é um agrupamento por pack_id feito aqui, não uma linha de
  // tabela — paginar isso no banco exigiria uma view/RPC nova (fora de escopo, ver spec D-2).
  const filtradas = statusFiltro === 'aguardando' ? lista.filter((c) => c.aguardando) : lista;
  const total = filtradas.length;
  const inicio = total === 0 ? 0 : (pagina - 1) * tamanho + 1;
  const offset = (pagina - 1) * tamanho;
  const itens = filtradas.slice(offset, offset + tamanho);

  function mudarAba(v: string) {
    setStatusFiltro(v as FiltroStatusMensagem);
    setPagina(1);
  }

  return (
    <div className="space-y-3">
      <Tabs value={statusFiltro} onValueChange={mudarAba}>
        <TabsList>
          {ABAS_STATUS.map((a) => (
            <TabsTrigger key={a.valor} value={a.valor}>{a.rotulo}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isFetching && lista.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : itens.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
          <MessagesSquare className="h-6 w-6" />
          {statusFiltro === 'aguardando' ? 'Nenhuma conversa aguardando resposta.' : 'Nenhuma conversa nesta página.'}
        </div>
      ) : (
        <div className="space-y-3">
          {itens.map((c) => <CardConversa key={c.pack_id} c={c} />)}
        </div>
      )}

      {total > 0 && (
        <Pagination
          paginaAtual={pagina}
          totalPaginas={Math.max(1, Math.ceil(total / tamanho))}
          inicio={inicio}
          fim={inicio === 0 ? 0 : inicio + itens.length - 1}
          total={total}
          tamanho={tamanho}
          onIrPara={setPagina}
          onTamanho={(n) => { setTamanho(n); setPagina(1); }}
          rotuloItem="conversa"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run src/components/faturamento/__tests__/aba-mensagens.test.tsx`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
pnpm lint && pnpm vitest run src/components/faturamento/__tests__/aba-mensagens.test.tsx
git add src/components/faturamento/aba-mensagens.tsx src/components/faturamento/__tests__/aba-mensagens.test.tsx
git commit -m "feat(faturamento): abas de status e paginação em Mensagens"
```

---

### Task 4: Validação completa e documentação

**Files:**
- Modify: `docs/TASKS.md`

**Interfaces:**
- Consumes: nada novo — integra o que as Tasks 1–3 produziram.
- Produces: nada — é a validação final.

- [ ] **Step 1: Suíte inteira**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: 0 erros de lint, suíte inteira verde, build ok.

- [ ] **Step 2: Validação visual**

Invocar a skill `playwright-cli`. Na worktree, copiar `.env.local` da raiz do projeto (sem ele a app abre em branco — regra do CLAUDE.md do projeto), subir `pnpm dev`, logar com `VALIDATION_EMAIL`/`VALIDATION_PASSWORD` (já em `.env.local`, conta dedicada a QA — sessão só leitura).

Abrir Faturamento → aba Perguntas, depois aba Mensagens, e conferir:

1. As duas abas mostram o novo cabeçalho com abas de status (Pendentes/Respondidas/Todas e Aguardando/Todas), no mesmo estilo visual do card de Movimentos de estoque.
2. Sem erro no console (`read_console_messages`).
3. Sem overflow horizontal em 1440px e 768px (`document.documentElement.scrollWidth <= window.innerWidth` nas duas larguras).
4. Trocar de aba de status não quebra a tela (a conta de validação não tem produtos do Diego — é esperado ver o estado vazio específico da aba, ex. "Nenhuma pergunta pendente."; a paginação com dado real já está coberta pelos testes automatizados das Tasks 1–3).

Screenshot de cada aba (Perguntas e Mensagens) em 1440px.

- [ ] **Step 3: Atualizar TASKS.md**

Em `docs/TASKS.md`, acrescentar uma entrada nova:

```markdown
- [x] **Faturamento — paginação de Perguntas e Mensagens** — as duas abas despejavam a lista
  inteira numa página só, sem divisão (spec `2026-08-08-paginacao-perguntas-mensagens-design.md`).
  Perguntas ganhou busca paginada server-side (mesmo padrão de Movimentos de estoque); Mensagens
  pagina no cliente sobre as conversas já agrupadas (db-side fica para quando o volume pedir —
  exigiria view/RPC nova). As duas ganharam abas de status (Pendentes/Respondidas/Todas e
  Aguardando/Todas) no lugar da ordenação implícita "pendente primeiro", que não sobrevive a
  paginação sem virar filtro explícito.
```

`obsidian-vault/`: conferido — mudança é só de UI/organização de tela já existente, sem impacto arquitetural, funcional novo ou decisão de domínio; não precisa de atualização.

- [ ] **Step 4: Commit**

```bash
git add docs/TASKS.md
git commit -m "docs: paginação de Perguntas e Mensagens em Faturamento"
```

---

## Self-Review

**Cobertura da spec:**

| Decisão | Task |
|---|---|
| D-1 Perguntas server-side | 1 (`fetchPerguntasPagina`) |
| D-2 Mensagens client-side + débito registrado | 3 (`.slice()` sobre `filtradas`) |
| D-3 abas de status substituem ordenação implícita | 2, 3 (`ABAS_STATUS`) |
| D-4 pendentes/aguardando = mesma regra de hoje | 1 (`pergCasaStatus`), 3 (`c.aguardando`) |
| D-5 troca de aba/página reseta para página 1 | 2, 3 (`mudarAba`) |
| D-6 exportar usa lista inteira filtrada pela aba | 2 (`montarReport`) |
| D-7 wrapper visual igual ao estoque | 2, 3 (`<Tabs>` + `<Pagination>` + cabeçalho) |
| D-8 estado local (`useState`) | 2, 3 |
| D-9 sem migration | nenhuma task cria migration |

**Consistência de tipos:** `FiltroStatusPergunta` é definido em `lib/perguntas.ts` (Task 1) e consumido em `aba-perguntas.tsx` (Task 2) com o mesmo shape; `FiltroStatusMensagem` é local a `aba-mensagens.tsx` (Task 3) porque nenhuma outra parte do código precisa dele — não existe uma função de lib equivalente a `pergCasaStatus` para mensagens, já que o filtro é só um `.filter(c => c.aguardando)` inline. `PaginaPerguntas`/`FiltroPerguntas` (Task 1) são consumidos por `fetchPerguntasPagina` na Task 2 sem adaptação.

**Placeholder scan:** nenhum "TBD"/"implementar depois" — os três passos de validação da Task 4 têm critério concreto (console limpo, sem overflow, screenshot).

**Risco conhecido:** a Task 2 deixa `CardPergunta` intacto mas o arquivo inteiro é reescrito no `Step 4`; quem aplicar o diff manualmente deve conferir que o bloco de `CardPergunta` (linhas 16–91 do arquivo atual) permanece idêntico — só os imports e a função `AbaPerguntas` mudam. Mesma observação para `CardConversa` na Task 3.
