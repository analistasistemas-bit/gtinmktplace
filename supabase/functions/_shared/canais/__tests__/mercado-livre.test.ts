import { describe, it, expect, afterEach } from 'vitest';
import { mercadoLivreConnector } from '../mercado-livre';
import type { AtualizacaoCanonica, AnuncioCanonico } from '../contrato';

const globalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = globalFetch; });

const ctxFake = { getToken: () => Promise.resolve('tok') };

// GET (buscarItemML) devolve 1 variação viva; PUT (atualizarItemML) é capturado; 2º GET é o refetch.
function stubFetch(getBody: unknown) {
  let putBody: any = null;
  const okItem = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200 }));
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      putBody = JSON.parse(init.body as string);
      return okItem({ variations: [] });
    }
    return okItem(getBody);
  }) as typeof fetch;
  return () => putBody;
}

describe('atualizarAnuncio somenteEstoque', () => {
  const baseGet = {
    id: 'MLB1',
    variations: [{ id: 1, seller_custom_field: 'A1', available_quantity: 9, price: 25, picture_ids: [], attribute_combinations: [{ id: 'COLOR', value_name: 'Azul' }] }],
    pictures: [],
  };
  const atualiz: AtualizacaoCanonica = {
    itemExternoId: 'MLB1',
    existentes: [{ sku: 'A1', estoque: 9, cor: 'Azul' }],
    novas: [{ sku: 'N1', cor: 'Rosa', estoque: 4, preco: 30, gtin: null, fotoId: 'P' }],
    capaFotoId: null, capa2FotoId: null, capa3FotoId: null, categoriaId: null,
    marca: null, dimensoes: null, desconto: null, precoFamilia: null,
    somenteEstoque: true,
  };

  it('nao empurra preco na existente e da preco vivo (25) a cor nova', async () => {
    const getPut = stubFetch(baseGet);
    const res = await mercadoLivreConnector.atualizarAnuncio(ctxFake, atualiz);
    expect(res.ok).toBe(true);
    const putBody = getPut();
    // A existente no PUT só carrega `id` (VariacaoUpdate) — casar por id; a cor nova carrega seller_custom_field.
    expect(putBody.variations.find((v: any) => v.seller_custom_field === 'N1').price).toBe(25);
    expect(putBody.variations.find((v: any) => v.id === 1).price).toBeUndefined();
    // precoVivo do GET propagado no resultado (consumido pela Task 7).
    expect(res.valor?.precoVivo).toBe(25);
  });
});

