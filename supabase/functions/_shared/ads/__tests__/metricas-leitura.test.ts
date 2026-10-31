import { describe, expect, it } from 'vitest';
import {
  criarLeituraOrcada, lerCampanhasComparadas, lerCampanhasPeriodo, lerEscopoCampanha, lerEscopoConta,
} from '../metricas-leitura.ts';

const ATUAL = { desde: '2026-09-30', ate: '2026-10-29' };
const ANT = { desde: '2026-08-31', ate: '2026-09-29' };
const leitura = (r: Awaited<ReturnType<typeof lerEscopoCampanha>>) => {
  if ('recusa' in r) throw new Error(`recusada: ${r.recusa.motivo}`);
  return r;
};
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

  it('janela incompleta marca os blocos como incompletos (anterior incompleta não entra)', async () => {
    const f = fake({ [ATUAL.desde]: [camp(1, 1), camp(2, 2)], [ANT.desde]: [camp(1, 1), camp(2, 2)] }, 4, 2);
    const r = await lerCampanhasComparadas(f.deps, 7, ATUAL, ANT);
    expect(r.campanhas[0].atual.completo).toBe(false);
    expect(r.campanhas[0].anterior).toBeNull();
  });

  // I4: anterior truncada não injeta campanhas nem blocos parciais na tabela do período.
  it('anterior incompleta: só as campanhas da atual, todas sem anterior', async () => {
    const f = fake({ [ATUAL.desde]: [camp(1, 10)], [ANT.desde]: [camp(1, 5), camp(2, 7), camp(3, 1)] });
    const buscar = async (url: string) => {
      const r = await f.buscar(url);
      // A 2ª página da anterior falha: listagem truncada (só C1 e C2 lidas).
      return url.includes(`date_from=${ANT.desde}`) && url.includes('offset=2') ? null : r;
    };
    const r = await lerCampanhasComparadas({ ...f.deps, buscar }, 7, ATUAL, ANT);
    expect(r.anterior?.completo).toBe(false);
    expect(r.campanhas.map((c) => c.id)).toEqual([1]);
    expect(r.campanhas[0].anterior).toBeNull();
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
    // I2: o ML não deu o agregado (só por dia, não somável) — não é falta de denominador.
    expect(r.atual.resumo.cvr?.motivo).toBe('nao_retornada');
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
    const s = servidor({ camps: [camp(9, 1)] });
    const r = leitura(await lerEscopoCampanha(s.deps, 7, 9, J, null));
    expect(r.atual.resumo.impression_share?.valor).toBe(0.5);
    expect(r.atual.serie).toHaveLength(3);
    expect(r.atual.completo).toBe(true);
    // o E1 do anunciante só serve à prova de pertencimento; nenhuma série de conta (E2) é lida
    expect(s.urls.some((u) => u.includes('/advertisers/') && u.includes('DAILY'))).toBe(false);
  });

  it('campanha: E3 inválido deixa o bloco incompleto; falha na anterior isola', async () => {
    const base = servidor({ camps: [camp(9, 1)] });
    const e3Nulo = async (url: string) => (url.includes('/advertisers/') ? base.deps.buscar(url) : null);
    const ruim = leitura(await lerEscopoCampanha({ buscar: e3Nulo, agora: () => 'T' }, 7, 9, J, null));
    expect(ruim.atual.completo).toBe(false);
    const s = servidor({ camps: [camp(9, 1)], falhaEm: [JA.desde] });
    const r = leitura(await lerEscopoCampanha(s.deps, 7, 9, J, JA));
    expect(r.atual.completo).toBe(true);
    expect(r.comparacao.estado).toBe('indisponivel');
  });

  it('escopos: atual falha e anterior válida => comparação indisponível (conta e campanha)', async () => {
    const s = servidor({ camps: [camp(9, 1)], falhaEm: [J.desde] });
    const c = await lerEscopoConta(s.deps, 7, J, JA);
    expect(c.atual.completo).toBe(false);
    expect(c.comparacao.estado).toBe('indisponivel');
    expect(c.comparacao.motivo).toBeTruthy();
    // atual sem E1 legível, mas o anterior completo prova o pertencimento
    const k = leitura(await lerEscopoCampanha(s.deps, 7, 9, J, JA));
    expect(k.atual.completo).toBe(false);
    expect(k.comparacao.estado).toBe('indisponivel');
  });

  it('escopos: resumo sem cost válido não é completo', async () => {
    // campanha: E3 {metrics:{}} com E4 completo
    const base = servidor({ camps: [camp(9, 1)] });
    const semCost = async (url: string) =>
      /product_ads\/campaigns\/\d+\?/.test(url) && !url.includes('DAILY') ? { metrics: {} } : base.deps.buscar(url);
    const k = leitura(await lerEscopoCampanha({ buscar: semCost, agora: () => 'T' }, 7, 9, J, null));
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

  describe('pertencimento da campanha ao anunciante', () => {
    const detalhe = (urls: string[]) => urls.filter((u) => /product_ads\/campaigns\/\d+\?/.test(u));

    it('pertencimento: campanha fora da listagem do anunciante não provoca chamada de detalhe', async () => {
      const s = servidor({ camps: [camp(1, 1), camp(2, 2), camp(3, 3)] });
      const r = await lerEscopoCampanha(s.deps, 7, 9, J, JA);
      expect(r).toEqual({ recusa: { estado: 'sem_acesso', motivo: expect.any(String) } });
      expect(detalhe(s.urls)).toEqual([]);
      // provou nas duas janelas, todas as páginas, antes de recusar
      expect(s.urls.filter((u) => u.includes('/advertisers/')).length).toBe(4);
    });

    it('pertencimento: campanha histórica (deleted) na listagem autoriza o detalhe', async () => {
      const s = servidor({ camps: [camp(1, 1), camp(2, 2), camp(9, 3, 'deleted')] });
      const r = leitura(await lerEscopoCampanha(s.deps, 7, 9, J, null));
      expect(r.atual.completo).toBe(true);
      expect(detalhe(s.urls).length).toBe(2);
      expect(s.urls[0]).toContain('filters[status]=active,paused,deleted,error');
    });

    it('pertencimento: listagem incompleta falha fechada mesmo com o id na página lida', async () => {
      const base = servidor({ camps: [camp(9, 1), camp(2, 2), camp(3, 3)] });
      const urls: string[] = [];
      const buscar = async (url: string) => {
        urls.push(url);
        return url.includes('offset=2') ? null : base.deps.buscar(url);
      };
      const r = await lerEscopoCampanha({ buscar, agora: () => 'T' }, 7, 9, J, null);
      expect('recusa' in r && r.recusa.estado).toBe('sem_acesso');
      expect('recusa' in r && r.recusa.motivo).toMatch(/incompleta/);
      expect(detalhe(urls)).toEqual([]);
    });

    it('pertencimento: dois anunciantes com listagens distintas; campanha de um é recusada pelo outro sem E3/E4', async () => {
      const listas: Record<string, ReturnType<typeof camp>[]> = { '7': [camp(1, 1), camp(2, 2)], '8': [camp(5, 5)] };
      const urls: string[] = [];
      const buscar = async (url: string) => {
        urls.push(url);
        if (/product_ads\/campaigns\/\d+\?/.test(url)) {
          return url.includes('aggregation_type=DAILY') ? { results: [] } : { id: 1, metrics: { cost: 3 } };
        }
        const adv = /advertisers\/(\d+)\//.exec(url)![1];
        const offset = Number(/offset=(\d+)/.exec(url)![1]);
        const todas = listas[adv];
        return { paging: { offset, limit: 2, total: todas.length }, results: todas.slice(offset, offset + 2) };
      };
      const deps = { buscar, agora: () => 'T' };
      // 5 é do anunciante 8: o 7 recusa; o 8 passa da prova (e lê E3/E4)
      expect('recusa' in (await lerEscopoCampanha(deps, 7, 5, J, null))).toBe(true);
      expect(detalhe(urls)).toEqual([]);
      expect('recusa' in (await lerEscopoCampanha(deps, 8, 1, J, null))).toBe(true);
      expect(detalhe(urls)).toEqual([]);
      expect('recusa' in (await lerEscopoCampanha(deps, 8, 5, J, null))).toBe(false);
      expect(detalhe(urls).length).toBe(2);
    });

    it('pertencimento: id inválido é recusado sem nenhuma chamada', async () => {
      for (const id of [0, -9, 1.5, Number.NaN, '9' as unknown as number]) {
        const s = servidor({ camps: [camp(9, 1)] });
        const r = await lerEscopoCampanha(s.deps, 7, id, J, null);
        expect('recusa' in r && r.recusa.estado).toBe('sem_acesso');
        expect(s.urls).toEqual([]);
      }
    });
  });
});

