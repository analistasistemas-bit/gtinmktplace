import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseItensBulk } from '../../ads/campanhas.ts';
import { caminhoMultiget } from '../../ml/multiget.ts';
import { montarCadastro } from '../../promocoes/cadastro.ts';
import { buscarItensML } from '../../promocoes/ml.ts';
import { type DepsMargens, margemDoAlvo, margensDoCatalogo, simularMargem } from '../margens.ts';
import { soDoVendedor } from '../so-do-vendedor.ts';

const CONTA = '111222333';
const CAMPOS = 'id,status,original_price';
const corpo = (id: string, seller_id?: unknown) =>
  ({ id, title: 'T', status: 'active', price: 10, ...(seller_id === undefined ? {} : { seller_id }) });
const ok = (id: string, seller_id?: unknown) => ({ status_code: 200, body: corpo(id, seller_id) });

afterEach(() => vi.restoreAllMocks());

/** `get` falso do ML: guarda os caminhos pedidos e devolve sempre a mesma resposta. */
function fakeML(resposta: unknown) {
  const caminhos: string[] = [];
  return { caminhos, get: (p: string) => { caminhos.push(p); return Promise.resolve(resposta); } };
}
const precos = async (resposta: unknown, ids: string[]) =>
  parseItensBulk(await soDoVendedor(fakeML(resposta).get, CONTA)(caminhoMultiget(ids, CAMPOS)), ids);

describe('soDoVendedor', () => {
  it('pede o vendedor e preserva os campos do app nas duas leituras', async () => {
    const ml = fakeML([ok('MLB1', 111222333)]);
    const get = soDoVendedor(ml.get, CONTA);
    await get(caminhoMultiget(['MLB1'], CAMPOS));
    await buscarItensML(get, ['MLB1']);
    expect(ml.caminhos).toHaveLength(2);
    for (const c of ml.caminhos) {
      const campos = new URL(`https://x${c}`).searchParams.get('attributes')!.split(',');
      expect(campos).toContain('status_code');
      expect(campos.filter((x) => x === 'body.seller_id')).toHaveLength(1);
      expect(campos).toContain('body.id');
    }
    expect(ml.caminhos[0]).toContain('body.original_price');
    expect(ml.caminhos[1]).toContain('&include_attributes=all');
  });

  it('mantém o anúncio da conta, com o vendedor em número ou texto', async () => {
    const m = await precos([ok('MLB1', 111222333), ok('MLB2', CONTA)], ['MLB1', 'MLB2']);
    expect([...m.keys()]).toEqual(['MLB1', 'MLB2']);
  });

  it.each([
    ['outro vendedor', 444555666],
    ['vendedor ausente', undefined],
    ['vendedor nulo', null],
    ['vendedor em objeto', { id: 111222333 }],
    ['vendedor em lista', [111222333]],
  ])('descarta o 200 com %s nas duas leituras', async (_n, vendedor) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resposta = [ok('MLB1', 111222333), ok('MLB2', vendedor)];
    expect([...(await precos(resposta, ['MLB1', 'MLB2'])).keys()]).toEqual(['MLB1']);
    const itens = await buscarItensML(soDoVendedor(fakeML(resposta).get, CONTA), ['MLB1', 'MLB2']);
    expect([...itens.keys()]).toEqual(['MLB1']);
  });

  it('descartado vira 403 sem corpo na mesma posição; 403 e 404 do ML passam intactos', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ids = ['MLB1', 'MLB2', 'MLB3', 'MLB4'];
    const get = soDoVendedor(
      fakeML([ok('MLB1', 1), { status_code: 404 }, { status_code: 403 }, ok('MLB4', 111222333)]).get, CONTA);
    expect(await get(caminhoMultiget(ids, CAMPOS)))
      .toEqual([{ status_code: 403 }, { status_code: 404 }, { status_code: 403 }, ok('MLB4', 111222333)]);
    expect(aviso.mock.calls).toEqual([['[agentes] anúncio fora da conta descartado', { quantidade: 1 }]]);
  });

  it('confere todo envelope com corpo, inclusive no formato antigo', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const antigo = { code: 200, body: corpo('MLB1', 1) };
    const get = soDoVendedor(fakeML([antigo, { status_code: 206, body: corpo('MLB2', 1) }]).get, CONTA);
    expect(await get(caminhoMultiget(['MLB1', 'MLB2'], 'id'))).toEqual([{ status_code: 403 }, { status_code: 403 }]);
  });

  it('número acima do inteiro seguro é descartado: o JSON já pode tê-lo arredondado para a conta', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resposta = JSON.parse('[{"status_code":200,"body":{"id":"MLB1","seller_id":9007199254740993}}]');
    expect(await soDoVendedor(fakeML(resposta).get, '9007199254740992')(caminhoMultiget(['MLB1'], 'id'))).toEqual([{ status_code: 403 }]);
  });

  it('não avisa quando nada é descartado', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await precos([ok('MLB1', 111222333), { status_code: 403 }], ['MLB1', 'MLB2']);
    expect(aviso).not.toHaveBeenCalled();
  });

  it('erro do ML sobe e resposta que não é lista vira lista vazia', async () => {
    const erro = new Error('ML 500 em /items/bulk');
    await expect(soDoVendedor(() => Promise.reject(erro), CONTA)(caminhoMultiget(['MLB1'], 'id'))).rejects.toBe(erro);
    expect(await soDoVendedor(fakeML({ error: 'x' }).get, CONTA)(caminhoMultiget(['MLB1'], 'id'))).toEqual([]);
  });

  it('recusa caminho que não é o bulk, em vez de ler sem conferir o vendedor', async () => {
    const ml = fakeML({});
    await expect(soDoVendedor(ml.get, CONTA)('/items/MLB1')).rejects.toThrow('agentes.leitura_sem_vendedor');
    expect(ml.caminhos).toEqual([]);
  });

  it('a edge embrulha no filtro o único criarGetJson, usado para o item', () => {
    const edge = readFileSync('supabase/functions/agentes/index.ts', 'utf8');
    expect(edge.match(/criarGetJson\(/g)).toHaveLength(1);
    expect(edge).toContain('get: soDoVendedor(criarGetJson(token), cx.contaExternaId)');
    // O preço usa o token direto, mas só de MLB que o multiget filtrado confirmou (`margens.ts`, testes abaixo).
    expect(edge).toContain('(await doML()).preco.lerPrecos(ids)');
  });
});

