import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAMPOS_ITEM_AGORA, parseItensBulk } from '../../ads/campanhas.ts';
import { caminhoMultiget } from '../../ml/multiget.ts';
import { buscarItensML } from '../../promocoes/ml.ts';
import { soDoVendedor } from '../so-do-vendedor.ts';

const CONTA = '111222333';
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
  parseItensBulk(await soDoVendedor(fakeML(resposta).get, CONTA)(caminhoMultiget(ids, CAMPOS_ITEM_AGORA)), ids);

describe('soDoVendedor', () => {
  it('pede o vendedor e preserva os campos do app nas duas leituras', async () => {
    const ml = fakeML([ok('MLB1', 111222333)]);
    const get = soDoVendedor(ml.get, CONTA);
    await get(caminhoMultiget(['MLB1'], CAMPOS_ITEM_AGORA));
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
    expect(await get(caminhoMultiget(ids, CAMPOS_ITEM_AGORA)))
      .toEqual([{ status_code: 403 }, { status_code: 404 }, { status_code: 403 }, ok('MLB4', 111222333)]);
    expect(aviso.mock.calls).toEqual([['[agentes] anúncio fora da conta descartado', { quantidade: 1 }]]);
  });

  it('confere todo envelope com corpo, inclusive no formato antigo', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const antigo = { code: 200, body: corpo('MLB1', 1) };
    const get = soDoVendedor(fakeML([antigo, { status_code: 206, body: corpo('MLB2', 1) }]).get, CONTA);
    expect(await get(caminhoMultiget(['MLB1', 'MLB2'], 'id'))).toEqual([{ status_code: 403 }, { status_code: 403 }]);
  });

  it('não avisa quando nada é descartado', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await precos([ok('MLB1', 111222333), { status_code: 403 }], ['MLB1', 'MLB2']);
    expect(aviso).not.toHaveBeenCalled();
  });

  it('erro do ML sobe e resposta que não é lista volta intacta', async () => {
    const erro = new Error('ML 500 em /items/bulk');
    await expect(soDoVendedor(() => Promise.reject(erro), CONTA)(caminhoMultiget(['MLB1'], 'id'))).rejects.toBe(erro);
    expect(await soDoVendedor(fakeML({ error: 'x' }).get, CONTA)(caminhoMultiget(['MLB1'], 'id'))).toEqual({ error: 'x' });
  });

  it('recusa caminho que não é o bulk, em vez de ler sem conferir o vendedor', async () => {
    const ml = fakeML({});
    await expect(soDoVendedor(ml.get, CONTA)('/items/MLB1')).rejects.toThrow('agentes.leitura_sem_vendedor');
    expect(ml.caminhos).toEqual([]);
  });

  it('a edge só lê o ML pelo filtro', () => {
    const edge = readFileSync('supabase/functions/agentes/index.ts', 'utf8');
    expect(edge.match(/criarGetJson\(/g)).toHaveLength(1);
    expect(edge).toContain('get: soDoVendedor(criarGetJson(token), cx.contaExternaId)');
  });
});
