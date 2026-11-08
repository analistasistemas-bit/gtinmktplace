import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PNG_VERTICAL = (() => {
  const be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be(896), ...be(1200), 8, 6, 0, 0, 0));
})();

const f = vi.hoisted(() => ({
  serve: vi.fn(),
  admin: true,
  modulos: ['kit_variacao', 'imagem_ia'] as string[],
  base: null as unknown,
  moderadas: [] as string[],
  moderacaoFalha: false,
  imagemFalha: false,
  erroImagem: 'provedor caiu',
  auditoriaFalha: false,
  atrasoModeracaoMs: 0,
  atrasoImagemMs: 0,
  uploadTrava: false,
  uploadAtrasoMs: 0,
  objetos: new Set<string>(),
  listaExiste: [] as boolean[],
  codigoErro: undefined as unknown,
  deslocamento: 0,
  imagemB64: '',
  custo: 0.041 as number | undefined,
  chamadasImagem: [] as Array<Record<string, unknown>>,
  chamadasVisao: 0,
  linhas: [] as Array<Record<string, unknown>>,
  uploads: [] as string[],
  downloads: [] as string[],
  escritasProibidas: [] as string[],
}));

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn(async () => ({ userId: 'u1', orgId: 'org-1', isAdmin: f.admin })),
}));
vi.mock('../../_shared/support-audit.ts', () => ({
  auditarOperacaoSuporte: vi.fn(async () => { if (f.auditoriaFalha) throw new Error('auditoria caiu'); }),
}));
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexaoEstrita: vi.fn(async () => ({ id: 'cx' })) }));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn(async () => 'tok') }));
vi.mock('../../criar-kit-variacao/fotos-moderadas.ts', () => ({
  fotosEmItemModerado: vi.fn(async () => {
    f.deslocamento += f.atrasoModeracaoMs;
    if (f.moderacaoFalha) throw new Error('ML /items/bulk 500');
    return f.moderadas;
  }),
}));
vi.mock('../../_shared/ai/client.ts', () => ({
  openrouterClient: () => ({
    chat: { completions: { create: async (a: Record<string, unknown>) => {
      if (a.modalities) {
        f.chamadasImagem.push(a);
        f.deslocamento += f.atrasoImagemMs;
        // No teste de relógio falso a geração também consome os timers (o tempo passa para todos).
        if (f.atrasoImagemMs) vi.advanceTimersByTime(f.atrasoImagemMs);
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
      return { choices: [{ message: { content: 'cropped jacket, elastic hem' } }], usage: { prompt_tokens: 900, completion_tokens: 60, cost: 0.003 } };
    } } },
  }),
}));

function tabela(t: string) {
  const filtros: Record<string, unknown> = {};
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  let payload: Record<string, unknown> = {};
  const achar = () => f.linhas.find((l) => l.org_id === filtros.org_id && l.request_id === filtros.request_id);
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => { filtros[c] = v; return q; },
    lt: (c: string, v: unknown) => { filtros[`${c}<`] = v; return q; },
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
        if (op === 'insert') {
          if (f.linhas.some((l) => l.org_id === payload.org_id && l.request_id === payload.request_id)) {
            return res({ data: null, error: { code: '23505', message: 'duplicate' } });
          }
          f.linhas.push({ ...payload });
        } else if (op === 'update') {
          // UPDATE condicional: só afeta a linha que casa com o filtro de status; devolve as linhas afetadas.
          const l = achar();
          const casa = l && (filtros.status === undefined || l.status === filtros.status);
          if (casa) Object.assign(l, payload);
          return res({ data: casa ? [{ ...l }] : [], error: null });
        }
        else if (op === 'delete') {
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
        download: async (p: string) => (f.downloads.push(p), { data: new Blob([`foto ${p}`], { type: 'image/jpeg' }), error: null }),
        upload: (p: string) => {
          f.uploads.push(p);
          if (f.uploadTrava) return new Promise(() => {});
          const fim = () => { f.objetos.add(p); return { data: { path: p }, error: null }; };
          return f.uploadAtrasoMs ? new Promise((res) => setTimeout(() => res(fim()), f.uploadAtrasoMs)) : Promise.resolve(fim());
        },
        list: async (pasta: string, o: { search: string }) => ({
          data: f.listaExiste.length > 0
            ? (f.listaExiste.shift() ? [{ name: o.search }] : [])
            : [...f.objetos].filter((x) => x.startsWith(`${pasta}/${o.search}`)).map((x) => ({ name: x.slice(pasta.length + 1) })),
          error: null,
        }),
        createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://x/${p}?t=1` }, error: null }),
      }),
    },
  }),
}));

