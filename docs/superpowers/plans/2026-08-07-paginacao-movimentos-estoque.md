# Paginação e filtros dos movimentos de estoque — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a lista de movimentos "N mais recentes + Carregar mais" por paginação server-side com filtros de tipo, período e SKU, para que um ledger de milhares de linhas continue navegável.

**Architecture:** Uma query por página no PostgREST (`.range()` + `count: 'exact'`), servida pelos índices que já existem. A UI reusa `<Pagination>` e `<SeletorPeriodo>` do projeto; a barra de filtros sai para arquivo próprio para o componente da lista não virar monólito. Estado em `useState` local — o painel é inline dentro de uma linha expansível e o Publicados já usa a URL para os filtros dele.

**Tech Stack:** React 18, TanStack Query v5, Supabase JS (PostgREST), Vitest + Testing Library, Tailwind, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-07-paginacao-movimentos-estoque-design.md`

## Global Constraints

- **Só leitura.** Toda escrita de estoque passa por RPC via edge com `service_role` (ADR-0094 D-15); `variacoes.estoque` é bloqueada por trigger (D-20). Nenhuma task escreve no ledger.
- **Sem migration.** `estoque_movimentos_org_pai_idx (org_id, codigo_pai, criado_em DESC)` e `estoque_movimentos_org_codigo_idx (org_id, codigo, criado_em DESC)` já existem e cobrem paginação, filtro por SKU e as duas ordens.
- **O total é sempre visível**, mesmo quando cabe numa página só. É a trava contra a truncagem silenciosa que originou este trabalho.
- **Default = tudo, sem filtro de data.** Nenhum filtro pré-aplicado ao abrir.
- **Toda mudança de filtro reseta para a página 1.**
- Comentários e textos de UI em português, seguindo o estilo do arquivo vizinho (comentário explica o *porquê*, não o *o quê*).
- Rodar `pnpm lint` e `pnpm test` antes de cada commit.

---

### Task 1: Camada de dados — grupos de motivo, filtros e total

**Files:**
- Modify: `src/lib/movimentos-estoque.ts`
- Test: `tests/lib/movimentos-estoque.test.ts` (criar)

**Interfaces:**
- Consumes: `MotivoMovimento`, `MovimentoEstoque` (já existem no arquivo); `Janela` de `@/lib/metricas`.
- Produces:
  - `type GrupoMotivo = 'entradas' | 'vendas' | 'estornos'`
  - `const GRUPOS_MOTIVO: readonly GrupoMotivo[]`
  - `const ROTULO_GRUPO: Record<GrupoMotivo, string>`
  - `function motivosDosGrupos(grupos: GrupoMotivo[]): MotivoMovimento[]`
  - `interface FiltroMovimentos { grupos?: GrupoMotivo[]; janela?: Janela | null; codigo?: string | null; ordem?: 'recentes' | 'antigos' }`
  - `interface PaginaMovimentos { itens: MovimentoEstoque[]; total: number }`
  - `function fetchMovimentosEstoque(codigoPai: string, pagina?: number, tamanho?: number, filtro?: FiltroMovimentos): Promise<PaginaMovimentos>`

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib/movimentos-estoque.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  motivosDosGrupos, fetchMovimentosEstoque, GRUPOS_MOTIVO,
} from '@/lib/movimentos-estoque';
import { supabase } from '@/lib/supabase';

// Cadeia fluente do PostgREST: cada método devolve o próprio objeto, e o `await` no final
// resolve pelo `then`. Assim um único espião registra a query inteira que foi montada.
const chamadas: Record<string, unknown[][]> = {};
function registrar(nome: string, args: unknown[]) {
  (chamadas[nome] ??= []).push(args);
}

const resposta = { data: [], error: null, count: 0 };

const cadeia: Record<string, unknown> = {};
for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'range']) {
  cadeia[m] = vi.fn((...args: unknown[]) => { registrar(m, args); return cadeia; });
}
cadeia.then = (resolve: (v: typeof resposta) => unknown) => Promise.resolve(resposta).then(resolve);

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(() => cadeia) },
}));

describe('lib/movimentos-estoque', () => {
  beforeEach(() => {
    for (const k of Object.keys(chamadas)) delete chamadas[k];
    resposta.count = 0;
    resposta.data = [];
  });

  it('mapeia cada grupo para os motivos do ledger', () => {
    expect(motivosDosGrupos(['entradas'])).toEqual(['entrada']);
    expect(motivosDosGrupos(['vendas'])).toEqual([
      'venda', 'venda_sku_nao_encontrado', 'venda_cancelada_antes',
    ]);
    expect(motivosDosGrupos(['estornos'])).toEqual([
      'estorno_venda', 'estorno_sku_nao_encontrado', 'cancelamento_sem_baixa',
    ]);
  });

  it('sem grupo escolhido não recorta motivo nenhum', () => {
    expect(motivosDosGrupos([])).toEqual([]);
    // Todos os grupos juntos cobrem os 7 motivos — nenhum fica órfão de classificação.
    expect(motivosDosGrupos([...GRUPOS_MOTIVO])).toHaveLength(7);
  });

  it('pede o range da página pedida e devolve o total', async () => {
    resposta.count = 956;
    const r = await fetchMovimentosEstoque('00000004', 3, 20);
    expect(chamadas.range).toEqual([[40, 59]]);
    expect(chamadas.order).toEqual([['criado_em', { ascending: false }]]);
    expect(r.total).toBe(956);
  });

  it('não manda filtro de motivo quando nenhum grupo foi escolhido', async () => {
    await fetchMovimentosEstoque('00000004', 1, 20, { grupos: [] });
    expect(chamadas.in).toBeUndefined();
  });

  it('recorta por motivo, janela e SKU quando pedidos', async () => {
    await fetchMovimentosEstoque('00000004', 1, 20, {
      grupos: ['entradas'],
      janela: { desde: '2026-08-01T00:00:00.000Z', ate: '2026-08-07T23:59:59.999Z' },
      codigo: '00000005',
    });
    expect(chamadas.in).toEqual([['motivo', ['entrada']]]);
    expect(chamadas.gte).toEqual([['criado_em', '2026-08-01T00:00:00.000Z']]);
    expect(chamadas.lte).toEqual([['criado_em', '2026-08-07T23:59:59.999Z']]);
    expect(chamadas.eq).toEqual([['codigo_pai', '00000004'], ['codigo', '00000005']]);
  });

  it('inverte a ordem quando pedido do mais antigo', async () => {
    await fetchMovimentosEstoque('00000004', 1, 20, { ordem: 'antigos' });
    expect(chamadas.order).toEqual([['criado_em', { ascending: true }]]);
  });

  it('página zero ou negativa cai na primeira, sem offset negativo', async () => {
    await fetchMovimentosEstoque('00000004', 0, 20);
    expect(chamadas.range).toEqual([[0, 19]]);
  });

  it('propaga o erro do banco em vez de devolver lista vazia', async () => {
    resposta.error = { message: 'boom' } as never;
    await expect(fetchMovimentosEstoque('00000004')).rejects.toBeTruthy();
    resposta.error = null;
  });

  it('usa o cliente supabase do projeto', async () => {
    await fetchMovimentosEstoque('00000004');
    expect(supabase.from).toHaveBeenCalledWith('estoque_movimentos');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run tests/lib/movimentos-estoque.test.ts`
