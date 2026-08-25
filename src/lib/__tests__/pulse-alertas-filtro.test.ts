import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchPulseAlertas, contarPulseAlertas, marcarAlertasLidos, ALERTAS_POR_PAGINA } from '@/lib/pulse';

// Mesmo padrão de tests/lib/movimentos-estoque.test.ts: cadeia fluente do PostgREST, cada método
// devolve o próprio objeto, e o `await` no final resolve pelo `then`. Um único espião registra a
// query inteira que foi montada — prova o RAMO (aplica ou não `.eq('severidade', …)`), não o
// encadeamento em si.
const chamadas: Record<string, unknown[][]> = {};
function registrar(nome: string, args: unknown[]) {
  (chamadas[nome] ??= []).push(args);
}

const resposta: { data: unknown[]; error: null; count: number } = { data: [], error: null, count: 0 };

const cadeia: Record<string, unknown> = {};
for (const m of ['select', 'eq', 'lte', 'order', 'range', 'update']) {
  cadeia[m] = vi.fn((...args: unknown[]) => { registrar(m, args); return cadeia; });
}
cadeia.then = (resolve: (v: typeof resposta) => unknown) => Promise.resolve(resposta).then(resolve);

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(() => cadeia) },
}));

describe('lib/pulse — filtro de severidade e paginação (ADR-0133)', () => {
  beforeEach(() => {
    for (const k of Object.keys(chamadas)) delete chamadas[k];
    resposta.count = 0;
    resposta.data = [];
  });

  it('fetchPulseAlertas com "todos" não aplica .eq de severidade — só o de lido', async () => {
    await fetchPulseAlertas({ severidade: 'todos', pagina: 0 });
    expect(chamadas.eq).toEqual([['lido', false]]);
  });

  it('fetchPulseAlertas com "acao" aplica .eq de severidade além do de lido', async () => {
    await fetchPulseAlertas({ severidade: 'acao', pagina: 0 });
    expect(chamadas.eq).toEqual([['lido', false], ['severidade', 'acao']]);
  });

  it('fetchPulseAlertas calcula o range pela página (ALERTAS_POR_PAGINA = 50)', async () => {
    await fetchPulseAlertas({ severidade: 'todos', pagina: 2 });
    expect(chamadas.range).toEqual([[2 * ALERTAS_POR_PAGINA, 3 * ALERTAS_POR_PAGINA - 1]]);
  });

  it('contarPulseAlertas com "todos" não filtra por severidade e pede count exato', async () => {
    resposta.count = 145;
    const total = await contarPulseAlertas('todos');
    expect(chamadas.eq).toEqual([['lido', false]]);
    expect(chamadas.select).toEqual([['id', { count: 'exact', head: true }]]);
    expect(total).toBe(145);
  });

  it('contarPulseAlertas com "info" filtra por severidade', async () => {
    await contarPulseAlertas('info');
    expect(chamadas.eq).toEqual([['lido', false], ['severidade', 'info']]);
  });

  // Desempate obrigatório: o coletor grava vários alertas do mesmo produto num único insert e
  // `criado_em` (default now()) empata entre eles. Sem o segundo critério a ordem entre linhas
  // empatadas não é garantida, e páginas de LIMIT/OFFSET podem repetir ou pular linha.
  it('fetchPulseAlertas ordena por criado_em com desempate determinístico por id', () => {
    return fetchPulseAlertas({ severidade: 'todos', pagina: 0 }).then(() => {
      expect(chamadas.order).toEqual([
        ['criado_em', { ascending: false }],
        ['id', { ascending: false }],
      ]);
    });
  });

  const ANCORA = '2026-08-25T12:00:00.000Z';

  it('marcarAlertasLidos com "todos" só escopa por lido = false, sem severidade', async () => {
    await marcarAlertasLidos('todos', ANCORA);
    expect(chamadas.update).toEqual([[{ lido: true }]]);
    expect(chamadas.eq).toEqual([['lido', false]]);
  });

  it('marcarAlertasLidos com "acao" escopa por lido = false e severidade = acao', async () => {
    await marcarAlertasLidos('acao', ANCORA);
    expect(chamadas.eq).toEqual([['lido', false], ['severidade', 'acao']]);
  });

  // Contar e marcar são duas idas ao banco; o coletor roda em cron e pode inserir no intervalo.
  // Sem teto, o update alcançaria alertas que chegaram DEPOIS da contagem — marcados como lidos
  // sem nunca terem sido renderizados. A âncora é o mais novo que o operador viu.
  it('marcarAlertasLidos nunca alcança alerta mais novo que o último visto', async () => {
    await marcarAlertasLidos('acao', ANCORA);
    expect(chamadas.lte).toEqual([['criado_em', ANCORA]]);
  });
});
