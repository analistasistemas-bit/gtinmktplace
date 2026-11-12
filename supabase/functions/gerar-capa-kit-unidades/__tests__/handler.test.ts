import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Padrão copiado de `gerar-foto-kit/__tests__/handler.test.ts` (mocks `vi.hoisted`, PNG vertical 896×1200).
const png = (l: number, a: number) => {
  const be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be(l), ...be(a), 8, 6, 0, 0, 0));
};
const PNG_VERTICAL = png(896, 1200);

const f = vi.hoisted(() => ({
  serve: vi.fn(),
  admin: true,
  modulos: ['imagem_ia'] as string[],
  base: null as unknown,
  moderadas: [] as string[],
  moderacaoPedida: [] as string[][],
  imagemFalha: false,
  erroImagem: 'provedor caiu',
  codigoErro: undefined as unknown,
  objetos: new Set<string>(),
  insertErro: '' as string,
  tetoErro: false,
  imagemB64: '',
  custo: 0.041 as number | undefined,
  chamadasImagem: [] as Array<Record<string, unknown>>,
  chamadasVisao: 0,
  verificacoes: [] as unknown[],
  pedidosVerificacao: [] as Array<Record<string, unknown>>,
  linhas: [] as Array<Record<string, unknown>>,
  uploads: [] as string[],
  downloads: [] as string[],
  escritasProibidas: [] as string[],
}));

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn(async () => ({ userId: 'u1', orgId: 'org-1', isAdmin: f.admin })),
}));
vi.mock('../../_shared/support-audit.ts', () => ({ auditarOperacaoSuporte: vi.fn(async () => {}) }));
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexaoEstrita: vi.fn(async () => ({ id: 'cx' })) }));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn(async () => 'tok') }));
vi.mock('../../criar-kit-variacao/fotos-moderadas.ts', () => ({
  fotosEmItemModerado: vi.fn(async (_a: unknown, _o: unknown, _t: unknown, paths: string[]) => {
    f.moderacaoPedida.push(paths);
    return f.moderadas;
  }),
}));
const N = 3;
const APROVADA = { quantidade_produtos: N, texto_novo: false, fundo_neutro: true, mesmo_produto: true, observacao: 'ok' };
const ERRADA = { ...APROVADA, quantidade_produtos: 4, observacao: 'quatro unidades' };
vi.mock('../../_shared/ai/client.ts', () => ({
  openrouterClient: () => ({
    chat: { completions: { create: async (a: Record<string, unknown>) => {
      if (a.modalities) {
        f.chamadasImagem.push(a);
        if (f.imagemFalha) {
          throw Object.assign(new Error(f.erroImagem), {
            status: 500, code: f.codigoErro, headers: { authorization: 'Bearer sk-or-v1-SEGREDO' },
          });
        }
        return {
          choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${f.imagemB64}` } }] } }],
          usage: { prompt_tokens: 3000, completion_tokens: 1290, ...(f.custo !== undefined ? { cost: f.custo } : {}) },
        };
      }
      f.chamadasVisao++;
      const nome = (a.response_format as { json_schema?: { name?: string } } | undefined)?.json_schema?.name;
      if (nome !== 'verificacao_unidades') throw new Error(`visão inesperada: ${nome}`);
      f.pedidosVerificacao.push(a);
      const v = f.verificacoes.length > 0 ? f.verificacoes.shift() : APROVADA;
      if (v === 'erro') throw Object.assign(new Error('visão caiu'), { status: 503 });
      return { choices: [{ message: { content: JSON.stringify(v) } }], usage: { prompt_tokens: 1200, completion_tokens: 300, cost: 0.005 } };
    } } },
  }),
}));

function tabela(t: string) {
  const filtros: Record<string, unknown> = {};
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  let contar = false;
  let payload: Record<string, unknown> = {};
  const casam = () => f.linhas.filter((l) => l.org_id === filtros.org_id && l.request_id === filtros.request_id
    && (filtros.tentativa === undefined || Number(l.tentativa ?? 1) === filtros.tentativa));
  const achar = () => casam()[0];
  const q: Record<string, unknown> = {
    select: (_c?: string, o?: { count?: string }) => { if (o?.count) contar = true; return q; },
    order: () => q,
    eq: (c: string, v: unknown) => { filtros[c] = v; return q; },
    lt: (c: string, v: unknown) => { filtros[`${c}<`] = v; return q; },
    gte: (c: string, v: unknown) => { filtros[`${c}>=`] = v; return q; },
    insert: (row: Record<string, unknown>) => {
      if (t !== 'kit_variacao_imagens') f.escritasProibidas.push(t);
      op = 'insert'; payload = row; return q;
    },
    update: (row: Record<string, unknown>) => {
      if (t !== 'kit_variacao_imagens') f.escritasProibidas.push(t);
      op = 'update'; payload = row; return q;
    },
    delete: () => { op = 'delete'; return q; },
    maybeSingle: async () => {
      if (t === 'organizations') return { data: { modulos_habilitados: f.modulos }, error: null };
      if (t === 'configuracoes') return { data: { ai_model_imagem: null }, error: null };
      if (t === 'familias') return { data: f.base, error: null };
      if (t === 'kit_variacao_imagens') { const l = achar(); return { data: l ? { ...l } : null, error: null }; }
      return { data: null, error: null };
    },
    then: (res: (v: unknown) => void) => {
      if (t === 'profiles') return res({ data: [{ id: 'u1' }], error: null });
      if (t === 'kit_variacao_imagens') {
        if (op === 'select' && contar) {
          if (f.tetoErro) return res({ data: null, count: null, error: { message: 'x' } });
          const count = f.linhas.filter((l) => l.org_id === filtros.org_id && l.familia_base_id === filtros.familia_base_id
            && l.n === filtros.n && String(l.criado_em) >= String(filtros['criado_em>='])).length;
          return res({ data: null, count, error: null });
        }
        if (op === 'select') {
          return res({ data: casam().map((l) => ({ ...l })).sort((a, b) => Number(a.tentativa ?? 1) - Number(b.tentativa ?? 1)), error: null });
        }
        if (op === 'insert') {
          if (f.insertErro) return res({ data: null, error: { code: f.insertErro, message: 'duplicate' } });
          const mesmo = f.linhas.filter((l) => l.org_id === payload.org_id && l.request_id === payload.request_id);
          if (mesmo.some((l) => Number(l.tentativa ?? 1) === Number(payload.tentativa ?? 1) || l.status !== 'recusada')) {
            return res({ data: null, error: { code: '23505', message: 'duplicate' } });
          }
          f.linhas.push({ tentativa: 1, criado_em: new Date(Date.now()).toISOString(), ...payload });
        } else if (op === 'update') {
          const l = achar();
          const casa = l && (filtros.status === undefined || l.status === filtros.status);
          if (casa) Object.assign(l, payload);
          return res({ data: casa ? [{ ...l }] : [], error: null });
        } else if (op === 'delete') {
          const l = achar();
          const casa = l && (filtros.status === undefined || l.status === filtros.status)
            && (filtros['criado_em<'] === undefined || String(l.criado_em) < String(filtros['criado_em<']));
          if (casa) f.linhas = f.linhas.filter((x) => x !== l);
        }
      }
      return res({ data: null, error: null });
    },
  };
  return q;
}

vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: tabela,
    storage: {
      from: () => ({
        download: async (p: string) => {
          f.downloads.push(p);
          return { data: new Blob([`foto ${p}`], { type: 'image/jpeg' }), error: null };
        },
        upload: async (p: string) => { f.uploads.push(p); f.objetos.add(p); return { data: { path: p }, error: null }; },
        list: async (pasta: string, o: { search: string }) => ({
          data: [...f.objetos].filter((x) => x.startsWith(`${pasta}/${o.search}`)).map((x) => ({ name: x.slice(pasta.length + 1) })),
          error: null,
        }),
        createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://x/${p}?t=1` }, error: null }),
      }),
    },
  }),
}));

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => undefined } });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});
const REQ = '11111111-1111-4111-8111-111111111111';
const FAM = '22222222-2222-4222-8222-222222222222';
const OUTRA = '33333333-3333-4333-8333-333333333333';
const CAPA = 'org-1/lote/capa.jpg';
const PATH = `org-1/kit-variacao-ia/${REQ}.png`;
beforeEach(() => {
  f.admin = true; f.modulos = ['imagem_ia']; f.moderadas = []; f.moderacaoPedida = [];
  f.imagemFalha = false; f.erroImagem = 'provedor caiu'; f.codigoErro = undefined; f.objetos = new Set();
  f.insertErro = ''; f.tetoErro = false; f.imagemB64 = PNG_VERTICAL; f.custo = 0.041; f.chamadasImagem = []; f.chamadasVisao = 0;
  f.verificacoes = []; f.pedidosVerificacao = []; f.linhas = []; f.uploads = []; f.downloads = []; f.escritasProibidas = [];
  f.base = { capa_storage_path: CAPA, variacoes: [{ imagem_path: 'org-1/lote/var.jpg' }] };
});
const post = (b: unknown) => handler(new Request('http://localhost', { method: 'POST', body: JSON.stringify(b) }));
const ok = { request_id: REQ, familia_base_id: FAM, n: N };
const agoraMenos = (ms: number) => new Date(Date.now() - ms).toISOString();
const linhaUnidades = (x: Record<string, unknown>) => ({
  org_id: 'org-1', request_id: crypto.randomUUID(), tentativa: 1, status: 'recusada', familia_base_id: FAM, cores: null,
  rotulo: null, n: N, custo_usd: 0.05, verificacao: { aprovado: false, itens: [], motivos: ['x'] }, criado_em: agoraMenos(60_000), ...x,
});
const semIA = () => { expect(f.chamadasImagem).toHaveLength(0); expect(f.chamadasVisao).toBe(0); };