Expected: FAIL — `motivosDosGrupos is not a function`.

- [ ] **Step 3: Implementar**

Em `src/lib/movimentos-estoque.ts`, acrescentar o import de `Janela` e, depois de `MOTIVOS_MOVIMENTO`/`rotuloMotivo`, o bloco abaixo. Substituir a função `fetchMovimentosEstoque` inteira pela nova versão.

```ts
import type { Janela } from './metricas';

/** Recortes que a UI oferece. Os 7 motivos do ledger são detalhe de auditoria: para quem filtra,
 *  `venda_sku_nao_encontrado` e `venda_cancelada_antes` são venda. O motivo exato continua escrito
 *  em cada linha, então agrupar aqui não esconde informação — só tira ruído do filtro. */
export const GRUPOS_MOTIVO = ['entradas', 'vendas', 'estornos'] as const;

export type GrupoMotivo = (typeof GRUPOS_MOTIVO)[number];

export const ROTULO_GRUPO: Record<GrupoMotivo, string> = {
  entradas: 'Entradas',
  vendas: 'Vendas',
  estornos: 'Estornos',
};

const MOTIVOS_POR_GRUPO: Record<GrupoMotivo, MotivoMovimento[]> = {
  entradas: ['entrada'],
  vendas: ['venda', 'venda_sku_nao_encontrado', 'venda_cancelada_antes'],
  estornos: ['estorno_venda', 'estorno_sku_nao_encontrado', 'cancelamento_sem_baixa'],
};

/** Motivos cobertos pelos grupos escolhidos. Lista vazia = "Todos", que é AUSÊNCIA de recorte, não
 *  a união dos grupos: um motivo novo no ledger aparece em Todos mesmo antes de ser classificado. */
export function motivosDosGrupos(grupos: GrupoMotivo[]): MotivoMovimento[] {
  return grupos.flatMap((g) => MOTIVOS_POR_GRUPO[g]);
}

export interface FiltroMovimentos {
  /** Vazio = sem recorte por motivo. */
  grupos?: GrupoMotivo[];
  /** null = todo o período (default da tela). */
  janela?: Janela | null;
  /** SKU da variação. null = todas. */
  codigo?: string | null;
  ordem?: 'recentes' | 'antigos';
}

export interface PaginaMovimentos {
  itens: MovimentoEstoque[];
  /** Total que casa com os filtros — não o tamanho da página. É o que a tela mostra ao operador. */
  total: number;
}

const COLUNAS =
  'id, criado_em, codigo, quantidade, quantidade_pedida, motivo, canal_origem, documento, estoque_anterior, estoque_resultante';

/**
 * Uma página do ledger do produto. A RLS por org já filtra o tenant.
 * O `count: 'exact'` vem no mesmo round-trip: o total nunca fica defasado em relação às linhas
 * exibidas, que é o que permite dizer "1–20 de 956" com honestidade.
 */
export async function fetchMovimentosEstoque(
  codigoPai: string,
  pagina = 1,
  tamanho = 20,
  filtro: FiltroMovimentos = {},
): Promise<PaginaMovimentos> {
  const de = (Math.max(1, Math.floor(pagina) || 1) - 1) * tamanho;
  let q = supabase
    .from('estoque_movimentos')
    .select(COLUNAS, { count: 'exact' })
    .eq('codigo_pai', codigoPai);

  const motivos = motivosDosGrupos(filtro.grupos ?? []);
  if (motivos.length > 0) q = q.in('motivo', motivos);
  if (filtro.janela) {
    q = q.gte('criado_em', filtro.janela.desde).lte('criado_em', filtro.janela.ate);
  }
  if (filtro.codigo) q = q.eq('codigo', filtro.codigo);

  const { data, error, count } = await q
    .order('criado_em', { ascending: filtro.ordem === 'antigos' })
    .range(de, de + tamanho - 1);

  if (error) throw error;
  return { itens: (data ?? []) as unknown as MovimentoEstoque[], total: count ?? 0 };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run tests/lib/movimentos-estoque.test.ts`