describe('atualizarAnuncio em item plano (ADR-0084)', () => {
  it('GET sem variations + 1 existente → PUT plano direto no corpo raiz (price/available_quantity), sem variations', async () => {
    let putBody: any = null;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        putBody = JSON.parse(init.body as string);
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ id: 'MLB1', variations: [], pictures: [], price: 100, available_quantity: 10 }), { status: 200 }));
    }) as typeof fetch;
    const atualiz: AtualizacaoCanonica = {
      itemExternoId: 'MLB1',
      existentes: [{ sku: 'A1', estoque: 15, cor: 'Prata' }],
      novas: [],
      capaFotoId: null, capa2FotoId: null, capa3FotoId: null, categoriaId: null,
      marca: null, dimensoes: null, desconto: null, precoFamilia: 130,
      somenteEstoque: false,
    };
    const res = await mercadoLivreConnector.atualizarAnuncio(ctxFake, atualiz);
    expect(res.ok).toBe(true);
    expect(putBody).toEqual({ available_quantity: 15, price: 130 });
    expect(res.valor?.variacoesExternas).toEqual({ A1: 'MLB1' });
    expect(res.valor?.precoVivo).toBe(100);
  });
  it('somenteEstoque=true não envia price no PUT plano', async () => {
    let putBody: any = null;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { putBody = JSON.parse(init.body as string); return Promise.resolve(new Response('{}', { status: 200 })); }
      return Promise.resolve(new Response(JSON.stringify({ id: 'MLB1', variations: [], pictures: [], price: 100, available_quantity: 10 }), { status: 200 }));
    }) as typeof fetch;
    const atualiz: AtualizacaoCanonica = {
      itemExternoId: 'MLB1',
      existentes: [{ sku: 'A1', estoque: 20, cor: 'Prata' }],
      novas: [],
      capaFotoId: null, capa2FotoId: null, capa3FotoId: null, categoriaId: null,
      marca: null, dimensoes: null, desconto: null, precoFamilia: 130,
      somenteEstoque: true,
    };
    await mercadoLivreConnector.atualizarAnuncio(ctxFake, atualiz);
    expect(putBody).toEqual({ available_quantity: 20 });
  });
  it('GET sem variations + >1 existente ou cor nova → falha alto, nunca manda PUT vazio (no-op silencioso)', async () => {
    let putChamado = false;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') putChamado = true;
      return Promise.resolve(new Response(JSON.stringify({ id: 'MLB1', variations: [], pictures: [] }), { status: 200 }));
    }) as typeof fetch;
    const atualiz: AtualizacaoCanonica = {
      itemExternoId: 'MLB1',
      existentes: [{ sku: 'A1', estoque: 10, cor: 'Prata' }],
      novas: [{ sku: 'N1', cor: 'Rosa', estoque: 4, preco: 30, gtin: null, fotoId: 'P' }],
      capaFotoId: null, capa2FotoId: null, capa3FotoId: null, categoriaId: null,
      marca: null, dimensoes: null, desconto: null, precoFamilia: null,
      somenteEstoque: false,
    };
    const res = await mercadoLivreConnector.atualizarAnuncio(ctxFake, atualiz);
    expect(res.ok).toBe(false);
    expect(putChamado).toBe(false);
  });
});