describe('limites de leitura (orçamento §5.5)', () => {
  const r = (status: number, corpo: unknown = {}, retryAfterMs: number | null = null) => ({ status, corpo, retryAfterMs });
  // Relógio e espera fictícios: esperar avança o relógio.
  function ambiente(resp: (url: string, n: number) => ReturnType<typeof r> | Promise<ReturnType<typeof r>>) {
    let t = 0;
    const chamadas: string[] = [];
    const esperas: number[] = [];
    const orc = criarLeituraOrcada({
      buscar: async (url) => { chamadas.push(url); return resp(url, chamadas.length); },
      agoraMs: () => t,
      esperar: async (ms) => { esperas.push(ms); t += ms; },
    });
    return { orc, chamadas, esperas, avancar: (ms: number) => { t += ms; } };
  }
  const pag = (o: number) => `https://x/a?limit=50&offset=${o}`;

  it('limites: 21ª página lida estoura o teto de páginas com motivo', async () => {
    const a = ambiente(() => r(200, { ok: 1 }));
    for (let i = 0; i < 20; i++) expect(await a.orc.buscar(pag(i))).toEqual({ ok: 1 });
    expect(await a.orc.buscar(pag(20))).toBeNull();
    expect(a.chamadas).toHaveLength(20);
    expect(a.orc.estado()).toEqual({ motivo: 'limite_de_leitura', limite: 'paginas' });
    expect(await a.orc.buscar('https://x/b')).toBeNull(); // esgotado é definitivo
  });

  it('limites: 33ª chamada externa (retries incluídos) estoura o teto de chamadas', async () => {
    const a = ambiente(() => r(200, {}));
    for (let i = 0; i < 32; i++) expect(await a.orc.buscar(`https://x/c${i}`)).toEqual({});
    expect(await a.orc.buscar('https://x/c33')).toBeNull();
    expect(a.orc.estado()).toEqual({ motivo: 'limite_de_leitura', limite: 'chamadas' });
    expect(a.chamadas).toHaveLength(32);
  });

  it('limites: retry conta como chamada externa', async () => {
    const a = ambiente((_u, n) => (n % 2 === 1 ? r(503, {}, 1) : r(200, { ok: 1 })));
    for (let i = 0; i < 16; i++) expect(await a.orc.buscar(`https://x/c${i}`)).toEqual({ ok: 1 });
    expect(a.chamadas).toHaveLength(32);
    expect(await a.orc.buscar('https://x/c99')).toBeNull();
    expect(a.orc.estado().limite).toBe('chamadas');
  });

  it('limites: prazo de 20 s esgotado impede nova chamada', async () => {
    const a = ambiente(() => r(200, {}));
    expect(await a.orc.buscar('https://x/1')).toEqual({});
    a.avancar(20_000);
    expect(await a.orc.buscar('https://x/2')).toBeNull();
    expect(a.chamadas).toHaveLength(1);
    expect(a.orc.estado()).toEqual({ motivo: 'limite_de_leitura', limite: 'prazo' });
  });

  it('limites: 403 não repete e marca sem_permissao; 401 não repete e marca sem_acesso', async () => {
    const a = ambiente(() => r(403));
    expect(await a.orc.buscar('https://x/1')).toBeNull();
    expect(a.chamadas).toHaveLength(1);
    expect(a.orc.estado()).toEqual({ motivo: 'sem_permissao', limite: null });
    const b = ambiente(() => r(401));
    expect(await b.orc.buscar('https://x/1')).toBeNull();
    expect(b.chamadas).toHaveLength(1);
    expect(b.orc.estado().motivo).toBe('sem_acesso');
  });

  it('limites: 429 espera o Retry-After e repete uma vez', async () => {
    const a = ambiente((_u, n) => (n === 1 ? r(429, {}, 2_500) : r(200, { ok: 1 })));
    expect(await a.orc.buscar('https://x/1')).toEqual({ ok: 1 });
    expect(a.esperas).toEqual([2_500]);
    expect(a.chamadas).toHaveLength(2);
    expect(a.orc.estado().motivo).toBeNull();
  });

  it('limites: 429 cujo Retry-After não cabe no prazo restante não espera nem repete', async () => {
    const a = ambiente(() => r(429, {}, 15_000));
    a.avancar(6_000); // restam 14 s < 15 s
    expect(await a.orc.buscar('https://x/1')).toBeNull();
    expect(a.esperas).toEqual([]);
    expect(a.chamadas).toHaveLength(1);
    expect(a.orc.estado()).toEqual({ motivo: 'limite_de_leitura', limite: 'prazo' });
  });

  it('limites: 5xx repete só 1 vez; segunda falha devolve null sem motivo de orçamento', async () => {
    const a = ambiente(() => r(500));
    expect(await a.orc.buscar('https://x/1')).toBeNull();
    expect(a.chamadas).toHaveLength(2);
    expect(a.orc.estado()).toEqual({ motivo: null, limite: null });
  });

  it('limites: no máximo 4 chamadas simultâneas', async () => {
    let ativas = 0;
    let pico = 0;
    const a = ambiente(async () => {
      ativas++; pico = Math.max(pico, ativas);
      await new Promise((ok) => setTimeout(ok, 5));
      ativas--;
      return r(200, {});
    });
    await Promise.all(Array.from({ length: 10 }, (_, i) => a.orc.buscar(`https://x/${i}`)));
    expect(pico).toBe(4);
    expect(a.chamadas).toHaveLength(10);
  });

  it('limites: listagem E1 truncada pelo teto de páginas é incompleta, nunca completa', async () => {
    // 30 páginas de 1 linha; o teto de 20 corta a leitura
    const a = ambiente((url) => {
      const o = Number(/offset=(\d+)/.exec(url)![1]);
      return r(200, { paging: { offset: o, limit: 1, total: 30 }, results: [camp(o + 1, 1)] });
    });
    const l = await lerCampanhasPeriodo({ buscar: a.orc.buscar, agora: () => 'T' }, 7, ATUAL);
    expect(l.completo).toBe(false);
    expect(l.campanhas).toHaveLength(20);
    expect(a.orc.estado().limite).toBe('paginas');
  });

  it('limites: resposta que chega depois do prazo é descartada com motivo', async () => {
    let t = 0;
    const orc = criarLeituraOrcada({
      buscar: async () => { t = 21_000; return r(200, { tarde: 1 }); },
      agoraMs: () => t, esperar: async () => {},
    });
    expect(await orc.buscar('https://x/1')).toBeNull();
    expect(orc.estado()).toEqual({ motivo: 'limite_de_leitura', limite: 'prazo' });
  });

  it('limites: fetch que nunca resolve é abortado no prazo', async () => {
    let t = 0;
    let disparar: () => void = () => {};
    let abortado = false;
    const orc = criarLeituraOrcada({
      buscar: (_u, sinal) => { sinal?.addEventListener('abort', () => { abortado = true; }); return new Promise(() => {}); },
      agoraMs: () => t, esperar: async () => {},
      agendar: (ms, fn) => { expect(ms).toBe(20_000); disparar = fn; return () => {}; },
    });
    const p = orc.buscar('https://x/1');
    await Promise.resolve(); await Promise.resolve();
    t = 20_000; disparar();
    expect(await p).toBeNull();
    expect(abortado).toBe(true);
    expect(orc.estado()).toEqual({ motivo: 'limite_de_leitura', limite: 'prazo' });
  });

  it('limites: busca nova durante a liberação não fura as 4 vagas', async () => {
    for (let ticks = 0; ticks <= 8; ticks++) { // varre o ponto da intercalação entre liberar e o aguardante retomar
      let ativas = 0;
      let pico = 0;
      const liberar: (() => void)[] = [];
      const a = ambiente(() => {
        ativas++; pico = Math.max(pico, ativas);
        return new Promise((ok) => liberar.push(() => { ativas--; ok(r(200, {})); }));
      });
      const ps = Array.from({ length: 5 }, (_, i) => a.orc.buscar(`https://x/${i}`)); // 4 ativas + 1 na fila
      await new Promise((ok) => setTimeout(ok, 0));
      liberar[0]();
      for (let k = 0; k < ticks; k++) await Promise.resolve();
      ps.push(a.orc.buscar('https://x/nova'));
      await new Promise((ok) => setTimeout(ok, 0));
      while (liberar.length) { liberar.shift()!(); await new Promise((ok) => setTimeout(ok, 0)); }
      await Promise.all(ps);
      expect(pico, `ticks=${ticks}`).toBe(4);
    }
  });

  it('ramo: 403 e prazo no ramo ficam no ramo; páginas e chamadas são as mesmas da requisição', async () => {
    const a = ambiente((u) => (u.includes('negado') ? r(403) : r(200, { ok: 1 })));
    const ramo = a.orc.ramo();
    expect(await ramo.buscar('https://x/negado')).toBeNull();
    expect(ramo.estado()).toEqual({ motivo: 'sem_permissao', limite: null });
    expect(await ramo.buscar('https://x/1')).toBeNull(); // definitivo no ramo
    expect(a.orc.estado()).toEqual({ motivo: null, limite: null });
    expect(await a.orc.buscar(pag(0))).toEqual({ ok: 1 });
    expect(a.orc.restante()).toEqual({ paginas: 19, chamadas: 30 });
    const outro = a.orc.ramo();
    a.avancar(20_000);
    expect(await outro.buscar('https://x/2')).toBeNull();
    expect(outro.estado()).toEqual({ motivo: 'limite_de_leitura', limite: 'prazo' });
    expect(a.orc.estado().motivo).toBeNull();
  });
});