Expected: PASS (9 testes).

- [ ] **Step 5: Commit**

```bash
pnpm lint && pnpm vitest run tests/lib/movimentos-estoque.test.ts
git add src/lib/movimentos-estoque.ts tests/lib/movimentos-estoque.test.ts
git commit -m "feat(estoque): busca de movimentos com filtros, paginação e total"
```

Nota: `src/components/movimentos-estoque.tsx` fica quebrado (chamava a assinatura antiga) até a Task 3. O commit é da camada de dados isolada; `pnpm test` cheio volta a passar na Task 3. Se preferir árvore sempre verde, junte Tasks 1–3 num commit só.

---

### Task 2: Barra de filtros

**Files:**
- Create: `src/components/estoque/filtros-movimentos.tsx`
- Test: `tests/components/filtros-movimentos.test.tsx` (criar)

**Interfaces:**
- Consumes: `GrupoMotivo`, `GRUPOS_MOTIVO`, `ROTULO_GRUPO` (Task 1); `SeletorPeriodo` e `Periodo` já existentes.
- Produces:
  ```ts
  interface VariacaoFiltro { codigo: string; cor: string | null }
  interface FiltrosMovimentosProps {
    grupos: GrupoMotivo[];
    onGrupos: (g: GrupoMotivo[]) => void;
    periodo: Periodo | null;
    onPeriodo: (p: Periodo | null) => void;
    codigo: string | null;
    onCodigo: (c: string | null) => void;
    variacoes: VariacaoFiltro[];
  }
  export function FiltrosMovimentos(props: FiltrosMovimentosProps): JSX.Element
  ```

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/components/filtros-movimentos.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FiltrosMovimentos } from '@/components/estoque/filtros-movimentos';

function props(over: Partial<Parameters<typeof FiltrosMovimentos>[0]> = {}) {
  return {
    grupos: [], onGrupos: vi.fn(),
    periodo: null, onPeriodo: vi.fn(),
    codigo: null, onCodigo: vi.fn(),
    variacoes: [{ codigo: '00000005', cor: 'incolor' }],
    ...over,
  };
}