describe('vínculo velho de uma conta trocada (o ML devolve 200 de outro vendedor)', () => {
  /** MLB1 é da conta; MLB2 está no cadastro da organização, mas o ML diz que é de outro vendedor. */
  function deps() {
    const bruto = (id: string, seller_id: number, vid: number) => ({
      status_code: 200,
      body: {
        id, seller_id, title: `Titulo ${id}`, status: 'active', price: 50, original_price: 60, listing_type_id: 'gold_special',
        category_id: 'MLB1234', attributes: [], item_relations: [],
        variations: [{ id: vid, seller_custom_field: `SKU-${id}`, attribute_combinations: [{ id: 'COLOR', value_name: 'Azul' }] }],
      },
    });
    const todos: Record<string, unknown> = { MLB1: bruto('MLB1', 111222333, 1), MLB2: bruto('MLB2', 444555666, 2) };
    const get = soDoVendedor(
      (p) => Promise.resolve(new URL(`https://x${p}`).searchParams.get('ids')!.split(',').map((id) => todos[id])), CONTA);
    const vinculo = (mlb: string) => ({ mlb, mlbu: null, familia_ml: '1', sku: `SKU-${mlb}`, codigo_pai: 'P1' });
    const tarifaEm = vi.fn(async () => ({ comissao: { percentual: 12, fixa: 6 }, frete: 0 }));
    const lerPrecos = vi.fn(async (ids: string[]) => new Map(ids.map((id) =>
      [id, { preco: 50, precoTabela: null, emPromocao: false, promocaoTipo: null, priceId: '1', lidoEm: 'T' }])));
    const d: DepsMargens = {
      orgId: 'org-A', agora: new Date('2026-11-24T12:00:00Z'),
      resolver: { vinculos: async (f) => ['MLB1', 'MLB2'].filter((m) => !f.mlb || f.mlb === m).map(vinculo), buscarPorTitulo: async () => ({ candidatos: [], lista_cortada: false }) },
      carregarCadastro: async () => montarCadastro(['MLB1', 'MLB2'].map((m, i) => ({
        id: `v-${m}`, custo: 14, preco: 18, cor: 'Azul', codigo: null, gtin: null, ml_variation_id: String(i + 1),
        peso_gramas: 200, altura_cm: 5, largura_cm: 10, comprimento_cm: 15, atualizado_em: '2026-09-01T00:00:00Z',
        familias: { ml_item_id: m, origem: 'nacional' },
      })), []),
      lerAliquotas: async () => ({ nacional: 8, importado: 16 }),
      buscarItensML: (ids) => buscarItensML(get, ids),
      lerPrecos,
      lerStatus: async () => new Map(),
      lerFimPromocao: async () => new Map(),
      tarifaEm, reservarTarifas: async () => 'ok', reservarLeituras: async () => 'ok',
      listarMlbs: async () => ['MLB1', 'MLB2'],
    };
    return { d, tarifaEm, lerPrecos };
  }
  const VAZIO = {
    mlb: 'MLB2', titulo: null, status: null, sku: null, preco_brl: null, preco_tabela_brl: null, em_promocao: null, promocao_tipo: null,
    preco_lido_em: null, custo_brl: null, comissao_brl: null,
    frete_brl: null, imposto_brl: null, liquido_brl: null, margem_pct: null, roas_minimo: null, motivo: 'anuncio_indisponivel',
  };

  it('margem, catálogo e simulação não entregam nada do outro vendedor nem consultam tarifa dele', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const casos: [(d: DepsMargens) => Promise<unknown>, unknown][] = [
      [(d) => margemDoAlvo('MLB2', d), { ...VAZIO, promocao_fim: null }],
      // Na simulação, `preco_brl` é o preço digitado pelo agente, não dado do ML.
      [(d) => simularMargem('MLB2', 80, d), { ...VAZIO, preco_brl: 80, preco_atual_brl: null }],
    ];
    for (const [chamar, esperado] of casos) {
      const { d, tarifaEm, lerPrecos } = deps();
      const r = await chamar(d) as { anuncios: unknown[] };
      expect(r.anuncios).toEqual([esperado]);
      expect(tarifaEm).not.toHaveBeenCalled();
      expect(lerPrecos).toHaveBeenCalledWith([]);
    }
    const { d, lerPrecos } = deps();
    const r = await margensDoCatalogo(null, d);
    expect(r).toMatchObject({ estado: 'ok', parcial: true, anuncios: [{ mlb: 'MLB1', titulo: 'Titulo MLB1', preco_brl: 50, margem_pct: 40 }, VAZIO] });
    expect((r as { anuncios: unknown[] }).anuncios[1]).toEqual(VAZIO);
    expect(lerPrecos).toHaveBeenCalledWith(['MLB1']);
  });

  it('na família, o anúncio alheio zera a referência e o próprio mantém o número', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await margemDoAlvo('123456789012', deps().d);
    expect(r).toMatchObject({ anuncios: [{ mlb: 'MLB1', margem_pct: 40 }, VAZIO], referencia: { margem_pct: null, motivo: 'anuncio_sem_numero' } });
  });
});