describe('criarAnuncio: retry reativo de item plano (ADR-0087)', () => {
  const anuncioBase: AnuncioCanonico = {
    titulo: 'Kit Agulha Crochê',
    descricao: 'Desc',
    categoriaId: 'MLB999999', // fora do Set (categoria nunca vista antes, tipo "kit agulha")
    atributos: [],
    capaFotoId: null, capa2FotoId: null, capa3FotoId: null,
    desconto: null, dimensoes: null,
    variacoes: [{ sku: 'A1', cor: 'Único', estoque: 5, preco: 33.5, gtin: null, fotoId: null }],
  };
  const causaExata = [
    { code: 'body.required_fields', cause_id: 369, type: 'error', message: 'The body does not contains some or none of the following properties [family_name, price, available_quantity]' },
    { code: 'body.invalid_fields', cause_id: 374, type: 'error', message: 'The field variations is invalid with family name' },
  ];

  // Roteia fetch: POST /items conta/inspeciona; qualquer outra URL (ex. GET schema de
  // atributos) devolve 404 pra lerSchemaAtributos cair no fallback ([]), sem poluir o teste.
  function stubItems(respostas: Array<{ status: number; body: unknown }>) {
    const chamadas: any[] = [];
    let i = 0;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && String(url).includes('/items')) {
        chamadas.push(JSON.parse(init.body as string));
        const r = respostas[Math.min(i, respostas.length - 1)];
        i++;
        return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status }));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }) as typeof fetch;
    return chamadas;
  }

  it('categoria já no Set (MLB271227) publica direto no formato plano — 1 único POST, sem variations', async () => {
    const chamadas = stubItems([{ status: 200, body: { id: 'MLB1', permalink: 'x', variations: [] } }]);
    const anuncio = { ...anuncioBase, categoriaId: 'MLB271227' };
    const res = await mercadoLivreConnector.criarAnuncio(ctxFake, anuncio);
    expect(res.ok).toBe(true);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].family_name).toBe('Kit Agulha Crochê');
    expect(chamadas[0].variations).toBeUndefined();
  });

  it('categoria já no Set + desconto → DESCONTO_INCOMPATIVEL sem POST', async () => {
    const chamadas = stubItems([]);
    const anuncio = { ...anuncioBase, categoriaId: 'MLB271227', desconto: { pct: 15 } };
    const res = await mercadoLivreConnector.criarAnuncio(ctxFake, anuncio);
    expect(res.ok).toBe(false);
    expect(res.erro?.codigo).toBe('DESCONTO_INCOMPATIVEL');
    expect(res.erro?.mensagemOperador).toContain('desmarque');
    expect(chamadas).toHaveLength(0);
  });

  it('categoria fora do Set: 1º POST rejeitado com assinatura exata → 2º POST em formato plano → sucesso', async () => {
    const chamadas = stubItems([
      { status: 400, body: { message: 'Validation error', cause: causaExata } },
      { status: 200, body: { id: 'MLB2', permalink: 'x', variations: [] } },
    ]);
    const res = await mercadoLivreConnector.criarAnuncio(ctxFake, anuncioBase);
    expect(res.ok).toBe(true);
    expect(res.valor?.itemExternoId).toBe('MLB2');
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0].variations).toBeDefined();
    expect(chamadas[0].family_name).toBeUndefined();
    expect(chamadas[1].family_name).toBe('Kit Agulha Crochê');
    expect(chamadas[1].variations).toBeUndefined();
  });

  it('categoria nova + desconto: assinatura 369+374 → DESCONTO_INCOMPATIVEL sem 2º POST plano', async () => {
    const chamadas = stubItems([
      { status: 400, body: { message: 'Validation error', cause: causaExata } },
    ]);
    const res = await mercadoLivreConnector.criarAnuncio(ctxFake, { ...anuncioBase, desconto: { pct: 15 } });
    expect(res.ok).toBe(false);
    expect(res.erro?.codigo).toBe('DESCONTO_INCOMPATIVEL');
    expect(chamadas).toHaveLength(1);
  });

  it('1º POST rejeitado SEM a assinatura exata → nenhum retry, erro original propagado', async () => {
    const chamadas = stubItems([
      { status: 400, body: { message: 'Validation error', cause: [{ code: 'item.title.length.invalid', type: 'error', message: 'título grande' }] } },
    ]);
    const res = await mercadoLivreConnector.criarAnuncio(ctxFake, anuncioBase);
    expect(res.ok).toBe(false);
    expect(chamadas).toHaveLength(1);
  });

  it('1º rejeitado com assinatura exata, 2º TAMBÉM falha → erro do 2º propagado, sem 3ª tentativa', async () => {
    const chamadas = stubItems([
      { status: 400, body: { message: 'Validation error', cause: causaExata } },
      { status: 400, body: { message: 'Validation error', cause: [{ code: 'item.attributes.required', type: 'error', message: 'BRAND obrigatório' }] } },
    ]);
    const res = await mercadoLivreConnector.criarAnuncio(ctxFake, anuncioBase);
    expect(res.ok).toBe(false);
    expect(res.erro?.mensagemOperador).toContain('BRAND');
    expect(chamadas).toHaveLength(2);
  });

  it('família com >1 variação + assinatura exata → reconstrução lança internamente (ADR-0084), capturado sem 2º POST', async () => {
    const chamadas = stubItems([
      { status: 400, body: { message: 'Validation error', cause: causaExata } },
    ]);
    const anuncio = {
      ...anuncioBase,
      variacoes: [
        { sku: 'A1', cor: 'Azul', estoque: 5, preco: 33.5, gtin: null, fotoId: null },
        { sku: 'A2', cor: 'Verde', estoque: 3, preco: 33.5, gtin: null, fotoId: null },
      ],
    };
    const res = await mercadoLivreConnector.criarAnuncio(ctxFake, anuncio);
    expect(res.ok).toBe(false);
    expect(chamadas).toHaveLength(1); // só o 1º POST — a reconstrução lança antes de um 2º fetch
  });
});

