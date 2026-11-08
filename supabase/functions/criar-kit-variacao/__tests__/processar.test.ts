import { describe, it, expect } from 'vitest';
import {
  criarKitVariacao, type BaseKit, type CriarKitVariacaoInput, type DepsCriarKitVariacao, type ResultadoRpcKit,
} from '../processar.ts';
import type { OfertaUP } from '../../_shared/kit-variacao/ml-oferta.ts';
import type { AtributoSchema } from '../../_shared/categoria/schema.ts';

type Linha = Record<string, unknown>;

// Base: blusa em Preto, Branco e Marrom, tamanhos M e G, cada SKU num UP próprio.
function variacao(codigo: string, cor: string, tamanho: string, extra: Linha = {}): Linha {
  return {
    id: `v-${codigo}`, codigo, cor, tamanho, estoque: 10, custo: 20, peso_gramas: 200,
    altura_cm: 3, largura_cm: 25, comprimento_cm: 30, preco: 49.9, preco_publicacao: 49.9, gtin: '7890000000001',
    imagem_path: `fotos/${codigo}.jpg`, ml_picture_id: 'PIC', nome: cor, ...extra,
  };
}

function cenario() {
  const variacoes = [
    variacao('P-M', 'Preto', 'M', { custo: 18.5 }), variacao('B-M', 'Branco', 'M', { custo: 21.25 }),
    variacao('M-M', 'Marrom', 'M'), variacao('P-G', 'Preto', 'G'), variacao('B-G', 'Branco', 'G'),
  ];
  const base: BaseKit = {
    familia: {
      id: 'FAM-BASE', org_id: 'ORG', user_id: 'U', codigo_pai: '00001000', nome_pai: 'Blusa Canelada',
      categoria_ml_id: 'MLB3112', origem: 'nacional', ncm: '61061000', origem_nfe: 0, cest: null,
      descricao_fiscal: 'Blusa canelada preta', genero: 'feminino', grade_tamanho: 'letras',
      ml_item_id: 'MLB-P-M', status: 'publicado', kit_multiplicador: null, kit_base_codigo_pai: null,
      atributos_ml: [{ id: 'BRAND', value_name: 'Daludi' }, { id: 'COLOR', value_name: 'Preto' }],
      organizations: { modulos_habilitados: ['kit_variacao', 'fiscal'] },
    },
    canonica: true,
    variacoes,
    vinculos: variacoes.map((v) => ({
      sku: v.codigo as string, item_externo_id: `MLB-${v.codigo}`, user_product_id: `UP-${v.codigo}`,
      catalog_listing_id: v.codigo === 'B-M' ? 'MLB-CAT-B-M' : null,
    })),
  };
  const ofertas: Record<string, Partial<OfertaUP>> = {};
  const s = {
    base: base as BaseKit | null,
    ofertas,
    schema: [] as AtributoSchema[],
    moderadas: [] as string[],
    existente: null as { kitId: string; transferenciaId: string | null } | null,
    /** Hash gravado no kit pela RPC falsa (espelho de `kits_variacao.pedido_hash`). */
    ultimoHash: null as string | null,
    rpc: { ok: true, kit_id: 'KIT1', transferencia_id: 'T1' } as ResultadoRpcKit,
    erroFiscal: null as string | null,
    erroModeracao: null as string | null,
    falhasKit: 0,
    kitGravadoNaFalha: false,
    fotoQuebrada: null as string | null,
    familias: [] as Linha[],
    variacoesGravadas: [] as Linha[],
    kits: [] as Array<Parameters<DepsCriarKitVariacao['gravar']['kit']>[0]>,
    desfeitos: [] as Array<[string, string | null]>,
    sagas: [] as string[],
    leituras: [] as string[],
  };
  const deps: DepsCriarKitVariacao = {
    orgId: 'ORG',
    usuariosDaOrg: async () => ['U1'],
    lerBase: async () => s.base,
    existente: async () => (s.existente ? { ...s.existente, pedidoHash: s.ultimoHash } : null),
    // Espelho de `familias.chave_cadastro` + variações gravadas nela.
    async parcial(chave) {
      const f = s.familias.find((x) => x.chave_cadastro === chave);
      if (!f) return null;
      return {
        pedidoHash: (f.kit_variacao_pedido as string | null) ?? null,
        familiaId: 'FAM-KIT', loteId: f.lote_id as string, codigoPai: f.codigo_pai as string,
        variacoes: s.variacoesGravadas.map((v) => ({ codigo: v.codigo as string, cor: v.cor as string, tamanho: v.tamanho as string })),
      };
    },
    async lerOferta(upId, itemIds) {
      s.leituras.push(`${upId} ${itemIds.join(',')}`);
      const o = s.ofertas[upId] ?? {};
      return {
        upId, versao: 1, locais: [{ type: 'selling_address', quantity: 10 }], quantidade: 10,
        itens: itemIds.map((id) => ({ id, status: 'active', subStatus: [] })), somenteSellingAddress: true, ...o,
      } as OfertaUP;
    },
    async fotosEmItemModerado(paths) {
      if (s.erroModeracao) throw new Error(s.erroModeracao);
      return paths.filter((p) => s.moderadas.includes(p));
    },
    exigirFiscal: async () => { if (s.erroFiscal) throw new Error(s.erroFiscal); },
    lerSchema: async () => s.schema,
    garantirGuia: async () => {},
    subirFoto: async (path) => { if (s.fotoQuebrada === path) throw new Error('Object not found'); return `PIC-${path}`; },
    reservarCodigos: async (qtd) => ({
      codigoPai: '00002000', codigos: Array.from({ length: qtd - 1 }, (_, i) => `0000200${i + 1}`),
    }),
    gravar: {
      lote: async () => 'LOTE1',
      familia: async (l) => { s.familias.push(l); return 'FAM-KIT'; },
      variacao: async (l) => { s.variacoesGravadas.push(l); },
      async kit(a) {
        s.kits.push(a);
        s.ultimoHash = a.kit.pedido_hash as string;
        if (s.falhasKit > 0) {
          s.falhasKit--;
          // Resultado incerto: a RPC pode ter gravado (kitGravadoNaFalha) ou não.
          if (s.kitGravadoNaFalha) s.existente = { kitId: 'KIT1', transferenciaId: 'T1' };
          throw new Error('fetch failed');
        }
        return s.rpc;
      },
      desfazer: async (lote, fam) => { s.desfeitos.push([lote, fam]); },
    },
    enfileirarSaga: async (id) => { s.sagas.push(id); },
  };
  return { s, deps };
}