describe('anúncios da campanha (E5, Task 31a)', () => {
  const J = { desde: '2026-10-01', ate: '2026-10-03' };
  const JA = { desde: '2026-09-28', ate: '2026-09-30' };
  const anuncio = (n: number, campanha = 9) => ({
    item_id: `MLB${n}`, campaign_id: campanha, status: 'active', title: `Anúncio ${n}`, metrics: { cost: n, clicks: 1 },
  });
  const lista = (qtd: number, campanha = 9) => Array.from({ length: qtd }, (_, i) => anuncio(i + 1, campanha));
  const diasDe = (desde: string, ate: string) => {
    const out: Record<string, unknown>[] = [];
    for (let t = Date.parse(desde); t <= Date.parse(ate); t += 86_400_000) out.push({ date: new Date(t).toISOString().slice(0, 10), cost: 1 });
    return out;
  };
  // ML falso: E1 com as campanhas do anunciante 7, E3/E4 da campanha e E5 paginado pelo `limit` da URL.
  function servidorE5(porJanela: Record<string, unknown[]>, camps = [camp(9, 1)]) {
    const urls: string[] = [];
    const buscar = async (url: string) => {
      urls.push(url);
      const q = new URL(`https://x${url}`).searchParams;
      const desde = q.get('date_from')!;
      const offset = Number(q.get('offset'));
      if (url.includes('/ads/search')) {
        const todas = porJanela[desde] ?? [];
        const limit = Number(q.get('limit'));
        return { paging: { offset, limit, total: todas.length }, results: todas.slice(offset, offset + limit) };
      }
      if (/product_ads\/campaigns\/\d+\?/.test(url)) {
        return url.includes('DAILY') ? { results: diasDe(desde, q.get('date_to')!) } : { metrics: { cost: 3 } };
      }
      return { paging: { offset, limit: 50, total: camps.length }, results: camps.slice(offset, offset + 50) };
    };
    return { urls, buscar, deps: { buscar, agora: () => 'T' } };
  }
  // Orçamento real (criarLeituraOrcada) por cima do servidor falso.
  function orcado(s: ReturnType<typeof servidorE5>) {
    const orc = criarLeituraOrcada({
      buscar: async (url) => ({ status: 200, retryAfterMs: null, corpo: await s.buscar(url) }),
      agoraMs: () => 0, esperar: async () => {}, agendar: () => () => {},
    });
    return { orc, deps: { buscar: orc.buscar, agora: () => 'T', restante: orc.restante } };
  }
  const e5 = (urls: string[]) => urls.filter((u) => u.includes('/ads/search'));

  it('linhas de outra campanha são descartadas; métricas vêm de `metrics` e o título da resposta', async () => {
    const s = servidorE5({
      [J.desde]: [anuncio(1), anuncio(2, 8), { ...anuncio(3), title: undefined }],
      [JA.desde]: [anuncio(1)],
    });
    const r = leitura(await lerEscopoCampanha(s.deps, 7, 9, J, JA));
    expect(r.anunciosMotivo).toBeNull();
    expect(r.anuncios!.map((a) => a.itemId)).toEqual(['MLB1', 'MLB3']);
    const [a1, a3] = r.anuncios!;
    expect(a1.titulo).toBe('Anúncio 1');
    expect(a1.statusAds).toBe('active');
    expect(a1.atual.resumo.cost).toEqual({ valor: 1, motivo: null });
    expect(a1.atual.janela).toEqual(J);
    expect(a1.anterior?.resumo.cost).toEqual({ valor: 1, motivo: null });
    expect(a3.titulo).toBeNull();
    expect(a3.anterior).toBeNull(); // sem linha na anterior lida inteira: sem zero presumido
    expect(e5(s.urls).every((u) => u.includes('filters[campaign_id]=9'))).toBe(true);
  });

  it('paginação completa da janela atual', async () => {
    const s = servidorE5({ [J.desde]: lista(120) });
    const r = leitura(await lerEscopoCampanha(s.deps, 7, 9, J, null));
    expect(r.anunciosMotivo).toBeNull();
    expect(r.anuncios).toHaveLength(120);
    expect(e5(s.urls).map((u) => /offset=(\d+)/.exec(u)![1])).toEqual(['0', '50', '100']);
  });

  it('linha malformada ou item repetido: lista indisponível, nunca parcial', async () => {
    for (const ruins of [[anuncio(1), { campaign_id: 9, metrics: {} }], [anuncio(1), anuncio(1)]]) {
      const s = servidorE5({ [J.desde]: ruins });
      const r = leitura(await lerEscopoCampanha(s.deps, 7, 9, J, null));
      expect(r.anuncios).toBeNull();
      expect(r.anunciosMotivo).toBe('resposta_invalida');
    }
  });

  it('anterior que estoura o orçamento: anterior null com motivo e a lista atual inteira', async () => {
    // 2 páginas de E1 (prova) + 10 da atual cabem; a anterior (+10) não: para antes de estourar o teto.
    const s = servidorE5({ [J.desde]: lista(500), [JA.desde]: lista(500) });
    const o = orcado(s);
    const r = leitura(await lerEscopoCampanha(o.deps, 7, 9, J, JA));
    expect(r.anuncios).toHaveLength(500);
    expect(r.anuncios!.every((a) => a.anterior === null && a.atual.completo)).toBe(true);
    expect(r.anunciosMotivo).toBe('limite_de_leitura');
    expect(r.comparacao.estado).toBe('disponivel'); // E3/E4 das duas janelas lidos antes do E5
    expect(o.orc.estado().motivo).toBeNull(); // o teto não foi tocado: o resto da requisição segue
  });

  it('atual que estoura o orçamento: anuncios null com motivo', async () => {
    const s = servidorE5({ [J.desde]: lista(1050) });
    const o = orcado(s);
    const r = leitura(await lerEscopoCampanha(o.deps, 7, 9, J, null));
    expect(r.anuncios).toBeNull();
    expect(r.anunciosMotivo).toBe('limite_de_leitura');
    expect(r.atual.completo).toBe(true);
    expect(o.orc.estado().motivo).toBeNull();
  });

  it('campanha sem pertencimento: nenhuma chamada E5', async () => {
    const s = servidorE5({ [J.desde]: lista(3) }, [camp(1, 1)]);
    const r = await lerEscopoCampanha(s.deps, 7, 9, J, JA);
    expect('recusa' in r).toBe(true);
    expect(e5(s.urls)).toEqual([]);
  });
});
