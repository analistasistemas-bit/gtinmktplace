import { describe, expect, it } from 'vitest';
import { lerCampanhasComparadas, lerCampanhasPeriodo } from '../metricas-leitura.ts';

const ATUAL = { desde: '2026-09-30', ate: '2026-10-29' };
const ANT = { desde: '2026-08-31', ate: '2026-09-29' };
const camp = (id: number, cost: number, status = 'active') => ({ id, name: `C${id}`, status, metrics: { cost } });

// Servidor fake: páginas de 2 linhas; guarda as URLs pedidas.
function fake(porJanela: Record<string, ReturnType<typeof camp>[]>, total?: number, vazioNaPagina?: number) {
  const urls: string[] = [];
  const buscar = async (url: string) => {
    urls.push(url);
    const desde = /date_from=([\d-]+)/.exec(url)![1];
    const todas = porJanela[desde] ?? [];
    const offset = Number(/offset=(\d+)/.exec(url)![1]);
    const limit = 2;
    const results = vazioNaPagina === offset ? [] : todas.slice(offset, offset + limit);
    return { paging: { offset, limit, total: total ?? todas.length }, results, metrics_summary: { cost: 999 } };
  };
  return { buscar, urls, deps: { buscar, agora: () => '2026-10-30T12:00:00.000Z' } };
}

describe('paginacao de campanhas (E1)', () => {
  it('uma página: completa e o resumo vem uma vez', async () => {
    const f = fake({ [ATUAL.desde]: [camp(1, 10), camp(2, 20)] });
    const r = await lerCampanhasPeriodo(f.deps, 7, ATUAL);
    expect(r.completo).toBe(true);
    expect(r.campanhas).toHaveLength(2);
    expect(r.resumo?.cost).toEqual({ valor: 999, motivo: null });
    expect(f.urls).toHaveLength(1);
  });

  it('várias páginas: junta tudo e não usa o resumo de página como total', async () => {
    const f = fake({ [ATUAL.desde]: [camp(1, 1), camp(2, 2), camp(3, 3)] });
    const r = await lerCampanhasPeriodo(f.deps, 7, ATUAL);
    expect(r.completo).toBe(true);
    expect(r.campanhas.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(f.urls.map((u) => /offset=(\d+)/.exec(u)![1])).toEqual(['0', '2']);
    expect(r.resumo).toBeNull();
  });

  it('página vazia antes do total é incompleto', async () => {
    const f = fake({ [ATUAL.desde]: [camp(1, 1), camp(2, 2)] }, 5);
    const r = await lerCampanhasPeriodo(f.deps, 7, ATUAL);
    expect(r.completo).toBe(false);
    expect(r.campanhas).toHaveLength(2);
    expect(r.resumo).toBeNull();
  });

  it('falha de rede, corpo inválido ou id repetido é incompleto', async () => {
    const deps = { agora: () => 'x' };
    expect((await lerCampanhasPeriodo({ ...deps, buscar: async () => null }, 7, ATUAL)).completo).toBe(false);
    expect((await lerCampanhasPeriodo({ ...deps, buscar: async () => ({ results: [] }) }, 7, ATUAL)).completo).toBe(false);
    const dup = fake({ [ATUAL.desde]: [camp(1, 1), camp(1, 2), camp(3, 3)] });
    expect((await lerCampanhasPeriodo(dup.deps, 7, ATUAL)).completo).toBe(false);
  });

  it('une atual e anterior pelo ID preservando campanha de uma só janela', async () => {
    const f = fake({
      [ATUAL.desde]: [camp(1, 10), camp(2, 20)],
      [ANT.desde]: [camp(2, 5, 'paused'), camp(3, 7, 'deleted')],
    });
    const { campanhas, atual, anterior } = await lerCampanhasComparadas(f.deps, 7, ATUAL, ANT);
    expect(atual.completo && anterior!.completo).toBe(true);
    expect(campanhas.map((c) => c.id)).toEqual([1, 2, 3]);
    const [c1, c2, c3] = campanhas;
    expect(c1.anterior).toBeNull();
    expect(c2.atual.resumo.cost?.valor).toBe(20);
    expect(c2.anterior?.resumo.cost?.valor).toBe(5);
    expect(c2.statusAtual).toBe('active');
    // só no anterior: atual vazio, sem zero presumido
    expect(c3.atual.resumo).toEqual({});
    expect(c3.atual.janela).toEqual(ATUAL);
    expect(c3.anterior?.resumo.cost?.valor).toBe(7);
    expect(c3.statusAtual).toBe('deleted');
  });

  it('janela incompleta marca os blocos como incompletos', async () => {
    const f = fake({ [ATUAL.desde]: [camp(1, 1), camp(2, 2)], [ANT.desde]: [camp(1, 1), camp(2, 2)] }, 4, 2);
    const r = await lerCampanhasComparadas(f.deps, 7, ATUAL, ANT);
    expect(r.campanhas[0].atual.completo).toBe(false);
    expect(r.campanhas[0].anterior?.completo).toBe(false);
  });

  it('sem anterior: não lê a janela anterior', async () => {
    const f = fake({ [ATUAL.desde]: [camp(1, 1)] });
    const r = await lerCampanhasComparadas(f.deps, 7, ATUAL, null);
    expect(r.anterior).toBeNull();
    expect(r.campanhas[0].anterior).toBeNull();
    expect(f.urls).toHaveLength(1);
  });
});
