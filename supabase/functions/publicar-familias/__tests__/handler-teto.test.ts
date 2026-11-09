// ADR-0195 — fronteira real do handler: CREATE acima do teto só vai ao split com formato `legacy`
// confirmado; qualquer dúvida segue para o `publish` de hoje, sem derrubar a publicação.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Linha = Record<string, unknown>;
const f = vi.hoisted(() => ({
  serve: vi.fn(),
  create: [] as Array<Record<string, unknown>>,
  update: [] as Array<Record<string, unknown>>,
  variacoes: [] as Array<Record<string, unknown>>,
  formatos: [] as Array<Record<string, unknown>>,
  conexao: null as Record<string, unknown> | null,
  formatoErro: false,
  leituras: [] as string[],
  enfileirados: [] as Array<{ alvo: string; job: { familia_id: string; versoes_kit?: Record<string, number> } }>,
  componentes: [] as string[],
  politicas: [] as Array<Record<string, unknown>>,
}));

function builder(tabela: string) {
  const resolver = (): { data: unknown; error: { message: string } | null } => {
    f.leituras.push(tabela);
    if (tabela === 'variacoes') return { data: f.variacoes, error: null };
    if (tabela === 'marketplace_connections') return { data: f.conexao, error: null };
    if (tabela === 'familias') return { data: [{ id: 'fam-1', categoria_ml_id: 'MLB1' }], error: null };
    if (tabela === 'sku_politica_kit') return { data: f.politicas, error: null };
    if (tabela === 'ml_formato_publicacao') {
      return f.formatoErro ? { data: null, error: { message: 'fora do ar' } } : { data: f.formatos, error: null };
    }
    return { data: [], error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q, eq: () => q, in: () => q, update: () => q,
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
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: (t: string) => builder(t),
    rpc: async (n: string, a: { p_operacao: string; p_codigos?: string[] }) => {
      if (n === 'kit_skus_participantes') {
        f.leituras.push(n);
        return { data: f.componentes.filter((c) => a.p_codigos!.includes(c)), error: null };
      }
      return { data: a.p_operacao === 'CREATE' ? f.create : f.update, error: null };
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
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});

const FAMILIA = { id: 'fam-1', lote_id: 'lote-1', user_id: 'user-1', codigo_pai: '000', motivo: null };
const cor = (estoque: number): Linha => ({ familia_id: 'fam-1', preco_publicacao: 10, tamanho: null, estoque });

beforeEach(() => {
  f.create = [FAMILIA]; f.update = [];
  f.variacoes = [cor(60_000), cor(60_000)];
  f.formatos = [{ categoria_id: 'MLB1', formato: 'legacy' }];
  f.conexao = { id: 'conn-1', org_id: 'org-1', canal: 'mercado_livre', conta_externa_id: 's', expires_at: null };
  f.formatoErro = false; f.leituras = []; f.enfileirados = []; f.componentes = []; f.politicas = [];
});

const publicar = async () => {
  const r = await handler(new Request('http://localhost', {
    method: 'POST', headers: { Authorization: 'Bearer x' }, body: JSON.stringify({ familia_ids: ['fam-1'] }),
  }));
  expect(r.status).toBe(200);
  return f.enfileirados.map((e) => e.alvo);
};

describe('publicar-familias — CREATE acima do teto (ADR-0195)', () => {
  it('formato legacy confirmado → split', async () => {
    expect(await publicar()).toEqual(['split']);
  });

  it('formato user_products → publish', async () => {
    f.formatos = [{ categoria_id: 'MLB1', formato: 'user_products' }];
    expect(await publicar()).toEqual(['publish']);
  });

  it('sem cache → publish', async () => {
    f.formatos = [];
    expect(await publicar()).toEqual(['publish']);
  });

  it('org sem conexão → publish', async () => {
    f.conexao = null;
    expect(await publicar()).toEqual(['publish']);
  });

  it('falha ao ler o cache → publish, com console.error', async () => {
    f.formatoErro = true;
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await publicar()).toEqual(['publish']);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it('soma dentro do limite e preço uniforme → publish', async () => {
    f.variacoes = [cor(60_000), cor(39_999)];
    expect(await publicar()).toEqual(['publish']);
  });

  it('UPDATE acima do limite nunca lê o cache nem divide por soma', async () => {
    f.create = []; f.update = [FAMILIA];
    expect(await publicar()).toEqual(['update']);
    expect(f.leituras).not.toContain('ml_formato_publicacao');
  });
});

// ADR-0160 (emenda 2026-11-09): CREATE divergente consulta o cache; categoria `user_products` vai à saga.
describe('publicar-familias — CREATE com preços divergentes (ADR-0160)', () => {
  const comPreco = (preco: number, estoque = 10): Linha => ({ ...cor(estoque), preco_publicacao: preco });
  const divergentes = () => [comPreco(133.15), comPreco(141.35), comPreco(155.7)];

  it('CREATE divergente com categoria user_products no cache → publish', async () => {
    f.variacoes = divergentes();
    f.formatos = [{ categoria_id: 'MLB1', formato: 'user_products' }];
    expect(await publicar()).toEqual(['publish']);
  });

  it('CREATE divergente sem cache → split', async () => {
    f.variacoes = divergentes();
    f.formatos = [];
    expect(await publicar()).toEqual(['split']);
  });

  it('CREATE divergente com cache legacy → split', async () => {
    f.variacoes = divergentes();
    expect(await publicar()).toEqual(['split']);
  });

  it('CREATE divergente acima do teto com cache user_products → publish', async () => {
    f.variacoes = [comPreco(133.15, 60_000), comPreco(141.35, 60_000), comPreco(155.7, 60_000)];
    f.formatos = [{ categoria_id: 'MLB1', formato: 'user_products' }];
    expect(await publicar()).toEqual(['publish']);
  });
});

// ADR-0200 (Task 5): a versão da política de cada SKU de kit é capturada no enfileiramento, e a publicação
// a compara sob a exclusão. Org sem o módulo: nenhuma leitura de kit e job igual ao de hoje.
describe('publicar-familias — versão da política do kit no job', () => {
  const comModulo = (codigo: string, modulos: string[]): Linha => ({
    ...cor(10), codigo, organizations: { modulos_habilitados: modulos },
  });

  it('CREATE de SKU de kit leva versoes_kit no job', async () => {
    f.variacoes = [comModulo('V1', ['kit_variacao']), comModulo('V2', ['kit_variacao'])];
    f.componentes = ['V1'];
    f.politicas = [{ codigo: 'V1', versao: 7 }];
    expect(await publicar()).toEqual(['publish']);
    expect(f.enfileirados[0].job.versoes_kit).toEqual({ V1: 7 });
  });

  it('SKU de kit sem linha de política: versão 0', async () => {
    f.variacoes = [comModulo('V1', ['kit_variacao'])];
    f.componentes = ['V1'];
    await publicar();
    expect(f.enfileirados[0].job.versoes_kit).toEqual({ V1: 0 });
  });

  it('org sem o módulo: job sem versoes_kit e nenhuma leitura de kit', async () => {
    f.variacoes = [comModulo('V1', [])];
    f.componentes = ['V1'];
    await publicar();
    expect(f.enfileirados[0].job.versoes_kit).toBeUndefined();
    expect(f.leituras.filter((t) => t.startsWith('kit_') || t === 'sku_politica_kit')).toEqual([]);
  });
});