function pedido(extra: Partial<CriarKitVariacaoInput> = {}): CriarKitVariacaoInput {
  return {
    familiaBaseId: 'FAM-BASE', cores: ['Preto', 'Branco', 'Marrom'], pecasPorKit: 2, preco: 89.9,
    quantidades: [
      { cores: ['Branco', 'Preto'], tamanho: 'M', quantidade: 2 },
      { cores: ['Preto', 'Marrom'], tamanho: 'M', quantidade: 0 },
      { cores: ['Preto', 'Branco'], tamanho: 'G', quantidade: 1 },
    ],
    titulo: 'Kit 2 Blusas Canelada', descricao: 'Kit com 2 blusas.',
    fotos: { 'Preto e Branco': 'ORG/kits/pb.jpg', 'Preto e Marrom': 'ORG/kits/pm.jpg' },
    soEmKit: false, meta: 0, chaveCadastro: 'CHAVE1',
    ...extra,
  };
}

const semGravacao = (c: ReturnType<typeof cenario>) =>
  c.s.familias.length + c.s.variacoesGravadas.length + c.s.kits.length + c.s.sagas.length;

describe('criarKitVariacao', () => {
  it('cria família, SKUs só com quantidade > 0, kit numa transação e enfileira a saga', async () => {
    const c = cenario();
    const r = await criarKitVariacao(c.deps, pedido());
    expect(r).toMatchObject({ ok: true, kitId: 'KIT1', transferenciaId: 'T1', existente: false, codigoPai: '00002000' });
    // Quantidade 0 não vira SKU.
    expect(c.s.variacoesGravadas.map((v) => [v.codigo, v.cor, v.tamanho])).toEqual([
      ['00002001', 'Preto e Branco', 'M'], ['00002002', 'Preto e Branco', 'G'],
    ]);
    const k = c.s.kits[0];
    expect(k.skus.map((x) => [x.codigo, x.quantidade, (x.componentes as Linha[]).map((y) => y.codigo)])).toEqual([
      ['00002001', 2, ['P-M', 'B-M']], ['00002002', 1, ['P-G', 'B-G']],
    ]);
    expect(k.kit).toMatchObject({
      codigo_pai_base: '00001000', codigo_pai_kit: '00002000', pecas_por_kit: 2, preco: 89.9, listing_type_id: 'gold_special',
    });
    // Alvos das origens com a cópia de catálogo; baseline lido no ML.
    expect(k.alvos).toContainEqual({ codigo: 'B-M', up_id: 'UP-B-M', item_ids: ['MLB-B-M', 'MLB-CAT-B-M'] });
    expect(k.baseline).toContainEqual({ codigo: 'P-G', ml: 10 });
    expect(c.s.sagas).toEqual(['T1']);
  });

  it('custo e peso são a soma das peças; altura × N; estoque 0; sem GTIN', async () => {
    const c = cenario();
    await criarKitVariacao(c.deps, pedido());
    expect(c.s.variacoesGravadas[0]).toMatchObject({
      custo: 39.75, peso_gramas: 400, altura_cm: 6, largura_cm: 25, comprimento_cm: 30,
      estoque: 0, gtin: null, preco_publicacao: 89.9, imagem_path: 'ORG/kits/pb.jpg', ml_picture_id: 'PIC-ORG/kits/pb.jpg',
    });
  });

  it('SKU de kit nasce com NCM e origem da base, título próprio e sem o texto fiscal da base', async () => {
    const c = cenario();
    await criarKitVariacao(c.deps, pedido());
    const f = c.s.familias[0];
    expect(f).toMatchObject({
      ncm: '61061000', origem: 'nacional', origem_nfe: 0, categoria_ml_id: 'MLB3112', genero: 'feminino',
      nome_pai: 'Kit 2 Blusas Canelada', titulo_ml: 'Kit 2 Blusas Canelada', descricao_fiscal: null,
      status: 'pronto', operacao: 'CREATE', lote_id: 'LOTE1', codigo_pai: '00002000', chave_cadastro: 'CHAVE1',
    });
    // Não é kit vinculado (o predicado `kit_multiplicador` aciona o saldo derivado) nem herda o anúncio da base.
    expect(['kit_multiplicador', 'kit_base_codigo_pai', 'ml_item_id', 'organizations'].filter((k) => k in f)).toEqual([]);
    // COLOR vai por SKU (rótulo da combinação), nunca o da base no nível família.
    expect(f.atributos_ml).toEqual([{ id: 'BRAND', value_name: 'Daludi' }]);
  });

  it('categoria com SALE_FORMAT recebe Kit e a quantidade de peças', async () => {
    const c = cenario();
    c.s.schema = [{ id: 'SALE_FORMAT', nome: 'Formato de venda', required: false, conditionalRequired: false,
      valueType: 'list', valores: [{ id: '1', nome: 'Unidade' }, { id: '2', nome: 'Kit' }], allowedUnits: [], tags: [] }];
    await criarKitVariacao(c.deps, pedido());
    expect(c.s.familias[0].atributos_ml).toEqual(expect.arrayContaining([
      { id: 'SALE_FORMAT', value_id: '2' }, { id: 'UNITS_PER_PACK', value_name: '2' },
    ]));
  });

  it('base Legacy recusa sem gravar nada', async () => {
    const c = cenario();
    c.s.base!.vinculos = c.s.base!.vinculos.map((v) => ({ ...v, user_product_id: null }));
    expect(await criarKitVariacao(c.deps, pedido())).toMatchObject({ ok: false, motivo: 'base_legacy' });
    expect(semGravacao(c)).toBe(0);
  });

  it('Full recusa sem gravar nada', async () => {
    const c = cenario();
    c.s.ofertas['UP-B-G'] = { locais: [{ type: 'meli_facility', quantity: 10 }], somenteSellingAddress: false };
    expect(await criarKitVariacao(c.deps, pedido())).toMatchObject({ ok: false, motivo: 'base_full' });
    expect(semGravacao(c)).toBe(0);
  });

  it('item da base moderado recusa', async () => {
    const c = cenario();
    c.s.ofertas['UP-P-M'] = { itens: [{ id: 'MLB-P-M', status: 'under_review', subStatus: ['forbidden'] }] };
    expect(await criarKitVariacao(c.deps, pedido())).toMatchObject({ ok: false, motivo: 'base_moderada' });
  });

  it('foto usada em item moderado recusa', async () => {
    const c = cenario();
    c.s.moderadas = ['ORG/kits/pb.jpg'];
    expect(await criarKitVariacao(c.deps, pedido())).toMatchObject({ ok: false, motivo: 'foto_moderada' });
    expect(semGravacao(c)).toBe(0);
  });

  it('foto que não sobe ao ML recusa antes de gravar; tipo de anúncio vai para o kit', async () => {
    const c = cenario();
    c.s.fotoQuebrada = 'ORG/kits/pb.jpg';
    expect(await criarKitVariacao(c.deps, pedido())).toMatchObject({ ok: false, motivo: 'foto_invalida' });
    expect(semGravacao(c)).toBe(0);
    const d = cenario();
    await criarKitVariacao(d.deps, pedido({ listingTypeId: 'gold_pro' }));
    expect(d.s.kits[0].kit).toMatchObject({ listing_type_id: 'gold_pro' });
    expect(await criarKitVariacao(d.deps, pedido({ listingTypeId: 'free' as never }))).toMatchObject({ motivo: 'tipo_anuncio_invalido' });
  });

  it('foto de outra org ou sem dono comprovado recusa antes de assinar ou subir', async () => {
    for (const path of ['OUTRA-ORG/kits/pb.jpg', 'kits/pb.jpg', '/ORG/x.jpg', 'ORG/../OUTRA/x.jpg', 'pb.jpg']) {
      const c = cenario();
      let subiu = 0;
      c.deps.subirFoto = async () => { subiu++; return 'PIC'; };
      expect(await criarKitVariacao(c.deps, pedido({ fotos: { 'Preto e Branco': path } }))).toMatchObject({ motivo: 'foto_nao_autorizada' });
      expect(subiu).toBe(0);
      expect(semGravacao(c)).toBe(0);
    }
    // Layout legado {user_id}/...: usuário da org passa.
    const d = cenario();
    expect(await criarKitVariacao(d.deps, pedido({ fotos: { 'Preto e Branco': 'U1/pb.jpg' } }))).toMatchObject({ ok: true });
  });

  it('leitura das fotos no ML que falha recusa (sem prova de que não estão em anúncio moderado)', async () => {
    const c = cenario();
    c.s.erroModeracao = 'ML /items/bulk 500';
    expect(await criarKitVariacao(c.deps, pedido())).toMatchObject({ ok: false, motivo: 'foto_moderacao_ilegivel' });
    expect(semGravacao(c)).toBe(0);
  });

  it('falha depois de gravar a família: a mesma chave retoma sem duplicar', async () => {
    const c = cenario();
    c.s.falhasKit = 1;
    expect(await criarKitVariacao(c.deps, pedido())).toMatchObject({ ok: false, motivo: 'falha_gravar' });
    expect(c.s.desfeitos).toEqual([]);
    expect([c.s.familias.length, c.s.variacoesGravadas.length]).toEqual([1, 2]);
    const r = await criarKitVariacao(c.deps, pedido());
    expect(r).toMatchObject({ ok: true, kitId: 'KIT1', transferenciaId: 'T1' });
    expect([c.s.familias.length, c.s.variacoesGravadas.length]).toEqual([1, 2]);
    expect(c.s.kits.map((k) => k.skus.map((x) => x.codigo))).toEqual([['00002001', '00002002'], ['00002001', '00002002']]);
    expect(c.s.sagas).toEqual(['T1']);
  });

  it('RPC com resultado incerto que gravou: consulta o estado durável, não apaga e enfileira', async () => {
    const c = cenario();
    c.s.falhasKit = 1;
    c.s.kitGravadoNaFalha = true;
    expect(await criarKitVariacao(c.deps, pedido())).toMatchObject({ ok: true, kitId: 'KIT1', transferenciaId: 'T1', existente: true });
    expect(c.s.desfeitos).toEqual([]);
    expect(c.s.sagas).toEqual(['T1']);
  });

  it('combinação publicada sem foto recusa', async () => {
    const c = cenario();
    expect(await criarKitVariacao(c.deps, pedido({ fotos: {} }))).toMatchObject({ ok: false, motivo: 'sem_foto' });
  });

  it('cores repetidas, peças fora de 2..6, preço zero e Vender só em kit recusam', async () => {
    const c = cenario();
    expect(await criarKitVariacao(c.deps, pedido({ cores: ['Preto', 'Preto', 'Branco'] }))).toMatchObject({ motivo: 'cores_invalidas' });
    expect(await criarKitVariacao(c.deps, pedido({ pecasPorKit: 7 }))).toMatchObject({ motivo: 'pecas_invalidas' });
    expect(await criarKitVariacao(c.deps, pedido({ preco: 0 }))).toMatchObject({ motivo: 'preco_invalido' });
    expect(await criarKitVariacao(c.deps, pedido({ soEmKit: true }))).toMatchObject({ motivo: 'so_em_kit_indisponivel' });
    expect(await criarKitVariacao(c.deps, pedido({
      quantidades: [{ cores: ['Preto', 'Branco'], tamanho: 'M', quantidade: 1 }, { cores: ['Branco', 'Preto'], tamanho: 'M', quantidade: 1 }],
    }))).toMatchObject({ motivo: 'combinacao_repetida' });
    expect(await criarKitVariacao(c.deps, pedido({
      quantidades: [{ cores: ['Preto', 'Branco'], tamanho: 'M', quantidade: 0 }],
    }))).toMatchObject({ motivo: 'sem_kit' });
    expect(semGravacao(c)).toBe(0);
  });

  it('peça insuficiente no saldo local recusa', async () => {
    const c = cenario();
    expect(await criarKitVariacao(c.deps, pedido({
      quantidades: [{ cores: ['Preto', 'Branco'], tamanho: 'M', quantidade: 11 }],
    }))).toMatchObject({ ok: false, motivo: 'peca_insuficiente' });
  });

  it('cadastro fiscal incompleto e origem ausente recusam antes de gravar', async () => {
    const c = cenario();
    c.s.erroFiscal = 'Cadastro fiscal incompleto';
    expect(await criarKitVariacao(c.deps, pedido())).toMatchObject({ ok: false, motivo: 'fiscal_incompleto' });
    const d = cenario();
    d.s.base!.familia.origem = null;
    expect(await criarKitVariacao(d.deps, pedido())).toMatchObject({ ok: false, motivo: 'origem_ausente' });
    expect(semGravacao(c) + semGravacao(d)).toBe(0);
  });

  it('módulo desligado e base que não é a mais recente recusam', async () => {
    const c = cenario();
    c.s.base!.familia.organizations = { modulos_habilitados: [] };
    expect(await criarKitVariacao(c.deps, pedido())).toMatchObject({ motivo: 'modulo_desligado' });
    const d = cenario();
    d.s.base!.canonica = false;
    expect(await criarKitVariacao(d.deps, pedido())).toMatchObject({ motivo: 'base_desatualizada' });
  });

  it('recusa da RPC (baseline, kit vinculado) desfaz família e variações e não enfileira', async () => {
    const c = cenario();
    c.s.rpc = { ok: false, motivo: 'baseline_divergente', codigo: 'P-M: local 10, ML 9' };
    expect(await criarKitVariacao(c.deps, pedido())).toMatchObject({ ok: false, motivo: 'baseline_divergente' });
    expect(c.s.desfeitos).toEqual([['LOTE1', 'FAM-KIT']]);
    expect(c.s.sagas).toEqual([]);
  });

  it('mesma chave devolve o kit já criado e reenfileira, sem gravar de novo', async () => {
    const c = cenario();
    await criarKitVariacao(c.deps, pedido());
    c.s.existente = { kitId: 'KIT1', transferenciaId: 'T1' };
    expect(await criarKitVariacao(c.deps, pedido())).toEqual({ ok: true, kitId: 'KIT1', transferenciaId: 'T1', existente: true });
    expect(c.s.familias).toHaveLength(1);
    expect(c.s.sagas).toEqual(['T1', 'T1']);
  });

  it('chave presa ao pedido: retomada com preço 99,90 sobre 89,90 recusa; o pedido idêntico retoma', async () => {
    const c = cenario();
    c.s.falhasKit = 1;
    expect(await criarKitVariacao(c.deps, pedido({ preco: 89.9 }))).toMatchObject({ motivo: 'falha_gravar' });
    expect(c.s.familias[0].kit_variacao_pedido).toMatch(/^[0-9a-f]{64}$/);
    expect(await criarKitVariacao(c.deps, pedido({ preco: 99.9 }))).toMatchObject({ ok: false, motivo: 'pedido_diferente' });
    expect(await criarKitVariacao(c.deps, pedido({ preco: 89.9, fotos: { 'Preto e Branco': 'ORG/outra.jpg' } })))
      .toMatchObject({ motivo: 'pedido_diferente' });
    expect([c.s.familias.length, c.s.variacoesGravadas.length, c.s.kits.length]).toEqual([1, 2, 1]);
    expect(await criarKitVariacao(c.deps, pedido({ preco: 89.9 }))).toMatchObject({ ok: true, kitId: 'KIT1' });
    expect(c.s.kits[1].kit).toMatchObject({ preco: 89.9, pedido_hash: c.s.familias[0].kit_variacao_pedido });
  });

  it('kit já criado: a mesma chave com outro pedido recusa sem reenfileirar', async () => {
    const c = cenario();
    await criarKitVariacao(c.deps, pedido({ preco: 89.9 }));
    c.s.existente = { kitId: 'KIT1', transferenciaId: 'T1' };
    expect(await criarKitVariacao(c.deps, pedido({ preco: 99.9 }))).toMatchObject({ ok: false, motivo: 'pedido_diferente' });
    expect(c.s.sagas).toEqual(['T1']);
  });
});