let handler: (req: Request) => Promise<Response>;
const agoraReal = Date.now.bind(Date);
beforeAll(async () => {
  vi.spyOn(Date, 'now').mockImplementation(() => agoraReal() + f.deslocamento);
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => undefined } });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});
const REQ = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  f.admin = true; f.modulos = ['kit_variacao', 'imagem_ia']; f.moderadas = []; f.moderacaoFalha = false;
  f.imagemFalha = false; f.erroImagem = 'provedor caiu'; f.auditoriaFalha = false; f.atrasoModeracaoMs = 0; f.deslocamento = 0;
  f.atrasoImagemMs = 0; f.uploadTrava = false; f.codigoErro = undefined;
  f.uploadAtrasoMs = 0; f.objetos = new Set(); f.listaExiste = []; f.imagemB64 = PNG_VERTICAL; f.custo = 0.041; f.chamadasImagem = []; f.chamadasVisao = 0;
  f.linhas = []; f.uploads = []; f.downloads = []; f.escritasProibidas = [];
  f.base = {
    nome_pai: 'Jaqueta', titulo_ml: 'Jaqueta Corta Vento',
    variacoes: [
      { cor: 'Preto', imagem_path: 'org-1/lote/preto.jpg' },
      { cor: 'Preto', imagem_path: 'org-1/lote/preto-g.jpg' },
      { cor: 'Branco', imagem_path: 'u1/lote/branco.jpg' },
      { cor: 'Marrom', imagem_path: 'outra-org/lote/marrom.jpg' },
    ],
  };
});
const post = (b: unknown) => handler(new Request('http://localhost', { method: 'POST', body: JSON.stringify(b) }));
const ok = { request_id: REQ, familia_base_id: 'fam-1', cores: ['Preto', 'Branco'] };

