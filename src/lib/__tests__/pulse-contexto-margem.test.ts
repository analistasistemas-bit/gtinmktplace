import { describe, it, expect, vi, beforeEach } from 'vitest';

// Cadeia fluente do PostgREST: cada método devolve o próprio objeto e o `await` resolve pelo
// `then`. `paginas` alimenta cada `.range()` — é assim que o teste prova que o lote NÃO para na
// primeira página (o PostgREST trunca em ~1000 linhas sem avisar).
const estado = vi.hoisted(() => ({
  paginas: [] as unknown[][],
  chamadasRange: [] as [number, number][],
  chamadasOrder: [] as unknown[][],
  chamadasIn: [] as string[][],
  aliquotas: { nacional: 8, importado: 16, confirmada: true },
}));

vi.mock('@/lib/supabase', () => {
  const cadeia: Record<string, unknown> = {};
  const metodo = (nome: string) => (...args: unknown[]) => {
    if (nome === 'range') estado.chamadasRange.push(args as [number, number]);
    if (nome === 'order') estado.chamadasOrder.push(args);
    if (nome === 'in') estado.chamadasIn.push(args[1] as string[]);
    return cadeia;
  };
  for (const n of ['select', 'eq', 'in', 'order', 'limit', 'neq', 'maybeSingle', 'range']) {
    cadeia[n] = metodo(n);
  }
  cadeia.then = (resolve: (v: unknown) => void) => {
    const i = estado.chamadasRange.length - 1;
    return Promise.resolve({ data: estado.paginas[i] ?? [], error: null }).then(resolve);
  };
  return { supabase: { from: () => cadeia } };
});

vi.mock('@/lib/queries', () => ({ fetchAliquotas: vi.fn(async () => estado.aliquotas) }));

const { fetchContextoMargem, fetchContextoMargemEmLote } = await import('@/lib/pulse');

const familia = (codigo_pai: string, origem: string, custos: (number | null)[]) => ({
  codigo_pai, origem, variacoes: custos.map((custo) => ({ custo })),
});

beforeEach(() => {
  estado.paginas = [];
  estado.chamadasRange = [];
  estado.chamadasOrder = [];
  estado.chamadasIn = [];
  estado.aliquotas = { nacional: 8, importado: 16, confirmada: true };
});

describe('fetchContextoMargemEmLote', () => {
  it('devolve, para cada codigo_pai, o mesmo que o caminho unitário devolveria', async () => {
    const linhas = [familia('A', 'nacional', [10, 12]), familia('B', 'importado', [30])];
    estado.paginas = [linhas, []];
    const lote = await fetchContextoMargemEmLote(['A', 'B']);

    estado.chamadasRange = [];
    estado.paginas = [[linhas[0]], []];
    const soA = await fetchContextoMargem('A');

    expect(lote.get('A')).toEqual({ custo: 12, aliquotaPct: 8 });
    expect(lote.get('B')).toEqual({ custo: 30, aliquotaPct: 16 });
    expect(lote.get('A')).toEqual(soA);
  });

  it('pagina até esvaziar — não confia num teto', async () => {
    const cheia = Array.from({ length: 1000 }, (_, i) => familia(`P${i}`, 'nacional', [1]));
    estado.paginas = [cheia, [familia('ULTIMO', 'nacional', [99])], []];
    const lote = await fetchContextoMargemEmLote(['P0', 'ULTIMO']);
    expect(estado.chamadasRange.length).toBeGreaterThan(1);
    expect(lote.get('ULTIMO')).toEqual({ custo: 99, aliquotaPct: 8 });
  });

  // Desempate obrigatório, mesmo motivo de `fetchPulseAlertas` (ADR-0133): um lote inteiro entra
  // com o mesmo `criado_em` (default now()), e sem segundo critério páginas de LIMIT/OFFSET podem
  // repetir ou PULAR linha. Pular a família que tem as variações faria "Sobra hoje" mostrar `—`
  // para um produto que tem custo cadastrado — número financeiro errado nascido da paginação.
  it('ordena por criado_em com desempate determinístico por id', async () => {
    estado.paginas = [[familia('A', 'nacional', [10])], []];
    await fetchContextoMargemEmLote(['A']);
    expect(estado.chamadasOrder).toEqual([
      ['criado_em', { ascending: false }],
      ['id', { ascending: false }],
    ]);
  });

  // A lista inteira do Radar vai num `in(...)` só, e `in` é querystring: com centenas de códigos a
  // URL estoura e o PostgREST devolve erro opaco — não resultado parcial. Blocos de 200.
  it('fatia a lista em blocos de 200 e junta os mapas parciais', async () => {
    const codigos = Array.from({ length: 250 }, (_, i) => `P${i}`);
    estado.paginas = [
      codigos.slice(0, 200).map((c) => familia(c, 'nacional', [10])),
      codigos.slice(200).map((c) => familia(c, 'importado', [20])),
    ];
    const lote = await fetchContextoMargemEmLote(codigos);

    expect(estado.chamadasIn).toHaveLength(2);
    expect(estado.chamadasIn[0]).toHaveLength(200);
    expect(estado.chamadasIn[1]).toHaveLength(50);
    // Nenhum código some no fatiamento — e o do último bloco não herda o contexto do primeiro.
    expect(lote.size).toBe(250);
    expect(lote.get('P0')).toEqual({ custo: 10, aliquotaPct: 8 });
    expect(lote.get('P249')).toEqual({ custo: 20, aliquotaPct: 16 });
  });

  it('alíquota não confirmada nunca vira 8/16 em silêncio', async () => {
    estado.aliquotas = { nacional: 8, importado: 16, confirmada: false };
    estado.paginas = [[familia('A', 'nacional', [10])], []];
    const lote = await fetchContextoMargemEmLote(['A']);
    expect(lote.get('A')).toEqual({ custo: 10, aliquotaPct: null });
  });

  it('codigo_pai sem família nenhuma entra no mapa como null, não fica ausente', async () => {
    estado.paginas = [[], []];
    const lote = await fetchContextoMargemEmLote(['SEM-FAMILIA']);
    expect(lote.get('SEM-FAMILIA')).toEqual({ custo: null, aliquotaPct: null });
  });

  it('lista vazia não vai ao banco', async () => {
    const lote = await fetchContextoMargemEmLote([]);
    expect(lote.size).toBe(0);
    expect(estado.chamadasRange).toHaveLength(0);
  });
});
