import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mesma cadeia fluente da Task 8 (pulse-contexto-margem.test.ts), com `gte` — a query desta task
// filtra por `.gte('dia', …)`. `paginas` alimenta cada `.range()`.
const estado = vi.hoisted(() => ({
  paginas: [] as unknown[][],
  chamadasRange: [] as [number, number][],
  chamadasOrder: [] as unknown[][],
  desde: null as string | null,
}));

vi.mock('@/lib/supabase', () => {
  const cadeia: Record<string, unknown> = {};
  const metodo = (nome: string) => (...args: unknown[]) => {
    if (nome === 'range') estado.chamadasRange.push(args as [number, number]);
    if (nome === 'order') estado.chamadasOrder.push(args);
    // O `gte('dia')` é HONRADO, não só registrado: um mock que ignora o filtro de data deixa
    // encolher a janela de leitura sem reprovar nada (mutação medida — 30 → 7 dias passava).
    if (nome === 'gte') estado.desde = args[1] as string;
    return cadeia;
  };
  for (const n of ['select', 'eq', 'in', 'gte', 'order', 'limit', 'range']) cadeia[n] = metodo(n);
  cadeia.then = (resolve: (v: unknown) => void) => {
    const i = estado.chamadasRange.length - 1;
    const pagina = (estado.paginas[i] ?? []).filter(
      (l) => estado.desde == null || (l as { dia: string }).dia >= estado.desde!,
    );
    return Promise.resolve({ data: pagina, error: null }).then(resolve);
  };
  return { supabase: { from: () => cadeia } };
});

const { fetchPulseHistoricoOfertas } = await import('@/lib/pulse');

const diaAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const linha = (item_id: string, preco: number, dia: string) =>
  ({ produto_id: 'p1', item_id, seller_id: 1, preco, ativo: true, dia });

beforeEach(() => {
  estado.paginas = []; estado.chamadasRange = []; estado.chamadasOrder = []; estado.desde = null;
});

describe('fetchPulseHistoricoOfertas', () => {
  it('lê 30 dias para semear o carry-forward e devolve os 7 últimos pontos', async () => {
    // Oferta que mudou uma vez há 20 dias e nunca mais: precisa continuar sendo o menor de hoje.
    estado.paginas = [[linha('MLB1', 36, diaAtras(20)), linha('MLB2', 79.99, diaAtras(2))], []];
    // SEM âncora de propósito: a âncora reescreve justamente o último ponto, então afirmar sobre
    // ele com uma âncora de mesmo valor não distingue arrasto nenhum — medido, as duas mutações
    // (matar o carry-forward e encolher a janela para 7 dias) passavam. A âncora tem teste próprio.
    const h = await fetchPulseHistoricoOfertas(['p1']);
    // 1º ponto: a semente de 20 dias atrás só existe porque a janela lida é de 30 dias.
    // 2º ponto: 36 é o carry-forward da mesma oferta, NUNCA 79,99 (a única que mudou naquele dia).
    expect(h.get('p1')!.map((p) => p.preco)).toEqual([36, 36]);
    expect(h.get('p1')!.length).toBeLessThanOrEqual(7);
  });

  it('o último ponto é ancorado no menor observado atual, como o detalhe faz com `atuais`', async () => {
    estado.paginas = [[linha('MLB1', 40, diaAtras(5)), linha('MLB1', 38, diaAtras(1))], []];
    const h = await fetchPulseHistoricoOfertas(['p1'], new Map([['p1', 35]]));
    expect(h.get('p1')!.at(-1)!.preco).toBe(35);
  });

  it('produto com menos de 2 dias de coleta não devolve série — não se desenha reta falsa', async () => {
    estado.paginas = [[linha('MLB1', 50, diaAtras(0))], []];
    const h = await fetchPulseHistoricoOfertas(['p1']);
    expect(h.get('p1')).toBeUndefined();
  });

  it('ordena pela chave única (produto_id, item_id, dia) — senão a paginação pula linhas', async () => {
    // `pulse_ofertas_prod_item_dia_uniq`. Cada `.range()` é uma requisição própria: sob ordem
    // ambígua, linhas empatadas reordenam entre páginas e alguma some. Sumir a linha do preço
    // mais barato é exatamente a alta-fantasma que esta função existe para não desenhar.
    estado.paginas = [[linha('MLB1', 40, diaAtras(5))], []];
    await fetchPulseHistoricoOfertas(['p1']);
    expect(estado.chamadasOrder.map((c) => c[0])).toEqual(['produto_id', 'item_id', 'dia']);
  });

  it('pagina até esvaziar', async () => {
    const cheia = Array.from({ length: 1000 }, (_, i) => linha(`MLB${i}`, 10 + i, diaAtras(3)));
    estado.paginas = [cheia, [linha('X', 1, diaAtras(1))], []];
    await fetchPulseHistoricoOfertas(['p1']);
    expect(estado.chamadasRange.length).toBeGreaterThan(1);
  });

  it('lista vazia não vai ao banco', async () => {
    expect((await fetchPulseHistoricoOfertas([])).size).toBe(0);
    expect(estado.chamadasRange).toHaveLength(0);
  });
});