describe('FiltrosMovimentos', () => {
  it('marca Todos quando nenhum grupo está escolhido', () => {
    render(<FiltrosMovimentos {...props()} />);
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Entradas' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('escolher um grupo troca o recorte em vez de acumular', async () => {
    const p = props();
    render(<FiltrosMovimentos {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Entradas' }));
    expect(p.onGrupos).toHaveBeenCalledWith(['entradas']);
  });

  it('clicar no grupo já ativo volta para Todos', async () => {
    const p = props({ grupos: ['entradas'] });
    render(<FiltrosMovimentos {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Entradas' }));
    expect(p.onGrupos).toHaveBeenCalledWith([]);
  });

  it('Todos limpa o recorte de motivo', async () => {
    const p = props({ grupos: ['vendas'] });
    render(<FiltrosMovimentos {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Todos' }));
    expect(p.onGrupos).toHaveBeenCalledWith([]);
  });

  it('não oferece filtro de SKU quando o produto tem uma variação só', () => {
    render(<FiltrosMovimentos {...props()} />);
    expect(screen.queryByLabelText('Variação')).not.toBeInTheDocument();
  });

  it('oferece filtro de SKU quando há mais de uma variação', () => {
    render(<FiltrosMovimentos {...props({
      variacoes: [{ codigo: '00000005', cor: 'incolor' }, { codigo: '00000006', cor: 'azul' }],
    })} />);
    expect(screen.getByLabelText('Variação')).toBeInTheDocument();
  });

  it('abre em Todo o período e não pré-aplica data nenhuma', () => {
    render(<FiltrosMovimentos {...props()} />);
    expect(screen.getByRole('button', { name: /todo o per[íi]odo/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sair de Todo o período aplica o preset escolhido', async () => {
    const p = props();
    render(<FiltrosMovimentos {...p} />);
    await userEvent.click(screen.getByRole('button', { name: '30 dias' }));
    expect(p.onPeriodo).toHaveBeenCalledWith({ tipo: 'preset', dias: 30 });
  });

  it('voltar para Todo o período limpa a janela', async () => {
    const p = props({ periodo: { tipo: 'preset', dias: 30 } as const });
    render(<FiltrosMovimentos {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /todo o per[íi]odo/i }));
    expect(p.onPeriodo).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run tests/components/filtros-movimentos.test.tsx`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

Criar `src/components/estoque/filtros-movimentos.tsx`:

```tsx
// Barra de filtros do ledger. Fica fora de `movimentos-estoque.tsx` porque aquele componente já
// carrega estado de paginação + lista; juntar os três num arquivo só o tornaria difícil de ler.
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SeletorPeriodo } from '@/components/ui/seletor-periodo';
import { cn } from '@/lib/utils';
import { GRUPOS_MOTIVO, ROTULO_GRUPO, type GrupoMotivo } from '@/lib/movimentos-estoque';
import type { Periodo } from '@/lib/metricas';

export interface VariacaoFiltro {
  codigo: string;
  cor: string | null;
}

interface Props {
  grupos: GrupoMotivo[];
  onGrupos: (g: GrupoMotivo[]) => void;
  /** null = todo o período. É o default: pré-aplicar data esconderia a entrada inicial de um
   *  produto parado, que foi exatamente o defeito que originou esta tela. */
  periodo: Periodo | null;
  onPeriodo: (p: Periodo | null) => void;
  codigo: string | null;
  onCodigo: (c: string | null) => void;
  variacoes: VariacaoFiltro[];
}

const TODAS = '__todas__';

function Chip({
  ativo, onClick, children,
}: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      variant={ativo ? 'default' : 'outline'}
      size="sm"
      className="h-7 px-2.5 text-xs"
      aria-pressed={ativo}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function FiltrosMovimentos({
  grupos, onGrupos, periodo, onPeriodo, codigo, onCodigo, variacoes,
}: Props) {
  // Um grupo por vez: os recortes que o operador pede são excludentes ("quero ver as entradas"),
  // e multi-seleção só criaria estados como "entradas + vendas" que equivalem a Todos.
  const alternar = (g: GrupoMotivo) => onGrupos(grupos[0] === g ? [] : [g]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <Chip ativo={grupos.length === 0} onClick={() => onGrupos([])}>Todos</Chip>
        {GRUPOS_MOTIVO.map((g) => (
          <Chip key={g} ativo={grupos[0] === g} onClick={() => alternar(g)}>
            {ROTULO_GRUPO[g]}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Chip ativo={periodo === null} onClick={() => onPeriodo(null)}>Todo o período</Chip>
        <div className={cn(periodo === null && 'opacity-60')}>
          <SeletorPeriodo
            periodo={periodo ?? { tipo: 'preset', dias: 30 }}
            onPeriodo={onPeriodo}
          />
        </div>
      </div>

      {variacoes.length > 1 && (
        <Select
          value={codigo ?? TODAS}
          onValueChange={(v) => onCodigo(v === TODAS ? null : v)}
        >
          <SelectTrigger className="h-7 w-[168px] text-xs" aria-label="Variação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODAS}>Todas as variações</SelectItem>
            {variacoes.map((v) => (
              <SelectItem key={v.codigo} value={v.codigo}>
                {v.cor ? `${v.codigo} · ${v.cor}` : v.codigo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run tests/components/filtros-movimentos.test.tsx`
Expected: PASS (9 testes).

Se o teste do preset "30 dias" falhar por causa do rótulo real do `SeletorPeriodo`, abra `src/components/ui/seletor-periodo.tsx`, confira o texto do botão e ajuste **o teste** para o rótulo real — não invente um botão novo.

- [ ] **Step 5: Commit**

```bash
pnpm lint && pnpm vitest run tests/components/filtros-movimentos.test.tsx
git add src/components/estoque/filtros-movimentos.tsx tests/components/filtros-movimentos.test.tsx
git commit -m "feat(estoque): barra de filtros do ledger (tipo, período, SKU)"
```

---

### Task 3: Lista paginada

**Files:**
- Modify: `src/components/movimentos-estoque.tsx` (reescrever o corpo do componente)
- Modify: `src/lib/queries.ts` (chave de query)
- Test: `tests/components/movimentos-estoque.test.tsx` (reescrever)

**Interfaces:**
- Consumes: `fetchMovimentosEstoque`, `FiltroMovimentos`, `PaginaMovimentos`, `GrupoMotivo` (Task 1); `FiltrosMovimentos`, `VariacaoFiltro` (Task 2); `<Pagination>`; `resolverJanela`.
- Produces: `MovimentosEstoque({ codigoPai, ativo, variacoes })` — `variacoes` é opcional (`VariacaoFiltro[]`, default `[]`); sem ela o filtro de SKU não aparece.

- [ ] **Step 1: Atualizar a chave de query**

Em `src/lib/queries.ts`, trocar `movimentosEstoquePagina` (introduzida pelo commit `b1570ec0`) por:

```ts
  // Prefixo: invalida todas as páginas do produto de uma vez (ex.: após registrar uma entrada).
  movimentosEstoque: (codigoPai: string) => ['movimentos-estoque', codigoPai] as const,
  /** Página concreta. Estende o prefixo acima — invalidar o prefixo alcança todas as páginas. */
  movimentosEstoquePagina: (
    codigoPai: string, pagina: number, tamanho: number, filtro: unknown,
  ) => ['movimentos-estoque', codigoPai, pagina, tamanho, filtro] as const,
```

- [ ] **Step 2: Escrever os testes que falham**

Substituir `tests/components/movimentos-estoque.test.tsx` por:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MovimentosEstoque } from '@/components/movimentos-estoque';
import { QK } from '@/lib/queries';
import type { MovimentoEstoque, PaginaMovimentos } from '@/lib/movimentos-estoque';

const fetchMock = vi.fn();

vi.mock('@/lib/movimentos-estoque', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/movimentos-estoque')>();
  return {
    ...actual,
    fetchMovimentosEstoque: (...args: Parameters<typeof actual.fetchMovimentosEstoque>) =>
      fetchMock(...args),
  };
});

function mov(i: number, over: Partial<MovimentoEstoque> = {}): MovimentoEstoque {
  return {
    id: `m${i}`,
    criado_em: new Date(Date.UTC(2026, 7, 7, 12, 0, 0) - i * 60_000).toISOString(),
    codigo: '00000005',
    quantidade: -1,
    quantidade_pedida: 1,
    motivo: 'venda',
    canal_origem: 'mercado_livre',
    documento: null,
    estoque_anterior: 60 - i,
    estoque_resultante: 59 - i,
    ...over,
  };
}

function pagina(itens: MovimentoEstoque[], total: number): PaginaMovimentos {
  return { itens, total };
}

function renderLista(variacoes: { codigo: string; cor: string | null }[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MovimentosEstoque codigoPai="00000004" ativo variacoes={variacoes} />
    </QueryClientProvider>,
  );
  return qc;
}

describe('MovimentosEstoque', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(pagina([mov(0)], 1));
  });

  it('abre sem filtro de data e na primeira página', async () => {
    renderLista();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [codigoPai, pag, tam, filtro] = fetchMock.mock.calls[0];
    expect(codigoPai).toBe('00000004');
    expect(pag).toBe(1);
    expect(tam).toBe(20);
    expect(filtro.janela ?? null).toBeNull();
    expect(filtro.grupos ?? []).toEqual([]);
  });

  // A trava contra o defeito de origem: lista cortada em silêncio parece o histórico inteiro.
  it('mostra o total mesmo quando a página é menor que ele', async () => {
    fetchMock.mockResolvedValue(pagina(Array.from({ length: 20 }, (_, i) => mov(i)), 956));
    renderLista();
    expect(await screen.findByText(/de 956 movimentos/i)).toBeInTheDocument();
  });

  it('filtrar por Entradas recorta a busca e volta para a página 1', async () => {
    fetchMock.mockResolvedValue(pagina(Array.from({ length: 20 }, (_, i) => mov(i)), 956));
    renderLista();
    await screen.findByText(/de 956 movimentos/i);

    await userEvent.click(await screen.findByRole('button', { name: 'Página 3' }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)![1]).toBe(3));

    await userEvent.click(screen.getByRole('button', { name: 'Entradas' }));
    await waitFor(() => {
      const [, pag, , filtro] = fetchMock.mock.calls.at(-1)!;
      expect(pag).toBe(1);
      expect(filtro.grupos).toEqual(['entradas']);
    });
  });

  it('a entrada antiga aparece ao filtrar, num produto cheio de vendas recentes', async () => {
    fetchMock.mockImplementation((_c: string, _p: number, _t: number, f: { grupos?: string[] }) =>
      Promise.resolve(
        f?.grupos?.[0] === 'entradas'
          ? pagina([mov(55, { motivo: 'entrada', quantidade: 20, documento: 'entrada inicial' })], 1)
          : pagina(Array.from({ length: 20 }, (_, i) => mov(i)), 956),
      ));
    renderLista();
    await screen.findByText(/de 956 movimentos/i);

    await userEvent.click(screen.getByRole('button', { name: 'Entradas' }));

    expect(await screen.findByText('Entrada')).toBeInTheDocument();
    expect(screen.getByText(/entrada inicial/)).toBeInTheDocument();
  });

  it('inverter a ordem pela coluna Data refaz a busca', async () => {
    renderLista();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: /data/i }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)![3].ordem).toBe('antigos'));
  });

  it('filtro sem resultado avisa que é dos filtros, não do produto', async () => {
    fetchMock.mockResolvedValue(pagina([], 0));
    renderLista();
    await userEvent.click(await screen.findByRole('button', { name: 'Estornos' }));
    expect(await screen.findByText(/nenhum movimento com esses filtros/i)).toBeInTheDocument();
  });

  it('produto sem movimento nenhum tem mensagem própria', async () => {
    fetchMock.mockResolvedValue(pagina([], 0));
    renderLista();
    expect(await screen.findByText(/nenhum movimento registrado/i)).toBeInTheDocument();
  });

  it('o filtro de SKU só existe com mais de uma variação', async () => {
    renderLista([{ codigo: '00000005', cor: null }]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByLabelText('Variação')).not.toBeInTheDocument();
  });

  // Regressão: o dialog de entrada invalida pela chave-prefixo. Se ela deixar de casar com as
  // páginas, registrar uma entrada não atualiza a lista e o operador vê saldo velho.
  it('recarrega quando a entrada invalida pela chave-prefixo', async () => {
    const qc = renderLista();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await qc.invalidateQueries({ queryKey: QK.movimentosEstoque('00000004') });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `pnpm vitest run tests/components/movimentos-estoque.test.tsx`
Expected: FAIL — o componente ainda usa "Carregar mais" e a assinatura antiga.

- [ ] **Step 4: Implementar**

Substituir `src/components/movimentos-estoque.tsx` inteiro:

```tsx
// E6b (ADR-0094): trilha de auditoria do estoque no card de Estoque e no expandir de Publicados.
// Lazy: só busca quando o painel abre, mesmo padrão do `useFamilia` ao lado.
// Paginado no servidor: o ledger cresce para sempre e não cabe no cliente.
import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QK } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { FiltrosMovimentos, type VariacaoFiltro } from '@/components/estoque/filtros-movimentos';
import { resolverJanela, type Periodo } from '@/lib/metricas';
import {
  fetchMovimentosEstoque, rotuloMotivo, movimentoInformativo,
  type MovimentoEstoque, type GrupoMotivo, type FiltroMovimentos,
} from '@/lib/movimentos-estoque';

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** Delta com sinal e cor. Movimento informativo (quantidade 0) não mostra número:
 *  exibir "+0" sugeriria que algo entrou. */
function Delta({ m }: { m: MovimentoEstoque }) {
  if (movimentoInformativo(m)) return <span className="text-muted-foreground">—</span>;
  const positivo = m.quantidade > 0;
  return (
    <span className={cn('font-medium tabular-nums', positivo ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
      {positivo ? '+' : ''}{m.quantidade}
    </span>
  );
}

export function MovimentosEstoque({
  codigoPai, ativo, variacoes = [],
}: { codigoPai: string; ativo: boolean; variacoes?: VariacaoFiltro[] }) {
  const [pagina, setPagina] = useState(1);
  const [tamanho, setTamanho] = useState(20);
  const [grupos, setGrupos] = useState<GrupoMotivo[]>([]);
  const [periodo, setPeriodo] = useState<Periodo | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [ordem, setOrdem] = useState<'recentes' | 'antigos'>('recentes');

  const filtro: FiltroMovimentos = useMemo(() => ({
    grupos,
    janela: periodo ? resolverJanela(periodo) : null,
    codigo,
    ordem,
  }), [grupos, periodo, codigo, ordem]);

  const { data, isLoading, isError } = useQuery({
    queryKey: QK.movimentosEstoquePagina(codigoPai, pagina, tamanho, filtro),
    queryFn: () => fetchMovimentosEstoque(codigoPai, pagina, tamanho, filtro),
    enabled: ativo,
    staleTime: 60_000,
    // Mantém a página anterior enquanto a próxima carrega: sem isso a lista pisca em branco a
    // cada clique de paginação, e o operador perde a referência visual de onde estava.
    placeholderData: keepPreviousData,
  });

  // Trocar qualquer filtro reinicia a paginação: manter a página 5 ao recortar para 2 resultados
  // mostraria uma lista vazia que parece "não tem nada", quando na verdade tem.
  const comReset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPagina(1); };

  const itens = data?.itens ?? [];
  const total = data?.total ?? 0;
  const temFiltro = grupos.length > 0 || periodo !== null || codigo !== null;
  const inicio = total === 0 ? 0 : (pagina - 1) * tamanho + 1;

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border bg-background p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Movimentos de estoque
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => comReset(setOrdem)(ordem === 'recentes' ? 'antigos' : 'recentes')}
        >
          Data
          {ordem === 'recentes' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
        </Button>
      </div>

      <FiltrosMovimentos
        grupos={grupos}
        onGrupos={comReset(setGrupos)}
        periodo={periodo}
        onPeriodo={comReset(setPeriodo)}
        codigo={codigo}
        onCodigo={comReset(setCodigo)}
        variacoes={variacoes}
      />

      {isLoading ? (
        <p className="text-xs text-muted-foreground">carregando movimentos…</p>
      ) : isError ? (
        <p className="text-xs text-muted-foreground">não foi possível carregar os movimentos deste produto.</p>
      ) : itens.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {temFiltro
            ? 'Nenhum movimento com esses filtros.'
            : 'Nenhum movimento registrado para este produto.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {itens.map((m) => (
            <li
              key={m.id}
              className="flex flex-col gap-1 border-t border-border/50 py-1.5 text-xs sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
            >
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="tabular-nums text-muted-foreground">{fmtDataHora(m.criado_em)}</span>
                <span className="font-mono">{m.codigo}</span>
                <span className="min-w-0">
                  {rotuloMotivo(m.motivo)}
                  {/* Vendeu mais do que havia: o saldo parou em 0 e o pedido real fica visível. */}
                  {m.quantidade_pedida != null && Math.abs(m.quantidade) !== m.quantidade_pedida && (
                    <span className="ml-1 text-destructive">(pedido de {m.quantidade_pedida})</span>
                  )}
                  {m.documento && <span className="ml-1 text-muted-foreground">· {m.documento}</span>}
                </span>
              </div>
              <div className="flex shrink-0 items-baseline gap-3">
                <Delta m={m} />
                <span className="tabular-nums">
                  {m.estoque_resultante != null ? m.estoque_resultante : '—'}
                </span>
                <span className="text-muted-foreground">{m.canal_origem ?? '—'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Renderizado mesmo quando cabe numa página: o total é o que denuncia um histórico maior
          do que a tela mostra — foi a falta dele que escondeu as entradas do protetor solar. */}
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
          rotuloItem="movimento"
          className="border-t border-border/50 pt-2"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm vitest run tests/components/movimentos-estoque.test.tsx`
Expected: PASS (9 testes).

- [ ] **Step 6: Rodar a suíte inteira**

Run: `pnpm lint && pnpm test`
Expected: tudo verde. `tests/pages/Publicados.test.tsx` mocka `fetchMovimentosEstoque` com `mockResolvedValue([])` — a lista agora espera `{ itens, total }`, então **ajuste aquele mock** para `mockResolvedValue({ itens: [], total: 0 })`.

- [ ] **Step 7: Commit**

```bash
git add src/components/movimentos-estoque.tsx src/lib/queries.ts tests/components/movimentos-estoque.test.tsx tests/pages/Publicados.test.tsx
git commit -m "feat(estoque): lista de movimentos paginada com filtros"
```

---

### Task 4: Ligar os dois consumidores e validar

**Files:**
- Modify: `src/components/estoque/produto-card.tsx:158`
- Modify: `src/pages/Publicados.tsx:356`
- Modify: `docs/TASKS.md`
- Modify: `obsidian-vault/05-Bugs/Incidentes.md`

**Interfaces:**
- Consumes: `MovimentosEstoque({ codigoPai, ativo, variacoes })` (Task 3).
- Produces: nada — é a integração final.

- [ ] **Step 1: Passar as variações no card de Estoque**

Em `src/components/estoque/produto-card.tsx`, linha 158:

```tsx
              <MovimentosEstoque
                codigoPai={produto.codigoPai}
                ativo={aberto}
                variacoes={produto.variacoes.map((v) => ({ codigo: v.codigo, cor: v.cor }))}
              />
```

- [ ] **Step 2: Passar as variações no Publicados**

Em `src/pages/Publicados.tsx`, linha 356 — `familia` já está carregada neste ponto (o bloco só renderiza com ela):

```tsx
              <MovimentosEstoque
                codigoPai={item.codigoPai}
                ativo={aberto}
                variacoes={familia.variacoes.map((v) => ({ codigo: v.codigo, cor: v.cor }))}
              />
```

- [ ] **Step 3: Rodar tudo**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: 0 erros de lint, suíte verde, build ok.

- [ ] **Step 4: Validação visual com dado real**

Subir o app (`.env.local` copiado para a worktree — sem ele a tela abre branca) e conferir na tela de Estoque, no produto `00000004` (56 movimentos, 54 vendas + 2 entradas):

1. Abrir a aba Movimentos → rodapé diz `1–20 de 56 movimentos`, sem filtro pré-aplicado.
2. Clicar em **Entradas** → 2 linhas (`+40` em 05/08, `+20` em 01/08), rodapé `1–2 de 2`.
3. Voltar para **Todos**, ir para a página 3 → `41–56 de 56`.
4. Clicar em **Data** → a lista inverte e a entrada de 01/08 aparece no topo.
5. Trocar o tamanho para 50 → volta para a página 1, rodapé `1–50 de 56`.
6. Screenshot de (1) e (2) — snapshot de acessibilidade não pega defeito de layout.

- [ ] **Step 5: Atualizar a documentação**

Em `docs/TASKS.md`, acrescentar sob a entrada de 2026-08-07 já existente:

```markdown
- [x] **Evolução (mesmo dia)** — "Carregar mais" virou paginação server-side com filtros de tipo,
  período e SKU (spec `2026-08-07-paginacao-movimentos-estoque-design.md`). O total do rodapé é a
  trava permanente contra truncagem silenciosa. Sem migration: os índices já existiam.
```

Em `obsidian-vault/05-Bugs/Incidentes.md`, no incidente de 2026-08-07 já registrado, acrescentar ao final:

```markdown
Evolução no mesmo dia: a lista virou paginada (server-side, `count: 'exact'`) com filtros por tipo,
período e SKU. O default é "tudo, sem filtro de data" — um default de 30 dias recriaria o defeito
num produto parado.
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(estoque): filtro de SKU nos dois consumidores + docs"
```

---

## Self-Review

**Cobertura da spec:**

| Decisão | Task |
|---|---|
| D-1 paginação server-side | 1 (`.range()` + `count`), 3 (UI) |
| D-2 total sempre visível | 3 (`<Pagination>` renderizado com `total > 0`) |
| D-3 default sem filtro de data | 2 (`Todo o período` ativo), 3 (`periodo` inicia `null`) |
| D-4 filtros combináveis, reset para página 1 | 2 (barra), 3 (`comReset`) |
| D-5 7 motivos → 3 grupos | 1 (`MOTIVOS_POR_GRUPO`) |
| D-6 inline no card | 4 (os dois consumidores existentes) |
| D-7 estado local | 3 (`useState`) |
| D-8 ordem alternável | 3 (botão Data) |
| D-9 sem migration | nenhuma task cria migration |
| Sai: "Carregar mais" e `PASSO` | 3 (componente reescrito) |

**Consistência de tipos:** `FiltroMovimentos.janela` é `Janela | null` na lib (Task 1) e o componente converte de `Periodo | null` via `resolverJanela` (Task 3) — a barra de filtros fala `Periodo`, a lib fala `Janela`, e a conversão acontece num lugar só. `VariacaoFiltro` é definido na Task 2 e consumido nas Tasks 3 e 4 com o mesmo shape `{ codigo, cor }`.

**Risco conhecido:** a Task 1 deixa a árvore com `pnpm test` vermelho até a Task 3 (a assinatura de `fetchMovimentosEstoque` muda). Está anotado no commit da Task 1; quem preferir árvore sempre verde junta 1–3 num commit.
