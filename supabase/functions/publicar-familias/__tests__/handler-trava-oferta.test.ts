// Trava da oferta no UPDATE (emenda ADR-0196): fronteira real do handler, com a fiação de trava-oferta.ts e o ML falso.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Linha = Record<string, unknown>;
const f = vi.hoisted(() => ({
  serve: vi.fn(),
  familias: [] as Array<Record<string, unknown>>,
  variacoes: [] as Array<Record<string, unknown>>,
  anuncios: [] as Array<Record<string, unknown>>,
  itens: [] as Array<Record<string, unknown>>,
  origens: {} as Record<string, string>,
  conexao: null as Record<string, unknown> | null,
  erroEm: null as string | null,
  reservas: [] as Array<{ operacao: string; ids: string[] }>,
  enfileirados: [] as Array<{ alvo: string; job: { familia_id: string } }>,
  vivos: {} as Record<string, unknown>,
  encerrados: [] as string[],
  ofertas: {} as Record<string, unknown>,
  leiturasML: [] as string[],
}));

function builder(tabela: string) {
  let id: unknown;
  const dados = () => {
    if (tabela === 'familias') return f.familias;
    if (tabela === 'variacoes') return f.variacoes;
    if (tabela === 'anuncios_externos') return f.anuncios;
    if (tabela === 'anuncios_externos_itens') return f.itens;
    return [];
  };
  const resolver = () => {
    if (f.erroEm === tabela) return { data: null, error: { message: 'fora do ar' } };
    if (tabela === 'marketplace_connections') return { data: f.conexao, error: null };
    if (tabela === 'lotes') return { data: { origem: f.origens[id as string] ?? 'planilha' }, error: null };
    return { data: dados(), error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q, in: () => q, update: () => q, order: () => q, range: () => q, or: () => q, gt: () => q,
    eq: (c: string, v: unknown) => { if (c === 'id') id = v; return q; },
    maybeSingle: async () => resolver(),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko),
  };
  return q;
}

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn().mockResolvedValue({ userId: 'user-1', orgId: 'org-1', isAdmin: true, support: null }),
}));
vi.mock('../../_shared/support-audit.ts', () => ({ auditarOperacaoSuporte: vi.fn() }));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'tok' }));
vi.mock('../../_shared/anuncios/estado.ts', () => ({ garantirAnuncioExterno: vi.fn(), claimAnuncioExterno: vi.fn(async () => null) }));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: (t: string) => builder(t),
    rpc: async (_n: string, a: { p_operacao: string; p_familia_ids: string[] }) => {
      f.reservas.push({ operacao: a.p_operacao, ids: a.p_familia_ids });
      return {
        data: f.familias
          .filter((x) => x.operacao === a.p_operacao && a.p_familia_ids.includes(x.id as string))
          .map((x) => ({ id: x.id, lote_id: x.lote_id, user_id: 'user-1', codigo_pai: x.codigo_pai, motivo: null })),
        error: null,
      };
    },
  }),
}));
vi.mock('../../_shared/queue.ts', () => ({
  garantirFilaSerial: vi.fn(async () => {}),
  enfileirarPublicacaoCanal: vi.fn(async () => 'm'),
  enfileirarPublicacoes: vi.fn(async (itens: Array<{ alvo: string; job: { familia_id: string } }>) => {
    f.enfileirados.push(...itens);
    return itens.map(() => 'm');
  }),
}));

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => 'http://localhost' } });
  vi.stubGlobal('fetch', vi.fn(async (entrada: string) => {
    const url = new URL(entrada);
    f.leiturasML.push(url.pathname);
    if (url.pathname === '/items/bulk') {
      return new Response(JSON.stringify(url.searchParams.get('ids')!.split(',').map((id) => (
        id in f.vivos ? { status_code: 200, body: { id, price: f.vivos[id], status: f.encerrados.includes(id) ? 'closed' : 'active' } } : { status_code: 404 }
      ))));
    }
    const id = url.pathname.split('/').pop()!;
    return new Response(JSON.stringify(f.ofertas[id] ?? []));
  }));
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});

const update = (id: string, over: Linha = {}): Linha => ({
  id, lote_id: `lote-${id}`, codigo_pai: `pai-${id}`, ml_item_id: `MLB-${id}`, operacao: 'UPDATE', status: 'pronto', ...over,
});
const cor = (familia_id: string, codigo: string, preco_publicacao: number | string | null): Linha => ({
  familia_id, codigo, preco_publicacao, tamanho: null, estoque: 1,
});
const dealDe = (price: number) => [{ id: 'P1', type: 'DEAL', status: 'started', price, offer_id: 'OFFER-1' }];
const MOTIVO = 'Preço igual ou abaixo da oferta de R$ 80,00 — ajuste a oferta antes';
const INCONCLUSIVA = 'Não foi possível conferir promoções — tente de novo';