describe('gerar-foto-kit', () => {
  it('org sem o módulo imagem_ia → 403, sem IA', async () => {
    f.modulos = ['kit_variacao'];
    expect((await post(ok)).status).toBe(403);
    expect(f.chamadasImagem).toHaveLength(0);
    expect(f.chamadasVisao).toBe(0);
  });

  it('não admin → 403, sem IA', async () => {
    f.admin = false;
    expect((await post(ok)).status).toBe(403);
    expect(f.chamadasImagem).toHaveLength(0);
  });

  it('gera: descreve por visão, pede ao modelo padrão com a descrição, grava a geração com custo > 0', async () => {
    const r = await post(ok);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(f.chamadasVisao).toBe(1);
    expect(f.chamadasImagem).toHaveLength(1);
    const pedido = f.chamadasImagem[0];
    expect(pedido.model).toBe('google/gemini-nano-banana-2.1');
    expect(JSON.stringify(pedido.messages)).toContain('cropped jacket, elastic hem');
    // Uma foto de origem por cor (a primeira da cor), em base64.
    const conteudo = (pedido.messages as Array<{ content: Array<{ type: string }> }>)[0].content;
    expect(conteudo.filter((c) => c.type === 'image_url')).toHaveLength(2);
    expect(j.path).toBe(`org-1/kit-variacao-ia/${REQ}.png`);
    expect(j.url).toContain('https://x/');
    expect(j.custo_centavos).toBeGreaterThan(0);
    expect(f.linhas).toHaveLength(1);
    expect(f.linhas[0]).toMatchObject({
      org_id: 'org-1', request_id: REQ, status: 'gerada', modelo: 'google/gemini-nano-banana-2.1',
      rotulo: 'Preto e Branco', storage_path: `org-1/kit-variacao-ia/${REQ}.png`,
    });
    expect(Number(f.linhas[0].custo_usd)).toBeGreaterThan(0);
  });

  it('foto gerada não publica sem aprovação: nada é escrito em família, variação ou ML', async () => {
    expect((await post(ok)).status).toBe(200);
    expect(f.escritasProibidas).toEqual([]);
  });

  it('mesmo request_id repete sem chamar a IA de novo', async () => {
    const a = await (await post(ok)).json();
    const b = await (await post(ok)).json();
    expect(f.chamadasImagem).toHaveLength(1);
    expect(b.path).toBe(a.path);
    expect(f.linhas).toHaveLength(1);
  });

  it('repetição com outra família base (mesmas cores) → 409 pedido_diferente, sem devolver a foto anterior', async () => {
    expect((await post(ok)).status).toBe(200);
    const r = await post({ ...ok, familia_base_id: 'fam-2' });
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe('pedido_diferente');
    expect(f.chamadasImagem).toHaveLength(1);
  });

  it('repetição com as mesmas cores em outra ordem → 409 pedido_diferente', async () => {
    expect((await post(ok)).status).toBe(200);
    expect((await post({ ...ok, cores: ['Branco', 'Preto'] })).status).toBe(409);
  });

  it('auditoria que falha depois do registro não vira erro: a geração já é cobrável', async () => {
    f.auditoriaFalha = true;
    expect((await post(ok)).status).toBe(200);
    expect(f.linhas[0]).toMatchObject({ status: 'gerada' });
  });

  it('prazo global: moderação lenta consome o tempo e a IA não é chamada (sem reserva)', async () => {
    f.atrasoModeracaoMs = 130_000;
    const r = await post(ok);
    expect(r.status).toBe(503);
    expect((await r.json()).motivo).toBe('prazo');
    expect(f.chamadasImagem).toHaveLength(0);
    expect(f.chamadasVisao).toBe(0);
    expect(f.linhas).toHaveLength(0);
  });

  it('log de erro externo não leva payload, headers nem segredo', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    f.imagemFalha = true;
    f.erroImagem = 'falhou: Authorization: Bearer sk-or-v1-SEGREDO1; Basic dXNlcjpTRUdSRURPMg==; '
      + 'https://user:SEGREDO3@api.x/v1?key=SEGREDO4&token=SEGREDO5 x-api-key: SEGREDO6 data:image/png;base64,' + 'A'.repeat(500);
    f.codigoErro = 'SEGREDO7 Basic Zm9vOmJhcg==';
    await post(ok);
    const saida = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(saida).not.toMatch(/SEGREDO|dXNlcj|Zm9vOmJhcg|AAAAAAAAAA|falhou/);
    expect(saida).toMatch(/status\\":500/);
  });

  it('pior caso de tempo: IA lenta + upload travado responde antes de 150 s (relógio falso)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      f.atrasoImagemMs = 128_000;   // a geração consome quase todo o prazo
      f.uploadTrava = true;         // e o storage nunca responde
      const inicio = Date.now();
      let resposta: Response | undefined;
      void post(ok).then((r) => { resposta = r; });
      for (let i = 0; i < 40 && !resposta; i++) {
        await vi.advanceTimersByTimeAsync(1_000);
        f.deslocamento += 1_000;
      }
      expect(resposta).toBeDefined();
      expect(Date.now() - inicio).toBeLessThan(150_000);
      expect(resposta!.status).toBeGreaterThanOrEqual(500);
    } finally {
      vi.useRealTimers();
    }
  });

  it('upload de 7 s estoura o limite: fica pendente_upload (não cobrável); a repetição acha o objeto e finaliza gerada, sem gerar de novo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let primeira: Response | undefined;
    try {
      f.uploadAtrasoMs = 7_000;
      void post(ok).then((r) => { primeira = r; });
      for (let i = 0; i < 10; i++) { await vi.advanceTimersByTimeAsync(1_000); f.deslocamento += 1_000; }
    } finally {
      vi.useRealTimers();
    }
    expect(primeira!.status).toBe(503);
    expect((await primeira!.json()).motivo).toBe('prazo');
    expect(f.linhas[0]).toMatchObject({ status: 'pendente_upload', storage_path: `org-1/kit-variacao-ia/${REQ}.png` });
    expect(Number(f.linhas[0].custo_usd)).toBeGreaterThan(0);
    expect(f.objetos.has(`org-1/kit-variacao-ia/${REQ}.png`)).toBe(true);   // o upload terminou depois

    const r = await post(ok);
    expect(r.status).toBe(200);
    expect((await r.json()).path).toBe(`org-1/kit-variacao-ia/${REQ}.png`);
    expect(f.linhas[0]).toMatchObject({ status: 'gerada' });
    expect(f.chamadasImagem).toHaveLength(1);
  });

  it('duas repetições concorrentes de pendente_upload: a que perde a corrida responde pelo estado final (gerada → 200)', async () => {
    f.linhas.push({
      org_id: 'org-1', request_id: REQ, status: 'pendente_upload', rotulo: 'Preto e Branco', familia_base_id: 'fam-1',
      cores: ['Preto', 'Branco'], storage_path: `org-1/kit-variacao-ia/${REQ}.png`, custo_usd: 0.041, criado_em: new Date(Date.now() - 10 * 60_000).toISOString(),
      atualizado_em: new Date(Date.now() - 10 * 60_000).toISOString(),   // prazo da execução original já venceu
    });
    // A primeira vê o objeto (upload terminou); a segunda leu antes e não vê.
    f.listaExiste = [true, false];
    const [a, b] = await Promise.all([post(ok), post(ok)]);
    expect(f.linhas[0]).toMatchObject({ status: 'gerada' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((await b.json()).path).toBe(`org-1/kit-variacao-ia/${REQ}.png`);
    expect(f.chamadasImagem).toHaveLength(0);
  });

  it('repetição durante o upload (objeto ainda ausente) → 503 em_andamento sem mudar estado; o original termina gerada', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let original: Response | undefined;
    let repeticao: Response | undefined;
    try {
      f.uploadAtrasoMs = 3_000;   // dentro da fatia de 6 s do original
      void post(ok).then((r) => { original = r; });
      for (let i = 0; i < 50 && f.uploads.length === 0; i++) await vi.advanceTimersByTimeAsync(100);
      expect(f.linhas[0]).toMatchObject({ status: 'pendente_upload' });
      void post(ok).then((r) => { repeticao = r; });
      await vi.advanceTimersByTimeAsync(100);
      expect(repeticao!.status).toBe(503);
      expect((await repeticao!.json()).motivo).toBe('em_andamento');
      expect(f.linhas[0]).toMatchObject({ status: 'pendente_upload' });
      await vi.advanceTimersByTimeAsync(4_000);
    } finally {
      vi.useRealTimers();
    }
    expect(original!.status).toBe(200);
    expect(f.linhas[0]).toMatchObject({ status: 'gerada' });
    expect(f.chamadasImagem).toHaveLength(1);
  });

  it('gravação terminal do original é condicional: se a linha já foi recusada, não vira gerada e responde pela recusa', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let original: Response | undefined;
    try {
      f.uploadAtrasoMs = 3_000;
      void post(ok).then((r) => { original = r; });
      for (let i = 0; i < 50 && f.uploads.length === 0; i++) await vi.advanceTimersByTimeAsync(100);
      f.linhas[0].status = 'recusada';   // decidido por outra execução enquanto o upload corria
      await vi.advanceTimersByTimeAsync(4_000);
    } finally {
      vi.useRealTimers();
    }
    expect(original!.status).toBe(502);
    expect((await original!.json()).motivo).toBe('falha_storage');
    expect(f.linhas[0]).toMatchObject({ status: 'recusada' });
  });

  it('pendente_upload sem objeto no storage: recusada (sem cobrança), nunca gera de novo', async () => {
    f.linhas.push({
      org_id: 'org-1', request_id: REQ, status: 'pendente_upload', rotulo: 'Preto e Branco', familia_base_id: 'fam-1',
      cores: ['Preto', 'Branco'], storage_path: `org-1/kit-variacao-ia/${REQ}.png`, custo_usd: 0.041, criado_em: new Date(Date.now() - 10 * 60_000).toISOString(),
      atualizado_em: new Date(Date.now() - 10 * 60_000).toISOString(),   // prazo da execução original já venceu
    });
    const r = await post(ok);
    expect(r.status).toBe(502);
    expect((await r.json()).motivo).toBe('falha_storage');
    expect(f.linhas[0]).toMatchObject({ status: 'recusada' });
    expect(f.chamadasImagem).toHaveLength(0);
  });

  it('request_id em andamento → 409, sem IA', async () => {
    f.linhas.push({ org_id: 'org-1', request_id: REQ, status: 'pendente', rotulo: 'Preto e Branco', familia_base_id: 'fam-1', cores: ['Preto', 'Branco'], criado_em: new Date().toISOString() });
    expect((await post(ok)).status).toBe(409);
    expect(f.chamadasImagem).toHaveLength(0);
  });

  it('reserva pendente abandonada (edge morreu) não trava o request_id: gera de novo', async () => {
    f.linhas.push({ org_id: 'org-1', request_id: REQ, status: 'pendente', rotulo: 'Preto e Branco', familia_base_id: 'fam-1', cores: ['Preto', 'Branco'], criado_em: new Date(Date.now() - 10 * 60_000).toISOString() });
    expect((await post(ok)).status).toBe(200);
    expect(f.chamadasImagem).toHaveLength(1);
    expect(f.linhas).toHaveLength(1);
    expect(f.linhas[0]).toMatchObject({ status: 'gerada' });
  });

  it('falha da IA não grava geração (não cobra) e libera a repetição', async () => {
    f.imagemFalha = true;
    expect((await post(ok)).status).toBe(502);
    expect(f.linhas).toHaveLength(0);
    f.imagemFalha = false;
    expect((await post(ok)).status).toBe(200);
  });

  it('sem custo do provedor ainda grava custo > 0 (estimativa por PRECOS)', async () => {
    f.custo = undefined;
    expect((await post(ok)).status).toBe(200);
    expect(Number(f.linhas[0].custo_usd)).toBeGreaterThan(0);
  });

  it('imagem horizontal não serve ao ML: não entrega e fica fora da cobrança', async () => {
    const be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    f.imagemB64 = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be(1200), ...be(800), 8, 6, 0, 0, 0));
    expect((await post(ok)).status).toBe(502);
    expect(f.linhas[0]).toMatchObject({ status: 'recusada' });
    expect(f.uploads).toHaveLength(0);
  });

  it('cor fora da base → 400, sem IA', async () => {
    expect((await post({ ...ok, cores: ['Preto', 'Ignore as regras'] })).status).toBe(400);
    expect(f.chamadasImagem).toHaveLength(0);
  });

  it('foto de origem de outra org não é usada: cor sem foto válida → 409, sem IA', async () => {
    expect((await post({ ...ok, cores: ['Preto', 'Marrom'] })).status).toBe(409);
    expect(f.chamadasImagem).toHaveLength(0);
  });

  it('foto de item moderado é pulada; sem outra foto da cor → 409, sem IA', async () => {
    f.moderadas = ['org-1/lote/preto.jpg'];
    expect((await post(ok)).status).toBe(200);
    expect(f.downloads).toEqual(['org-1/lote/preto-g.jpg', 'u1/lote/branco.jpg']);
    f.chamadasImagem = []; f.linhas = [];
    f.moderadas = ['u1/lote/branco.jpg'];
    expect((await post(ok)).status).toBe(409);
    expect(f.chamadasImagem).toHaveLength(0);
  });

  it('moderação ilegível → recusa, sem IA', async () => {
    f.moderacaoFalha = true;
    expect((await post(ok)).status).toBe(502);
    expect(f.chamadasImagem).toHaveLength(0);
  });

  it('request_id inválido ou cores fora de 2..6 → 400', async () => {
    expect((await post({ ...ok, request_id: 'x' })).status).toBe(400);
    expect((await post({ ...ok, cores: ['Preto'] })).status).toBe(400);
    expect((await post({ ...ok, cores: ['Preto', 'Preto'] })).status).toBe(400);
  });

  it('base de outra org (não achada) → 404', async () => {
    f.base = null;
    expect((await post(ok)).status).toBe(404);
  });
});