describe('criarAnuncio: FORMATO_INCOMPATIVEL para família multi-cor em categoria UP (ADR-0088)', () => {
  const tresVariacoes = [
    { sku: 'A1', cor: 'Azul', estoque: 5, preco: 33.5, gtin: null, fotoId: null },
    { sku: 'A2', cor: 'Verde', estoque: 3, preco: 33.5, gtin: null, fotoId: null },
    { sku: 'A3', cor: 'Rosa', estoque: 2, preco: 33.5, gtin: null, fotoId: null },
  ];
  const anuncioMulti: AnuncioCanonico = {
    titulo: 'Agulha Crochê Cabo Matte 15cm',
    descricao: 'Desc',
    categoriaId: 'MLB999999',
    atributos: [],
    capaFotoId: null, capa2FotoId: null, capa3FotoId: null,
    desconto: null, dimensoes: null,
    variacoes: tresVariacoes,
  };
  const causaExata = [
    { code: 'body.required_fields', cause_id: 369, type: 'error', message: 'The body does not contains some or none of the following properties [family_name, price, available_quantity]' },
    { code: 'body.invalid_fields', cause_id: 374, type: 'error', message: 'The field variations is invalid with family name' },
  ];

  // Spy que conta TODA chamada de fetch (não só POST /items) — pin para a checagem estática
  // de branch (a) rodar ANTES de qualquer rede (getToken/lerSchemaAtributos incluídos).
  function stubFetchTotal(respostas: Array<{ status: number; body: unknown }>) {
    const chamadas: any[] = [];
    let i = 0;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      chamadas.push({ url: String(url), method: init?.method });
      if (init?.method === 'POST' && String(url).includes('/items')) {
        const r = respostas[Math.min(i, respostas.length - 1)];
        i++;
        return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status }));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }) as typeof fetch;
    return chamadas;
  }
  const posts = (chamadas: any[]) => chamadas.filter((c) => c.method === 'POST' && c.url.includes('/items'));

  it('categoria já conhecida estaticamente (MLB271227) + 3 variações → FORMATO_INCOMPATIVEL SEM nenhuma chamada de rede', async () => {
    const chamadas = stubFetchTotal([]);
    const anuncio = { ...anuncioMulti, categoriaId: 'MLB271227' };
    const res = await mercadoLivreConnector.criarAnuncio(ctxFake, anuncio);
    expect(res.ok).toBe(false);
    expect(res.erro?.codigo).toBe('FORMATO_INCOMPATIVEL');
    expect(chamadas).toHaveLength(0); // zero fetch: nem schema GET, nem POST desperdiçado
  });

  it('categoria nova + 3 variações → 1º POST variations rejeitado com assinatura 369+374 → FORMATO_INCOMPATIVEL, exatamente 1 POST', async () => {
    const chamadas = stubFetchTotal([
      { status: 400, body: { message: 'Validation error', cause: causaExata } },
    ]);
    const res = await mercadoLivreConnector.criarAnuncio(ctxFake, anuncioMulti);
    expect(res.ok).toBe(false);
    expect(res.erro?.codigo).toBe('FORMATO_INCOMPATIVEL');
    expect(posts(chamadas)).toHaveLength(1); // nunca reconstrói como plano com N variações
    expect(posts(chamadas)[0].method).toBe('POST');
  });

  it('categoria nova + 3 variações → 1º POST rejeitado SEM a assinatura exata → erro normal (não FORMATO_INCOMPATIVEL)', async () => {
    const chamadas = stubFetchTotal([
      { status: 400, body: { message: 'Validation error', cause: [{ code: 'item.title.length.invalid', type: 'error', message: 'título grande' }] } },
    ]);
    const res = await mercadoLivreConnector.criarAnuncio(ctxFake, anuncioMulti);
    expect(res.ok).toBe(false);
    expect(res.erro?.codigo).not.toBe('FORMATO_INCOMPATIVEL');
    expect(posts(chamadas)).toHaveLength(1);
  });
});
