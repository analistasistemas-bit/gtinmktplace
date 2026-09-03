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

describe('atualizarAnuncio preservarPublicadas (fluxo "Adicionar variação")', () => {
  // Caso real do MLB7157545794 (2026-09-03): o ML normaliza o nome da cor pelo dicionário de
  // COLOR ("Rosa Claro" → "Rosa-claro"), o banco guarda a grafia da planilha, e o app lia isso
  // como renomeio. Como a variação tinha venda, o ML derrubou o PUT INTEIRO com
  // "You cannot change attribute combinations if the variation has bids".
  const getComCorNormalizada = {
    id: 'MLB1',
    variations: [{
      id: 1, seller_custom_field: 'A1', available_quantity: 40, price: 76.9, picture_ids: [],
      attribute_combinations: [{ id: 'COLOR', value_name: 'Rosa-claro' }],
    }],
    pictures: [],
  };
  const base: AtualizacaoCanonica = {
    itemExternoId: 'MLB1',
    existentes: [{ sku: 'A1', estoque: 0, cor: 'Rosa Claro' }],
    novas: [{ sku: 'N1', cor: 'Preto', estoque: 40, preco: 80, gtin: null, fotoId: 'P' }],
    capaFotoId: null, capa2FotoId: null, capa3FotoId: null, categoriaId: null,
    marca: null, dimensoes: null, desconto: null, precoFamilia: 80,
    somenteEstoque: false,
  };

  it('a publicada vai só como no-op (id + estoque do ML): sem COLOR, sem price, sem estoque do banco', async () => {
    const getPut = stubFetch(getComCorNormalizada);
    const res = await mercadoLivreConnector.atualizarAnuncio(ctxFake, { ...base, preservarPublicadas: true });
    expect(res.ok).toBe(true);
    const existente = getPut().variations.find((v: any) => v.id === 1);
    expect(existente.attribute_combinations).toBeUndefined();
    expect(existente.price).toBeUndefined();
    expect(existente.picture_ids).toBeUndefined();
    expect(existente.available_quantity).toBe(40);
  });

  it('a cor nova entra no preço vivo do anúncio, não no preço da família', async () => {
    const getPut = stubFetch(getComCorNormalizada);
    await mercadoLivreConnector.atualizarAnuncio(ctxFake, { ...base, preservarPublicadas: true });
    expect(getPut().variations.find((v: any) => v.seller_custom_field === 'N1').price).toBe(76.9);
  });

  it('sem a flag, o caminho antigo continua mandando COLOR e preço (ADR-0062 intocado)', async () => {
    const getPut = stubFetch(getComCorNormalizada);
    await mercadoLivreConnector.atualizarAnuncio(ctxFake, base);
    const existente = getPut().variations.find((v: any) => v.id === 1);
    expect(existente.attribute_combinations).toEqual([{ id: 'COLOR', value_name: 'Rosa Claro' }]);
    expect(existente.price).toBe(80);
    expect(existente.available_quantity).toBe(0);
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

  // ADR-0151 D-5 (revisada): kit vinculado publica sem GTIN por padrão; em categoria que exige o
  // código de verdade (alimentos/MLB455708), o ML recusa e nenhum EMPTY_GTIN_REASON resolve —
  // provado por dry-run (/items/validate, 2026-09-03). O retry reenvia com o GTIN da unidade-base,
  // que é como o ML modela pack (GTIN da unidade + UNITS_PER_PACK, tag `pack_multiplier`).
  const causaGtin = [{
    cause_id: 7810,
    type: 'error',
    code: 'item.attribute.missing_conditional_required',
    message: "The attributes [GTIN] are required for category [MLB455708]. Check the attribute is present in the attributes list or in all variation's attributes_combination or attributes.",
  }];

  it('kit sem GTIN recusado por GTIN obrigatório → reenvia com o GTIN da unidade-base', async () => {
    const chamadas = stubItems([
      { status: 400, body: { message: 'Validation error', cause: causaGtin } },
      { status: 200, body: { id: 'MLB9', permalink: 'x', variations: [] } },
    ]);
    const res = await mercadoLivreConnector.criarAnuncio(ctxFake, { ...anuncioBase, gtinPackFallback: '7891000444764' });
    expect(res.ok).toBe(true);
    expect(chamadas).toHaveLength(2);
    const gtinsDoRetry = chamadas[1].variations[0].attributes;
    expect(gtinsDoRetry).toContainEqual({ id: 'GTIN', value_name: '7891000444764' });
  });

  it('recusa por GTIN SEM gtinPackFallback (produto comum) → nenhum retry, erro propagado', async () => {
    const chamadas = stubItems([
      { status: 400, body: { message: 'Validation error', cause: causaGtin } },
    ]);
    const res = await mercadoLivreConnector.criarAnuncio(ctxFake, anuncioBase);
    expect(res.ok).toBe(false);
    expect(chamadas).toHaveLength(1);
  });

  it('kit com GTIN próprio informado pelo operador não dispara o fallback', async () => {
    const chamadas = stubItems([
      { status: 200, body: { id: 'MLB10', permalink: 'x', variations: [] } },
    ]);
    const anuncio = {
      ...anuncioBase,
      gtinPackFallback: '7891000444764',
      variacoes: [{ sku: 'A1', cor: 'Único', estoque: 5, preco: 33.5, gtin: '7899999999999', fotoId: null }],
    };
    const res = await mercadoLivreConnector.criarAnuncio(ctxFake, anuncio);
    expect(res.ok).toBe(true);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].variations[0].attributes).toContainEqual({ id: 'GTIN', value_name: '7899999999999' });
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

// ── ADR-0104 — o ML migra famílias JÁ PUBLICADAS para User Products sozinho ───────────────────
// O GET ao vivo passa a devolver `variations: []` + family_name numa família que foi publicada
// como Legacy. Antes isso lançava 400 pedindo reposição manual no painel; agora vira sinal tipado
// e a orquestração adota os irmãos por SKU (simétrico ao FORMATO_INCOMPATIVEL do CREATE).
describe('atualizarAnuncio: família migrada pelo ML para User Products (ADR-0104)', () => {
  const itemMigrado = (extra: Record<string, unknown> = {}) => ({
    id: 'MLB1', variations: [], pictures: [], price: 100, available_quantity: 10,
    family_id: 'FAM-9', family_name: 'AGULHA MATTE', seller_id: 777, ...extra,
  });
  const base = {
    itemExternoId: 'MLB1',
    capaFotoId: null, capa2FotoId: null, capa3FotoId: null, categoriaId: 'MLB419782',
    marca: null, dimensoes: null, desconto: null, precoFamilia: 130, somenteEstoque: false,
  };

  it('multi-cor → MIGRADO_PARA_UP com o observado no GET; NENHUM PUT emitido', async () => {
    let putChamado = false;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') putChamado = true;
      return Promise.resolve(new Response(JSON.stringify(itemMigrado()), { status: 200 }));
    }) as typeof fetch;
    const atualiz: AtualizacaoCanonica = {
      ...base,
      existentes: [{ sku: 'A1', estoque: 10, cor: 'Prata' }, { sku: 'A2', estoque: 3, cor: 'Rosa' }],
      novas: [],
    };
    const res = await mercadoLivreConnector.atualizarAnuncio(ctxFake, atualiz);
    expect(res.ok).toBe(false);
    expect(res.erro?.codigo).toBe('MIGRADO_PARA_UP');
    expect(res.erro?.retentavel).toBe(false);
    expect(res.erro?.up).toEqual({ familyId: 'FAM-9', familyName: 'AGULHA MATTE', sellerId: '777' });
    expect(putChamado).toBe(false);
  });

  it('1 cor + cor nova → MIGRADO_PARA_UP (cor nova em item plano também é o modelo N-itens)', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response(JSON.stringify(itemMigrado()), { status: 200 }))) as typeof fetch;
    const atualiz: AtualizacaoCanonica = {
      ...base,
      existentes: [{ sku: 'A1', estoque: 10, cor: 'Prata' }],
      novas: [{ sku: 'N1', cor: 'Rosa', estoque: 4, preco: 30, gtin: null, fotoId: 'P' }],
    };
    const res = await mercadoLivreConnector.atualizarAnuncio(ctxFake, atualiz);
    expect(res.erro?.codigo).toBe('MIGRADO_PARA_UP');
  });

  // Regressão inversa: o caminho de 1 cor do ADR-0084 continua repondo direto, sem adoção.
  it('1 cor SEM cor nova continua no PUT plano do ADR-0084 (não vira MIGRADO_PARA_UP)', async () => {
    let putBody: Record<string, unknown> | null = null;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        putBody = JSON.parse(init.body as string);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(itemMigrado()), { status: 200 }));
    }) as typeof fetch;
    const atualiz: AtualizacaoCanonica = {
      ...base, existentes: [{ sku: 'A1', estoque: 15, cor: 'Prata' }], novas: [],
    };
    const res = await mercadoLivreConnector.atualizarAnuncio(ctxFake, atualiz);
    expect(res.ok).toBe(true);
    expect(putBody).toEqual({ available_quantity: 15, price: 130 });
  });

  // Fail-closed: item plano multi-cor SEM family_name não é UP reconhecível — falha alto.
  it('multi-cor sem family_name → erro, nunca adivinha (não emite MIGRADO_PARA_UP)', async () => {
    globalThis.fetch = (() => Promise.resolve(
      new Response(JSON.stringify(itemMigrado({ family_name: null, family_id: null })), { status: 200 }),
    )) as typeof fetch;
    const atualiz: AtualizacaoCanonica = {
      ...base,
      existentes: [{ sku: 'A1', estoque: 10, cor: 'Prata' }, { sku: 'A2', estoque: 3, cor: 'Rosa' }],
      novas: [],
    };
    const res = await mercadoLivreConnector.atualizarAnuncio(ctxFake, atualiz);
    expect(res.ok).toBe(false);
    expect(res.erro?.codigo).not.toBe('MIGRADO_PARA_UP');
  });
});

// Fase 3 (2026-08-13): a tag catalog_forewarning do ML é a fonte real de "próximo a ser
// pausado" — lerStatus passa a pedir `tags` no lote e propagar para StatusCanal.
describe('lerStatus — catalogForewarning (E5 fase3)', () => {
  it('pede tags no attributes= da URL e preenche catalogForewarning a partir da tag catalog_forewarning', async () => {
    let urlChamada = '';
    globalThis.fetch = ((url: string) => {
      urlChamada = url;
      return Promise.resolve(new Response(JSON.stringify([
        { code: 200, body: { id: 'MLB1', status: 'active', tags: ['catalog_forewarning'] } },
        { code: 200, body: { id: 'MLB2', status: 'active', tags: ['good_quality_thumbnail'] } },
      ]), { status: 200 }));
    }) as typeof fetch;
    const out = await mercadoLivreConnector.lerStatus(ctxFake, ['MLB1', 'MLB2']);
    expect(urlChamada).toContain('tags');
    expect(out.MLB1.catalogForewarning).toBe(true);
    expect(out.MLB2.catalogForewarning).toBe(false);
  });
});
