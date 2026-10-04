import { describe, expect, it } from 'vitest';
import { caminhoMultiget, comoEnvelopeAntigo } from '../multiget.ts';

// Pares reais antigo × bulk dos mesmos ids (spike de 03/10/2026, ADR-0177).
const CONJUNTOS = [
  'canais', 'atualizar-item', 'buscar-item', 'descobrir-familia', 'varrer-itens', 'vendas', 'pedidos-pxv-cores',
  'kit-virtual', 'componentes-kit', 'operacoes', 'pulse', 'pxv-estoque', 'promocoes', 'kit', 'catalogo', 'relacionados',
] as const;
const carregar = async (c: string, lado: 'antigo' | 'bulk' | 'ids') =>
  (await import(`./fixtures/bulk-${c}-${lado}.json`, { with: { type: 'json' } })).default as unknown;

type Env = { code?: number; body?: { id?: string; tags?: string[] } & Record<string, unknown> };
/** Por id (a ordem do antigo é arbitrária), `tags` ordenado, body de erro reduzido ao id (spec §4.3). */
const normalizar = (arr: unknown) =>
  (arr as Env[]).map((e) => ({
    code: e.code,
    body: e.code === 200 ? { ...e.body, ...(e.body?.tags ? { tags: [...e.body.tags].sort() } : {}) } : { id: e.body?.id },
  })).sort((a, b) => String(a.body.id).localeCompare(String(b.body.id)));

describe('caminhoMultiget', () => {
  it('status_code primeiro e prefixo body. em cada campo, na ordem dada', () => {
    expect(caminhoMultiget(['MLB1', 'MLB2'], 'id,status,price'))
      .toBe('/items/bulk?ids=MLB1,MLB2&attributes=status_code,body.id,body.status,body.price');
  });
  it('deduplica DENTRO da requisição, preservando a 1ª ocorrência', () => {
    expect(caminhoMultiget(['MLB2', 'MLB1', 'MLB2'], 'id')).toBe('/items/bulk?ids=MLB2,MLB1&attributes=status_code,body.id');
  });
  it('21 posições com 20 únicos → 20 na URL (o antigo deduplicava antes do limite)', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `MLB${i}`);
    expect(new URL(`https://x${caminhoMultiget([...ids, ids[0]], 'id')}`).searchParams.get('ids')!.split(',')).toEqual(ids);
  });
  it('não divide, não filtra, não lança', () => {
    const ids = Array.from({ length: 21 }, (_, i) => `MLB${i}`);
    expect(new URL(`https://x${caminhoMultiget(ids, 'id')}`).searchParams.get('ids')!.split(',')).toHaveLength(21);
    expect(() => caminhoMultiget([], 'id')).not.toThrow();
  });
  it('extra no fim e id codificado', () => {
    expect(caminhoMultiget(['MLB 1'], 'id', '&include_attributes=all'))
      .toBe('/items/bulk?ids=MLB%201&attributes=status_code,body.id&include_attributes=all');
  });
});

describe('comoEnvelopeAntigo', () => {
  it.each(CONJUNTOS)('%s: bulk real vira o envelope antigo dos mesmos ids', async (c) => {
    const ids = (await carregar(c, 'ids')) as string[];
    expect(normalizar(comoEnvelopeAntigo(await carregar(c, 'bulk'), ids))).toEqual(normalizar(await carregar(c, 'antigo')));
  });
  it('404 sem body recebe o id pela posição, com as posições confirmadas', () => {
    expect(comoEnvelopeAntigo(
      [{ status_code: 200, body: { id: 'MLB1' } }, { status_code: 404 }, { status_code: 200, body: { id: 'MLB3' } }],
      ['MLB1', 'MLB2', 'MLB3'],
    )).toEqual([{ code: 200, body: { id: 'MLB1' } }, { code: 404, body: { id: 'MLB2' } }, { code: 200, body: { id: 'MLB3' } }]);
  });
  it('posição conta sobre os ids únicos enviados', () => {
    expect(comoEnvelopeAntigo([{ status_code: 200, body: { id: 'MLB1' } }, { status_code: 404 }], ['MLB1', 'MLB1', 'MLB2']))
      .toEqual([{ code: 200, body: { id: 'MLB1' } }, { code: 404, body: { id: 'MLB2' } }]);
  });
  it('posições contraditórias (mesma cardinalidade) → nenhum id fabricado', () => {
    expect(comoEnvelopeAntigo([{ status_code: 200, body: { id: 'MLB2' } }, { status_code: 404 }], ['MLB1', 'MLB2']))
      .toEqual([{ code: 200, body: { id: 'MLB2' } }, { code: 404 }]);
  });
  it('cardinalidade diferente → só traduz o código', () => {
    expect(comoEnvelopeAntigo([{ status_code: 404 }], ['MLB1', 'MLB2'])).toEqual([{ code: 404 }]);
  });
  it('200 ou 500 sem body NUNCA ganham body (no antigo ficavam fora; senão lerRelacoes aceitaria item vazio)', () => {
    expect(comoEnvelopeAntigo([{ status_code: 200 }], ['MLB1'])).toEqual([{ code: 200 }]);
    expect(comoEnvelopeAntigo([{ status_code: 500 }], ['MLB1'])).toEqual([{ code: 500 }]);
  });
  it('entrada no formato antigo volta intacta (inclusive sem body e com code null)', () => {
    const antigo = [{ code: 404, body: { id: 'MLB9', message: 'x' } }, { code: 404 }, { code: null, status_code: 200 }];
    const r = comoEnvelopeAntigo(antigo, ['MLB9', 'MLB8', 'MLB7']) as unknown[];
    expect(r).toEqual(antigo);
    r.forEach((e, i) => expect(e).toBe(antigo[i]));
  });
  it('não-array volta intacto', () => {
    const obj = { message: 'erro' };
    expect(comoEnvelopeAntigo(obj, ['MLB1'])).toBe(obj);
    expect(comoEnvelopeAntigo(null, ['MLB1'])).toBeNull();
    expect(comoEnvelopeAntigo('x', ['MLB1'])).toBe('x');
  });
  it('entrada que não é objeto volta intacta; o resto segue a regra (alinhamento desligado pelas não-objeto)', () => {
    expect(comoEnvelopeAntigo([null, 5, { status_code: 404 }], ['MLB1', 'MLB2', 'MLB3'])).toEqual([null, 5, { code: 404 }]);
  });
  it('body existente sem id é preservado', () => {
    expect(comoEnvelopeAntigo([{ status_code: 500, body: { message: 'x' } }], ['MLB1'])).toEqual([{ code: 500, body: { message: 'x' } }]);
  });
});