beforeEach(() => {
  f.familias = [update('a'), update('b')];
  f.variacoes = [cor('a', 'A1', 70), cor('b', 'B1', 70)];
  f.anuncios = []; f.itens = []; f.origens = {}; f.erroEm = null;
  f.conexao = { id: 'conn-1', org_id: 'org-1', canal: 'mercado_livre', conta_externa_id: 's', expires_at: null };
  f.reservas = []; f.enfileirados = []; f.leiturasML = []; f.encerrados = [];
  f.vivos ={ 'MLB-a': 100, 'MLB-b': 100 };
  f.ofertas = { 'MLB-a': dealDe(80) };
});

const publicar = async (corpo: Linha = {}) => {
  const r = await handler(new Request('http://localhost', {
    method: 'POST', headers: { Authorization: 'Bearer x' },
    body: JSON.stringify({ familia_ids: f.familias.map((x) => x.id), ...corpo }),
  }));
  return { r, corpo: await r.clone().json().catch(() => null) as { recusadas: unknown[]; enfileiradas: number } | null };
};
const enfileiradas = () => f.enfileirados.map((e) => e.job.familia_id);
const reservadosEm = (operacao: string) => f.reservas.find((x) => x.operacao === operacao)!.ids;

describe('publicar-familias — trava da oferta', () => {
  it('produto reprovado não é reservado nem enfileirado e volta em recusadas; o outro segue', async () => {
    const { r, corpo } = await publicar();
    expect(r.status).toBe(200);
    expect(corpo!.recusadas).toEqual([{ familia_id: 'a', motivo: MOTIVO }]);
    expect(reservadosEm('CREATE')).toEqual(['b']);
    expect(reservadosEm('UPDATE')).toEqual(['b']);
    expect(enfileiradas()).toEqual(['b']);
  });

  it('tudo reprovado devolve 409 com o motivo', async () => {
    f.familias = [update('a')];
    const { r } = await publicar();
    expect(r.status).toBe(409);
    expect(await r.text()).toBe(MOTIVO);
    expect(f.enfileirados).toEqual([]);
  });

  it('somente_estoque_global não confere nada', async () => {
    await publicar({ somente_estoque_global: true });
    expect(f.leiturasML).toEqual([]);
    expect(enfileiradas()).toEqual(['a', 'b']);
  });

  it('override vale pela mesma resolução: inverte o global família a família', async () => {
    const aSoEstoque = await publicar({ somente_estoque_overrides: ['a'] });
    expect(aSoEstoque.corpo!.recusadas).toEqual([]);
    expect(enfileiradas()).toEqual(['a', 'b']);

    f.enfileirados = [];
    const aAtualiza = await publicar({ somente_estoque_global: true, somente_estoque_overrides: ['a'] });
    expect(aAtualiza.corpo!.recusadas).toEqual([{ familia_id: 'a', motivo: MOTIVO }]);
    expect(enfileiradas()).toEqual(['b']);
  });

  it('CREATE (sem ml_item_id) não é conferido, mesmo no lote misto', async () => {
    f.familias = [update('a'), { ...update('n'), ml_item_id: null, operacao: 'CREATE' }];
    f.variacoes.push(cor('n', 'N1', 1));
    const { corpo } = await publicar();
    expect(corpo!.recusadas).toEqual([{ familia_id: 'a', motivo: MOTIVO }]);
    expect(reservadosEm('CREATE')).toEqual(['n']);
    expect(enfileiradas()).toEqual(['n']);
  });

  it('família que a reserva não pegaria (já publicando) não é conferida', async () => {
    f.familias = [update('a', { status: 'publicando' })];
    await publicar();
    expect(f.leiturasML).toEqual([]);
  });

  it('família Legacy compara o preço da família com o ml_item_id', async () => {
    f.familias = [update('a')];
    f.variacoes = [cor('a', 'A1', '81.00'), cor('a', 'A2', '81.00')];
    expect((await publicar()).r.status).toBe(200);
    expect(enfileiradas()).toEqual(['a']);
  });

  it('família UP compara cada item com o preço da própria cor', async () => {
    f.familias = [update('a')];
    f.anuncios = [{ id: 'raiz-a', codigo_pai: 'pai-a', particao: 0, item_externo_id: null, variacoes_externas: null }];
    f.itens = [
      { anuncio_externo_id: 'raiz-a', sku: 'A1', item_externo_id: 'MLB-1', status: 'ativo', retirado: false },
      { anuncio_externo_id: 'raiz-a', sku: 'A2', item_externo_id: 'MLB-2', status: 'ativo', retirado: false },
    ];
    f.variacoes = [cor('a', 'A1', 90), cor('a', 'A2', 70)];
    f.vivos = { 'MLB-1': 100, 'MLB-2': 100 };
    f.ofertas = { 'MLB-1': dealDe(80) };
    expect((await publicar()).r.status).toBe(200); // A1 fica acima da oferta; a de A2 não existe

    f.ofertas = { 'MLB-2': dealDe(80) };
    const { r } = await publicar();
    expect(r.status).toBe(409);
    expect(await r.text()).toBe(MOTIVO);
  });

  it('família em partições compara cada anúncio com o menor preço das cores dele', async () => {
    f.familias = [update('a')];
    f.anuncios = [
      { id: 'p0', codigo_pai: 'pai-a', particao: 0, item_externo_id: 'MLB-p0', variacoes_externas: { A1: {} } },
      { id: 'p1', codigo_pai: 'pai-a', particao: 1, item_externo_id: 'MLB-p1', variacoes_externas: { A2: {}, A3: {} } },
    ];
    f.variacoes = [cor('a', 'A1', 90), cor('a', 'A2', 70), cor('a', 'A3', 75)];
    f.vivos = { 'MLB-p0': 100, 'MLB-p1': 100 };
    f.ofertas = { 'MLB-p1': dealDe(80) };
    const { r } = await publicar();
    expect(r.status).toBe(409);
    expect(await r.text()).toBe(MOTIVO);
  });

  it('Adicionar variação em Legacy (lote manual): preço publicado preservado, nada a conferir', async () => {
    f.origens = { 'lote-a': 'manual', 'lote-b': 'manual' };
    const { corpo } = await publicar();
    expect(corpo!.recusadas).toEqual([]);
    expect(f.leiturasML).toEqual([]);
    expect(enfileiradas()).toEqual(['a', 'b']);
  });

  describe('Adicionar variação em UP (lote manual)', () => {
    beforeEach(() => {
      f.familias = [update('a')];
      f.origens = { 'lote-a': 'manual' };
      f.anuncios = [{ id: 'raiz-a', codigo_pai: 'pai-a', particao: 0, item_externo_id: null, variacoes_externas: null }];
      f.variacoes = [cor('a', 'ATIVO', 70), cor('a', 'VOLTA', 70)];
      f.vivos = { 'MLB-1': 100, 'MLB-2': 100 };
    });
    const filhos = (volta: Linha) => [
      { anuncio_externo_id: 'raiz-a', sku: 'ATIVO', item_externo_id: 'MLB-1', status: 'ativo', retirado: false },
      { anuncio_externo_id: 'raiz-a', sku: 'VOLTA', item_externo_id: 'MLB-2', ...volta },
    ];

    it('filho criado ou readicionado recebe preço: é conferido e recusado', async () => {
      f.ofertas = { 'MLB-2': dealDe(80) };
      for (const volta of [{ status: 'criado', retirado: false }, { status: 'pausado', retirado: true }]) {
        f.itens = filhos(volta);
        const { r } = await publicar();
        expect(r.status).toBe(409);
        expect(await r.text()).toBe(MOTIVO);
      }
    });

    it('filho ativo é preservado: a oferta dele não recusa e ele nem é lido', async () => {
      f.itens = filhos({ status: 'criado', retirado: false });
      f.ofertas = { 'MLB-1': dealDe(80) };
      expect((await publicar()).r.status).toBe(200);
      expect(f.leiturasML).not.toContain('/seller-promotions/items/MLB-1');
    });
  });

  it('org sem conexão ML segue sem recusa nova', async () => {
    f.conexao = null;
    const { corpo } = await publicar();
    expect(corpo!.recusadas).toEqual([]);
    expect(f.leiturasML).toEqual([]);
    expect(enfileiradas()).toEqual(['a', 'b']);
  });

  it('erro ao ler a conexão recusa as famílias conferíveis, sem liberar o UPDATE', async () => {
    f.erroEm = 'marketplace_connections';
    const { r } = await publicar();
    expect(r.status).toBe(409);
    expect(await r.text()).toBe(INCONCLUSIVA);
    expect(reservadosEm('UPDATE')).toEqual([]);
    expect(f.enfileirados).toEqual([]);
  });

  it('erro ao ler a conexão não recusa família sem nada a conferir', async () => {
    f.erroEm = 'marketplace_connections';
    f.origens = { 'lote-a': 'manual' };
    const { corpo } = await publicar();
    expect(corpo!.recusadas).toEqual([{ familia_id: 'b', motivo: INCONCLUSIVA }]);
    expect(enfileiradas()).toEqual(['a']);
  });

  it('MLB encerrado não recusa: segue para o worker, que procura o sucessor', async () => {
    f.encerrados = ['MLB-a'];
    const { corpo } = await publicar();
    expect(corpo!.recusadas).toEqual([]);
    expect(enfileiradas()).toEqual(['a', 'b']);
  });

  it('MLB sem resposta recusa só o produto dele', async () => {
    f.vivos = { 'MLB-b': 100 };
    f.ofertas = {};
    const { corpo } = await publicar();
    expect(corpo!.recusadas).toEqual([{ familia_id: 'a', motivo: INCONCLUSIVA }]);
    expect(enfileiradas()).toEqual(['b']);
  });

  it('canal sem ML não confere', async () => {
    await publicar({ canais: ['shopee'] });
    expect(f.leiturasML).toEqual([]);
    expect(f.reservas).toEqual([]);
  });

  it('erro de banco ao montar os alvos devolve 500 e nada é reservado', async () => {
    f.erroEm = 'variacoes';
    const { r } = await publicar();
    expect(r.status).toBe(500);
    expect(f.reservas).toEqual([]);
  });
});