describe('gerar-capa-kit-unidades', () => {
  it('org sem imagem_ia → 403 modulo_desligado, sem IA (kit_variacao não é exigido)', async () => {
    f.modulos = ['kit_variacao'];
    const r = await post(ok);
    expect(r.status).toBe(403);
    expect((await r.json()).motivo).toBe('modulo_desligado');
    semIA();
  });

  it('não admin → 403, sem IA', async () => {
    f.admin = false;
    expect((await post(ok)).status).toBe(403);
    semIA();
  });

  it('n fora de 2..6 ou não inteiro, request_id ou familia_base_id inválidos → 400, sem reservar', async () => {
    for (const b of [{ ...ok, n: 1 }, { ...ok, n: 7 }, { ...ok, n: '3' }, { ...ok, n: 2.5 }, { ...ok, request_id: 'x' }, { ...ok, familia_base_id: 'fam-1' }]) {
      expect((await post(b)).status).toBe(400);
    }
    expect(f.linhas).toHaveLength(0);
    semIA();
  });

  it('base de outra org (não achada) → 404, sem reservar', async () => {
    f.base = null;
    expect((await post(ok)).status).toBe(404);
    expect(f.linhas).toHaveLength(0);
  });

  it('aprovada: capa como âncora, grava gerada com cores/rotulo nulos e n, path da org, custo = geração + visão', async () => {
    const r = await post(ok);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(f.downloads).toEqual([CAPA]);
    expect(f.moderacaoPedida).toEqual([[CAPA]]);
    const pedido = f.chamadasImagem[0];
    expect(pedido.model).toBe('google/gemini-nano-banana-2.1');
    expect((pedido.image_config as { aspect_ratio: string }).aspect_ratio).toBe('1:1');
    const conteudo = (pedido.messages as Array<{ content: Array<{ type: string; text?: string }> }>)[0].content;
    expect(conteudo.filter((c) => c.type === 'image_url')).toHaveLength(1);
    expect(conteudo.filter((c) => c.type === 'text')[1].text).toContain('"quantidade":3');
    // Visão: original + gerada.
    const imgsVerif = (f.pedidosVerificacao[0].messages as Array<{ content: unknown }>)[1].content as Array<{ type: string }>;
    expect(imgsVerif.filter((c) => c.type === 'image_url')).toHaveLength(2);
    expect(j).toMatchObject({ aprovado: true, proxima: false, tentativa: 1, path: PATH });
    expect(j.path.startsWith('org-1/kit-variacao-ia/')).toBe(true);
    expect(j.url).toContain('https://x/');
    expect(j.verificacao).toEqual({ aprovado: true, itens: [], motivos: [] });
    expect(j.originais).toEqual([{ cor: 'Base', urls: [`https://x/${CAPA}?t=1`] }]);
    expect(j.custo_centavos).toBe(5);
    expect(f.linhas).toHaveLength(1);
    expect(f.linhas[0]).toMatchObject({
      org_id: 'org-1', request_id: REQ, status: 'gerada', cores: null, rotulo: null, n: N, familia_base_id: FAM, storage_path: PATH,
    });
    expect(Number(f.linhas[0].custo_usd)).toBeCloseTo(0.046, 6);
    expect(f.objetos.has(PATH)).toBe(true);
    expect(f.escritasProibidas).toEqual([]);
  });

  it('base sem capa usa a foto da única variação', async () => {
    f.base = { capa_storage_path: null, variacoes: [{ imagem_path: 'u1/lote/var.jpg' }] };
    expect((await post(ok)).status).toBe(200);
    expect(f.downloads).toEqual(['u1/lote/var.jpg']);
  });

  it('sem capa e sem foto da variação (ou várias variações) → 409 sem_foto_origem, sem reservar nem IA', async () => {
    for (const base of [
      { capa_storage_path: null, variacoes: [{ imagem_path: null }] },
      { capa_storage_path: null, variacoes: [{ imagem_path: 'org-1/a.jpg' }, { imagem_path: 'org-1/b.jpg' }] },
      { capa_storage_path: 'outra-org/lote/capa.jpg', variacoes: [] },
    ]) {
      f.base = base;
      const r = await post(ok);
      expect(r.status).toBe(409);
      expect((await r.json()).motivo).toBe('sem_foto_origem');
    }
    expect(f.linhas).toHaveLength(0);
    semIA();
  });

  it('item da base moderado → 409 sem_foto_origem, sem reservar nem IA', async () => {
    f.moderadas = [CAPA];
    const r = await post(ok);
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe('sem_foto_origem');
    expect(f.linhas).toHaveLength(0);
    semIA();
  });

  it('teto: 6 tentativas da mesma (org, base, n) nas últimas 24 h → 429 teto_diario, sem reservar nem gastar', async () => {
    for (let i = 0; i < 6; i++) f.linhas.push(linhaUnidades({ status: i === 0 ? 'gerada' : 'recusada' }));
    const r = await post(ok);
    expect(r.status).toBe(429);
    expect((await r.json()).motivo).toBe('teto_diario');
    expect(f.linhas).toHaveLength(6);
    expect(f.moderacaoPedida).toHaveLength(0);
    semIA();
  });

  it('teto: linhas de outro n, outra base, outra org ou com mais de 24 h não contam', async () => {
    for (let i = 0; i < 5; i++) f.linhas.push(linhaUnidades({}));
    f.linhas.push(linhaUnidades({ n: 4 }), linhaUnidades({ familia_base_id: OUTRA }), linhaUnidades({ org_id: 'org-2' }),
      linhaUnidades({ criado_em: agoraMenos(25 * 60 * 60_000) }));
    expect((await post(ok)).status).toBe(200);
    expect(f.chamadasImagem).toHaveLength(1);
  });

  it('teto ilegível → 500, sem reservar nem IA (fail-closed)', async () => {
    f.tetoErro = true;
    expect((await post(ok)).status).toBe(500);
    expect(f.linhas).toHaveLength(0);
    semIA();
  });

  it('repetição de pedido já gerado não esbarra no teto e não chama a IA', async () => {
    const a = await (await post(ok)).json();
    for (let i = 0; i < 6; i++) f.linhas.push(linhaUnidades({}));
    const r = await post(ok);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b).toMatchObject({ existente: true, aprovado: true, path: a.path });
    expect(b.verificacao).toEqual(a.verificacao);
    expect(b.originais).toEqual(a.originais);
    expect(f.chamadasImagem).toHaveLength(1);
    expect(f.chamadasVisao).toBe(1);
  });

  it('contagem errada → reprovada (recusada, custo registrado), proxima true, motivo; a próxima leva os motivos', async () => {
    f.verificacoes = [ERRADA];
    const j1 = await (await post(ok)).json();
    expect(j1).toMatchObject({ aprovado: false, proxima: true, tentativa: 1 });
    expect(j1.path).toBeUndefined();
    expect(j1.motivos.join(' ')).toMatch(/contei 4 produtos, esperava 3/);
    expect(j1.verificacao).toEqual({ aprovado: false, itens: [], motivos: j1.motivos });
    expect(j1.previa_url).toContain(`${REQ}-t1.png`);
    expect(f.linhas[0]).toMatchObject({ tentativa: 1, status: 'recusada', n: N, cores: null });
    expect(Number(f.linhas[0].custo_usd)).toBeCloseTo(0.046, 6);
    const j2 = await (await post(ok)).json();
    expect(j2).toMatchObject({ aprovado: true, tentativa: 2, path: PATH });
    expect(JSON.stringify(f.chamadasImagem[1].messages)).toContain('contei 4 produtos');
    expect(f.linhas.map((l) => [l.tentativa, l.status])).toEqual([[1, 'recusada'], [2, 'gerada']]);
  });

  it('3 reprovações: proxima false, nunca gerada; repetir não chama a IA', async () => {
    f.verificacoes = [ERRADA, 'erro', { ...APROVADA, texto_novo: true }];
    const js = [];
    for (let i = 0; i < 3; i++) js.push(await (await post(ok)).json());
    expect(js.map((j) => [j.tentativa, j.aprovado, j.proxima])).toEqual([[1, false, true], [2, false, true], [3, false, false]]);
    expect(f.linhas.every((l) => l.status === 'recusada')).toBe(true);
    const j4 = await (await post(ok)).json();
    expect(j4).toMatchObject({ aprovado: false, proxima: false, tentativa: 3, existente: true });
    expect(f.chamadasImagem).toHaveLength(3);
  });

  it('pedido_diferente: mesmo request_id com outro n ou outra base → 409, sem IA', async () => {
    expect((await post(ok)).status).toBe(200);
    for (const b of [{ ...ok, n: 4 }, { ...ok, familia_base_id: OUTRA }]) {
      const r = await post(b);
      expect(r.status).toBe(409);
      expect((await r.json()).motivo).toBe('pedido_diferente');
    }
    expect(f.chamadasImagem).toHaveLength(1);
  });

  it('request_id de uma linha de cores (kit com variação) → 409 pedido_diferente, nunca devolve aquela foto', async () => {
    f.linhas.push({ org_id: 'org-1', request_id: REQ, tentativa: 1, status: 'gerada', familia_base_id: FAM, cores: ['Preto', 'Branco'], rotulo: 'Preto e Branco', n: null, storage_path: PATH, custo_usd: 0.05, criado_em: agoraMenos(1000) });
    const r = await post(ok);
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe('pedido_diferente');
  });

  it('imagem horizontal → reprovada sem visão e sem cobrança, nada no caminho da aprovada', async () => {
    f.imagemB64 = png(1200, 800);
    const r = await post(ok);
    expect(await r.json()).toMatchObject({ aprovado: false, proxima: true });
    expect(f.linhas[0]).toMatchObject({ status: 'recusada' });
    expect(f.pedidosVerificacao).toHaveLength(0);
    expect(f.uploads).not.toContain(PATH);
  });

  it('falha da IA libera a reserva (não cobra) e o mesmo pedido pode gerar depois', async () => {
    f.imagemFalha = true;
    expect((await post(ok)).status).toBe(502);
    expect(f.linhas).toHaveLength(0);
    f.imagemFalha = false;
    expect((await post(ok)).status).toBe(200);
  });

  it('reserva pendente abandonada é refeita', async () => {
    f.linhas.push(linhaUnidades({ request_id: REQ, status: 'pendente', verificacao: null, criado_em: agoraMenos(10 * 60_000) }));
    expect((await post(ok)).status).toBe(200);
    expect(f.linhas).toHaveLength(1);
    expect(f.linhas[0]).toMatchObject({ status: 'gerada' });
  });

  it('reserva pendente recente → 409 em_andamento, sem IA', async () => {
    f.linhas.push(linhaUnidades({ request_id: REQ, status: 'pendente', verificacao: null, criado_em: agoraMenos(1000) }));
    const r = await post(ok);
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe('em_andamento');
    semIA();
  });

  it('pendente_upload com objeto no storage é recuperado como gerada, sem gerar de novo', async () => {
    f.objetos.add(PATH);
    f.linhas.push(linhaUnidades({
      request_id: REQ, status: 'pendente_upload', storage_path: PATH, custo_usd: 0.046,
      verificacao: { aprovado: true, itens: [], motivos: [], origem_path: CAPA },
      criado_em: agoraMenos(10 * 60_000), atualizado_em: agoraMenos(10 * 60_000),
    }));
    const r = await post(ok);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ path: PATH, aprovado: true, existente: true });
    expect(j.verificacao).toEqual({ aprovado: true, itens: [], motivos: [] });
    expect(j.originais).toEqual([{ cor: 'Base', urls: [`https://x/${CAPA}?t=1`] }]);
    expect(f.linhas[0]).toMatchObject({ status: 'gerada' });
    semIA();
  });

  it('23505 na reserva → 409 em_andamento, sem IA', async () => {
    f.insertErro = '23505';
    const r = await post(ok);
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe('em_andamento');
    semIA();
  });

  it('log de erro externo não leva payload, headers nem segredo', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    f.imagemFalha = true;
    f.erroImagem = 'falhou: Authorization: Bearer sk-or-v1-SEGREDO1; https://user:SEGREDO3@api.x/v1?key=SEGREDO4 data:image/png;base64,' + 'A'.repeat(500);
    f.codigoErro = 'SEGREDO7 Basic Zm9vOmJhcg==';
    await post(ok);
    const saida = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(saida).not.toMatch(/SEGREDO|Zm9vOmJhcg|AAAAAAAAAA|falhou|quantidade|reference/);
    expect(saida).toMatch(/gerar-capa-kit-unidades/);
    expect(saida).toMatch(/status\\":500/);
  });
});
