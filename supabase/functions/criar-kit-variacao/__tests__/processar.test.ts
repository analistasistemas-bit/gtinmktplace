import { describe, it, expect } from 'vitest';
import {
  adicionarAoKit, criarKitVariacao, pedidoHash, type AdicionarKitInput, type DepsAdicao, type BaseKit, type CriarKitVariacaoInput, type DepsCriarKitVariacao, type ResultadoRpcKit,
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
    /** Roda dentro de `gravar.variacoes`, antes da releitura: a outra requisição da mesma chave grava aqui. */
    antesDeGravarVariacoes: () => {},
    kits: [] as Array<Parameters<DepsCriarKitVariacao['gravar']['kit']>[0]>,
    desfeitos: [] as Array<[string, string | null]>,
    sagas: [] as string[],
    leituras: [] as string[],
    previa: { baseId: 'FAM-BASE', pecas: 2, kitId: null as string | null } as { baseId: string; pecas: number; kitId: string | null } | null,
    consumos: [] as Array<Record<string, unknown>>,
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
        variacoes: s.variacoesGravadas.map((v) => ({
          codigo: v.codigo as string, cor: v.cor as string, tamanho: v.tamanho as string,
          galeria: v.galeria_ml_fotos as Array<{ id: string; item: string }>,
        })),
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
      // Espelho de `kit_variacao_gravar_variacoes`: sob o lock, cor + tamanho já gravado reaproveita o código.
      async variacoes(_familiaId, linhas) {
        s.antesDeGravarVariacoes();
        return linhas.map((l) => {
          const ja = s.variacoesGravadas.find((v) => v.cor === l.cor && v.tamanho === l.tamanho);
          if (ja) return ja.codigo as string;
          s.variacoesGravadas.push(l);
          return l.codigo as string;
        });
      },
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
    previa: {
      ler: async () => s.previa,
      consumir: async (a) => { s.consumos.push(a); return { ok: true }; },
    },
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

  it('MODEL herdado da base perde as cores da base (mais longa primeiro); sem cor sobrando, usa o título do kit', async () => {
    const c = cenario();
    c.s.base!.variacoes.push(variacao('A-M', 'Azul', 'M'), variacao('AC-M', 'Azul Claro', 'M'));
    c.s.base!.familia.atributos_ml = [
      { id: 'BRAND', value_name: 'Daludi' }, { id: 'MODEL', value_name: 'Blusa Canelada Azul Claro Preto' },
    ];
    await criarKitVariacao(c.deps, pedido());
    expect(c.s.familias[0].atributos_ml).toContainEqual({ id: 'MODEL', value_name: 'Blusa Canelada' });
    const d = cenario();
    d.s.base!.familia.atributos_ml = [{ id: 'MODEL', value_name: 'Preto' }];
    await criarKitVariacao(d.deps, pedido());
    expect(d.s.familias[0].atributos_ml).toContainEqual({ id: 'MODEL', value_name: 'Kit 2 Blusas Canelada' });
  });

  it('categoria com MAIN_COLOR recebe Multicolorido (kit tem 2+ cores); sem MAIN_COLOR no schema nada é enviado', async () => {
    const c = cenario();
    c.s.schema = [{ id: 'MAIN_COLOR', nome: 'Cor principal', required: false, conditionalRequired: false,
      valueType: 'list', valores: [{ id: '1', nome: 'Preto' }, { id: '9', nome: 'Multicolorido' }], allowedUnits: [], tags: [] }];
    c.s.base!.familia.atributos_ml = [{ id: 'MAIN_COLOR', value_id: '1' }];
    await criarKitVariacao(c.deps, pedido());
    expect(c.s.familias[0].atributos_ml).toEqual([{ id: 'MAIN_COLOR', value_id: '9' }]);
    const d = cenario();
    await criarKitVariacao(d.deps, pedido());
    expect(d.s.familias[0].atributos_ml?.some((a: { id: string }) => a.id === 'MAIN_COLOR')).toBe(false);
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

  it('repetição concorrente da mesma chave reaproveita as variações da outra, sem órfãs (achado 4 da revisão final)', async () => {
    const c = cenario();
    // A: gravou a família e parou antes das variações.
    c.s.antesDeGravarVariacoes = () => { throw new Error('fetch failed'); };
    expect(await criarKitVariacao(c.deps, pedido())).toMatchObject({ ok: false, motivo: 'falha_gravar' });
    expect([c.s.familias.length, c.s.variacoesGravadas.length]).toEqual([1, 0]);
    // B leu o parcial vazio e reservou outros códigos; A grava as dela entre a leitura e a gravação de B.
    let reservados: string[] = [];
    const reservar = c.deps.reservarCodigos;
    c.deps.reservarCodigos = async (qtd) => {
      const r = await reservar(qtd);
      reservados = r.codigos = r.codigos.map((x) => x.replace('0000200', 'B000200'));
      return r;
    };
    c.s.antesDeGravarVariacoes = () => {
      c.s.antesDeGravarVariacoes = () => {};
      c.s.variacoesGravadas.push({ codigo: 'A-PB-M', cor: 'Preto e Branco', tamanho: 'M' }, { codigo: 'A-PB-G', cor: 'Preto e Branco', tamanho: 'G' });
    };
    const r = await criarKitVariacao(c.deps, pedido());
    expect(r).toMatchObject({ ok: true, kitId: 'KIT1' });
    expect(reservados).toEqual(['B0002001', 'B0002002']);
    expect(c.s.variacoesGravadas.map((v) => v.codigo)).toEqual(['A-PB-M', 'A-PB-G']);
    expect(c.s.kits.at(-1)!.skus.map((x) => x.codigo)).toEqual(['A-PB-M', 'A-PB-G']);
    expect((r as { skus?: Array<{ codigo: string }> }).skus?.map((x) => x.codigo)).toEqual(['A-PB-M', 'A-PB-G']);
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

  it('Vender só em kit (Task 14): o kit vai à RPC com a opção; os componentes viram Guardado lá, antes da montagem', async () => {
    const c = cenario();
    expect(await criarKitVariacao(c.deps, pedido({ soEmKit: true, meta: 3 }))).toMatchObject({ ok: true });
    expect(c.s.kits[0].kit).toMatchObject({ so_em_kit: true, meta: 3 });
    const d = cenario();
    await criarKitVariacao(d.deps, pedido());
    expect(d.s.kits[0].kit).toMatchObject({ so_em_kit: false });
  });

  it('cores repetidas, peças fora de 2..6 e preço zero recusam', async () => {
    const c = cenario();
    expect(await criarKitVariacao(c.deps, pedido({ cores: ['Preto', 'Preto', 'Branco'] }))).toMatchObject({ motivo: 'cores_invalidas' });
    expect(await criarKitVariacao(c.deps, pedido({ pecasPorKit: 7 }))).toMatchObject({ motivo: 'pecas_invalidas' });
    expect(await criarKitVariacao(c.deps, pedido({ preco: 0 }))).toMatchObject({ motivo: 'preco_invalido' });
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

describe('prévia do texto por IA (Task 11, rodada 1)', () => {
  it('prévia válida: kit criado e consumo associado ao kit e à chave', async () => {
    const c = cenario();
    const r = await criarKitVariacao(c.deps, pedido({ previaId: 'PREV1' }));
    expect(r.ok).toBe(true);
    expect(c.s.consumos).toEqual([{ previaId: 'PREV1', kitId: 'KIT1', chave: 'CHAVE1', baseId: 'FAM-BASE', pecas: 2 }]);
  });
  it.each([
    ['inexistente', null, 'previa_invalida'],
    ['de outra base', { baseId: 'OUTRA', pecas: 2, kitId: null }, 'previa_divergente'],
    ['de outras peças', { baseId: 'FAM-BASE', pecas: 3, kitId: null }, 'previa_divergente'],
    ['já usada', { baseId: 'FAM-BASE', pecas: 2, kitId: 'KIT-OUTRO' }, 'previa_usada'],
  ])('prévia %s recusa sem gravar nada', async (_n, previa, motivo) => {
    const c = cenario();
    c.s.previa = previa;
    expect(await criarKitVariacao(c.deps, pedido({ previaId: 'PREV1' }))).toMatchObject({ ok: false, motivo });
    expect(semGravacao(c)).toBe(0);
  });
  it('RPC incerta que gravou o kit: a prévia ainda é associada', async () => {
    const c = cenario();
    c.s.falhasKit = 1;
    c.s.kitGravadoNaFalha = true;
    await criarKitVariacao(c.deps, pedido({ previaId: 'PREV1' }));
    expect(c.s.consumos).toHaveLength(1);
    expect(c.s.consumos[0]).toMatchObject({ kitId: 'KIT1', chave: 'CHAVE1' });
  });
  // B leu `existente` antes de A terminar (null); ao reler, o kit de A já existe com o mesmo pedido.
  async function corrida(kitDaPrevia: string) {
    const a = cenario();
    await criarKitVariacao(a.deps, pedido({ previaId: 'PREV1' }));
    const c = cenario();
    let leituras = 0;
    c.deps.existente = async () => {
      if (++leituras === 1) return null;
      return { kitId: 'KIT1', transferenciaId: 'T1', pedidoHash: a.s.ultimoHash };
    };
    c.s.previa = { baseId: 'FAM-BASE', pecas: 2, kitId: kitDaPrevia };
    return { c, r: await criarKitVariacao(c.deps, pedido({ previaId: 'PREV1' })) };
  }
  it('corrida da mesma chave: prévia já associada a ESTE kit devolve o kit, sem 409', async () => {
    const { c, r } = await corrida('KIT1');
    expect(r).toEqual({ ok: true, kitId: 'KIT1', transferenciaId: 'T1', existente: true });
    expect(c.s.familias.length + c.s.kits.length).toBe(0);
    expect(c.s.sagas).toEqual(['T1']);
  });
  it('prévia associada a OUTRO kit continua recusada', async () => {
    const { c, r } = await corrida('KIT-OUTRO');
    expect(r).toMatchObject({ ok: false, motivo: 'previa_usada' });
    expect(c.s.familias.length + c.s.kits.length).toBe(0);
  });
  it('sem previaId nada é consumido', async () => {
    const c = cenario();
    await criarKitVariacao(c.deps, pedido());
    expect(c.s.consumos).toEqual([]);
  });
  it('o clone da família do kit zera os campos de IA herdados da base', async () => {
    const c = cenario();
    c.s.base!.familia = { ...c.s.base!.familia, tokens_input: 900, tokens_output: 400, custo_centavos: 7 };
    await criarKitVariacao(c.deps, pedido());
    expect(c.s.familias[0]).toMatchObject({ tokens_input: null, tokens_output: null, custo_centavos: null });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Task 13 (ajuste + fix round 1): Montar mais com combinação/tamanho nunca publicado vira SKU novo no MESMO kit. A
// variação nova vai DENTRO da RPC (`kit_variacao_adicionar`): nada fica na família publicada fora da transação.

function cenarioAdicao() {
  const c = cenario();
  const a = {
    kitLido: true,
    existente: null as { kitId: string; transferenciaId: string; pedidoHash: string } | null,
    variacoesKit: [
      { codigo: 'K-PB-M', cor: 'Preto e Branco', tamanho: 'M', imagemPath: 'ORG/kits/pb-antiga.jpg', pictureId: 'PIC-OLD' },
    ],
    vinculosKit: [{ sku: 'K-PB-M', item_externo_id: 'MLB-K-PB-M', user_product_id: 'UP-K-PB-M', catalog_listing_id: null }] as
      Array<{ sku: string; item_externo_id: string | null; user_product_id: string | null; catalog_listing_id: string | null }>,
    rpc: { ok: true, kit_id: 'KIT1', transferencia_id: 'T9' } as ResultadoRpcKit,
    gravacoes: [] as Array<Parameters<DepsAdicao['gravar']>[0]>,
    subidas: [] as string[],
  };
  const subir = c.deps.subirFoto;
  c.deps.subirFoto = async (path) => { a.subidas.push(path); return subir(path); };
  const adicao: DepsAdicao = {
    existente: async () => a.existente,
    async lerKit(id) {
      if (!a.kitLido || id !== 'KIT1') return null;
      return {
        kitId: 'KIT1', baseId: 'FAM-BASE', familiaKitId: 'FAM-KIT', pecasPorKit: 2, preco: 89.9,
        skus: [{ codigo: 'K-PB-M', cores: ['Preto', 'Branco'], tamanho: 'M', rotulo: 'Preto e Branco' }],
        variacoes: a.variacoesKit, vinculos: a.vinculosKit,
      };
    },
    async gravar(args) { a.gravacoes.push(args); return a.rpc; },
  };
  c.deps.adicao = adicao;
  return { ...c, a };
}

const montarMais = (extra: Partial<AdicionarKitInput> = {}): AdicionarKitInput => ({
  kitId: 'KIT1', versao: 5, chaveCadastro: 'CH-ADD', fotos: {},
  quantidades: [{ cores: ['Preto', 'Branco'], tamanho: 'M', quantidade: 1 }],
  ...extra,
});

describe('adicionarAoKit (Montar mais com SKU novo)', () => {
  it('sem a versão lida recusa sem gravar', async () => {
    const c = cenarioAdicao();
    expect(await adicionarAoKit(c.deps, montarMais({ versao: undefined }))).toMatchObject({ ok: false, motivo: 'versao' });
    expect(c.a.gravacoes).toEqual([]);
  });

  it('só combinação publicada: aumenta o saldo, sem SKU novo nem foto; versão e família do kit vão à RPC', async () => {
    const c = cenarioAdicao();
    const r = await adicionarAoKit(c.deps, montarMais({ quantidades: [{ cores: ['Branco', 'Preto'], tamanho: 'M', quantidade: 2 }] }));
    expect(r).toMatchObject({ ok: true, transferenciaId: 'T9' });
    const g = c.a.gravacoes[0];
    expect(g).toMatchObject({ kitId: 'KIT1', versao: 5, familiaId: 'FAM-KIT', novos: [], existentes: [{ codigo: 'K-PB-M', quantidade: 2 }] });
    expect(g.alvos.map((x) => x.codigo).sort()).toEqual(['B-M', 'K-PB-M', 'P-M']);
    expect(c.s.sagas).toEqual(['T9']);
  });

  it('combinação nunca publicada exige foto própria: sem ela recusa sem gravar', async () => {
    const c = cenarioAdicao();
    const r = await adicionarAoKit(c.deps, montarMais({ quantidades: [{ cores: ['Preto', 'Marrom'], tamanho: 'M', quantidade: 1 }] }));
    expect(r).toMatchObject({ ok: false, motivo: 'sem_foto' });
    expect(c.s.variacoesGravadas.length + c.a.gravacoes.length).toBe(0);
  });

  it('combinação nova: a linha da variação vai DENTRO da RPC (nenhum insert antes), com a foto que subiu', async () => {
    const c = cenarioAdicao();
    const r = await adicionarAoKit(c.deps, montarMais({
      quantidades: [
        { cores: ['Preto', 'Branco'], tamanho: 'M', quantidade: 1 },
        { cores: ['Marrom', 'Preto'], tamanho: 'M', quantidade: 2 },
      ],
      fotos: { 'Preto e Marrom': 'ORG/kits/pm.jpg' },
    }));
    expect(r).toMatchObject({ ok: true, transferenciaId: 'T9' });
    expect(c.s.variacoesGravadas).toEqual([]);
    const g = c.a.gravacoes[0];
    expect(g.novos).toHaveLength(1);
    const novo = g.novos[0] as Record<string, unknown>;
    expect(novo).toMatchObject({
      tamanho: 'M', cores: ['Preto', 'Marrom'], rotulo_cor: 'Preto e Marrom', quantidade: 2,
      componentes: [{ codigo: 'P-M', quantidade: 1 }, { codigo: 'M-M', quantidade: 1 }],
    });
    expect(novo.variacao).toMatchObject({
      familia_id: 'FAM-KIT', codigo: novo.codigo, cor: 'Preto e Marrom', tamanho: 'M', estoque: 0, preco: 89.9,
      imagem_path: 'ORG/kits/pm.jpg', ml_picture_id: 'PIC-ORG/kits/pm.jpg', custo: 38.5,
    });
    expect(g.existentes).toEqual([{ codigo: 'K-PB-M', quantidade: 1 }]);
    expect(g.baseline.map((b) => b.codigo).sort()).toEqual(['B-M', 'M-M', 'P-M']);
    expect(c.a.subidas).toEqual(['ORG/kits/pm.jpg']);
  });

  it('tamanho novo de combinação publicada: usa as cores e o rótulo gravados (mesmo COLOR) e a foto da combinação', async () => {
    const c = cenarioAdicao();
    const r = await adicionarAoKit(c.deps, montarMais({ quantidades: [{ cores: ['Branco', 'Preto'], tamanho: 'G', quantidade: 1 }] }));
    expect(r).toMatchObject({ ok: true });
    const novo = c.a.gravacoes[0].novos[0] as Record<string, unknown>;
    expect(novo).toMatchObject({ cores: ['Preto', 'Branco'], rotulo_cor: 'Preto e Branco', tamanho: 'G' });
    expect(novo.variacao).toMatchObject({ cor: 'Preto e Branco', tamanho: 'G', imagem_path: 'ORG/kits/pb-antiga.jpg', ml_picture_id: 'PIC-OLD' });
    expect(c.a.subidas).toEqual([]);
  });

  it('SKU publicado sem anúncio (UP) recusa', async () => {
    const c = cenarioAdicao();
    c.a.vinculosKit = [];
    expect(await adicionarAoKit(c.deps, montarMais())).toMatchObject({ ok: false, motivo: 'sku_sem_anuncio' });
    expect(c.a.gravacoes).toEqual([]);
  });

  it('peças somadas entre combinações publicadas e novas: falta recusa antes de gravar', async () => {
    const c = cenarioAdicao();
    const r = await adicionarAoKit(c.deps, montarMais({
      quantidades: [
        { cores: ['Preto', 'Branco'], tamanho: 'M', quantidade: 6 },
        { cores: ['Preto', 'Marrom'], tamanho: 'M', quantidade: 5 },
      ],
      fotos: { 'Preto e Marrom': 'ORG/kits/pm.jpg' },
    }));
    expect(r).toMatchObject({ ok: false, motivo: 'peca_insuficiente' });
    expect(c.a.gravacoes).toEqual([]);
  });

  it('kit de outra org ou inexistente recusa', async () => {
    const c = cenarioAdicao();
    c.a.kitLido = false;
    expect(await adicionarAoKit(c.deps, montarMais())).toMatchObject({ ok: false, motivo: 'kit_nao_encontrado' });
  });

  it('mesma chave: mesmo pedido devolve a transferência; outro pedido recusa', async () => {
    const c = cenarioAdicao();
    await adicionarAoKit(c.deps, montarMais());
    const hash = c.a.gravacoes[0].hash;
    c.a.existente = { kitId: 'KIT1', transferenciaId: 'T9', pedidoHash: hash };
    expect(await adicionarAoKit(c.deps, montarMais())).toMatchObject({ ok: true, existente: true, transferenciaId: 'T9' });
    expect(c.a.gravacoes).toHaveLength(1);
    expect(await adicionarAoKit(c.deps, montarMais({ quantidades: [{ cores: ['Preto', 'Branco'], tamanho: 'M', quantidade: 3 }] })))
      .toMatchObject({ ok: false, motivo: 'pedido_diferente' });
  });

  it('recusa da RPC: nada a desfazer (a variação só existiria dentro da transação recusada)', async () => {
    const c = cenarioAdicao();
    c.a.rpc = { ok: false, motivo: 'versao' };
    const r = await adicionarAoKit(c.deps, montarMais({
      quantidades: [{ cores: ['Preto', 'Marrom'], tamanho: 'M', quantidade: 1 }], fotos: { 'Preto e Marrom': 'ORG/kits/pm.jpg' },
    }));
    expect(r).toMatchObject({ ok: false, motivo: 'versao' });
    expect(c.s.variacoesGravadas).toEqual([]);
    expect(c.s.sagas).toEqual([]);
  });

  it('combinação com número de peças diferente do kit recusa', async () => {
    const c = cenarioAdicao();
    expect(await adicionarAoKit(c.deps, montarMais({ quantidades: [{ cores: ['Preto', 'Branco', 'Marrom'], tamanho: 'M', quantidade: 1 }] })))
      .toMatchObject({ ok: false, motivo: 'combinacao_invalida' });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// ADR-0200 (adendo 12/11): galeria das peças no anúncio do kit. O servidor recalcula a proposta; o cliente só remove.

const FG = (id: string, item: string) => ({ id, item });
const PROPOSTA = [FG('P2', 'MLB-P-M'), FG('B3', 'MLB-B-M'), FG('P4', 'MLB-P-M')];
function comGaleria(c: ReturnType<typeof cenario>, proposta = PROPOSTA) {
  const chamadas: Array<{ pecas: Array<{ cor: string; itemId: string }>; categoria: string }> = [];
  c.deps.lerGaleria = async (pecas, categoria) => { chamadas.push({ pecas, categoria }); return { fotos: proposta, avisos: [], indisponivel: false }; };
  return chamadas;
}
const galeriaGravada = (c: ReturnType<typeof cenario>) => c.s.variacoesGravadas.map((v) => [v.tamanho, v.galeria_ml_fotos]);

describe('criarKitVariacao com galeria das peças', () => {
  it('sem galeria no pedido: não lê o ML, grava lista vazia e o hash é o de sempre', async () => {
    const c = cenario();
    const chamadas = comGaleria(c);
    const r = await criarKitVariacao(c.deps, pedido());
    expect(r).toMatchObject({ ok: true });
    expect(chamadas).toEqual([]);
    expect(galeriaGravada(c)).toEqual([['M', []], ['G', []]]);
    const combos = [{ rotulo: 'Preto e Branco', tamanho: 'M', quantidade: 2 }, { rotulo: 'Preto e Branco', tamanho: 'G', quantidade: 1 }];
    expect(await pedidoHash(pedido(), combos)).toBe('9bc14f63e9b7d0b1b1b132eea3141556d935cd5d3d1a4ac2ecba35261d2aae06');   // medido antes da galeria: retomada pós-deploy não vira pedido_diferente
  });

  it('galeria ligada: lê a peça de cada cor (1º tamanho) com a categoria e grava a mesma lista em todos os tamanhos', async () => {
    const c = cenario();
    const chamadas = comGaleria(c);
    const r = await criarKitVariacao(c.deps, pedido({ galeria: { 'Preto e Branco': ['P2', 'B3', 'P4'] } }));
    expect(r).toMatchObject({ ok: true });
    expect(chamadas).toEqual([{ pecas: [{ cor: 'Preto', itemId: 'MLB-P-M' }, { cor: 'Branco', itemId: 'MLB-B-M' }], categoria: 'MLB3112' }]);
    expect(galeriaGravada(c)).toEqual([['M', PROPOSTA], ['G', PROPOSTA]]);
  });

  it('o cliente só remove: reordenar, mandar id da imagem 1 ou id desconhecido é descartado, na ordem da proposta', async () => {
    const c = cenario();
    comGaleria(c);
    const r = await criarKitVariacao(c.deps, pedido({ galeria: { 'Preto e Branco': ['P4', 'P1', 'X9', 'P2'] } }));
    expect(r).toMatchObject({ ok: true });
    expect(galeriaGravada(c)[0][1]).toEqual([FG('P2', 'MLB-P-M'), FG('P4', 'MLB-P-M')]);
  });

  it('operador removeu todas as fotos: lista vazia, sem erro', async () => {
    const c = cenario();
    comGaleria(c);
    await criarKitVariacao(c.deps, pedido({ galeria: { 'Preto e Branco': [] } }));
    expect(galeriaGravada(c)).toEqual([['M', []], ['G', []]]);
  });

  it('o hash do pedido muda com a galeria e é estável com a mesma galeria', async () => {
    const combos = [{ rotulo: 'Preto e Branco', tamanho: 'M', quantidade: 2 }];
    const a = await pedidoHash(pedido({ galeria: { 'Preto e Branco': ['P2', 'B3'] } }), combos);
    expect(await pedidoHash(pedido({ galeria: { 'Preto e Branco': ['P2', 'B3'] } }), combos)).toBe(a);
    expect(await pedidoHash(pedido({ galeria: { 'Preto e Branco': ['P2'] } }), combos)).not.toBe(a);
    expect(a).not.toBe(await pedidoHash(pedido(), combos));
  });

  it('leitura das peças indisponível: o kit é criado só com a foto dele e volta o aviso', async () => {
    const c = cenario();
    c.deps.lerGaleria = async () => ({ fotos: [], avisos: ['Fotos das peças indisponíveis (ML /items/bulk 500).'], indisponivel: true });
    const r = await criarKitVariacao(c.deps, pedido({ galeria: { 'Preto e Branco': ['P2'] } }));
    expect(r).toMatchObject({ ok: true });
    expect(galeriaGravada(c)).toEqual([['M', []], ['G', []]]);
    expect((r as { avisos?: string[] }).avisos?.join(' ')).toMatch(/indisponíveis/);
  });

  it('a galeria nunca recusa o kit: a leitura lançando vira aviso', async () => {
    const c = cenario();
    c.deps.lerGaleria = async () => { throw new Error('boom'); };
    const r = await criarKitVariacao(c.deps, pedido({ galeria: { 'Preto e Branco': ['P2'] } }));
    expect(r).toMatchObject({ ok: true });
    expect(galeriaGravada(c)[0][1]).toEqual([]);
    expect((r as { avisos?: string[] }).avisos?.length).toBe(1);
  });

  it('sem a porta lerGaleria (edge sem a leitura) ignora a galeria sem lançar', async () => {
    const c = cenario();
    const r = await criarKitVariacao(c.deps, pedido({ galeria: { 'Preto e Branco': ['P2'] } }));
    expect(r).toMatchObject({ ok: true });
    expect(galeriaGravada(c)[0][1]).toEqual([]);
  });

  it('retomada: tamanho que falta reusa a lista da irmã já gravada, mesmo que a leitura agora devolva outra', async () => {
    const c = cenario();
    comGaleria(c);
    const p = pedido({ galeria: { 'Preto e Branco': ['P2', 'B3', 'P4'] } });
    await criarKitVariacao(c.deps, p);
    const m = c.s.variacoesGravadas[0];
    c.s.variacoesGravadas = [m];       // 1ª tentativa caiu: só o M ficou gravado, sem kit
    c.s.kits = []; c.s.sagas = [];
    comGaleria(c, [FG('P2', 'MLB-P-M'), FG('B3', 'MLB-B-M'), FG('P9', 'MLB-P-M')]);   // o ML mudou
    await criarKitVariacao(c.deps, p);
    const g = c.s.variacoesGravadas.find((v) => v.tamanho === 'G')!;
    expect(g.galeria_ml_fotos).toEqual(m.galeria_ml_fotos);
  });
});
