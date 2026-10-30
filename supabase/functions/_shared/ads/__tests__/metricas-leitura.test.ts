import { describe, expect, it } from 'vitest';
import { lerCampanhasComparadas, lerCampanhasPeriodo, lerEscopoCampanha, lerEscopoConta } from '../metricas-leitura.ts';

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

describe('escopos conta e campanha', () => {
  const dias = (j: { desde: string; ate: string }, falta?: string) => {
    const out: Record<string, unknown>[] = [];
    for (let t = Date.parse(j.desde); t <= Date.parse(j.ate); t += 86_400_000) {
      const date = new Date(t).toISOString().slice(0, 10);
      if (date !== falta) out.push({ date, cost: 1, total_amount: 10, cvr: 5 });
    }
    return out;
  };
  const J = { desde: '2026-10-01', ate: '2026-10-03' };
  const JA = { desde: '2026-09-28', ate: '2026-09-30' };
  // Servidor fake para E1–E4; `falhaEm` devolve null para janelas cujo date_from está na lista.
  function servidor(opts: { camps?: ReturnType<typeof camp>[]; falta?: string; falhaEm?: string[] } = {}) {
    const urls: string[] = [];
    const camps = opts.camps ?? [camp(1, 1), camp(2, 2)];
    const buscar = async (url: string) => {
      urls.push(url);
      const desde = /date_from=([\d-]+)/.exec(url)![1];
      if (opts.falhaEm?.includes(desde)) return null;
      const j = desde === J.desde ? J : JA;
      const diaria = url.includes('aggregation_type=DAILY');
      if (/product_ads\/campaigns\/\d+\?/.test(url)) {
        return diaria
          ? { results: dias(j, opts.falta) }
          : { id: 9, metrics: { cost: 3, impression_share: 0.5 } };
      }
      if (diaria) return { results: dias(j, opts.falta) };
      const offset = Number(/offset=(\d+)/.exec(url)![1]);
      return { paging: { offset, limit: 2, total: camps.length }, results: camps.slice(offset, offset + 2), metrics_summary: { cost: 777 } };
    };
    return { urls, deps: { buscar, agora: () => 'T' } };
  }

  it('conta: uma página usa o resumo do E1; a série E2 não vira campanha', async () => {
    const s = servidor();
    const r = await lerEscopoConta(s.deps, 7, J, null);
    expect(r.atual.resumo.cost?.valor).toBe(777);
    expect(r.atual.serie).toHaveLength(3);
    expect(r.atual.completo).toBe(true);
    expect(r).not.toHaveProperty('campanhas');
    expect(r.comparacao).toEqual({ estado: 'desligada', motivo: null });
  });

  it('conta: 2+ páginas somam as aditivas de E2 e deixam razões indisponíveis', async () => {
    const s = servidor({ camps: [camp(1, 1), camp(2, 2), camp(3, 3)] });
    const r = await lerEscopoConta(s.deps, 7, J, null);
    expect(r.atual.resumo.cost).toEqual({ valor: 3, motivo: null });
    expect(r.atual.resumo.total_amount?.valor).toBe(30);
    expect(r.atual.resumo.cvr?.valor).toBeNull();
    expect(r.atual.resumo.cvr?.motivo).not.toBeNull();
    expect(r.atual.completo).toBe(true);
  });

  it('conta: série E2 incompleta com 2+ páginas não declara resumo nem completo', async () => {
    const s = servidor({ camps: [camp(1, 1), camp(2, 2), camp(3, 3)], falta: '2026-10-02' });
    const r = await lerEscopoConta(s.deps, 7, J, null);
    expect(r.atual.completo).toBe(false);
    expect(r.atual.resumo).toEqual({});
    expect(r.atual.serie).toHaveLength(2);
  });

  it('conta: falha na anterior não derruba a atual', async () => {
    const s = servidor({ falhaEm: [JA.desde] });
    const r = await lerEscopoConta(s.deps, 7, J, JA);
    expect(r.atual.completo).toBe(true);
    expect(r.anterior).toBeNull();
    expect(r.comparacao.estado).toBe('indisponivel');
    expect(r.comparacao.motivo).toBeTruthy();
  });

  it('conta: anterior válida deixa a comparação disponível', async () => {
    const s = servidor();
    const r = await lerEscopoConta(s.deps, 7, J, JA);
    expect(r.anterior?.completo).toBe(true);
    expect(r.comparacao.estado).toBe('disponivel');
  });

  it('campanha: detalhe usa E3 (resumo com competitividade) e E4 (série)', async () => {
    const s = servidor();
    const r = await lerEscopoCampanha(s.deps, 9, J, null);
    expect(r.atual.resumo.impression_share?.valor).toBe(0.5);
    expect(r.atual.serie).toHaveLength(3);
    expect(r.atual.completo).toBe(true);
    expect(s.urls.some((u) => u.includes('/advertisers/'))).toBe(false);
  });

  it('campanha: E3 inválido deixa o bloco incompleto; falha na anterior isola', async () => {
    const ruim = await lerEscopoCampanha({ buscar: async () => null, agora: () => 'T' }, 9, J, null);
    expect(ruim.atual.completo).toBe(false);
    const s = servidor({ falhaEm: [JA.desde] });
    const r = await lerEscopoCampanha(s.deps, 9, J, JA);
    expect(r.atual.completo).toBe(true);
    expect(r.comparacao.estado).toBe('indisponivel');
  });

  it('escopos: atual falha e anterior válida => comparação indisponível (conta e campanha)', async () => {
    const s = servidor({ falhaEm: [J.desde] });
    const c = await lerEscopoConta(s.deps, 7, J, JA);
    expect(c.atual.completo).toBe(false);
    expect(c.comparacao.estado).toBe('indisponivel');
    expect(c.comparacao.motivo).toBeTruthy();
    const k = await lerEscopoCampanha(s.deps, 9, J, JA);
    expect(k.atual.completo).toBe(false);
    expect(k.comparacao.estado).toBe('indisponivel');
  });

  it('escopos: resumo sem cost válido não é completo', async () => {
    // campanha: E3 {metrics:{}} com E4 completo
    const base = servidor();
    const semCost = async (url: string) =>
      /product_ads\/campaigns\/\d+\?/.test(url) && !url.includes('DAILY') ? { metrics: {} } : base.deps.buscar(url);
    const k = await lerEscopoCampanha({ buscar: semCost, agora: () => 'T' }, 9, J, null);
    expect(k.atual.completo).toBe(false);
    // conta: metrics_summary.cost inválido cai no fallback Σ E2 (1 página)
    const invalido = async (url: string) => {
      const r = await base.deps.buscar(url) as Record<string, unknown>;
      return r.metrics_summary ? { ...r, metrics_summary: { cost: 'x' } } : r;
    };
    const c = await lerEscopoConta({ buscar: invalido, agora: () => 'T' }, 7, J, null);
    expect(c.atual.resumo.cost).toEqual({ valor: 3, motivo: null });
    expect(c.atual.completo).toBe(true);
  });
});
